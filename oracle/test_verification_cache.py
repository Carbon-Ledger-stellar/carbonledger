"""
test_verification_cache.py

Unit tests for the verification result caching layer in verification_listener.py.

Covers:
  - Cache hits and misses
  - TTL / staleness detection (>= 6 hours)
  - Cache invalidation ordering
  - Write-through consistency
  - Fallback to database on miss/stale
  - Multiple oracle instances (shared Redis state)
  - Redis unavailability (graceful degradation)
  - get_verification_result() end-to-end

closes #538
"""

import json
import time
import unittest
from unittest.mock import patch, MagicMock, call

# We import the module under test after patching os.environ so the
# module-level load_dotenv() and env reads don't fail in CI.
import os
os.environ.setdefault("ORACLE_SECRET_KEY",          "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")
os.environ.setdefault("CARBON_ORACLE_CONTRACT_ID",  "C" + "A" * 55)
os.environ.setdefault("CARBON_REGISTRY_CONTRACT_ID","C" + "B" * 55)
os.environ.setdefault("DATABASE_URL",               "postgresql://user:pass@localhost/test")

import verification_listener as vl


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_redis_mock(store: dict | None = None):
    """Return a Mock that behaves like a minimal Redis client backed by a dict."""
    if store is None:
        store = {}

    m = MagicMock()
    m.ping.return_value = True

    def _get(key):
        entry = store.get(key)
        return entry if entry is not None else None

    def _setex(key, ttl, value):
        store[key] = value

    def _delete(*keys):
        deleted = 0
        for k in keys:
            if k in store:
                del store[k]
                deleted += 1
        return deleted

    def _scan_iter(pattern):
        return iter(list(store.keys()))

    m.get.side_effect      = _get
    m.setex.side_effect    = _setex
    m.delete.side_effect   = _delete
    m.scan_iter.side_effect = _scan_iter
    return m, store


def _patch_redis(mock_client):
    """Patch _get_redis to return mock_client and reset the module-level cache."""
    vl._redis_client = mock_client
    return mock_client


def _reset_redis():
    vl._redis_client = None


# ── Test cases ────────────────────────────────────────────────────────────────

class TestCacheGet(unittest.TestCase):
    """cache_get() — hit, miss, staleness."""

    def setUp(self):
        _reset_redis()

    def test_cache_miss_when_redis_empty(self):
        mock, _ = _make_redis_mock({})
        _patch_redis(mock)
        result = vl.cache_get("proj-001", "2023-Q1")
        self.assertIsNone(result)

    def test_cache_hit_returns_payload(self):
        payload = {
            "project_id": "proj-001", "period": "2023-Q1",
            "tonnes_verified": 5000, "status": "SUBMITTED",
            "_refreshed_at": time.time(),
        }
        key = vl._cache_key("proj-001", "2023-Q1")
        mock, store = _make_redis_mock({key: json.dumps(payload)})
        _patch_redis(mock)
        result = vl.cache_get("proj-001", "2023-Q1")
        self.assertIsNotNone(result)
        self.assertEqual(result["project_id"], "proj-001")
        self.assertEqual(result["tonnes_verified"], 5000)

    def test_cache_miss_when_redis_unavailable(self):
        _patch_redis(None)
        result = vl.cache_get("proj-001", "2023-Q1")
        self.assertIsNone(result)

    def test_cache_stale_when_refreshed_at_over_6_hours_ago(self):
        stale_ts = time.time() - (vl.CACHE_STALE_SECONDS + 60)  # 60s past threshold
        payload = {
            "project_id": "proj-001", "period": "2023-Q1",
            "tonnes_verified": 5000, "status": "SUBMITTED",
            "_refreshed_at": stale_ts,
        }
        key = vl._cache_key("proj-001", "2023-Q1")
        mock, _ = _make_redis_mock({key: json.dumps(payload)})
        _patch_redis(mock)
        result = vl.cache_get("proj-001", "2023-Q1")
        self.assertIsNone(result, "Entry older than CACHE_STALE_SECONDS should be treated as a miss")

    def test_cache_fresh_just_under_6_hours(self):
        fresh_ts = time.time() - (vl.CACHE_STALE_SECONDS - 60)  # 60s before threshold
        payload = {
            "project_id": "proj-001", "period": "2023-Q1",
            "_refreshed_at": fresh_ts, "status": "SUBMITTED",
        }
        key = vl._cache_key("proj-001", "2023-Q1")
        mock, _ = _make_redis_mock({key: json.dumps(payload)})
        _patch_redis(mock)
        result = vl.cache_get("proj-001", "2023-Q1")
        self.assertIsNotNone(result, "Entry younger than CACHE_STALE_SECONDS should be a HIT")

    def test_cache_stale_exactly_at_threshold(self):
        # Exactly at threshold is stale (>= comparison)
        stale_ts = time.time() - vl.CACHE_STALE_SECONDS
        payload = {"project_id": "p", "period": "q", "_refreshed_at": stale_ts}
        key = vl._cache_key("p", "q")
        mock, _ = _make_redis_mock({key: json.dumps(payload)})
        _patch_redis(mock)
        result = vl.cache_get("p", "q")
        self.assertIsNone(result)

    def test_cache_missing_refreshed_at_field_treated_as_stale(self):
        payload = {"project_id": "p", "period": "q"}  # no _refreshed_at
        key = vl._cache_key("p", "q")
        mock, _ = _make_redis_mock({key: json.dumps(payload)})
        _patch_redis(mock)
        result = vl.cache_get("p", "q")
        self.assertIsNone(result)

    def test_cache_get_redis_exception_returns_none(self):
        mock = MagicMock()
        mock.get.side_effect = Exception("connection refused")
        _patch_redis(mock)
        result = vl.cache_get("proj-001", "2023-Q1")
        self.assertIsNone(result)


