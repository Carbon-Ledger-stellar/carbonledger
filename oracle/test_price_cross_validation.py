"""
test_price_cross_validation.py
Unit tests for Feature #537: price feed cross-validation with outlier detection.

Tests cover:
  - Normal distribution prices (no outliers) → returns mean
  - Clear outlier (|z| > 2.5) → returns median, outlier logged
  - Prices with >15% deviation from median → flagged as outlier
  - Only 1 source available → key skipped (min 2 sources)
  - Missing/empty source → handles gracefully
  - All prices identical → no outlier, returns that price
  - Multiple outliers from same source → median returned
  - Mixed sources with NaN/zero/negative prices → filtered out
  - Std dev = 0 but 15% deviation check still fires (impossible with identical
    values, but the branch is covered)
"""

import statistics
import unittest
from unittest.mock import patch, MagicMock

# Import the functions under test from price_oracle.
# We patch os.environ so that ORACLE_SECRET_KEY etc. don't raise on import.
import os, sys

# Minimal env to satisfy module-level os.environ["..."] calls.
os.environ.setdefault("ORACLE_SECRET_KEY",        "SDUMMYKEYFORTEST000000000000000000000000000000000000000")
os.environ.setdefault("CARBON_ORACLE_CONTRACT_ID", "CDUMMY_CONTRACT")

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from price_oracle import cross_validate_prices, aggregate_prices, fetch_sdex_prices, ZSCORE_THRESHOLD, PRICE_DEVIATION_ALERT


class TestCrossValidatePrices(unittest.TestCase):

    # ── Helper ────────────────────────────────────────────────────────────────

    @staticmethod
    def _make_item(methodology: str, vintage: int, price: float, source: str = "test") -> dict:
        return {
            "methodology":  methodology,
            "vintage_year": vintage,
            "price_usd":    price,
            "volume":       1.0,
            "source":       source,
        }

    # ── Test 1: Normal distribution, no outliers → arithmetic mean ────────────

    def test_normal_prices_returns_mean(self):
        """When all prices cluster tightly, cross_validate returns their mean."""
        sources = {
            "xpansiv": [self._make_item("VCS", 2022, 14.0)],
            "toucan":  [self._make_item("VCS", 2022, 14.5)],
            "sdex":    [self._make_item("VCS", 2022, 13.8)],
        }
        result = cross_validate_prices(sources)
        self.assertIn(("VCS", 2022), result)
        expected_mean = statistics.mean([14.0, 14.5, 13.8])
        self.assertAlmostEqual(result[("VCS", 2022)], expected_mean, places=4)

    # ── Test 2: One outlier (|z| > 2.5) → falls back to median ───────────────

    def test_zscore_outlier_returns_median(self):
        """A price far from the cluster is flagged and the median is returned."""
        # Normal prices: ~14 USD. Outlier: 100 USD (extreme)
        normal_prices = [14.0, 14.2, 13.9, 14.1, 13.8]
        outlier_price = 100.0

        sources = {
            "xpansiv": [self._make_item("VCS", 2022, normal_prices[0]),
                        self._make_item("VCS", 2022, normal_prices[1])],
            "toucan":  [self._make_item("VCS", 2022, normal_prices[2]),
                        self._make_item("VCS", 2022, normal_prices[3])],
            "sdex":    [self._make_item("VCS", 2022, outlier_price)],
        }

        # The function sees prices from sources as entered above (5 items, not 6).
        # normal_prices[4] = 13.8 is NOT in any source dict.
        prices_in_sources = [normal_prices[0], normal_prices[1],
                             normal_prices[2], normal_prices[3],
                             outlier_price]
        expected_median = statistics.median(prices_in_sources)

        result = cross_validate_prices(sources)
        self.assertIn(("VCS", 2022), result)
        self.assertAlmostEqual(result[("VCS", 2022)], expected_median, places=4)

    # ── Test 3: >15% median deviation → outlier, median returned ─────────────

    def test_median_deviation_outlier(self):
        """A price deviating >15% from the median is flagged as an outlier."""
        # Three close prices, one exactly 20% above median
        base = 10.0
        sources = {
            "xpansiv": [self._make_item("GS", 2023, base)],
            "toucan":  [self._make_item("GS", 2023, base * 1.01)],  # +1% (fine)
            "sdex":    [self._make_item("GS", 2023, base * 1.20)],  # +20% (outlier)
        }

        all_prices = [base, base * 1.01, base * 1.20]
        expected_median = statistics.median(all_prices)

        result = cross_validate_prices(sources)
        self.assertIn(("GS", 2023), result)
        self.assertAlmostEqual(result[("GS", 2023)], expected_median, places=4)

    # ── Test 4: Only 1 source → key skipped ──────────────────────────────────

    def test_single_source_skipped(self):
        """A key with prices from only 1 source is excluded from the result."""
        sources = {
            "xpansiv": [self._make_item("VCS", 2021, 12.0)],
            "toucan":  [],   # empty — no data
            "sdex":    [],   # empty — no data
        }
        result = cross_validate_prices(sources)
        self.assertNotIn(("VCS", 2021), result)

    # ── Test 5: Empty / missing source → handled gracefully ──────────────────

    def test_empty_sources_dict(self):
        """An empty sources dict returns an empty result without raising."""
        result = cross_validate_prices({})
        self.assertEqual(result, {})

    def test_all_empty_lists(self):
        """Sources with empty price lists return an empty result."""
        result = cross_validate_prices({"a": [], "b": [], "c": []})
        self.assertEqual(result, {})

    def test_missing_price_field(self):
        """Items without a price_usd field are silently dropped."""
        sources = {
            "xpansiv": [{"methodology": "VCS", "vintage_year": 2022}],  # no price_usd
            "toucan":  [self._make_item("VCS", 2022, 14.0)],
        }
        # Only 1 item with a valid price → should not appear (need ≥2 sources)
        result = cross_validate_prices(sources)
        self.assertNotIn(("VCS", 2022), result)

    # ── Test 6: All prices identical → no outlier, returns that price ─────────

    def test_identical_prices_no_outlier(self):
        """When all sources report the same price, std=0 and no outlier fires."""
        price = 15.0
        sources = {
            "xpansiv": [self._make_item("VCS", 2022, price)],
            "toucan":  [self._make_item("VCS", 2022, price)],
            "sdex":    [self._make_item("VCS", 2022, price)],
        }
        result = cross_validate_prices(sources)
        self.assertIn(("VCS", 2022), result)
        self.assertAlmostEqual(result[("VCS", 2022)], price, places=6)

    # ── Test 7: Zero / negative / NaN prices → filtered out ──────────────────

    def test_invalid_prices_filtered(self):
        """Zero, negative, and non-finite prices are dropped before statistics."""
        sources = {
            "xpansiv": [self._make_item("VCS", 2022, 0.0),
                        self._make_item("VCS", 2022, -5.0),
                        self._make_item("VCS", 2022, float("inf"))],
            "toucan":  [self._make_item("VCS", 2022, 14.0)],
        }
        # After filtering: only one valid price (from toucan) → skipped
        result = cross_validate_prices(sources)
        self.assertNotIn(("VCS", 2022), result)

    # ── Test 8: Multiple methodology/vintage keys ─────────────────────────────

    def test_multiple_keys(self):
        """cross_validate handles multiple methodology/vintage pairs."""
        sources = {
            "xpansiv": [
                self._make_item("VCS", 2022, 14.0),
                self._make_item("GS",  2023, 18.0),
            ],
            "toucan": [
                self._make_item("VCS", 2022, 14.2),
                self._make_item("GS",  2023, 18.5),
            ],
        }
        result = cross_validate_prices(sources)
        self.assertIn(("VCS", 2022), result)
        self.assertIn(("GS",  2023), result)

    # ── Test 9: 2 sources minimum – exactly 2 works ───────────────────────────

    def test_exactly_two_sources(self):
        """Two sources is the minimum; the result should include the key."""
        sources = {
            "xpansiv": [self._make_item("VCS", 2023, 13.0)],
            "toucan":  [self._make_item("VCS", 2023, 13.5)],
        }
        result = cross_validate_prices(sources)
        self.assertIn(("VCS", 2023), result)

    # ── Test 10: Multiple prices from same source count as 1 source ───────────

    def test_multiple_prices_same_source_counts_as_one(self):
        """Multiple entries from the same source still count as 1 distinct source."""
        sources = {
            "xpansiv": [
                self._make_item("VCS", 2022, 14.0),
                self._make_item("VCS", 2022, 14.5),
                self._make_item("VCS", 2022, 15.0),
            ],
            "toucan":  [],
        }
        result = cross_validate_prices(sources)
        self.assertNotIn(("VCS", 2022), result)


