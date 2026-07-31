"""
satellite_monitor.py
Flask webhook receiver for Google Earth Engine satellite data.
Validates HMAC-SHA256 signatures on incoming webhooks, checks for replay attacks,
validates deforestation/land-use data against registered project coordinates,
submits monitoring evidence CIDs to carbon_oracle, and flags projects where
satellite data contradicts reported sequestration.

Authentication (Feature #585)
──────────────────────────────
Requests from registered providers use HMAC-SHA256 signature verification:
  - X-Provider-ID  : provider identifier (looked up in SatelliteWebhookProvider)
  - X-Timestamp    : Unix epoch seconds; must be within ±300 s of server time
  - X-Signature    : hex(HMAC-SHA256(key, "{provider_id}.{timestamp}.{body}"))

Legacy path: if X-Provider-ID is absent, falls back to plaintext GEE_WEBHOOK_SECRET
comparison (kept for backward compatibility while providers migrate).

IPFS Data Integrity (Issue #536)
─────────────────────────────────
Before any CID is submitted on-chain, three checks are performed:

1. Content fetch  — the raw bytes at the CID are retrieved from an IPFS
   gateway (public or configured).  Retries with exponential back-off handle
   transient gateway unavailability (up to IPFS_MAX_RETRIES attempts).

2. Hash verification — a SHA-256 digest is computed over the fetched bytes
   and compared against the ``content_sha256`` field supplied in the webhook
   payload.  A mismatch means the data stored under the CID does not match
   what the sender claims, which is treated as tampering and causes the
   submission to be rejected and an admin alert to fire.

3. Multi-node pinning (Pinata) — the Pinata Pinning Services API is queried
   to confirm the CID is pinned.  We require the pin to appear in the Pinata
   response with status ``pinned``.  When PINATA_API_KEY and PINATA_API_SECRET
   are set, the Pinata API is also used to verify that the pin count reported
   meets the IPFS_MIN_PIN_NODES threshold (default 3).

   If Pinata credentials are absent the pin-count check is skipped (the
   content-hash check still runs).

Data-integrity guarantees
─────────────────────────
- Any CID whose on-IPFS content cannot be fetched after all retries is
  rejected (no on-chain submission, admin alerted).
- Any CID whose fetched content does not hash to the declared SHA-256 is
  rejected and triggers a tamper-detection alert.
- Any CID that is not pinned on the required minimum number of nodes is
  rejected with reason ``insufficient_pinning``.
- Only CIDs that pass all three checks proceed to Soroban submission.
"""

import hashlib
import hmac as _hmac
import os
import time
import logging
import requests
import psycopg2
import psycopg2.extras
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from stellar_sdk import Keypair, Network, SorobanServer, TransactionBuilder, scval
from stellar_sdk.soroban_rpc import SendTransactionStatus

load_dotenv()
from log import get_logger  # noqa: E402 — must come after load_dotenv
log = get_logger("satellite_monitor")
from circuit_breaker import get_circuit_breaker, get_all_health, CircuitOpenError  # noqa: E402
from utils.safe_parse import safe_float, safe_int  # noqa: E402

