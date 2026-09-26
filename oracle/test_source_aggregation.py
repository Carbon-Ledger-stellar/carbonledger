"""
test_source_aggregation.py
Unit tests for Feature #584: multi-source price feed aggregation with
per-source reliability weighting, trimmed-mean/stddev outlier rejection,
and per-source availability tracking.

Tests cover:
  - All sources healthy → weighted average of all sources
  - One outlier source → rejected via trimmed-mean/stddev, remaining
    sources aggregated
  - Two sources unavailable → key skipped (below MIN_SOURCES), availability
    tracker records the failures
  - Outlier rejection never empties the accepted set
  - Per-source weights are configurable without code changes (passed at
    call time / read from env)
  - Availability tracker success/failure/ratio bookkeeping
"""

import os
import sys
import unittest

os.environ.setdefault("ORACLE_SECRET_KEY", "SDUMMYKEYFORTEST000000000000000000000000000000000000000")
os.environ.setdefault("CARBON_ORACLE_CONTRACT_ID", "CDUMMY_CONTRACT")

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from price_oracle import (
    aggregate_weighted_prices,
    reject_outlier_sources,
    SourceAvailabilityTracker,
    get_source_availability,
    source_availability,
)


def _item(methodology="VCS", vintage=2023, price=10.0):
    return {"methodology": methodology, "vintage_year": vintage, "price_usd": price}


class TestAggregateWeightedPrices(unittest.TestCase):

    def test_all_sources_healthy_weighted_average(self):
        """Three healthy sources are combined via a reliability-weighted average."""
        sources = {
            "xpansiv": [_item(price=10.0)],
            "toucan": [_item(price=10.5)],
            "sdex": [_item(price=9.5)],
        }
        weights = {"xpansiv": 2.0, "toucan": 1.0, "sdex": 1.0}
        result = aggregate_weighted_prices(sources, weights=weights)

        self.assertIn(("VCS", 2023), result)
        expected = (10.0 * 2.0 + 10.5 * 1.0 + 9.5 * 1.0) / 4.0
        self.assertAlmostEqual(result[("VCS", 2023)], expected, places=4)

    def test_one_outlier_source_rejected(self):
        """A source far from the trimmed-mean of the others is excluded."""
        sources = {
            "xpansiv": [_item(price=10.0)],
            "toucan": [_item(price=10.2)],
            "sdex": [_item(price=10.1)],
            "extra": [_item(price=50.0)],  # gross outlier
        }
        result = aggregate_weighted_prices(sources, weights={})
        self.assertIn(("VCS", 2023), result)
        # Outlier source must not pull the result anywhere near 50.
        self.assertLess(result[("VCS", 2023)], 15.0)

    def test_two_sources_unavailable_key_skipped(self):
        """When only 1 of 3 sources returns data, the key is skipped (< MIN_SOURCES)."""
        sources = {
            "xpansiv": [_item(price=10.0)],
            "toucan": [],  # unavailable
            "sdex": [],    # unavailable
        }
        result = aggregate_weighted_prices(sources)
        self.assertNotIn(("VCS", 2023), result)

    def test_default_weights_used_when_not_overridden(self):
        """Without an explicit weights arg, SOURCE_WEIGHTS (env-configurable) is used."""
        sources = {
            "xpansiv": [_item(price=10.0)],
            "toucan": [_item(price=12.0)],
        }
        result = aggregate_weighted_prices(sources)
        self.assertIn(("VCS", 2023), result)
        # Default weights are equal (1.0 each) → simple average.
        self.assertAlmostEqual(result[("VCS", 2023)], 11.0, places=4)

    def test_configurable_weights_change_result(self):
        """Passing different weights (no code change) produces a different result."""
        sources = {
            "xpansiv": [_item(price=10.0)],
            "toucan": [_item(price=20.0)],
        }
        equal = aggregate_weighted_prices(sources, weights={"xpansiv": 1.0, "toucan": 1.0})
        skewed = aggregate_weighted_prices(sources, weights={"xpansiv": 4.0, "toucan": 1.0})

        self.assertAlmostEqual(equal[("VCS", 2023)], 15.0, places=4)
        self.assertAlmostEqual(skewed[("VCS", 2023)], (10.0 * 4 + 20.0) / 5, places=4)
        self.assertLess(skewed[("VCS", 2023)], equal[("VCS", 2023)])

    def test_multiple_keys_independent(self):
        sources = {
            "xpansiv": [_item("VCS", 2022, 14.0), _item("GS", 2023, 18.0)],
            "toucan": [_item("VCS", 2022, 14.2), _item("GS", 2023, 18.5)],
        }
        result = aggregate_weighted_prices(sources)
        self.assertIn(("VCS", 2022), result)
        self.assertIn(("GS", 2023), result)


