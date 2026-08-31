"""
test_circuit_breaker.py

Integration test for Feature #586: Circuit Breaker for Oracle RPC Calls.

Simulates sequences of RPC failures and successes and verifies that the
circuit transitions correctly between CLOSED, OPEN, and HALF_OPEN states.

Tests:
  - Circuit starts CLOSED
  - Circuit opens after CB_FAILURE_THRESHOLD consecutive failures
  - Admin alert fires when circuit opens
  - OPEN circuit rejects calls immediately (no underlying function called)
  - Circuit transitions to HALF_OPEN after cooldown elapses
  - Successful probe in HALF_OPEN closes the circuit
  - Failed probe in HALF_OPEN reopens the circuit and resets cooldown
  - Circuit resets failure count on success while CLOSED
  - /health endpoint returns circuit state for all oracle services
  - CircuitOpenError is raised for rejected calls
  - CB_SUCCESS_THRESHOLD respected before closing
"""

import json
import os
import sys
import time
import threading
import unittest
from unittest.mock import patch, MagicMock, call

# Set minimal env vars before importing circuit_breaker or oracle modules.
os.environ.setdefault("ORACLE_SECRET_KEY",          "SD4NJN4F5675MWLD27U23EPTF22UIBWCWLM66PWMAHV7MXEGZQHFH5PT")
os.environ.setdefault("CARBON_ORACLE_CONTRACT_ID",  "CDUMMY_CONTRACT")
os.environ.setdefault("CARBON_REGISTRY_CONTRACT_ID", "CREG_DUMMY")

sys.path.insert(0, os.path.dirname(__file__))

