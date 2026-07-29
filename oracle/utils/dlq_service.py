"""
Dead-Letter Queue Service for Soroban transaction submissions
Handles retry logic, DLQ storage, and reprocessing
"""

import json
import time
import logging
import random
from typing import Optional, Dict, Any, List
import redis
from prometheus_client import Counter, Gauge

logger = logging.getLogger(__name__)

# Prometheus metrics
oracle_dlq_depth = Gauge(
    'oracle_dlq_depth',
    'Number of messages in the dead-letter queue',
    ['queue_type']
)

oracle_dlq_submissions_total = Counter(
    'oracle_dlq_submissions_total',
    'Total number of submissions to DLQ',
    ['status']  # success, retry, failed
)

# Configuration
MAX_RETRIES = int(os.environ.get('DLQ_MAX_RETRIES', 3))
RETRY_DELAYS = [5, 30, 120]  # seconds
DLQ_KEY = os.environ.get('DLQ_KEY', 'carbonledger:dlq:oracle')
RETRY_KEY = os.environ.get('DLQ_RETRY_KEY', 'carbonledger:dlq:retry')
PROCESSING_KEY = os.environ.get('DLQ_PROCESSING_KEY', 'carbonledger:dlq:processing')

class DeadLetterQueue:
    """
    Dead-Letter Queue for failed Soroban transactions
    Handles exponential back-off retry and DLQ storage
    """
    
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.max_retries = MAX_RETRIES
        self.retry_delays = RETRY_DELAYS
        
    def submit_with_retry(
        self,
        tx_type: str,
        project_id: str,
        payload: Dict[str, Any],
        submit_func,
        max_retries: Optional[int] = None
    ) -> bool:
        """
        Submit a transaction with exponential back-off retry
        
        Args:
            tx_type: Type of transaction (e.g., 'price_update', 'verification')
            project_id: Project ID for tracking
            payload: Transaction payload
            submit_func: Function to submit the transaction
            max_retries: Maximum retry attempts (defaults to config)
        
        Returns:
            True if successful, False otherwise
        """
        max_retries = max_retries or self.max_retries
        attempts = 0
        last_error = None
        
        # Get retry delays for this transaction
        delays = self.retry_delays[:max_retries]
        
        while attempts < max_retries:
            try:
                # Attempt submission
                result = submit_func(payload)
                
                # Check if successful
                if result and result.get('success'):
                    oracle_dlq_submissions_total.labels(status='success').inc()
                    logger.info(f"Transaction submitted successfully: {tx_type} {project_id}")
                    return True
                
                # Transaction failed but not necessarily an error
                last_error = result.get('error', 'Unknown error') if result else 'No response'
                
            except Exception as e:
                last_error = str(e)
            
            attempts += 1
            
            # If this was the last attempt, break
            if attempts >= max_retries:
                break
            
            # Calculate delay with jitter
            delay = delays[attempts - 1] if attempts <= len(delays) else delays[-1]
            jitter = random.uniform(0, delay * 0.1)  # 10% jitter
            total_delay = delay + jitter
            
            logger.warning(
                f"Transaction attempt {attempts}/{max_retries} failed for {tx_type} {project_id}: {last_error}. "
                f"Retrying in {total_delay:.2f}s"
            )
            
            # Update metric
            oracle_dlq_submissions_total.labels(status='retry').inc()
            
            time.sleep(total_delay)
        
        # All retries failed - push to DLQ
        logger.error(
            f"Transaction failed after {max_retries} attempts for {tx_type} {project_id}: {last_error}"
        )
        
        self.push_to_dlq({
            'type': tx_type,
            'project_id': project_id,
            'payload': payload,
            'attempts': attempts,
            'last_error': last_error,
            'timestamp': time.time()
        })
        
        oracle_dlq_submissions_total.labels(status='failed').inc()
        return False
    
    def push_to_dlq(self, entry: Dict[str, Any]) -> None:
        """
        Push an entry to the dead-letter queue
        
        Args:
            entry: DLQ entry dictionary
        """
        entry_json = json.dumps(entry)
        self.redis.rpush(DLQ_KEY, entry_json)
        logger.info(f"Pushed to DLQ: {entry.get('type')} {entry.get('project_id')}")
        
        # Update metric
        self._update_dlq_depth()
    
    def pop_from_dlq(self, count: int = 1) -> List[Dict[str, Any]]:
        """
        Pop entries from the dead-letter queue
        
        Args:
            count: Number of entries to pop
        
        Returns:
            List of DLQ entries
        """
        entries = []
        
        for _ in range(count):
            entry_json = self.redis.lpop(DLQ_KEY)
            if not entry_json:
                break
            
            try:
                entry = json.loads(entry_json)
                entries.append(entry)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse DLQ entry: {e}")
        
        # Update metric
        self._update_dlq_depth()
        return entries
    
    def peek_dlq(self, count: int = 10) -> List[Dict[str, Any]]:
        """
        Peek at entries in the dead-letter queue without removing them
        
        Args:
            count: Number of entries to peek
        
        Returns:
            List of DLQ entries
        """
        entries = []
        
        for i in range(min(count, self.get_dlq_length())):
            entry_json = self.redis.lindex(DLQ_KEY, i)
            if not entry_json:
                break
            
            try:
                entry = json.loads(entry_json)
                entries.append(entry)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse DLQ entry: {e}")
        
        return entries
    
    def get_dlq_length(self) -> int:
        """Get the current length of the dead-letter queue"""
        return self.redis.llen(DLQ_KEY)
    
    def clear_dlq(self) -> int:
        """Clear the dead-letter queue"""
        length = self.get_dlq_length()
        self.redis.delete(DLQ_KEY)
        self._update_dlq_depth()
        return length
    
    def _update_dlq_depth(self):
        """Update Prometheus metrics for DLQ depth"""
        depth = self.get_dlq_length()
        oracle_dlq_depth.labels(queue_type='oracle').set(depth)
    
    def reprocess_entry(self, entry: Dict[str, Any], submit_func) -> bool:
        """
        Reprocess a single DLQ entry
        
        Args:
            entry: DLQ entry
            submit_func: Function to submit the transaction
        
        Returns:
            True if successful, False otherwise
        """
        try:
            result = submit_func(entry['payload'])
            if result and result.get('success'):
                logger.info(f"DLQ entry reprocessed successfully: {entry.get('type')} {entry.get('project_id')}")
                oracle_dlq_submissions_total.labels(status='success').inc()
                return True
            else:
                logger.error(f"DLQ entry reprocess failed: {entry}")
                return False
        except Exception as e:
            logger.error(f"DLQ entry reprocess error: {e}")
            return False

