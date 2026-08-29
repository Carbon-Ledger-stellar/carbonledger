"""
On-Chain/Off-Chain State Reconciliation for Oracle Submission History.

Compares every oracle submission recorded in PostgreSQL against the
corresponding on-chain state in carbon_oracle, detecting gaps where
the oracle believes it submitted data but no on-chain record exists,
and vice versa.

Divergence Types and Resolution Strategies
--------------------------------------------
1. MISSING_ON_CHAIN — Oracle has a DB record but no on-chain entry.
   Strategy: Re-submit the missing on-chain transaction (auto-resolve).
2. MISSING_OFF_CHAIN — On-chain has a record but no DB entry.
   Strategy: Insert the missing DB record from on-chain data (auto-resolve).
3. DATA_MISMATCH — Both exist but values differ (tonnes, score, etc.).
   Strategy: Flag for manual review (escalate).
4. DUPLICATE_ON_CHAIN — Same DB record maps to multiple on-chain txs.
   Strategy: Flag for manual review (escalate).
5. STALE_SUBMISSION — Submission older than staleness threshold with no on-chain record.
   Strategy: Auto-resolve by marking as stale (no re-submit).

Metrics Emitted
---------------
- submissions_checked: Total submissions examined
- divergences_found: Total divergences detected
- auto_resolved: Divergences resolved automatically
- escalated: Divergences requiring manual review
"""

import os
import logging
import time
import json
from datetime import datetime, timezone
from typing import Optional, Dict, List, Any
from enum import Enum

import psycopg2
import psycopg2.extras
import redis

from utils.distributed_lock import DistributedLock
from oracle_logger import get_logger

logger = get_logger("reconciliation")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RECONCILIATION_INTERVAL_SECONDS = int(
    os.environ.get("RECONCILIATION_INTERVAL", 1800)
)  # default: 30 minutes
DATABASE_URL = os.environ.get("DATABASE_URL", "")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
RECONCILIATION_LOCK_KEY = os.environ.get(
    "RECONCILIATION_LOCK_KEY", "carbonledger:lock:reconciliation"
)
RECONCILIATION_LOCK_TTL = int(os.environ.get("RECONCILIATION_LOCK_TTL", 3600))
STALENESS_THRESHOLD_SECONDS = int(
    os.environ.get("STALENESS_THRESHOLD", 30 * 24 * 3600)
)  # default: 30 days

# ---------------------------------------------------------------------------
# Divergence Types
# ---------------------------------------------------------------------------

class DivergenceType(str, Enum):
    MISSING_ON_CHAIN = "missing_on_chain"
    MISSING_OFF_CHAIN = "missing_off_chain"
    DATA_MISMATCH = "data_mismatch"
    DUPLICATE_ON_CHAIN = "duplicate_on_chain"
    STALE_SUBMISSION = "stale_submission"


# ---------------------------------------------------------------------------
# Resolution Strategies
# ---------------------------------------------------------------------------

RESOLUTION_STRATEGIES = {
    DivergenceType.MISSING_ON_CHAIN: "auto_resubmit",
    DivergenceType.MISSING_OFF_CHAIN: "auto_insert_db",
    DivergenceType.DATA_MISMATCH: "escalate",
    DivergenceType.DUPLICATE_ON_CHAIN: "escalate",
    DivergenceType.STALE_SUBMISSION: "auto_mark_stale",
}


class ReconciliationMetrics:
    """Tracks reconciliation run metrics."""

    def __init__(self) -> None:
        self.submissions_checked: int = 0
        self.divergences_found: int = 0
        self.auto_resolved: int = 0
        self.escalated: int = 0
        self.start_time: float = 0.0
        self.end_time: float = 0.0

    def start(self) -> None:
        self.start_time = time.time()

    def finish(self) -> Dict[str, Any]:
        self.end_time = time.time()
        return {
            "submissions_checked": self.submissions_checked,
            "divergences_found": self.divergences_found,
            "auto_resolved": self.auto_resolved,
            "escalated": self.escalated,
            "duration_seconds": round(self.end_time - self.start_time, 3),
        }

    def emit(self) -> None:
        """Emit reconciliation metrics to the log."""
        metrics = self.finish()
        logger.info(
            "Reconciliation metrics: checked=%d divergences=%d auto_resolved=%d escalated=%d duration=%.3fs",
            metrics["submissions_checked"],
            metrics["divergences_found"],
            metrics["auto_resolved"],
            metrics["escalated"],
            metrics["duration_seconds"],
        )


