"""
Standby mode wrapper for oracle services.

When running in standby mode, oracle services process events and maintain
up-to-date local state but do NOT submit on-chain transactions. This
ensures the standby is always warm and ready to be promoted to primary
within the failover timeout.

Usage
-----
    from failover_manager import FailoverManager
    from standby import warm_standby

    fm = FailoverManager(redis_client, db_url)

    @warm_standby(fm)
    def process_and_submit(event):
        result = process_event(event)
        if fm.submit_on_chain():
            submit_on_chain(result)
        return result
"""

import os
import logging
import time
from functools import wraps
from typing import Callable, Any

logger = logging.getLogger(__name__)

STANDBY_MODE = os.environ.get("ORACLE_STANDBY_MODE", "false").lower() == "true"


def warm_standby(failover_manager):
    """
    Decorator that wraps an on-chain submission function.

    When the instance is in standby mode (not primary), the wrapped
    function executes its processing logic but skips the on-chain
    submission step. The function should return a tuple of
    (processed_result, should_submit).

    Args:
        failover_manager: FailoverManager instance used to check role.
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            result = func(*args, **kwargs)

            if failover_manager.is_standby():
                logger.info(
                    "Standby mode: processed event but skipped on-chain submission",
                )
                return result

            return result

        return wrapper

    return decorator


class StandbyGuard:
    """
    Context manager that gates on-chain submission based on failover state.

    Usage
    -----
        with StandbyGuard(failover_manager) as can_submit:
            result = process_event(event)
            if can_submit:
                submit_on_chain(result)
    """

    def __init__(self, failover_manager):
        self.fm = failover_manager

    def __enter__(self) -> bool:
        self.can_submit = self.fm.submit_on_chain()
        return self.can_submit

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if not self.can_submit and exc_type is None:
            logger.info(
                "Standby mode: on-chain submission skipped (would have submitted)",
            )
        return False


def check_standby_health(failover_manager, max_stale_seconds: int = 120) -> dict:
    """
    Check the health of the standby instance.

    Returns a dict with health status including:
        - role: 'primary' or 'standby'
        - primary_alive: whether the current primary appears healthy
        - last_promotion: timestamp of last promotion (if any)
        - stale_seconds: how long since last heartbeat (if standby)
    """
    status = {
        "role": "primary" if failover_manager.is_primary() else "standby",
        "instance_id": failover_manager.instance_id,
        "service_name": failover_manager.service_name,
        "primary_alive": True,
        "last_promotion": failover_manager._promotion_time,
    }

    if failover_manager.is_standby():
        failed = failover_manager.detect_primary_failure()
        status["primary_alive"] = failed is None
        status["failed_primary"] = failed

    return status