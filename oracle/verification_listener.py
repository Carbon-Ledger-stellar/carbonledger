"""
verification_listener.py

Listens to the Stellar Horizon SSE ledger stream (/ledgers?cursor=now) and,
on each new ledger close, polls accredited verifier APIs for pending monitoring
reports, validates them against registry-specific schemas (Verra VCS and Gold
Standard), and submits verified data to the carbon_oracle Soroban contract.

Closes #664 — event-driven Stellar ledger streaming (replaces 6-hour schedule)
Closes #665 — Verra VCS and Gold Standard adapter schemas with validation

Caching layer
────────────────────────────
Verification results are cached in Redis with a configurable TTL (default 1 h).
Cache is invalidated atomically when new oracle data is submitted on-chain.
Staleness is detected if the cache entry has not been refreshed in ≥ 6 hours.
On cache miss or staleness, the service falls back to the PostgreSQL database.
"""

import os
import sys
import time
import json
import hashlib
import threading
import requests
import psycopg2
from datetime import datetime, timezone
from typing import Any
from dotenv import load_dotenv
from stellar_sdk import Keypair, Network, SorobanServer, TransactionBuilder, scval
from stellar_sdk.soroban_rpc import SendTransactionStatus

load_dotenv()
from log import get_logger  # noqa: E402 — must come after load_dotenv

log = get_logger("verification_listener")

# ── Config ────────────────────────────────────────────────────────────────────

ORACLE_SECRET_KEY     = os.environ["ORACLE_SECRET_KEY"]
ORACLE_CONTRACT_ID    = os.environ["CARBON_ORACLE_CONTRACT_ID"]
REGISTRY_CONTRACT_ID  = os.environ["CARBON_REGISTRY_CONTRACT_ID"]
STELLAR_RPC_URL       = os.environ.get("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org")
HORIZON_URL           = os.environ.get("HORIZON_URL", "https://horizon-testnet.stellar.org")
NETWORK_PASSPHRASE    = os.environ.get("NETWORK_PASSPHRASE", Network.TESTNET_NETWORK_PASSPHRASE)
DATABASE_URL          = os.environ["DATABASE_URL"]
ADMIN_ALERT_WEBHOOK   = os.environ.get("ADMIN_ALERT_WEBHOOK", "")
METHODOLOGY_SCORE_MIN = 70

# Redis config
REDIS_URL           = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
REDIS_PASSWORD      = os.environ.get("REDIS_PASSWORD", "")
CACHE_TTL_SECONDS   = int(os.environ.get("VERIFICATION_CACHE_TTL", "3600"))
CACHE_STALE_SECONDS = int(os.environ.get("VERIFICATION_CACHE_STALE", str(6 * 3600)))
CACHE_NS            = "carbonledger:verification:"

# SSE cursor persistence key in Redis
SSE_CURSOR_KEY = "carbonledger:verification:sse_cursor"

VERIFIER_APIS = [
    {
        "name": "Gold Standard",
        "registry": "gold_standard",
        "url": os.environ.get("GOLD_STANDARD_API_URL", ""),
        "key": os.environ.get("GOLD_STANDARD_API_KEY", ""),
    },
    {
        "name": "Verra VCS",
        "registry": "verra_vcs",
        "url": os.environ.get("VERRA_VCS_API_URL", ""),
        "key": os.environ.get("VERRA_VCS_API_KEY", ""),
    },
]

# ── Registry schema adapters (#665) ──────────────────────────────────────────