class TestRejectOutlierSources(unittest.TestCase):

    def test_no_outlier_when_prices_close(self):
        prices = {"xpansiv": 10.0, "toucan": 10.1, "sdex": 9.9}
        accepted, rejected = reject_outlier_sources(prices)
        self.assertEqual(rejected, [])
        self.assertEqual(accepted, prices)

    def test_outlier_beyond_two_stddev_rejected(self):
        prices = {"xpansiv": 10.0, "toucan": 10.1, "sdex": 9.9, "extra": 200.0}
        accepted, rejected = reject_outlier_sources(prices, threshold_stddev=2.0)
        self.assertIn("extra", rejected)
        self.assertNotIn("extra", accepted)

    def test_never_rejects_every_source(self):
        """Two wildly different sources can't both be 'outliers' — keep both."""
        prices = {"xpansiv": 1.0, "toucan": 1000.0}
        accepted, rejected = reject_outlier_sources(prices)
        self.assertEqual(accepted, prices)
        self.assertEqual(rejected, [])

    def test_single_source_never_rejected(self):
        accepted, rejected = reject_outlier_sources({"xpansiv": 10.0})
        self.assertEqual(accepted, {"xpansiv": 10.0})
        self.assertEqual(rejected, [])

    def test_identical_prices_no_rejection(self):
        prices = {"xpansiv": 10.0, "toucan": 10.0, "sdex": 10.0}
        accepted, rejected = reject_outlier_sources(prices)
        self.assertEqual(rejected, [])
        self.assertEqual(accepted, prices)


class TestSourceAvailabilityTracker(unittest.TestCase):

    def setUp(self):
        self.tracker = SourceAvailabilityTracker()

    def test_records_success_and_failure(self):
        self.tracker.record("xpansiv", success=True, latency_seconds=0.2, item_count=5)
        self.tracker.record("xpansiv", success=False, latency_seconds=1.5)

        snapshot = self.tracker.snapshot()
        stats = snapshot["xpansiv"]
        self.assertEqual(stats["total_attempts"], 2)
        self.assertEqual(stats["total_successes"], 1)
        self.assertEqual(stats["total_failures"], 1)
        self.assertIsNotNone(stats["last_success_at"])
        self.assertIsNotNone(stats["last_failure_at"])

    def test_availability_ratio(self):
        self.tracker.record("toucan", success=True, latency_seconds=0.1)
        self.tracker.record("toucan", success=True, latency_seconds=0.1)
        self.tracker.record("toucan", success=False, latency_seconds=0.1)
        self.assertAlmostEqual(self.tracker.availability_ratio("toucan"), 2 / 3, places=4)

    def test_availability_ratio_unknown_source(self):
        self.assertIsNone(self.tracker.availability_ratio("unknown"))

    def test_module_level_tracker_is_queryable(self):
        """get_source_availability() exposes the shared tracker's snapshot."""
        source_availability.record("sdex", success=True, latency_seconds=0.05, item_count=2)
        snapshot = get_source_availability()
        self.assertIn("sdex", snapshot)
        self.assertGreaterEqual(snapshot["sdex"]["total_attempts"], 1)


if __name__ == "__main__":
    unittest.main()
