"""
Hypothesis property-based fuzz tests for satellite_monitor.py (issue #641).

Targets: `detect_contradiction` and `coordinates_match`, the data-validation
entry points that process untrusted satellite webhook JSON before a project
is flagged or its monitoring evidence is submitted on-chain.

Invariants
----------
1. Neither function raises, for arbitrary dict input (malformed field types,
   missing keys, NaN/Infinity coordinates).
2. Both functions always return a plain bool.
3. `coordinates_match` is symmetric: swapping `registered` and `satellite`
   never changes the result (it's defined purely on absolute differences).
4. `coordinates_match` returns False whenever either argument is falsy
   (empty dict / None), regardless of the other argument's content.
"""

import _env  # noqa: F401 — sets up sys.path + required env vars as a side effect

from hypothesis import given, settings, strategies as st

from satellite_monitor import detect_contradiction, coordinates_match

_json_scalar = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-10**6, max_value=10**6),
    st.floats(allow_nan=True, allow_infinity=True, width=32),
    st.text(max_size=20),
)

_coord_dict = st.dictionaries(
    keys=st.sampled_from(["lat", "lon", "extra"]),
    values=_json_scalar,
    max_size=3,
)

_report_strategy = st.dictionaries(
    keys=st.sampled_from(
        [
            "deforestation_pct",
            "reported_tonnes_sequestered",
            "project_type",
        ]
    ),
    values=_json_scalar,
    max_size=3,
)


@given(report=_report_strategy)
@settings(max_examples=300)
def test_detect_contradiction_never_raises(report):
    result = detect_contradiction(report)
    assert isinstance(result, bool)


@given(registered=_coord_dict, satellite=_coord_dict)
@settings(max_examples=300)
def test_coordinates_match_never_raises(registered, satellite):
    result = coordinates_match(registered, satellite)
    assert isinstance(result, bool)


@given(registered=_coord_dict, satellite=_coord_dict)
@settings(max_examples=300)
def test_coordinates_match_is_symmetric(registered, satellite):
    assert coordinates_match(registered, satellite) == coordinates_match(satellite, registered)


@given(satellite=_coord_dict)
@settings(max_examples=100)
def test_coordinates_match_false_when_registered_empty(satellite):
    assert coordinates_match({}, satellite) is False


@given(registered=_coord_dict)
@settings(max_examples=100)
def test_coordinates_match_false_when_satellite_empty(registered):
    assert coordinates_match(registered, {}) is False
