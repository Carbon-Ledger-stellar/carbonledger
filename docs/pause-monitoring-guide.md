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
