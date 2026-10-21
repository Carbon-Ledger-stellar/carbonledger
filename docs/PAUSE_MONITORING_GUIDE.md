# CarbonLedger Smart Contract Pause Monitoring Guide

> **Issue:** #1207 — Operational runbook for monitoring contract pause state across `carbon_credit` and `carbon_marketplace`  
> **Audience:** On-call engineers, SREs, DevOps  
> **Last updated:** 2026-09-26

---

## Table of Contents

1. [Overview](#1-overview)
2. [Monitoring Architecture](#2-monitoring-architecture)
3. [Checking Pause Status](#3-checking-pause-status)
   - 3.1 [Stellar CLI](#31-stellar-cli)
   - 3.2 [REST API](#32-rest-api)
   - 3.3 [Prometheus Query](#33-prometheus-query)
   - 3.4 [Grafana Dashboard](#34-grafana-dashboard)
4. [Viewing Pause History](#4-viewing-pause-history)
   - 4.1 [Horizon Event Stream](#41-horizon-event-stream)
   - 4.2 [Soroban RPC getEvents](#42-soroban-rpc-getevents)
   - 4.3 [Loki Log Queries](#43-loki-log-queries)
   - 4.4 [CloudWatch Insights Queries](#44-cloudwatch-insights-queries)
   - 4.5 [ELK / Elasticsearch Queries](#45-elk--elasticsearch-queries)
   - 4.6 [Database Query](#46-database-query)
5. [Metrics Reference](#5-metrics-reference)
6. [Alert Configuration](#6-alert-configuration)
   - 6.1 [Prometheus Alerting Rules](#61-prometheus-alerting-rules)
   - 6.2 [AlertManager Routing](#62-alertmanager-routing)
   - 6.3 [PagerDuty Integration](#63-pagerduty-integration)
   - 6.4 [OpsGenie Integration](#64-opsgenie-integration)
7. [Logging Configuration](#7-logging-configuration)
   - 7.1 [Log Levels and Fields](#71-log-levels-and-fields)
   - 7.2 [NestJS Logger Setup](#72-nestjs-logger-setup)
   - 7.3 [Promtail Configuration](#73-promtail-configuration)
   - 7.4 [Log Rotation](#74-log-rotation)
8. [Grafana Dashboard Reference](#8-grafana-dashboard-reference)
9. [Health Check Endpoints](#9-health-check-endpoints)
10. [Synthetic Monitoring](#10-synthetic-monitoring)
11. [Debugging Pause Issues](#11-debugging-pause-issues)
    - 11.1 [Pause Not Reflected in UI](#111-pause-not-reflected-in-ui)
    - 11.2 [Events Missing from Stream](#112-events-missing-from-stream)
    - 11.3 [Metrics Stale or Missing](#113-metrics-stale-or-missing)
    - 11.4 [False Alarm Alerts](#114-false-alarm-alerts)
    - 11.5 [Pause Stuck — Cannot Unpause](#115-pause-stuck--cannot-unpause)
12. [Escalation Procedures](#12-escalation-procedures)
13. [Related Documentation](#13-related-documentation)

---

## 1. Overview

CarbonLedger's `carbon_credit` and `carbon_marketplace` Soroban contracts support a **pause mechanism** that halts user-facing operations (minting, retiring, listing, purchasing) without destroying state. Pauses are used during:

- Emergency security responses (suspected exploit or double-counting attack)
- Scheduled maintenance windows
- Oracle data freshness failures
- Regulatory holds

When a contract is paused:
- All state-changing calls (`mint_credits`, `retire_credits`, `list_credits`, `purchase_credits`, `bulk_purchase`) return `ContractPaused` error
- Read-only calls (`get_credit_batch`, `get_active_listings`, `get_retirement_certificate`) continue to function
- The backend API returns `503 Service Unavailable` with a `paused: true` body on affected routes
- Transactions are rejected on-chain and logged with metric `stellar_tx_rejected_paused_total`

This guide covers every layer of pause observability: on-chain state, backend API, Prometheus metrics, Grafana dashboards, structured logs, and alert routing.

---

## 2. Monitoring Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     STELLAR NETWORK                             │
│  carbon_credit contract    carbon_marketplace contract          │
│  ┌─────────────────────┐   ┌──────────────────────────────┐    │
│  │ is_paused() → bool  │   │ is_paused() → bool           │    │
│  │ ContractPausedEvent │   │ ContractPausedEvent          │    │
│  │ ContractUnpausedEvt │   │ ContractUnpausedEvent        │    │
│  └──────────┬──────────┘   └──────────────┬───────────────┘    │
└─────────────┼──────────────────────────────┼───────────────────┘
              │ Soroban RPC / Horizon        │
              ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              NESTJS BACKEND  (port 3001)                        │
│                                                                 │
│  ContractStatusService                                          │
│  ├── polls is_paused() every 30s via Soroban RPC               │
│  ├── subscribes to ContractPausedEvent / ContractUnpausedEvent │
│  ├── updates Prometheus gauges                                  │
│  └── emits structured JSON logs to stdout                      │
│                                                                 │
│  GET /api/v1/contract/status  ──► JSON status payload          │
│  GET /metrics                  ──► Prometheus text exposition  │
└────────────┬────────────────────────────────────────────────────┘
             │
     ┌───────┼──────────────────────────────┐
     │       │                              │
     ▼       ▼                              ▼
┌─────────┐ ┌──────────────────┐ ┌──────────────────────────────┐
│Promtail │ │   Prometheus     │ │       Grafana (3200)         │
│(scrapes │ │  (scrapes /metr- │ │  Pause Status dashboard      │
│ stdout) │ │   ics every 15s) │ │  Pause History panel         │
└────┬────┘ └────────┬─────────┘ │  Alert annotations           │
     │               │           └──────────────────────────────┘
     ▼               ▼
  ┌──────┐    ┌─────────────┐
  │ Loki │    │AlertManager │
  └──────┘    └──────┬──────┘
                     │
              ┌──────┼──────┐
              ▼             ▼
         PagerDuty      OpsGenie
```

**Key components:**

| Component | Role | Location |
|-----------|------|----------|
| Soroban RPC | On-chain pause state source of truth | `soroban-testnet.stellar.org` |
| Horizon API | Historical event stream | `horizon-testnet.stellar.org` |
| NestJS Backend | Polling, metrics exposition, REST API | `localhost:3001` |
| Prometheus | Metrics scraping and alerting | `localhost:9090` (Docker: `prometheus:9090`) |
| AlertManager | Alert routing and deduplication | `localhost:9093` |
| Loki | Log aggregation | `localhost:3100` (Docker: `loki:3100`) |
| Promtail | Log shipping from stdout | sidecar / Docker logging driver |
| Grafana | Unified dashboards | `localhost:3200` |

---

## 3. Checking Pause Status

### 3.1 Stellar CLI

The authoritative source for pause state is the on-chain contract itself. Use the Stellar CLI to invoke `is_paused` directly:

```bash
# Check carbon_credit contract pause status
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source deployer \
  --network testnet \
  -- \
  is_paused

# Check carbon_marketplace contract pause status
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source deployer \
  --network testnet \
  -- \
  is_paused
```

**Expected output when running:**
```
false
```

**Expected output when paused:**
```
true
```

To query both contracts in one shot and display results side by side:

```bash
#!/usr/bin/env bash
# scripts/check-pause-status.sh

NETWORK="${STELLAR_NETWORK:-testnet}"
SOURCE="${STELLAR_SOURCE_ACCOUNT:-deployer}"

echo "=== CarbonLedger Contract Pause Status ==="
echo "Network: $NETWORK"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

for contract_var in CARBON_CREDIT_CONTRACT_ID CARBON_MARKETPLACE_CONTRACT_ID; do
  contract_id="${!contract_var}"
  contract_name="${contract_var/_CONTRACT_ID/}"

  if [[ -z "$contract_id" ]]; then
    echo "[$contract_name] ERROR: $contract_var is not set"
    continue
  fi

  result=$(stellar contract invoke \
    --id "$contract_id" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    -- \
    is_paused 2>&1)

  if [[ "$result" == "true" ]]; then
    echo "[$contract_name] STATUS: ⛔ PAUSED (contract_id=$contract_id)"
  elif [[ "$result" == "false" ]]; then
    echo "[$contract_name] STATUS: ✅ RUNNING (contract_id=$contract_id)"
  else
    echo "[$contract_name] STATUS: ❓ UNKNOWN — $result"
  fi
done
```

Run with:

```bash
chmod +x scripts/check-pause-status.sh
./scripts/check-pause-status.sh
```

### 3.2 REST API

The NestJS backend exposes a contract status endpoint that aggregates pause state for all contracts:

```
GET /api/v1/contract/status
```

**Request:**
```bash
curl -s http://localhost:3001/api/v1/contract/status | jq .
```

**Response (all running):**
```json
{
  "timestamp": "2026-09-26T22:03:36.367Z",
  "network": "testnet",
  "contracts": {
    "carbon_credit": {
      "contract_id": "CABC...XYZ",
      "paused": false,
      "pause_until": null,
      "last_checked": "2026-09-26T22:03:20.000Z",
      "last_pause_event": null,
      "total_pauses": 0
    },
    "carbon_marketplace": {
      "contract_id": "CDEF...UVW",
      "paused": false,
      "pause_until": null,
      "last_checked": "2026-09-26T22:03:20.000Z",
      "last_pause_event": null,
      "total_pauses": 0
    }
  },
  "overall_status": "operational"
}
```

**Response (carbon_credit paused):**
```json
{
  "timestamp": "2026-09-26T22:15:00.000Z",
  "network": "testnet",
  "contracts": {
    "carbon_credit": {
      "contract_id": "CABC...XYZ",
      "paused": true,
      "pause_until": "2026-09-26T23:00:00.000Z",
      "last_checked": "2026-09-26T22:14:50.000Z",
      "last_pause_event": {
        "type": "ContractPausedEvent",
        "ledger": 54321,
        "timestamp": "2026-09-26T22:10:00.000Z",
        "reason": "emergency_security_hold",
        "initiated_by": "GADMIN...XYZ"
      },
      "total_pauses": 3
    },
    "carbon_marketplace": {
      "contract_id": "CDEF...UVW",
      "paused": false,
      "pause_until": null,
      "last_checked": "2026-09-26T22:14:50.000Z",
      "last_pause_event": null,
      "total_pauses": 1
    }
  },
  "overall_status": "degraded"
}
```

**`overall_status` values:**

| Value | Meaning |
|-------|---------|
| `operational` | All contracts running normally |
| `degraded` | One or more contracts paused |
| `maintenance` | All contracts paused (scheduled maintenance) |
| `unknown` | Backend cannot reach Soroban RPC |

**Filter by contract:**
```bash
# Only carbon_credit status
curl -s "http://localhost:3001/api/v1/contract/status?contract=carbon_credit" | jq .

# Only carbon_marketplace status
curl -s "http://localhost:3001/api/v1/contract/status?contract=carbon_marketplace" | jq .
```

**HTTP response codes:**

| Code | Meaning |
|------|---------|
| `200 OK` | Status retrieved successfully (even if contracts are paused) |
| `503 Service Unavailable` | Backend cannot reach Soroban RPC |
| `500 Internal Server Error` | Unexpected backend error |

### 3.3 Prometheus Query

Query the current pause state directly from Prometheus:

```promql
# Is carbon_credit currently paused? (1 = paused, 0 = running)
stellar_contract_paused{contract="carbon_credit"}

# Is carbon_marketplace currently paused?
stellar_contract_paused{contract="carbon_marketplace"}

# Either contract paused?
max(stellar_contract_paused) > 0

# When does the current pause expire? (Unix timestamp, 0 if not paused)
stellar_contract_pause_until_timestamp{contract="carbon_credit"}

# How many minutes until pause expires?
(stellar_contract_pause_until_timestamp{contract="carbon_credit"} - time()) / 60

# Total pause events ever recorded
stellar_contract_pause_total

# Total transactions rejected because contract was paused (rate per 5 min)
rate(stellar_tx_rejected_paused_total[5m])
```

Run these via the Prometheus UI at `http://localhost:9090/graph` or via the API:

```bash
# Query Prometheus API directly
curl -sG 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=stellar_contract_paused' | jq '.data.result'
```

### 3.4 Grafana Dashboard

Navigate to Grafana at `http://localhost:3200` (Docker) and open the **CarbonLedger Pause Monitor** dashboard.

**Quick access:**
- Dashboard UID: `carbonledger-pause-monitor`
- Direct URL: `http://localhost:3200/d/carbonledger-pause-monitor`

The top row of the dashboard shows two stat panels:
- **Credit Contract Status** — green `RUNNING` or red `PAUSED`
- **Marketplace Contract Status** — green `RUNNING` or red `PAUSED`

If either is paused, a red annotation band appears on all time series panels showing when the pause started and (if scheduled) when it ends.

---

## 4. Viewing Pause History

### 4.1 Horizon Event Stream

Horizon indexes Stellar ledger transactions and contract events. Use it to query historical `ContractPausedEvent` and `ContractUnpausedEvent` occurrences.

**List all contract events for carbon_credit:**

```bash
CARBON_CREDIT_CONTRACT_ID="CABC...XYZ"
HORIZON_URL="https://horizon-testnet.stellar.org"

curl -sG "$HORIZON_URL/accounts/$CARBON_CREDIT_CONTRACT_ID/effects" \
  --data-urlencode "order=desc" \
  --data-urlencode "limit=50" | jq '.._embedded.records[] | select(.type == "contract_event")'
```

**Stream events in real time:**

```bash
curl -sN "$HORIZON_URL/accounts/$CARBON_CREDIT_CONTRACT_ID/effects?cursor=now&order=asc" \
  | while IFS= read -r line; do
      echo "$line" | jq -r 'select(.type != null) | "\(.created_at) \(.type)"'
    done
```

**Filter to pause/unpause events only:**

```bash
curl -sG "$HORIZON_URL/accounts/$CARBON_CREDIT_CONTRACT_ID/effects" \
  --data-urlencode "order=desc" \
  --data-urlencode "limit=200" \
  | jq '._embedded.records[] | select(.type | test("pause"; "i"))'
```

**Query a specific ledger range:**

```bash
# Events between ledger 50000 and 55000
curl -sG "$HORIZON_URL/accounts/$CARBON_CREDIT_CONTRACT_ID/effects" \
  --data-urlencode "cursor=50000" \
  --data-urlencode "order=asc" \
  --data-urlencode "limit=200" \
  | jq '._embedded.records[] | select(.paging_token | tonumber <= 55000)'
```

### 4.2 Soroban RPC getEvents

The Soroban RPC endpoint provides richer contract event data including topics and data values:

```bash
SOROBAN_RPC="https://soroban-testnet.stellar.org"
CARBON_CREDIT_CONTRACT_ID="CABC...XYZ"

# Get all events for carbon_credit in last 1000 ledgers
curl -s -X POST "$SOROBAN_RPC" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": "54000",
      "filters": [
        {
          "type": "contract",
          "contractIds": ["'"$CARBON_CREDIT_CONTRACT_ID"'"],
          "topics": [
            ["*", "*"]
          ]
        }
      ],
      "pagination": {
        "limit": 100
      }
    }
  }' | jq '.result.events[]'
```

**Filter to ContractPausedEvent only:**

```bash
curl -s -X POST "$SOROBAN_RPC" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": "1",
      "filters": [
        {
          "type": "contract",
          "contractIds": ["'"$CARBON_CREDIT_CONTRACT_ID"'"],
          "topics": [
            ["ContractPausedEvent"]
          ]
        }
      ],
      "pagination": {
        "limit": 50
      }
    }
  }' | jq '.result.events[] | {
    ledger: .ledger,
    timestamp: .ledgerClosedAt,
    topic: .topic,
    value: .value
  }'
```

**Combined script for both contracts:**

```bash
#!/usr/bin/env bash
# scripts/query-pause-history.sh

SOROBAN_RPC="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
START_LEDGER="${1:-1}"
LIMIT="${2:-100}"

for contract_var in CARBON_CREDIT_CONTRACT_ID CARBON_MARKETPLACE_CONTRACT_ID; do
  contract_id="${!contract_var}"
  echo "=== Pause history for ${contract_var/_CONTRACT_ID/} ==="

  curl -s -X POST "$SOROBAN_RPC" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": 1,
      \"method\": \"getEvents\",
      \"params\": {
        \"startLedger\": \"$START_LEDGER\",
        \"filters\": [{
          \"type\": \"contract\",
          \"contractIds\": [\"$contract_id\"],
          \"topics\": [[\"ContractPausedEvent\"], [\"ContractUnpausedEvent\"]]
        }],
        \"pagination\": { \"limit\": $LIMIT }
      }
    }" | jq '.result.events[] | {
      ledger: .ledger,
      timestamp: .ledgerClosedAt,
      event: (.topic[0] // "unknown"),
      data: .value
    }'

  echo ""
done
```

### 4.3 Loki Log Queries

Open Grafana Explore (`http://localhost:3200/explore`) and use LogQL:

**All pause-related log lines:**
```logql
{app="carbonledger-backend"} |= "ContractPaused"
```

**All pause events with structured parsing:**
```logql
{app="carbonledger-backend"}
  | json
  | event_type =~ "ContractPausedEvent|ContractUnpausedEvent"
  | line_format "{{.timestamp}} [{{.contract}}] {{.event_type}} — reason={{.reason}} by={{.initiated_by}}"
```

**Pause events in the last 24 hours:**
```logql
{app="carbonledger-backend", level="warn"}
  | json
  | event_type = "ContractPausedEvent"
  | __error__ = ""
```

**Count pause events by contract (last 7 days):**
```logql
sum by (contract) (
  count_over_time(
    {app="carbonledger-backend"}
      | json
      | event_type = "ContractPausedEvent"
    [7d]
  )
)
```

**Transactions rejected while paused (rate per minute):**
```logql
sum(rate(
  {app="carbonledger-backend"}
    | json
    | event_type = "tx_rejected_paused"
  [1m]
))
```

**Unpause events with duration:**
```logql
{app="carbonledger-backend"}
  | json
  | event_type = "ContractUnpausedEvent"
  | line_format "{{.timestamp}} contract={{.contract}} pause_duration_seconds={{.pause_duration_seconds}} reason={{.unpause_reason}}"
```

### 4.4 CloudWatch Insights Queries

If logs are shipped to AWS CloudWatch (log group: `/carbonledger/backend`):

**All pause events in last 24 hours:**
```sql
fields @timestamp, contract, event_type, reason, initiated_by, ledger
| filter event_type in ["ContractPausedEvent", "ContractUnpausedEvent"]
| sort @timestamp desc
| limit 100
```

**Pause events with duration:**
```sql
fields @timestamp, contract, pause_duration_seconds, unpause_reason
| filter event_type = "ContractUnpausedEvent"
| stats
    count() as total_unpauses,
    avg(pause_duration_seconds) as avg_duration_s,
    max(pause_duration_seconds) as max_duration_s
  by contract
```

**Transactions rejected while paused (last 1 hour):**
```sql
fields @timestamp, contract, tx_hash, caller, operation
| filter event_type = "tx_rejected_paused"
| stats count() as rejected_count by contract, bin(5m)
| sort @timestamp desc
```

**Error rate during paused windows:**
```sql
fields @timestamp, level, message, contract
| filter level = "error" and event_type = "tx_rejected_paused"
| stats count() as errors by bin(1m)
| sort @timestamp asc
```

### 4.5 ELK / Elasticsearch Queries

**Kibana Discover / Elasticsearch DSL — all pause events:**

```json
GET carbonledger-backend-*/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "terms": {
            "event_type.keyword": [
              "ContractPausedEvent",
              "ContractUnpausedEvent"
            ]
          }
        }
      ],
      "filter": [
        {
          "range": {
            "@timestamp": {
              "gte": "now-7d",
              "lte": "now"
            }
          }
        }
      ]
    }
  },
  "sort": [{ "@timestamp": "desc" }],
  "size": 100,
  "_source": [
    "@timestamp", "contract", "event_type", "reason",
    "initiated_by", "ledger", "pause_duration_seconds"
  ]
}
```

**Aggregation — pause count per contract per day:**

```json
GET carbonledger-backend-*/_search
{
  "size": 0,
  "query": {
    "term": { "event_type.keyword": "ContractPausedEvent" }
  },
  "aggs": {
    "by_contract": {
      "terms": { "field": "contract.keyword" },
      "aggs": {
        "by_day": {
          "date_histogram": {
            "field": "@timestamp",
            "calendar_interval": "day"
          }
        }
      }
    }
  }
}
```

**Kibana Lens — rejected transactions heatmap:**

```json
GET carbonledger-backend-*/_search
{
  "size": 0,
  "query": {
    "term": { "event_type.keyword": "tx_rejected_paused" }
  },
  "aggs": {
    "over_time": {
      "date_histogram": {
        "field": "@timestamp",
        "fixed_interval": "5m"
      },
      "aggs": {
        "by_contract": {
          "terms": { "field": "contract.keyword" }
        }
      }
    }
  }
}
```

### 4.6 Database Query

The NestJS backend persists pause events to PostgreSQL via Prisma. Query the `contract_pause_events` table directly:

```sql
-- All pause/unpause events, newest first
SELECT
  id,
  contract_name,
  event_type,
  ledger_sequence,
  event_timestamp,
  initiated_by,
  reason,
  pause_duration_seconds,
  tx_hash
FROM contract_pause_events
ORDER BY event_timestamp DESC
LIMIT 50;

-- Summary by contract
SELECT
  contract_name,
  COUNT(*) FILTER (WHERE event_type = 'ContractPausedEvent')   AS total_pauses,
  COUNT(*) FILTER (WHERE event_type = 'ContractUnpausedEvent') AS total_unpauses,
  AVG(pause_duration_seconds)                                   AS avg_pause_duration_s,
  MAX(pause_duration_seconds)                                   AS max_pause_duration_s,
  MAX(event_timestamp) FILTER (WHERE event_type = 'ContractPausedEvent') AS last_paused_at
FROM contract_pause_events
GROUP BY contract_name;

-- Pause events in the last 30 days
SELECT *
FROM contract_pause_events
WHERE event_timestamp >= NOW() - INTERVAL '30 days'
  AND event_type = 'ContractPausedEvent'
ORDER BY event_timestamp DESC;

-- Find pauses that lasted longer than 1 hour
SELECT
  p.contract_name,
  p.event_timestamp AS paused_at,
  u.event_timestamp AS unpaused_at,
  u.pause_duration_seconds,
  p.reason
FROM contract_pause_events p
JOIN contract_pause_events u
  ON u.contract_name = p.contract_name
  AND u.event_type = 'ContractUnpausedEvent'
  AND u.event_timestamp > p.event_timestamp
WHERE p.event_type = 'ContractPausedEvent'
  AND u.pause_duration_seconds > 3600
ORDER BY u.pause_duration_seconds DESC;
```

---

## 5. Metrics Reference

The backend exposes the following pause-related metrics at `GET /metrics` (Prometheus text format).

### `stellar_contract_paused`

| Field | Value |
|-------|-------|
| Type | Gauge |
| Unit | Boolean (0 or 1) |
| Labels | `contract` (`carbon_credit` \| `carbon_marketplace`), `network` |
| Description | Current pause state of the contract. `1` = paused, `0` = running. |
| Normal value | `0` |
| Alert threshold | `== 1` for more than 60 seconds |
| Update frequency | Every 30 seconds (polling interval) |

```promql
# Example scrape output
stellar_contract_paused{contract="carbon_credit",network="testnet"} 0
stellar_contract_paused{contract="carbon_marketplace",network="testnet"} 0
```

---

### `stellar_contract_pause_until_timestamp`

| Field | Value |
|-------|-------|
| Type | Gauge |
| Unit | Unix epoch seconds |
| Labels | `contract`, `network` |
| Description | Scheduled unpause time as Unix timestamp. `0` if no scheduled expiry. |
| Normal value | `0` |
| Alert threshold | When `> time()` and `< time() + 3600` (pause expiring within 1 hour) |
| Update frequency | Every 30 seconds |

```promql
# Example: pause expires in ~45 minutes
stellar_contract_pause_until_timestamp{contract="carbon_credit",network="testnet"} 1727391600
```

---

### `stellar_contract_pause_total`

| Field | Value |
|-------|-------|
| Type | Counter |
| Unit | Count |
| Labels | `contract`, `network`, `reason` |
| Description | Total number of pause events since backend startup. |
| Normal value | Low, growing slowly over months |
| Alert threshold | Rate `> 3` in `10m` (repeated pausing, possible attack or instability) |
| Update frequency | Incremented on each `ContractPausedEvent` |

```promql
# Example scrape output
stellar_contract_pause_total{contract="carbon_credit",network="testnet",reason="emergency_security_hold"} 2
stellar_contract_pause_total{contract="carbon_credit",network="testnet",reason="scheduled_maintenance"} 1
stellar_contract_pause_total{contract="carbon_marketplace",network="testnet",reason="scheduled_maintenance"} 1
```

---

### `stellar_tx_rejected_paused_total`

| Field | Value |
|-------|-------|
| Type | Counter |
| Unit | Count |
| Labels | `contract`, `network`, `operation` |
| Description | Total transactions rejected because the contract was paused. |
| Normal value | `0` (should be zero when running) |
| Alert threshold | Rate `> 0` sustained for `> 1m` (users hitting paused contract) |
| Update frequency | Incremented on each rejected transaction observed via Soroban RPC |

```promql
# Example scrape output (during a pause incident)
stellar_tx_rejected_paused_total{contract="carbon_credit",network="testnet",operation="mint_credits"} 14
stellar_tx_rejected_paused_total{contract="carbon_credit",network="testnet",operation="retire_credits"} 7
stellar_tx_rejected_paused_total{contract="carbon_marketplace",network="testnet",operation="purchase_credits"} 0
```

---

### Summary Table

| Metric | Type | Normal | Warning | Critical |
|--------|------|--------|---------|----------|
| `stellar_contract_paused` | Gauge | `0` | — | `1` for > 60s |
| `stellar_contract_pause_until_timestamp` | Gauge | `0` | `< now + 3600` | — |
| `stellar_contract_pause_total` rate | Counter | `< 1/hour` | `> 2/10m` | `> 3/5m` |
| `stellar_tx_rejected_paused_total` rate | Counter | `0` | `> 0` | `> 10/min` |

---

## 6. Alert Configuration

### 6.1 Prometheus Alerting Rules

Save this file to `infra/prometheus/rules/carbonledger-pause-alerts.yml`:

```yaml
# infra/prometheus/rules/carbonledger-pause-alerts.yml
# CarbonLedger Smart Contract Pause Alerting Rules
# Issue: #1207

groups:
  - name: carbonledger.pause
    interval: 30s
    rules:

      # ─────────────────────────────────────────────────────────────────
      # CRITICAL: Contract is currently paused
      # ─────────────────────────────────────────────────────────────────
      - alert: SmartContractPaused
        expr: stellar_contract_paused == 1
        for: 1m
        labels:
          severity: critical
          team: platform
          service: carbonledger
          runbook: "https://github.com/YOUR_USERNAME/carbonledger/blob/main/docs/PAUSE_MONITORING_GUIDE.md"
        annotations:
          summary: "CarbonLedger contract {{ $labels.contract }} is PAUSED"
          description: |
            The {{ $labels.contract }} Soroban contract on {{ $labels.network }} has been
            paused for more than 1 minute. All state-changing operations are blocked.
            Users attempting to mint, retire, list, or purchase credits will receive errors.

            Contract: {{ $labels.contract }}
            Network:  {{ $labels.network }}
            Paused since: check /api/v1/contract/status for details.

            Immediate actions:
            1. Run: curl http://localhost:3001/api/v1/contract/status | jq .
            2. Check Grafana: http://localhost:3200/d/carbonledger-pause-monitor
            3. If not intentional, follow the emergency unpause procedure in the runbook.
          dashboard: "http://localhost:3200/d/carbonledger-pause-monitor"

      # ─────────────────────────────────────────────────────────────────
      # CRITICAL: Both contracts are paused simultaneously
      # ─────────────────────────────────────────────────────────────────
      - alert: AllContractsPaused
        expr: sum(stellar_contract_paused) == 2
        for: 1m
        labels:
          severity: critical
          team: platform
          service: carbonledger
          runbook: "https://github.com/YOUR_USERNAME/carbonledger/blob/main/docs/PAUSE_MONITORING_GUIDE.md#12-escalation-procedures"
        annotations:
          summary: "ALL CarbonLedger contracts are PAUSED — complete service outage"
          description: |
            Both carbon_credit and carbon_marketplace contracts are paused.
            The entire CarbonLedger marketplace is non-functional.

            This may indicate:
            - A scheduled maintenance window (check the maintenance calendar)
            - An emergency security response
            - An unintended administrator action

            Escalate immediately if not a scheduled event.

      # ─────────────────────────────────────────────────────────────────
      # WARNING: Pause is scheduled to expire soon
      # ─────────────────────────────────────────────────────────────────
      - alert: PauseExpiringSoon
        expr: >
          (stellar_contract_pause_until_timestamp > 0)
          and
          (stellar_contract_pause_until_timestamp - time() < 3600)
          and
          (stellar_contract_pause_until_timestamp - time() > 0)
        for: 5m
        labels:
          severity: warning
          team: platform
          service: carbonledger
        annotations:
          summary: "CarbonLedger contract {{ $labels.contract }} pause expires in < 1 hour"
          description: |
            The scheduled pause for {{ $labels.contract }} on {{ $labels.network }} will
            expire within 60 minutes.

            Expiry time: {{ $value | humanizeTimestamp }}
            Minutes remaining: {{ printf "%.0f" (($labels.stellar_contract_pause_until_timestamp | float64) - (time | float64) | div 60) }}

            Ensure post-maintenance validation is complete before the pause expires.
            If more time is needed, extend the pause via admin tooling before expiry.

      # ─────────────────────────────────────────────────────────────────
      # WARNING: Repeated pause attempts detected (possible instability)
      # ─────────────────────────────────────────────────────────────────
      - alert: RepeatedPauseAttempts
        expr: increase(stellar_contract_pause_total[10m]) > 2
        for: 5m
        labels:
          severity: warning
          team: platform
          service: carbonledger
        annotations:
          summary: "Contract {{ $labels.contract }} paused {{ $value }} times in last 10 minutes"
          description: |
            The {{ $labels.contract }} contract on {{ $labels.network }} has been paused
            {{ $value }} times in the last 10 minutes.

            This pattern may indicate:
            - Automated tooling stuck in a pause/unpause loop
            - An attacker attempting to disrupt service
            - A misconfigured oracle triggering repeated pauses
            - A bug in the admin tooling

            Check the pause history:
              curl -sG https://soroban-testnet.stellar.org ... (see runbook §4.2)
              or query Loki: {app="carbonledger-backend"} | json | event_type = "ContractPausedEvent"

      # ─────────────────────────────────────────────────────────────────
      # WARNING: Users actively hitting paused contract
      # ─────────────────────────────────────────────────────────────────
      - alert: TransactionsRejectedDueToPause
        expr: rate(stellar_tx_rejected_paused_total[5m]) > 0
        for: 2m
        labels:
          severity: warning
          team: platform
          service: carbonledger
        annotations:
          summary: "{{ $labels.contract }} rejecting transactions — contract is paused"
          description: |
            Users are actively submitting transactions to the paused {{ $labels.contract }}
            contract at a rate of {{ printf "%.2f" $value }} tx/s.

            This creates a poor user experience. Verify:
            1. The frontend is correctly showing the paused state banner.
            2. The /api/v1/contract/status endpoint is returning paused=true.
            3. Client-side polling is working correctly.

            Operation breakdown available in Prometheus:
              stellar_tx_rejected_paused_total{contract="{{ $labels.contract }}"}

      # ─────────────────────────────────────────────────────────────────
      # WARNING: Metrics scrape is stale (backend may be down)
      # ─────────────────────────────────────────────────────────────────
      - alert: ContractMetricsScrapeStale
        expr: >
          (time() - timestamp(stellar_contract_paused)) > 120
        for: 3m
        labels:
          severity: warning
          team: platform
          service: carbonledger
        annotations:
          summary: "Contract pause metrics have not been updated for > 2 minutes"
          description: |
            The stellar_contract_paused metric has not been refreshed in over 120 seconds.
            The NestJS backend may be down or the /metrics endpoint is unreachable.

            Check backend health:
              curl http://localhost:3001/health
              docker-compose ps backend

            The current pause state is UNKNOWN until metrics are refreshed.
```

Load the rules into Prometheus by referencing this file in `prometheus.yml`:

```yaml
# infra/prometheus/prometheus.yml (partial)
rule_files:
  - "rules/carbonledger-pause-alerts.yml"

scrape_configs:
  - job_name: "carbonledger-backend"
    static_configs:
      - targets: ["backend:3001"]
    metrics_path: "/metrics"
    scrape_interval: 15s
    scrape_timeout: 10s
```

### 6.2 AlertManager Routing

```yaml
# infra/alertmanager/alertmanager.yml
global:
  resolve_timeout: 5m
  pagerduty_url: "https://events.pagerduty.com/v2/enqueue"

templates:
  - "/etc/alertmanager/templates/*.tmpl"

route:
  group_by: ["alertname", "contract", "network"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: "default-slack"

  routes:
    # Critical pause alerts → PagerDuty (immediate page)
    - match:
        severity: critical
        service: carbonledger
      receiver: "pagerduty-critical"
      group_wait: 0s
      repeat_interval: 1h
      continue: true

    # All pause alerts → Slack #carbonledger-alerts
    - match:
        service: carbonledger
      receiver: "slack-carbonledger"
      repeat_interval: 2h

    # Warning-only alerts → Slack only, no page
    - match:
        severity: warning
        service: carbonledger
      receiver: "slack-carbonledger"
      repeat_interval: 4h

receivers:
  - name: "default-slack"
    slack_configs:
      - api_url: "${SLACK_WEBHOOK_URL}"
        channel: "#ops-alerts"
        title: "[{{ .Status | toUpper }}] {{ .GroupLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.description }}{{ end }}"

  - name: "slack-carbonledger"
    slack_configs:
      - api_url: "${SLACK_WEBHOOK_URL}"
        channel: "#carbonledger-alerts"
        send_resolved: true
        title: |
          [{{ .Status | toUpper }}] {{ .GroupLabels.alertname }}
          Contract: {{ .GroupLabels.contract }} | Network: {{ .GroupLabels.network }}
        text: |
          {{ range .Alerts }}
          *Summary:* {{ .Annotations.summary }}
          *Description:* {{ .Annotations.description }}
          *Runbook:* {{ .Labels.runbook }}
          *Dashboard:* {{ .Annotations.dashboard }}
          {{ end }}
        color: |
          {{ if eq .Status "firing" }}
            {{ if eq .GroupLabels.severity "critical" }}danger{{ else }}warning{{ end }}
          {{ else }}good{{ end }}
        actions:
          - type: button
            text: "Open Dashboard"
            url: "http://localhost:3200/d/carbonledger-pause-monitor"
          - type: button
            text: "View Runbook"
            url: "https://github.com/YOUR_USERNAME/carbonledger/blob/main/docs/PAUSE_MONITORING_GUIDE.md"

  - name: "pagerduty-critical"
    pagerduty_configs:
      - service_key: "${PAGERDUTY_SERVICE_KEY_CARBONLEDGER}"
        description: "{{ .GroupLabels.alertname }}: {{ range .Alerts }}{{ .Annotations.summary }}{{ end }}"
        severity: "critical"
        details:
          contract: "{{ .GroupLabels.contract }}"
          network: "{{ .GroupLabels.network }}"
          runbook: "https://github.com/YOUR_USERNAME/carbonledger/blob/main/docs/PAUSE_MONITORING_GUIDE.md"
          dashboard: "http://localhost:3200/d/carbonledger-pause-monitor"

inhibit_rules:
  # If AllContractsPaused fires, suppress individual SmartContractPaused alerts
  - source_match:
      alertname: "AllContractsPaused"
    target_match:
      alertname: "SmartContractPaused"
    equal: ["network"]
```

### 6.3 PagerDuty Integration

**Service configuration:**

1. In PagerDuty, create a new **Service** named `CarbonLedger Smart Contracts`.
2. Set escalation policy to your on-call rotation.
3. Under **Integrations**, add **Prometheus** integration and copy the **Integration Key**.
4. Set the integration key as environment variable:
   ```bash
   export PAGERDUTY_SERVICE_KEY_CARBONLEDGER="your-integration-key-here"
   ```

**Event routing in PagerDuty:**

```json
{
  "routing_rules": [
    {
      "condition": "event.summary matches 'CarbonLedger' AND event.severity == 'critical'",
      "actions": {
        "route_to": "CarbonLedger Smart Contracts",
        "priority": "P1",
        "suppress": false
      }
    },
    {
      "condition": "event.summary matches 'AllContractsPaused'",
      "actions": {
        "route_to": "CarbonLedger Smart Contracts",
        "priority": "P1",
        "notify_on_call": true,
        "add_responders": ["platform-lead", "security-on-call"]
      }
    }
  ]
}
```

**PagerDuty webhook (receive resolve notifications):**

Configure PagerDuty to send resolved events back to Slack or your incident management tool via **Webhooks V3**:

```
Endpoint: https://your-webhook-handler.example.com/pagerduty/resolved
Events: incident.acknowledged, incident.resolved
```

### 6.4 OpsGenie Integration

**AlertManager OpsGenie receiver:**

```yaml
# Add to alertmanager.yml receivers
  - name: "opsgenie-carbonledger"
    opsgenie_configs:
      - api_key: "${OPSGENIE_API_KEY}"
        api_url: "https://api.opsgenie.com/"
        message: "{{ .GroupLabels.alertname }}: {{ range .Alerts }}{{ .Annotations.summary }}{{ end }}"
        description: |
          {{ range .Alerts }}
          {{ .Annotations.description }}
          Runbook: {{ .Labels.runbook }}
          {{ end }}
        priority: |
          {{ if eq .GroupLabels.severity "critical" }}P1{{ else }}P3{{ end }}
        tags: "carbonledger,smart-contract,pause,{{ .GroupLabels.contract }}"
        details:
          contract: "{{ .GroupLabels.contract }}"
          network: "{{ .GroupLabels.network }}"
          runbook_url: "https://github.com/YOUR_USERNAME/carbonledger/blob/main/docs/PAUSE_MONITORING_GUIDE.md"
        responders:
          - name: "CarbonLedger On-Call"
            type: "team"
        visible_to:
          - name: "CarbonLedger On-Call"
            type: "team"
        actions:
          - "Acknowledge"
          - "Check Dashboard"
```

**OpsGenie integration steps:**

1. In OpsGenie, go to **Settings → Integrations → Add Integration**.
2. Select **Prometheus** and note the API key.
3. Configure the team routing rule to point `carbonledger` tagged alerts to the platform team.
4. Set the environment variable: `export OPSGENIE_API_KEY="your-api-key-here"`

---

## 7. Logging Configuration

### 7.1 Log Levels and Fields

The NestJS backend emits structured JSON logs for all pause-related events. Log levels follow this convention:

| Event | Level | Rationale |
|-------|-------|-----------|
| Contract paused (any reason) | `warn` | Service degraded, requires attention |
| Contract unpaused | `info` | Service restored |
| Pause expiry detected | `info` | Informational lifecycle event |
| Transaction rejected (paused) | `warn` | User impact, recurring |
| Pause state poll successful | `debug` | High-frequency, not stored in prod |
| Pause state poll failed | `error` | Monitoring degraded |
| Repeated pause pattern detected | `warn` | Anomaly detection |

**Structured log fields for `ContractPausedEvent`:**

```json
{
  "@timestamp": "2026-09-26T22:10:00.000Z",
  "level": "warn",
  "service": "carbonledger-backend",
  "app": "carbonledger-backend",
  "event_type": "ContractPausedEvent",
  "contract": "carbon_credit",
  "contract_id": "CABC...XYZ",
  "network": "testnet",
  "ledger": 54321,
  "tx_hash": "abc123def456...",
  "reason": "emergency_security_hold",
  "initiated_by": "GADMIN...XYZ",
  "pause_until": "2026-09-26T23:00:00.000Z",
  "pause_until_timestamp": 1727391600,
  "message": "Contract carbon_credit paused on testnet — reason: emergency_security_hold",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "environment": "production"
}
```

**Structured log fields for `ContractUnpausedEvent`:**

```json
{
  "@timestamp": "2026-09-26T23:00:05.000Z",
  "level": "info",
  "service": "carbonledger-backend",
  "app": "carbonledger-backend",
  "event_type": "ContractUnpausedEvent",
  "contract": "carbon_credit",
  "contract_id": "CABC...XYZ",
  "network": "testnet",
  "ledger": 54389,
  "tx_hash": "def789ghi012...",
  "unpause_reason": "maintenance_complete",
  "initiated_by": "GADMIN...XYZ",
  "paused_at": "2026-09-26T22:10:00.000Z",
  "unpaused_at": "2026-09-26T23:00:05.000Z",
  "pause_duration_seconds": 3005,
  "message": "Contract carbon_credit unpaused on testnet after 3005s",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "environment": "production"
}
```

**Structured log fields for `tx_rejected_paused`:**

```json
{
  "@timestamp": "2026-09-26T22:12:30.000Z",
  "level": "warn",
  "service": "carbonledger-backend",
  "app": "carbonledger-backend",
  "event_type": "tx_rejected_paused",
  "contract": "carbon_credit",
  "contract_id": "CABC...XYZ",
  "network": "testnet",
  "operation": "mint_credits",
  "caller": "GBUY...ABC",
  "tx_hash": "rej456abc...",
  "error_code": "ContractPaused",
  "message": "Transaction rejected: carbon_credit is paused (operation=mint_credits)",
  "trace_id": "5ce03f4688c45eb7b4df030e1f1f5847",
  "environment": "production"
}
```

### 7.2 NestJS Logger Setup

Configure the NestJS application to emit structured JSON logs:

```typescript
// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json(),
          ),
        }),
      ],
      defaultMeta: {
        service: 'carbonledger-backend',
        app: 'carbonledger-backend',
        environment: process.env.NODE_ENV ?? 'development',
        network: process.env.STELLAR_NETWORK ?? 'testnet',
      },
    }),
  });

  await app.listen(3001);
}

bootstrap();
```

**ContractStatusService logging example:**

```typescript
// backend/src/contract-status/contract-status.service.ts (excerpt)
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ContractStatusService {
  private readonly logger = new Logger(ContractStatusService.name);

  private logPauseEvent(
    eventType: 'ContractPausedEvent' | 'ContractUnpausedEvent',
    contract: string,
    data: Record<string, unknown>,
  ) {
    const level = eventType === 'ContractPausedEvent' ? 'warn' : 'log';
    this.logger[level]({
      event_type: eventType,
      contract,
      contract_id: this.getContractId(contract),
      network: this.network,
      message: `Contract ${contract} ${eventType === 'ContractPausedEvent' ? 'paused' : 'unpaused'} on ${this.network}`,
      ...data,
    });
  }
}
```

### 7.3 Promtail Configuration

Promtail ships container stdout logs to Loki. Configure it to parse the JSON format and extract labels:

```yaml
# logging/promtail/config.yml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push
    tenant_id: carbonledger

scrape_configs:
  - job_name: carbonledger-backend
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 15s
        filters:
          - name: name
            values: ["carbonledger_backend"]

    relabel_configs:
      - source_labels: ["__meta_docker_container_name"]
        target_label: "container"
      - source_labels: ["__meta_docker_container_image"]
        target_label: "image"
      - target_label: "app"
        replacement: "carbonledger-backend"
      - target_label: "job"
        replacement: "carbonledger"

    pipeline_stages:
      # Parse JSON log lines
      - json:
          expressions:
            level: level
            event_type: event_type
            contract: contract
            network: network
            trace_id: trace_id

      # Promote parsed fields to Loki labels
      - labels:
          level:
          event_type:
          contract:
          network:

      # Use application timestamp instead of ingest time
      - timestamp:
          source: "@timestamp"
          format: RFC3339

      # Drop high-volume debug logs in production
      - match:
          selector: '{level="debug"}'
          action: drop
          drop_counter_reason: "debug_log_filtered"
```

### 7.4 Log Rotation

For non-Docker deployments writing to files, configure logrotate:

```
# /etc/logrotate.d/carbonledger-backend
/var/log/carbonledger/backend.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        # Signal NestJS to reopen log file
        kill -HUP $(cat /var/run/carbonledger-backend.pid 2>/dev/null) 2>/dev/null || true
    endscript
}

/var/log/carbonledger/pause-events.log {
    daily
    rotate 90
    compress
    delaycompress
    missingok
    notifempty
    # Keep pause event logs for 90 days for audit purposes
}
```

For Docker, set log size limits in `docker-compose.yml`:

```yaml
# docker-compose.yml (relevant section)
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "10"
        labels: "app,environment"
```

---

## 8. Grafana Dashboard Reference

The **CarbonLedger Pause Monitor** dashboard (UID: `carbonledger-pause-monitor`) is defined in `logging/grafana/dashboards/pause-monitor.json`.

### Panel Descriptions

**Row 1 — Current Status (Stat panels)**

| Panel | Query | Thresholds | Description |
|-------|-------|------------|-------------|
| Credit Contract Status | `stellar_contract_paused{contract="carbon_credit"}` | 0=green, 1=red | Large colored indicator: RUNNING / PAUSED |
| Marketplace Contract Status | `stellar_contract_paused{contract="carbon_marketplace"}` | 0=green, 1=red | Large colored indicator: RUNNING / PAUSED |
| Pause Until (Credit) | `stellar_contract_pause_until_timestamp{contract="carbon_credit"}` | — | Countdown timer, N/A if 0 |
| Total Rejected Txns | `sum(stellar_tx_rejected_paused_total)` | 0=green, >0=orange | Total rejected since last restart |

**Row 2 — Pause State Over Time (Time series)**

| Panel | Query | Description |
|-------|-------|-------------|
| Pause State Timeline | `stellar_contract_paused` | Both contracts, 1=paused bands overlaid |
| Rejected Tx Rate | `rate(stellar_tx_rejected_paused_total[5m])` | Rejections per second, by contract and operation |

**Row 3 — Event History (Logs panel)**

| Panel | Query | Description |
|-------|-------|-------------|
| Pause Event Log | `{app="carbonledger-backend"} \| json \| event_type =~ "ContractPausedEvent\|ContractUnpausedEvent"` | Scrollable structured log view |
| Rejection Log | `{app="carbonledger-backend"} \| json \| event_type = "tx_rejected_paused"` | Recent rejected transactions |

**Row 4 — Historical Metrics (Bar charts)**

| Panel | Query | Description |
|-------|-------|-------------|
| Pause Count by Contract | `increase(stellar_contract_pause_total[1d])` | Daily pause counts per contract |
| Pause Duration Distribution | `histogram_quantile(0.95, rate(contract_pause_duration_seconds_bucket[7d]))` | P95 pause duration per week |

**Annotations:**

The dashboard includes automatic annotations from AlertManager: red vertical lines appear when `SmartContractPaused` fires, and green lines when it resolves.

**Import the dashboard:**

```bash
# Import via Grafana API
curl -s -X POST http://localhost:3200/api/dashboards/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'admin:admin' | base64)" \
  -d @logging/grafana/dashboards/pause-monitor.json
```

Or use the Grafana UI: **Dashboards → Import → Upload JSON file**.

---

## 9. Health Check Endpoints

The NestJS backend exposes health check endpoints that include contract pause state:

### `GET /health`

Basic liveness check. Returns `200 OK` even if contracts are paused (the process is alive).

```bash
curl -s http://localhost:3001/health
```

```json
{
  "status": "ok",
  "timestamp": "2026-09-26T22:03:36.367Z",
  "uptime_seconds": 86420
}
```

### `GET /health/ready`

Readiness check. Returns `200 OK` only when the backend can reach Soroban RPC and the database. Returns `503` if either is unreachable.

```bash
curl -s http://localhost:3001/health/ready
```

```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "up", "latency_ms": 3 },
    "soroban_rpc": { "status": "up", "latency_ms": 120 },
    "redis": { "status": "up", "latency_ms": 1 }
  }
}
```

### `GET /api/v1/contract/status`

Full contract status including pause state. See [§3.2](#32-rest-api) for full response format.

**Use in load balancer health checks:**

```nginx
# nginx upstream health check (returns 503 when all contracts paused)
upstream carbonledger_backend {
  server localhost:3001;
  keepalive 32;
}

location /health/ready {
  proxy_pass http://carbonledger_backend;
  proxy_connect_timeout 5s;
  proxy_read_timeout 5s;
}
```

**Use in Docker Compose:**

```yaml
# docker-compose.yml
services:
  backend:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

---

## 10. Synthetic Monitoring

Synthetic monitoring actively polls the pause status on a schedule to catch issues before real users do.

### Blackbox Exporter Probe

Configure Prometheus Blackbox Exporter to probe the status endpoint:

```yaml
# infra/prometheus/blackbox.yml
modules:
  carbonledger_contract_status:
    prober: http
    timeout: 10s
    http:
      valid_http_versions: ["HTTP/1.1", "HTTP/2.0"]
      valid_status_codes: [200]
      method: GET
      preferred_ip_protocol: "ip4"
      fail_if_body_matches_regex:
        - '"overall_status":"degraded"'
        - '"overall_status":"maintenance"'
      fail_if_not_matches_regex:
        - '"overall_status":"operational"'
```

```yaml
# prometheus.yml scrape config addition
  - job_name: "carbonledger-synthetic"
    metrics_path: /probe
    params:
      module: [carbonledger_contract_status]
    static_configs:
      - targets:
          - "http://backend:3001/api/v1/contract/status"
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

### Cron-based Status Check

For environments without Blackbox Exporter, use a cron job:

```bash
# /etc/cron.d/carbonledger-pause-check
# Check every 5 minutes, alert if paused
*/5 * * * * carbonledger /usr/local/bin/carbonledger-pause-monitor.sh >> /var/log/carbonledger/pause-monitor.log 2>&1
```

```bash
#!/usr/bin/env bash
# /usr/local/bin/carbonledger-pause-monitor.sh

API_URL="${CARBONLEDGER_API_URL:-http://localhost:3001}"
SLACK_WEBHOOK="${SLACK_WEBHOOK_URL}"

response=$(curl -sf --max-time 10 "$API_URL/api/v1/contract/status")
if [[ $? -ne 0 ]]; then
  echo "$(date -u): ERROR — could not reach $API_URL/api/v1/contract/status"
  exit 1
fi

overall_status=$(echo "$response" | jq -r '.overall_status')
timestamp=$(echo "$response" | jq -r '.timestamp')

if [[ "$overall_status" != "operational" ]]; then
  echo "$(date -u): ALERT — overall_status=$overall_status at $timestamp"

  if [[ -n "$SLACK_WEBHOOK" ]]; then
    paused_contracts=$(echo "$response" | jq -r '.contracts | to_entries[] | select(.value.paused == true) | .key' | tr '\n' ', ')
    curl -s -X POST "$SLACK_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"⛔ CarbonLedger ALERT: overall_status=$overall_status — Paused: $paused_contracts\"}"
  fi
else
  echo "$(date -u): OK — overall_status=$overall_status"
fi
```

---

## 11. Debugging Pause Issues

### 11.1 Pause Not Reflected in UI

**Symptom:** The Grafana dashboard or frontend still shows the contract as running, but on-chain state is paused (or vice versa).

**Diagnostic steps:**

```bash
# Step 1: Confirm on-chain truth via CLI
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source deployer \
  --network testnet \
  -- \
  is_paused
# Expected: true or false

# Step 2: Check the backend API cache
curl -s http://localhost:3001/api/v1/contract/status | jq '.contracts.carbon_credit.paused'
# If this disagrees with step 1, the backend cache is stale

# Step 3: Check when the backend last polled
curl -s http://localhost:3001/api/v1/contract/status | jq '.contracts.carbon_credit.last_checked'
# If last_checked is > 60s ago, the polling loop may be stuck

# Step 4: Check backend logs for polling errors
docker-compose logs --tail=50 backend | grep -E "poll|soroban|contract_status"
# Or in Loki:
# {app="carbonledger-backend"} |= "poll_error" | json

# Step 5: Check Prometheus metric vs API
curl -sG 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=stellar_contract_paused{contract="carbon_credit"}' \
  | jq '.data.result[0].value[1]'
# Compare with: curl -s http://localhost:3001/api/v1/contract/status | jq '.contracts.carbon_credit.paused'

# Step 6: Restart the backend if all else fails (non-destructive)
docker-compose restart backend
sleep 10
curl -s http://localhost:3001/api/v1/contract/status | jq '.contracts.carbon_credit'
```

**Root causes and fixes:**

| Root Cause | Fix |
|------------|-----|
| Backend polling loop threw an unhandled exception | Restart backend; fix the exception in code |
| Soroban RPC rate-limited the backend | Check `429` responses in backend logs; add retry backoff |
| Frontend JavaScript cache serving stale status | Force-refresh browser; check `Cache-Control` headers on status endpoint |
| Redis caching the status response too aggressively | Reduce cache TTL for `/api/v1/contract/status` to ≤ 30s |
| Prometheus scrape interval too long | Reduce `scrape_interval` to 15s for the backend job |

---

### 11.2 Events Missing from Stream

**Symptom:** A pause happened but no `ContractPausedEvent` appears in Horizon or Soroban RPC event stream.

**Diagnostic steps:**

```bash
# Step 1: Confirm the pause actually occurred on-chain
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source deployer \
  --network testnet \
  -- \
  is_paused

# Step 2: Get the current ledger number
curl -s https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1 \
  | jq '.._embedded.records[0].sequence'

# Step 3: Query raw Soroban RPC events with a wide ledger range
CURRENT_LEDGER=$(curl -s https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1 | jq '._embedded.records[0].sequence')
START_LEDGER=$((CURRENT_LEDGER - 5000))  # Last ~7 hours on testnet

curl -s -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"getEvents\",
    \"params\": {
      \"startLedger\": \"$START_LEDGER\",
      \"filters\": [{
        \"type\": \"contract\",
        \"contractIds\": [\"$CARBON_CREDIT_CONTRACT_ID\"]
      }],
      \"pagination\": { \"limit\": 200 }
    }
  }" | jq '.result.events | length'
# If 0: either no events or wrong contract ID

# Step 4: Verify contract ID is correct
echo "Credit:      $CARBON_CREDIT_CONTRACT_ID"
echo "Marketplace: $CARBON_MARKETPLACE_CONTRACT_ID"
# Compare with values in .env

# Step 5: Check if events are in the database instead
psql "$DATABASE_URL" -c "
  SELECT * FROM contract_pause_events
  WHERE contract_name = 'carbon_credit'
  ORDER BY event_timestamp DESC
  LIMIT 10;"

# Step 6: Check backend event subscription logs
docker-compose logs backend | grep -E "subscribe|event_stream|ContractPausedEvent" | tail -30
```

**Root causes and fixes:**

| Root Cause | Fix |
|------------|-----|
| Wrong `CARBON_CREDIT_CONTRACT_ID` in env | Verify against deployed contract, update `.env` |
| Contract event indexing lag on testnet | Wait 60s, re-query with a slightly older `startLedger` |
| `pause_contract()` called but event emission disabled in contract | Review contract code; ensure `env.events().publish(...)` is called |
| Horizon event TTL expired (events pruned) | Use Soroban RPC which has longer retention; or rely on database records |
| Backend not subscribed (cold start) | Check backend logs for subscription initialization messages |

---

### 11.3 Metrics Stale or Missing

**Symptom:** `stellar_contract_paused` metric is absent from Prometheus, or the last update was long ago.

**Diagnostic steps:**

```bash
# Step 1: Check Prometheus scrape status
curl -s 'http://localhost:9090/api/v1/targets' \
  | jq '.data.activeTargets[] | select(.labels.job == "carbonledger-backend") | {
      health: .health,
      lastScrape: .lastScrape,
      lastError: .lastError,
      lastScrapeDuration: .lastScrapeDuration
    }'

# Step 2: Try scraping /metrics manually
curl -s http://localhost:3001/metrics | grep stellar_contract_paused
# If empty: metric not being exported by backend
# If present: Prometheus scrape job is broken

# Step 3: Check if metric exists but is stale
curl -sG 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=time() - timestamp(stellar_contract_paused{contract="carbon_credit"})' \
  | jq '.data.result[0].value[1]'
# Age in seconds since last update; >120 is a problem

# Step 4: Check Prometheus scrape config
cat infra/prometheus/prometheus.yml | grep -A 10 "carbonledger-backend"

# Step 5: Restart Prometheus if config is correct but target is unhealthy
docker-compose restart prometheus

# Step 6: Check if prom-client is initialized in NestJS
curl -s http://localhost:3001/metrics | grep "# HELP stellar_contract_paused"
# Should return the HELP and TYPE lines
```

**Root causes and fixes:**

| Root Cause | Fix |
|------------|-----|
| Backend `/metrics` endpoint disabled | Enable Prometheus module in NestJS; check `MetricsModule` is imported |
| Prometheus scrape job misconfigured (wrong port/path) | Update `prometheus.yml`; reload with `curl -X POST http://localhost:9090/-/reload` |
| Docker network DNS issue (backend hostname wrong) | Use container name `backend` not `localhost` in Prometheus config |
| `prom-client` gauge not registered | Ensure `ContractStatusService` initializes gauges on startup |
| Backend OOM restart cleared in-memory counters | Add persistence for counters; check memory limits in docker-compose |

---

### 11.4 False Alarm Alerts

**Symptom:** `SmartContractPaused` alert fires but contract appears to be running when checked manually.

**Diagnostic steps:**

```bash
# Step 1: Check the actual metric value at alert fire time
curl -sG 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=stellar_contract_paused{contract="carbon_credit"}' \
  | jq '.data.result[0].value'

# Step 2: Check alert state in AlertManager
curl -s http://localhost:9093/api/v2/alerts \
  | jq '.[] | select(.labels.alertname == "SmartContractPaused")'

# Step 3: Check if it was a brief transient pause that already resolved
curl -sG 'http://localhost:9090/api/v1/query_range' \
  --data-urlencode 'query=stellar_contract_paused{contract="carbon_credit"}' \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)" \
  --data-urlencode "end=$(date +%s)" \
  --data-urlencode "step=15s" \
  | jq '.data.result[0].values[] | [.[0] | todate, .[1]]'
# Look for brief spikes to "1"

# Step 4: Check if backend had a brief RPC error that returned wrong state
docker-compose logs backend --since 2h | grep -E "is_paused|poll_error|rpc_timeout"

# Step 5: Check if the for: 1m duration in the alert rule is helping
# If the alert fires instantly with no 1m pending, the for: rule is not set or too short
curl -s 'http://localhost:9090/api/v1/rules' \
  | jq '.data.groups[].rules[] | select(.name == "SmartContractPaused") | .duration'
```

**Root causes and fixes:**

| Root Cause | Fix |
|------------|-----|
| Brief (< 30s) transient pause during maintenance | Increase `for: 1m` to `for: 3m` if false alarms are frequent |
| Soroban RPC returned error and backend defaulted to `paused=true` (fail-safe) | Fix backend to use last known good state on RPC error, not fail-safe paused |
| Backend restart caused metric to reset to 1 temporarily | Add startup grace period before exporting metrics |
| Clock skew between backend and Prometheus | Ensure NTP is synchronized; check `timedatectl status` |
| Wrong contract ID causing wrong state to be reported | Double-check `CARBON_CREDIT_CONTRACT_ID` in env matches deployed contract |

---

### 11.5 Pause Stuck — Cannot Unpause

**Symptom:** Contract is paused, and the unpause transaction is failing or not being processed.

**Diagnostic steps:**

```bash
# Step 1: Check if the pause has an expiry set
curl -s http://localhost:3001/api/v1/contract/status \
  | jq '.contracts.carbon_credit.pause_until'
# If non-null: wait for natural expiry, or issue admin unpause before then

# Step 2: Check if admin account has sufficient XLM for fees
ADMIN_ACCOUNT="GADMIN...XYZ"
curl -s "https://horizon-testnet.stellar.org/accounts/$ADMIN_ACCOUNT" \
  | jq '.balances[] | select(.asset_type == "native") | .balance'
# Need at least 1 XLM

# Step 3: Try unpause manually with higher fee
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source deployer \
  --network testnet \
  --fee 10000 \
  -- \
  unpause_contract

# Step 4: Check if unpause requires a specific admin role
# Review contract code for admin/owner check in unpause_contract()
# The caller must be the contract admin key

# Step 5: Check current network congestion
curl -s "https://horizon-testnet.stellar.org/fee_stats" | jq '{
  last_ledger_base_fee: .last_ledger_base_fee,
  fee_charged_p99: .fee_charged.p99,
  ledger_capacity_usage: .ledger_capacity_usage
}'

# Step 6: Check if the contract is in an invalid state
stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --key "PAUSED" \
  --network testnet
```

**Escalation:** If unpause cannot be completed within 30 minutes via normal admin tooling, escalate to the contract owner and follow the emergency escalation procedure in [§12](#12-escalation-procedures).

---

## 12. Escalation Procedures

### Severity Matrix

| Situation | Severity | Response Time | Escalation Path |
|-----------|----------|---------------|-----------------|
| Single contract paused, known maintenance | Info | No action needed | Monitor only |
| Single contract paused, unknown reason | P2 | 30 minutes | On-call engineer |
| Both contracts paused, unknown reason | P1 | 15 minutes | On-call + platform lead |
| Cannot unpause (stuck) | P1 | 15 minutes | On-call + contract owner |
| Repeated pause attacks | P1 | Immediate | On-call + security + CTO |

### P1 Escalation Steps

1. **Acknowledge the PagerDuty alert** immediately to stop re-paging.
2. **Check the status endpoint**: `curl http://localhost:3001/api/v1/contract/status | jq .`
3. **Check if it is a scheduled maintenance window** (check #carbonledger-ops Slack channel and the maintenance calendar).
4. **If not scheduled**, escalate in `#carbonledger-incidents`:
   ```
   🚨 P1 INCIDENT: CarbonLedger contract [name] paused — reason unknown
   Time: [UTC timestamp]
   Status: https://carbonledger.io/status
   Dashboard: http://localhost:3200/d/carbonledger-pause-monitor
   On-call: [your name] investigating
   ```
5. **Attempt emergency unpause** if no maintenance is in progress:
   ```bash
   stellar contract invoke \
     --id "$CARBON_CREDIT_CONTRACT_ID" \
     --source deployer \
     --network testnet \
     --fee 100000 \
     -- \
     unpause_contract
   ```
6. **Post an update every 15 minutes** in `#carbonledger-incidents` until resolved.
7. **File a post-mortem** within 48 hours using the template in `docs/postmortem-template.md`.

---

## 13. Related Documentation

| Document | Description |
|----------|-------------|
| [docs/carbon-credit-lifecycle.md](carbon-credit-lifecycle.md) | Full credit lifecycle, error conditions per stage |
| [docs/adr/](adr/README.md) | Architectural Decision Records including pause mechanism design |
| [docs/QUICK_REFERENCE.md](QUICK_REFERENCE.md) | One-page command reference for common operations |
| [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) | General troubleshooting for setup and runtime issues |
| [docs/configuration.md](configuration.md) | Every environment variable explained |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Development workflow and testing guide |
| [SECURITY.md](../SECURITY.md) | Security policy and responsible disclosure |
| [audit/pre-audit-checklist.md](../audit/pre-audit-checklist.md) | Pre-audit security checklist including pause mechanism review |
| [infra/prometheus/rules/](../infra/prometheus/rules/) | All Prometheus alert rule files |
| [logging/grafana/dashboards/](../logging/grafana/dashboards/) | Grafana dashboard JSON definitions |

### External References

| Resource | URL |
|----------|-----|
| Soroban RPC API Reference | https://developers.stellar.org/docs/data/rpc/api-reference |
| Horizon API Reference | https://developers.stellar.org/docs/data/horizon |
| Stellar CLI Reference | https://developers.stellar.org/docs/tools/cli |
| Prometheus Query Language | https://prometheus.io/docs/prometheus/latest/querying/basics/ |
| Loki LogQL Reference | https://grafana.com/docs/loki/latest/query/ |
| AlertManager Configuration | https://prometheus.io/docs/alerting/latest/configuration/ |
| PagerDuty Events API v2 | https://developer.pagerduty.com/docs/events-api-v2/overview/ |
| OpsGenie Alert API | https://docs.opsgenie.com/docs/alert-api |

---

*This guide closes issue #1207. For improvements or corrections, open a PR against `docs/PAUSE_MONITORING_GUIDE.md`.*
