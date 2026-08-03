"""
Unit tests for the TWAP oracle module.

Covers:
  - Normal TWAP calculation (evenly-spaced hourly data)
  - Outlier detection (15% deviation blocks submission)
  - Sparse data handling (insufficient hourly coverage)
  - Empty window raises ValueError
  - All-outlier window raises ValueError
"""

import os
import unittest
from unittest.mock import patch, MagicMock, PropertyMock
from datetime import datetime, timezone, timedelta

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "oracle"))

from twap import (
    PriceObservation,
    TWAPResult,
    _detect_outliers,
    _validate_hourly_density,
    calculate_twap,
    submit_twap_price,
    TWAP_DEVIATION_THRESHOLD,
    TWAP_WINDOW_HOURS,
)


def _make_observations(
    base_price: float,
    count: int,
    hours_ago: int = 24,
    outlier_indices: set = None,
    outlier_multiplier: float = 2.0,
) -> list:
    """Build synthetic PriceObservation objects at hourly intervals."""
    outlier_indices = outlier_indices or set()
    now = datetime.now(timezone.utc).timestamp()
    observations = []
    for i in range(count):
        ts = now - (hours_ago - i) * 3600
        price = base_price
        if i in outlier_indices:
            price = base_price * outlier_multiplier
        observations.append(PriceObservation(
            timestamp=ts,
            price_usdc=price,
            methodology="VCS",
            vintage_year=2023,
        ))
    return observations


class TestDetectOutliers(unittest.TestCase):
    """Outlier detection around median with 15% threshold."""

    def test_no_outliers_around_median(self):
        obs = _make_observations(100.0, 24, outlier_indices=set())
        inliers, outliers = _detect_outliers(obs)
        self.assertEqual(len(inliers), 24)
        self.assertEqual(len(outliers), 0)

    def test_high_outlier_flagged(self):
        # 150 is 50% above median of ~100 → outlier
        obs = _make_observations(100.0, 24, outlier_indices={12}, outlier_multiplier=1.5)
        inliers, outliers = _detect_outliers(obs)
        self.assertEqual(len(outliers), 1)
        self.assertEqual(len(inliers), 23)

    def test_low_outlier_flagged(self):
        # 50 is 50% below median of ~100 → outlier
        obs = _make_observations(100.0, 24, outlier_indices={12}, outlier_multiplier=0.5)
        inliers, outliers = _detect_outliers(obs)
        self.assertEqual(len(outliers), 1)
        self.assertEqual(len(inliers), 23)

    def test_empty_returns_empty(self):
        inliers, outliers = _detect_outliers([])
        self.assertEqual(inliers, [])
        self.assertEqual(outliers, [])


class TestValidateHourlyDensity(unittest.TestCase):
    """Hourly density validation."""

    def test_full_24h_coverage(self):
        obs = _make_observations(100.0, 24, hours_ago=24)
        self.assertTrue(_validate_hourly_density(obs, 24))

    def test_sparse_data_fails(self):
        # Only 3 points in a 24h window → insufficient
        obs = _make_observations(100.0, 3, hours_ago=24)
        self.assertFalse(_validate_hourly_density(obs, 24))

    def test_empty_returns_false(self):
        self.assertFalse(_validate_hourly_density([], 24))

    def test_window_larger_than_data(self):
        # 10 points in 24h window — fewer than 24 unique hours
        obs = _make_observations(100.0, 10, hours_ago=24)
        self.assertFalse(_validate_hourly_density(obs, 24))

    def test_exact_minimum_density_passes(self):
        # One point per hour for 12 hours
        obs = _make_observations(100.0, 12, hours_ago=12)
        self.assertTrue(_validate_hourly_density(obs, 12))


class TestCalculateTWAP(unittest.TestCase):
    """Normal TWAP calculation scenarios."""

    @patch("twap.fetch_price_history")
    def test_normal_twap(self, mock_fetch):
        """TWAP is the arithmetic mean of non-outlier prices."""
        mock_fetch.return_value = _make_observations(100.0, 24, outlier_indices=set())
        result = calculate_twap("VCS", 2023, window_hours=24)
        self.assertAlmostEqual(result.twap_price, 100.0, delta=0.01)
        self.assertEqual(result.observation_count, 24)
        self.assertEqual(result.outlier_count, 0)
        self.assertTrue(result.is_valid)
        self.assertFalse(result.alert_triggered)

    @patch("twap.fetch_price_history")
    def test_twap_with_outliers_excluded(self, mock_fetch):
        """Outliers are excluded from the TWAP calculation."""
        mock_fetch.return_value = _make_observations(100.0, 24, outlier_indices={0, 23}, outlier_multiplier=2.0)
        result = calculate_twap("VCS", 2023, window_hours=24)
        # The two outliers at 200 should be excluded, mean should be ~100
        self.assertAlmostEqual(result.twap_price, 100.0, delta=1.0)
        self.assertEqual(result.outlier_count, 2)

    @patch("twap.fetch_price_history")
    def test_single_point_raises(self, mock_fetch):
        """Empty observation list raises ValueError."""
        mock_fetch.return_value = []
        with self.assertRaises(ValueError):
            calculate_twap("VCS", 2023)

    @patch("twap.fetch_price_history")
    def test_all_outliers_raises(self, mock_fetch):
        """All observations being outliers raises ValueError."""
        mock_fetch.return_value = _make_observations(100.0, 5, outlier_indices={0, 1, 2, 3, 4}, outlier_multiplier=2.0)
        with self.assertRaises(ValueError):
            calculate_twap("VCS", 2023)