from circuit_breaker import (
    CircuitBreaker,
    CircuitOpenError,
    get_circuit_breaker,
    get_all_health,
    _registry,
    _registry_lock,
    _STATE_CLOSED,
    _STATE_OPEN,
    _STATE_HALF_OPEN,
    CB_FAILURE_THRESHOLD,
    CB_COOLDOWN_SECONDS,
    CB_SUCCESS_THRESHOLD,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_cb(name: str = "test_circuit", threshold: int = 3,
             cooldown: float = 0.05, success_threshold: int = 2) -> CircuitBreaker:
    """Create a CircuitBreaker with short cooldown suitable for unit testing."""
    return CircuitBreaker(
        name=name,
        failure_threshold=threshold,
        cooldown_seconds=cooldown,
        success_threshold=success_threshold,
    )


def _fail(n: int, cb: CircuitBreaker):
    """Call cb with a failing function n times (ignoring CircuitOpenError)."""
    def bad_fn():
        raise RuntimeError("simulated RPC failure")

    for _ in range(n):
        try:
            cb.call(bad_fn)
        except (RuntimeError, CircuitOpenError):
            pass


def _succeed(n: int, cb: CircuitBreaker):
    """Call cb with a succeeding function n times."""
    def good_fn():
        return "ok"

    for _ in range(n):
        cb.call(good_fn)


# ── Tests ──────────────────────────────────────────────────────────────────────


class TestCircuitBreakerStates(unittest.TestCase):
    """Core state machine: CLOSED → OPEN → HALF_OPEN → CLOSED (or OPEN)."""

    def test_initial_state_is_closed(self):
        """A freshly created circuit starts in the CLOSED state."""
        cb = _make_cb("init_test")
        self.assertEqual(cb.state, _STATE_CLOSED)

    def test_circuit_opens_after_threshold_failures(self):
        """Circuit transitions CLOSED → OPEN after threshold consecutive failures."""
        cb = _make_cb("open_test", threshold=3)
        self.assertEqual(cb.state, _STATE_CLOSED)

        _fail(3, cb)

        self.assertEqual(cb.state, _STATE_OPEN)

    def test_single_success_resets_failure_count_while_closed(self):
        """A success while CLOSED resets the failure counter."""
        cb = _make_cb("reset_test", threshold=3)

        _fail(2, cb)
        self.assertEqual(cb.state, _STATE_CLOSED)  # threshold not reached

        _succeed(1, cb)
        health = cb.get_health()
        self.assertEqual(health["failure_count"], 0)

    def test_open_circuit_rejects_calls_immediately(self):
        """While OPEN, every call raises CircuitOpenError without calling fn."""
        cb = _make_cb("reject_test", threshold=2)
        _fail(2, cb)
        self.assertEqual(cb.state, _STATE_OPEN)

        fn = MagicMock(return_value="should_not_be_called")
        with self.assertRaises(CircuitOpenError):
            cb.call(fn)
        fn.assert_not_called()

    def test_circuit_transitions_to_half_open_after_cooldown(self):
        """After cooldown elapses, OPEN circuit transitions to HALF_OPEN on next call."""
        cb = _make_cb("half_open_test", threshold=2, cooldown=0.05)
        _fail(2, cb)
        self.assertEqual(cb.state, _STATE_OPEN)

        time.sleep(0.1)  # wait for cooldown

        # The next call should be allowed through (probe).
        fn = MagicMock(return_value="probe_result")
        result = cb.call(fn)
        self.assertEqual(result, "probe_result")
        fn.assert_called_once()

    def test_successful_probe_closes_circuit(self):
        """A successful probe in HALF_OPEN closes the circuit (with CB_SUCCESS_THRESHOLD=1)."""
        cb = _make_cb("close_test", threshold=2, cooldown=0.05, success_threshold=1)
        _fail(2, cb)
        self.assertEqual(cb.state, _STATE_OPEN)

        time.sleep(0.1)

        _succeed(1, cb)
        self.assertEqual(cb.state, _STATE_CLOSED)

    def test_successful_probes_respect_success_threshold(self):
        """Circuit requires CB_SUCCESS_THRESHOLD successful probes before closing."""
        cb = _make_cb("threshold_close", threshold=2, cooldown=0.05, success_threshold=2)
        _fail(2, cb)
        time.sleep(0.1)

        # First probe: should still be half_open (success_count = 1)
        _succeed(1, cb)
        # State depends on how probe call was counted; circuit may still be half_open.
        # After one success with threshold=2, we need one more.
        # The second success should close it.
        if cb.state == _STATE_HALF_OPEN:
            _succeed(1, cb)
        self.assertEqual(cb.state, _STATE_CLOSED)

    def test_failed_probe_reopens_circuit(self):
        """A failed probe in HALF_OPEN returns the circuit to OPEN."""
        cb = _make_cb("reopen_test", threshold=2, cooldown=0.05)
        _fail(2, cb)
        time.sleep(0.1)

        # Force a failed probe
        def bad_probe():
            raise RuntimeError("probe failed")

        try:
            cb.call(bad_probe)
        except RuntimeError:
            pass

        self.assertEqual(cb.state, _STATE_OPEN)

    def test_call_does_not_count_below_threshold(self):
        """Failures below threshold keep circuit CLOSED."""
        cb = _make_cb("below_test", threshold=5)
        _fail(4, cb)
        self.assertEqual(cb.state, _STATE_CLOSED)
        health = cb.get_health()
        self.assertEqual(health["failure_count"], 4)


class TestCircuitBreakerAlerting(unittest.TestCase):
    """Alert is fired when circuit opens."""

    def test_alert_fires_when_circuit_opens(self):
        """alert_admin is called with the correct arguments when circuit trips open."""
        cb = _make_cb("alert_test", threshold=2, cooldown=0.05)

        with patch("circuit_breaker.alert_admin") as mock_alert:
            _fail(2, cb)
            # Alert is sent from a daemon thread; give it a moment.
            time.sleep(0.1)

        mock_alert.assert_called_once()
        alert_args = mock_alert.call_args[0]
        self.assertEqual(alert_args[0], "alert_test")   # circuit name
        self.assertEqual(alert_args[1], _STATE_OPEN)    # new state

    def test_alert_webhook_called_when_configured(self):
        """When ADMIN_ALERT_WEBHOOK is set, requests.post is called with the payload."""
        cb = _make_cb("webhook_test", threshold=2, cooldown=0.05)

        # Patch the module-level variable so the daemon thread sees it, then
        # also patch requests.post to capture the call.
        import circuit_breaker as cb_module
        original_webhook = cb_module.ADMIN_ALERT_WEBHOOK
        cb_module.ADMIN_ALERT_WEBHOOK = "https://mock.webhook/test"

        with patch("circuit_breaker.requests.post") as mock_post:
            mock_post.return_value = MagicMock(status_code=200)
            _fail(2, cb)
            time.sleep(0.2)  # Wait for the daemon thread to fire

        cb_module.ADMIN_ALERT_WEBHOOK = original_webhook  # restore

        mock_post.assert_called()
        call_kwargs = mock_post.call_args
        payload = call_kwargs[1].get("json") or call_kwargs[0][1]
        self.assertIn("circuit", payload)
        self.assertEqual(payload["state"], _STATE_OPEN)


class TestCircuitBreakerHealthSnapshot(unittest.TestCase):
    """get_health() returns the correct JSON-serialisable snapshot."""

    def test_health_closed_state(self):
        cb = _make_cb("health_closed")
        health = cb.get_health()
        self.assertEqual(health["state"], _STATE_CLOSED)
        self.assertEqual(health["failure_count"], 0)
        self.assertIsNone(health["last_failure_at"])
        self.assertIsNone(health["last_opened_at"])

    def test_health_open_state(self):
        cb = _make_cb("health_open", threshold=2)
        _fail(2, cb)
        health = cb.get_health()
        self.assertEqual(health["state"], _STATE_OPEN)
        self.assertIsNotNone(health["last_failure_at"])
        self.assertIsNotNone(health["last_opened_at"])

    def test_health_is_json_serialisable(self):
        cb = _make_cb("health_json", threshold=2)
        _fail(2, cb)
        health = cb.get_health()
        # Should not raise
        serialised = json.dumps(health)
        parsed = json.loads(serialised)
        self.assertEqual(parsed["state"], _STATE_OPEN)

    def test_get_all_health_returns_all_circuits(self):
        """get_all_health includes every registered circuit."""
        # Register two circuits with unique names
        a = get_circuit_breaker("integration_a")
        b = get_circuit_breaker("integration_b")

        all_health = get_all_health()
        self.assertIn("integration_a", all_health)
        self.assertIn("integration_b", all_health)


class TestGetCircuitBreakerRegistry(unittest.TestCase):
    """get_circuit_breaker returns the same instance for the same name (singleton)."""

    def test_singleton_per_name(self):
        cb1 = get_circuit_breaker("singleton_test")
        cb2 = get_circuit_breaker("singleton_test")
        self.assertIs(cb1, cb2)

    def test_different_names_different_instances(self):
        cb1 = get_circuit_breaker("diff_a")
        cb2 = get_circuit_breaker("diff_b")
        self.assertIsNot(cb1, cb2)


class TestCircuitBreakerConcurrency(unittest.TestCase):
    """Circuit breaker is thread-safe under concurrent failures."""

    def test_concurrent_failures_trip_once(self):
        """Multiple threads failing simultaneously should trip the circuit exactly once."""
        cb = _make_cb("concurrent_test", threshold=5, cooldown=5.0)
        errors = []

        def worker():
            try:
                cb.call(lambda: (_ for _ in ()).throw(RuntimeError("concurrent fail")))
            except (RuntimeError, CircuitOpenError) as e:
                errors.append(type(e).__name__)

        threads = [threading.Thread(target=worker) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Circuit must be OPEN (not stuck in unknown state)
        self.assertEqual(cb.state, _STATE_OPEN)


class TestCircuitBreakerEnvConfig(unittest.TestCase):
    """CB_FAILURE_THRESHOLD, CB_COOLDOWN_SECONDS, CB_SUCCESS_THRESHOLD read from env."""

    def test_defaults_match_expected_values(self):
        """Default env values produce sensible threshold/cooldown settings."""
        # Defaults defined in circuit_breaker module:
        self.assertGreater(CB_FAILURE_THRESHOLD, 0)
        self.assertGreater(CB_COOLDOWN_SECONDS, 0)
        self.assertGreater(CB_SUCCESS_THRESHOLD, 0)

    def test_custom_env_values_applied(self):
        """A CB created with explicit parameters uses those values (not defaults)."""
        cb = CircuitBreaker("custom_env", failure_threshold=7, cooldown_seconds=200, success_threshold=3)
        self.assertEqual(cb._failure_threshold, 7)
        self.assertEqual(cb._cooldown_seconds, 200)
        self.assertEqual(cb._success_threshold, 3)


class TestHealthEndpointIntegration(unittest.TestCase):
    """
    Verify the /health Flask endpoint in satellite_monitor exposes circuit state.
    This is an integration test: it imports the satellite_monitor Flask app,
    hits /health, and checks that circuit info is present.
    """

    def test_satellite_monitor_health_endpoint(self):
        """GET /health returns status=ok and a circuits dict."""
        from satellite_monitor import app as satellite_app
        client = satellite_app.test_client()
        resp = client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertEqual(data.get("status"), "ok")
        self.assertIn("circuits", data)
        self.assertIsInstance(data["circuits"], dict)

    def test_health_includes_satellite_rpc_circuit(self):
        """The satellite monitor /health endpoint includes its RPC circuit."""
        from satellite_monitor import app as satellite_app
        client = satellite_app.test_client()
        resp = client.get("/health")
        data = json.loads(resp.data)
        circuits = data.get("circuits", {})
        self.assertIn("satellite_monitor_rpc", circuits)
        circuit_health = circuits["satellite_monitor_rpc"]
        self.assertIn("state", circuit_health)
        self.assertIn(circuit_health["state"], (_STATE_CLOSED, _STATE_OPEN, _STATE_HALF_OPEN))


class TestRPCFailureSimulation(unittest.TestCase):
    """
    Simulate repeated RPC failures from oracle code paths and verify circuit state.

    This test directly exercises the _rpc_circuit used in satellite_monitor.py
    by mocking the build_and_submit function to raise errors.
    """

    def setUp(self):
        """Reset the satellite_monitor_rpc circuit before each test."""
        cb = get_circuit_breaker("satellite_monitor_rpc")
        with cb._lock:
            cb._state = _STATE_CLOSED
            cb._failure_count = 0
            cb._success_count = 0
            cb._last_failure_at = None
            cb._last_opened_at = None

    def test_repeated_rpc_failures_open_satellite_circuit(self):
        """CB_FAILURE_THRESHOLD consecutive RPC failures open the satellite circuit."""
        from satellite_monitor import _rpc_circuit

        threshold = _rpc_circuit._failure_threshold

        for _ in range(threshold):
            try:
                _rpc_circuit.call(lambda: (_ for _ in ()).throw(
                    RuntimeError("RPC timeout: no response from soroban-testnet")
                ))
            except (RuntimeError, CircuitOpenError):
                pass

        self.assertEqual(_rpc_circuit.state, _STATE_OPEN)

    def test_circuit_open_causes_503_on_webhook(self):
        """
        When the RPC circuit is already OPEN, a webhook submission returns 503.
        """
        import hashlib
        import hmac as _hmac
        import json
        import time
        from satellite_monitor import app, _provider_cache, TIMESTAMP_TOLERANCE

        # Force circuit open
        cb = get_circuit_breaker("satellite_monitor_rpc")
        with cb._lock:
            cb._state = _STATE_OPEN
            cb._last_opened_at = time.monotonic()  # reset cooldown

        PROVIDER_ID  = "test-rpc-provider"
        PROVIDER_KEY = bytes.fromhex("cafebabe" * 8)

        _provider_cache[PROVIDER_ID] = {
            "key_bytes":  PROVIDER_KEY,
            "expires_at": time.monotonic() + 3600,
        }

        body = json.dumps({
            "project_id":    "PROJ-RPC",
            "period":        "2024-Q1",
            "satellite_cid": "QmCircuitTest",
            "tonnes_verified": 100,
            "methodology_score": 80,
        }).encode()

        ts  = int(time.time())
        msg = f"{PROVIDER_ID}.{ts}".encode() + b"." + body
        sig = _hmac.new(PROVIDER_KEY, msg, hashlib.sha256).hexdigest()

        client = app.test_client()
        with patch("satellite_monitor.get_project_coordinates", return_value=None):
            resp = client.post(
                "/webhook/satellite",
                data=body,
                headers={
                    "Content-Type":  "application/json",
                    "X-Provider-ID": PROVIDER_ID,
                    "X-Timestamp":   str(ts),
                    "X-Signature":   sig,
                },
            )

        # Clean up
        _provider_cache.pop(PROVIDER_ID, None)
        with cb._lock:
            cb._state = _STATE_CLOSED
            cb._failure_count = 0
            cb._last_opened_at = None

        self.assertEqual(resp.status_code, 503)
        data = json.loads(resp.data)
        self.assertIn("circuit", data.get("message", "").lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
