"""
verification_listener.py
Polls accredited verifier APIs every 6 hours, validates monitoring reports
against Gold Standard / Verra VCS methodology requirements, and submits
verified data to the carbon_oracle Soroban contract.
"""

import os
import time
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

VERIFIER_APIS = [
    {"name": "Gold Standard", "url": os.environ.get("GOLD_STANDARD_API_URL", ""), "key": os.environ.get("GOLD_STANDARD_API_KEY", "")},
    {"name": "Verra VCS",     "url": os.environ.get("VERRA_VCS_API_URL", ""),     "key": os.environ.get("VERRA_VCS_API_KEY", "")},
]

# ── DB helpers ────────────────────────────────────────────────────────────────

def get_db():
    return psycopg2.connect(DATABASE_URL)

def log_oracle_update(project_id: str, period: str, tonnes: int, score: int, tx_hash: str, status: str):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO oracle_updates (project_id, period, tonnes_verified, methodology_score, tx_hash, status, submitted_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                (project_id, period, tonnes, score, tx_hash, status),
            )
        conn.commit()
        conn.close()
    except Exception as e:
        log.error("DB log failed: %s", e)

# ── Stellar helpers ───────────────────────────────────────────────────────────

def build_and_submit(server: SorobanServer, keypair: Keypair, contract_id: str, function_name: str, args: list) -> str:
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

    # Poll for confirmation
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

    # Required fields
    required = ["project_id", "period", "tonnes_verified", "satellite_cid", "verifier_signature"]
    for field in required:
        if not report.get(field):
            log.warning("Missing required field: %s", field)
            score -= 20

    # Tonnes must be positive
    if report.get("tonnes_verified", 0) <= 0:
        log.warning("Non-positive tonnes_verified for project %s", report.get("project_id"))
        score -= 30

    # Satellite CID must be present (IPFS hash)
    if not str(report.get("satellite_cid", "")).startswith("Qm"):
        score -= 15

    # Methodology-specific checks
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
            project_id = report.get("project_id", "")
            period     = report.get("period", "")
            tonnes     = int(report.get("tonnes_verified", 0))
            sat_cid    = report.get("satellite_cid", "")
            methodology = report.get("methodology", "VCS")

            is_valid, score = validate_methodology_report(report, methodology)

            if score < METHODOLOGY_SCORE_MIN:
                msg = f"⚠️ Low methodology score {score}/100 for project {project_id} ({period})"
                log.warning(msg)
                alert_admin(msg)

            if not is_valid:
                log.warning("Skipping invalid report for project %s period %s", project_id, period)
                log_oracle_update(project_id, period, tonnes, score, "", "SKIPPED_INVALID")
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

            except Exception as e:
                log.error("Failed to submit monitoring data for %s: %s", project_id, e)
                log_oracle_update(project_id, period, tonnes, score, "", f"ERROR: {e}")

    log.info("Poll cycle complete")

# ── Scheduler ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("Verification listener starting — polling every 6 hours")
    process_reports()  # Run immediately on start
    schedule.every(6).hours.do(process_reports)
    while True:
        schedule.run_pending()
        time.sleep(60)
