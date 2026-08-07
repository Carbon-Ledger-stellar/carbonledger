"""
Price Oracle with Distributed Lock
Prevents duplicate price submissions across multiple replicas
"""

import os
import logging
import time
import math
import statistics
from typing import Optional, Dict, List, Tuple
import redis
import requests
from utils.distributed_lock import DistributedLock, StaleLockWatchdog
from audit_chain import record_submission

logger = logging.getLogger(__name__)

# Configuration
LOCK_KEY = os.environ.get('PRICE_ORACLE_LOCK_KEY', 'carbonledger:lock:price_oracle')
LOCK_TTL = int(os.environ.get('PRICE_ORACLE_LOCK_TTL', 43200))  # 12 hours
WATCHDOG_TIMEOUT_HOURS = int(os.environ.get('PRICE_ORACLE_WATCHDOG_TIMEOUT', 13))
POLL_INTERVAL_HOURS = int(os.environ.get('PRICE_ORACLE_POLL_INTERVAL', 12))

# Price validation thresholds
ZSCORE_THRESHOLD = float(os.environ.get('ZSCORE_THRESHOLD', '2.5'))
PRICE_DEVIATION_ALERT = float(os.environ.get('PRICE_DEVIATION_ALERT', '0.15'))
MIN_SOURCES = int(os.environ.get('MIN_PRICE_SOURCES', '2'))
MIN_PRICE = float(os.environ.get('MIN_PRICE', '0.01'))
MAX_PRICE = float(os.environ.get('MAX_PRICE', '100000.0'))

# Multi-source aggregation config (#584) — all configurable via env, no code
# changes required to retune a source's reliability weight or the outlier
# rejection sensitivity.
SOURCE_WEIGHTS: Dict[str, float] = {
    'xpansiv': float(os.environ.get('SOURCE_WEIGHT_XPANSIV', '1.0')),
    'toucan': float(os.environ.get('SOURCE_WEIGHT_TOUCAN', '1.0')),
    'sdex': float(os.environ.get('SOURCE_WEIGHT_SDEX', '1.0')),
}
OUTLIER_STDDEV_THRESHOLD = float(os.environ.get('OUTLIER_STDDEV_THRESHOLD', '2.0'))

XPANSIV_API_KEY = os.environ.get('XPANSIV_API_KEY', '')
TOUCAN_API_KEY = os.environ.get('TOUCAN_API_KEY', '')
SDEX_HORIZON_URL = os.environ.get('SDEX_HORIZON_URL', 'https://horizon.stellar.org')
USDC_ISSUER = os.environ.get(
    'USDC_ISSUER', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
)

# Redis client
redis_client = redis.Redis(
    host=os.environ.get('REDIS_HOST', 'localhost'),
    port=int(os.environ.get('REDIS_PORT', 6379)),
    db=int(os.environ.get('REDIS_DB', 0)),
    decode_responses=True
)


def aggregate_prices(
    xpansiv_prices: List[Dict],
    toucan_prices: List[Dict],
) -> Dict[str, float]:
    """
    Aggregate prices from multiple sources using weighted average.

    Each source contributes prices for various (methodology, vintage_year)
    pairs. The aggregate is the arithmetic mean of all valid prices for
    each pair.

    Args:
        xpansiv_prices: List of price dicts from Xpansiv.
        toucan_prices: List of price dicts from Toucan.

    Returns:
        Dict mapping (methodology, vintage_year) tuple to aggregated price.
    """
    sources = {"xpansiv": xpansiv_prices, "toucan": toucan_prices}
    return _aggregate_from_sources(sources)


