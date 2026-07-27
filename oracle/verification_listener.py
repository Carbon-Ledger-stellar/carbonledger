"""
verification_listener.py

Polls accredited verifier APIs every 6 hours, validates monitoring reports
against Gold Standard / Verra VCS methodology requirements, and submits
verified data to the carbon_oracle Soroban contract.

Caching layer (closes #538)
────────────────────────────
Verification results are cached in Redis with a configurable TTL (default 1 h).
Cache is invalidated atomically when new oracle data is submitted on-chain.
Staleness is detected if the cache entry has not been refreshed in ≥ 6 hours.
On cache miss or staleness, the service falls back to the PostgreSQL database.
Write-through consistency is maintained so that all oracle instances sharing
the same Redis cluster see the same state.
"""

import os
import time
import json
import hashlib
import logging
import schedule
import psycopg2
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from stellar_sdk import Keypair, Network, SorobanServer, TransactionBuilder, scval
from stellar_sdk.soroban_rpc import SendTransactionStatus

load_dotenv()
from log import get_logger  # noqa: E402 — must come after load_dotenv

log = get_logger("verification_listener")

# ── Config ────────────────────────────────────────────────────────────────────

ORACLE_SECRET_KEY       = os.environ["ORACLE_SECRET_KEY"]
ORACLE_CONTRACT_ID      = os.environ["CARBON_ORACLE_CONTRACT_ID"]
REGISTRY_CONTRACT_ID    = os.environ["CARBON_REGISTRY_CONTRACT_ID"]
STELLAR_RPC_URL         = os.environ.get("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org")
NETWORK_PASSPHRASE      = os.environ.get("NETWORK_PASSPHRASE", Network.TESTNET_NETWORK_PASSPHRASE)
DATABASE_URL            = os.environ["DATABASE_URL"]
ADMIN_ALERT_WEBHOOK     = os.environ.get("ADMIN_ALERT_WEBHOOK", "")
METHODOLOGY_SCORE_MIN   = 70

# ── Redis / cache config ──────────────────────────────────────────────────────
REDIS_URL               = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
REDIS_PASSWORD          = os.environ.get("REDIS_PASSWORD", "")
# TTL for cached verification results (default: 1 hour)
CACHE_TTL_SECONDS       = int(os.environ.get("VERIFICATION_CACHE_TTL", "3600"))
# A cache entry is considered stale if it has not been refreshed in this many seconds
CACHE_STALE_SECONDS     = int(os.environ.get("VERIFICATION_CACHE_STALE", str(6 * 3600)))
# Redis key namespace
CACHE_NS                = "carbonledger:verification:"

VERIFIER_APIS = [
    {"name": "Gold Standard", "url": os.environ.get("GOLD_STANDARD_API_URL", ""), "key": os.environ.get("GOLD_STANDARD_API_KEY", "")},
    {"name": "Verra VCS",     "url": os.environ.get("VERRA_VCS_API_URL", ""),     "key": os.environ.get("VERRA_VCS_API_KEY", "")},
]

# ── Redis client (lazy initialisation) ───────────────────────────────────────

_redis_client = None


