"""
liveness.py — heartbeat + dead-man's switch for the oracle services (issue #576).

Three services submit data on-chain on their own cadence:

  | service               | trigger                | default expected interval |
  |-----------------------|------------------------|---------------------------|
  | verification_listener | schedule (poll)        | 300 s                     |
  | price_oracle          | schedule (poll)        | 12 h                      |
  | satellite_monitor     | inbound provider hook  | 24 h                      |

Each service calls :func:`emit_heartbeat` after every *successful* submission.
The heartbeat is an upsert into ``oracle_heartbeats`` recording ``last_seen_at``
and the service's own expected interval, so the monitor needs no static config
to know what "late" means for a given service.

:class:`LivenessMonitor` reads that table and marks a service ``STALE`` once
``now - last_seen_at`` exceeds ``LIVENESS_STALE_MULTIPLIER`` (default 2) times
the expected interval, then fires an alert (webhook and/or email) with a
per-service cooldown so a down service does not spam the channel.

The dead-man's switch (:class:`DeadMansSwitch`) is the on-chain half: when a
service that feeds project monitoring data goes stale, it calls the
permissionless ``carbon_oracle::check_liveness(project_id)`` for each affected
project.  That contract function is what actually flags the project and
suspends it via the registry — this module never needs oracle signing keys.

Out of scope (per the issue): restarting oracle services, and any change to
alert delivery infrastructure.  We post to the webhook / SMTP relay that is
already configured for the deployment.
"""

from __future__ import annotations

import json
import os
import smtplib
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from email.message import EmailMessage

import psycopg2
import psycopg2.extras
import requests
from db_schema import get_heartbeat_schema_sql  # noqa: F401 — re-exported for callers
from log import get_logger

log = get_logger("liveness")

# ── Config ────────────────────────────────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL", "")

#: A service is stale once it has been silent for this many expected intervals.
STALE_MULTIPLIER = float(os.environ.get("LIVENESS_STALE_MULTIPLIER", "2"))

#: Minimum seconds between two alerts for the same service.
ALERT_COOLDOWN_SECONDS = int(os.environ.get("LIVENESS_ALERT_COOLDOWN", "3600"))

#: Webhook that receives liveness alerts.  Falls back to the shared admin hook.
ALERT_WEBHOOK = (
    os.environ.get("LIVENESS_ALERT_WEBHOOK")
    or os.environ.get("ADMIN_ALERT_WEBHOOK", "")
)

#: Comma-separated recipient list for e-mail alerts.  Empty disables e-mail.
ALERT_EMAIL_TO = [
    addr.strip() for addr in os.environ.get("LIVENESS_ALERT_EMAIL_TO", "").split(",") if addr.strip()
]
ALERT_EMAIL_FROM = os.environ.get("LIVENESS_ALERT_EMAIL_FROM", "oracle-alerts@carbonledger.io")
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")

#: How often the monitor loop re-checks when run as a daemon.
CHECK_INTERVAL_SECONDS = int(os.environ.get("LIVENESS_CHECK_INTERVAL", "60"))

#: Services tracked by the monitor and the interval each one is expected to
#: submit within.  Overridable per-service via env, e.g. PRICE_ORACLE_INTERVAL.
DEFAULT_INTERVALS: dict[str, int] = {
    "verification_listener": int(os.environ.get("VERIFICATION_LISTENER_INTERVAL", 300)),
    "price_oracle": int(os.environ.get("PRICE_ORACLE_INTERVAL", 12 * 3600)),
    "satellite_monitor": int(os.environ.get("SATELLITE_MONITOR_INTERVAL", 24 * 3600)),
}

TRACKED_SERVICES = tuple(DEFAULT_INTERVALS)

#: Services whose staleness should trigger the on-chain dead-man's switch.
#: price_oracle feeds benchmark prices, which have their own on-chain staleness
#: window (is_price_current), so it is deliberately excluded here.
MONITORING_SERVICES = ("verification_listener", "satellite_monitor")

OK = "ok"
STALE = "stale"
NEVER_SEEN = "never_seen"


# ── Heartbeat emission ────────────────────────────────────────────────────────
#
# DDL for oracle_heartbeats / oracle_liveness_alerts lives in db_schema.py
# alongside the rest of the oracle tables (see HEARTBEAT_SCHEMA_SQL).

