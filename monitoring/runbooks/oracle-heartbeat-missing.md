# Runbook: Oracle Heartbeat Missing

Alert: `OracleHeartbeatMissing`

## What this alert means

The oracle has not submitted a price update within the configured staleness
window (`ORACLE_HEARTBEAT_STALE_MINUTES`, default 15 minutes). The
`oracle_last_submission_timestamp_seconds` metric has not advanced, so the
`time() - oracle_last_submission_timestamp_seconds` staleness expression has
exceeded the threshold.

## Impact

- On-chain prices may become stale and diverge from the market.
- Downstream consumers relying on fresh oracle data may reject or misprice.

## Immediate triage

1. Confirm the alert is real and not a scrape gap:
   - Check the Prometheus target for the oracle exporter is `UP`.
   - Query `oracle_last_submission_timestamp_seconds` and compare to `time()`.
2. Check oracle process health on the host/container (logs, restarts, OOM).
3. Verify RPC/provider connectivity and signer/key availability.
4. Check for upstream dependency outages (RPC endpoint, price feed source).

## Remediation

- If the oracle process is down: restart it and confirm submissions resume.
- If RPC/provider is degraded: fail over to the backup endpoint per the
  provider configuration.
- If the signer/key is unavailable: escalate to the key custodian.
- Once submissions resume, the alert should auto-resolve after the next
  successful submission.

## Escalation

This alert is routed to the on-call rotation (`severity="critical"`,
`team="oracle"`). If not resolved within 30 minutes, escalate to the platform
on-call lead.

## Related

- Alerting rule: `monitoring/prometheus/oracle-alerts.yml`
- Metric: `oracle_last_submission_timestamp_seconds`