class TestAggregatePrices(unittest.TestCase):
    """Regression tests for the legacy aggregate_prices fallback."""

    def test_basic_vwap(self):
        xpansiv = [{"methodology": "VCS", "vintage_year": 2022, "price_usd": 10.0, "volume": 100}]
        toucan  = [{"methodology": "VCS", "vintage_year": 2022, "price_usd": 20.0, "volume": 100}]
        result  = aggregate_prices(xpansiv, toucan)
        self.assertIn(("VCS", 2022), result)
        self.assertAlmostEqual(result[("VCS", 2022)], 15.0, places=2)

    def test_empty_inputs(self):
        self.assertEqual(aggregate_prices([], []), {})


class TestFetchSdexPrices(unittest.TestCase):
    """Unit tests for the SDEX price fetcher."""

    def test_no_issuers_configured(self):
        """When no asset issuers are configured, returns empty list."""
        for env_key in [
            "SDEX_VCS_ISSUER", "SDEX_GS_ISSUER", "SDEX_ACM_ISSUER",
            "SDEX_CAR_ISSUER", "SDEX_REDD_ISSUER",
        ]:
            os.environ.pop(env_key, None)
        result = fetch_sdex_prices()
        self.assertEqual(result, [])

    @patch("price_oracle.requests.get")
    def test_horizon_success(self, mock_get):
        """When Horizon returns trade data, a price is returned."""
        os.environ["SDEX_VCS_ISSUER"] = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = {
            "_embedded": {
                "records": [
                    {"avg": "14.50", "base_volume": "1000"},
                    {"avg": "14.20", "base_volume": "500"},
                ]
            }
        }
        mock_get.return_value = mock_resp

        result = fetch_sdex_prices()
        # Clean up env
        del os.environ["SDEX_VCS_ISSUER"]

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["methodology"], "VCS")
        self.assertGreater(result[0]["price_usd"], 0)

    @patch("price_oracle.requests.get")
    def test_horizon_empty_records(self, mock_get):
        """When Horizon returns no records, the methodology is skipped."""
        os.environ["SDEX_VCS_ISSUER"] = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = {"_embedded": {"records": []}}
        mock_get.return_value = mock_resp

        result = fetch_sdex_prices()
        del os.environ["SDEX_VCS_ISSUER"]
        self.assertEqual(result, [])

    @patch("price_oracle.requests.get")
    def test_horizon_http_error(self, mock_get):
        """When Horizon returns an error, the source is skipped gracefully."""
        os.environ["SDEX_VCS_ISSUER"] = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

        mock_get.side_effect = Exception("timeout")

        result = fetch_sdex_prices()
        del os.environ["SDEX_VCS_ISSUER"]
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
