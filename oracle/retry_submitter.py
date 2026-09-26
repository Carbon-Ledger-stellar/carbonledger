"""
retry_submitter.py — idempotent retry with exponential backoff for the
verification listener (issue #578).

The listener submits verified monitoring data on chain.  Three failure modes
have to be handled separately, and conflating them is what makes naive retry
loops dangerous:

1. **Transient failure** (RPC timeout, 5xx, connection reset) — retry with
   exponential backoff, base 2, up to ``MAX_RETRIES`` (default 8) attempts.
2. **Permanent failure** (malformed payload, rejected by the contract) — do not
   burn 8 attempts on something that cannot succeed; go straight to the
   dead-letter table.
3. **Ambiguous failure** — the submission may have landed but the response was
   lost.  This is why retries are *idempotent* rather than merely repeated.

Exactly-once is enforced on two levels:

* **Off-chain** — the submission id is content-addressed:
  ``sha256(canonical_json(payload))``.  Claiming it is an atomic
  ``INSERT … ON CONFLICT DO NOTHING``, so a duplicate is rejected *before* any
  RPC call.  A submission already marked ``submitted`` returns its recorded
  transaction hash instead of resubmitting.
* **On-chain** — each submission id is allocated exactly one nonce, reused
  across every retry of that submission.  If attempt 3 actually landed but its
  response was lost, attempt 4 replays the *same* nonce and the contract
  rejects it with ``InvalidNonce`` rather than recording the data twice.

Permanently failed submissions land in ``oracle_dead_letters`` with full
context — payload, every error seen, attempt count, timestamps — and an alert
fires once the unresolved depth crosses ``DLQ_ALERT_THRESHOLD``.

Scope (per the issue): the verification listener only.  No Soroban contract
changes, and the other oracle services keep their existing Redis DLQ path.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import psycopg2
import psycopg2.extras
import requests
from log import get_logger

log = get_logger("retry_submitter")

# ── Config ────────────────────────────────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL", "")

#: Maximum submission attempts before a payload is dead-lettered.
MAX_RETRIES = int(os.environ.get("SUBMISSION_MAX_RETRIES", "8"))

#: Exponential backoff base.  Delay for attempt n is BASE_DELAY * BACKOFF_BASE**n.
BACKOFF_BASE = float(os.environ.get("SUBMISSION_BACKOFF_BASE", "2"))
BASE_DELAY_SECONDS = float(os.environ.get("SUBMISSION_BASE_DELAY", "1.0"))

#: Ceiling on a single sleep, so attempt 8 does not wait 256 s.
MAX_DELAY_SECONDS = float(os.environ.get("SUBMISSION_MAX_DELAY", "60"))

#: Full jitter fraction.  0.5 means the delay is drawn from [0.5d, 1.0d].
JITTER_RATIO = float(os.environ.get("SUBMISSION_JITTER_RATIO", "0.5"))

#: Alert once this many unresolved dead letters have accumulated.
DLQ_ALERT_THRESHOLD = int(os.environ.get("DLQ_ALERT_THRESHOLD", "10"))

DLQ_ALERT_WEBHOOK = (
    os.environ.get("DLQ_ALERT_WEBHOOK") or os.environ.get("ADMIN_ALERT_WEBHOOK", "")
)

STATUS_PENDING = "pending"
STATUS_SUBMITTED = "submitted"
STATUS_FAILED = "failed"


class PermanentSubmissionError(Exception):
    """
    Raised by a submit function when retrying cannot help.

    Malformed payloads, contract-level rejections and authorisation failures
    should raise this so the submission is dead-lettered immediately instead of
    consuming the full retry budget.
    """


class DuplicateSubmissionError(Exception):
    """Raised when a submission id has already been claimed by another run."""


# ── Pure helpers (no I/O — directly unit-testable) ────────────────────────────


def canonical_json(payload: Any) -> str:
    """Deterministic JSON: sorted keys, no insignificant whitespace."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def compute_submission_id(payload: Any) -> str:
    """
    Content-addressed submission id.

    Two runs that build the same logical submission produce the same id, so a
    replay after a crash is recognised as a duplicate rather than submitted
    twice.  Conversely any change to the payload yields a different id, so a
    genuinely new submission is never mistaken for a replay.
    """
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def backoff_delay(
    attempt: int,
    base_delay: float = BASE_DELAY_SECONDS,
    backoff_base: float = BACKOFF_BASE,
    max_delay: float = MAX_DELAY_SECONDS,
    jitter_ratio: float = JITTER_RATIO,
    rng: Callable[[], float] = random.random,
) -> float:
    """
    Delay before retry ``attempt`` (0-indexed: 0 is the wait after the first
    failure).

    Exponential with base 2 and *decorrelated* jitter: the delay is drawn from
    ``[(1 - jitter_ratio) * d, d]``.  Jitter matters more than the exponent
    here — without it, N listener replicas that fail on the same RPC outage
    retry in lockstep and re-create the thundering herd that knocked the
    endpoint over.
    """
    if attempt < 0:
        raise ValueError("attempt must be >= 0")

    delay = min(base_delay * (backoff_base**attempt), max_delay)
    if jitter_ratio <= 0:
        return delay

    low = delay * (1.0 - jitter_ratio)
    return low + (delay - low) * rng()


