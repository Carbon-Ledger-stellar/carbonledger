"""
Tests for idempotent retry with exponential backoff in the verification
listener (#578).

Covers the backoff schedule, duplicate rejection before any RPC call, the
dead-letter table and its depth alerting, and an integration test that
simulates an RPC outage and verifies the submission eventually succeeds.
"""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from retry_submitter import (  # noqa: E402
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_SUBMITTED,
    DeadLetterStore,
    IdempotencyStore,
    IdempotentRetrySubmitter,
    PermanentSubmissionError,
    SubmissionClaim,
    backoff_delay,
    canonical_json,
    compute_submission_id,
)


class FakeIdempotencyStore:
    """In-memory stand-in for the oracle_submission_nonces table."""

    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.next_nonce = 0
        self.claims = 0

    def claim(self, submission_id, service, function_name, payload_hash):
        self.claims += 1
        existing = self.rows.get(submission_id)
        if existing is not None:
            return SubmissionClaim(
                submission_id=submission_id,
                nonce=existing["nonce"],
                claimed=False,
                status=existing["status"],
                tx_hash=existing["tx_hash"],
            )

        nonce = self.next_nonce
        self.next_nonce += 1
        self.rows[submission_id] = {
            "nonce": nonce,
            "status": STATUS_PENDING,
            "tx_hash": None,
            "service": service,
            "function_name": function_name,
        }
        return SubmissionClaim(submission_id=submission_id, nonce=nonce, claimed=True)

    def mark_submitted(self, submission_id, tx_hash):
        self.rows[submission_id]["status"] = STATUS_SUBMITTED
        self.rows[submission_id]["tx_hash"] = tx_hash

    def mark_failed(self, submission_id):
        self.rows[submission_id]["status"] = STATUS_FAILED


class FakeDeadLetterStore:
    """In-memory stand-in for the oracle_dead_letters table."""

    def __init__(self, alert_threshold=10):
        self.entries: dict[str, dict] = {}
        self.alert_threshold = alert_threshold
        self.alerts = 0

    def record(self, submission_id, service, function_name, payload, attempts, errors, nonce=None):
        self.entries[submission_id] = {
            "service": service,
            "function_name": function_name,
            "payload": payload,
            "attempts": attempts,
            "errors": list(errors),
            "nonce": nonce,
            "resolved": False,
        }
        return True

    def depth(self):
        return sum(1 for e in self.entries.values() if not e["resolved"])

    def check_depth_and_alert(self):
        if self.depth() > self.alert_threshold:
            self.alerts += 1
            return True
        return False


def make_submitter(max_retries=8, alert_threshold=10):
    """A submitter wired to in-memory stores with sleep and jitter neutralised."""
    idempotency = FakeIdempotencyStore()
    dead_letters = FakeDeadLetterStore(alert_threshold=alert_threshold)
    slept: list[float] = []
    submitter = IdempotentRetrySubmitter(
        service="verification_listener",
        idempotency=idempotency,
        dead_letters=dead_letters,
        max_retries=max_retries,
        sleep=slept.append,
        rng=lambda: 1.0,  # top of the jitter window — deterministic
    )
    return submitter, idempotency, dead_letters, slept


class TestSubmissionId(unittest.TestCase):
    """Content addressing is what makes duplicate detection possible."""

    def test_same_payload_yields_same_id(self):
        payload = {"project_id": "p1", "tonnes": 100}
        assert compute_submission_id(payload) == compute_submission_id(dict(payload))

    def test_key_order_does_not_change_the_id(self):
        left = compute_submission_id({"a": 1, "b": 2})
        right = compute_submission_id({"b": 2, "a": 1})
        assert left == right

    def test_different_payload_yields_different_id(self):
        assert compute_submission_id({"tonnes": 100}) != compute_submission_id({"tonnes": 101})

    def test_id_is_sha256_hex(self):
        digest = compute_submission_id({"a": 1})
        assert len(digest) == 64

    def test_canonical_json_is_compact_and_sorted(self):
        assert canonical_json({"b": 1, "a": 2}) == '{"a":2,"b":1}'