class VerraVCSAdapter:
    """
    Normalises a Verra VCS API response to the canonical monitoring report schema.

    Verra field conventions (snake_case with vcs_ prefix):
        vcs_project_id, monitoring_period, net_ghg_reductions_tco2e,
        ipfs_cid, verifier_signature, additionality_statement,
        permanence_buffer_percentage
    """

    REQUIRED_FIELDS = [
        "vcs_project_id",
        "monitoring_period",
        "net_ghg_reductions_tco2e",
        "ipfs_cid",
        "verifier_signature",
    ]

    @classmethod
    def validate_raw(cls, raw: dict) -> list[str]:
        """Return list of validation errors; empty list means valid."""
        errors: list[str] = []
        for field in cls.REQUIRED_FIELDS:
            if not raw.get(field):
                errors.append(f"missing required field: {field}")
        if raw.get("net_ghg_reductions_tco2e", 0) <= 0:
            errors.append("net_ghg_reductions_tco2e must be > 0")
        cid = str(raw.get("ipfs_cid", ""))
        if not (cid.startswith("Qm") or cid.startswith("bafy")):
            errors.append(f"ipfs_cid does not look like a valid CID: {cid!r}")
        return errors

    @classmethod
    def normalise(cls, raw: dict) -> dict:
        """Map Verra VCS fields → canonical report fields."""
        return {
            "project_id":            raw.get("vcs_project_id", ""),
            "period":                raw.get("monitoring_period", ""),
            "tonnes_verified":       int(raw.get("net_ghg_reductions_tco2e", 0)),
            "satellite_cid":         raw.get("ipfs_cid", ""),
            "verifier_signature":    raw.get("verifier_signature", ""),
            "additionality_proof":   raw.get("additionality_statement", ""),
            "permanence_buffer":     raw.get("permanence_buffer_percentage"),
            "methodology":           "VCS",
            "_raw_registry":         "verra_vcs",
        }


class GoldStandardAdapter:
    """
    Normalises a Gold Standard API response to the canonical monitoring report schema.

    Gold Standard field conventions (camelCase):
        projectId, reportingPeriod, verifiedEmissionReductions,
        evidenceCid, auditorSignature, additionalityRationale,
        permanenceBuffer
    """

    REQUIRED_FIELDS = [
        "projectId",
        "reportingPeriod",
        "verifiedEmissionReductions",
        "evidenceCid",
        "auditorSignature",
    ]

    @classmethod
    def validate_raw(cls, raw: dict) -> list[str]:
        errors: list[str] = []
        for field in cls.REQUIRED_FIELDS:
            if not raw.get(field):
                errors.append(f"missing required field: {field}")
        if raw.get("verifiedEmissionReductions", 0) <= 0:
            errors.append("verifiedEmissionReductions must be > 0")
        cid = str(raw.get("evidenceCid", ""))
        if not (cid.startswith("Qm") or cid.startswith("bafy")):
            errors.append(f"evidenceCid does not look like a valid CID: {cid!r}")
        return errors

    @classmethod
    def normalise(cls, raw: dict) -> dict:
        return {
            "project_id":            raw.get("projectId", ""),
            "period":                raw.get("reportingPeriod", ""),
            "tonnes_verified":       int(raw.get("verifiedEmissionReductions", 0)),
            "satellite_cid":         raw.get("evidenceCid", ""),
            "verifier_signature":    raw.get("auditorSignature", ""),
            "additionality_proof":   raw.get("additionalityRationale", ""),
            "permanence_buffer":     raw.get("permanenceBuffer"),
            "methodology":           "Gold Standard",
            "_raw_registry":         "gold_standard",
        }


REGISTRY_ADAPTERS: dict[str, Any] = {
    "verra_vcs":    VerraVCSAdapter,
    "gold_standard": GoldStandardAdapter,
}


def adapt_and_validate_report(raw: dict, registry: str) -> tuple[dict | None, list[str]]:
    """
    Validate raw registry response against its schema, then normalise.

    Returns (normalised_report, errors).  If errors is non-empty the report
    should be rejected; normalised_report will be None.
    """
    adapter = REGISTRY_ADAPTERS.get(registry)
    if adapter is None:
        return None, [f"unknown registry: {registry!r}"]

    errors = adapter.validate_raw(raw)
    if errors:
        return None, errors

    return adapter.normalise(raw), []


# ── Redis / cache ─────────────────────────────────────────────────────────────