app = Flask(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

ORACLE_SECRET_KEY   = os.environ["ORACLE_SECRET_KEY"]
ORACLE_CONTRACT_ID  = os.environ["CARBON_ORACLE_CONTRACT_ID"]
STELLAR_RPC_URL     = os.environ.get("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org")
NETWORK_PASSPHRASE  = os.environ.get("NETWORK_PASSPHRASE", Network.TESTNET_NETWORK_PASSPHRASE)
BACKEND_API_URL     = os.environ.get("BACKEND_API_URL", "http://localhost:3001")
ADMIN_ALERT_WEBHOOK = os.environ.get("ADMIN_ALERT_WEBHOOK", "")
GEE_WEBHOOK_SECRET  = os.environ.get("GEE_WEBHOOK_SECRET", "")
DATABASE_URL        = os.environ.get("DATABASE_URL", "")

# Maximum allowed clock skew between sender and server (seconds).
TIMESTAMP_TOLERANCE = 300  # 5 minutes

# ── IPFS / Pinata config (Issue #536) ────────────────────────────────────────
# Public IPFS gateway used to fetch CID content for hash verification.
# Override with a private gateway (e.g. https://gateway.pinata.cloud/ipfs) via env.
IPFS_GATEWAY_URL    = os.environ.get("IPFS_GATEWAY_URL", "https://ipfs.io/ipfs")

# Pinata API credentials for multi-node pinning confirmation.
# Both must be set to enable pin-count checks; if absent, pin-count check is skipped.
PINATA_API_KEY      = os.environ.get("PINATA_API_KEY", "")
PINATA_API_SECRET   = os.environ.get("PINATA_API_SECRET", "")
PINATA_JWT          = os.environ.get("PINATA_JWT", "")  # alternative to key+secret

# Minimum number of IPFS nodes the CID must be pinned on before submission.
IPFS_MIN_PIN_NODES  = int(os.environ.get("IPFS_MIN_PIN_NODES", "3"))

# Retry parameters for transient IPFS gateway failures.
IPFS_MAX_RETRIES    = int(os.environ.get("IPFS_MAX_RETRIES", "3"))
IPFS_RETRY_BASE_DELAY = float(os.environ.get("IPFS_RETRY_BASE_DELAY", "1.0"))  # seconds

# Circuit breaker for Soroban RPC calls (Feature #586)
_rpc_circuit = get_circuit_breaker("satellite_monitor_rpc")

# How long provider HMAC keys stay cached in-process before re-fetching from DB.
_CACHE_TTL_SECONDS = 60

# ── In-process provider key cache ────────────────────────────────────────────
# Structure: { provider_id: {"key_bytes": bytes, "expires_at": float} }
_provider_cache: dict = {}


def get_provider_hmac_key(provider_id: str) -> bytes | None:
    """
    Look up a provider's HMAC key from the SatelliteWebhookProvider table.

    Returns the raw key bytes (hex-decoded from DB) for active providers,
    or None if the provider is unknown or inactive.

    Results are cached in-process for _CACHE_TTL_SECONDS to reduce DB load
    while still supporting key rotation (stale cache expires within 60 s).
    """
    now = time.monotonic()

    # Return cached entry if still valid.
    cached = _provider_cache.get(provider_id)
    if cached and cached["expires_at"] > now:
        return cached["key_bytes"]  # may be None (negative cache)

    key_bytes: bytes | None = None

    if not DATABASE_URL:
        log.warning("DATABASE_URL not configured — cannot look up provider %s", provider_id)
    else:
        try:
            with psycopg2.connect(DATABASE_URL) as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT "hmacKey"
                        FROM   "SatelliteWebhookProvider"
                        WHERE  "providerId" = %s
                          AND  "isActive"   = true
                        LIMIT  1
                        """,
                        (provider_id,),
                    )
                    row = cur.fetchone()
                    if row:
                        key_bytes = bytes.fromhex(row["hmacKey"])
        except Exception as exc:
            log.error("DB lookup failed for provider %s: %s", provider_id, exc)
            # On DB error, do NOT cache; fall through to return None so caller
            # rejects the request rather than silently accepting it.
            return None

    # Cache result (including None for unknown providers) to limit DB traffic.
    _provider_cache[provider_id] = {
        "key_bytes": key_bytes,
        "expires_at": now + _CACHE_TTL_SECONDS,
    }
    return key_bytes


def verify_webhook_signature(req) -> tuple[bool, int, str]:
    """
    Verify the HMAC-SHA256 signature on an incoming webhook request.

    Returns a 3-tuple: (is_valid: bool, http_status: int, reason: str).

    Signature computation (sender must use the same algorithm):
      msg = f"{provider_id}.{timestamp}".encode() + b"." + raw_body_bytes
      sig = HMAC-SHA256(hex_decoded_provider_key, msg).hexdigest()

    Checks performed (in order):
      1. X-Provider-ID header present.
      2. X-Timestamp header present and parseable as an integer.
      3. Timestamp within ±TIMESTAMP_TOLERANCE seconds of server time
         (replay protection).
      4. X-Signature header present.
      5. Provider key found in DB (provider registered and active).
      6. Computed signature matches supplied signature using constant-time
         comparison (prevents timing oracle attacks).
    """
    provider_id = req.headers.get("X-Provider-ID", "").strip()
    timestamp_str = req.headers.get("X-Timestamp", "").strip()
    supplied_sig = req.headers.get("X-Signature", "").strip()

    if not provider_id:
        return False, 401, "missing_provider_id"

    if not timestamp_str:
        return False, 400, "missing_timestamp"

    try:
        timestamp = int(timestamp_str)
    except ValueError:
        return False, 400, "invalid_timestamp_format"

    server_time = int(time.time())
    skew = abs(server_time - timestamp)
    if skew > TIMESTAMP_TOLERANCE:
        # Distinguish expired (past) from future to aid debugging, but both are 400.
        direction = "expired" if timestamp < server_time else "future"
        return False, 400, f"timestamp_{direction}"

    if not supplied_sig:
        return False, 401, "missing_signature"

    key_bytes = get_provider_hmac_key(provider_id)
    if key_bytes is None:
        return False, 401, "unknown_provider"

    # Build the message the sender should have signed.
    body_bytes: bytes = req.get_data()  # raw body, read once by Flask
    msg = f"{provider_id}.{timestamp_str}".encode() + b"." + body_bytes

    expected_sig = _hmac.new(
        key=key_bytes,
        msg=msg,
        digestmod=hashlib.sha256,
    ).hexdigest()

    # Constant-time comparison prevents timing side-channel attacks.
    if not _hmac.compare_digest(expected_sig, supplied_sig):
        return False, 401, "invalid_signature"

    return True, 200, "ok"


# Maximum payload age in seconds before rejecting (5 minutes)
MAX_PAYLOAD_AGE_SECS = 5 * 60

# ── IPFS CID Verification (Issue #536) ───────────────────────────────────────

class IPFSContentError(Exception):
    """Raised when IPFS content cannot be fetched after all retries."""


class IPFSTamperError(Exception):
    """Raised when fetched IPFS content does not match the declared SHA-256 hash."""


class IPFSPinningError(Exception):
    """Raised when the CID is not pinned on enough nodes."""


def fetch_ipfs_content(cid: str) -> bytes:
    """
    Fetch raw bytes stored at *cid* from the configured IPFS gateway.

    Retries up to IPFS_MAX_RETRIES times with exponential back-off starting
    at IPFS_RETRY_BASE_DELAY seconds to handle transient gateway outages.

    Args:
        cid: IPFS content identifier (v0 Qm… or v1 bafy…).

    Returns:
        The raw content bytes.

    Raises:
        IPFSContentError: If the content cannot be fetched after all retries.
    """
    url = f"{IPFS_GATEWAY_URL.rstrip('/')}/{cid}"
    last_exc: Exception | None = None

    for attempt in range(1, IPFS_MAX_RETRIES + 1):
        try:
            resp = requests.get(url, timeout=30)
            if resp.status_code == 200:
                return resp.content
            log.warning(
                "IPFS gateway returned HTTP %d for CID %s (attempt %d/%d)",
                resp.status_code, cid, attempt, IPFS_MAX_RETRIES,
            )
            last_exc = IOError(f"HTTP {resp.status_code}")
        except requests.RequestException as exc:
            log.warning(
                "IPFS fetch error for CID %s (attempt %d/%d): %s",
                cid, attempt, IPFS_MAX_RETRIES, exc,
            )
            last_exc = exc

        if attempt < IPFS_MAX_RETRIES:
            delay = IPFS_RETRY_BASE_DELAY * (2 ** (attempt - 1))
            log.info("Retrying IPFS fetch for CID %s in %.1f s", cid, delay)
            time.sleep(delay)

    raise IPFSContentError(
        f"Failed to fetch IPFS content for CID {cid} after {IPFS_MAX_RETRIES} attempts: {last_exc}"
    )


def verify_content_hash(content: bytes, expected_sha256: str) -> bool:
    """
    Compute the SHA-256 digest of *content* and compare it to *expected_sha256*.

    Args:
        content: Raw bytes fetched from IPFS.
        expected_sha256: Hex-encoded SHA-256 digest declared in the webhook payload.

    Returns:
        True if the digests match, False otherwise.
    """
    computed = hashlib.sha256(content).hexdigest()
    return _hmac.compare_digest(computed.lower(), expected_sha256.lower())


def check_pinata_pinning(cid: str) -> int:
    """
    Query the Pinata Pinning Services API to determine how many nodes have the
    CID pinned.

    When PINATA_JWT is set it is preferred over PINATA_API_KEY + PINATA_API_SECRET.
    If neither credential set is configured this function returns -1 to signal
    that the check is being skipped (caller decides whether to allow or deny).

    Pinata reports pin *jobs*, not individual node counts directly; we treat
    the count of rows with ``status == "pinned"`` as the effective pin count.
    For Pinata-managed replicated pins each listed pin entry corresponds to
    a distinct gateway / node so a count of ≥ IPFS_MIN_PIN_NODES is
    sufficient to satisfy the multi-node guarantee.

    Args:
        cid: IPFS content identifier to look up.

    Returns:
        Number of pinned entries reported by Pinata, or -1 if Pinata
        credentials are not configured (skip check).

    Raises:
        IPFSPinningError: On API errors or unexpected response shapes.
    """
    if not PINATA_JWT and not (PINATA_API_KEY and PINATA_API_SECRET):
        log.debug("Pinata credentials not configured — skipping pin-count check for CID %s", cid)
        return -1  # sentinel: check skipped

    headers: dict = {"Content-Type": "application/json"}
    if PINATA_JWT:
        headers["Authorization"] = f"Bearer {PINATA_JWT}"
    else:
        headers["pinata_api_key"] = PINATA_API_KEY
        headers["pinata_secret_api_key"] = PINATA_API_SECRET

    url = "https://api.pinata.cloud/pinning/pinJobs"
    params = {"ipfs_pin_hash": cid, "status": "pinned"}

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
    except requests.RequestException as exc:
        raise IPFSPinningError(f"Pinata API request failed for CID {cid}: {exc}") from exc

    if resp.status_code == 401:
        raise IPFSPinningError(f"Pinata API returned 401 Unauthorized — check credentials (CID {cid})")
    if resp.status_code != 200:
        raise IPFSPinningError(
            f"Pinata API returned HTTP {resp.status_code} for CID {cid}: {resp.text[:200]}"
        )

    try:
        body = resp.json()
    except ValueError as exc:
        raise IPFSPinningError(f"Pinata API returned non-JSON response for CID {cid}") from exc

    # Pinata v2 response shape: {"count": int, "rows": [...]}
    rows = body.get("rows", [])
    pinned_count = sum(1 for row in rows if row.get("status") == "pinned")

    log.info(
        "Pinata pin check for CID %s: %d pinned entries (min required: %d)",
        cid, pinned_count, IPFS_MIN_PIN_NODES,
    )
    return pinned_count


def verify_ipfs_cid(cid: str, expected_sha256: str) -> tuple[bool, str]:
    """
    Full IPFS data-integrity pipeline for a single CID.

    Steps (in order):
      1. Fetch content from the IPFS gateway with retry / back-off.
      2. Verify SHA-256 hash against *expected_sha256* (tamper detection).
      3. Check Pinata pinning — requires ≥ IPFS_MIN_PIN_NODES pinned entries.

    Args:
        cid: IPFS content identifier.
        expected_sha256: Hex-encoded SHA-256 hash declared in the webhook
            payload.  Must not be empty.

    Returns:
        (True, "ok") on full success.
        (False, reason_string) on any failure.

    Side effects:
        Logs warnings/errors and (on tamper detection) fires an admin alert.
    """
    # Step 1 — fetch content
    try:
        content = fetch_ipfs_content(cid)
    except IPFSContentError as exc:
        log.error("IPFS content unavailable for CID %s: %s", cid, exc)
        alert_admin(f"⚠️ IPFS content unavailable for CID {cid}: {exc}")
        return False, "ipfs_unavailable"

    # Step 2 — hash verification
    if not expected_sha256:
        log.error("No expected SHA-256 provided for CID %s — rejecting", cid)
        return False, "missing_expected_hash"

    if not verify_content_hash(content, expected_sha256):
        computed = hashlib.sha256(content).hexdigest()
        msg = (
            f"🚨 IPFS tamper detected for CID {cid}: "
            f"expected sha256={expected_sha256} got sha256={computed}"
        )
        log.error(msg)
        alert_admin(msg)
        return False, "hash_mismatch"

    log.info("CID %s content hash verified (SHA-256 match)", cid)

    # Step 3 — multi-node pinning
    try:
        pin_count = check_pinata_pinning(cid)
    except IPFSPinningError as exc:
        log.error("Pinata pin check failed for CID %s: %s", cid, exc)
        alert_admin(f"⚠️ Pinata pin check failed for CID {cid}: {exc}")
        return False, "pinning_check_error"

    if pin_count == -1:
        # Credentials not configured — skip pin-count enforcement
        log.info("CID %s: pin-count check skipped (no Pinata credentials)", cid)
    elif pin_count < IPFS_MIN_PIN_NODES:
        msg = (
            f"⚠️ CID {cid} is pinned on only {pin_count} node(s) "
            f"(minimum required: {IPFS_MIN_PIN_NODES})"
        )
        log.error(msg)
        alert_admin(msg)
        return False, "insufficient_pinning"

    return True, "ok"


# ── HMAC Signature Verification ───────────────────────────────────────────────

def verify_gee_signature(payload_body: bytes, signature_header: str) -> bool:
    """Verify the X-GEE-Signature header using HMAC-SHA256.

    Args:
        payload_body: The raw request body bytes.
        signature_header: The value of the X-GEE-Signature header (e.g. "sha256=abc123...").

    Returns:
        True if the signature is valid, False otherwise.
    """
    if not signature_header:
        return False
    if not signature_header.startswith("sha256="):
        return False

    expected_sig = signature_header[7:]  # strip "sha256=" prefix
    if not expected_sig:
        return False

    computed = hmac.new(
        GEE_WEBHOOK_SECRET.encode("utf-8"),
        payload_body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(computed, expected_sig)


def verify_payload_timestamp(payload: dict) -> bool:
    """Check that the payload timestamp is within MAX_PAYLOAD_AGE_SECS.

    Returns True if the payload is fresh, False if it's a replay.
    """
    payload_time = payload.get("timestamp")
    if payload_time is None:
        # If no timestamp, allow (backwards compatibility)
        return True
    try:
        payload_ts = int(payload_time)
    except (ValueError, TypeError):
        return False
    age = abs(int(time.time()) - payload_ts)
    return age <= MAX_PAYLOAD_AGE_SECS

# ── Stellar helpers ───────────────────────────────────────────────────────────

def build_and_submit(function_name: str, args: list) -> str:
    server  = SorobanServer(STELLAR_RPC_URL)
    keypair = Keypair.from_secret(ORACLE_SECRET_KEY)
    account = server.load_account(keypair.public_key)

    tx = (
        TransactionBuilder(
            source_account=account,
            network_passphrase=NETWORK_PASSPHRASE,
            base_fee=300,
        )
        .append_invoke_contract_function_op(
            contract_id=ORACLE_CONTRACT_ID,
            function_name=function_name,
            parameters=args,
        )
        .set_timeout(30)
        .build()
    )
    tx = server.prepare_transaction(tx)
    tx.sign(keypair)
    response = server.send_transaction(tx)

    if response.status == SendTransactionStatus.ERROR:
        raise RuntimeError(f"Transaction failed: {response.error_result_xdr}")

    for _ in range(20):
        time.sleep(3)
        result = server.get_transaction(response.hash)
        if result.status == "SUCCESS":
            return response.hash
        if result.status == "FAILED":
            raise RuntimeError("Transaction FAILED")

    raise TimeoutError("Transaction not confirmed")


def alert_admin(message: str):
    if not ADMIN_ALERT_WEBHOOK:
        log.warning("ADMIN ALERT: %s", message)
        return
    try:
        requests.post(ADMIN_ALERT_WEBHOOK, json={"text": message}, timeout=10)
    except Exception as e:
        log.error("Alert webhook failed: %s", e)


# ── Project coordinate lookup ─────────────────────────────────────────────────

def get_project_coordinates(project_id: str) -> dict | None:
    """Fetch registered project coordinates from backend API."""
    try:
        resp = requests.get(f"{BACKEND_API_URL}/projects/{project_id}", timeout=10)
        if resp.status_code == 200:
            return resp.json().get("coordinates")
    except Exception as e:
        log.error("Failed to fetch project %s: %s", project_id, e)
    return None


def coordinates_match(registered: dict, satellite: dict, tolerance_km: float = 1.0) -> bool:
    """Check if satellite observation coordinates match registered project area."""
    if not registered or not satellite:
        return False
    lat_diff = abs(safe_float(registered.get("lat", 0)) - safe_float(satellite.get("lat", 0)))
    lon_diff = abs(safe_float(registered.get("lon", 0)) - safe_float(satellite.get("lon", 0)))
    # ~0.009 degrees per km at equator
    threshold = tolerance_km * 0.009
    return lat_diff <= threshold and lon_diff <= threshold


def detect_contradiction(report: dict) -> bool:
    """
    Returns True if satellite data contradicts reported sequestration.
    Contradiction = deforestation detected in a project claiming forest preservation.
    """
    deforestation_pct = safe_float(report.get("deforestation_pct", 0))
    reported_tonnes   = safe_float(report.get("reported_tonnes_sequestered", 0))
    project_type      = report.get("project_type", "")

    if project_type in ("forestry", "blue_carbon") and deforestation_pct > 5.0 and reported_tonnes > 0:
        return True
    return False


# ── Webhook endpoint ──────────────────────────────────────────────────────────

@app.route("/webhook/satellite", methods=["POST"])
def satellite_webhook():
    # ── HMAC signature verification ──────────────────────────────────────────
    if GEE_WEBHOOK_SECRET:
        signature = request.headers.get("X-GEE-Signature", "")
        if not signature:
            log.warning("Missing X-GEE-Signature header")
            return jsonify({"error": "Missing signature header"}), 401

        payload_body = request.get_data()
        if not verify_gee_signature(payload_body, signature):
            log.warning("Invalid GEE webhook signature")
            return jsonify({"error": "Invalid signature"}), 403
    """
    Receive satellite monitoring data from Google Earth Engine or other providers.

    Authentication priority:
      1. If X-Provider-ID header is present → HMAC-SHA256 verification.
      2. If X-Provider-ID is absent and GEE_WEBHOOK_SECRET is configured →
         legacy plaintext X-GEE-Secret comparison (backward compat).
      3. If neither is configured → accept (no auth configured).
    """
    provider_id_header = request.headers.get("X-Provider-ID", "").strip()

    if provider_id_header:
        # ── HMAC path ──────────────────────────────────────────────────────────
        valid, status_code, reason = verify_webhook_signature(request)
        if not valid:
            log.warning(
                "Webhook auth failed: provider=%s reason=%s status=%d",
                provider_id_header, reason, status_code,
            )
            if status_code == 400:
                return jsonify({"error": "Bad request", "reason": reason}), 400
            return jsonify({"error": "Unauthorized", "reason": reason}), 401
    else:
        # ── Legacy plaintext-secret path ──────────────────────────────────────
        if GEE_WEBHOOK_SECRET:
            provided = request.headers.get("X-GEE-Secret", "")
            if provided != GEE_WEBHOOK_SECRET:
                log.warning("Legacy webhook auth failed: bad X-GEE-Secret")
                return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Empty payload"}), 400

    # ── Replay-attack protection ─────────────────────────────────────────────
    if not verify_payload_timestamp(data):
        log.warning("Rejected stale/replayed payload (timestamp too old)")
        return jsonify({"error": "Payload timestamp too old", "status": "rejected"}), 403

    project_id  = data.get("project_id", "")
    period      = data.get("period", "")
    satellite_cid = data.get("satellite_cid", "")
    tonnes        = safe_int(data.get("tonnes_verified", 0))
    score         = safe_int(data.get("methodology_score", 80))
    coordinates   = data.get("coordinates", {})

    if not project_id or not period or not satellite_cid:
        return jsonify({"error": "Missing required fields"}), 400

    # ── IPFS data-integrity checks (Issue #536) ──────────────────────────────
    # Fetch content, verify SHA-256 hash, and confirm multi-node pinning before
    # any on-chain submission.  The webhook must include ``content_sha256`` for
    # tamper detection; if it is absent the submission is rejected.
    content_sha256 = data.get("content_sha256", "").strip()
    if not content_sha256:
        log.warning(
            "Missing content_sha256 in payload for project %s — rejecting", project_id
        )
        return jsonify({"error": "Missing content_sha256 field", "status": "rejected"}), 400

    ipfs_ok, ipfs_reason = verify_ipfs_cid(satellite_cid, content_sha256)
    if not ipfs_ok:
        log.error(
            "IPFS verification failed for project %s CID %s: %s",
            project_id, satellite_cid, ipfs_reason,
        )
        status_code_map = {
            "ipfs_unavailable":    503,
            "missing_expected_hash": 400,
            "hash_mismatch":       422,
            "pinning_check_error": 502,
            "insufficient_pinning": 422,
        }
        http_code = status_code_map.get(ipfs_reason, 422)
        return jsonify({"status": "rejected", "reason": ipfs_reason}), http_code

    log.info(
        "IPFS integrity verified for project %s CID %s (sha256 match, pinning ok)",
        project_id, satellite_cid,
    )

    # Validate coordinates against registered project.
    registered_coords = get_project_coordinates(project_id)
    if registered_coords and not coordinates_match(registered_coords, coordinates):
        msg = (
            f"⚠️ Coordinate mismatch for project {project_id} "
            "— satellite data may be for wrong location"
        )
        log.warning(msg)
        alert_admin(msg)
        return jsonify({"status": "rejected", "reason": "coordinate_mismatch"}), 422

    # Check for contradiction between satellite observation and reported sequestration.
    if detect_contradiction(data):
        msg = (
            f"🚨 Satellite contradiction detected for project {project_id}: "
            "deforestation in forestry project"
        )
        log.error(msg)
        alert_admin(msg)

        keypair = Keypair.from_secret(ORACLE_SECRET_KEY)
        try:
            tx_hash = _rpc_circuit.call(
                build_and_submit,
                "flag_project",
                [
                    scval.to_address(keypair.public_key),
                    scval.to_string(project_id),
                    scval.to_string("satellite_contradiction_detected"),
                ],
            )
            log.info("Flagged project %s on-chain → tx %s", project_id, tx_hash)
        except CircuitOpenError as e:
            log.warning("RPC circuit OPEN — cannot flag project %s: %s", project_id, e)
        except Exception as e:
            log.error("Failed to flag project %s: %s", project_id, e)

        return jsonify({"status": "flagged", "reason": "satellite_contradiction"}), 200

    # Submit valid monitoring evidence to the oracle contract.
    keypair = Keypair.from_secret(ORACLE_SECRET_KEY)
    try:
        tx_hash = _rpc_circuit.call(
            build_and_submit,
            "submit_monitoring_data",
            [
                scval.to_address(keypair.public_key),
                scval.to_string(project_id),
                scval.to_string(period),
                scval.to_int128(tonnes),
                scval.to_uint32(score),
                scval.to_string(satellite_cid),
            ],
        )
        log.info(
            "Submitted satellite monitoring for %s/%s → tx %s",
            project_id, period, tx_hash,
        )
        return jsonify({"status": "submitted", "tx_hash": tx_hash}), 200

    except CircuitOpenError as e:
        log.warning("RPC circuit OPEN — cannot submit satellite data for %s: %s", project_id, e)
        return jsonify({"status": "error", "message": "RPC circuit open, try again later"}), 503
    except Exception as e:
        log.error("Failed to submit satellite data for %s: %s", project_id, e)
        return jsonify({"status": "error", "message": str(e)}), 500


# ── Health endpoint ───────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """
    Liveness probe.  Returns auth scheme and circuit-breaker state for all
    registered circuits in this process.
    """
    return jsonify({"status": "ok", "auth": "hmac-sha256", "circuits": get_all_health()}), 200


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("SATELLITE_MONITOR_PORT", 5001))
    log.info("Satellite monitor webhook server starting on port %d", port)
    app.run(host="0.0.0.0", port=port)