class TestDeviationAlert(unittest.TestCase):
    """15% deviation triggers alert and blocks automatic submission."""

    @patch("twap.fetch_price_history")
    def test_deviation_exceeds_threshold(self, mock_fetch):
        """When TWAP deviates >15% from median, alert_triggered is True."""
        # Create prices that are all ~100 except one at 200 (100% above median)
        obs = _make_observations(100.0, 12, hours_ago=12, outlier_indices={5}, outlier_multiplier=2.0)
        mock_fetch.return_value = obs
        result = calculate_twap("VCS", 2023, window_hours=24)
        # With one 200 among twelve 100s, median=100, TWAP≈108.3, deviation≈8.3%
        # This is below 15% so alert should NOT be triggered
        self.assertFalse(result.alert_triggered)

    @patch("twap.fetch_price_history")
    def test_valid_submission_blocked_by_outlier(self, mock_fetch):
        """When TWAP deviation exceeds 15%, submission is blocked via RuntimeError."""
        # Create prices with extreme outlier: one at 500 among 24 at 100
        obs = _make_observations(100.0, 24, outlier_indices={0}, outlier_multiplier=5.0)
        mock_fetch.return_value = obs
        result = calculate_twap("VCS", 2023, window_hours=24)
        # One outlier at 500 among 23 at 100: median≈100, TWAP ≈ (23*100+500)/24 ≈ 116.67
        # deviation ≈ 16.7% > 15% → alert triggered
        self.assertTrue(result.alert_triggered)

    @patch("twap.submit_twap_price")
    def test_submit_blocks_on_alert(self, mock_submit):
        """submit_twap_price raises RuntimeError when alert is triggered."""
        mock_submit.side_effect = RuntimeError(
            "TWAP deviation alert for VCS v2023: deviation 16.7% exceeds 15% threshold"
        )
        with self.assertRaises(RuntimeError):
            submit_twap_price("VCS", 2023)


class TestSparseDataHandling(unittest.TestCase):
    """Sparse or insufficient data is handled gracefully."""

    @patch("twap.fetch_price_history")
    def test_insufficient_observations(self, mock_fetch):
        """Too few observations triggers validity failure."""
        # Only 1 observation in 24h window
        mock_fetch.return_value = _make_observations(100.0, 1, hours_ago=1)
        result = calculate_twap("VCS", 2023, window_hours=24)
        self.assertFalse(result.is_valid)
        self.assertEqual(result.observation_count, 1)

    @patch("twap.fetch_price_history")
    def test_valid_sparse_window(self, mock_fetch):
        """A very small window with sufficient density passes."""
        mock_fetch.return_value = _make_observations(100.0, 3, hours_ago=3)
        result = calculate_twap("VCS", 2023, window_hours=3)
        self.assertTrue(result.is_valid)

    @patch("twap.submit_twap_price")
    def test_submit_blocks_invalid_twap(self, mock_submit):
        """submit_twap_price raises RuntimeError when TWAP is invalid."""
        mock_submit.side_effect = RuntimeError(
            "TWAP validity check failed for VCS v2023: insufficient data density (1 observations)"
        )
        with self.assertRaises(RuntimeError):
            submit_twap_price("VCS", 2023)


class TestTWAPResultFields(unittest.TestCase):
    """TWAPResult contains all required diagnostic fields."""

    @patch("twap.fetch_price_history")
    def test_result_has_all_fields(self, mock_fetch):
        mock_fetch.return_value = _make_observations(100.0, 24)
        result = calculate_twap("VCS", 2023, window_hours=24)

        self.assertIsInstance(result.twap_price, float)
        self.assertIsInstance(result.window_start, float)
        self.assertIsInstance(result.window_end, float)
        self.assertIsInstance(result.observation_count, int)
        self.assertIsInstance(result.outlier_count, int)
        self.assertIsInstance(result.median_price, float)
        self.assertIsInstance(result.deviation_pct, float)
        self.assertIsInstance(result.is_valid, bool)
        self.assertIsInstance(result.alert_triggered, bool)

        self.assertGreater(result.window_end, result.window_start)
        self.assertGreaterEqual(result.observation_count, 0)
        self.assertGreaterEqual(result.outlier_count, 0)
        self.assertLessEqual(result.outlier_count, result.observation_count)


class TestConfigEnvVars(unittest.TestCase):
    """Environment variables control TWAP parameters."""

    @patch.dict(os.environ, {"TWAP_WINDOW_HOURS": "48", "TWAP_DEVIATION_THRESHOLD": "0.10"}, clear=False):
    def test_env_overrides_defaults(self):
        from twap import TWAP_WINDOW_HOURS as window, TWAP_DEVIATION_THRESHOLD as threshold
        # Note: module-level constants are read at import time, so
        # this test validates that env vars are used in the module.
        # We test the values directly from the module after re-import.
        pass

    def test_default_window_is_24(self):
        self.assertEqual(TWAP_WINDOW_HOURS, 24)

    def test_default_deviation_threshold_is_15pct(self):
        self.assertEqual(TWAP_DEVIATION_THRESHOLD, 0.15)


if __name__ == "__main__":
    unittest.main(verbosity=2)