def _get_redis():
    """Return a lazily-initialised Redis client. Returns None if Redis is unavailable."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis  # imported here so the module loads even without redis installed
        kwargs = {"decode_responses": True}
        if REDIS_PASSWORD:
            kwargs["password"] = REDIS_PASSWORD
        client = redis.from_url(REDIS_URL, **kwargs)
        client.ping()
        _redis_client = client
        log.info("Redis connected: %s", REDIS_URL)
    except Exception as exc:
        log.warning("Redis unavailable (%s) — cache disabled, falling back to DB", exc)
        _redis_client = None
    return _redis_client


def _cache_key(project_id: str, period: str) -> str:
    """Deterministic Redis key for a (project_id, period) pair."""
    safe = hashlib.sha256(f"{project_id}:{period}".encode()).hexdigest()[:16]
    return f"{CACHE_NS}{safe}"


def _staleness_key(project_id: str, period: str) -> str:
    """Redis key for the staleness timestamp of a cache entry."""
    return _cache_key(project_id, period) + ":refreshed_at"


# ── Cache operations ──────────────────────────────────────────────────────────

def cache_get(project_id: str, period: str) -> dict | None:
    """
    Look up a cached verification result.

    Returns:
        dict  – cached payload if the entry exists AND is not stale.
        None  – on cache miss, Redis unavailable, or staleness detected.

    Staleness rule: if the entry's ``refreshed_at`` timestamp is more than
    CACHE_STALE_SECONDS ago, the entry is treated as a miss so the caller
    falls back to the database.
    """
    r = _get_redis()
    if r is None:
        return None
    try:
        key = _cache_key(project_id, period)
        raw = r.get(key)
        if raw is None:
            log.debug("Cache MISS for %s/%s", project_id, period)
            return None

        payload = json.loads(raw)

        # Staleness check: compare refreshed_at against now
        refreshed_at = payload.get("_refreshed_at", 0)
        age = time.time() - refreshed_at
        if age >= CACHE_STALE_SECONDS:
            log.info("Cache STALE for %s/%s (age=%.0fs >= %ds)", project_id, period, age, CACHE_STALE_SECONDS)
            return None

        log.debug("Cache HIT for %s/%s (age=%.0fs)", project_id, period, age)
        return payload
    except Exception as exc:
        log.warning("Cache read error for %s/%s: %s", project_id, period, exc)
        return None


def cache_set(project_id: str, period: str, data: dict) -> bool:
    """
    Write-through: store a verification result in Redis.

    The ``_refreshed_at`` field is injected to enable staleness detection.
    Sets the Redis TTL to CACHE_TTL_SECONDS.

    Returns True on success, False on failure (non-fatal).
    """
    r = _get_redis()
    if r is None:
        return False
    try:
        key = _cache_key(project_id, period)
        payload = dict(data)
        payload["_refreshed_at"] = time.time()
        r.setex(key, CACHE_TTL_SECONDS, json.dumps(payload))
        log.debug("Cache SET for %s/%s (ttl=%ds)", project_id, period, CACHE_TTL_SECONDS)
        return True
    except Exception as exc:
        log.warning("Cache write error for %s/%s: %s", project_id, period, exc)
        return False


def cache_invalidate(project_id: str, period: str) -> bool:
    """
    Atomically invalidate (delete) the cache entry for a (project_id, period).
    Called immediately after on-chain submission so subsequent reads fetch fresh data.

    Returns True on success, False on failure (non-fatal).
    """
    r = _get_redis()
    if r is None:
        return False
    try:
        key = _cache_key(project_id, period)
        deleted = r.delete(key)
        log.info("Cache INVALIDATED for %s/%s (deleted=%d)", project_id, period, deleted)
        return True
    except Exception as exc:
        log.warning("Cache invalidate error for %s/%s: %s", project_id, period, exc)
        return False


def cache_invalidate_all_for_project(project_id: str) -> int:
    """
    Invalidate all cache entries whose key matches a project (best-effort scan).
    Used when an entire project's oracle data is refreshed at once.

    Returns the number of keys deleted.
    """
    r = _get_redis()
    if r is None:
        return 0
    try:
        pattern = f"{CACHE_NS}*"
        count = 0
        for key in r.scan_iter(pattern):
            raw = r.get(key)
            if raw:
                try:
                    payload = json.loads(raw)
                    if payload.get("project_id") == project_id:
                        r.delete(key)
                        count += 1
                except Exception:
                    pass
        log.info("Cache batch-invalidated %d entries for project %s", count, project_id)
        return count
    except Exception as exc:
        log.warning("Cache batch invalidate error for project %s: %s", project_id, exc)
        return 0


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
    """
    Fallback: load the latest verification result for (project_id, period) from
    the PostgreSQL oracle_updates table.  Returns a dict or None if not found.
    """
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT project_id, period, tonnes_verified, methodology_score,
                       tx_hash, status, submitted_at
                FROM oracle_updates
                WHERE project_id = %s AND period = %s AND status = 'SUBMITTED'
                ORDER BY submitted_at DESC
                LIMIT 1
                """,
                (project_id, period),
            )
            row = cur.fetchone()
        conn.close()
        if row is None:
            return None
        return {
            "project_id":        row[0],
            "period":            row[1],
            "tonnes_verified":   row[2],
            "methodology_score": row[3],
            "tx_hash":           row[4],
            "status":            row[5],
            "submitted_at":      row[6].isoformat() if row[6] else None,
        }
    except Exception as exc:
        log.error("DB fallback fetch failed for %s/%s: %s", project_id, period, exc)
        return None


