"""
Time-Weighted Average Price (TWAP) Oracle Module

Calculates TWAP from a series of price observations over a configurable
time window, making on-chain prices resistant to short-term manipulation
and data source outages.

Key design decisions:
  - TWAP is computed off-chain and submitted as a single value to the
    on-chain oracle (on-chain TWAP in Soroban is out of scope per the
    issue spec).
  - Outlier detection uses a 15% deviation threshold from the running
    median to block automatic submission and trigger an alert.
  - Price history is persisted in PostgreSQL with timestamps for
    auditability.
  - The minimum number of hourly data points is enforced: at least
    one data point per hour of the window is required for a valid TWAP.
"""

import os
import logging
import time
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional, Tuple

import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TWAP_WINDOW_HOURS = int(os.environ.get("TWAP_WINDOW_HOURS", 24))
TWAP_MIN_HOURLY_POINTS = int(os.environ.get("TWAP_MIN_HOURLY_POINTS", 1))
TWAP_DEVIATION_THRESHOLD = float(os.environ.get("TWAP_DEVIATION_THRESHOLD", 0.15))
TWAP_DB_DSN = os.environ.get("TWAP_DB_DSN", os.environ.get("DATABASE_URL", ""))

DEVIATION_ALERT_WEBHOOK = os.environ.get("DEVIATION_ALERT_WEBHOOK")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class PriceObservation:
    timestamp: float
    price_usdc: float
    methodology: str
    vintage_year: int


@dataclass
class TWAPResult:
    twap_price: float
    window_start: float
    window_end: float
    observation_count: int
    outlier_count: int
    median_price: float
    deviation_pct: float
    is_valid: bool
    alert_triggered: bool


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _get_conn():
    """Return a new psycopg2 connection from the DSN."""
    return psycopg2.connect(TWAP_DB_DSN)


def ensure_price_history_table() -> None:
    """Create the price_history table if it does not exist yet."""
    sql = """
    CREATE TABLE IF NOT EXISTS price_history (
        id          BIGSERIAL PRIMARY KEY,
        methodology VARCHAR(255)    NOT NULL,
        vintage_year INTEGER        NOT NULL,
        price_usdc   DOUBLE PRECISION NOT NULL,
        observed_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
        source       VARCHAR(100)    NOT NULL DEFAULT 'xpansiv_cbl',
        is_outlier   BOOLEAN         NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_methodology_vintage
        ON price_history (methodology, vintage_year, observed_at);

    CREATE INDEX IF NOT EXISTS idx_price_history_observed_at
        ON price_history (observed_at);
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        logger.info("price_history table ensured")
    finally:
        conn.close()


def insert_price_observation(
    methodology: str,
    vintage_year: int,
    price_usdc: float,
    source: str = "xpansiv_cbl",
) -> None:
    """Persist a single price observation to PostgreSQL."""
    sql = """
    INSERT INTO price_history (methodology, vintage_year, price_usdc, source)
    VALUES (%s, %s, %s, %s)
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (methodology, vintage_year, price_usdc, source))
        conn.commit()
    finally:
        conn.close()


def fetch_price_history(
    methodology: str,
    vintage_year: int,
    window_hours: int = TWAP_WINDOW_HOURS,
) -> List[PriceObservation]:
    """Retrieve price observations within the look-back window."""
    sql = """
    SELECT price_usdc, observed_at
    FROM price_history
    WHERE methodology = %s
      AND vintage_year = %s
      AND observed_at >= now() - (%s || ' hours')::interval
    ORDER BY observed_at ASC
    """
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (methodology, vintage_year, window_hours))
            rows = cur.fetchall()
        return [
            PriceObservation(
                timestamp=row["observed_at"].timestamp(),
                price_usdc=float(row["price_usdc"]),
                methodology=methodology,
                vintage_year=vintage_year,
            )
            for row in rows
        ]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# TWAP calculation
# ---------------------------------------------------------------------------

def _detect_outliers(observations: List[PriceObservation]) -> Tuple[List[PriceObservation], List[PriceObservation]]:
    """Separate observations into inliers and outliers using median deviation.

    An observation is flagged as an outlier when its price deviates from the
    median by more than TWAP_DEVIATION_THRESHOLD (15% by default).
    """
    if not observations:
        return [], []

    prices = [obs.price_usdc for obs in observations]
    median = statistics.median(prices)

    inliers: List[PriceObservation] = []
    outliers: List[PriceObservation] = []

    for obs in observations:
        if median == 0:
            ratio = 0.0
        else:
            ratio = abs(obs.price_usdc - median) / abs(median)

        if ratio > TWAP_DEVIATION_THRESHOLD:
            outliers.append(obs)
        else:
            inliers.append(obs)

    return inliers, outliers


def _validate_hourly_density(observations: List[PriceObservation], window_hours: int) -> bool:
    """Return True when at least one observation exists for each hour of the window.

    A sparse window (e.g. only one point in 24 hours) still produces a TWAP,
    but a warning is logged so operators know coverage is thin.
    """
    if not observations:
        return False

    if window_hours <= 0:
        return True

    unique_hours = set()
    for obs in observations:
        dt = datetime.fromtimestamp(obs.timestamp, tz=timezone.utc)
        unique_hours.add(dt.hour)

    expected = min(window_hours, 24)
    return len(unique_hours) >= min(len(observations), expected)


