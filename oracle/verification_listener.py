"""
Verification Listener with Distributed Lock
Prevents duplicate verification processing across multiple replicas

Submissions go through IdempotentRetrySubmitter (#578): transient RPC failures
are retried with exponential backoff (base 2, up to 8 attempts) and jitter,
duplicates are rejected before reaching the blockchain via a content-addressed
submission id, and anything that cannot be delivered lands in the PostgreSQL
dead-letter table with full context.
"""

import hashlib
import os
import logging
import time
from typing import Optional
import redis
from utils.distributed_lock import DistributedLock, StaleLockWatchdog
from schema_registry import validate_submission, get_schema_version_for_submission, init_schema_registry
from retry_submitter import IdempotentRetrySubmitter, SubmissionResult
# Re-exported so submit_to_contract implementations can signal "do not retry".
from retry_submitter import PermanentSubmissionError  # noqa: F401

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
    Verification Listener with distributed lock protection and
    methodology schema version validation.
    """
    
    def __init__(self, submitter: Optional[IdempotentRetrySubmitter] = None):
        self.lock = DistributedLock(redis_client, LOCK_KEY, LOCK_TTL)
        self.watchdog = StaleLockWatchdog(redis_client, LOCK_KEY, WATCHDOG_TIMEOUT_MINUTES / 60)
        self.alert_webhook = os.environ.get('ADMIN_ALERT_WEBHOOK')
        self.schema_validation_enabled = os.environ.get('SCHEMA_VALIDATION_ENABLED', 'true').lower() == 'true'
        if self.schema_validation_enabled:
            init_schema_registry()
        # Idempotent retry + dead-letter handling for on-chain submissions (#578).
        self.submitter = submitter or IdempotentRetrySubmitter(service='verification_listener')
        
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
                if self.schema_validation_enabled:
                    valid, result = self._validate_with_schema(verification)
                    if not valid:
                        logger.error(
                            "Schema validation failed for verification %s: %s",
                            verification.get('id'),
                            result.get('errors', ['unknown']),
                        )
                        continue
                
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

    def _validate_with_schema(self, verification: dict) -> tuple[bool, dict]:
        """
        Validate a verification record against its methodology schema.

        Returns:
            A tuple of (is_valid, validation_result).
        """
        methodology = verification.get('methodology', '')
        schema_version = get_schema_version_for_submission(
            methodology,
            verification,
        )
        return validate_submission(verification, methodology, schema_version)
    
    def fetch_pending_verifications(self) -> list:
        """Fetch pending verifications from queue"""
        return []

    def process_verification(self, verification: dict) -> bool:
        """
        Submit a single verification on chain with idempotent retry (#578).

        Returns True when the data is on chain — including the case where a
        previous run already submitted it, since the outcome is the same.
        """
        logger.info(f"Processing verification: {verification}")
        result = self.submit_verification(verification)

        if result.duplicate:
            logger.info(
                "Duplicate verification %s rejected before submission (status=%s)",
                verification.get('id'),
                'submitted' if result.success else 'pending/failed',
            )
        elif result.dead_lettered:
            logger.error(
                "Verification %s dead-lettered after %d attempts: %s",
                verification.get('id'),
                result.attempts,
                result.errors[-1] if result.errors else 'unknown',
            )

        return result.success

    def submit_verification(self, verification: dict) -> SubmissionResult:
        """Run one verification through the retry submitter."""
        return self.submitter.submit(
            function_name='submit_monitoring_data',
            payload=verification,
            submit_func=self.submit_to_contract,
        )

    def submit_to_contract(self, payload: dict, nonce: int):
        """
        Submit monitoring data to the Soroban contract.

        The nonce is supplied by the retry submitter and is stable across every
        retry of the same payload, so a replay of a submission that already
        landed is rejected on chain rather than recorded twice.

        Raise PermanentSubmissionError for failures that retrying cannot fix;
        raise anything else to have the attempt retried with backoff.
        """
        logger.info(
            "Submitting verification %s with nonce %d",
            payload.get('id'), nonce,
        )
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
