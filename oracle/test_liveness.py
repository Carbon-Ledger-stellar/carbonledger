"""
Unit tests for oracle liveness monitoring and the dead-man's switch (#576).

Covers the pure liveness decision, alert dispatch (including the cooldown that
stops a down service from spamming the channel), the dead-man's switch, and the
monitor's end-to-end pass over a faked heartbeat table.
"""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from liveness import (  # noqa: E402
    NEVER_SEEN,
    OK,
    STALE,
    AlertDispatcher,
    CheckResult,
    DeadMansSwitch,
    LivenessMonitor,
    ServiceLiveness,
    emit_heartbeat,
    evaluate_liveness,
)


class FakeClock:
    """Monotonic clock the tests can advance by hand."""

    def __init__(self, start: float = 0.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class TestEvaluateLiveness(unittest.TestCase):
    """The staleness decision: silent for more than 2x the expected interval."""

    def test_recent_heartbeat_is_ok(self):
        status = evaluate_liveness("price_oracle", silent_for=60, expected_interval=300)
        assert status.status == OK
        assert not status.is_stale

    def test_silence_just_under_threshold_is_ok(self):
        status = evaluate_liveness("price_oracle", silent_for=599, expected_interval=300)
        assert status.status == OK

    def test_silence_exactly_at_threshold_is_ok(self):
        """2x the interval is the tolerated boundary, not a breach."""
        status = evaluate_liveness("price_oracle", silent_for=600, expected_interval=300)
        assert status.status == OK

    def test_silence_past_threshold_is_stale(self):
        status = evaluate_liveness("price_oracle", silent_for=601, expected_interval=300)
        assert status.status == STALE
        assert status.is_stale

    def test_never_seen_is_stale(self):
        status = evaluate_liveness("satellite_monitor", silent_for=None, expected_interval=300)
        assert status.status == NEVER_SEEN
        assert status.is_stale

    def test_threshold_is_two_intervals(self):
        status = evaluate_liveness("verification_listener", silent_for=0, expected_interval=300)
        assert status.threshold == 600

    def test_describe_mentions_service_and_threshold(self):
        status = evaluate_liveness("price_oracle", silent_for=5000, expected_interval=300)
        text = status.describe()
        assert "price_oracle" in text
        assert "5000s" in text

    def test_to_dict_is_json_serialisable(self):
        status = evaluate_liveness(
            "price_oracle", silent_for=10, expected_interval=300, last_seen_at="2026-08-07T00:00:00Z"
        )
        payload = status.to_dict()
        assert payload["service"] == "price_oracle"
        assert payload["status"] == OK
        assert payload["threshold_seconds"] == 600


class TestAlertDispatcher(unittest.TestCase):
    """Alert delivery and the per-service cooldown."""

    def setUp(self):
        self.clock = FakeClock()
        self.stale = evaluate_liveness("price_oracle", silent_for=99999, expected_interval=300)

    def _dispatcher(self, **kwargs):
        return AlertDispatcher(
            webhook_url="https://hooks.example/liveness",
            email_to=[],
            cooldown_seconds=3600,
            clock=self.clock,
            **kwargs,
        )

    @patch("liveness.requests.post")
    def test_first_alert_is_delivered(self, mock_post):
        dispatcher = self._dispatcher()
        assert dispatcher.dispatch(self.stale) is True
        mock_post.assert_called_once()
        body = mock_post.call_args.kwargs["json"]
        assert "price_oracle" in body["text"]
        assert body["liveness"]["status"] == STALE

    @patch("liveness.requests.post")
    def test_repeat_alert_within_cooldown_is_suppressed(self, mock_post):
        dispatcher = self._dispatcher()
        dispatcher.dispatch(self.stale)
        assert dispatcher.dispatch(self.stale) is False
        assert mock_post.call_count == 1

    @patch("liveness.requests.post")
    def test_alert_fires_again_after_cooldown(self, mock_post):
        dispatcher = self._dispatcher()
        dispatcher.dispatch(self.stale)
        self.clock.advance(3601)
        assert dispatcher.dispatch(self.stale) is True
        assert mock_post.call_count == 2

    @patch("liveness.requests.post")
    def test_cooldown_is_per_service(self, mock_post):
        dispatcher = self._dispatcher()
        other = evaluate_liveness("satellite_monitor", silent_for=99999, expected_interval=300)
        dispatcher.dispatch(self.stale)
        assert dispatcher.dispatch(other) is True
        assert mock_post.call_count == 2

    @patch("liveness.requests.post", side_effect=RuntimeError("webhook down"))
    def test_webhook_failure_does_not_raise(self, _mock_post):
        dispatcher = self._dispatcher()
        assert dispatcher.dispatch(self.stale) is False

    @patch("liveness.requests.post")
    def test_no_channel_configured_logs_only(self, mock_post):
        dispatcher = AlertDispatcher(
            webhook_url="", email_to=[], cooldown_seconds=0, clock=self.clock
        )
        assert dispatcher.dispatch(self.stale) is False
        mock_post.assert_not_called()


class TestDeadMansSwitch(unittest.TestCase):
    """The on-chain half: check_liveness per affected project."""

    def setUp(self):
        self.calls = []

        def invoke(fn, args):
            self.calls.append((fn, args))
            return "txhash"

        self.invoke = invoke
        self.stale = evaluate_liveness("satellite_monitor", silent_for=99999, expected_interval=300)

    def _switch(self, projects, **kwargs):
        switch = DeadMansSwitch(invoke=self.invoke, database_url="", **kwargs)
        switch.affected_projects = lambda service: list(projects)
        return switch

    def test_trip_calls_check_liveness_per_project(self):
        switch = self._switch(["proj-1", "proj-2"])
        tripped = switch.trip(self.stale)
        assert tripped == ["proj-1", "proj-2"]
        assert self.calls == [("check_liveness", ["proj-1"]), ("check_liveness", ["proj-2"])]

    def test_trip_is_skipped_for_price_oracle(self):
        """Benchmark prices have their own on-chain staleness window."""
        switch = self._switch(["proj-1"])
        price_stale = evaluate_liveness("price_oracle", silent_for=99999, expected_interval=300)
        assert switch.trip(price_stale) == []
        assert self.calls == []

    def test_trip_respects_disabled_flag(self):
        switch = self._switch(["proj-1"], enabled=False)
        assert switch.trip(self.stale) == []
        assert self.calls == []

    def test_one_failing_project_does_not_stop_the_sweep(self):
        def flaky(fn, args):
            if args[0] == "proj-bad":
                raise RuntimeError("rpc error")
            self.calls.append((fn, args))
            return "txhash"

        switch = DeadMansSwitch(invoke=flaky, database_url="")
        switch.affected_projects = lambda service: ["proj-bad", "proj-good"]
        assert switch.trip(self.stale) == ["proj-good"]

    def test_no_invoker_configured_is_a_no_op(self):
        switch = DeadMansSwitch(invoke=None, database_url="")
        switch.invoke = None
        switch.affected_projects = lambda service: ["proj-1"]
        assert switch.trip(self.stale) == []


class TestLivenessMonitor(unittest.TestCase):
    """Full monitor pass over a faked heartbeat table."""

    def setUp(self):
        self.clock = FakeClock()
        self.dispatcher = AlertDispatcher(
            webhook_url="https://hooks.example/liveness",
            email_to=[],
            cooldown_seconds=3600,
            clock=self.clock,
        )
        self.tripped = []

        def invoke(fn, args):
            self.tripped.append(args[0])
            return "txhash"

        self.switch = DeadMansSwitch(invoke=invoke, database_url="")
        self.switch.affected_projects = lambda service: ["proj-1"]

    def _monitor(self, rows):
        monitor = LivenessMonitor(
            dispatcher=self.dispatcher,
            dead_mans_switch=self.switch,
            database_url="",
            services=list(rows) or ["verification_listener"],
        )
        monitor.fetch_heartbeats = lambda: rows
        monitor.record_alert = lambda *a, **k: None
        return monitor

    @staticmethod
    def _row(service, silent_for, interval):
        return {
            "service_name": service,
            "instance_id": "oracle-0",
            "last_seen_at": "2026-08-07T00:00:00+00:00",
            "expected_interval": interval,
            "beat_count": 12,
            "silent_for": silent_for,
        }

    @patch("liveness.requests.post")
    def test_all_services_fresh_produces_no_alert(self, mock_post):
        rows = {
            "verification_listener": self._row("verification_listener", 60, 300),
            "price_oracle": self._row("price_oracle", 600, 43200),
        }
        result = self._monitor(rows).check()
        assert result.stale_services == []
        assert result.alerted == []
        mock_post.assert_not_called()

    @patch("liveness.requests.post")
    def test_stale_service_alerts_and_trips_switch(self, mock_post):
        rows = {"satellite_monitor": self._row("satellite_monitor", 200_000, 86400)}
        result = self._monitor(rows).check()
        assert result.stale_services == ["satellite_monitor"]
        assert result.alerted == ["satellite_monitor"]
        assert result.tripped_projects == {"satellite_monitor": ["proj-1"]}
        assert self.tripped == ["proj-1"]
        mock_post.assert_called_once()

    @patch("liveness.requests.post")
    def test_service_with_no_heartbeat_row_is_never_seen(self, mock_post):
        monitor = LivenessMonitor(
            dispatcher=self.dispatcher,
            dead_mans_switch=self.switch,
            database_url="",
            services=["price_oracle"],
        )
        monitor.fetch_heartbeats = dict
        monitor.record_alert = lambda *a, **k: None

        statuses = monitor.statuses()
        assert len(statuses) == 1
        assert statuses[0].status == NEVER_SEEN

        result = monitor.check()
        assert result.stale_services == ["price_oracle"]
        mock_post.assert_called_once()

    def test_dashboard_lists_every_service(self):
        rows = {
            "verification_listener": self._row("verification_listener", 60, 300),
            "price_oracle": self._row("price_oracle", 999_999, 43200),
        }
        table = self._monitor(rows).dashboard()
        assert "verification_listener" in table
        assert "price_oracle" in table
        assert "SERVICE" in table and "LAST SEEN" in table

    def test_check_result_serialises(self):
        result = CheckResult(
            statuses=[ServiceLiveness("price_oracle", STALE, 300, silent_for=1000)],
            alerted=["price_oracle"],
        )
        payload = result.to_dict()
        assert payload["stale"] == ["price_oracle"]
        assert payload["services"][0]["service"] == "price_oracle"


class TestEmitHeartbeat(unittest.TestCase):
    """Heartbeat writes are best-effort and must never break a submission."""

    def test_missing_database_url_returns_false(self):
        assert emit_heartbeat("price_oracle", database_url="") is False

    @patch("liveness.psycopg2.connect", side_effect=RuntimeError("db down"))
    def test_db_failure_is_swallowed(self, _mock_connect):
        assert emit_heartbeat("price_oracle", database_url="postgres://x") is False

    @patch("liveness.psycopg2.connect")
    def test_successful_write_returns_true(self, mock_connect):
        assert emit_heartbeat(
            "price_oracle",
            detail={"prices_submitted": 3},
            database_url="postgres://x",
        ) is True
        cursor = mock_connect.return_value.__enter__.return_value.cursor
        cursor.return_value.__enter__.return_value.execute.assert_called_once()

    @patch("liveness.psycopg2.connect")
    def test_interval_defaults_per_service(self, mock_connect):
        emit_heartbeat("verification_listener", database_url="postgres://x")
        execute = (
            mock_connect.return_value.__enter__.return_value.cursor.return_value
            .__enter__.return_value.execute
        )
        params = execute.call_args[0][1]
        assert params[0] == "verification_listener"
        assert params[2] == 300


if __name__ == "__main__":
    unittest.main()
