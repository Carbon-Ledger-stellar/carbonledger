# Runbook: Oracle Liveness Alert

**Severity:** High
**Contacts:** See [contacts.md](contacts.md) → Oracle
**Escalation:** See [escalation.md](escalation.md)
**Related:** [oracle-failure.md](oracle-failure.md) (broader oracle outage), [synthetic-monitoring.md](synthetic-monitoring.md)

---

## What fires this alert

Each oracle service writes a heartbeat to `oracle_heartbeats` after **every
successful on-chain submission**. `oracle/liveness.py` compares each service's
silence against its own expected interval and alerts once the silence exceeds
`LIVENESS_STALE_MULTIPLIER` (default **2×**) that interval.

| Service                 | Expected interval (default) | Alert after |
|-------------------------|-----------------------------|-------------|
| `verification_listener` | 300 s (5 min poll)          | 10 min      |
| `price_oracle`          | 12 h (poll)                 | 24 h        |
| `satellite_monitor`     | 24 h (provider webhook)     | 48 h        |

Alert payload:

```json
{
  "text": "🔴 Oracle liveness alert — price_oracle: silent for 91234s (threshold 86400s, last seen ...)",
  "liveness": { "service": "price_oracle", "status": "stale", "silent_for_seconds": 91234, ... }
}
```

`status` is one of `ok`, `stale` (heartbeat exists but is too old) or
`never_seen` (no heartbeat has ever been recorded — usually a fresh deploy that
has not yet completed a submission, or a misconfigured `DATABASE_URL`).

---

## Triage (first 5 minutes)

1. **Get the current picture.** Every service's last-seen time:

   ```bash
   python3 oracle/liveness.py --dashboard
   # or, if the satellite monitor is up:
   curl -s localhost:5001/liveness | jq
   ```

   The HTTP endpoint returns **503** while any service is stale, so it can be
   wired directly into an uptime check.

2. **Is the process alive?**

   ```bash
   systemctl status verification_listener price_oracle satellite_monitor
   docker ps --filter name=oracle
   ```

3. **Distinguish "down" from "up but not submitting".** A running process with
   no heartbeat means submissions are failing, not that the host is dead —
   check the service log for RPC errors, and check the DLQ depth:

   ```bash
   docker logs carbonledger-price-oracle --tail 200
   python3 oracle/dlq_reprocessor.py --once
   ```

4. **Rule out a monitoring-side false positive.** If the service log shows
   recent successful submissions but no heartbeat landed, the problem is the
   heartbeat write, not the oracle:

   ```bash
   psql "$DATABASE_URL" -c "SELECT service_name, last_seen_at, beat_count FROM oracle_heartbeats;"
   ```

   A heartbeat failure is logged as `Heartbeat write failed for <service>` and
   never blocks the submission itself — treat it as a monitoring bug, and
   confirm on-chain freshness directly with `is_monitoring_current`.

---

## Containment

The dead-man's switch runs automatically. When `verification_listener` or
`satellite_monitor` goes stale, the monitor calls the permissionless
`carbon_oracle::check_liveness(project_id)` for every project that service has
submitted for. That contract function flags the project and suspends it in the
registry **only if** the project's monitoring data is past the on-chain
liveness SLA — a short outage does not suspend anything.

`price_oracle` is deliberately excluded: benchmark prices have their own
on-chain staleness window (`is_price_current`, default 24 h) which already
halts purchases when prices go stale.

If the switch did not run (e.g. `LIVENESS_DEADMAN_ENABLED=false`, or no
`LIVENESS_SUBMITTER_SECRET` configured), trip it manually for affected projects:

```bash
stellar contract invoke --id "$CARBON_ORACLE_CONTRACT_ID" -- check_liveness --project_id <project_id>
```

Then confirm the resulting state:

```bash
stellar contract invoke --id "$CARBON_ORACLE_CONTRACT_ID" -- is_monitoring_current --project_id <project_id>
```

`is_monitoring_current` and `check_liveness` read the same configurable SLA, so
they never disagree: if the switch suspended a project, this returns `false`.

**Do not** backfill fabricated monitoring data to silence the alert. A gap is
safer than bad data (see [oracle-failure.md](oracle-failure.md)).

---

## Recovery

1. Restore the service (see the per-service recovery steps in
   [oracle-failure.md](oracle-failure.md) — restart, credentials, RPC endpoint).
2. Wait for one successful submission. The heartbeat is written as part of that
   submission, so `--dashboard` flips the service back to `ok` on its own; there
   is nothing to reset by hand.
3. Drain anything that piled up while the service was down:

   ```bash
   python3 oracle/dlq_reprocessor.py --once --batch-size 50
   ```

4. For each project the switch suspended, once fresh monitoring data is on
   chain, unsuspend via the registry admin path (see
   [oracle-failure.md](oracle-failure.md) → Recovery).

---

## Verification

- `python3 oracle/liveness.py --once --json` exits **0** and reports no stale
  services.
- `curl -s localhost:5001/liveness` returns **200**.
- `oracle_heartbeats.beat_count` increases across two consecutive checks.
- No new rows in `oracle_liveness_alerts` for the affected service.

---

## Tuning

All configuration is environment-driven — no code change is needed to retune.

| Variable | Default | Meaning |
|---|---|---|
| `LIVENESS_STALE_MULTIPLIER` | `2` | Intervals of silence tolerated before alerting |
| `LIVENESS_ALERT_COOLDOWN` | `3600` | Min seconds between alerts for the same service |
| `LIVENESS_ALERT_WEBHOOK` | `ADMIN_ALERT_WEBHOOK` | Webhook receiving alerts |
| `LIVENESS_ALERT_EMAIL_TO` | *(empty)* | Comma-separated e-mail recipients (needs `SMTP_HOST`) |
| `LIVENESS_CHECK_INTERVAL` | `60` | Seconds between monitor passes in daemon mode |
| `LIVENESS_DEADMAN_ENABLED` | `true` | Set `false` to alert without touching the chain |
| `LIVENESS_SUBMITTER_SECRET` | `ORACLE_SECRET_KEY` | Funded account that pays for `check_liveness` |
| `VERIFICATION_LISTENER_INTERVAL` | `300` | Expected submission interval (s) |
| `PRICE_ORACLE_INTERVAL` | `43200` | Expected submission interval (s) |
| `SATELLITE_MONITOR_INTERVAL` | `86400` | Expected submission interval (s) |

Raising the multiplier trades detection speed for fewer false positives on a
flaky RPC endpoint. Prefer raising the *interval* for a service whose real
cadence changed, and the *multiplier* only to damp noise.

---

## Known false positives

- **Fresh deployment** — a service reports `never_seen` until its first
  successful submission. Expected for up to one full interval after a deploy.
- **`DATABASE_URL` unset in the service container** — heartbeats are dropped
  with a warning while submissions succeed normally. Check the service log for
  `heartbeat for <service> dropped`.
- **Clock skew between the oracle host and Postgres** — `silent_for` is computed
  by Postgres from `NOW()`, so a skewed *database* clock (not the oracle host)
  shifts every service at once. All three services going stale simultaneously
  while the chain shows recent submissions points here.