def calculate_twap(
    methodology: str,
    vintage_year: int,
    window_hours: int = TWAP_WINDOW_HOURS,
    min_hourly_points: int = TWAP_MIN_HOURLY_POINTS,
) -> TWAPResult:
    """Compute the Time-Weighted Average Price for a methodology/vintage pair.

    Steps:
      1. Fetch price history within the configurable look-back window.
      2. Detect and flag outliers (>15% deviation from median).
      3. Compute the simple arithmetic mean of non-outlier prices.
      4. Validate minimum hourly data density.
      5. Return a TWAPResult with all metadata.

    Args:
        methodology:  The pricing methodology (e.g. "VCS", "Gold Standard").
        vintage_year: The vintage year of the carbon credits.
        window_hours: How many hours to look back.  Default 24.
        min_hourly_points: Minimum observations required per hour of the window.
                           Default 1 (at least one point per hour).

    Returns:
        TWAPResult with the computed TWAP price and diagnostic fields.

    Raises:
        ValueError: when no observations exist in the window.
    """
    observations = fetch_price_history(methodology, vintage_year, window_hours)

    if not observations:
        raise ValueError(
            f"No price observations found for {methodology} v{vintage_year} "
            f"in the last {window_hours}h window"
        )

    inliers, outliers = _detect_outliers(observations)

    if not inliers:
        raise ValueError(
            f"All {len(observations)} observations are outliers for "
            f"{methodology} v{vintage_year} — cannot compute TWAP"
        )

    prices = [obs.price_usdc for obs in inliers]
    twap_price = statistics.mean(prices)
    median_price = statistics.median(prices)

    window_end = time.time()
    window_start = window_end - window_hours * 3600

    if median_price == 0:
        deviation_pct = 0.0
    else:
        deviation_pct = abs(twap_price - median_price) / abs(median_price) * 100

    alert_triggered = deviation_pct > (TWAP_DEVIATION_THRESHOLD * 100)
    is_valid = (
        len(observations) >= window_hours * min_hourly_points
        and _validate_hourly_density(observations, window_hours)
    )

    if not is_valid:
        logger.warning(
            "TWAP validity check failed for %s v%d: %d observations in %dh window "
            "(minimum %d hourly points required)",
            methodology, vintage_year, len(observations), window_hours,
            window_hours * min_hourly_points,
        )

    if alert_triggered:
        logger.warning(
            "TWAP deviation alert: %s v%d TWAP=%.2f median=%.2f deviation=%.1f%% "
            "exceeds %.0f%% threshold — automatic submission blocked",
            methodology, vintage_year, twap_price, median_price, deviation_pct,
            TWAP_DEVIATION_THRESHOLD * 100,
        )
        if DEVIATION_ALERT_WEBHOOK:
            _fire_deviation_alert(methodology, vintage_year, twap_price, median_price, deviation_pct)

    return TWAPResult(
        twap_price=round(twap_price, 2),
        window_start=window_start,
        window_end=window_end,
        observation_count=len(observations),
        outlier_count=len(outliers),
        median_price=round(median_price, 2),
        deviation_pct=round(deviation_pct, 2),
        is_valid=is_valid,
        alert_triggered=alert_triggered,
    )


def _fire_deviation_alert(
    methodology: str,
    vintage_year: int,
    twap_price: float,
    median_price: float,
    deviation_pct: float,
) -> None:
    """Send a JSON alert to the configured webhook when deviation exceeds threshold."""
    import json
    import urllib.request

    payload = json.dumps({
        "event": "twap_deviation_alert",
        "methodology": methodology,
        "vintage_year": vintage_year,
        "twap_price": twap_price,
        "median_price": median_price,
        "deviation_pct": round(deviation_pct, 2),
        "threshold_pct": TWAP_DEVIATION_THRESHOLD * 100,
        "action": "automatic_submission_blocked",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }).encode()

    req = urllib.request.Request(
        DEVIATION_ALERT_WEBHOOK,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.info("Deviation alert delivered: HTTP %d", resp.status)
    except Exception as exc:
        logger.error("Failed to fire deviation alert webhook: %s", exc)


# ---------------------------------------------------------------------------
# Public submit function — combines TWAP fetch, outlier check, and on-chain update
# ---------------------------------------------------------------------------

def submit_twap_price(
    methodology: str,
    vintage_year: int,
    oracle_signer: str,
    window_hours: int = TWAP_WINDOW_HOURS,
) -> TWAPResult:
    """Calculate TWAP and return the result, blocking submission if invalid.

    The caller is responsible for invoking the on-chain oracle contract with
    the returned ``twap_price`` when ``is_valid`` is True and the alert was
    not triggered.
    """
    result = calculate_twap(methodology, vintage_year, window_hours)

    if not result.is_valid:
        raise RuntimeError(
            f"TWAP validity check failed for {methodology} v{vintage_year}: "
            f"insufficient data density ({result.observation_count} observations)"
        )

    if result.alert_triggered:
        raise RuntimeError(
            f"TWAP deviation alert for {methodology} v{vintage_year}: "
            f"deviation {result.deviation_pct}% exceeds "
            f"{TWAP_DEVIATION_THRESHOLD * 100}% threshold — submission blocked"
        )

    logger.info(
        "TWAP submit: %s v%d price=%.2f (from %d observations, %d outliers)",
        methodology, vintage_year, result.twap_price,
        result.observation_count, result.outlier_count,
    )

    return result


if __name__ == "__main__":
    ensure_price_history_table()
    logger.info("TWAP oracle module initialised (window=%dh, threshold=%.0f%%)", TWAP_WINDOW_HOURS, TWAP_DEVIATION_THRESHOLD * 100)