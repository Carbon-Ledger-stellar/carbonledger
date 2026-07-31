"""
Distributed Lock using Redis SET NX PX pattern
Prevents duplicate submissions across multiple replicas
"""

import os
import socket
import time
import logging
from typing import Optional, Any
import redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

class DistributedLock:
    """
    Distributed lock using Redis SET NX PX pattern
    
    Usage:
        lock = DistributedLock(redis_client, "carbonledger:lock:price_oracle", ttl=43200)
        
        if lock.acquire():
            try:
                # Do work
                pass
            finally:
                lock.release()
        else:
            logger.info("Lock held by another instance, skipping cycle")
    """
    
    def __init__(self, redis_client: redis.Redis, lock_key: str, ttl: int = 43200):
        """
        Initialize distributed lock
        
        Args:
            redis_client: Redis client instance
            lock_key: Key for the lock
            ttl: Time to live in seconds (default 12 hours)
        """
        self.redis = redis_client
        self.lock_key = lock_key
        self.ttl = ttl
        self.lock_value = self._get_lock_value()
        self.acquired = False
        
    def _get_lock_value(self) -> str:
        """Generate unique lock value: hostname + pid"""
        hostname = socket.gethostname()
        pid = os.getpid()
        return f"{hostname}:{pid}:{int(time.time())}"
    
    def acquire(self, retry_interval: int = 10, max_retries: int = 0) -> bool:
        """
        Acquire the lock using SET NX PX pattern
        
        Args:
            retry_interval: Seconds between retries
            max_retries: Maximum retry attempts (0 = infinite)
        
        Returns:
            True if lock acquired, False otherwise
        """
        retries = 0
        
        while True:
            try:
                result = self.redis.set(
                    self.lock_key,
                    self.lock_value,
                    nx=True,
                    px=self.ttl * 1000
                )
                
                if result:
                    self.acquired = True
                    logger.info(f"Lock acquired: {self.lock_key} by {self.lock_value}")
                    return True
                
                lock_holder = self.redis.get(self.lock_key)
                logger.info(f"Lock held by another instance: {lock_holder}")
                
                if max_retries > 0 and retries >= max_retries:
                    logger.warning(f"Max retries reached for lock: {self.lock_key}")
                    return False
                
                retries += 1
                time.sleep(retry_interval)
                
            except RedisError as e:
                logger.error(f"Redis error acquiring lock: {e}")
                return False
    
    def release(self) -> bool:
        """
        Release the lock if held by this instance
        Uses Lua script for atomic release (only if value matches)
        
        Returns:
            True if released successfully, False otherwise
        """
        if not self.acquired:
            return False
        
        lua_script = """
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
        """
        
        try:
            result = self.redis.eval(lua_script, 1, self.lock_key, self.lock_value)
            if result:
                logger.info(f"Lock released: {self.lock_key}")
                self.acquired = False
                return True
            else:
                logger.warning(f"Lock already released or held by another: {self.lock_key}")
                return False
        except RedisError as e:
            logger.error(f"Redis error releasing lock: {e}")
            return False
    
    def extend(self, additional_ttl: int) -> bool:
        """
        Extend lock TTL (for long-running operations)
        
        Args:
            additional_ttl: Additional TTL in seconds
        
        Returns:
            True if extended, False otherwise
        """
        try:
            current_value = self.redis.get(self.lock_key)
            if current_value != self.lock_value:
                logger.warning(f"Cannot extend lock: not owner")
                return False
            
            self.redis.expire(self.lock_key, additional_ttl)
            logger.debug(f"Lock extended: {self.lock_key} +{additional_ttl}s")
            return True
            
        except RedisError as e:
            logger.error(f"Redis error extending lock: {e}")
            return False
    
    def is_held(self) -> bool:
        """Check if lock is currently held"""
        current_value = self.redis.get(self.lock_key)
        return current_value is not None
    
    def get_holder(self) -> Optional[str]:
        """Get the current lock holder"""
        return self.redis.get(self.lock_key)
    
    def __enter__(self):
        """Context manager entry"""
        self.acquire()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.release()

class StaleLockWatchdog:
    """
    Watchdog to detect and release stale locks
    """
    
    def __init__(self, redis_client: redis.Redis, lock_key: str, timeout_hours: int = 13):
        """
        Initialize watchdog
        
        Args:
            redis_client: Redis client
            lock_key: Lock key to monitor
            timeout_hours: Hours after which lock is considered stale
        """
        self.redis = redis_client
        self.lock_key = lock_key
        self.timeout_seconds = timeout_hours * 3600
        
    def check_and_force_release(self, alert_webhook: Optional[str] = None) -> bool:
        """
        Check if lock is stale and force release if needed
        
        Args:
            alert_webhook: Webhook URL for alerts
        
        Returns:
            True if lock was released, False otherwise
        """
        try:
            ttl = self.redis.ttl(self.lock_key)
            
            if ttl == -2:
                logger.debug(f"Lock {self.lock_key} not found")
                return False
            
            if ttl == -1:
                logger.warning(f"Lock {self.lock_key} has no expiry, force releasing")
                self.redis.delete(self.lock_key)
                self._send_alert(alert_webhook, "Lock had no expiry, force released")
                return True
            
            if ttl > self.timeout_seconds:
                lock_holder = self.redis.get(self.lock_key)
                logger.warning(f"Stale lock detected: {self.lock_key} held by {lock_holder} for {self.timeout_seconds}s")
                
                self.redis.delete(self.lock_key)
                alert_msg = f"Stale lock force released: {self.lock_key} held by {lock_holder}"
                self._send_alert(alert_webhook, alert_msg)
                return True
            
            return False
            
        except RedisError as e:
            logger.error(f"Redis error checking stale lock: {e}")
            return False
    
    def _send_alert(self, webhook_url: Optional[str], message: str):
        """Send alert via webhook"""
        if not webhook_url:
            logger.warning(f"ALERT: {message}")
            return
        
        try:
            import requests
            response = requests.post(webhook_url, json={"text": message}, timeout=5)
            if response.status_code != 200:
                logger.error(f"Failed to send alert: {response.status_code}")
        except Exception as e:
            logger.error(f"Error sending alert: {e}")