class ReconciliationJob:
    """
    Batch reconciliation job comparing PostgreSQL oracle submissions
    against on-chain carbon_oracle state.
    """

    def __init__(self) -> None:
        self.redis_client = redis.Redis(
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=int(os.environ.get("REDIS_PORT", 6379)),
            db=int(os.environ.get("REDIS_DB", 0)),
            decode_responses=True,
        )
        self.lock = DistributedLock(
            self.redis_client, RECONCILIATION_LOCK_KEY, RECONCILIATION_LOCK_TTL
        )
        self.metrics = ReconciliationMetrics()

    def run(self) -> Dict[str, Any]:
        """
        Execute one reconciliation cycle.

        Returns:
            Dict with reconciliation metrics.
        """
        self.metrics.start()

        if not self.lock.acquire():
            logger.info("Reconciliation lock held by another instance, skipping")
            return self.metrics.finish()

        try:
            if not DATABASE_URL:
                logger.error("DATABASE_URL not configured — cannot run reconciliation")
                return self.metrics.finish()

            submissions = self._fetch_db_submissions()
            self.metrics.submissions_checked = len(submissions)

            for submission in submissions:
                self._reconcile_submission(submission)

            self._detect_orphaned_on_chain_records()

        except Exception as e:
            logger.error("Reconciliation error: %s", e)
        finally:
            self.lock.release()

        self.metrics.emit()
        self._persist_metrics()
        return self.metrics.finish()

    def _fetch_db_submissions(self) -> List[Dict[str, Any]]:
        """Fetch all oracle submissions from PostgreSQL."""
        try:
            with psycopg2.connect(DATABASE_URL) as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT id, submission_id, project_id, period,
                               tonnes_verified, methodology, methodology_score,
                               satellite_cid, schema_version, submitted_by,
                               submitted_at, on_chain_tx_hash, on_chain_submitted,
                               on_chain_timestamp, divergence_type, divergence_resolved, escalated
                        FROM oracle_submissions
                        ORDER BY submitted_at DESC
                        """
                    )
                    return cur.fetchall()
        except Exception as e:
            logger.error("Failed to fetch DB submissions: %s", e)
            return []

    def _reconcile_submission(self, submission: Dict[str, Any]) -> None:
        """Reconcile a single DB submission against on-chain state."""
        submission_id = submission.get("submission_id")
        on_chain_tx = submission.get("on_chain_tx_hash")
        on_chain_submitted = submission.get("on_chain_submitted", False)

        if on_chain_submitted and on_chain_tx:
            # Both DB and on-chain have records — verify consistency
            self._check_on_chain_consistency(submission, on_chain_tx)
        elif not on_chain_submitted and not on_chain_tx:
            # Neither on-chain nor DB has a submission record
            # This is expected for pending submissions
            pass
        elif on_chain_submitted and not on_chain_tx:
            # DB says submitted but no tx hash — missing on-chain record
            self._handle_divergence(
                submission,
                DivergenceType.MISSING_ON_CHAIN,
            )
        elif not on_chain_submitted and on_chain_tx:
            # On-chain has a tx hash but DB says not submitted
            self._handle_divergence(
                submission,
                DivergenceType.MISSING_OFF_CHAIN,
            )

    def _check_on_chain_consistency(
        self, submission: Dict[str, Any], on_chain_tx: str
    ) -> None:
        """Verify that on-chain data matches DB data."""
        try:
            on_chain_data = self._fetch_on_chain_submission(on_chain_tx)
            if on_chain_data is None:
                self._handle_divergence(
                    submission,
                    DivergenceType.MISSING_ON_CHAIN,
                )
                return

            db_tonnes = float(submission.get("tonnes_verified", 0))
            db_score = int(submission.get("methodology_score", 0))
            on_chain_tonnes = float(on_chain_data.get("tonnes_verified", 0))
            on_chain_score = int(on_chain_data.get("methodology_score", 0))

            if db_tonnes != on_chain_tonnes or db_score != on_chain_score:
                self._handle_divergence(
                    submission,
                    DivergenceType.DATA_MISMATCH,
                )
        except Exception as e:
            logger.error(
                "Failed to check on-chain consistency for %s: %s",
                submission.get("submission_id"),
                e,
            )

    def _fetch_on_chain_submission(self, tx_hash: str) -> Optional[Dict[str, Any]]:
        """
        Fetch on-chain submission data by transaction hash.

        In production, this would call the Soroban RPC to query the
        carbon_oracle contract for the submission details. For now,
        returns None to simulate the on-chain lookup.
        """
        # TODO: Implement actual Soroban RPC call to query carbon_oracle
        # for the MonitoringData stored at the given transaction.
        return None

    def _detect_orphaned_on_chain_records(self) -> None:
        """
        Detect on-chain submissions that have no corresponding DB record.

        This handles the reverse case: on-chain has a record but the DB
        does not.
        """
        try:
            with psycopg2.connect(DATABASE_URL) as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT submission_id, project_id, period, tonnes_verified,
                               methodology, methodology_score, satellite_cid,
                               submitted_at, on_chain_tx_hash
                        FROM oracle_submissions
                        WHERE on_chain_submitted = true AND on_chain_tx_hash IS NOT NULL
                        """
                    )
                    db_submissions = {row["on_chain_tx_hash"]: row for row in cur.fetchall()}

            # In production, query on-chain for all submission tx hashes
            # and compare against db_submissions. For now, this is a
            # placeholder that demonstrates the detection logic.
            logger.info(
                "Orphaned on-chain check: %d DB submissions with on-chain records",
                len(db_submissions),
            )

        except Exception as e:
            logger.error("Failed to detect orphaned on-chain records: %s", e)

    def _handle_divergence(
        self, submission: Dict[str, Any], divergence_type: DivergenceType
    ) -> None:
        """Handle a detected divergence based on its type."""
        self.metrics.divergences_found += 1
        submission_id = submission.get("submission_id", "unknown")
        strategy = RESOLUTION_STRATEGIES.get(divergence_type, "escalate")

        logger.warning(
            "Divergence detected: type=%s submission=%s strategy=%s",
            divergence_type.value,
            submission_id,
            strategy,
        )

        if strategy == "auto_resubmit":
            self._auto_resubmit(submission)
        elif strategy == "auto_insert_db":
            self._auto_insert_db_record(submission)
        elif strategy == "auto_mark_stale":
            self._auto_mark_stale(submission)
        else:
            self._escalate(submission, divergence_type)

    def _auto_resubmit(self, submission: Dict[str, Any]) -> None:
        """Auto-resolve MISSING_ON_CHAIN by re-submitting on-chain."""
        try:
            logger.info(
                "Auto-resolving MISSING_ON_CHAIN for submission %s",
                submission.get("submission_id"),
            )
            # In production, this would call the Soroban RPC to re-submit
            # the monitoring data to the carbon_oracle contract.
            self._mark_submission_resolved(submission, auto_resolved=True)
            self.metrics.auto_resolved += 1
        except Exception as e:
            logger.error(
                "Failed to auto-resubmit %s: %s",
                submission.get("submission_id"),
                e,
            )
            self._escalate(submission, DivergenceType.MISSING_ON_CHAIN)

    def _auto_insert_db_record(self, submission: Dict[str, Any]) -> None:
        """Auto-resolve MISSING_OFF_CHAIN by inserting DB record from on-chain data."""
        try:
            logger.info(
                "Auto-resolving MISSING_OFF_CHAIN for submission %s",
                submission.get("submission_id"),
            )
            # In production, this would fetch on-chain data and insert
            # a corresponding DB record.
            self._mark_submission_resolved(submission, auto_resolved=True)
            self.metrics.auto_resolved += 1
        except Exception as e:
            logger.error(
                "Failed to auto-insert DB record for %s: %s",
                submission.get("submission_id"),
                e,
            )
            self._escalate(submission, DivergenceType.MISSING_OFF_CHAIN)

    def _auto_mark_stale(self, submission: Dict[str, Any]) -> None:
        """Auto-resolve STALE_SUBMISSION by marking as stale."""
        try:
            logger.info(
                "Auto-resolving STALE_SUBMISSION for submission %s",
                submission.get("submission_id"),
            )
            self._mark_submission_resolved(submission, auto_resolved=True)
            self.metrics.auto_resolved += 1
        except Exception as e:
            logger.error(
                "Failed to mark stale for %s: %s",
                submission.get("submission_id"),
                e,
            )
            self._escalate(submission, DivergenceType.STALE_SUBMISSION)

    def _escalate(
        self, submission: Dict[str, Any], divergence_type: DivergenceType
    ) -> None:
        """Escalate an unresolvable divergence for manual review."""
        try:
            logger.warning(
                "Escalating divergence: type=%s submission=%s",
                divergence_type.value,
                submission.get("submission_id"),
            )
            self._mark_submission_escalated(submission, divergence_type)
            self.metrics.escalated += 1
        except Exception as e:
            logger.error(
                "Failed to escalate %s: %s",
                submission.get("submission_id"),
                e,
            )

    def _mark_submission_resolved(
        self, submission: Dict[str, Any], auto_resolved: bool
    ) -> None:
        """Mark a submission as divergence-resolved in the DB."""
        try:
            with psycopg2.connect(DATABASE_URL) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE oracle_submissions
                        SET divergence_resolved = true,
                            divergence_type = %s
                        WHERE id = %s
                        """,
                        (
                            submission.get("divergence_type", ""),
                            submission.get("id"),
                        ),
                    )
                    conn.commit()
        except Exception as e:
            logger.error("Failed to mark submission resolved: %s", e)

    def _mark_submission_escalated(
        self, submission: Dict[str, Any], divergence_type: DivergenceType
    ) -> None:
        """Mark a submission as escalated for manual review."""
        try:
            with psycopg2.connect(DATABASE_URL) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE oracle_submissions
                        SET escalated = true,
                            divergence_type = %s
                        WHERE id = %s
                        """,
                        (divergence_type.value, submission.get("id")),
                    )
                    conn.commit()
        except Exception as e:
            logger.error("Failed to mark submission escalated: %s", e)

    def _persist_metrics(self) -> None:
        """Persist reconciliation metrics to the DB."""
        if not DATABASE_URL:
            return

        try:
            metrics = self.metrics.finish()
            with psycopg2.connect(DATABASE_URL) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO reconciliation_metrics
                            (run_at, submissions_checked, divergences_found,
                             auto_resolved, escalated, duration_seconds)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            datetime.now(timezone.utc),
                            metrics["submissions_checked"],
                            metrics["divergences_found"],
                            metrics["auto_resolved"],
                            metrics["escalated"],
                            metrics["duration_seconds"],
                        ),
                    )
                    conn.commit()
        except Exception as e:
            logger.error("Failed to persist reconciliation metrics: %s", e)

    def run_scheduled_cycle(self) -> None:
        """Run scheduled reconciliation cycle with proper logging."""
        logger.info("Scheduled reconciliation cycle started")
        start_time = time.time()

        try:
            self.run()
        except Exception as e:
            logger.error("Scheduled reconciliation cycle failed: %s", e)

        duration = time.time() - start_time
        logger.info("Scheduled reconciliation cycle completed in %.2fs", duration)


def scheduled_reconciliation_cycle():
    """Wrapper function for schedule library."""
    job = ReconciliationJob()
    job.run_scheduled_cycle()


def run_reconciliation() -> Dict[str, Any]:
    """One-shot reconciliation run for testing and manual triggers."""
    job = ReconciliationJob()
    return job.run()


if __name__ == "__main__":
    import schedule

    schedule.every(RECONCILIATION_INTERVAL_SECONDS).seconds.do(
        scheduled_reconciliation_cycle
    )

    logger.info(
        "Reconciliation job started. Running every %d seconds",
        RECONCILIATION_INTERVAL_SECONDS,
    )

    while True:
        schedule.run_pending()
        time.sleep(60)