# Oracle Sync Implementation

This document describes how the oracle submits data on-chain and how operators
monitor its health. It also defines the Prometheus alert that pages on-call when
the oracle heartbeat goes missing.

## Heartbeat metric

The oracle exposes a Prometheus metric that records the Unix timestamp (seconds)
of its most recent successful on-chain submission:

```
# HELP oracle_last_submission_timestamp_seconds Unix timestamp of the last successful oracle submission
# TYPE oracle_last_submission_timestamp_seconds gauge
oracle_last_submission_timestamp_seconds 1717171717
```

The metric is updated on every successful submission. If the oracle stops
submitting, the value stops advancing and the alert below fires.

## Alerting rule

Add the following rule to the Prometheus rule files (e.g.
`deploy/prometheus/rules/oracle.rules.yml`). The staleness threshold `N` is
configurable via the `ORACLE_HEARTBEAT_MAX_AGE` value; the default below is
15 minutes.

```yaml
groups:
  - name: oracle-heartbeat
    rules:
      - alert: OracleHeartbeatMissing
        expr: |
          time() - oracle_last_submission_timestamp_seconds > 15 * 60
        for: 5m
        labels:
          severity: critical
          team: oncall
          service: oracle
        annotations:
          summary: "Oracle has not submitted for over 15 minutes"
          description: >-
            The oracle heartbeat metric has not advanced for more than 15
            minutes (instance {{ $labels.instance }}). The oracle may be down or
            unable to submit transactions.
          runbook_url: "https://github.com/{{ .ExternalURL }}/blob/main/ORACLE_SYNC_IMPLEMENTATION.md#runbook-oracle-heartbeat-missing"
```

### Routing to on-call

The `severity: critical` and `team: oncall` labels are used by Alertmanager to
route this alert to the on-call rotation. Ensure the Alertmanager route matches
these labels, for example:

```yaml
route:
  routes:
    - matchers:
        - team = "oncall"
        - severity = "critical"
      receiver: oncall-pager
      continue: false
```

## Runbook: Oracle heartbeat missing

1. Confirm the alert is not a false positive by checking the metric directly:
   `oracle_last_submission_timestamp_seconds` should be advancing.
2. Check the oracle process/pod logs for submission errors (RPC failures,
   nonce issues, insufficient gas, or auth errors).
3. Verify connectivity to the RPC endpoint and that the oracle key has funds.
4. If the oracle is down, restart it and confirm the heartbeat metric resumes
   advancing.
5. If submissions fail due to configuration or credentials, escalate to the
   owning team and record the incident.