_UPSERT_SQL = """
INSERT INTO oracle_heartbeats
    (service_name, instance_id, last_seen_at, expected_interval, beat_count, last_detail, updated_at)
VALUES (%s, %s, NOW(), %s, 1, %s, NOW())
ON CONFLICT (service_name) DO UPDATE SET
    instance_id       = EXCLUDED.instance_id,
    last_seen_at      = NOW(),
    expected_interval = EXCLUDED.expected_interval,
    beat_count        = oracle_heartbeats.beat_count + 1,
    last_detail       = EXCLUDED.last_detail,
    updated_at        = NOW();
"""


def emit_heartbeat(
    service_name: str,
    detail: dict | None = None,
    expected_interval: int | None = None,
    database_url: str | None = None,
) -> bool:
    """
    Record a heartbeat for ``service_name`` after a successful submission.

    Never raises: a heartbeat failure must not fail the submission that
    triggered it.  Returns True when the row was written.
    """
    dsn = database_url if database_url is not None else DATABASE_URL
    if not dsn:
        log.warning("DATABASE_URL not configured — heartbeat for %s dropped", service_name)
        return False

    interval = expected_interval or DEFAULT_INTERVALS.get(service_name, 3600)
    instance_id = os.environ.get("HOSTNAME", "local")

    try:
        with psycopg2.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    _UPSERT_SQL,
                    (
                        service_name,
                        instance_id,
                        interval,
                        json.dumps(detail or {}),
                    ),
                )
        log.info(
            "heartbeat recorded",
            extra={"service_name": service_name, "expected_interval": interval},
        )
        return True
    except Exception as e:  # noqa: BLE001 — heartbeats are best-effort
        log.error("Heartbeat write failed for %s: %s", service_name, e)
        return False


# ── Status model ──────────────────────────────────────────────────────────────


@dataclass
class ServiceLiveness:
    """Liveness verdict for a single oracle service."""

    service_name: str
    status: str
    expected_interval: int
    silent_for: int | None = None
    last_seen_at: str | None = None
    beat_count: int = 0
    instance_id: str | None = None

    @property
    def threshold(self) -> int:
        """Seconds of silence tolerated before the service is considered stale."""
        return int(self.expected_interval * STALE_MULTIPLIER)

    @property
    def is_stale(self) -> bool:
        return self.status in (STALE, NEVER_SEEN)

    def to_dict(self) -> dict:
        return {
            "service": self.service_name,
            "status": self.status,
            "last_seen_at": self.last_seen_at,
            "silent_for_seconds": self.silent_for,
            "expected_interval_seconds": self.expected_interval,
            "threshold_seconds": self.threshold,
            "beat_count": self.beat_count,
            "instance_id": self.instance_id,
        }

    def describe(self) -> str:
        if self.status == NEVER_SEEN:
            return f"{self.service_name}: no heartbeat ever recorded"
        if self.status == STALE:
            return (
                f"{self.service_name}: silent for {self.silent_for}s "
                f"(threshold {self.threshold}s, last seen {self.last_seen_at})"
            )
        return f"{self.service_name}: ok (last seen {self.last_seen_at})"


def evaluate_liveness(
    service_name: str,
    silent_for: int | None,
    expected_interval: int,
    *,
    last_seen_at: str | None = None,
    beat_count: int = 0,
    instance_id: str | None = None,
) -> ServiceLiveness:
    """
    Pure liveness decision — no I/O, so it is directly unit-testable.

    ``silent_for`` is None when the service has never emitted a heartbeat.
    """
    if silent_for is None:
        status = NEVER_SEEN
    elif silent_for > expected_interval * STALE_MULTIPLIER:
        status = STALE
    else:
        status = OK

    return ServiceLiveness(
        service_name=service_name,
        status=status,
        expected_interval=expected_interval,
        silent_for=silent_for,
        last_seen_at=last_seen_at,
        beat_count=beat_count,
        instance_id=instance_id,
    )


# ── Alerting ──────────────────────────────────────────────────────────────────


