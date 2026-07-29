"""
Price Oracle with Distributed Lock
Prevents duplicate price submissions across multiple replicas
"""

import os
import logging
import time
from typing import Optional
import redis
from utils.distributed_lock import DistributedLock, StaleLockWatchdog

logger = logging.getLogger(__name__)

# Configuration
LOCK_KEY = os.environ.get('PRICE_ORACLE_LOCK_KEY', 'carbonledger:lock:price_oracle')
LOCK_TTL = int(os.environ.get('PRICE_ORACLE_LOCK_TTL', 43200))  # 12 hours
WATCHDOG_TIMEOUT_HOURS = int(os.environ.get('PRICE_ORACLE_WATCHDOG_TIMEOUT', 13))
POLL_INTERVAL_HOURS = int(os.environ.get('PRICE_ORACLE_POLL_INTERVAL', 12))

# Redis client
redis_client = redis.Redis(
    host=os.environ.get('REDIS_HOST', 'localhost'),
    port=int(os.environ.get('REDIS_PORT', 6379)),
    db=int(os.environ.get('REDIS_DB', 0)),
    decode_responses=True
)

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