class TestCacheSet(unittest.TestCase):
    """cache_set() — write-through behaviour."""

    def setUp(self):
        _reset_redis()

    def test_cache_set_stores_payload(self):
        mock, store = _make_redis_mock()
        _patch_redis(mock)
        vl.cache_set("proj-001", "2023-Q1", {"project_id": "proj-001", "status": "SUBMITTED"})
        key = vl._cache_key("proj-001", "2023-Q1")
        self.assertIn(key, store)
        stored = json.loads(store[key])
        self.assertEqual(stored["project_id"], "proj-001")
        self.assertIn("_refreshed_at", stored, "cache_set must inject _refreshed_at")

    def test_cache_set_injects_refreshed_at_close_to_now(self):
        mock, store = _make_redis_mock()
        _patch_redis(mock)
        before = time.time()
        vl.cache_set("p", "q", {"data": "x"})
        after = time.time()
        key = vl._cache_key("p", "q")
        stored = json.loads(store[key])
        self.assertGreaterEqual(stored["_refreshed_at"], before)
        self.assertLessEqual(stored["_refreshed_at"], after)

    def test_cache_set_uses_correct_ttl(self):
        mock, _ = _make_redis_mock()
        _patch_redis(mock)
        vl.cache_set("p", "q", {"data": "x"})
        # Verify setex was called with the configured TTL
        call_args = mock.setex.call_args
        self.assertEqual(call_args[0][1], vl.CACHE_TTL_SECONDS)

    def test_cache_set_returns_false_when_redis_unavailable(self):
        _patch_redis(None)
        result = vl.cache_set("p", "q", {"data": "x"})
        self.assertFalse(result)

    def test_cache_set_returns_false_on_redis_exception(self):
        mock = MagicMock()
        mock.setex.side_effect = Exception("write error")
        _patch_redis(mock)
        result = vl.cache_set("p", "q", {"data": "x"})
        self.assertFalse(result)

    def test_cache_set_overwrites_stale_entry(self):
        stale_ts = time.time() - (vl.CACHE_STALE_SECONDS + 100)
        key = vl._cache_key("p", "q")
        mock, store = _make_redis_mock({key: json.dumps({"_refreshed_at": stale_ts, "v": 1})})
        _patch_redis(mock)
        vl.cache_set("p", "q", {"v": 2})
        stored = json.loads(store[key])
        self.assertEqual(stored["v"], 2)
        self.assertGreater(stored["_refreshed_at"], stale_ts)


class TestCacheInvalidate(unittest.TestCase):
    """cache_invalidate() — atomic deletion."""

    def setUp(self):
        _reset_redis()

    def test_invalidate_deletes_existing_entry(self):
        key = vl._cache_key("proj-001", "2023-Q1")
        mock, store = _make_redis_mock({key: json.dumps({"data": "x", "_refreshed_at": time.time()})})
        _patch_redis(mock)
        result = vl.cache_invalidate("proj-001", "2023-Q1")
        self.assertTrue(result)
        self.assertNotIn(key, store)

    def test_invalidate_nonexistent_key_returns_true(self):
        mock, _ = _make_redis_mock()
        _patch_redis(mock)
        result = vl.cache_invalidate("proj-001", "2023-Q1")
        self.assertTrue(result)

    def test_invalidate_then_get_returns_none(self):
        payload = {"project_id": "p", "period": "q", "_refreshed_at": time.time()}
        key = vl._cache_key("p", "q")
        mock, store = _make_redis_mock({key: json.dumps(payload)})
        _patch_redis(mock)
        # Verify hit before invalidation
        self.assertIsNotNone(vl.cache_get("p", "q"))
        vl.cache_invalidate("p", "q")
        # Must be a miss after invalidation
        self.assertIsNone(vl.cache_get("p", "q"))

    def test_invalidate_returns_false_when_redis_unavailable(self):
        _patch_redis(None)
        result = vl.cache_invalidate("p", "q")
        self.assertFalse(result)

    def test_invalidate_returns_false_on_redis_exception(self):
        mock = MagicMock()
        mock.delete.side_effect = Exception("delete error")
        _patch_redis(mock)
        result = vl.cache_invalidate("p", "q")
        self.assertFalse(result)