_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis
        kwargs: dict = {"decode_responses": True}
        if REDIS_PASSWORD:
            kwargs["password"] = REDIS_PASSWORD
        client = redis.from_url(REDIS_URL, **kwargs)
        client.ping()
        _redis_client = client
        log.info("Redis connected: %s", REDIS_URL)
    except Exception as exc:
        log.warning("Redis unavailable (%s) — cache disabled", exc)
        _redis_client = None
    return _redis_client


def _cache_key(project_id: str, period: str) -> str:
    safe = hashlib.sha256(f"{project_id}:{period}".encode()).hexdigest()[:16]
    return f"{CACHE_NS}{safe}"


def cache_get(project_id: str, period: str) -> dict | None:
    r = _get_redis()
    if r is None:
        return None
    try:
        raw = r.get(_cache_key(project_id, period))
        if raw is None:
            return None
        payload = json.loads(raw)
        age = time.time() - payload.get("_refreshed_at", 0)
        if age >= CACHE_STALE_SECONDS:
            log.info("Cache STALE for %s/%s (age=%.0fs)", project_id, period, age)
            return None
        return payload
    except Exception as exc:
        log.warning("Cache read error: %s", exc)
        return None


def cache_set(project_id: str, period: str, data: dict) -> bool:
    r = _get_redis()
    if r is None:
        return False
    try:
        payload = dict(data)
        payload["_refreshed_at"] = time.time()
        r.setex(_cache_key(project_id, period), CACHE_TTL_SECONDS, json.dumps(payload))
        return True
    except Exception as exc:
        log.warning("Cache write error: %s", exc)
        return False


def cache_invalidate(project_id: str, period: str) -> bool:
    r = _get_redis()
    if r is None:
        return False
    try:
        r.delete(_cache_key(project_id, period))
        return True
    except Exception as exc:
        log.warning("Cache invalidate error: %s", exc)
        return False


# ── SSE cursor persistence ────────────────────────────────────────────────────

def load_sse_cursor() -> str:
    """Load the last persisted SSE cursor from Redis, falling back to 'now'."""
    r = _get_redis()
    if r:
        try:
            cursor = r.get(SSE_CURSOR_KEY)
            if cursor:
                log.info("Resuming SSE stream from cursor %s", cursor)
                return cursor
        except Exception as exc:
            log.warning("Failed to load SSE cursor from Redis: %s", exc)
    return "now"


def save_sse_cursor(cursor: str) -> None:
    """Persist the current SSE cursor so we can resume after restart."""
    r = _get_redis()
    if r:
        try:
            r.set(SSE_CURSOR_KEY, cursor)
        except Exception as exc:
            log.warning("Failed to save SSE cursor: %s", exc)


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_db():
    return psycopg2.connect(DATABASE_URL)


def log_oracle_update(project_id: str, period: str, tonnes: int, score: int, tx_hash: str, status: str):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO oracle_updates
                    (project_id, period, tonnes_verified, methodology_score, tx_hash, status, submitted_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                (project_id, period, tonnes, score, tx_hash, status),
            )
        conn.commit()
        conn.close()
    except Exception as e:
        log.error("DB log failed: %s", e)


