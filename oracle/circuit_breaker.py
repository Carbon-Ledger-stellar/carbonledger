"""
circuit_breaker.py
Circuit breaker for oracle-to-Soroban RPC calls.

States:
  CLOSED   — normal operation; failures increment counter
  OPEN     — circuit tripped; all calls rejected immediately
  HALF_OPEN — probe state; one call allowed through to test recovery

Configuration (env vars):
  CB_FAILURE_THRESHOLD  — failures before opening (default: 5)
  CB_COOLDOWN_SECONDS   — seconds to wait before half-open probe (default: 60)
  CB_SUCCESS_THRESHOLD  — successes in half-open before closing (default: 2)
"""

import os
import time
import threading
import requests

# ── Configuration ─────────────────────────────────────────────────────────────

CB_FAILURE_THRESHOLD = int(os.environ.get("CB_FAILURE_THRESHOLD", "5"))
CB_COOLDOWN_SECONDS  = float(os.environ.get("CB_COOLDOWN_SECONDS", "60"))
CB_SUCCESS_THRESHOLD = int(os.environ.get("CB_SUCCESS_THRESHOLD", "2"))

ADMIN_ALERT_WEBHOOK  = os.environ.get("ADMIN_ALERT_WEBHOOK", "")

# ── Internal state constants ───────────────────────────────────────────────────

_STATE_CLOSED    = "closed"
_STATE_OPEN      = "open"
_STATE_HALF_OPEN = "half_open"

# ── Exception ─────────────────────────────────────────────────────────────────


class CircuitOpenError(Exception):
    """Raised when a call is rejected because the circuit is open."""
    pass


# ── Alert helper ──────────────────────────────────────────────────────────────


def alert_admin(name: str, state: str, message: str) -> None:
    """
    Fire a webhook alert when a circuit changes state.

    Reads ADMIN_ALERT_WEBHOOK from the environment.  If the variable is not
    set the alert is only printed to stderr so that callers don't need to
    configure a webhook just to see alerts locally.

    Payload schema::

        {
          "circuit":  "<name>",
          "state":    "<new state>",
          "message":  "<human-readable description>"
        }
    """
    payload = {"circuit": name, "state": state, "message": message}
    if not ADMIN_ALERT_WEBHOOK:
        # Best-effort stderr print — avoid importing log here to keep this
        # module self-contained and importable without the rest of the oracle
        # package being on sys.path.
        import sys
        print(
            f"[circuit_breaker] ADMIN ALERT — circuit={name} state={state}: {message}",
            file=sys.stderr,
        )
        return
    try:
        requests.post(ADMIN_ALERT_WEBHOOK, json=payload, timeout=10)
    except Exception as exc:  # noqa: BLE001
        import sys
        print(
            f"[circuit_breaker] Alert webhook failed ({exc}) — "
            f"circuit={name} state={state}: {message}",
            file=sys.stderr,
        )


# ── CircuitBreaker class ───────────────────────────────────────────────────────


