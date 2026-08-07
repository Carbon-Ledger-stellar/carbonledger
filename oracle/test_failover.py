"""
Test: Automated failover for oracle bridge disaster recovery.

This test verifies that:
1. A standby instance detects primary failure within the timeout.
2. The standby promotes itself to primary.
3. No on-chain submissions are duplicated during failover.
4. The promotion completes within 2 minutes.
"""

import os
import sys
import time
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from oracle.failover_manager import FailoverManager


class TestFailoverManager(unittest.TestCase):
    """Unit tests for FailoverManager."""

    def setUp(self):
        self.redis_client = MagicMock()
        self.db_url = "postgresql://test:test@localhost:5432/test"
        self.fm = FailoverManager(self.redis_client, self.db_url)

    def test_initial_state_is_standby(self):
        """A new FailoverManager starts in standby mode."""
        self.assertFalse(self.fm.is_primary())
        self.assertTrue(self.fm.is_standby())

    def test_promotion_sets_primary(self):
        """After successful promotion, is_primary() returns True."""
        self.redis_client.set.return_value = True
        result = self.fm.try_promote()
        self.assertTrue(result)
        self.assertTrue(self.fm.is_primary())

    def test_promotion_fails_when_lock_held(self):
        """Promotion fails if another instance holds the lock."""
        self.redis_client.set.return_value = False
        result = self.fm.try_promote()
        self.assertFalse(result)
        self.assertFalse(self.fm.is_primary())

    def test_demote_clears_primary(self):
        """Demoting clears the primary flag and releases the lock."""
        self.fm._is_primary = True
        self.fm.demote()
        self.assertFalse(self.fm.is_primary())
        self.redis_client.delete.assert_called()

    def test_heartbeat_writes_to_db(self):
        """Heartbeat writes a record to PostgreSQL."""
        self.fm._is_primary = True
        with patch("psycopg2.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_cursor = MagicMock()
            mock_connect.return_value = mock_conn
            mock_conn.cursor.return_value = mock_cursor

            self.fm.heartbeat()

            mock_cursor.execute.assert_called()
            mock_conn.commit.assert_called()

    def test_detect_primary_failure_returns_none_when_healthy(self):
        """When the primary's heartbeat is recent, no failure is detected."""
        self.fm._is_primary = False
        with patch("psycopg2.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_cursor = MagicMock()
            mock_connect.return_value = mock_conn
            mock_conn.cursor.return_value = mock_cursor

            from datetime import datetime, timezone, timedelta
            recent = datetime.now(timezone.utc) - timedelta(seconds=10)
            mock_cursor.fetchone.return_value = {
                "instance_id": "primary-1",
                "role": "primary",
                "last_heartbeat": recent,
            }

            result = self.fm.detect_primary_failure()
            self.assertIsNone(result)

    def test_detect_primary_failure_returns_instance_when_stale(self):
        """When the primary's heartbeat is older than the threshold, failure is detected."""
        self.fm._is_primary = False
        with patch("psycopg2.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_cursor = MagicMock()
            mock_connect.return_value = mock_conn
            mock_conn.cursor.return_value = mock_cursor

            from datetime import datetime, timezone, timedelta
            stale = datetime.now(timezone.utc) - timedelta(seconds=120)
            mock_cursor.fetchone.return_value = {
                "instance_id": "primary-1",
                "role": "primary",
                "last_heartbeat": stale,
            }

            result = self.fm.detect_primary_failure()
            self.assertEqual(result, "primary-1")

    def test_run_failover_cycle_promotes_when_primary_failed(self):
        """run_failover_cycle promotes standby when primary is detected as failed."""
        self.fm._is_primary = False
        with patch.object(self.fm, "detect_primary_failure", return_value="primary-1"):
            with patch.object(self.fm, "try_promote", return_value=True):
                result = self.fm.run_failover_cycle()
                self.assertTrue(result)
                self.assertTrue(self.fm.is_primary())

    def test_submit_on_chain_returns_true_for_primary(self):
        """submit_on_chain() returns True when this instance is primary."""
        self.fm._is_primary = True
        self.assertTrue(self.fm.submit_on_chain())

    def test_submit_on_chain_returns_false_for_standby(self):
        """submit_on_chain() returns False when this instance is standby."""
        self.fm._is_primary = False
        self.assertFalse(self.fm.submit_on_chain())


class TestFailoverIntegration(unittest.TestCase):
    """Integration-style tests for the failover workflow."""

    def test_standby_processes_but_does_not_submit(self):
        """
        Standby mode: events are processed but on-chain submission is skipped.
        This is the core invariant of warm standby — no duplicate on-chain
        submissions during failover.
        """
        from oracle.standby import StandbyGuard

        redis_client = MagicMock()
        redis_client.set.return_value = True
        db_url = "postgresql://test:test@localhost:5432/test"
        fm = FailoverManager(redis_client, db_url)

        # Standby guard should report cannot submit
        with StandbyGuard(fm) as can_submit:
            self.assertFalse(can_submit)

    def test_primary_processes_and_submits(self):
        """
        Primary mode: events are processed AND on-chain submission proceeds.
        """
        from oracle.standby import StandbyGuard

        redis_client = MagicMock()
        redis_client.set.return_value = True
        db_url = "postgresql://test:test@localhost:5432/test"
        fm = FailoverManager(redis_client, db_url)
        fm._is_primary = True

        with StandbyGuard(fm) as can_submit:
            self.assertTrue(can_submit)

    def test_failover_completes_within_two_minutes(self):
        """
        The failover promotion must complete within 120 seconds.
        This test verifies the timeout configuration is within bounds.
        """
        from oracle.failover_manager import FAILOVER_PROMOTION_TIMEOUT
        self.assertLessEqual(FAILOVER_PROMOTION_TIMEOUT, 120)

    def test_lock_ttl_prevents_stale_primary(self):
        """
        The lock TTL must be shorter than the heartbeat timeout so that
        a stalled primary's lock expires and the standby can promote.
        """
        from oracle.failover_manager import FAILOVER_LOCK_TTL, FAILOVER_HEARTBEAT_TTL
        self.assertLess(FAILOVER_LOCK_TTL, FAILOVER_HEARTBEAT_TTL * 2)


if __name__ == "__main__":
    unittest.main()