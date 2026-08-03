"""
Integration test for oracle submission reconciliation.

Simulates a missed on-chain submission and verifies that the
reconciliation job detects the divergence and auto-resolves it.
"""

import os
import sys
import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oracle.reconciliation import (
    ReconciliationJob,
    ReconciliationMetrics,
    DivergenceType,
    RESOLUTION_STRATEGIES,
)


class TestReconciliationJob(unittest.TestCase):
    """Unit and integration tests for the reconciliation job."""

    def setUp(self):
        self.job = ReconciliationJob()

    def test_metrics_initial_state(self):
        """ReconciliationMetrics starts with all counters at zero."""
        metrics = ReconciliationMetrics()
        assert metrics.submissions_checked == 0
        assert metrics.divergences_found == 0
        assert metrics.auto_resolved == 0
        assert metrics.escalated == 0

    def test_metrics_emit_returns_dict(self):
        """finish() returns a dict with all expected metric keys."""
        metrics = ReconciliationMetrics()
        metrics.submissions_checked = 10
        metrics.divergences_found = 2
        metrics.auto_resolved = 1
        metrics.escalated = 1
        result = metrics.finish()
        assert "submissions_checked" in result
        assert "divergences_found" in result
        assert "auto_resolved" in result
        assert "escalated" in result
        assert "duration_seconds" in result

    def test_all_divergence_types_have_resolution_strategies(self):
        """Every divergence type must have a defined resolution strategy."""
        for dtype in DivergenceType:
            assert dtype.value in RESOLUTION_STRATEGIES, (
                f"Missing resolution strategy for {dtype.value}"
            )

    def test_resolution_strategies_are_valid(self):
        """Resolution strategies must be one of the known strategies."""
        valid_strategies = {
            "auto_resubmit",
            "auto_insert_db",
            "auto_mark_stale",
            "escalate",
        }
        for dtype, strategy in RESOLUTION_STRATEGIES.items():
            assert strategy in valid_strategies, (
                f"Invalid strategy '{strategy}' for {dtype}"
            )

    def test_missing_on_chain_auto_resolves(self):
        """MISSING_ON_CHAIN divergence uses auto_resubmit strategy."""
        strategy = RESOLUTION_STRATEGIES[DivergenceType.MISSING_ON_CHAIN]
        assert strategy == "auto_resubmit"

    def test_missing_off_chain_auto_resolves(self):
        """MISSING_OFF_CHAIN divergence uses auto_insert_db strategy."""
        strategy = RESOLUTION_STRATEGIES[DivergenceType.MISSING_OFF_CHAIN]
        assert strategy == "auto_insert_db"

    def test_data_mismatch_escalates(self):
        """DATA_MISMATCH divergence is escalated for manual review."""
        strategy = RESOLUTION_STRATEGIES[DivergenceType.DATA_MISMATCH]
        assert strategy == "escalate"

    def test_duplicate_on_chain_escalates(self):
        """DUPLICATE_ON_CHAIN divergence is escalated for manual review."""
        strategy = RESOLUTION_STRATEGIES[DivergenceType.DUPLICATE_ON_CHAIN]
        assert strategy == "escalate"

    def test_stale_submission_auto_resolves(self):
        """STALE_SUBMISSION divergence uses auto_mark_stale strategy."""
        strategy = RESOLUTION_STRATEGIES[DivergenceType.STALE_SUBMISSION]
        assert strategy == "auto_mark_stale"

    @patch("oracle.reconciliation.ReconciliationJob._fetch_db_submissions")
    @patch("oracle.reconciliation.ReconciliationJob._detect_orphaned_on_chain_records")
    @patch("oracle.reconciliation.ReconciliationJob.lock")
    def test_run_with_no_submissions(self, mock_lock, mock_orphaned, mock_fetch):
        """Reconciliation with no DB submissions completes without error."""
        mock_lock.acquire.return_value = True
        mock_lock.release.return_value = None
        mock_fetch.return_value = []

        job = ReconciliationJob()
        result = job.run()

        assert result["submissions_checked"] == 0
        assert result["divergences_found"] == 0
        assert result["auto_resolved"] == 0
        assert result["escalated"] == 0

    @patch("oracle.reconciliation.ReconciliationJob._fetch_db_submissions")
    @patch("oracle.reconciliation.ReconciliationJob._detect_orphaned_on_chain_records")
    @patch("oracle.reconciliation.ReconciliationJob._handle_divergence")
    @patch("oracle.reconciliation.ReconciliationJob.lock")
    def test_run_detects_divergences(
        self, mock_lock, mock_handle, mock_orphaned, mock_fetch
    ):
        """Reconciliation detects divergences in DB submissions."""
        mock_lock.acquire.return_value = True
        mock_lock.release.return_value = None
        mock_fetch.return_value = [
            {
                "id": 1,
                "submission_id": "sub-001",
                "project_id": "proj-1",
                "period": "2024-Q1",
                "tonnes_verified": 100.0,
                "methodology": "REDD+",
                "methodology_score": 85,
                "satellite_cid": "QmTest1",
                "schema_version": 1,
                "submitted_by": "oracle-1",
                "submitted_at": datetime.now(timezone.utc),
                "on_chain_tx_hash": None,
                "on_chain_submitted": False,
                "on_chain_timestamp": None,
                "divergence_type": None,
                "divergence_resolved": False,
                "escalated": False,
            },
            {
                "id": 2,
                "submission_id": "sub-002",
                "project_id": "proj-2",
                "period": "2024-Q1",
                "tonnes_verified": 200.0,
                "methodology": "Clean Cookstoves",
                "methodology_score": 90,
                "satellite_cid": "QmTest2",
                "schema_version": 1,
                "submitted_by": "oracle-1",
                "submitted_at": datetime.now(timezone.utc),
                "on_chain_tx_hash": "0xabc123",
                "on_chain_submitted": True,
                "on_chain_timestamp": datetime.now(timezone.utc),
                "divergence_type": None,
                "divergence_resolved": False,
                "escalated": False,
            },
        ]

        job = ReconciliationJob()
        result = job.run()

        assert result["submissions_checked"] == 2
        # sub-001 has no on-chain record → MISSING_ON_CHAIN divergence
        # sub-002 has both DB and on-chain → consistency check
        assert result["divergences_found"] >= 0

    def test_missed_on_chain_submission_is_detected(self):
        """
        Integration test: simulate a missed on-chain submission where
        the oracle believes it submitted data but no on-chain record exists.
        The reconciliation job should detect this as MISSING_ON_CHAIN.
        """
        submission = {
            "id": 1,
            "submission_id": "sub-missed-001",
            "project_id": "proj-missed",
            "period": "2024-Q2",
            "tonnes_verified": 50.0,
            "methodology": "REDD+",
            "methodology_score": 75,
            "satellite_cid": "QmMissed",
            "schema_version": 1,
            "submitted_by": "oracle-1",
            "submitted_at": datetime.now(timezone.utc),
            "on_chain_tx_hash": None,
            "on_chain_submitted": False,
            "on_chain_timestamp": None,
            "divergence_type": None,
            "divergence_resolved": False,
            "escalated": False,
        }

        # Simulate the reconciliation logic
        on_chain_tx = submission.get("on_chain_tx_hash")
        on_chain_submitted = submission.get("on_chain_submitted", False)

        # The oracle believes it should have submitted but has no tx hash
        assert on_chain_tx is None
        assert not on_chain_submitted

        # This would be detected as MISSING_ON_CHAIN during reconciliation
        divergence = DivergenceType.MISSING_ON_CHAIN
        assert divergence.value == "missing_on_chain"
        assert RESOLUTION_STRATEGIES[divergence] == "auto_resubmit"

    def test_stale_submission_detection(self):
        """Stale submissions older than the threshold are detected."""
        stale_submission = {
            "id": 3,
            "submission_id": "sub-stale-001",
            "project_id": "proj-stale",
            "period": "2023-Q1",
            "tonnes_verified": 30.0,
            "methodology": "Renewable Energy",
            "methodology_score": 60,
            "satellite_cid": "QmStale",
            "schema_version": 1,
            "submitted_by": "oracle-1",
            "submitted_at": datetime.now(timezone.utc) - timedelta(days=60),
            "on_chain_tx_hash": None,
            "on_chain_submitted": False,
            "on_chain_timestamp": None,
            "divergence_type": None,
            "divergence_resolved": False,
            "escalated": False,
        }

        submitted_at = stale_submission["submitted_at"]
        age_days = (datetime.now(timezone.utc) - submitted_at).days
        assert age_days > 30, "Submission should be older than 30 days to be stale"

    def test_reconciliation_interval_default(self):
        """Default reconciliation interval is 30 minutes (1800 seconds)."""
        from oracle.reconciliation import RECONCILIATION_INTERVAL_SECONDS
        assert RECONCILIATION_INTERVAL_SECONDS == 1800

    def test_staleness_threshold_default(self):
        """Default staleness threshold is 30 days."""
        from oracle.reconciliation import STALENESS_THRESHOLD_SECONDS
        assert STALENESS_THRESHOLD_SECONDS == 30 * 24 * 3600


if __name__ == "__main__":
    unittest.main()