def cross_validate_prices(sources: Dict[str, List[Dict]]) -> Dict[Tuple[str, int], float]:
    """
    Cross-validate prices across multiple independent feeds.

    For each (methodology, vintage_year) key:
      1. Collect every price reported by every source.
      2. Skip the key unless at least MIN_SOURCES distinct sources contributed.
      3. Flag a price as an outlier if |z-score| > ZSCORE_THRESHOLD, or if it
         deviates from the median by more than PRICE_DEVIATION_ALERT (15%).
      4. If any outlier is found, return the median (robust to the outlier);
         otherwise return the arithmetic mean.

    Args:
        sources: Dict mapping source name to list of price dicts.

    Returns:
        Dict mapping (methodology, vintage_year) tuple to cross-validated price.
    """
    raw: Dict[Tuple[str, int], List[Tuple[str, float]]] = {}

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
            key = (methodology, vintage_year)
            raw.setdefault(key, []).append((source_name, price))

    result: Dict[Tuple[str, int], float] = {}

    for key, entries in raw.items():
        distinct_sources = {src for src, _ in entries}
        if len(distinct_sources) < MIN_SOURCES:
            continue

        prices = [p for _, p in entries]
        mean = statistics.mean(prices)
        median = statistics.median(prices)
        std = statistics.pstdev(prices) if len(prices) > 1 else 0.0

        is_outlier = False
        for _, price in entries:
            if std > 0 and abs((price - mean) / std) > ZSCORE_THRESHOLD:
                is_outlier = True
            if median > 0 and abs(price - median) / median > PRICE_DEVIATION_ALERT:
                is_outlier = True

        if is_outlier:
            logger.warning(
                f"cross_validate: outlier detected for {key[0]}/{key[1]} — "
                f"falling back to median ${median:.4f}. sources={dict(entries)}"
            )
            result[key] = median
        else:
            result[key] = mean

    return result


