# Contract Upgrade Runbook

**Priority:** High  
**Effort:** Medium  
**Last Updated:** 2026-07-25  
**Applies to:** `carbon_registry`, `carbon_credit`, `carbon_marketplace`, `carbon_oracle`

---

## Overview

This runbook describes the standard operating procedure for upgrading the four CarbonLedger Soroban smart contracts on testnet and mainnet. All upgrades use Soroban's built-in WASM upgrade mechanism (`update_current_contract_wasm`), which replaces contract code while preserving all persistent and temporary storage.

Since Soroban WASM upgrades are irreversible at the protocol level, every upgrade is performed using a **canary deployment strategy** implemented at the application layer. This routes a configurable percentage of calls to the new contract address while keeping the primary address active, with automated rollback if error rates on the canary exceed the primary by more than 1.5x.

---

## Principles

1. **Admin-gated only.** Only the stored `Admin` address may invoke `upgrade()`.
2. **Storage is preserved.** WASM upgrades do not touch ledger entries; all projects, credits, listings, monitoring data, and retirement certificates survive the upgrade.
3. **Retirement records are immutable.** No upgrade may contain code that decreases `total_credits_retired`, alters `RetirementCertificate` entries, or reverts a `FullyRetired` batch to `Active`.
4. **Testnet first.** Every upgrade must be executed and validated on Futurenet/Testnet before mainnet.
5. **Version tracking.** Each upgrade increments an on-chain `ContractVersion` counter and emits an `upgraded` event with `from_version`, `to_version`, `admin`, and `wasm_hash`.
6. **Canary first.** Every mainnet upgrade starts at ≤10% canary traffic with automated rollback on elevated error rates.

---

## Canary Deployment Strategy

### How It Works

The `StellarNetworkService` in the NestJS backend maintains two contract targets:

- **Primary** — the current production contract address (env var `CARBON_*_CONTRACT_ID`).
- **Canary** — the new contract address being tested (env var `CANARY_CONTRACT_ID`).

On each contract call, `resolveContract(primaryId)` rolls a random number against `CANARY_TRAFFIC_PCT`. If the roll falls within the canary slice, the call is routed to `CANARY_CONTRACT_ID` instead of the primary. Both outcomes are tracked in a Prometheus counter:

```
contract_calls_total{contract="primary"|"canary", status="success"|"error"}
```

A Grafana alert rule fires when canary error rate exceeds 1.5× the primary rate for 5 minutes and automatically calls `POST /api/v1/admin/canary { "trafficPct": 0 }` to zero out canary traffic.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CANARY_CONTRACT_ID` | *(empty)* | New contract address under test. Empty = canary disabled. |
| `CANARY_TRAFFIC_PCT` | `0` | Percentage (0–100) of calls routed to the canary. |

Both variables can be set at startup in `.env` **or changed at runtime** via the admin API without a restart.

### Admin API

**Read current config and live error rates:**

```http
GET /api/v1/admin/canary
Authorization: Bearer <admin-jwt>
```

Response:
```json
{
  "config": {
    "canaryContractId": "CAABC...",
    "trafficPct": 10
  },
  "errorRates": {
    "primary": 0.01,
    "canary": 0.02
  }
}
```

**Enable canary with 5% traffic:**

```http
POST /api/v1/admin/canary
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "canaryContractId": "CAABC...", "trafficPct": 5 }
```

**Increase traffic split:**

```http
POST /api/v1/admin/canary
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "trafficPct": 25 }
```

**Emergency rollback — zero out canary traffic immediately:**

```http
POST /api/v1/admin/canary
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "trafficPct": 0 }
```

---

## Pre-Upgrade Checklist

- [ ] New WASM compiled with `--release` and audited.
- [ ] New WASM hash computed (`stellar contract install ...`).
- [ ] Storage layout backward compatibility verified.
- [ ] No new functions decrease retirement counters or alter retirement certificates.
- [ ] Upgrade executed and validated on **testnet**.
- [ ] Off-chain indexers notified of the upgrade block.
- [ ] Admin key available with sufficient XLM for transaction fees.
- [ ] Incident response channel open.
- [ ] `CANARY_CONTRACT_ID` set; `CANARY_TRAFFIC_PCT` starts at 0.
- [ ] Grafana canary alerts active — confirm in Grafana UI under CarbonLedger > Canary Deployment.

---

## Upgrade Procedure

### Step 1 — Build and Deploy the New Contract

```bash
cd contracts/carbon_registry
cargo build --target wasm32-unknown-unknown --release

# Install WASM, get back a WASM hash
stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source <ADMIN_SECRET_KEY> \
  --network testnet

# Deploy as a new contract instance (returns NEW_CONTRACT_ID)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source <ADMIN_SECRET_KEY> \
  --network testnet