class DLQReprocessor:
    """
    Reprocessor for dead-letter queue entries
    Drains the DLQ and re-attempts submissions
    """
    
    def __init__(self, redis_client: redis.Redis, submit_func):
        self.dlq = DeadLetterQueue(redis_client)
        self.submit_func = submit_func
        self.retry_delays = RETRY_DELAYS
        self.max_retries = MAX_RETRIES
    
    def drain(self, batch_size: int = 10, max_retries: Optional[int] = None) -> Dict[str, Any]:
        """
        Drain the dead-letter queue and reprocess entries
        
        Args:
            batch_size: Number of entries to process per batch
            max_retries: Maximum retry attempts per entry
        
        Returns:
            Statistics dictionary
        """
        max_retries = max_retries or self.max_retries
        stats = {
            'processed': 0,
            'success': 0,
            'failed': 0,
            'errors': 0
        }
        
        logger.info(f"Starting DLQ drain: {self.dlq.get_dlq_length()} entries in queue")
        
        while True:
            entries = self.dlq.pop_from_dlq(batch_size)
            if not entries:
                break
            
            for entry in entries:
                stats['processed'] += 1
                success = False
                last_error = None
                
                # Attempt with retry
                for attempt in range(max_retries):
                    try:
                        if self.dlq.reprocess_entry(entry, self.submit_func):
                            success = True
                            break
                    except Exception as e:
                        last_error = str(e)
                        logger.warning(f"Reprocess attempt {attempt + 1} failed: {e}")
                        
                        # Wait before retry
                        delay = self.retry_delays[attempt] if attempt < len(self.retry_delays) else self.retry_delays[-1]
                        time.sleep(delay)
                
                if success:
                    stats['success'] += 1
                    logger.info(f"DLQ entry processed successfully: {entry.get('type')} {entry.get('project_id')}")
                else:
                    stats['failed'] += 1
                    logger.error(f"DLQ entry failed permanently: {entry}")
                    
                    # Re-push to DLQ with updated attempts
                    entry['attempts'] = entry.get('attempts', 0) + 1
                    entry['last_error'] = last_error or 'Permanent failure'
                    entry['timestamp'] = time.time()
                    self.dlq.push_to_dlq(entry)
        
        logger.info(
            f"DLQ drain complete: {stats['processed']} processed, "
            f"{stats['success']} succeeded, {stats['failed']} failed"
        )
        
        return stats