def fetch_xpansiv_prices() -> List[Dict]:
    """Fetch benchmark prices from Xpansiv CBL API.

    Returns a list of dicts with methodology (str), vintage_year (int),
    price_usd (float), volume (float).
    """
    if not XPANSIV_API_KEY:
        logger.warning("XPANSIV_API_KEY not set — skipping Xpansiv feed")
        return []
    try:
        resp = requests.get(
            "https://api.xpansiv.com/v1/carbon/benchmarks",
            headers={"X-API-Key": XPANSIV_API_KEY},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("benchmarks", [])
    except Exception as e:
        logger.error(f"Xpansiv fetch failed: {e}")
        return []


def fetch_toucan_prices() -> List[Dict]:
    """Fetch benchmark prices from Toucan Protocol price feed.

    Returns a list of dicts with methodology (str), vintage_year (int),
    price_usd (float), volume (float).
    """
    if not TOUCAN_API_KEY:
        logger.warning("TOUCAN_API_KEY not set — skipping Toucan feed")
        return []
    try:
        resp = requests.get(
            "https://api.toucan.earth/v1/prices",
            headers={"Authorization": f"Bearer {TOUCAN_API_KEY}"},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("prices", [])
    except Exception as e:
        logger.error(f"Toucan fetch failed: {e}")
        return []


def fetch_sdex_prices() -> List[Dict]:
    """Fetch carbon credit prices from the Stellar DEX (SDEX) via Horizon.

    Queries 24h trade aggregations for known carbon credit asset codes
    against USDC and derives a volume-weighted average price per
    methodology. Asset issuers are read from environment variables
    (SDEX_VCS_ISSUER, SDEX_GS_ISSUER, ...); an asset is skipped if its
    issuer is not configured.

    Returns a list of dicts compatible with the aggregation pipeline:
        methodology (str), vintage_year (int), price_usd (float), volume (float)
    """
    asset_issuers: Dict[str, str] = {
        "VCS": os.environ.get("SDEX_VCS_ISSUER", ""),
        "GS": os.environ.get("SDEX_GS_ISSUER", ""),
        "ACM": os.environ.get("SDEX_ACM_ISSUER", ""),
        "CAR": os.environ.get("SDEX_CAR_ISSUER", ""),
        "REDD": os.environ.get("SDEX_REDD_ISSUER", ""),
    }

    results: List[Dict] = []

    for methodology, issuer in asset_issuers.items():
        if not issuer:
            continue

        vintage_year = int(os.environ.get(f"SDEX_{methodology}_VINTAGE", "0"))
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - 86_400_000  # 24h ago

        url = (
            f"{SDEX_HORIZON_URL}/trade_aggregations"
            f"?base_asset_type=credit_alphanum4"
            f"&base_asset_code={methodology}"
            f"&base_asset_issuer={issuer}"
            f"&counter_asset_type=credit_alphanum4"
            f"&counter_asset_code=USDC"
            f"&counter_asset_issuer={USDC_ISSUER}"
            f"&resolution=3600000"
            f"&start_time={start_ms}"
            f"&end_time={now_ms}"
            f"&order=desc"
            f"&limit=24"
        )

        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            records = resp.json().get("_embedded", {}).get("records", [])
            if not records:
                continue

            total_volume = 0.0
            total_vwap = 0.0
            for rec in records:
                try:
                    avg_price = float(rec.get("avg", 0))
                    base_volume = float(rec.get("base_volume", 0))
                except (TypeError, ValueError):
                    continue
                if avg_price > 0 and base_volume > 0:
                    total_vwap += avg_price * base_volume
                    total_volume += base_volume

            if total_volume == 0:
                continue

            results.append({
                "methodology": methodology,
                "vintage_year": vintage_year,
                "price_usd": total_vwap / total_volume,
                "volume": total_volume,
                "source": "sdex",
            })
        except Exception as e:
            logger.error(f"SDEX fetch failed for {methodology}: {e}")

    return results


class SourceAvailabilityTracker:
    """Tracks per-source fetch success/failure and latency for observability
    and alerting (#584 — "per-source availability metrics logged and
    queryable")."""

    def __init__(self):
        self._stats: Dict[str, Dict] = {}

    def record(self, source: str, success: bool, latency_seconds: float, item_count: int = 0) -> None:
        stats = self._stats.setdefault(source, {
            "total_attempts": 0,
            "total_successes": 0,
            "total_failures": 0,
            "last_success_at": None,
            "last_failure_at": None,
            "last_latency_seconds": None,
            "last_item_count": 0,
        })
        stats["total_attempts"] += 1
        stats["last_latency_seconds"] = latency_seconds
        stats["last_item_count"] = item_count
        now = int(time.time())
        if success:
            stats["total_successes"] += 1
            stats["last_success_at"] = now
        else:
            stats["total_failures"] += 1
            stats["last_failure_at"] = now

    def availability_ratio(self, source: str) -> Optional[float]:
        stats = self._stats.get(source)
        if not stats or stats["total_attempts"] == 0:
            return None
        return stats["total_successes"] / stats["total_attempts"]

    def snapshot(self) -> Dict[str, Dict]:
        return {source: dict(stats) for source, stats in self._stats.items()}


source_availability = SourceAvailabilityTracker()


def get_source_availability() -> Dict[str, Dict]:
    """Return a queryable snapshot of per-source availability metrics."""
    return source_availability.snapshot()


def _fetch_with_availability_tracking(source_name: str, fetch_fn) -> List[Dict]:
    """Run a source fetcher, recording latency/success for availability
    tracking, and log the outcome in a structured, greppable form."""
    start = time.time()
    try:
        items = fetch_fn()
        latency = time.time() - start
        source_availability.record(source_name, success=True, latency_seconds=latency, item_count=len(items))
        logger.info(f"source={source_name} status=ok latency={latency:.3f}s items={len(items)}")
        return items
    except Exception as e:
        latency = time.time() - start
        source_availability.record(source_name, success=False, latency_seconds=latency)
        logger.error(f"source={source_name} status=failed latency={latency:.3f}s error={e}")
        return []


def _trimmed_mean_and_stddev(prices: List[float]) -> Tuple[float, float]:
    """Compute the mean/stddev of `prices` after trimming the single highest
    and lowest values (only once at least 4 values are present, so at least
    2 remain for a meaningful spread)."""
    ordered = sorted(prices)
    trimmed = ordered[1:-1] if len(ordered) >= 4 else ordered
    mean = statistics.mean(trimmed)
    stddev = statistics.pstdev(trimmed) if len(trimmed) > 1 else 0.0
    return mean, stddev


def reject_outlier_sources(
    source_prices: Dict[str, float],
    threshold_stddev: float = OUTLIER_STDDEV_THRESHOLD,
) -> Tuple[Dict[str, float], List[str]]:
    """
    Reject sources whose price deviates more than `threshold_stddev`
    standard deviations from the trimmed mean of all source prices for a
    given (methodology, vintage_year) key (#584 outlier rejection).

    Returns (accepted_prices, rejected_source_names). Never rejects every
    source — if rejection would empty the accepted set, all sources are
    kept (protects against degenerate 2-source disagreement where a
    trimmed-mean comparison is not meaningful).
    """
    if len(source_prices) < 2:
        return dict(source_prices), []

    trimmed_mean, trimmed_stddev = _trimmed_mean_and_stddev(list(source_prices.values()))
    if trimmed_stddev == 0:
        return dict(source_prices), []

    accepted: Dict[str, float] = {}
    rejected: List[str] = []
    for source, price in source_prices.items():
        deviation_stddevs = abs(price - trimmed_mean) / trimmed_stddev
        if deviation_stddevs > threshold_stddev:
            rejected.append(source)
        else:
            accepted[source] = price

    if not accepted:
        return dict(source_prices), []

    return accepted, rejected


def aggregate_weighted_prices(
    sources: Dict[str, List[Dict]],
    weights: Optional[Dict[str, float]] = None,
) -> Dict[Tuple[str, int], float]:
    """
    Aggregate a per-source representative price for each (methodology,
    vintage_year) key, reject statistical outlier sources via
    `reject_outlier_sources`, then combine the surviving sources using
    configurable per-source reliability weights (#584).

    Args:
        sources: Dict mapping source name to list of price dicts.
        weights: Optional override of SOURCE_WEIGHTS (source name -> weight).

    Returns:
        Dict mapping (methodology, vintage_year) tuple to the final weighted price.
    """
    weights = weights if weights is not None else SOURCE_WEIGHTS

    per_source_price: Dict[Tuple[str, int], Dict[str, float]] = {}
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
            key = (methodology, vintage_year)
            bucket = per_source_price.setdefault(key, {})
            # A source may report multiple items for the same key (e.g.
            # several trades); average them into one representative price.
            bucket[source_name] = (
                (bucket[source_name] + price) / 2 if source_name in bucket else price
            )

    result: Dict[Tuple[str, int], float] = {}
    for key, source_prices in per_source_price.items():
        if len(source_prices) < MIN_SOURCES:
            continue

        accepted, rejected = reject_outlier_sources(source_prices)
        if rejected:
            logger.warning(
                f"outlier sources rejected for {key[0]}/{key[1]}: {rejected} "
                f"(all_source_prices={source_prices})"
            )

        total_weight = sum(weights.get(src, 1.0) for src in accepted)
        if total_weight <= 0:
            continue

        result[key] = sum(price * weights.get(src, 1.0) for src, price in accepted.items()) / total_weight

    return result


def compute_twap(
    price_history: List[Dict[str, float]],
    window_seconds: int = 3600,
) -> Optional[float]:
    """
    Compute Time-Weighted Average Price (TWAP) from a price history.

    The TWAP is calculated by weighting each price by the duration it was
    valid, then dividing by the total window duration. This prevents
    manipulation from spike prices that only persist for a short time.

    Args:
        price_history: List of dicts with 'price' and 'timestamp' keys,
                       sorted by timestamp ascending.
        window_seconds: The time window over which to compute the TWAP.

    Returns:
        The TWAP as a float, or None if the history is empty or invalid.
    """
    if not price_history:
        return None

    if len(price_history) == 1:
        price = price_history[0].get("price")
        if price is None or not math.isfinite(price) or price <= 0:
            return None
        return float(price)

    now = time.time()
    window_start = now - window_seconds

    weighted_sum = 0.0
    total_weight = 0.0

    for i, entry in enumerate(price_history):
        price = entry.get("price")
        ts = entry.get("timestamp", now)

        if price is None or not math.isfinite(price) or price <= 0:
            continue

        entry_start = max(ts, window_start)
        entry_end = now if i == len(price_history) - 1 else price_history[i + 1].get("timestamp", now)
        entry_end = min(entry_end, now)

        duration = max(0.0, entry_end - entry_start)
        if duration <= 0:
            continue

        weighted_sum += float(price) * duration
        total_weight += duration

    if total_weight <= 0:
        return None

    return weighted_sum / total_weight


def check_deviation_alert(
    current_price: float,
    reference_price: float,
    threshold: float = PRICE_DEVIATION_ALERT,
) -> bool:
    """
    Check whether the current price deviates from the reference price
    by more than the configured threshold.

    Args:
        current_price: The latest observed price.
        reference_price: The baseline/reference price.
        threshold: Maximum allowed deviation as a fraction (e.g., 0.15 = 15%).

    Returns:
        True if the deviation exceeds the threshold, False otherwise.
    """
    if reference_price <= 0:
        return True

    deviation = abs(current_price - reference_price) / reference_price
    return deviation > threshold


def reject_out_of_range_price(price: float) -> bool:
    """
    Reject a price that is outside the acceptable range.

    Args:
        price: The price to validate.

    Returns:
        True if the price should be rejected, False if it is acceptable.
    """
    if not math.isfinite(price):
        return True
    if price <= 0:
        return True
    if price < MIN_PRICE or price > MAX_PRICE:
        return True
    return False


def _aggregate_from_sources(sources: Dict[str, List[Dict]]) -> Dict[Tuple[str, int], float]:
    """Internal helper to aggregate prices from any number of sources."""
    all_prices: Dict[Tuple[str, int], List[float]] = {}

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
            key = (methodology, vintage_year)
            all_prices.setdefault(key, []).append(price)

    result: Dict[Tuple[str, int], float] = {}
    for key, prices in all_prices.items():
        if prices:
            result[key] = sum(prices) / len(prices)

    return result


class PriceOracle:
    """
    Price Oracle with distributed lock protection
    """
    
    def __init__(self):
        self.lock = DistributedLock(redis_client, LOCK_KEY, LOCK_TTL)
        self.watchdog = StaleLockWatchdog(redis_client, LOCK_KEY, WATCHDOG_TIMEOUT_HOURS)
        self.alert_webhook = os.environ.get('ADMIN_ALERT_WEBHOOK')
        
    def run_price_update_cycle(self) -> bool:
        """
        Run a single price update cycle with lock protection
        
        Returns:
            True if cycle completed, False if skipped
        """
        self.watchdog.check_and_force_release(self.alert_webhook)
        
        if not self.lock.acquire():
            logger.info("Lock held by another instance, skipping price update cycle")
            return False
        
        try:
            logger.info("Starting price update cycle")
            
            price_data = self.fetch_price_data()
            if not price_data:
                logger.error("Failed to fetch price data")
                return False
            
            success = self.submit_price_to_contract(price_data)
            if not success:
                logger.error("Failed to submit price to contract")
                return False

            # Liveness heartbeat after a successful on-chain submission (#576).
            emit_heartbeat(
                'price_oracle',
                detail={'prices_submitted': len(price_data)},
                expected_interval=POLL_INTERVAL_HOURS * 3600,
            )

            logger.info("Price update cycle completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error during price update cycle: {e}")
            return False
            
        finally:
            self.lock.release()
    
    def fetch_price_data(self) -> Optional[Dict[Tuple[str, int], float]]:
        """
        Fetch prices from all configured sources (Xpansiv, Toucan, SDEX),
        recording per-source availability, then aggregate them with
        reliability weighting and outlier rejection (#584).

        Returns a dict of (methodology, vintage_year) -> price, or None if
        no key survived aggregation.
        """
        sources = {
            "xpansiv": _fetch_with_availability_tracking("xpansiv", fetch_xpansiv_prices),
            "toucan": _fetch_with_availability_tracking("toucan", fetch_toucan_prices),
            "sdex": _fetch_with_availability_tracking("sdex", fetch_sdex_prices),
        }

        prices = aggregate_weighted_prices(sources)
        if not prices:
            return None
        return prices

    def submit_price_to_contract(self, price_data: Dict[Tuple[str, int], float]) -> bool:
        """Submit each aggregated (methodology, vintage_year) price to the Soroban contract"""
        for (methodology, vintage_year), price in price_data.items():
            logger.info(f"Submitting price: {methodology}/{vintage_year} = ${price:.4f}")
            # Append to the tamper-evident audit chain (#577). One record per
            # (methodology, vintage_year) so an auditor sees every price the
            # oracle put on chain, not just the batch.
            record_submission(
                'price_oracle',
                'update_credit_price',
                {
                    'methodology': methodology,
                    'vintage_year': vintage_year,
                    'price': price,
                },
                contract_id=os.environ.get('CARBON_ORACLE_CONTRACT_ID'),
            )
        return True
    
    def run_scheduled_cycle(self):
        """Run scheduled cycle with proper logging"""
        logger.info("Scheduled price update cycle started")
        start_time = time.time()
        
        try:
            self.run_price_update_cycle()
        except Exception as e:
            logger.error(f"Scheduled cycle failed: {e}")
        
        duration = time.time() - start_time
        logger.info(f"Scheduled cycle completed in {duration:.2f}s")

def scheduled_price_update():
    """Wrapper function for schedule library"""
    oracle = PriceOracle()
    oracle.run_scheduled_cycle()

if __name__ == "__main__":
    import schedule
    import time
    
    schedule.every(POLL_INTERVAL_HOURS).hours.do(scheduled_price_update)
    
    logger.info(f"Price Oracle started. Polling every {POLL_INTERVAL_HOURS} hours")
    
    while True:
        schedule.run_pending()
        time.sleep(60)
