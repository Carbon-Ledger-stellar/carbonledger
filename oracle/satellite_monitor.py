"""
satellite_monitor.py
Flask webhook receiver for Google Earth Engine satellite data.
Validates HMAC-SHA256 signatures on incoming webhooks, checks for replay attacks,
validates deforestation/land-use data against registered project coordinates,
submits monitoring evidence CIDs to carbon_oracle, and flags projects where
satellite data contradicts reported sequestration.
"""

import hashlib
import hmac
import os
import time
import logging
import requests
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from stellar_sdk import Keypair, Network, SorobanServer, TransactionBuilder, scval
from stellar_sdk.soroban_rpc import SendTransactionStatus

load_dotenv()
from log import get_logger  # noqa: E402 — must come after load_dotenv
log = get_logger("satellite_monitor")

app = Flask(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

ORACLE_SECRET_KEY   = os.environ["ORACLE_SECRET_KEY"]
ORACLE_CONTRACT_ID  = os.environ["CARBON_ORACLE_CONTRACT_ID"]
STELLAR_RPC_URL     = os.environ.get("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org")
NETWORK_PASSPHRASE  = os.environ.get("NETWORK_PASSPHRASE", Network.TESTNET_NETWORK_PASSPHRASE)
BACKEND_API_URL     = os.environ.get("BACKEND_API_URL", "http://localhost:3001")
ADMIN_ALERT_WEBHOOK = os.environ.get("ADMIN_ALERT_WEBHOOK", "")
GEE_WEBHOOK_SECRET  = os.environ.get("GEE_WEBHOOK_SECRET", "")

# Maximum payload age in seconds before rejecting (5 minutes)
MAX_PAYLOAD_AGE_SECS = 5 * 60

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
            raise RuntimeError(f"Transaction FAILED")

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
    lat_diff = abs(registered.get("lat", 0) - satellite.get("lat", 0))
    lon_diff = abs(registered.get("lon", 0) - satellite.get("lon", 0))
    # ~0.009 degrees per km at equator
    threshold = tolerance_km * 0.009
    return lat_diff <= threshold and lon_diff <= threshold

def detect_contradiction(report: dict) -> bool:
    """
    Returns True if satellite data contradicts reported sequestration.
    Contradiction = deforestation detected in a project claiming forest preservation.
    """
    deforestation_pct = float(report.get("deforestation_pct", 0))
    reported_tonnes   = float(report.get("reported_tonnes_sequestered", 0))
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
    tonnes      = int(data.get("tonnes_verified", 0))
    score       = int(data.get("methodology_score", 80))
    coordinates = data.get("coordinates", {})

    if not project_id or not period or not satellite_cid:
        return jsonify({"error": "Missing required fields"}), 400

    # Validate coordinates against registered project
    registered_coords = get_project_coordinates(project_id)
    if registered_coords and not coordinates_match(registered_coords, coordinates):
        msg = f"⚠️ Coordinate mismatch for project {project_id} — satellite data may be for wrong location"
        log.warning(msg)
        alert_admin(msg)
        return jsonify({"status": "rejected", "reason": "coordinate_mismatch"}), 422

    # Check for contradiction
    if detect_contradiction(data):
        msg = f"🚨 Satellite contradiction detected for project {project_id}: deforestation in forestry project"
        log.error(msg)
        alert_admin(msg)

        keypair = Keypair.from_secret(ORACLE_SECRET_KEY)
        try:
            tx_hash = build_and_submit(
                "flag_project",
                [
                    scval.to_address(keypair.public_key),
                    scval.to_string(project_id),
                    scval.to_string("satellite_contradiction_detected"),
                ],
            )
            log.info("Flagged project %s on-chain → tx %s", project_id, tx_hash)
        except Exception as e:
            log.error("Failed to flag project %s: %s", project_id, e)

        return jsonify({"status": "flagged", "reason": "satellite_contradiction"}), 200

    # Submit valid monitoring evidence
    keypair = Keypair.from_secret(ORACLE_SECRET_KEY)
    try:
        tx_hash = build_and_submit(
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
        log.info("Submitted satellite monitoring for %s/%s → tx %s", project_id, period, tx_hash)
        return jsonify({"status": "submitted", "tx_hash": tx_hash}), 200

    except Exception as e:
        log.error("Failed to submit satellite data for %s: %s", project_id, e)
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("SATELLITE_MONITOR_PORT", 5001))
    log.info("Satellite monitor webhook server starting on port %d", port)
    app.run(host="0.0.0.0", port=port)