class TestCacheInvalidateOrdering(unittest.TestCase):
    """Invalidation MUST happen before the new write-through set."""

    def setUp(self):
        _reset_redis()

    def test_invalidate_before_set_ordering(self):
        """
        Simulate the sequence used after on-chain submission:
            1. cache_invalidate(project_id, period)
            2. cache_set(project_id, period, new_data)
        The final state must be the new data, not the old.
        """
        old_payload = {"project_id": "p", "period": "q",
                       "tonnes_verified": 100, "_refreshed_at": time.time() - 10}
        key = vl._cache_key("p", "q")
        mock, store = _make_redis_mock({key: json.dumps(old_payload)})
        _patch_redis(mock)

        new_data = {"project_id": "p", "period": "q", "tonnes_verified": 200, "status": "SUBMITTED"}
        vl.cache_invalidate("p", "q")
        vl.cache_set("p", "q", new_data)

        result = vl.cache_get("p", "q")
        self.assertIsNotNone(result)
        self.assertEqual(result["tonnes_verified"], 200)

    def test_set_before_invalidate_also_works(self):
        """
        Even if the caller sets before invalidating, the final read should
        return a fresh entry (set-wins over invalidate since set overwrites).
        """
        mock, store = _make_redis_mock()
        _patch_redis(mock)

        new_data = {"project_id": "p", "period": "q", "tonnes_verified": 300, "status": "SUBMITTED"}
        vl.cache_set("p", "q", new_data)
        vl.cache_invalidate("p", "q")  # deletes what we just set

        result = vl.cache_get("p", "q")
        self.assertIsNone(result, "After invalidate, entry should be gone")


class TestCacheFallback(unittest.TestCase):
    """get_verification_result() falls back to DB on miss/stale."""

    def setUp(self):
        _reset_redis()

    def test_returns_db_result_on_cache_miss(self):
        mock, _ = _make_redis_mock()  # empty store → cache miss
        _patch_redis(mock)

        db_row = {
            "project_id": "proj-001", "period": "2023-Q1",
            "tonnes_verified": 5000, "methodology_score": 85,
            "tx_hash": "abc123", "status": "SUBMITTED", "submitted_at": "2023-01-01T00:00:00",
        }
        with patch.object(vl, "fetch_verification_from_db", return_value=db_row) as mock_db:
            result = vl.get_verification_result("proj-001", "2023-Q1")

        self.assertEqual(result, db_row)
        mock_db.assert_called_once_with("proj-001", "2023-Q1")

    def test_db_result_written_to_cache_on_miss(self):
        mock, store = _make_redis_mock()
        _patch_redis(mock)

        db_row = {"project_id": "proj-001", "period": "2023-Q1", "status": "SUBMITTED"}
        with patch.object(vl, "fetch_verification_from_db", return_value=db_row):
            vl.get_verification_result("proj-001", "2023-Q1")

        key = vl._cache_key("proj-001", "2023-Q1")
        self.assertIn(key, store, "DB result should be written through to cache")

    def test_returns_none_when_db_also_misses(self):
        mock, _ = _make_redis_mock()
        _patch_redis(mock)

        with patch.object(vl, "fetch_verification_from_db", return_value=None):
            result = vl.get_verification_result("proj-001", "2023-Q1")

        self.assertIsNone(result)

    def test_db_not_queried_on_cache_hit(self):
        payload = {"project_id": "proj-001", "period": "2023-Q1",
                   "status": "SUBMITTED", "_refreshed_at": time.time()}
        key = vl._cache_key("proj-001", "2023-Q1")
        mock, _ = _make_redis_mock({key: json.dumps(payload)})
        _patch_redis(mock)

        with patch.object(vl, "fetch_verification_from_db") as mock_db:
            result = vl.get_verification_result("proj-001", "2023-Q1")

        mock_db.assert_not_called()
        self.assertIsNotNone(result)

    def test_fallback_to_db_when_redis_unavailable(self):
        _patch_redis(None)  # Redis down

        db_row = {"project_id": "proj-001", "period": "2023-Q1", "status": "SUBMITTED"}
        with patch.object(vl, "fetch_verification_from_db", return_value=db_row) as mock_db:
            result = vl.get_verification_result("proj-001", "2023-Q1")

        mock_db.assert_called_once()
        self.assertEqual(result["status"], "SUBMITTED")

    def test_stale_cache_triggers_db_fallback(self):
        stale_ts = time.time() - (vl.CACHE_STALE_SECONDS + 60)
        payload = {"project_id": "p", "period": "q",
                   "tonnes_verified": 100, "_refreshed_at": stale_ts}
        key = vl._cache_key("p", "q")
        mock, _ = _make_redis_mock({key: json.dumps(payload)})
        _patch_redis(mock)

        db_row = {"project_id": "p", "period": "q", "tonnes_verified": 200, "status": "SUBMITTED"}
        with patch.object(vl, "fetch_verification_from_db", return_value=db_row) as mock_db:
            result = vl.get_verification_result("p", "q")

        mock_db.assert_called_once()
        self.assertEqual(result["tonnes_verified"], 200)


