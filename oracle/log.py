"""
log.py — shared structured JSON logger for all oracle services.

Every line written to stdout is a single JSON object with the fields:
  timestamp, level, service, message

Promtail's JSON pipeline stage extracts `level` and `service` as Loki labels.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level":     record.levelname.lower(),
            "service":   record.__dict__.get("service", os.environ.get("SERVICE_NAME", "oracle")),
            "message":   record.getMessage(),
        })


def get_logger(service: str) -> logging.Logger:
    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())

    logger = logging.getLogger(service)
    logger.setLevel(level)
    logger.handlers = [handler]
    logger.propagate = False
    return logger