class TestBackoffDelay(unittest.TestCase):
    """Exponential backoff, base 2, with jitter and a ceiling."""

    def test_delay_doubles_each_attempt(self):
        delays = [
            backoff_delay(n, base_delay=1.0, max_delay=1e9, jitter_ratio=0, rng=lambda: 0.0)
            for n in range(6)
        ]
        assert delays == [1.0, 2.0, 4.0, 8.0, 16.0, 32.0]

    def test_delay_is_capped(self):
        delay = backoff_delay(
            20, base_delay=1.0, max_delay=60.0, jitter_ratio=0, rng=lambda: 0.0
        )
        assert delay == 60.0

    def test_jitter_stays_within_the_window(self):
        for r in (0.0, 0.25, 0.5, 0.75, 1.0):
            delay = backoff_delay(
                3, base_delay=1.0, max_delay=1e9, jitter_ratio=0.5, rng=(lambda v=r: v)
            )
            assert 4.0 <= delay <= 8.0

    def test_jitter_floor_and_ceiling(self):
        low = backoff_delay(3, base_delay=1.0, max_delay=1e9, jitter_ratio=0.5, rng=lambda: 0.0)
        high = backoff_delay(3, base_delay=1.0, max_delay=1e9, jitter_ratio=0.5, rng=lambda: 1.0)
        assert low == 4.0
        assert high == 8.0

    def test_zero_jitter_is_deterministic(self):
        args = dict(base_delay=1.0, max_delay=1e9, jitter_ratio=0.0)
        assert backoff_delay(4, **args) == backoff_delay(4, **args) == 16.0

    def test_negative_attempt_is_rejected(self):
        with self.assertRaises(ValueError):
            backoff_delay(-1)


class TestRetryBehaviour(unittest.TestCase):
    """The retry loop: attempt counts, backoff sequence, permanent failures."""

    def test_first_attempt_success_does_not_sleep(self):
        submitter, _, dead_letters, slept = make_submitter()
        result = submitter.submit("submit_monitoring_data", {"id": "v1"}, lambda p, n: "tx1")

        assert result.success
        assert result.attempts == 1
        assert result.tx_hash == "tx1"
        assert slept == []
        assert dead_letters.entries == {}

    def test_exhausting_retries_dead_letters(self):
        submitter, idempotency, dead_letters, slept = make_submitter(max_retries=8)

        def always_fails(payload, nonce):
            raise RuntimeError("rpc timeout")

        result = submitter.submit("submit_monitoring_data", {"id": "v1"}, always_fails)

        assert not result.success
        assert result.dead_lettered
        assert result.attempts == 8
        assert len(slept) == 7  # no sleep after the final attempt
        assert len(dead_letters.entries) == 1
        assert idempotency.rows[result.submission_id]["status"] == STATUS_FAILED

    def test_backoff_sequence_is_exponential(self):
        submitter, _, _, slept = make_submitter(max_retries=6)

        def always_fails(payload, nonce):
            raise RuntimeError("rpc timeout")

        submitter.submit("submit_monitoring_data", {"id": "v1"}, always_fails)
        # rng=1.0 puts every draw at the top of the jitter window.
        assert slept == [1.0, 2.0, 4.0, 8.0, 16.0]

    def test_permanent_failure_is_not_retried(self):
        submitter, _, dead_letters, slept = make_submitter()

        def rejected(payload, nonce):
            raise PermanentSubmissionError("payload rejected by contract")

        result = submitter.submit("submit_monitoring_data", {"id": "v1"}, rejected)

        assert not result.success
        assert result.attempts == 1
        assert result.dead_lettered
        assert slept == []
        assert "permanent" in dead_letters.entries[result.submission_id]["errors"][0]

    def test_dead_letter_carries_full_context(self):
        submitter, _, dead_letters, _ = make_submitter(max_retries=3)
        payload = {"id": "v1", "project_id": "p1", "tonnes_verified": 500}
        errors = ["timeout", "connection reset", "503"]
        calls = iter(errors)

        def failing(p, n):
            raise RuntimeError(next(calls))

        result = submitter.submit("submit_monitoring_data", payload, failing)
        entry = dead_letters.entries[result.submission_id]

        assert entry["payload"] == payload
        assert entry["attempts"] == 3
        assert entry["errors"] == errors
        assert entry["function_name"] == "submit_monitoring_data"
        assert entry["nonce"] == result.nonce

    def test_claim_failure_is_reported_not_raised(self):
        submitter, idempotency, _, _ = make_submitter()

        def boom(*a, **k):
            raise RuntimeError("db down")

        idempotency.claim = boom
        result = submitter.submit("submit_monitoring_data", {"id": "v1"}, lambda p, n: "tx")
        assert not result.success
        assert "claim failed" in result.errors[0]


