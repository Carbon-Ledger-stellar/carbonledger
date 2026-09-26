"""
Hypothesis property-based fuzz tests for verification_listener.py (issue #641).

Target: `validate_methodology_report`, the entry point that validates
untrusted monitoring-report JSON from accredited verifier APIs before a
score is derived and (eventually) submitted on-chain.

Invariants
----------
1. The function never raises, for any dict-shaped input (arbitrary key/value
   types, including malformed/missing fields).
2. The returned score is always within [0, 100].
3. `is_valid` is exactly `score >= METHODOLOGY_SCORE_MIN`.
"""

import _env  # noqa: F401 — sets up sys.path + required env vars as a side effect

from hypothesis import given, settings, strategies as st

from verification_listener import validate_methodology_report, METHODOLOGY_SCORE_MIN

# Arbitrary untrusted JSON-ish values a verifier API might send for a field.
_json_scalar = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(),
    st.floats(allow_nan=True, allow_infinity=True),
    st.text(max_size=50),
)
_json_value = st.one_of(
    _json_scalar,
    st.lists(_json_scalar, max_size=5),
    st.dictionaries(st.text(max_size=10), _json_scalar, max_size=5),
)

_report_strategy = st.dictionaries(
    keys=st.one_of(
        st.sampled_from(
            [
                "project_id",
                "period",
                "tonnes_verified",
                "satellite_cid",
                "verifier_signature",
                "additionality_proof",
                "permanence_buffer",
            ]
        ),
        st.text(max_size=10),
    ),
    values=_json_value,
    max_size=10,
)

_methodology_strategy = st.sampled_from(["VCS", "Gold Standard", "ACM", "unknown", ""])


@given(report=_report_strategy, methodology=_methodology_strategy)
@settings(max_examples=300)
def test_validate_methodology_report_never_raises(report, methodology):
    validate_methodology_report(report, methodology)


@given(report=_report_strategy, methodology=_methodology_strategy)
@settings(max_examples=300)
def test_validate_methodology_report_score_in_range(report, methodology):
    _, score = validate_methodology_report(report, methodology)
    assert 0 <= score <= 100


@given(report=_report_strategy, methodology=_methodology_strategy)
@settings(max_examples=300)
def test_validate_methodology_report_is_valid_matches_threshold(report, methodology):
    is_valid, score = validate_methodology_report(report, methodology)
    assert is_valid == (score >= METHODOLOGY_SCORE_MIN)


def test_empty_report_is_never_valid():
    is_valid, score = validate_methodology_report({}, "VCS")
    assert is_valid is False
    assert score < METHODOLOGY_SCORE_MIN