# ── Idempotency store ─────────────────────────────────────────────────────────


@dataclass
class SubmissionClaim:
    """Outcome of trying to claim a submission id."""

    submission_id: str
    nonce: int
    claimed: bool
    status: str = STATUS_PENDING
    tx_hash: str | None = None

    @property
    def is_duplicate(self) -> bool:
        """True when another run already owns this submission id."""
        return not self.claimed


_CLAIM_SQL = """
INSERT INTO oracle_submission_nonces
    (submission_id, service, function_name, payload_hash, nonce, status)
VALUES (
    %s, %s, %s, %s,
    COALESCE((SELECT MAX(nonce) + 1 FROM oracle_submission_nonces), 0),
    'pending'
)
ON CONFLICT (submission_id) DO NOTHING
RETURNING nonce;
"""

_LOOKUP_SQL = """
SELECT nonce, status, tx_hash
  FROM oracle_submission_nonces
 WHERE submission_id = %s;
"""


class IdempotencyStore:
    """
    Claims submission ids and allocates the on-chain nonce for each.

    One row per logical submission.  The nonce is allocated once at claim time
    and reused for every retry, which is what makes a retry idempotent at the
    contract level rather than merely at ours.
    """

    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url if database_url is not None else DATABASE_URL

    def claim(
        self,
        submission_id: str,
        service: str,
        function_name: str,
        payload_hash: str,
    ) -> SubmissionClaim:
        """
        Atomically claim ``submission_id``.

        Returns a claim with ``claimed=True`` on first sight, or ``claimed=False``
        plus the existing row's status and tx hash when it is a duplicate.
        """
        with psycopg2.connect(self.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    _CLAIM_SQL, (submission_id, service, function_name, payload_hash)
                )
                row = cur.fetchone()
                if row is not None:
                    return SubmissionClaim(
                        submission_id=submission_id, nonce=int(row[0]), claimed=True
                    )

                # Conflict: someone else owns it.  Report what they recorded.
                cur.execute(_LOOKUP_SQL, (submission_id,))
                existing = cur.fetchone()

        if existing is None:  # pragma: no cover — row vanished between statements
            raise DuplicateSubmissionError(
                f"submission {submission_id} conflicted but could not be read back"
            )

        return SubmissionClaim(
            submission_id=submission_id,
            nonce=int(existing[0]),
            claimed=False,
            status=existing[1],
            tx_hash=existing[2],
        )

    def mark_submitted(self, submission_id: str, tx_hash: str | None) -> None:
        self._set_status(submission_id, STATUS_SUBMITTED, tx_hash)

    def mark_failed(self, submission_id: str) -> None:
        self._set_status(submission_id, STATUS_FAILED, None)

    def _set_status(self, submission_id: str, status: str, tx_hash: str | None) -> None:
        with psycopg2.connect(self.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE oracle_submission_nonces
                       SET status = %s, tx_hash = COALESCE(%s, tx_hash), updated_at = NOW()
                     WHERE submission_id = %s
                    """,
                    (status, tx_hash, submission_id),
                )


# ── Dead-letter store ─────────────────────────────────────────────────────────


class DeadLetterStore:
    """
    PostgreSQL dead-letter table for permanently failed submissions.

    Unlike the Redis DLQ used by the price oracle, entries here survive a Redis
    flush and carry the full failure history, which is what an operator needs to
    decide whether a batch is safe to replay.
    """

    def __init__(
        self,
        database_url: str | None = None,
        alert_webhook: str | None = None,
        alert_threshold: int | None = None,
    ) -> None:
        self.database_url = database_url if database_url is not None else DATABASE_URL
        self.alert_webhook = DLQ_ALERT_WEBHOOK if alert_webhook is None else alert_webhook
        self.alert_threshold = (
            DLQ_ALERT_THRESHOLD if alert_threshold is None else alert_threshold
        )

    def record(
        self,
        submission_id: str,
        service: str,
        function_name: str,
        payload: Any,
        attempts: int,
        errors: list[str],
        nonce: int | None = None,
    ) -> bool:
        """Write (or update) a dead-letter entry.  Returns True on success."""
        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO oracle_dead_letters
                            (submission_id, service, function_name, payload, nonce,
                             attempts, last_error, error_history)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (submission_id) DO UPDATE SET
                            attempts      = EXCLUDED.attempts,
                            last_error    = EXCLUDED.last_error,
                            error_history = EXCLUDED.error_history,
                            last_failed_at = NOW()
                        """,
                        (
                            submission_id,
                            service,
                            function_name,
                            json.dumps(payload, default=str),
                            nonce,
                            attempts,
                            errors[-1] if errors else None,
                            json.dumps(errors, default=str),
                        ),
                    )
            log.error(
                "submission dead-lettered",
                extra={
                    "submission_id": submission_id,
                    "function_name": function_name,
                    "attempts": attempts,
                },
            )
            return True
        except Exception as e:  # noqa: BLE001
            log.error("Failed to write dead letter for %s: %s", submission_id, e)
            return False

    def depth(self) -> int:
        """Number of unresolved dead letters."""
        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT COUNT(*) FROM oracle_dead_letters WHERE resolved = false"
                    )
                    row = cur.fetchone()
                    return int(row[0]) if row else 0
        except Exception as e:  # noqa: BLE001
            log.error("Failed to read dead-letter depth: %s", e)
            return 0

    def check_depth_and_alert(self) -> bool:
        """
        Alert when the unresolved depth exceeds the configured threshold.

        Returns True when an alert was dispatched.
        """
        depth = self.depth()
        if depth <= self.alert_threshold:
            return False

        message = (
            f"🔴 Oracle dead-letter queue depth {depth} exceeds threshold "
            f"{self.alert_threshold} — submissions are failing permanently. "
            "See docs/runbooks/oracle-failure.md"
        )
        log.error(message)

        if not self.alert_webhook:
            return False
        try:
            requests.post(
                self.alert_webhook,
                json={"text": message, "depth": depth, "threshold": self.alert_threshold},
                timeout=10,
            )
            return True
        except Exception as e:  # noqa: BLE001 — alerting must not break submission
            log.error("Dead-letter alert delivery failed: %s", e)
            return False

    def list_entries(self, limit: int = 50, include_resolved: bool = False) -> list[dict]:
        """Read dead letters, newest first — used by the reprocessor and ops."""
        sql = """
            SELECT submission_id, service, function_name, payload, nonce,
                   attempts, last_error, error_history, resolved,
                   first_failed_at, last_failed_at
              FROM oracle_dead_letters
        """
        if not include_resolved:
            sql += " WHERE resolved = false"
        sql += " ORDER BY last_failed_at DESC LIMIT %s"

        with psycopg2.connect(self.database_url) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (limit,))
                return [dict(row) for row in cur.fetchall()]

    def resolve(self, submission_id: str, note: str | None = None) -> None:
        """Mark a dead letter as handled so it stops counting toward depth."""
        with psycopg2.connect(self.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE oracle_dead_letters
                       SET resolved = true, resolved_at = NOW(), resolution_note = %s
                     WHERE submission_id = %s
                    """,
                    (note, submission_id),
                )


# ── Result ────────────────────────────────────────────────────────────────────


@dataclass
class SubmissionResult:
    """Outcome of one call to :meth:`IdempotentRetrySubmitter.submit`."""

    submission_id: str
    success: bool
    attempts: int = 0
    tx_hash: str | None = None
    nonce: int | None = None
    duplicate: bool = False
    dead_lettered: bool = False
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "submission_id": self.submission_id,
            "success": self.success,
            "attempts": self.attempts,
            "tx_hash": self.tx_hash,
            "nonce": self.nonce,
            "duplicate": self.duplicate,
            "dead_lettered": self.dead_lettered,
            "errors": self.errors,
        }


# ── Submitter ─────────────────────────────────────────────────────────────────


class IdempotentRetrySubmitter:
    """
    Submits a payload on chain exactly once, retrying transient failures with
    exponential backoff and dead-lettering what cannot be delivered.

    ``sleep`` and ``rng`` are injected so tests exercise the real backoff
    sequence without actually waiting.
    """

    def __init__(
        self,
        service: str = "verification_listener",
        idempotency: IdempotencyStore | None = None,
        dead_letters: DeadLetterStore | None = None,
        max_retries: int | None = None,
        sleep: Callable[[float], None] = time.sleep,
        rng: Callable[[], float] = random.random,
    ) -> None:
        self.service = service
        self.idempotency = idempotency or IdempotencyStore()
        self.dead_letters = dead_letters or DeadLetterStore()
        self.max_retries = MAX_RETRIES if max_retries is None else max_retries
        self.sleep = sleep
        self.rng = rng

    def submit(
        self,
        function_name: str,
        payload: Any,
        submit_func: Callable[..., Any],
    ) -> SubmissionResult:
        """
        Submit ``payload`` via ``submit_func(payload, nonce)``.

        ``submit_func`` should return a transaction hash (or any truthy value)
        on success, raise :class:`PermanentSubmissionError` for failures retrying
        cannot fix, and raise anything else for transient failures.
        """
        submission_id = compute_submission_id(payload)

        # ── Duplicate rejection — before any RPC call ────────────────────────
        try:
            claim = self.idempotency.claim(
                submission_id=submission_id,
                service=self.service,
                function_name=function_name,
                payload_hash=submission_id,
            )
        except Exception as e:  # noqa: BLE001
            log.error("Idempotency claim failed for %s: %s", submission_id, e)
            return SubmissionResult(
                submission_id=submission_id, success=False, errors=[f"claim failed: {e}"]
            )

        if claim.is_duplicate:
            log.warning(
                "duplicate submission rejected before reaching the blockchain",
                extra={
                    "submission_id": submission_id,
                    "existing_status": claim.status,
                    "function_name": function_name,
                },
            )
            return SubmissionResult(
                submission_id=submission_id,
                # A submission that already landed is a success from the
                # caller's point of view — the data is on chain.
                success=(claim.status == STATUS_SUBMITTED),
                tx_hash=claim.tx_hash,
                nonce=claim.nonce,
                duplicate=True,
            )

        # ── Retry loop ───────────────────────────────────────────────────────
        errors: list[str] = []
        attempts = 0

        for attempt in range(self.max_retries):
            attempts = attempt + 1
            try:
                tx_hash = submit_func(payload, claim.nonce)
                self.idempotency.mark_submitted(submission_id, tx_hash)
                log.info(
                    "submission succeeded",
                    extra={
                        "submission_id": submission_id,
                        "attempts": attempts,
                        "tx_hash": tx_hash,
                    },
                )
                return SubmissionResult(
                    submission_id=submission_id,
                    success=True,
                    attempts=attempts,
                    tx_hash=tx_hash if isinstance(tx_hash, str) else None,
                    nonce=claim.nonce,
                    errors=errors,
                )

            except PermanentSubmissionError as e:
                errors.append(f"permanent: {e}")
                log.error(
                    "permanent submission failure — not retrying",
                    extra={"submission_id": submission_id, "error": str(e)},
                )
                break

            except Exception as e:  # noqa: BLE001 — transient by definition
                errors.append(str(e))
                if attempts >= self.max_retries:
                    break

                delay = backoff_delay(attempt, rng=self.rng)
                log.warning(
                    "submission attempt failed, retrying",
                    extra={
                        "submission_id": submission_id,
                        "attempt": attempts,
                        "max_retries": self.max_retries,
                        "retry_in": round(delay, 2),
                        "error": str(e),
                    },
                )
                self.sleep(delay)

        # ── Exhausted or permanent → dead letter ────────────────────────────
        self.dead_letters.record(
            submission_id=submission_id,
            service=self.service,
            function_name=function_name,
            payload=payload,
            attempts=attempts,
            errors=errors,
            nonce=claim.nonce,
        )
        try:
            self.idempotency.mark_failed(submission_id)
        except Exception as e:  # noqa: BLE001
            log.error("Failed to mark %s failed: %s", submission_id, e)

        self.dead_letters.check_depth_and_alert()

        return SubmissionResult(
            submission_id=submission_id,
            success=False,
            attempts=attempts,
            nonce=claim.nonce,
            dead_lettered=True,
            errors=errors,
        )