class TestIdempotency(unittest.TestCase):
    """Duplicates must be rejected before anything reaches the blockchain."""

    def test_duplicate_is_rejected_without_calling_submit(self):
        submitter, _, _, _ = make_submitter()
        payload = {"id": "v1", "tonnes": 100}
        calls = []

        def submit(p, n):
            calls.append(n)
            return "tx1"

        first = submitter.submit("submit_monitoring_data", payload, submit)
        second = submitter.submit("submit_monitoring_data", dict(payload), submit)

        assert first.success and not first.duplicate
        assert second.duplicate
        assert calls == [0], "the duplicate must never reach the submit function"

    def test_duplicate_of_a_landed_submission_reports_success_and_tx(self):
        submitter, _, _, _ = make_submitter()
        payload = {"id": "v1"}
        submitter.submit("submit_monitoring_data", payload, lambda p, n: "txABC")

        second = submitter.submit("submit_monitoring_data", dict(payload), lambda p, n: "txXYZ")
        assert second.duplicate
        assert second.success
        assert second.tx_hash == "txABC"

    def test_duplicate_of_a_failed_submission_reports_failure(self):
        submitter, _, _, _ = make_submitter(max_retries=1)

        def fails(p, n):
            raise RuntimeError("rpc down")

        payload = {"id": "v1"}
        submitter.submit("submit_monitoring_data", payload, fails)

        second = submitter.submit("submit_monitoring_data", dict(payload), lambda p, n: "tx")
        assert second.duplicate
        assert not second.success

    def test_nonce_is_stable_across_retries(self):
        """
        The on-chain half of exactly-once: every retry replays the same nonce,
        so a submission that actually landed is rejected rather than doubled.
        """
        submitter, _, _, _ = make_submitter(max_retries=4)
        seen = []

        def flaky(p, n):
            seen.append(n)
            if len(seen) < 3:
                raise RuntimeError("rpc timeout")
            return "tx1"

        result = submitter.submit("submit_monitoring_data", {"id": "v1"}, flaky)
        assert result.success
        assert seen == [0, 0, 0], "nonce must not change between retries"

    def test_distinct_payloads_get_distinct_nonces(self):
        submitter, _, _, _ = make_submitter()
        first = submitter.submit("submit_monitoring_data", {"id": "v1"}, lambda p, n: "tx1")
        second = submitter.submit("submit_monitoring_data", {"id": "v2"}, lambda p, n: "tx2")
        assert first.nonce != second.nonce


class TestRpcOutageIntegration(unittest.TestCase):
    """Integration: an RPC outage, then recovery — the issue's named scenario."""

    def test_submission_succeeds_after_transient_rpc_failures(self):
        submitter, idempotency, dead_letters, slept = make_submitter(max_retries=8)
        attempts = {"n": 0}

        def flaky_rpc(payload, nonce):
            attempts["n"] += 1
            if attempts["n"] <= 4:
                raise ConnectionError("soroban rpc unavailable (503)")
            return "tx-recovered"

        result = submitter.submit(
            "submit_monitoring_data",
            {"id": "v1", "project_id": "p1", "tonnes_verified": 250},
            flaky_rpc,
        )

        assert result.success
        assert result.attempts == 5
        assert result.tx_hash == "tx-recovered"
        assert slept == [1.0, 2.0, 4.0, 8.0]  # backed off between each failure
        assert dead_letters.entries == {}, "recovery must not dead-letter"
        assert idempotency.rows[result.submission_id]["status"] == STATUS_SUBMITTED

    def test_outage_lasting_beyond_the_budget_dead_letters(self):
        submitter, _, dead_letters, _ = make_submitter(max_retries=8)
        attempts = {"n": 0}

        def long_outage(payload, nonce):
            attempts["n"] += 1
            raise ConnectionError("soroban rpc unavailable (503)")

        result = submitter.submit("submit_monitoring_data", {"id": "v1"}, long_outage)

        assert not result.success
        assert attempts["n"] == 8
        assert result.dead_lettered
        assert len(result.errors) == 8

    def test_replay_after_recovery_is_a_no_op(self):
        """A listener restart mid-outage must not double-submit on recovery."""
        submitter, _, _, _ = make_submitter(max_retries=8)
        payload = {"id": "v1", "tonnes_verified": 250}
        calls = []

        def rpc(p, n):
            calls.append(n)
            return "tx1"

        submitter.submit("submit_monitoring_data", payload, rpc)
        replay = submitter.submit("submit_monitoring_data", dict(payload), rpc)

        assert replay.duplicate
        assert len(calls) == 1


