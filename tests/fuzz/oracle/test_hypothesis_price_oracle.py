"""
Hypothesis property-based tests for oracle price feed logic.

Invariants tested:
  1. aggregate_prices never raises for arbitrary input with malformed field types.
  2. Every price in the aggregate_prices result is finite (never NaN/Infinity).
  3. Every price in the aggregate_prices result is strictly positive.
  4. cross_validate_prices never raises for arbitrary input.
  5. cross_validate_prices results are finite and positive.
  6. cross_validate_prices requires at least 2 distinct sources per key.
  7. compute_twap is within the min and max of the price history.
  8. compute_twap with a single price equals that price.
  9. compute_twap with constant prices equals that constant.
  10. check_deviation_alert triggers when deviation exceeds threshold.
  11. reject_out_of_range_price rejects NaN, Inf, negative, and zero prices.
  12. reject_out_of_range_price accepts finite positive prices within range.
"""

import math
import time

import _env  # noqa: F401 — sets up sys.path + required env vars as a side effect

from hypothesis import given, settings, strategies as st

from price_oracle import (
    aggregate_prices,
    cross_validate_prices,
    compute_twap,
    check_deviation_alert,
    reject_out_of_range_price,
    ZSCORE_THRESHOLD,
    PRICE_DEVIATION_ALERT,
    MIN_PRICE,
    MAX_PRICE,
)

_json_scalar = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-10**6, max_value=10**9),
    st.floats(allow_nan=True, allow_infinity=True, width=32),
    st.text(max_size=20),
)

_price_item = st.fixed_dictionaries(
    {},
    optional={
        "methodology": st.one_of(st.sampled_from(["VCS", "Gold Standard", "ACM"]), _json_scalar),
        "vintage_year": _json_scalar,
        "price_usd": _json_scalar,
        "volume": _json_scalar,
    },
)

_price_list = st.lists(_price_item, max_size=8)

_sources_strategy = st.dictionaries(
    keys=st.sampled_from(["xpansiv", "toucan", "sdex", "manual"]),
    values=_price_list,
    max_size=4,
)

_price_history_entry = st.fixed_dictionaries(
    {
        "price": st.floats(allow_nan=False, allow_infinity=False, min_value=0.01, max_value=100_000),
        "timestamp": st.integers(min_value=1_000_000_000, max_value=2_000_000_000),
    }
)


@given(xpansiv=_price_list, toucan=_price_list)
@settings(max_examples=200)
def test_aggregate_prices_never_raises(xpansiv, toucan):
    aggregate_prices(xpansiv, toucan)


@given(xpansiv=_price_list, toucan=_price_list)
@settings(max_examples=200)
def test_aggregate_prices_results_are_finite(xpansiv, toucan):
    result = aggregate_prices(xpansiv, toucan)
    for price in result.values():
        assert math.isfinite(price)


@given(xpansiv=_price_list, toucan=_price_list)
@settings(max_examples=200)
def test_aggregate_prices_results_are_positive(xpansiv, toucan):
    result = aggregate_prices(xpansiv, toucan)
    for price in result.values():
        assert price > 0


@given(sources=_sources_strategy)
@settings(max_examples=200)
def test_cross_validate_prices_never_raises(sources):
    cross_validate_prices(sources)


@given(sources=_sources_strategy)
@settings(max_examples=200)
def test_cross_validate_prices_results_are_finite(sources):
    result = cross_validate_prices(sources)
    for price in result.values():
        assert math.isfinite(price)


@given(sources=_sources_strategy)
@settings(max_examples=200)
def test_cross_validate_prices_results_are_positive(sources):
    result = cross_validate_prices(sources)
    for price in result.values():
        assert price > 0


@given(sources=_sources_strategy)
@settings(max_examples=200)
def test_cross_validate_prices_requires_two_distinct_sources(sources):
    """A key can only appear in the result if >=2 distinct sources reported
    a usable (finite, positive) price for it."""
    contributors: dict[tuple[str, int], set[str]] = {}
    for source_name, items in sources.items():
        for item in items:
            try:
                methodology = str(item.get("methodology", "VCS"))
                vintage_year = int(item.get("vintage_year", 2023))
                price = float(item.get("price_usd", 0))
            except (TypeError, ValueError, OverflowError):
                continue
            if not math.isfinite(price) or price <= 0:
                continue
            contributors.setdefault((methodology, vintage_year), set()).add(source_name)

    result = cross_validate_prices(sources)
    for key in result:
        assert len(contributors.get(key, set())) >= 2


@given(history=st.lists(_price_history_entry, min_size=1, max_size=20))
@settings(max_examples=200)
def test_twap_within_min_max(history):
    """TWAP must lie between the minimum and maximum observed prices."""
    prices = [entry["price"] for entry in history]
    min_price = min(prices)
    max_price = max(prices)

    twap = compute_twap(history)

    if twap is None:
        return

    assert min_price <= twap <= max_price, (
        f"TWAP {twap} is outside bounds [{min_price}, {max_price}]"
    )


@given(price=st.floats(allow_nan=False, allow_infinity=False, min_value=0.01, max_value=100_000),
       duration=st.integers(min_value=1, max_value=3600))
@settings(max_examples=200)
def test_twap_single_price_equals_observation(price, duration):
    """TWAP with a single price observation equals that price."""
    history = [{"price": price, "timestamp": int(time.time()) - duration}]
    twap = compute_twap(history)
    assert twap is not None
    assert math.isclose(twap, price, rel_tol=1e-9)


@given(price=st.floats(allow_nan=False, allow_infinity=False, min_value=0.01, max_value=100_000),
       count=st.integers(min_value=2, max_value=20))
@settings(max_examples=200)
def test_twap_constant_prices_equals_constant(price, count):
    """TWAP with constant prices equals that constant regardless of durations."""
    history = [
        {"price": price, "timestamp": int(time.time()) - i * 3600}
        for i in range(count)
    ]
    twap = compute_twap(history)
    assert twap is not None
    assert math.isclose(twap, price, rel_tol=1e-9)


@given(reference_price=st.floats(allow_nan=False, allow_infinity=False, min_value=1, max_value=100_000),
       deviation_pct=st.floats(min_value=0.16, max_value=2.0))
@settings(max_examples=200)
def test_deviation_alert_triggers_on_large_deviation(reference_price, deviation_pct):
    """Deviation alert fires when current price exceeds the threshold."""
    current_price = reference_price * (1 + deviation_pct)
    alert = check_deviation_alert(current_price, reference_price)
    assert alert is True


@given(price=st.floats(allow_nan=True, allow_infinity=True, width=32))
@settings(max_examples=200)
def test_reject_out_of_range_prices(price):
    """NaN, Inf, negative, and zero prices are rejected."""
    if math.isfinite(price) and price > 0 and MIN_PRICE <= price <= MAX_PRICE:
        assert reject_out_of_range_price(price) is False
    else:
        assert reject_out_of_range_price(price) is True


@given(price=st.floats(allow_nan=False, allow_infinity=False, min_value=MIN_PRICE, max_value=MAX_PRICE))
@settings(max_examples=200)
def test_accept_valid_prices(price):
    """Finite positive prices within range are accepted."""
    assert reject_out_of_range_price(price) is False