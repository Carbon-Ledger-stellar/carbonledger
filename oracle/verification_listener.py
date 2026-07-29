"""
Verification Listener with Distributed Lock
Prevents duplicate verification processing across multiple replicas
"""

import os
import logging
import time
from typing import Optional
import redis
from utils.distributed_lock import DistributedLock, StaleLockWatchdog

logger = logging.getLogger(__name__)

LOCK_KEY = os.environ.get('VERIFICATION_LOCK_KEY', 'carbonledger:lock:verification_listener')
LOCK_TTL = int(os.environ.get('VERIFICATION_LOCK_TTL', 300))
WATCHDOG_TIMEOUT_MINUTES = int(os.environ.get('VERIFICATION_WATCHDOG_TIMEOUT', 10))

redis_client = redis.Redis(
    host=os.environ.get('REDIS_HOST', 'localhost'),
    port=int(os.environ.get('REDIS_PORT', 6379)),
    db=int(os.environ.get('REDIS_DB', 0)),
    decode_responses=True
)

class VerificationListener:
    """
    Verification Listener with distributed lock protection
    """
    
    def __init__(self):
        self.lock = DistributedLock(redis_client, LOCK_KEY, LOCK_TTL)
        self.watchdog = StaleLockWatchdog(redis_client, LOCK_KEY, WATCHDOG_TIMEOUT_MINUTES / 60)
        self.alert_webhook = os.environ.get('ADMIN_ALERT_WEBHOOK')
        
    def process_verification_cycle(self) -> bool:
        """
        Process a single verification cycle with lock protection
        
        Returns:
            True if cycle completed, False if skipped
        """
        self.watchdog.check_and_force_release(self.alert_webhook)
        
        if not self.lock.acquire():
            logger.info("Lock held by another instance, skipping verification cycle")
            return False
        
        try:
            logger.info("Starting verification cycle")
            
            pending = self.fetch_pending_verifications()
            if not pending:
                logger.info("No pending verifications")
                return True
            
            for verification in pending:
                success = self.process_verification(verification)
                if success:
                    logger.info(f"Verification processed: {verification.get('id')}")
                else:
                    logger.error(f"Verification failed: {verification.get('id')}")
            
            logger.info(f"Verification cycle completed, processed {len(pending)} items")
            return True
            
        except Exception as e:
            logger.error(f"Error during verification cycle: {e}")
            return False
            
        finally:
            self.lock.release()
    
    def fetch_pending_verifications(self) -> list:
        """Fetch pending verifications from queue"""
        return []
    
    def process_verification(self, verification: dict) -> bool:
        """Process a single verification"""
        logger.info(f"Processing verification: {verification}")
        return True
    
    def run_scheduled_cycle(self):
        """Run scheduled cycle with proper logging"""
        logger.info("Scheduled verification cycle started")
        start_time = time.time()
        
        try:
            self.process_verification_cycle()
        except Exception as e:
            logger.error(f"Scheduled cycle failed: {e}")
        
        duration = time.time() - start_time
        logger.info(f"Scheduled cycle completed in {duration:.2f}s")

def scheduled_verification_cycle():
    """Wrapper function for schedule library"""
    listener = VerificationListener()
    listener.run_scheduled_cycle()

if __name__ == "__main__":
    import schedule
    import time
    
    schedule.every(5).minutes.do(scheduled_verification_cycle)
    
    logger.info("Verification Listener started. Polling every 5 minutes")
    
    while True:
        schedule.run_pending()
        time.sleep(30)
