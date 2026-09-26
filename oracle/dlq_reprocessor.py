#!/usr/bin/env python
"""
DLQ Reprocessor - Drains the dead-letter queue and re-attempts submissions
Run as a cron job or scheduled task
"""

import os
import sys
import time
import logging
import argparse
import redis
from utils.dlq_service import DLQReprocessor, DeadLetterQueue

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def submit_mock_payload(payload):
    """Mock submit function - replace with actual Soroban submission"""
    # This is a mock - replace with actual implementation
    logger.info(f"Mock submitting: {payload}")
    return {'success': True}

def get_submit_function(tx_type):
    """Get the appropriate submit function for transaction type"""
    # Replace with actual submit functions from price_oracle and verification_listener
    if tx_type == 'price_update':
        # from price_oracle import submit_price_update
        # return submit_price_update
        return submit_mock_payload
    elif tx_type == 'verification':
        # from verification_listener import submit_verification
        # return submit_verification
        return submit_mock_payload
    else:
        return submit_mock_payload

def main():
    parser = argparse.ArgumentParser(description='DLQ Reprocessor')
    parser.add_argument('--batch-size', type=int, default=10,
                        help='Number of entries to process per batch')
    parser.add_argument('--max-retries', type=int, default=3,
                        help='Maximum retry attempts per entry')
    parser.add_argument('--once', action='store_true',
                        help='Run once and exit')
    parser.add_argument('--interval', type=int, default=300,
                        help='Interval between runs (seconds)')
    parser.add_argument('--clear', action='store_true',
                        help='Clear the DLQ without processing')
    args = parser.parse_args()

    # Initialize Redis client
    redis_client = redis.Redis(
        host=os.environ.get('REDIS_HOST', 'localhost'),
        port=int(os.environ.get('REDIS_PORT', 6379)),
        db=int(os.environ.get('REDIS_DB', 0)),
        decode_responses=True
    )

    # Initialize DLQ
    dlq = DeadLetterQueue(redis_client)

    # Clear DLQ if requested
    if args.clear:
        count = dlq.clear_dlq()
        logger.info(f"Cleared {count} entries from DLQ")
        return

    # Initialize reprocessor
    reprocessor = DLQReprocessor(redis_client, submit_mock_payload)

    # Run once or continuously
    if args.once:
        stats = reprocessor.drain(
            batch_size=args.batch_size,
            max_retries=args.max_retries
        )
        logger.info(f"Processing complete: {stats}")
    else:
        logger.info(f"Starting DLQ reprocessor (interval: {args.interval}s)")
        while True:
            try:
                stats = reprocessor.drain(
                    batch_size=args.batch_size,
                    max_retries=args.max_retries
                )
                if stats['processed'] > 0:
                    logger.info(f"Processed {stats['processed']} entries")
                
                # Check if there are more entries
                remaining = dlq.get_dlq_length()
                if remaining == 0:
                    logger.info("DLQ empty, waiting for new entries...")
                
            except Exception as e:
                logger.error(f"Reprocessor error: {e}")
            
            time.sleep(args.interval)

if __name__ == '__main__':
    main()
