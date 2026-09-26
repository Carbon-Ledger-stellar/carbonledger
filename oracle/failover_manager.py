"""
Failover Manager — Leader election and automatic failover for oracle services.

Uses Redis distributed lock for leader election and PostgreSQL for shared state
tracking. When the primary instance fails (lock expires or heartbeat stops),
a standby instance promotes itself to primary within the configured timeout.

Architecture
------------
- Primary: acquires the Redis lock, processes events, and submits on-chain.
- Standby: processes events in warm mode (no on-chain submission), monitors
  the primary heartbeat, and promotes itself when the primary is detected as
  failed.
- Failover detection: lock TTL expiry + PostgreSQL heartbeat timeout.
- Promotion: standby acquires the lock, updates its role in PostgreSQL, and
  begins submitting on-chain.

Configuration (env vars)
------------------------
  FAILOVER_LOCK_KEY        — Redis lock key (default: carbonledger:oracle:failover)
  FAILOVER_LOCK_TTL        — Lock TTL in seconds (default: 120)
  FAILOVER_HEARTBEAT_KEY   — PostgreSQL heartbeat key (default: oracle:heartbeat)
  FAILOVER_HEARTBEAT_TTL   — Heartbeat timeout in seconds (default: 60)
  FAILOVER_PROMOTION_TIMEOUT — Max seconds to wait before promoting (default: 120)
  FAILOVER_INSTANCE_ID     — Unique instance identifier (default: hostname:pid)
  FAILOVER_SERVICE_NAME    — Service name for logging (default: oracle)
"""

import os
import socket
import time
import logging
import uuid
from typing import Optional

import redis
import psycopg2
import psycopg2.extras

from utils.distributed_lock import DistributedLock

logger = logging.getLogger(__name__)

FAILOVER_LOCK_KEY = os.environ.get("FAILOVER_LOCK_KEY", "carbonledger:oracle:failover")
FAILOVER_LOCK_TTL = int(os.environ.get("FAILOVER_LOCK_TTL", 120))
FAILOVER_HEARTBEAT_TTL = int(os.environ.get("FAILOVER_HEARTBEAT_TTL", 60))
FAILOVER_PROMOTION_TIMEOUT = int(os.environ.get("FAILOVER_PROMOTION_TIMEOUT", 120))
FAILOVER_INSTANCE_ID = os.environ.get(
    "FAILOVER_INSTANCE_ID",
    f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}",
)
FAILOVER_SERVICE_NAME = os.environ.get("FAILOVER_SERVICE_NAME", "oracle")


