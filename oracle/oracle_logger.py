"""
Oracle logging and metrics collection
Exports Prometheus metrics including DLQ depth
Structured JSON logger with optional CloudWatch Logs shipping
"""

import json
import logging
import os
import uuid
import threading
import time
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError
from prometheus_client import start_http_server, Counter, Gauge, Histogram
import redis

# ============================================
# Configuration
# ============================================

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
CW_LOG_GROUP = os.environ.get("AWS_CLOUDWATCH_GROUP", "")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
NODE_ENV = os.environ.get("NODE_ENV", "development")

# ============================================
# Prometheus Metrics
# ============================================

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

# ============================================
# JSON Formatter
# ============================================

class _JsonFormatter(logging.Formatter):
    """Emit each log record as a single JSON line."""

    def __init__(self, service: str) -> None:
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": self.service,
            "message": record.getMessage(),
        }
        # Merge any extra fields passed via logger.info("msg", extra={...})
        for key, val in record.__dict__.items():
            if key not in (
                "args", "created", "exc_info", "exc_text", "filename",
                "funcName", "levelname", "levelno", "lineno", "message",
                "module", "msecs", "msg", "name", "pathname", "process",
                "processName", "relativeCreated", "stack_info", "thread",
                "threadName",
            ):
                payload[key] = val
        if record.exc_info:
            payload["stack"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)

# ============================================
# CloudWatch Handler
# ============================================

class _CloudWatchHandler(logging.Handler):
    """Batch-free CloudWatch Logs handler (one PutLogEvents per record)."""

    def __init__(self, log_group: str, log_stream: str, region: str) -> None:
        super().__init__()
        self._group = log_group
        self._stream = log_stream
        self._client = boto3.client("logs", region_name=region)
        self._seq_token: str | None = None
        self._ensure_stream()

    def _ensure_stream(self) -> None:
        try:
            self._client.create_log_group(logGroupName=self._group)
            self._client.put_retention_policy(
                logGroupName=self._group, retentionInDays=90
            )
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceAlreadyExistsException":
                raise
        try:
            self._client.create_log_stream(
                logGroupName=self._group, logStreamName=self._stream
            )
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceAlreadyExistsException":
                raise

    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        kwargs: dict[str, Any] = {
            "logGroupName": self._group,
            "logStreamName": self._stream,
            "logEvents": [{"timestamp": int(record.created * 1000), "message": msg}],
        }
        if self._seq_token:
            kwargs["sequenceToken"] = self._seq_token
        try:
            resp = self._client.put_log_events(**kwargs)
            self._seq_token = resp.get("nextSequenceToken")
        except ClientError:
            self.handleError(record)

# ============================================
# Logger Factory
# ============================================

def get_logger(service: str) -> logging.Logger:
    """Return a structured logger for the given oracle service name."""
    logger = logging.getLogger(service)
    if logger.handlers:
        return logger  # already configured

    logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

    console = logging.StreamHandler()
    console.setFormatter(_JsonFormatter(service))
    logger.addHandler(console)

    if CW_LOG_GROUP:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        stream = f"{service}-{NODE_ENV}-{date_str}"
        cw_handler = _CloudWatchHandler(CW_LOG_GROUP, stream, AWS_REGION)
        cw_handler.setFormatter(_JsonFormatter(service))
        logger.addHandler(cw_handler)

    logger.propagate = False
    return logger

# ============================================
# DLQ Metrics Update
# ============================================

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

# ============================================
# Metrics Server
# ============================================

def start_metrics_server(port: int = 8000):
    """Start Prometheus metrics server"""
    start_http_server(port)
    logging.info(f"Prometheus metrics server started on port {port}")

    # Start background task to update DLQ metrics
    def update_loop():
        while True:
            time.sleep(60)
            update_dlq_metrics()

    thread = threading.Thread(target=update_loop, daemon=True)
    thread.start()

# ============================================
# Export Metrics Functions
# ============================================

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