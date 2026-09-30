# Production Pause Monitoring and Alerting Guide

This guide details how to monitor smart contract pause status, subscribe to events, and configure alerts in production.

## 1. Metrics & Observability

### Prometheus Metrics
CarbonLedger backend exposes Prometheus metrics at `/metrics`:
- `stellar_contract_paused{contract="carbon_credit"}`: Gauge metric (`0` = active, `1` = paused).
- `stellar_contract_pause_until_timestamp`: Gauge showing Unix epoch of pause expiration.
- `stellar_contract_pause_total{action="pause|unpause"}`: Counter of pause state transitions.
- `stellar_tx_rejected_paused_total`: Counter of user transactions rejected due to active pause.

### Prometheus Alerting Rules
```yaml
groups:
  - name: carbonledger-pause-alerts
    rules:
      - alert: SmartContractPaused
        expr: stellar_contract_paused == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Soroban Carbon Credit Contract is PAUSED"
          description: "Smart contract operations have been suspended. Investigation required."

      - alert: PauseExpiringSoon
        expr: (stellar_contract_pause_until_timestamp - time()) < 3600 and stellar_contract_paused == 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Emergency Pause window expires in less than 1 hour"
          description: "Verify if operations should be resumed or if a window extension is needed."
```

## 2. Event Log Tracking
Soroban emits contract events on state changes:
- `Paused(admin, until_timestamp, reason)`
- `Unpaused(admin, timestamp)`

Backend indexers capture these events through the Stellar Horizon ingestion stream and log structured JSON events to ELK / CloudWatch:
```json
{
  "level": "warn",
  "event": "contract_paused",
  "admin": "GBXYZ...123",
  "contractId": "CCREDIT...XYZ",
  "until": 1727280000,
  "timestamp": "2026-09-24T20:30:00Z"
}
```

## 3. Health Checks
Check status via backend REST endpoint:
```bash
curl -s https://api.carbonledger.io/api/v1/contract/status
```
Response:
```json
{
  "isPaused": false,
  "pauseUntil": 0,
  "status": "operational"
}
```

## 4. Datadog & New Relic Dashboards (#1300)

Pre-built dashboards and alerting monitors are provided in `deploy/monitoring/`:

- `deploy/monitoring/datadog-pause-dashboard.json`:
  - **Metric:** `contract.is_paused` (gauge: 0 = operational, 1 = paused)
  - **Widgets:**
    - Real-time pause status display per contract (`carbon_credit`, `carbon_marketplace`)
    - Pause timeline chart (`contract.is_paused` over time)
    - Historical pause & unpause events bar chart (`contract.pause_events.count`)
    - Rejected transaction spikes due to active pause (`contract.tx.rejected_paused`)
    - Real-time audit log stream for pause events

- `deploy/monitoring/datadog-pause-monitors.json`:
  - Monitor for unexpected emergency pause status change (`contract.is_paused >= 1`)
  - Monitor for pause auto-expiration window approaching (< 1 hour remaining)

- `deploy/monitoring/newrelic-pause-dashboard.json`:
  - New Relic One dashboard with NRQL queries for real-time billboard status, 7-day pause timeline, and audit table.