def fetch_verification_from_db(project_id: str, period: str) -> dict | None:
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT project_id, period, tonnes_verified, methodology_score,
                       tx_hash, status, submitted_at
                FROM oracle_updates
                WHERE project_id = %s AND period = %s AND status = 'SUBMITTED'
                ORDER BY submitted_at DESC LIMIT 1
                """,
                (project_id, period),
            )
            row = cur.fetchone()
        conn.close()
        if row is None:
            return None
        return {
            "project_id": row[0], "period": row[1],
            "tonnes_verified": row[2], "methodology_score": row[3],
            "tx_hash": row[4], "status": row[5],
            "submitted_at": row[6].isoformat() if row[6] else None,
        }
    except Exception as exc:
        log.error("DB fallback failed for %s/%s: %s", project_id, period, exc)
        return None


def get_verification_result(project_id: str, period: str) -> dict | None:
    cached = cache_get(project_id, period)
    if cached is not None:
        return cached
    db_result = fetch_verification_from_db(project_id, period)
    if db_result is not None:
        cache_set(project_id, period, db_result)
    return db_result


# ── Stellar helpers ───────────────────────────────────────────────────────────

def build_and_submit(server: SorobanServer, keypair: Keypair, contract_id: str,
                     function_name: str, args: list) -> str:
    account = server.load_account(keypair.public_key)
    tx = (
        TransactionBuilder(
            source_account=account,
            network_passphrase=NETWORK_PASSPHRASE,
            base_fee=300,
        )
        .append_invoke_contract_function_op(
            contract_id=contract_id,
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
            raise RuntimeError(f"Transaction FAILED: {result}")
    raise TimeoutError(f"Transaction {response.hash} not confirmed")


# ── Methodology scoring ───────────────────────────────────────────────────────

def validate_methodology_report(report: dict, methodology: str) -> tuple[bool, int]:
    """Score a normalised report 0-100. Returns (is_valid, score)."""
    score = 100
    for field in ["project_id", "period", "tonnes_verified", "satellite_cid", "verifier_signature"]:
        if not report.get(field):
            score -= 20
    if report.get("tonnes_verified", 0) <= 0:
        score -= 30
    if not str(report.get("satellite_cid", "")).startswith(("Qm", "bafy")):
        score -= 15
    if methodology in ("VCS", "Gold Standard"):
        if not report.get("additionality_proof"):
            score -= 10
        if not report.get("permanence_buffer"):
            score -= 5
    score = max(0, score)
    return score >= METHODOLOGY_SCORE_MIN, score


# ── Alert helper ──────────────────────────────────────────────────────────────

def alert_admin(message: str):
    if not ADMIN_ALERT_WEBHOOK:
        log.warning("ADMIN ALERT (no webhook): %s", message)
        return
    try:
        requests.post(ADMIN_ALERT_WEBHOOK, json={"text": message}, timeout=10)
    except Exception as e:
        log.error("Alert webhook failed: %s", e)


# ── Verifier API fetch ────────────────────────────────────────────────────────

def fetch_pending_reports(api: dict) -> list[dict]:
    if not api["url"]:
        return []
    try:
        resp = requests.get(
            f"{api['url']}/monitoring-reports/pending",
            headers={"Authorization": f"Bearer {api['key']}"},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("reports", [])
    except Exception as e:
        log.error("Failed to fetch from %s: %s", api["name"], e)
        return []


# ── Core processing (called on each ledger close) ─────────────────────────────

def process_reports():
    """Fetch pending reports from all registries, validate and submit on-chain."""
    log.info("Ledger close event — processing verification reports")
    server  = SorobanServer(STELLAR_RPC_URL)
    keypair = Keypair.from_secret(ORACLE_SECRET_KEY)

    for api in VERIFIER_APIS:
        raw_reports = fetch_pending_reports(api)
        log.info("Fetched %d raw reports from %s", len(raw_reports), api["name"])

        for raw in raw_reports:
            # Schema validation + normalisation (#665)
            report, errors = adapt_and_validate_report(raw, api["registry"])
            if errors:
                log.warning(
                    "Schema validation failed for %s report (project=%s): %s",
                    api["name"], raw.get("vcs_project_id") or raw.get("projectId", "?"),
                    "; ".join(errors),
                )
                alert_admin(
                    f"⚠️ Schema validation failure in {api['name']} report: {'; '.join(errors)}"
                )
                continue

            project_id  = report["project_id"]
            period      = report["period"]
            tonnes      = report["tonnes_verified"]
            sat_cid     = report["satellite_cid"]
            methodology = report["methodology"]

            # Skip already-submitted reports (cache check)
            cached = cache_get(project_id, period)
            if cached is not None and cached.get("status") == "SUBMITTED":
                log.info("Cache HIT — skipping already-submitted %s/%s", project_id, period)
                continue

            is_valid, score = validate_methodology_report(report, methodology)

            if score < METHODOLOGY_SCORE_MIN:
                msg = f"⚠️ Low methodology score {score}/100 for project {project_id} ({period})"
                log.warning(msg)
                alert_admin(msg)

            if not is_valid:
                log.warning("Skipping invalid report for %s / %s", project_id, period)
                log_oracle_update(project_id, period, tonnes, score, "", "SKIPPED_INVALID")
                cache_set(project_id, period, {
                    "project_id": project_id, "period": period,
                    "tonnes_verified": tonnes, "methodology_score": score,
                    "tx_hash": "", "status": "SKIPPED_INVALID",
                })
                continue

            try:
                tx_hash = build_and_submit(
                    server, keypair, ORACLE_CONTRACT_ID,
                    "submit_monitoring_data",
                    [
                        scval.to_address(keypair.public_key),
                        scval.to_string(project_id),
                        scval.to_string(period),
                        scval.to_int128(tonnes),
                        scval.to_uint32(score),
                        scval.to_string(sat_cid),
                    ],
                )
                log.info("Submitted %s/%s → tx %s", project_id, period, tx_hash)
                log_oracle_update(project_id, period, tonnes, score, tx_hash, "SUBMITTED")
                cache_invalidate(project_id, period)
                cache_set(project_id, period, {
                    "project_id": project_id, "period": period,
                    "tonnes_verified": tonnes, "methodology_score": score,
                    "tx_hash": tx_hash, "status": "SUBMITTED",
                    "submitted_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                log.error("Failed to submit for %s: %s", project_id, e)
                log_oracle_update(project_id, period, tonnes, score, "", f"ERROR: {e}")

    log.info("Verification processing complete")


# ── Stellar SSE ledger stream (#664) ──────────────────────────────────────────

def stream_ledgers():
    """
    Subscribe to Horizon's SSE ledger stream and call process_reports() on
    every ledger close.  Persists the cursor to Redis so restarts resume
    from where they left off without reprocessing old ledgers.
    """
    cursor = load_sse_cursor()
    url    = f"{HORIZON_URL}/ledgers?cursor={cursor}"
    log.info("Starting Stellar ledger SSE stream (cursor=%s)", cursor)

    backoff = 1
    while True:
        try:
            with requests.get(url, stream=True, timeout=90,
                              headers={"Accept": "text/event-stream"}) as resp:
                resp.raise_for_status()
                backoff = 1  # reset on successful connection
                log.info("SSE connection established")

                for line in resp.iter_lines():
                    if not line:
                        continue
                    line = line.decode("utf-8") if isinstance(line, bytes) else line

                    if line.startswith("data:"):
                        data_str = line[5:].strip()
                        if data_str == '"hello"' or not data_str:
                            continue
                        try:
                            ledger = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        new_cursor = ledger.get("paging_token") or str(ledger.get("sequence", ""))
                        if new_cursor:
                            # Process reports triggered by this ledger close
                            try:
                                process_reports()
                            except Exception as exc:
                                log.error("process_reports error on ledger %s: %s",
                                          ledger.get("sequence"), exc)

                            # Persist cursor after successful processing
                            save_sse_cursor(new_cursor)
                            url = f"{HORIZON_URL}/ledgers?cursor={new_cursor}"

        except requests.exceptions.RequestException as exc:
            log.error("SSE stream error: %s — reconnecting in %ds", exc, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
        except Exception as exc:
            log.error("Unexpected SSE error: %s — reconnecting in %ds", exc, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("Verification listener starting — event-driven Stellar ledger streaming")
    # Run initial cycle immediately so already-pending reports are not missed
    try:
        process_reports()
    except Exception as exc:
        log.error("Initial process_reports failed: %s", exc)

    stream_ledgers()