class TestMultipleInstances(unittest.TestCase):
    """
    Simulate two oracle instances sharing the same Redis store.
    Write-through consistency: a set by instance A must be visible to instance B.
    """

    def setUp(self):
        _reset_redis()

    def test_write_by_instance_a_visible_to_instance_b(self):
        shared_store = {}
        mock_a, _ = _make_redis_mock(shared_store)
        mock_b, _ = _make_redis_mock(shared_store)

        # Instance A writes
        _patch_redis(mock_a)
        vl.cache_set("proj-001", "2023-Q1", {
            "project_id": "proj-001", "period": "2023-Q1",
            "tonnes_verified": 5000, "status": "SUBMITTED",
        })

        # Instance B reads from same store
        _patch_redis(mock_b)
        result = vl.cache_get("proj-001", "2023-Q1")
        self.assertIsNotNone(result)
        self.assertEqual(result["tonnes_verified"], 5000)

    def test_invalidate_by_instance_a_makes_miss_for_instance_b(self):
        shared_store = {}
        mock_a, _ = _make_redis_mock(shared_store)
        mock_b, _ = _make_redis_mock(shared_store)

        # Instance A writes
        _patch_redis(mock_a)
        vl.cache_set("proj-001", "2023-Q1", {
            "project_id": "proj-001", "period": "2023-Q1",
            "status": "SUBMITTED", "tonnes_verified": 5000,
        })

        # Instance A invalidates (after on-chain submission)
        vl.cache_invalidate("proj-001", "2023-Q1")

        # Instance B tries to read — must get a miss
        _patch_redis(mock_b)
        result = vl.cache_get("proj-001", "2023-Q1")
        self.assertIsNone(result, "After invalidation, other instances must see a miss")

    def test_concurrent_writes_last_write_wins(self):
        shared_store = {}
        mock_a, _ = _make_redis_mock(shared_store)
        mock_b, _ = _make_redis_mock(shared_store)

        _patch_redis(mock_a)
        vl.cache_set("p", "q", {"tonnes_verified": 100})

        _patch_redis(mock_b)
        vl.cache_set("p", "q", {"tonnes_verified": 200})

        # Read with either client — last write wins
        _patch_redis(mock_a)
        result = vl.cache_get("p", "q")
        self.assertIsNotNone(result)
        self.assertEqual(result["tonnes_verified"], 200)


class TestCacheKeyDeterminism(unittest.TestCase):
    """Cache key must be deterministic and distinct."""

    def test_same_inputs_produce_same_key(self):
        k1 = vl._cache_key("proj-001", "2023-Q1")
        k2 = vl._cache_key("proj-001", "2023-Q1")
        self.assertEqual(k1, k2)

    def test_different_project_id_produces_different_key(self):
        k1 = vl._cache_key("proj-001", "2023-Q1")
        k2 = vl._cache_key("proj-002", "2023-Q1")
        self.assertNotEqual(k1, k2)

    def test_different_period_produces_different_key(self):
        k1 = vl._cache_key("proj-001", "2023-Q1")
        k2 = vl._cache_key("proj-001", "2023-Q2")
        self.assertNotEqual(k1, k2)

    def test_key_includes_namespace_prefix(self):
        key = vl._cache_key("proj-001", "2023-Q1")
        self.assertTrue(key.startswith(vl.CACHE_NS))


class TestTTLConfiguration(unittest.TestCase):
    """TTL and stale thresholds are configurable via env vars."""

    def test_default_ttl_is_1_hour(self):
        self.assertEqual(vl.CACHE_TTL_SECONDS, int(os.environ.get("VERIFICATION_CACHE_TTL", "3600")))

    def test_default_stale_threshold_is_6_hours(self):
        self.assertEqual(vl.CACHE_STALE_SECONDS, int(os.environ.get("VERIFICATION_CACHE_STALE", str(6 * 3600))))

    def test_ttl_less_than_stale_threshold(self):
        # TTL (1h) < stale threshold (6h): entries expire before being considered stale
        self.assertLess(vl.CACHE_TTL_SECONDS, vl.CACHE_STALE_SECONDS)


if __name__ == "__main__":
    unittest.main()