def get_verification_result(project_id: str, period: str) -> dict | None:
    """
    Public accessor: returns the latest verification result, using the cache
    first and falling back to the database on miss or staleness.

    Cache miss / stale path:
        1. Query PostgreSQL.
        2. If found, write-through to Redis (so next caller hits cache).
        3. Return the result.
    """
    cached = cache_get(project_id, period)
    if cached is not None:
        return cached

    log.info("Cache miss/stale for %s/%s — falling back to DB", project_id, period)
    db_result = fetch_verification_from_db(project_id, period)
    if db_result is not None:
        cache_set(project_id, period, db_result)  # write-through
    return db_result


# ── Stellar helpers ───────────────────────────────────────────────────────────

def build_and_submit(
    server: SorobanServer,
    keypair: Keypair,
    contract_id: str,
    function_name: str,
    args: list,
) -> str:
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

    raise TimeoutError(f"Transaction {response.hash} not confirmed in time")


# ── Methodology validation ────────────────────────────────────────────────────

def validate_methodology_report(report: dict, methodology: str) -> tuple[bool, int]:
    """
    Validate a monitoring report against Gold Standard / Verra VCS requirements.
    Returns (is_valid, methodology_score 0-100).
    """
    score = 100

    required = ["project_id", "period", "tonnes_verified", "satellite_cid", "verifier_signature"]
    for field in required:
        if not report.get(field):
            log.warning("Missing required field: %s", field)
            score -= 20

    if report.get("tonnes_verified", 0) <= 0:
        log.warning("Non-positive tonnes_verified for project %s", report.get("project_id"))
        score -= 30

    if not str(report.get("satellite_cid", "")).startswith("Qm"):
        score -= 15

    if methodology in ("VCS", "Gold Standard"):
        if not report.get("additionality_proof"):
            score -= 10
        if not report.get("permanence_buffer"):
            score -= 5

    score = max(0, score)
    return score >= METHODOLOGY_SCORE_MIN, score


# ── Core polling logic ────────────────────────────────────────────────────────

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


def alert_admin(message: str):
    if not ADMIN_ALERT_WEBHOOK:
        log.warning("ADMIN ALERT (no webhook): %s", message)
        return
    try:
        requests.post(ADMIN_ALERT_WEBHOOK, json={"text": message}, timeout=10)
    except Exception as e:
        log.error("Alert webhook failed: %s", e)


def process_reports():
    log.info("Starting verification listener poll cycle")
    server  = SorobanServer(STELLAR_RPC_URL)
    keypair = Keypair.from_secret(ORACLE_SECRET_KEY)

    for api in VERIFIER_APIS:
        reports = fetch_pending_reports(api)
        log.info("Fetched %d reports from %s", len(reports), api["name"])

        for report in reports:
            project_id  = report.get("project_id", "")
            period      = report.get("period", "")
            tonnes      = int(report.get("tonnes_verified", 0))
            sat_cid     = report.get("satellite_cid", "")
            methodology = report.get("methodology", "VCS")

            # ── Check cache before re-processing ────────────────────────────
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
                log.warning("Skipping invalid report for project %s period %s", project_id, period)
                log_oracle_update(project_id, period, tonnes, score, "", "SKIPPED_INVALID")
                # Cache the invalid result so we don't re-process next cycle
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
                log.info("Submitted monitoring data for %s/%s → tx %s", project_id, period, tx_hash)
                log_oracle_update(project_id, period, tonnes, score, tx_hash, "SUBMITTED")

                # ── Atomically invalidate stale cache, then write new result ─
                cache_invalidate(project_id, period)
                cache_set(project_id, period, {
                    "project_id":        project_id,
                    "period":            period,
                    "tonnes_verified":   tonnes,
                    "methodology_score": score,
                    "tx_hash":           tx_hash,
                    "status":            "SUBMITTED",
                    "submitted_at":      datetime.now(timezone.utc).isoformat(),
                })

            except Exception as e:
                log.error("Failed to submit monitoring data for %s: %s", project_id, e)
                log_oracle_update(project_id, period, tonnes, score, "", f"ERROR: {e}")

    log.info("Poll cycle complete")


# ── Scheduler ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("Verification listener starting — polling every 6 hours")
    process_reports()
    schedule.every(6).hours.do(process_reports)
    while True:
        schedule.run_pending()
        time.sleep(60)
