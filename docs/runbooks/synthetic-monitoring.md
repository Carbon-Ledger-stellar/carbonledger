# Runbook: Synthetic Monitoring (Canary) Failure

**Severity:** P1 (if 2+ consecutive failures on production) / P3 (staging)  
**Team:** CarbonLedger Engineering  
**Last updated:** 2026-07-30  
**Related alerts:** `canary-credit-lookup-failure`, `canary-marketplace-listings-failure`, `canary-simulate-transaction-failure`

---

## Overview

CarbonLedger runs three lightweight synthetic canary checks every 5 minutes against both
production and staging deployments. Each canary is read-only or simulate-only — no real
on-chain transactions are ever broadcast. An alert fires when a check fails **2 or more
consecutive times** (i.e. a single transient failure is ignored).

### The three canary checks

| Check name | What it does | Endpoint |
|---|---|---|
| `credit-lookup` | GET `/projects?limit=1&status=Verified` — reads one verified project | Backend API |
| `marketplace-listings` | GET `/marketplace/listings?limit=5&status=Active` — reads active listings | Backend API |
| `simulate-transaction` | POST to Soroban RPC `getHealth` — verifies RPC node is healthy | Soroban RPC |

A failure on `credit-lookup` or `marketplace-listings` indicates a backend API problem.  
A failure on `simulate-transaction` indicates a Soroban RPC connectivity issue.

---

## Diagnosis Steps

### Step 1 — Confirm the alert is real

```bash
# View recent canary results
tail -50 /var/log/carbonledger/canary-results.jsonl | python3 -m json.tool

# Or query Grafana / Loki:
# {service="carbonledger-canary"} | json | success="false" | last 30m
```

Check `consecutiveFailures` in the output. If it is `1` the alert should not have fired
(check the alerting rules configuration).

### Step 2 — Check canary runner health

```bash
systemctl status carbonledger-canary
journalctl -u carbonledger-canary -n 100 --no-pager
```

If the canary runner itself is not running, restart it:
```bash
systemctl restart carbonledger-canary
```

### Step 3 — Manually reproduce the failing check

**credit-lookup failure:**
```bash
curl -v "https://api.carbonledger.app/api/v1/projects?limit=1&status=Verified"
# Expected: HTTP 200, JSON body with data array
```

**marketplace-listings failure:**
```bash
curl -v "https://api.carbonledger.app/api/v1/marketplace/listings?limit=5&status=Active"
# Expected: HTTP 200, JSON body with listings array
```

**simulate-transaction failure (Soroban RPC health):**
```bash
curl -s -X POST "https://soroban-testnet.stellar.org" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":{}}' | python3 -m json.tool
# Expected: {"result":{"status":"healthy"}}
```

### Step 4 — Backend API failures (credit-lookup, marketplace-listings)

Check backend service health:
```bash
# On the backend server
systemctl status carbonledger-backend

# Check recent error logs
journalctl -u carbonledger-backend -n 200 --no-pager | grep -i "error\|fatal\|exception"
```

Check database connectivity:
```bash
# Test the Prisma connection
cd /opt/carbonledger/backend
DATABASE_URL="${DATABASE_URL}" npx prisma db execute --stdin <<< "SELECT 1;"
```

Check Redis connectivity (required for marketplace cache):
```bash
redis-cli -h "${REDIS_HOST:-localhost}" -p "${REDIS_PORT:-6379}" ping
# Expected: PONG
```

**If a recent deployment caused the failure:**
```bash
# Check the last 5 deployments
git log --oneline -5
# Roll back if needed (requires explicit approval)
# See: docs/runbooks/contract-upgrade.md for rollback procedures
```

### Step 5 — Soroban RPC failures (simulate-transaction)

Check if the Stellar network itself has issues:
- [Stellar Network Status](https://status.stellar.org/)
- [Testnet Status](https://status.stellar.org/)

Check alternative RPC endpoints:
```bash
# Try the backup RPC endpoint
curl -s -X POST "${SOROBAN_RPC_BACKUP_URL:-https://soroban-testnet.stellar.org}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":{}}'
```

If the primary RPC is down, update the canary configuration:
```bash
# In /etc/carbonledger/canary.env
SOROBAN_RPC_URL=https://backup-rpc.stellar.org
systemctl restart carbonledger-canary
```

---

## Resolution Steps

### Backend API is returning errors

1. Check the backend logs for the specific error (HTTP 5xx, timeout, etc.)
2. If it's a database issue, follow the [database runbook](./database-backup.md)
3. If it's a deployment regression, coordinate a rollback with the on-call engineer
4. Notify the #engineering Slack channel

### Soroban RPC is unhealthy

1. Check Stellar network status page
2. If it's a network-wide issue, monitor and wait — this is not actionable
3. If it appears isolated to our RPC node, contact the Stellar Foundation or switch to a
   different RPC endpoint in the canary configuration

### Canary runner itself is failing

1. Check `journalctl -u carbonledger-canary` for errors
2. Verify environment variables in `/etc/carbonledger/canary.env`
3. Check disk space (results file at `/var/log/carbonledger/canary-results.jsonl` may grow)
4. Restart the service: `systemctl restart carbonledger-canary`

---

## Silencing / Maintenance Windows

If a planned maintenance window is scheduled, silence the canary alerts:

```bash
# In Grafana — navigate to:
# Alerting → Alert rules → [select canary alert] → Silence
# Set silence duration to maintenance window length
```

Or to stop the canary runner temporarily:
```bash
systemctl stop carbonledger-canary
# ... maintenance ...
systemctl start carbonledger-canary
```

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `ENVIRONMENT` | `staging` | `production` or `staging` |
| `PRODUCTION_API_URL` | `https://api.carbonledger.app/api/v1` | Production backend API base URL |
| `STAGING_API_URL` | `https://staging-api.carbonledger.app/api/v1` | Staging backend API base URL |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `ALERT_WEBHOOK_URL` | _(empty)_ | Slack/PagerDuty webhook for alerts |
| `CANARY_RESULTS_FILE` | `/tmp/canary-results.jsonl` | JSONL file for latency history |
| `CANARY_INTERVAL_MS` | `300000` (5 min) | Polling interval in milliseconds |
| `CHECK_TIMEOUT_MS` | `10000` (10 s) | Per-check HTTP timeout |

Configuration is loaded from `/etc/carbonledger/canary.env` in the systemd service.

---

## Grafana Dashboard

Navigate to: **CarbonLedger → Synthetic Monitoring (Canaries)**  
Dashboard UID: `canary-monitoring`

Key panels:
- **Canary Check Status** — pass/fail per check in last 5 min
- **Canary Latency** — p50/p95/p99 per check over time
- **Consecutive Failures Heatmap** — shows when alert territory was reached
- **Canary Availability (%)** — 24h availability per check
- **Canary Failure Log** — raw log of all failed checks with error messages

---

## Escalation

| Condition | Action |
|---|---|
| Production API down > 5 min | Page on-call engineer via PagerDuty |
| Production API down > 15 min | Escalate to CTO, notify status page |
| Soroban RPC down | Monitor Stellar status, do not page unless backend is also affected |
| Canary runner down > 30 min | P3 — fix next business day |

See [escalation runbook](./escalation.md) for contact details.

---

## Related Runbooks

- [Oracle Failure](./oracle-failure.md)
- [Database Backup](./database-backup.md)
- [Contract Exploit](./contract-exploit.md)
- [Escalation](./escalation.md)