class AlertDispatcher:
    """
    Delivers liveness alerts over the deployment's existing channels.

    Applies a per-service cooldown so a service that stays down produces one
    alert per ``ALERT_COOLDOWN_SECONDS`` rather than one per check cycle.
    """

    def __init__(
        self,
        webhook_url: str | None = None,
        email_to: Iterable[str] | None = None,
        cooldown_seconds: int | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.webhook_url = ALERT_WEBHOOK if webhook_url is None else webhook_url
        self.email_to = list(ALERT_EMAIL_TO if email_to is None else email_to)
        self.cooldown = ALERT_COOLDOWN_SECONDS if cooldown_seconds is None else cooldown_seconds
        self._clock = clock
        self._last_alert: dict[str, float] = {}

    def should_alert(self, service_name: str) -> bool:
        last = self._last_alert.get(service_name)
        return last is None or (self._clock() - last) >= self.cooldown

    def dispatch(self, status: ServiceLiveness) -> bool:
        """
        Send an alert for a stale service.  Returns True when something was
        actually delivered (False when suppressed by the cooldown).
        """
        if not self.should_alert(status.service_name):
            log.info(
                "liveness alert suppressed by cooldown",
                extra={"service_name": status.service_name},
            )
            return False

        self._last_alert[status.service_name] = self._clock()
        message = f"🔴 Oracle liveness alert — {status.describe()}"

        delivered = False
        if self.webhook_url:
            delivered |= self._post_webhook(message, status)
        if self.email_to:
            delivered |= self._send_email(message, status)
        if not self.webhook_url and not self.email_to:
            log.error("LIVENESS ALERT (no channel configured): %s", message)

        return delivered

    def _post_webhook(self, message: str, status: ServiceLiveness) -> bool:
        try:
            requests.post(
                self.webhook_url,
                json={"text": message, "liveness": status.to_dict()},
                timeout=10,
            )
            return True
        except Exception as e:  # noqa: BLE001 — alerting must not crash the monitor
            log.error("Liveness webhook delivery failed: %s", e)
            return False

    def _send_email(self, message: str, status: ServiceLiveness) -> bool:
        if not SMTP_HOST:
            log.warning("LIVENESS_ALERT_EMAIL_TO set but SMTP_HOST is not — skipping e-mail")
            return False
        try:
            msg = EmailMessage()
            msg["Subject"] = f"[CarbonLedger] Oracle liveness: {status.service_name} {status.status}"
            msg["From"] = ALERT_EMAIL_FROM
            msg["To"] = ", ".join(self.email_to)
            msg.set_content(
                f"{message}\n\n{json.dumps(status.to_dict(), indent=2)}\n\n"
                "Runbook: docs/runbooks/oracle-liveness.md"
            )
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
                smtp.starttls()
                if SMTP_USER:
                    smtp.login(SMTP_USER, SMTP_PASSWORD)
                smtp.send_message(msg)
            return True
        except Exception as e:  # noqa: BLE001
            log.error("Liveness e-mail delivery failed: %s", e)
            return False


# ── Dead-man's switch ─────────────────────────────────────────────────────────


def soroban_invoker() -> Callable[[str, list], str] | None:
    """
    Build a contract invoker for the dead-man's switch, or None when the
    deployment has not been given a funded source account.

    ``check_liveness`` is permissionless, so any funded account can call it —
    ``LIVENESS_SUBMITTER_SECRET`` should be a low-privilege key, not the oracle
    signing key.  stellar_sdk is imported lazily so that the pure-logic parts of
    this module stay importable without Stellar config.
    """
    secret = os.environ.get("LIVENESS_SUBMITTER_SECRET") or os.environ.get("ORACLE_SECRET_KEY", "")
    contract_id = os.environ.get("CARBON_ORACLE_CONTRACT_ID", "")
    if not secret or not contract_id:
        return None

    from stellar_sdk import Keypair, Network, SorobanServer, TransactionBuilder, scval
    from stellar_sdk.soroban_rpc import SendTransactionStatus

    rpc_url = os.environ.get("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org")
    passphrase = os.environ.get("NETWORK_PASSPHRASE", Network.TESTNET_NETWORK_PASSPHRASE)

    def invoke(function_name: str, args: list) -> str:
        server = SorobanServer(rpc_url)
        keypair = Keypair.from_secret(secret)
        account = server.load_account(keypair.public_key)
        tx = (
            TransactionBuilder(
                source_account=account, network_passphrase=passphrase, base_fee=300
            )
            .append_invoke_contract_function_op(
                contract_id=contract_id,
                function_name=function_name,
                parameters=[scval.to_string(a) for a in args],
            )
            .set_timeout(30)
            .build()
        )
        tx = server.prepare_transaction(tx)
        tx.sign(keypair)
        response = server.send_transaction(tx)
        if response.status == SendTransactionStatus.ERROR:
            raise RuntimeError(f"{function_name} failed: {response.error_result_xdr}")
        return response.hash

    return invoke


class DeadMansSwitch:
    """
    On-chain half of liveness monitoring.

    When a monitoring-feeding service goes stale, calls the permissionless
    ``carbon_oracle::check_liveness(project_id)`` for every project the service
    has previously reported on.  ``check_liveness`` is idempotent: projects that
    are already flagged are left untouched, and projects still inside the
    on-chain SLA window are unaffected.

    ``invoke`` is injected so tests (and dry runs) need no RPC access.  In
    production it is ``satellite_monitor.build_and_submit``-style contract call.
    """

    def __init__(
        self,
        invoke: Callable[[str, list], str] | None = None,
        database_url: str | None = None,
        enabled: bool | None = None,
    ) -> None:
        self.invoke = invoke if invoke is not None else soroban_invoker()
        self.database_url = database_url if database_url is not None else DATABASE_URL
        if enabled is None:
            enabled = os.environ.get("LIVENESS_DEADMAN_ENABLED", "true").lower() == "true"
        self.enabled = enabled

    def affected_projects(self, service_name: str) -> list[str]:
        """Projects whose freshest monitoring data came from ``service_name``."""
        if not self.database_url:
            return []
        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT DISTINCT project_id
                          FROM oracle_submissions
                         WHERE on_chain_submitted = true
                           AND (submitted_by = %s OR %s = 'verification_listener')
                        """,
                        (service_name, service_name),
                    )
                    return [row[0] for row in cur.fetchall()]
        except Exception as e:  # noqa: BLE001
            log.error("Failed to list affected projects for %s: %s", service_name, e)
            return []

    def trip(self, status: ServiceLiveness) -> list[str]:
        """
        Flag every project affected by a stale service.  Returns the project ids
        for which ``check_liveness`` was invoked successfully.
        """
        if not self.enabled:
            log.info("Dead-man's switch disabled — not tripping for %s", status.service_name)
            return []
        if status.service_name not in MONITORING_SERVICES:
            return []
        if self.invoke is None:
            log.warning(
                "Dead-man's switch has no contract invoker configured — "
                "skipping on-chain staleness flag for %s",
                status.service_name,
            )
            return []

        tripped: list[str] = []
        for project_id in self.affected_projects(status.service_name):
            try:
                self.invoke("check_liveness", [project_id])
                tripped.append(project_id)
            except Exception as e:  # noqa: BLE001 — one bad project must not stop the sweep
                log.error("check_liveness failed for project %s: %s", project_id, e)

        log.warning(
            "dead-man's switch tripped",
            extra={"service_name": status.service_name, "projects_flagged": len(tripped)},
        )
        return tripped


# ── Monitor ───────────────────────────────────────────────────────────────────


@dataclass
class CheckResult:
    """Outcome of one monitor pass."""

    statuses: list[ServiceLiveness] = field(default_factory=list)
    alerted: list[str] = field(default_factory=list)
    tripped_projects: dict[str, list[str]] = field(default_factory=dict)

    @property
    def stale_services(self) -> list[str]:
        return [s.service_name for s in self.statuses if s.is_stale]

    def to_dict(self) -> dict:
        return {
            "services": [s.to_dict() for s in self.statuses],
            "stale": self.stale_services,
            "alerted": self.alerted,
            "tripped_projects": self.tripped_projects,
        }


class LivenessMonitor:
    """Reads ``oracle_heartbeats``, alerts on stale services, trips the switch."""

    def __init__(
        self,
        dispatcher: AlertDispatcher | None = None,
        dead_mans_switch: DeadMansSwitch | None = None,
        database_url: str | None = None,
        services: Iterable[str] = TRACKED_SERVICES,
    ) -> None:
        self.dispatcher = dispatcher or AlertDispatcher()
        self.dead_mans_switch = dead_mans_switch or DeadMansSwitch()
        self.database_url = database_url if database_url is not None else DATABASE_URL
        self.services = list(services)

    def fetch_heartbeats(self) -> dict[str, dict]:
        """Return ``{service_name: row}`` for every recorded heartbeat."""
        if not self.database_url:
            log.error("DATABASE_URL not configured — cannot read heartbeats")
            return {}
        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT service_name,
                               instance_id,
                               last_seen_at,
                               expected_interval,
                               beat_count,
                               EXTRACT(EPOCH FROM (NOW() - last_seen_at))::bigint AS silent_for
                          FROM oracle_heartbeats
                        """
                    )
                    return {row["service_name"]: dict(row) for row in cur.fetchall()}
        except Exception as e:  # noqa: BLE001
            log.error("Failed to read heartbeats: %s", e)
            return {}

    def statuses(self) -> list[ServiceLiveness]:
        rows = self.fetch_heartbeats()
        out: list[ServiceLiveness] = []
        for service in self.services:
            row = rows.get(service)
            if row is None:
                out.append(
                    evaluate_liveness(service, None, DEFAULT_INTERVALS.get(service, 3600))
                )
                continue
            out.append(
                evaluate_liveness(
                    service,
                    int(row["silent_for"]),
                    int(row["expected_interval"]),
                    last_seen_at=str(row["last_seen_at"]),
                    beat_count=int(row["beat_count"]),
                    instance_id=row["instance_id"],
                )
            )
        return out

    def record_alert(self, status: ServiceLiveness, message: str, delivered: bool) -> None:
        """Persist the alert so the dashboard can show alert history."""
        if not self.database_url:
            return
        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO oracle_liveness_alerts
                            (service_name, status, silent_for, threshold, message, delivered)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            status.service_name,
                            status.status,
                            status.silent_for,
                            status.threshold,
                            message,
                            delivered,
                        ),
                    )
        except Exception as e:  # noqa: BLE001
            log.error("Failed to record liveness alert: %s", e)

    def check(self) -> CheckResult:
        """Run a single monitoring pass."""
        result = CheckResult(statuses=self.statuses())

        for status in result.statuses:
            if not status.is_stale:
                log.info("liveness ok", extra={"service_name": status.service_name})
                continue

            log.error("liveness breach: %s", status.describe())
            delivered = self.dispatcher.dispatch(status)
            if delivered:
                result.alerted.append(status.service_name)
                self.record_alert(status, status.describe(), delivered)

            tripped = self.dead_mans_switch.trip(status)
            if tripped:
                result.tripped_projects[status.service_name] = tripped

        return result

    def dashboard(self) -> str:
        """Human-readable last-seen table for logs and the ops dashboard."""
        lines = [
            f"{'SERVICE':<24}{'STATUS':<12}{'LAST SEEN':<34}{'SILENT':>10}{'THRESHOLD':>12}",
            "-" * 92,
        ]
        for status in self.statuses():
            lines.append(
                f"{status.service_name:<24}"
                f"{status.status:<12}"
                f"{(status.last_seen_at or 'never'):<34}"
                f"{(str(status.silent_for) + 's' if status.silent_for is not None else '-'):>10}"
                f"{str(status.threshold) + 's':>12}"
            )
        return "\n".join(lines)

    def run_forever(self, interval: int = CHECK_INTERVAL_SECONDS) -> None:
        log.info("Liveness monitor started (check interval %ds)", interval)
        while True:
            try:
                result = self.check()
                if result.stale_services:
                    log.error("Stale oracle services: %s", ", ".join(result.stale_services))
            except Exception as e:  # noqa: BLE001 — the monitor must never die
                log.error("Liveness check failed: %s", e)
            time.sleep(interval)


# ── CLI ───────────────────────────────────────────────────────────────────────


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Oracle liveness monitor")
    parser.add_argument("--once", action="store_true", help="Run a single check and exit")
    parser.add_argument("--dashboard", action="store_true", help="Print last-seen table and exit")
    parser.add_argument("--json", action="store_true", help="Emit the check result as JSON")
    parser.add_argument(
        "--interval",
        type=int,
        default=CHECK_INTERVAL_SECONDS,
        help="Seconds between checks in daemon mode",
    )
    args = parser.parse_args()

    monitor = LivenessMonitor()

    if args.dashboard:
        print(monitor.dashboard())
        return 0

    if args.once:
        result = monitor.check()
        print(json.dumps(result.to_dict(), indent=2) if args.json else monitor.dashboard())
        return 1 if result.stale_services else 0

    monitor.run_forever(args.interval)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
