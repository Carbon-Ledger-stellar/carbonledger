"""
Oracle logging and metrics collection
Exports Prometheus metrics including DLQ depth
"""

import logging
import os
from prometheus_client import start_http_server, Counter, Gauge, Histogram
import redis

# Initialize logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Prometheus metrics
oracle_transactions_total = Counter(
    'oracle_transactions_total',
    'Total number of transactions submitted',
    ['type', 'status']  # type: price_update, verification
)

oracle_transaction_duration = Histogram(
    'oracle_transaction_duration_seconds',
    'Duration of transaction submissions',
    ['type']
)

oracle_dlq_depth = Gauge(
    'oracle_dlq_depth',
    'Number of messages in the dead-letter queue',
    ['queue_type']
)

oracle_dlq_processed_total = Counter(
    'oracle_dlq_processed_total',
    'Total number of DLQ entries processed',
    ['status']  # success, failed
)

oracle_errors_total = Counter(
    'oracle_errors_total',
    'Total number of oracle errors',
    ['type']  # network, timeout, contract, unknown
)

# Redis client for DLQ metrics
def update_dlq_metrics():
    """Update DLQ metrics from Redis"""
    try:
        redis_client = redis.Redis(
            host=os.environ.get('REDIS_HOST', 'localhost'),
            port=int(os.environ.get('REDIS_PORT', 6379)),
            db=int(os.environ.get('REDIS_DB', 0)),
            decode_responses=True
        )
        
        dlq_key = os.environ.get('DLQ_KEY', 'carbonledger:dlq:oracle')
        depth = redis_client.llen(dlq_key)
        oracle_dlq_depth.labels(queue_type='oracle').set(depth)
        
    except Exception as e:
        logging.error(f"Failed to update DLQ metrics: {e}")

def start_metrics_server(port: int = 8000):
    """Start Prometheus metrics server"""
    start_http_server(port)
    logging.info(f"Prometheus metrics server started on port {port}")
    
    # Start background task to update DLQ metrics
    import threading
    def update_loop():
        while True:
            import time
            time.sleep(60)
            update_dlq_metrics()
    
    thread = threading.Thread(target=update_loop, daemon=True)
    thread.start()

# Export metrics functions
def record_transaction(tx_type: str, status: str, duration: float):
    """Record transaction metrics"""
    oracle_transactions_total.labels(type=tx_type, status=status).inc()
    oracle_transaction_duration.labels(type=tx_type).observe(duration)

def record_dlq_processed(status: str):
    """Record DLQ processing metrics"""
    oracle_dlq_processed_total.labels(status=status).inc()

def record_error(error_type: str):
    """Record error metrics"""
    oracle_errors_total.labels(type=error_type).inc()