class CircuitBreaker:
    """
    Thread-safe circuit breaker wrapping arbitrary callables.

    Typical usage::

        cb = CircuitBreaker("my_service")
        try:
            result = cb.call(rpc_function, arg1, kwarg=value)
        except CircuitOpenError:
            # circuit is open — skip the call
            pass
        except Exception as exc:
            # RPC failed but circuit handled the accounting
            raise
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = CB_FAILURE_THRESHOLD,
        cooldown_seconds: float = CB_COOLDOWN_SECONDS,
        success_threshold: int = CB_SUCCESS_THRESHOLD,
    ) -> None:
        self._name              = name
        self._failure_threshold = failure_threshold
        self._cooldown_seconds  = cooldown_seconds
        self._success_threshold = success_threshold

        self._lock              = threading.Lock()
        self._state             = _STATE_CLOSED
        self._failure_count     = 0
        self._success_count     = 0          # used only in HALF_OPEN
        self._last_failure_at: float | None = None
        self._last_opened_at:  float | None = None

    # ── Public read-only properties ───────────────────────────────────────────

    @property
    def name(self) -> str:
        return self._name

    @property
    def state(self) -> str:
        """Return the current state string: 'closed', 'open', or 'half_open'."""
        with self._lock:
            return self._state

    # ── Primary interface ─────────────────────────────────────────────────────

    def call(self, fn, *args, **kwargs):
        """
        Invoke *fn* with the supplied arguments, applying circuit breaker logic.

        Raises:
            CircuitOpenError – if the circuit is OPEN and cooldown has not elapsed.
            Any exception raised by *fn* – propagated after internal accounting.
        """
        with self._lock:
            action = self._pre_call_action()

        if action == "reject":
            raise CircuitOpenError(
                f"Circuit '{self._name}' is OPEN — call rejected"
            )

        # action is either "allow" (CLOSED / HALF_OPEN probe)
        try:
            result = fn(*args, **kwargs)
        except Exception as exc:
            with self._lock:
                self._on_failure(action)
            raise

        with self._lock:
            self._on_success(action)

        return result

    # ── Health snapshot ───────────────────────────────────────────────────────

    def get_health(self) -> dict:
        """
        Return a JSON-serialisable snapshot of the circuit's current state.

        Keys:
            state           – 'closed' | 'open' | 'half_open'
            failure_count   – consecutive failures since last reset
            last_failure_at – ISO-8601 timestamp or null
            last_opened_at  – ISO-8601 timestamp or null
        """
        import datetime
        with self._lock:
            def _iso(ts: float | None) -> str | None:
                if ts is None:
                    return None
                return datetime.datetime.fromtimestamp(
                    ts, tz=datetime.timezone.utc
                ).isoformat()

            return {
                "state":          self._state,
                "failure_count":  self._failure_count,
                "last_failure_at": _iso(self._last_failure_at),
                "last_opened_at":  _iso(self._last_opened_at),
            }

    # ── Internal state-machine helpers (must be called under self._lock) ──────

    def _pre_call_action(self) -> str:
        """
        Decide what to do before the call.  Returns 'reject' or 'allow'.
        May also transition the circuit from OPEN → HALF_OPEN.
        """
        if self._state == _STATE_CLOSED:
            return "allow"

        if self._state == _STATE_OPEN:
            elapsed = time.monotonic() - (self._last_opened_at or 0)
            if elapsed < self._cooldown_seconds:
                return "reject"
            # Cooldown elapsed — probe with a single call
            self._state = _STATE_HALF_OPEN
            self._success_count = 0
            return "allow"

        # HALF_OPEN — allow the probe
        return "allow"

    def _on_success(self, action: str) -> None:
        """Account for a successful call."""
        if self._state == _STATE_HALF_OPEN:
            self._success_count += 1
            if self._success_count >= self._success_threshold:
                self._reset_to_closed()
        elif self._state == _STATE_CLOSED:
            # Reset failure counter on any success while closed
            self._failure_count = 0

    def _on_failure(self, action: str) -> None:
        """Account for a failed call."""
        self._last_failure_at = time.monotonic()

        if self._state == _STATE_HALF_OPEN:
            # Probe failed — return to OPEN and reset cooldown
            self._state = _STATE_OPEN
            self._last_opened_at = time.monotonic()
            return

        if self._state == _STATE_CLOSED:
            self._failure_count += 1
            if self._failure_count >= self._failure_threshold:
                self._trip_open()

    def _trip_open(self) -> None:
        """Transition CLOSED → OPEN and fire the admin alert."""
        self._state = _STATE_OPEN
        self._last_opened_at = time.monotonic()
        # Fire alert outside the lock to avoid potential deadlock with webhook
        # post — we schedule it via a short-lived thread.
        name    = self._name
        message = (
            f"Circuit '{name}' opened after {self._failure_count} consecutive "
            f"failures. RPC calls will be rejected until the cooldown "
            f"({self._cooldown_seconds}s) elapses."
        )
        threading.Thread(
            target=alert_admin,
            args=(name, _STATE_OPEN, message),
            daemon=True,
        ).start()

    def _reset_to_closed(self) -> None:
        """Transition HALF_OPEN → CLOSED and reset all counters."""
        self._state         = _STATE_CLOSED
        self._failure_count = 0
        self._success_count = 0


# ── Module-level registry ─────────────────────────────────────────────────────

_registry: dict[str, CircuitBreaker] = {}
_registry_lock = threading.Lock()


def get_circuit_breaker(name: str) -> CircuitBreaker:
    """
    Return the named CircuitBreaker, creating it with default env-var settings
    on first access.  Subsequent calls with the same *name* return the same
    instance (singleton per name).
    """
    with _registry_lock:
        if name not in _registry:
            _registry[name] = CircuitBreaker(name)
        return _registry[name]


def get_all_health() -> dict:
    """
    Return a dict mapping circuit name → health snapshot for every registered
    circuit breaker.  Suitable for embedding in /health endpoint responses.
    """
    with _registry_lock:
        names = list(_registry.keys())
    return {name: _registry[name].get_health() for name in names}