class TestDeadLetterAlerting(unittest.TestCase):
    """Depth alerting fires above a configurable threshold."""

    def test_no_alert_below_threshold(self):
        submitter, _, dead_letters, _ = make_submitter(max_retries=1, alert_threshold=3)
        for i in range(3):
            submitter.submit(
                "submit_monitoring_data",
                {"id": f"v{i}"},
                lambda p, n: (_ for _ in ()).throw(RuntimeError("down")),
            )
        assert dead_letters.depth() == 3
        assert dead_letters.alerts == 0

    def test_alert_fires_once_threshold_is_crossed(self):
        submitter, _, dead_letters, _ = make_submitter(max_retries=1, alert_threshold=3)
        for i in range(4):
            submitter.submit(
                "submit_monitoring_data",
                {"id": f"v{i}"},
                lambda p, n: (_ for _ in ()).throw(RuntimeError("down")),
            )
        assert dead_letters.depth() == 4
        assert dead_letters.alerts == 1

    @patch("retry_submitter.requests.post")
    def test_store_posts_to_webhook_above_threshold(self, mock_post):
        store = DeadLetterStore(
            database_url="postgres://x",
            alert_webhook="https://hooks.example/dlq",
            alert_threshold=5,
        )
        store.depth = lambda: 9

        assert store.check_depth_and_alert() is True
        body = mock_post.call_args.kwargs["json"]
        assert body["depth"] == 9
        assert body["threshold"] == 5

    @patch("retry_submitter.requests.post")
    def test_store_does_not_post_at_or_below_threshold(self, mock_post):
        store = DeadLetterStore(
            database_url="postgres://x",
            alert_webhook="https://hooks.example/dlq",
            alert_threshold=5,
        )
        store.depth = lambda: 5

        assert store.check_depth_and_alert() is False
        mock_post.assert_not_called()

    @patch("retry_submitter.requests.post", side_effect=RuntimeError("hook down"))
    def test_alert_delivery_failure_is_swallowed(self, _mock_post):
        store = DeadLetterStore(
            database_url="postgres://x",
            alert_webhook="https://hooks.example/dlq",
            alert_threshold=1,
        )
        store.depth = lambda: 99
        assert store.check_depth_and_alert() is False

    @patch("retry_submitter.psycopg2.connect", side_effect=RuntimeError("db down"))
    def test_depth_read_failure_returns_zero(self, _connect):
        assert DeadLetterStore(database_url="postgres://x").depth() == 0

    @patch("retry_submitter.psycopg2.connect", side_effect=RuntimeError("db down"))
    def test_record_failure_is_swallowed(self, _connect):
        store = DeadLetterStore(database_url="postgres://x")
        assert store.record("id", "svc", "fn", {"a": 1}, 3, ["e"]) is False


class TestIdempotencyStoreSql(unittest.TestCase):
    """The claim path is an atomic INSERT … ON CONFLICT, not read-then-write."""

    @patch("retry_submitter.psycopg2.connect")
    def test_claim_returns_claimed_when_insert_wins(self, mock_connect):
        cur = mock_connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = (7,)

        claim = IdempotencyStore(database_url="postgres://x").claim(
            "a" * 64, "verification_listener", "submit_monitoring_data", "a" * 64
        )
        assert claim.claimed
        assert claim.nonce == 7
        assert not claim.is_duplicate

        sql = cur.execute.call_args_list[0][0][0]
        assert "ON CONFLICT (submission_id) DO NOTHING" in sql

    @patch("retry_submitter.psycopg2.connect")
    def test_claim_returns_duplicate_on_conflict(self, mock_connect):
        cur = mock_connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        cur.fetchone.side_effect = [None, (3, STATUS_SUBMITTED, "txOLD")]

        claim = IdempotencyStore(database_url="postgres://x").claim(
            "b" * 64, "verification_listener", "submit_monitoring_data", "b" * 64
        )
        assert claim.is_duplicate
        assert claim.nonce == 3
        assert claim.status == STATUS_SUBMITTED
        assert claim.tx_hash == "txOLD"


class TestVerificationListenerIntegration(unittest.TestCase):
    """The listener wires the submitter into its processing loop."""

    def _listener(self, submitter):
        import verification_listener

        listener = verification_listener.VerificationListener.__new__(
            verification_listener.VerificationListener
        )
        listener.submitter = submitter
        return listener

    def test_process_verification_returns_true_on_success(self):
        submitter, _, _, _ = make_submitter()
        listener = self._listener(submitter)
        listener.submit_to_contract = lambda payload, nonce: "tx1"

        assert listener.process_verification({"id": "v1"}) is True

    def test_process_verification_returns_false_when_dead_lettered(self):
        submitter, _, dead_letters, _ = make_submitter(max_retries=2)
        listener = self._listener(submitter)

        def fails(payload, nonce):
            raise RuntimeError("rpc down")

        listener.submit_to_contract = fails
        assert listener.process_verification({"id": "v1"}) is False
        assert len(dead_letters.entries) == 1

    def test_reprocessing_the_same_verification_is_a_no_op(self):
        submitter, _, _, _ = make_submitter()
        listener = self._listener(submitter)
        calls = []
        listener.submit_to_contract = lambda payload, nonce: (calls.append(nonce), "tx1")[1]

        verification = {"id": "v1", "project_id": "p1"}
        assert listener.process_verification(verification) is True
        assert listener.process_verification(dict(verification)) is True
        assert len(calls) == 1


if __name__ == "__main__":
    unittest.main()
