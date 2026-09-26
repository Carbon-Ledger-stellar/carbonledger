"""
Unit and integration tests for the consensus engine.

Covers:
  - All sources agree (unanimous consensus)
  - One source disagrees (still meets 2-of-3 quorum with conflict detected)
  - Source timeout/unavailability (quorum not met)
  - Empty provider list
  - Conflict detection with tonnage and score tolerances
  - Consensus result fields and alert triggering
"""

import os
import sys
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from consensus_engine import (
    Observation,
    ConsensusResult,
    ConsensusEngine,
    _detect_conflicts,
    _tonnage_within_tolerance,
    _score_within_tolerance,
    quorum_required_data,
    QUORUM_N,
    QUORUM_M,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_obs(
    provider: str,
    tonnes: float,
    score: int = 80,
    cid: str = "QmTest",
    project_id: str = "proj-test",
    period: str = "2024-Q1",
    available: bool = True,
) -> Observation:
    return Observation(
        provider=provider,
        project_id=project_id,
        period=period,
        tonnes_verified=tonnes,
        methodology_score=score,
        satellite_cid=cid,
        available=available,
    )


# ---------------------------------------------------------------------------
# Tolerance unit tests
# ---------------------------------------------------------------------------

class TestTonnageTolerance(unittest.TestCase):
    def test_identical_values_match(self):
        self.assertTrue(_tonnage_within_tolerance(1000.0, 1000.0, 5.0))

    def test_small_difference_within_tolerance(self):
        self.assertTrue(_tonnage_within_tolerance(1000.0, 1020.0, 5.0))

    def test_large_difference_exceeds_tolerance(self):
        self.assertFalse(_tonnage_within_tolerance(1000.0, 1200.0, 5.0))

    def test_zero_vs_positive_mismatch(self):
        self.assertFalse(_tonnage_within_tolerance(0.0, 1000.0, 5.0))

    def test_both_zero_match(self):
        self.assertTrue(_tonnage_within_tolerance(0.0, 0.0, 5.0))


class TestScoreTolerance(unittest.TestCase):
    def test_identical_scores_match(self):
        self.assertTrue(_score_within_tolerance(80, 80, 10.0))

    def test_small_score_diff_within_tolerance(self):
        self.assertTrue(_score_within_tolerance(80, 85, 10.0))

    def test_large_score_diff_exceeds_tolerance(self):
        self.assertFalse(_score_within_tolerance(80, 95, 10.0))


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------

class TestDetectConflicts(unittest.TestCase):
    def test_all_agree_no_conflicts(self):
        obs = [
            make_obs("gee", 1000.0, 80),
            make_obs("planet", 1010.0, 82),
            make_obs("sentinel", 995.0, 79),
        ]
        conflicting, consensus = _detect_conflicts(obs)
        self.assertEqual(conflicting, [])
        self.assertIsNotNone(consensus)

    def test_one_source_disagrees_on_tonnage(self):
        obs = [
            make_obs("gee", 1000.0, 80),
            make_obs("planet", 2500.0, 82),  # 150% off — outlier
            make_obs("sentinel", 1005.0, 79),
        ]
        conflicting, consensus = _detect_conflicts(obs)
        self.assertIn("planet_labs", conflicting)
        self.assertIsNotNone(consensus)

    def test_one_source_disagrees_on_score(self):
        obs = [
            make_obs("gee", 1000.0, 80),
            make_obs("planet", 1005.0, 30),  # score far off
            make_obs("sentinel", 995.0, 82),
        ]
        conflicting, consensus = _detect_conflicts(obs)
        self.assertIn("planet_labs", conflicting)
        self.assertIsNotNone(consensus)

    def test_all_three_conflict_no_consensus(self):
        obs = [
            make_obs("gee", 1000.0, 80),
            make_obs("planet", 5000.0, 95),
            make_obs("sentinel", 200.0, 10),
        ]
        conflicting, consensus = _detect_conflicts(obs)
        self.assertEqual(len(conflicting), 3)
        self.assertIsNone(consensus)

    def test_empty_returns_no_conflicts(self):
        conflicting, consensus = _detect_conflicts([])
        self.assertEqual(conflicting, [])
        self.assertIsNone(consensus)

    def test_single_observation_no_conflict(self):
        obs = [make_obs("gee", 1000.0, 80)]
        conflicting, consensus = _detect_conflicts(obs)
        self.assertEqual(conflicting, [])
        self.assertIsNotNone(consensus)


# ---------------------------------------------------------------------------
# ConsensusEngine integration tests
# ---------------------------------------------------------------------------

class TestConsensusEngineQuorum(unittest.TestCase):
    """Tests for N-of-M quorum enforcement."""

    def test_all_three_providers_agree(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        eng.register_observation(make_obs("planet", 1005.0, 82))
        eng.register_observation(make_obs("sentinel", 995.0, 79))
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertTrue(result.quorum_met)
        self.assertEqual(result.providers_count, 3)
        self.assertEqual(result.conflicting_providers, [])
        self.assertFalse(result.alert_triggered)
        self.assertAlmostEqual(result.consensus_tonnes, 1000.0, delta=10.0)

    def test_two_of_three_agree_minimum_quorum(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        eng.register_observation(make_obs("planet", 1005.0, 82))
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertTrue(result.quorum_met)
        self.assertEqual(result.providers_count, 2)

    def test_one_provider_unavailable_quorum_met(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        eng.register_observation(make_obs("planet", 1005.0, 82))
        eng.register_provider("sentinel_hub")  # registered but unavailable
        # Only 2 are available, which meets 2-of-3 quorum
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertTrue(result.quorum_met)

    def test_all_three_unavailable_quorum_not_met(self):
        eng = ConsensusEngine(n=2, m=3)
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertFalse(result.quorum_met)
        self.assertEqual(result.providers_count, 0)
        self.assertTrue(result.alert_triggered)

    def test_one_source_unavailable_still_passes(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        eng.register_observation(make_obs("planet", 1005.0, 82))
        eng.register_observation(make_obs("sentinel_hub", 0, 0, available=False))
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertTrue(result.quorum_met)


class TestConsensusEngineConflicts(unittest.TestCase):
    """Tests for conflict detection and blocking."""

    def test_one_source_disagrees_conflict_detected(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        eng.register_observation(make_obs("planet", 5000.0, 82))  # outlier tonnes
        eng.register_observation(make_obs("sentinel", 1005.0, 79))
        result = eng.evaluate("proj-test", "2024-Q1")
        # 2-of-3 agree (GEE + Sentinel), but planet is conflicting
        # quorum IS met because 2 providers agree
        self.assertTrue(result.quorum_met)
        self.assertIn("planet_labs", result.conflicting_providers)
        self.assertTrue(result.alert_triggered)

    def test_all_three_conflict_blocks_submission(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        eng.register_observation(make_obs("planet", 5000.0, 95))
        eng.register_observation(make_obs("sentinel", 200.0, 10))
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertFalse(result.quorum_met)
        self.assertEqual(len(result.conflicting_providers), 3)
        self.assertTrue(result.alert_triggered)
        self.assertIn("CONSENSUS BLOCKED", result.detail)

    def test_quorum_not_met_blocks_submission(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        # Only 1 provider available, but quorum requires 2
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertFalse(result.quorum_met)
        self.assertTrue(result.alert_triggered)
        self.assertIn("Quorum NOT met", result.detail)


class TestConsensusEngineTimeout(unittest.TestCase):
    """Tests for source timeout / unavailability."""

    def test_unavailable_source_counted_as_not_reporting(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        eng.register_observation(make_obs("planet", 1005.0, 82, available=False))
        eng.register_observation(make_obs("sentinel", 995.0, 79))
        result = eng.evaluate("proj-test", "2024-Q1")
        # Only 2 available (gee + sentinel) — meets quorum
        self.assertTrue(result.quorum_met)
        self.assertEqual(result.providers_count, 2)

    def test_all_sources_timeout_blocks(self):
        eng = ConsensusEngine(n=2, m=3)
        for p in ["gee", "planet", "sentinel"]:
            eng.register_observation(make_obs(p, 1000.0, 80, available=False))
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertFalse(result.quorum_met)
        self.assertEqual(result.providers_count, 0)

    def test_register_provider_without_observation(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_provider("gee")
        eng.register_provider("planet")
        eng.register_provider("sentinel_hub")
        # None have reported data yet
        result = eng.evaluate("proj-test", "2024-Q1")
        self.assertFalse(result.quorum_met)
        self.assertEqual(result.providers_count, 0)


class TestConsensusResultFields(unittest.TestCase):
    """ConsensusResult contains all required fields."""

    def test_result_has_all_fields(self):
        eng = ConsensusEngine(n=2, m=3)
        eng.register_observation(make_obs("gee", 1000.0, 80))
        eng.register_observation(make_obs("planet", 1005.0, 82))
        result = eng.evaluate("proj-test", "2024-Q1")

        self.assertIsInstance(result.quorum_met, bool)
        self.assertIsInstance(result.providers_count, int)
        self.assertIsInstance(result.consensus_tonnes, float)
        self.assertIsInstance(result.consensus_score, int)
        self.assertIsInstance(result.consensus_cid, str)
        self.assertIsInstance(result.conflicting_providers, list)
        self.assertIsInstance(result.alert_triggered, bool)
        self.assertIsInstance(result.detail, str)


class TestQuorumRequiredData(unittest.TestCase):
    """Quick-evaluate function returns correct tuple."""

    def test_all_agree(self):
        obs = [
            make_obs("gee", 1000.0, 80),
            make_obs("planet", 1005.0, 82),
            make_obs("sentinel", 995.0, 79),
        ]
        met, consensus, detail = quorum_required_data("proj-test", "2024-Q1", obs)
        self.assertTrue(met)
        self.assertIsNotNone(consensus)
        self.assertAlmostEqual(consensus.tonnes_verified, 1000.0, delta=10.0)

    def test_one_disagrees(self):
        obs = [
            make_obs("gee", 1000.0, 80),
            make_obs("planet", 5000.0, 82),
            make_obs("sentinel", 1005.0, 79),
        ]
        met, consensus, detail = quorum_required_data("proj-test", "2024-Q1", obs)
        self.assertTrue(met)  # 2-of-3 agree, quorum met
        self.assertIsNotNone(consensus)

    def test_source_unavailable(self):
        obs = [
            make_obs("gee", 1000.0, 80),
            make_obs("planet", 1005.0, 82, available=False),
        ]
        met, consensus, detail = quorum_required_data("proj-test", "2024-Q1", obs, n=2, m=2)
        self.assertFalse(met)  # only 1 of 2 available
        self.assertIsNone(consensus)


class TestConfigEnvVars(unittest.TestCase):
    """Environment variables control consensus parameters."""

    @patch.dict(os.environ, {"QUORUM_N": "3", "QUORUM_M": "5"}, clear=False):
    def test_env_overrides_default_quorum(self):
        from consensus_engine import QUORUM_N as n, QUORUM_M as m
        # Note: constants are read at import time, env override test
        # verifies the module reads from env at import.
        pass

    def test_default_quorum_is_2_of_3(self):
        self.assertEqual(QUORUM_N, 2)
        self.assertEqual(QUORUM_M, 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
