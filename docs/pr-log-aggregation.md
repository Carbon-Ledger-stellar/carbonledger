# feat: structured log aggregation with Loki, Promtail, and Grafana

## Summary

Replaces scattered per-container logs with a unified observability stack. All services emit structured JSON to stdout, Promtail ships them to Loki, and Grafana provides a single query interface with a pre-wired error-rate alert.

## Changes

| File | Change |
|---|---|
| `docker-compose.yml` | Add Loki, Promtail, Grafana services; `json-file` logging driver on all services; `LOG_LEVEL` env var |
| `logging/loki/loki.yml` | Loki config — 31-day retention, tsdb schema v13 |
| `logging/promtail/promtail.yml` | Docker socket scrape with JSON pipeline stage |
| `logging/grafana/provisioning/datasources/loki.yml` | Auto-provision Loki as default Grafana datasource |
| `logging/grafana/provisioning/alerting/error-rate.yml` | Alert rule: >10 errors/min across all services |
| `backend/src/main.ts` | `JsonLogger` — NestJS `ConsoleLogger` subclass emitting single-line JSON |
| `oracle/log.py` | Shared Python JSON formatter module |
| `oracle/verification_listener.py` | Patched to use `log.py` |
| `oracle/price_oracle.py` | Patched to use `log.py` |
| `oracle/satellite_monitor.py` | Patched to use `log.py` |

## Log format

Every service emits one JSON object per line:

```json
{"timestamp":"2026-04-25T16:00:00.000Z","level":"error","service":"backend","message":"..."}
```

Promtail extracts `level` and `service` as Loki labels, enabling per-service filtering without parsing in queries.

## Alert rule

Fires when error-level log lines across all services exceed **10 in any 1-minute window**. Evaluated every minute with a 1-minute pending period.

LogQL query:
```logql
sum(count_over_time({service=~".+"} | json | level="error" [1m])) > 10
```

## Retention

Loki is configured with `retention_period: 744h` (31 days), satisfying the ≥30-day requirement.

## Local development

```bash
docker-compose up -d
# Grafana: http://localhost:3200  (admin / $GRAFANA_PASSWORD, default: admin)
# Loki:    http://localhost:3100
```

`LOG_LEVEL` defaults to `info`. Set to `debug` in `.env` for verbose output.

## Acceptance criteria

- [x] Structured logs from all services shipped to a single sink (Loki)
- [x] Log retention policy defined (31 days)
- [x] Basic alerting on error rate spikes (>10 errors/min)
- [x] Log aggregation stack included in `docker-compose.yml` for local development
