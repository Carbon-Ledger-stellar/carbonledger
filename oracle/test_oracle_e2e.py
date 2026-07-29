"""
Unit Tests for Distributed Lock using fakeredis
"""

import os
import time
import pytest
import fakeredis
from unittest.mock import patch, MagicMock

from utils.distributed_lock import DistributedLock, StaleLockWatchdog
from price_oracle import PriceOracle
from verification_listener import VerificationListener

@pytest.fixture
def redis_client():
    return fakeredis.FakeRedis(decode_responses=True)

@pytest.fixture
def lock(redis_client):
    return DistributedLock(redis_client, "test:lock", ttl=60)

@pytest.fixture
def watchdog(redis_client):
    return StaleLockWatchdog(redis_client, "test:lock", timeout_hours=1)

class TestDistributedLock:
    
    def test_acquire_lock_success(self, lock):
        assert lock.acquire() is True
        assert lock.acquired is True
        
        lock_value = lock.redis.get(lock.lock_key)
        assert lock_value == lock.lock_value
    
    def test_acquire_lock_fails_if_held(self, lock):
        assert lock.acquire() is True
        
        lock2 = DistributedLock(lock.redis, "test:lock", ttl=60)
        assert lock2.acquire() is False
        assert lock2.acquired is False
    
    def test_release_lock_success(self, lock):
        assert lock.acquire() is True
        assert lock.release() is True
        assert lock.acquired is False
        
        lock_value = lock.redis.get(lock.lock_key)
        assert lock_value is None
    
    def test_release_only_owner(self, lock):
        assert lock.acquire() is True
        original_value = lock.lock_value
        
        lock2 = DistributedLock(lock.redis, "test:lock", ttl=60)
        assert lock2.release() is False
        
        lock_value = lock.redis.get(lock.lock_key)
        assert lock_value == original_value
    
    def test_extend_lock(self, lock):
        assert lock.acquire() is True
        
        initial_ttl = lock.redis.ttl(lock.lock_key)
        
        assert lock.extend(120) is True
        
        new_ttl = lock.redis.ttl(lock.lock_key)
        assert new_ttl > initial_ttl or new_ttl == 120
    
    def test_lock_holder_identity(self, lock):
        assert lock.acquire() is True
        
        holder = lock.get_holder()
        assert holder == lock.lock_value
        assert ':' in holder
    
    def test_is_held(self, lock):
        assert lock.is_held() is False
        
        lock.acquire()
        assert lock.is_held() is True
        
        lock.release()
        assert lock.is_held() is False

class TestStaleLockWatchdog:
    
    def test_check_stale_lock(self, redis_client, watchdog):
        redis_client.set("test:lock", "stale:holder:123", ex=3600)
        
        assert watchdog.check_and_force_release() is True
        
        lock_value = redis_client.get("test:lock")
        assert lock_value is None
    
    def test_check_non_stale_lock(self, redis_client, watchdog):
        redis_client.set("test:lock", "recent:holder:123", ex=10)
        
        assert watchdog.check_and_force_release() is False
        
        lock_value = redis_client.get("test:lock")
        assert lock_value is not None
    
    def test_no_lock(self, redis_client, watchdog):
        assert watchdog.check_and_force_release() is False
    
    def test_alert_webhook(self, redis_client, watchdog):
        redis_client.set("test:lock", "stale:holder:123", ex=3600)
        
        with patch('requests.post') as mock_post:
            watchdog.check_and_force_release("https://example.com/webhook")
            mock_post.assert_called_once()

class TestPriceOracleIntegration:
    
    def test_price_oracle_runs_with_lock(self, redis_client):
        with patch('price_oracle.redis_client', redis_client):
            oracle = PriceOracle()
            oracle.lock.redis = redis_client
            
            result = oracle.run_price_update_cycle()
    
    def test_price_oracle_skips_if_lock_held(self, redis_client):
        lock = DistributedLock(redis_client, "carbonledger:lock:price_oracle", ttl=60)
        lock.acquire()
        
        with patch('price_oracle.redis_client', redis_client):
            oracle = PriceOracle()
            oracle.lock.redis = redis_client
            
            result = oracle.run_price_update_cycle()
            assert result is False

class TestVerificationListenerIntegration:
    
    def test_verification_listener_runs_with_lock(self, redis_client):
        with patch('verification_listener.redis_client', redis_client):
            listener = VerificationListener()
            listener.lock.redis = redis_client
            
            result = listener.process_verification_cycle()
    
    def test_verification_listener_skips_if_lock_held(self, redis_client):
        lock = DistributedLock(redis_client, "carbonledger:lock:verification_listener", ttl=60)
        lock.acquire()
        
        with patch('verification_listener.redis_client', redis_client):
            listener = VerificationListener()
            listener.lock.redis = redis_client
            
            result = listener.process_verification_cycle()
            assert result is False

class TestConcurrentLockAcquisition:
    
    def test_concurrent_lock_acquisition(self, redis_client):
        locks = []
        results = []
        
        for i in range(5):
            lock = DistributedLock(redis_client, "test:lock:concurrent", ttl=60)
            lock.lock_value = f"replica_{i}:pid:{int(time.time())}"
            locks.append(lock)
        
        for lock in locks:
            result = lock.acquire()
            results.append(result)
        
        assert sum(results) == 1
        
        holder = redis_client.get("test:lock:concurrent")
        assert holder == locks[0].lock_value
    
    def test_contention_retry(self, redis_client):
        lock1 = DistributedLock(redis_client, "test:lock:contention", ttl=60)
        lock1.acquire()
        
        lock2 = DistributedLock(redis_client, "test:lock:contention", ttl=60)
        with patch('time.sleep') as mock_sleep:
            result = lock2.acquire(max_retries=3)
            assert result is False
            assert mock_sleep.call_count == 3

if __name__ == "__main__":
    pytest.main([__file__])
