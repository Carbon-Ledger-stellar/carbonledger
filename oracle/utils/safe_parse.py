"""
Defensive coercion helpers for untrusted external input.

The oracle services (verification_listener, price_oracle, satellite_monitor)
parse JSON payloads from external verifier APIs, price feeds, and satellite
webhooks before submitting data on-chain. Several call sites previously used
bare `int(...)`/`float(...)` conversions directly on untrusted dict values,
which raise `ValueError`/`TypeError` on malformed input (e.g. a string,
`None`, or NaN/Infinity) and crash the caller instead of rejecting the
payload gracefully. Found via fuzz testing (issue #641).
"""

from __future__ import annotations

import math


def safe_int(value, default: int = 0) -> int:
    """Coerce `value` to an int, returning `default` on any failure.

    Never raises. Rejects bool (a `int` subclass) the same way as any other
    non-numeric type would be rejected by a strict parser — booleans from
    untrusted JSON should not silently become 0/1.
    """
    if isinstance(value, bool):
        return default
    try:
        if isinstance(value, float) and not math.isfinite(value):
            return default
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def safe_float(value, default: float = 0.0) -> float:
    """Coerce `value` to a finite float, returning `default` on any failure
    (including NaN/Infinity, which are technically valid floats but never
    valid for prices, coordinates, or tonnage)."""
    if isinstance(value, bool):
        return default
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(result):
        return default
    return result
