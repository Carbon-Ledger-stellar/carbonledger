# Pause Events Reference

> **Status:** This document describes events for the proposed pause mechanism. The pause feature is planned but not yet implemented — see [ISSUES.md](ISSUES.md) for implementation scope.

## Table of Contents

- [Overview](#overview)
- [ContractPausedEvent](#contractpausedevent)
- [ContractUnpausedEvent](#contractunpausedevent)
- [Event Field Descriptions](#event-field-descriptions)
- [Event Filter Examples](#event-filter-examples)
- [Event Monitoring Guidance](#event-monitoring-guidance)

---

## Overview

When the pause mechanism is implemented, the `carbon_credit` and `carbon_marketplace` contracts will emit structured Soroban events on every state change to the pause flag. These events provide an immutable, queryable audit trail of all pause and unpause operations.

Soroban events consist of two parts:

- **Topics** — a `Vec` of up to 4 `Val` values used for filtering (equivalent to indexed log parameters in EVM).
- **Data** — an arbitrary `Val` payload with the full event body.

All CarbonLedger pause events follow the pattern:

```
topics: [contract_name: Symbol, event_name: Symbol, admin: Address]
data:   { timestamp: u64, expiry_timestamp: u64, reason: Option<String> }
```

---

## ContractPausedEvent

Emitted whenever an admin successfully pauses a contract, including when a pause is renewed (i.e., `pause()` called while already paused).

### Topics

| Position | Type | Value |
|---|---|---|
| 0 | `Symbol` | `"carbon_credit"` or `"carbon_marketplace"` |
| 1 | `Symbol` | `"contract_paused"` |
| 2 | `Address` | The admin address that triggered the pause |

### Data

```rust
#[contracttype]
pub struct ContractPausedEvent {
    /// Unix timestamp (seconds) when the pause was activated.
    pub timestamp: u64,
    /// Unix timestamp (seconds) when the pause will automatically expire (timestamp + 72 hours).
    pub expiry_timestamp: u64,
    /// Human-readable reason provided by the admin. None if no reason was given.
    pub reason: Option<String>,
    /// Whether this call renewed an existing pause (true) or created a fresh pause (false).
    pub is_renewal: bool,
}
```

### Example Raw Event (JSON)

```json
{
  "type": "contract",
  "ledger": "54321098",
  "ledgerClosedAt": "2026-09-24T13:18:50Z",
  "contractId": "CAABC...XYZ",
  "topics": [
    { "type": "symbol", "value": "carbon_credit" },
    { "type": "symbol", "value": "contract_paused" },
    { "type": "address", "value": "GADMIN1234567890ABCDEFGHIJ" }
  ],
  "value": {
    "type": "map",
    "entries": [
      { "key": "timestamp",        "value": { "type": "u64", "value": "1758770330" } },
      { "key": "expiry_timestamp", "value": { "type": "u64", "value": "1759029530" } },
      { "key": "reason",           "value": { "type": "option", "value": { "type": "string", "value": "Suspicious mint activity detected" } } },
      { "key": "is_renewal",       "value": { "type": "bool",   "value": false } }
    ]
  }
}
```

### Rust Emission Code

```rust
fn emit_paused(env: &Env, admin: &Address, expiry: u64, reason: Option<String>, is_renewal: bool) {
    let topics = (
        symbol_short!("carbon_cr"),  // contract identifier
        symbol_short!("paused"),
        admin.clone(),
    );
    let data = ContractPausedEvent {
        timestamp:        env.ledger().timestamp(),
        expiry_timestamp: expiry,
        reason,
        is_renewal,
    };
    env.events().publish(topics, data);
}
```

---

## ContractUnpausedEvent

Emitted when an admin explicitly calls `unpause()`. This event is **not** emitted when a pause expires naturally — natural expiry is a passive state transition with no on-chain transaction, so no event is emitted. Monitoring systems should derive natural expiry from the `expiry_timestamp` field of the `ContractPausedEvent`.

### Topics

| Position | Type | Value |
|---|---|---|
| 0 | `Symbol` | `"carbon_credit"` or `"carbon_marketplace"` |
| 1 | `Symbol` | `"contract_unpaused"` |
| 2 | `Address` | The admin address that triggered the unpause |

### Data

```rust
#[contracttype]
pub struct ContractUnpausedEvent {
    /// Unix timestamp (seconds) when the unpause was executed.
    pub timestamp: u64,
    /// Duration in seconds that the contract was paused (timestamp - pause_start_timestamp).
    pub pause_duration_seconds: u64,
    /// Human-readable note, e.g. "Incident resolved, safe to resume".
    pub note: Option<String>,
}
```

### Example Raw Event (JSON)

```json
{
  "type": "contract",
  "ledger": "54321200",
  "ledgerClosedAt": "2026-09-24T15:22:10Z",
  "contractId": "CAABC...XYZ",
  "topics": [
    { "type": "symbol", "value": "carbon_credit" },
    { "type": "symbol", "value": "contract_unpaused" },
    { "type": "address", "value": "GADMIN1234567890ABCDEFGHIJ" }
  ],
  "value": {
    "type": "map",
    "entries": [
      { "key": "timestamp",               "value": { "type": "u64",    "value": "1758777730" } },
      { "key": "pause_duration_seconds",  "value": { "type": "u64",    "value": "7400" } },
      { "key": "note",                    "value": { "type": "option", "value": { "type": "string", "value": "False positive confirmed, resuming normal operations" } } }
    ]
  }
}
```

### Rust Emission Code

```rust
fn emit_unpaused(env: &Env, admin: &Address, pause_start: u64, note: Option<String>) {
    let now = env.ledger().timestamp();
    let topics = (
        symbol_short!("carbon_cr"),
        symbol_short!("unpaused"),
        admin.clone(),
    );
    let data = ContractUnpausedEvent {
        timestamp:              now,
        pause_duration_seconds: now.saturating_sub(pause_start),
        note,
    };
    env.events().publish(topics, data);
}
```

---

## Event Field Descriptions

### Shared fields

| Field | Type | Description |
|---|---|---|
| `timestamp` | `u64` | Unix epoch seconds at the time the event was emitted. Derived from `env.ledger().timestamp()`. |
| `reason` / `note` | `Option<String>` | Free-text field supplied by the admin. Stored in the event payload but **not** in contract state. Max 200 characters recommended. |

### `ContractPausedEvent`-specific fields

| Field | Type | Description |
|---|---|---|
| `expiry_timestamp` | `u64` | When the pause will automatically expire. Always `timestamp + 259200` (72 hours in seconds). Monitoring systems should alert when this threshold is approaching if the pause was intentional. |
| `is_renewal` | `bool` | `true` if the contract was already paused when `pause()` was called, meaning the 72-hour window was reset. Useful for audit trails showing how long an incident was active. |

### `ContractUnpausedEvent`-specific fields

| Field | Type | Description |
|---|---|---|
| `pause_duration_seconds` | `u64` | Total wall-clock seconds the contract was paused. Calculated as `unpause_timestamp - pause_start_timestamp`. Useful for incident post-mortems. |

---

## Event Filter Examples

### Stellar Horizon — fetch all pause events for a contract

```bash
# Replace $CONTRACT_ID with the deployed contract address
curl "https://horizon-testnet.stellar.org/accounts/$CONTRACT_ID/operations?limit=200&order=desc" \
  | jq '.._embedded.records[] | select(.type == "invoke_host_function")'
```

### Soroban RPC — `getEvents` with topic filter

```bash
curl -X POST https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 54000000,
      "filters": [
        {
          "type": "contract",
          "contractIds": ["CAABC...XYZ"],
          "topics": [
            ["*"],
            ["AAAADQAAAAZwYXVzZWQ="]
          ]
        }
      ]
    }
  }'
```

> The base64 value `AAAADQAAAAZwYXVzZWQ=` decodes to the XDR-encoded Symbol `"paused"`. Use `stellar xdr encode --type SCSymbol --value paused` to generate the correct base64 for your Stellar CLI version.

### Stellar SDK (JavaScript) — subscribe to pause events

```typescript
import { Contract, SorobanRpc, xdr } from '@stellar/stellar-sdk';

const server = new SorobanRpc.Server('https://soroban-testnet.stellar.org');

// Poll for ContractPaused events since a given ledger
async function getPauseEvents(contractId: string, startLedger: number) {
  const events = await server.getEvents({
    startLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [contractId],
        topics: [
          [xdr.ScVal.scvSymbol('carbon_credit').toXDR('base64')],
          [xdr.ScVal.scvSymbol('contract_paused').toXDR('base64')],
        ],
      },
    ],
  });

  return events.events.map((e) => ({
    ledger:     e.ledger,
    timestamp:  e.ledgerClosedAt,
    admin:      e.topic[2],
    data:       e.value,
  }));
}
```

### Stellar SDK (JavaScript) — subscribe to unpause events

```typescript
async function getUnpauseEvents(contractId: string, startLedger: number) {
  const events = await server.getEvents({
    startLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [contractId],
        topics: [
          [xdr.ScVal.scvSymbol('carbon_credit').toXDR('base64')],
          [xdr.ScVal.scvSymbol('contract_unpaused').toXDR('base64')],
        ],
      },
    ],
  });

  return events.events;
}
```

### Python (py-stellar-base) — oracle service event listener

```python
from stellar_sdk import SorobanServer, xdr as stellar_xdr

server = SorobanServer("https://soroban-testnet.stellar.org")

def get_pause_events(contract_id: str, start_ledger: int) -> list:
    """Fetch all ContractPaused events since start_ledger."""
    paused_topic = stellar_xdr.SCVal(
        stellar_xdr.SCValType.SCV_SYMBOL,
        sym=stellar_xdr.SCSymbol(sc_symbol=b"contract_paused")
    ).to_xdr()

    resp = server.get_events(
        start_ledger=start_ledger,
        filters=[{
            "type": "contract",
            "contractIds": [contract_id],
            "topics": [["*"], [paused_topic]],
        }]
    )
    return resp.events
```

---

## Event Monitoring Guidance

### What to monitor

| Metric | Alert threshold | Severity |
|---|---|---|
| `contract_paused` event emitted | Immediately | Critical |
| `contract_unpaused` event emitted | Immediately (informational) | Info |
| No `contract_unpaused` within 60 minutes of a pause | Alert to on-call | High |
| Pause renewed (`is_renewal: true`) | Alert — incident still ongoing | High |
| `expiry_timestamp` approaching (< 6 hours remaining) | Alert to on-call for intentional pauses | High |

### Grafana alert rule (Loki)

Add to `logging/grafana/alerts.yml`:

```yaml
groups:
  - name: CarbonLedger Pause Alerts
    rules:
      - alert: ContractPaused
        expr: |
          count_over_time(
            {job="carbonledger-oracle"} |= "contract_paused" [5m]
          ) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "CarbonLedger contract has been paused"
          description: "A contract pause event was detected. Check the emergency pause runbook immediately."
          runbook_url: "https://github.com/YOUR_USERNAME/carbonledger/blob/main/docs/runbooks/emergency-pause.md"

      - alert: ContractPausedNoResolution
        expr: |
          (time() - carbonledger_pause_start_timestamp) > 3600
          and carbonledger_is_paused == 1
        for: 0m
        labels:
          severity: high
        annotations:
          summary: "Contract still paused after 60 minutes"
          description: "The contract has been paused for over an hour with no unpause event detected."
```

### Oracle service integration

The oracle should check `is_paused()` before submitting monitoring data. If the contract is paused, the oracle should:

1. Log a warning and skip the submission.
2. Back off for 5 minutes before retrying.
3. Alert on-call if the pause persists beyond the oracle's price TTL (24 hours).

```python
def submit_monitoring_data_if_unpaused(contract_id, data):
    if credit_contract.is_paused():
        logger.warning(
            "Contract %s is paused. Skipping monitoring submission. "
            "Will retry in 5 minutes.", contract_id
        )
        return None
    return credit_contract.submit_monitoring_data(data)
```

### Event retention

Soroban events are queryable via Horizon for a configurable retention window (default 7 days on testnet, longer on mainnet archive nodes). For audit compliance:

- Export all `contract_paused` / `contract_unpaused` events to the PostgreSQL events table in the backend.
- Retain indefinitely — pause events are relevant to incident post-mortems.

See the backend `NestJS` service for the event ingestion job (`backend/src/events/event-ingestion.service.ts`).

---

## Related Documentation

- [Pause Testing Guide](PAUSE_TESTING_GUIDE.md) — how to test the pause mechanism
- [Pause Operations Guide](PAUSE_OPERATIONS_GUIDE.md) — how admins execute a pause in production
- [Emergency Pause Runbook](runbooks/emergency-pause.md) — decision tree and checklist for security incidents
- [Observability Guide](OBSERVABILITY_GUIDE.md) — Loki, Promtail, and Grafana setup
- [Error Code Reference](error-codes.md) — full list of `CarbonError` variants
