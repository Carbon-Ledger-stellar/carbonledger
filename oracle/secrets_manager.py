"""
secrets_manager.py

Loads PostgreSQL credentials and the Redis AUTH password from AWS Secrets
Manager, refreshing them without a process restart — the Python-side
counterpart to backend/src/key-rotation/secrets-refresh.service.ts.

Two secrets are read, matching the ones defined in infra/main/secrets.tf:
  - "<project>-<env>/postgres-credentials"  -> {username, password, host, port, dbname}
  - "<project>-<env>/redis-password"        -> {password}

Refresh triggers:
  - SIGHUP (sent as part of the rotation Lambda's finishSecret step, or
    manually: `kill -HUP <pid>`)
  - A 5-minute poll fallback, in case a SIGHUP is ever missed

Usage (see verification_listener.py):
    from secrets_manager import get_database_url, get_redis_password, start_refresh_loop

    start_refresh_loop()  # call once at process startup
    conn = psycopg2.connect(get_database_url())       # call fresh each time — never cache the URL
    client = redis.from_url(REDIS_URL, password=get_redis_password())  # re-fetch on each (re)connect
"""

import os
import json
import signal
import logging
import threading
import time

import boto3

log = logging.getLogger("secrets_manager")

_PROJECT = os.environ.get("PROJECT_NAME", "carbonledger")
_ENV = os.environ.get("NODE_ENV", "staging")

POSTGRES_SECRET_ID = os.environ.get(
    "POSTGRES_SECRET_ID", f"{_PROJECT}-{_ENV}/postgres-credentials"
)
REDIS_SECRET_ID = os.environ.get(
    "REDIS_SECRET_ID", f"{_PROJECT}-{_ENV}/redis-password"
)

POLL_INTERVAL_SECONDS = 5 * 60  # safety net; SIGHUP is the primary refresh path

_client = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "us-east-1"))

_lock = threading.Lock()
_postgres_secret: dict | None = None
_redis_secret: dict | None = None

# Bumped every successful refresh. Callers that cache a connection (like the
# oracle's lazily-initialised Redis client) can compare this value to know
# whether their cached connection was opened before the last rotation and
# needs to be torn down and reopened.
refresh_generation = 0


def _fetch_secret_json(secret_id: str) -> dict:
    response = _client.get_secret_value(SecretId=secret_id)
    return json.loads(response["SecretString"])


def refresh_now() -> None:
    """Fetch the latest values for both secrets. Safe to call from a signal
    handler or a background thread — takes a lock so concurrent refreshes
    (a SIGHUP arriving mid-poll) don't interleave."""
    global _postgres_secret, _redis_secret, refresh_generation

    with _lock:
        try:
            _postgres_secret = _fetch_secret_json(POSTGRES_SECRET_ID)
            _redis_secret = _fetch_secret_json(REDIS_SECRET_ID)
            refresh_generation += 1
            log.info("Rotated secrets refreshed in memory (no restart), generation=%d", refresh_generation)
        except Exception:
            log.exception("Failed to refresh secrets from Secrets Manager")


def _handle_sighup(signum, frame):
    log.info("SIGHUP received — refreshing rotated secrets")
    refresh_now()


def _poll_loop():
    while True:
        time.sleep(POLL_INTERVAL_SECONDS)
        refresh_now()


def start_refresh_loop() -> None:
    """Call once at process startup: does an initial synchronous fetch,
    registers the SIGHUP handler, and starts the poll-fallback thread."""
    refresh_now()
    if _postgres_secret is None or _redis_secret is None:
        raise RuntimeError(
            "Could not load initial secrets from Secrets Manager — "
            f"checked {POSTGRES_SECRET_ID} and {REDIS_SECRET_ID}"
        )

    # SIGHUP is POSIX-only; the oracle services run under systemd on Linux
    # (see oracle/systemd/*.service), so this is safe unconditionally here.
    signal.signal(signal.SIGHUP, _handle_sighup)

    thread = threading.Thread(target=_poll_loop, daemon=True)
    thread.start()


def get_database_url() -> str:
    """Build a fresh postgres:// connection string from the live secret.
    Call this immediately before opening a connection — never cache the
    result, since a rotation can happen at any time."""
    with _lock:
        if _postgres_secret is None:
            raise RuntimeError("Secrets not loaded yet — call start_refresh_loop() first")
        s = _postgres_secret
        return f"postgresql://{s['username']}:{s['password']}@{s['host']}:{s['port']}/{s['dbname']}"


def get_redis_password() -> str:
    with _lock:
        if _redis_secret is None:
            raise RuntimeError("Secrets not loaded yet — call start_refresh_loop() first")
        return _redis_secret["password"]