class FailoverManager:
    """
    Manages leader election and automatic failover for oracle services.

    The primary instance holds a Redis distributed lock and writes heartbeats
    to PostgreSQL. Standby instances monitor the heartbeat and promote
    themselves when the primary is detected as failed.
    """

    def __init__(self, redis_client, db_url: str):
        self.redis = redis_client
        self.db_url = db_url
        self.lock = DistributedLock(
            redis_client, FAILOVER_LOCK_KEY, FAILOVER_LOCK_TTL
        )
        self.instance_id = FAILOVER_INSTANCE_ID
        self.service_name = FAILOVER_SERVICE_NAME
        self._is_primary = False
        self._promotion_time: Optional[float] = None

    def is_primary(self) -> bool:
        """Return True if this instance is the current primary."""
        return self._is_primary

    def is_standby(self) -> bool:
        """Return True if this instance is running in standby mode."""
        return not self._is_primary

    def try_promote(self) -> bool:
        """
        Attempt to acquire the leader lock and promote to primary.

        Returns:
            True if promotion succeeded, False if another instance holds the lock.
        """
        if not self.lock.acquire():
            logger.info(
                "Failover: lock %s held by another instance, remaining standby",
                FAILOVER_LOCK_KEY,
            )
            return False

        try:
            self._is_primary = True
            self._promotion_time = time.time()
            self._update_role_in_db("primary")
            logger.info(
                "Failover: instance %s promoted to PRIMARY for service %s",
                self.instance_id,
                self.service_name,
            )
            return True
        except Exception:
            self.lock.release()
            self._is_primary = False
            raise

    def demote(self) -> None:
        """Demote this instance from primary to standby."""
        if not self._is_primary:
            return
        self._is_primary = False
        self._promotion_time = None
        self.lock.release()
        self._update_role_in_db("standby")
        logger.info(
            "Failover: instance %s demoted to STANDBY for service %s",
            self.instance_id,
            self.service_name,
        )

    def heartbeat(self) -> None:
        """
        Write a heartbeat record to PostgreSQL.

        Called periodically by the primary instance to signal it is alive.
        Standby instances also write heartbeats so their last-seen time is
        tracked.
        """
        try:
            with psycopg2.connect(self.db_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO oracle_failover_state
                            (service_name, instance_id, role, last_heartbeat, promoted_at)
                        VALUES (%s, %s, %s, NOW(), %s)
                        ON CONFLICT (service_name, instance_id)
                        DO UPDATE SET
                            last_heartbeat = NOW(),
                            role = EXCLUDED.role,
                            promoted_at = CASE
                                WHEN oracle_failover_state.role = 'standby' AND EXCLUDED.role = 'primary'
                                THEN NOW()
                                ELSE oracle_failover_state.promoted_at
                            END
                        """,
                        (self.service_name, self.instance_id, self._role(), self._promotion_time()),
                    )
                    conn.commit()
        except Exception as e:
            logger.error("Failover: heartbeat failed: %s", e)

    def detect_primary_failure(self) -> Optional[str]:
        """
        Check whether the current primary has failed by inspecting PostgreSQL
        heartbeat timestamps.

        Returns:
            The instance_id of the failed primary, or None if the primary
            appears healthy.
        """
        try:
            with psycopg2.connect(self.db_url) as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT instance_id, role, last_heartbeat
                        FROM oracle_failover_state
                        WHERE service_name = %s AND role = 'primary'
                        ORDER BY last_heartbeat DESC
                        LIMIT 1
                        """,
                        (self.service_name,),
                    )
                    row = cur.fetchone()

            if row is None:
                logger.info("Failover: no primary found for service %s", self.service_name)
                return None

            last_heartbeat = row["last_heartbeat"]
            if last_heartbeat is None:
                return row["instance_id"]

            age_seconds = (time.time() - last_heartbeat.timestamp()) if hasattr(last_heartbeat, 'timestamp') else FAILOVER_HEARTBEAT_TTL + 1
            if age_seconds > FAILOVER_HEARTBEAT_TTL:
                logger.warning(
                    "Failover: primary %s last heartbeat %.0fs ago (threshold %ds)",
                    row["instance_id"],
                    age_seconds,
                    FAILOVER_HEARTBEAT_TTL,
                )
                return row["instance_id"]

            return None
        except Exception as e:
            logger.error("Failover: primary failure detection error: %s", e)
            return None

    def run_failover_cycle(self) -> bool:
        """
        Run one failover detection and promotion cycle.

        Returns:
            True if this instance is primary (either already or after promotion),
            False if still in standby.
        """
        if self._is_primary:
            self.heartbeat()
            return True

        failed_primary = self.detect_primary_failure()
        if failed_primary is not None:
            logger.info(
                "Failover: detected failed primary %s, attempting promotion",
                failed_primary,
            )
            if self.try_promote():
                return True

        return False

    def submit_on_chain(self) -> bool:
        """
        Check whether this instance should submit on-chain transactions.

        Returns:
            True if this instance is primary, False if standby.
        """
        return self._is_primary

    def _role(self) -> str:
        return "primary" if self._is_primary else "standby"

    def _promotion_time(self) -> Optional[float]:
        return self._promotion_time

    def _update_role_in_db(self, role: str) -> None:
        try:
            with psycopg2.connect(self.db_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO oracle_failover_state
                            (service_name, instance_id, role, last_heartbeat, promoted_at)
                        VALUES (%s, %s, %s, NOW(), %s)
                        ON CONFLICT (service_name, instance_id)
                        DO UPDATE SET
                            role = EXCLUDED.role,
                            last_heartbeat = NOW(),
                            promoted_at = CASE
                                WHEN oracle_failover_state.role = 'standby' AND EXCLUDED.role = 'primary'
                                THEN NOW()
                                ELSE oracle_failover_state.promoted_at
                            END
                        """,
                        (self.service_name, self.instance_id, role, self._promotion_time()),
                    )
                    conn.commit()
        except Exception as e:
            logger.error("Failover: failed to update role in DB: %s", e)


def get_failover_manager(redis_client, db_url: str) -> FailoverManager:
    """Factory function for FailoverManager."""
    return FailoverManager(redis_client, db_url)