```

Repeat for each contract being upgraded. Record each `NEW_CONTRACT_ID`.

### Step 2 — Enable Canary at Low Traffic

```bash
curl -X POST https://api.carbonledger.io/api/v1/admin/canary \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"canaryContractId\": \"$NEW_CONTRACT_ID\", \"trafficPct\": 5}"
```

Monitor **Grafana > CarbonLedger > Canary Deployment** for 15–30 minutes.

### Step 3 — Graduated Traffic Increase

If no alerts fire, increase in steps:

| Step | `trafficPct` | Observation period |
|---|---|---|
| 1 | 5% | 15 min |
| 2 | 10% | 30 min |
| 3 | 25% | 1 hour |
| 4 | 50% | 2 hours |
| 5 | 100% | Full migration |

```bash
# Example: increase to 25%
curl -X POST https://api.carbonledger.io/api/v1/admin/canary \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"trafficPct": 25}'
```

### Step 4 — Full Migration

Once stable at 100% canary:

1. Update `CARBON_REGISTRY_CONTRACT_ID=<NEW_CONTRACT_ID>` in `.env`.
2. Rolling-restart the backend (`docker-compose up -d --no-deps backend`).
3. Clear the canary: `POST /api/v1/admin/canary { "trafficPct": 0, "canaryContractId": "" }`.
4. The new contract is now primary.

### Step 5 — Post-Upgrade Validation

| Check | Command / Action |
|---|---|
| Version incremented | `get_version()` returns `old + 1` |
| Upgrade history recorded | `get_upgrade_history()` matches the tx |
| Retired credits intact | `get_project(...).total_credits_retired` unchanged |
| Retirement certificates intact | `get_retirement_certificate(...)` returns same data |
| Listings intact | `get_listing(...)` returns same data |
| Monitoring data intact | `get_monitoring_data(...)` returns same data |
| Error rate stable | `GET /api/v1/admin/canary` → `errorRates.primary` ≈ 0 |

---

## Automated Rollback

### Trigger Condition

Grafana evaluates every 30 seconds:

```
canary_error_rate > 1.5 × primary_error_rate  (sustained 5 minutes)
AND at least 5 canary calls recorded
```

### Rollback Sequence

1. Alert fires → Grafana contact point `canary-auto-rollback` is triggered.
2. Grafana sends `POST /api/v1/admin/canary { "trafficPct": 0 }` to the backend.
3. Backend immediately stops routing calls to the canary contract.
4. All traffic returns to the primary contract — no restart needed.
5. Alert stays **Firing** until the operator clears the canary config manually.

### Manual Rollback

```bash
curl -X POST https://api.carbonledger.io/api/v1/admin/canary \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"trafficPct": 0}'
```

Takes effect instantly.

---

## Metrics Reference

The backend exposes Prometheus metrics at `GET /metrics` (no auth, counters only):

```
# HELP contract_calls_total Total number of Soroban contract calls
# TYPE contract_calls_total counter
contract_calls_total{contract="primary",status="success"} 1420
contract_calls_total{contract="primary",status="error"}   14
contract_calls_total{contract="canary",status="success"}  98
contract_calls_total{contract="canary",status="error"}    7
```

Grafana scrapes this endpoint via the Prometheus datasource to drive the alert rules in `logging/grafana/provisioning/alerting/canary-rollback.yml`.

Recording rules live in `logging/prometheus/rules/canary.yml`.

---

## Grafana Alert Reference

| Alert | Condition | Severity | Action |
|---|---|---|---|
| `CanaryContractHighErrorRate` | canary rate > 1.5× primary for 5 min | critical | Auto-rollback: `trafficPct=0` |
| `CanaryContractAbsoluteErrorRate` | canary rate > 10% for 5 min | warning | Manual review |

---

## WASM In-Place Upgrade (same contract ID)

If upgrading WASM bytecode on an existing contract ID rather than deploying a new address:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SECRET_KEY> \
  --network testnet \
  -- upgrade \
  --admin <ADMIN_ADDRESS> \
  --new_wasm_hash <WASM_HASH>
```

Use the canary period to shadow-test the new WASM before invoking this command on mainnet.

---

## Rollback Policy

Soroban WASM upgrades are **one-way** at the protocol level. If a critical bug is found after full migration:

1. Storage is safe — no data loss.
2. Build a patched WASM from the previous known-good source.
3. Execute another `upgrade()` to the patched WASM.
4. Document the incident and schedule a post-mortem.

For application-layer canary rollback (before the primary contract is changed): set `trafficPct: 0`. No WASM upgrade needed.

---

## Event Reference

All contracts emit the same upgrade event shape:

```
Event topic: ("c_ledger", "upgraded")
Event data:  (from_version: u32, to_version: u32, upgraded_by: Address)
```

---

## Emergency Contacts

See [contacts.md](contacts.md) for on-call escalation paths.

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-04-28 | OpenCode | Initial runbook covering all four contracts |
| 2026-07-25 | OpenCode | Added canary deployment strategy, admin API reference, automated rollback, Prometheus/Grafana alert config |
