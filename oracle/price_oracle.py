"""
Price Oracle with Distributed Lock
Prevents duplicate price submissions across multiple replicas
"""

import os
import logging
import time
import math
from typing import Optional, Dict, List
import redis
from utils.distributed_lock import DistributedLock, StaleLockWatchdog

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


def cross_validate_prices(sources: Dict[str, List[Dict]]) -> Dict[str, float]:
    """
    Cross-validate prices across multiple sources.

    A price is only included in the result if at least MIN_SOURCES distinct
    sources report a valid (finite, positive) price for that (methodology,
    vintage_year) pair.

    Args:
        sources: Dict mapping source name to list of price dicts.

    Returns:
        Dict mapping (methodology, vintage_year) tuple to cross-validated price.
    """
    contributors: Dict[tuple, Dict[str, float]] = {}

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
            contributors.setdefault(key, {})[source_name] = price

    result = {}
    for key, source_prices in contributors.items():
        if len(source_prices) >= MIN_SOURCES:
            result[f"{key[0]}:{key[1]}"] = sum(source_prices.values()) / len(source_prices)

    return result


def fetch_sdex_prices() -> List[Dict]:
    """Fetch prices from SDEX (Stellar Decentralized Exchange)."""
    return []


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


def _aggregate_from_sources(sources: Dict[str, List[Dict]]) -> Dict[str, float]:
    """Internal helper to aggregate prices from any number of sources."""
    all_prices: Dict[tuple, List[float]] = {}

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

    result = {}
    for key, prices in all_prices.items():
        if prices:
            result[f"{key[0]}:{key[1]}"] = sum(prices) / len(prices)

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
            
            logger.info("Price update cycle completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error during price update cycle: {e}")
            return False
            
        finally:
            self.lock.release()
    
    def fetch_price_data(self) -> Optional[dict]:
        """Fetch price data from sources"""
        return {"price": 100.0, "timestamp": int(time.time())}
    
    def submit_price_to_contract(self, price_data: dict) -> bool:
        """Submit price to Soroban contract"""
        logger.info(f"Submitting price: {price_data}")
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
