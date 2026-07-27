"""
oracle_logger.py
Structured JSON logger with optional CloudWatch Logs shipping.
All oracle services import get_logger() from here.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError

AWS_REGION        = os.environ.get("AWS_REGION", "us-east-1")
CW_LOG_GROUP      = os.environ.get("AWS_CLOUDWATCH_GROUP", "")
LOG_LEVEL         = os.environ.get("LOG_LEVEL", "INFO").upper()
NODE_ENV          = os.environ.get("NODE_ENV", "development")


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


class _CloudWatchHandler(logging.Handler):
    """Batch-free CloudWatch Logs handler (one PutLogEvents per record)."""

    def __init__(self, log_group: str, log_stream: str, region: str) -> None:
        super().__init__()
        self._group  = log_group
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
            "logGroupName":  self._group,
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
        date_str   = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        stream     = f"{service}-{NODE_ENV}-{date_str}"
        cw_handler = _CloudWatchHandler(CW_LOG_GROUP, stream, AWS_REGION)
        cw_handler.setFormatter(_JsonFormatter(service))
        logger.addHandler(cw_handler)

    logger.propagate = False
    return logger
