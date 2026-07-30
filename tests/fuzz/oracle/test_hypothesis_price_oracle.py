"""
Hypothesis property-based fuzz tests for price_oracle.py (issue #641).

Targets: `aggregate_prices` and `cross_validate_prices`, the entry points
that turn untrusted external price-feed JSON (Xpansiv, Toucan, SDEX) into a
consensus USD price before conversion to stroops and on-chain submission.

Invariants
----------
1. Neither function raises, for arbitrary list-of-dict / dict-of-list input
   with malformed field types (non-numeric strings, None, NaN, Infinity).
2. Every price in the result is a finite float (never NaN/Infinity — a
   non-finite price silently reaching `to_stroops()` would raise
   OverflowError/ValueError deep in the submission path).
3. Every price in the result is strictly positive (both functions filter
   out non-positive prices before aggregating).
4. `cross_validate_prices` never returns a key backed by fewer than 2
   distinct sources (the whole point of cross-validation).
"""

import math

import _env  # noqa: F401 — sets up sys.path + required env vars as a side effect

from hypothesis import given, settings, strategies as st

from price_oracle import aggregate_prices, cross_validate_prices

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


@given(xpansiv=_price_list, toucan=_price_list)
@settings(max_examples=200)
def test_aggregate_prices_never_raises(xpansiv, toucan):
    aggregate_prices(xpansiv, toucan)


@given(xpansiv=_price_list, toucan=_price_list)
@settings(max_examples=200)
def test_aggregate_prices_results_are_finite_and_positive(xpansiv, toucan):
    result = aggregate_prices(xpansiv, toucan)
    for price in result.values():
        assert math.isfinite(price)
        assert price > 0


_sources_strategy = st.dictionaries(
    keys=st.sampled_from(["xpansiv", "toucan", "sdex", "manual"]),
    values=_price_list,
    max_size=4,
)


@given(sources=_sources_strategy)
@settings(max_examples=200)
def test_cross_validate_prices_never_raises(sources):
    cross_validate_prices(sources)


@given(sources=_sources_strategy)
@settings(max_examples=200)
def test_cross_validate_prices_results_are_finite_and_positive(sources):
    result = cross_validate_prices(sources)
    for price in result.values():
        assert math.isfinite(price)
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
