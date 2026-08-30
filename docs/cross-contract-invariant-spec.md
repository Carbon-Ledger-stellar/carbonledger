# Cross-Contract Invariant: Issued ≤ Verified

**PR:** #530  
**Date:** 2026-07-25  
**Contracts affected:** `carbon_credit`, `carbon_oracle`

---

## Overview

This document specifies the cross-contract invariant that ensures total minted
credits for any project can never exceed the oracle-verified carbon tonnes for
that project.  It covers the trust model, ordering guarantees, implementation
details, and monitoring alert design.

---

## Invariant Statement

```
∀ project p, ∀ time t:
  total_credits_issued(p, t) + new_amount ≤ total_verified_tonnes(p, t)
```

Where:
- `total_credits_issued(p)` = sum of `batch.amount` across all batches for project `p`
- `total_verified_tonnes(p)` = sum of `MonitoringData.tonnes_verified` across all
  registered periods for project `p` (as reported by the oracle)
- The check fires **atomically before any state write** inside `mint_credits()`

---

## Architecture

```
Admin calls mint_credits(project_id, amount, ...)
         │
         ▼
carbon_credit::mint_credits()
  │  [basic validation: amount > 0, serial range, vintage year]
  │
  ├─ oracle configured? ──No──► skip invariant check (permissive mode)
  │
  └─ oracle configured? ──Yes──►
       │
       ├─ invoke oracle.get_total_verified_tonnes(project_id, periods)
       │    └─ oracle sums MonitoringData.tonnes_verified for each period
       │
       ├─ sum already_issued from ProjectBatches(project_id)
       │
       ├─ total_after_mint = already_issued + amount
       │
       ├─ total_after_mint > verified? ──Yes──►
       │    ├─ emit event ("c_ledger", "over_issue")
       │    └─ return Err(IssuanceExceedsVerified)
       │
       └─ total_after_mint <= verified? ──Yes──►
            └─ proceed with mint (write batch, update serial registry)
```

---

## Trust Model

| Assumption | Rationale |
|------------|-----------|
| Oracle is trusted | Authorised oracle address set at deploy; out of scope to prevent oracle malice (see scope) |
| Oracle data may be stale | Freshness (365-day window) is checked separately via `is_monitoring_current()`; the invariant check does not enforce freshness |
| Admin controls period list | Admin calls `set_verified_periods()` to define which monitoring periods count; admin is a trusted role |
| No oracle configured = permissive | Before oracle integration, minting is unrestricted; recommended to set oracle at deploy |

### Out of Scope
- Oracle malice prevention (oracle is assumed honest per design)
- Backend database consistency (separate system)
- Freshness enforcement (handled by `is_monitoring_current()` and the marketplace circuit breaker)

---

## Ordering Guarantees

The following call sequence must be followed before a mint can succeed:

```
1. oracle.submit_monitoring_data(project_id, period, tonnes_verified, ...)
   └─ Oracle writes MonitoringData(project_id, period) to persistent storage

2. credit.set_verified_periods(project_id, [period1, period2, ...])
   └─ Admin registers which periods count toward the invariant

3. credit.mint_credits(project_id, amount, ...)
   └─ Atomically checks: sum(MonitoringData) >= already_issued + amount
   └─ On pass: writes batch, updates serial registry
   └─ On fail: returns IssuanceExceedsVerified, emits over_issue event
```

If step 2 is skipped, the periods list is empty, `get_total_verified_tonnes`
returns 0, and the invariant rejects any non-zero mint.

---

## Implementation

### New error code

```rust
// carbon_credit/src/lib.rs
IssuanceExceedsVerified = 23,
```

### New oracle function

```rust
// carbon_oracle/src/lib.rs
pub fn get_total_verified_tonnes(
    env: Env,
    project_id: String,
    periods: Vec<String>,
) -> i128
```

Sums `MonitoringData.tonnes_verified` for each registered period.

### New admin functions (carbon_credit)

```rust
pub fn set_oracle_contract(env, admin, oracle: Address) -> Result<(), CarbonError>
pub fn set_verified_periods(env, admin, project_id, periods: Vec<String>) -> Result<(), CarbonError>
pub fn get_oracle_contract(env) -> Option<Address>
```

### Invariant check location

The check is inserted in `mint_credits()` **after** all basic validation
(amount, serial range, vintage year, duplicate batch check) and **before**
any storage write.  This ensures no partial state is written if the invariant
is violated.

---

## Monitoring Alert Design

When the invariant is violated, an event is emitted for external monitoring:

```
Event topic:   ("c_ledger", "over_issue")
Event payload: (project_id: String, attempted_total: i128, verified_total: i128)
```

### Recommended alert configuration

| Severity | Trigger | Action |
|----------|---------|--------|
| P1 (Critical) | `over_issue` event emitted | Page on-call; halt further minting for the project |
| P2 (High) | `IssuanceExceedsVerified` error rate > 0 in 1h window | Notify team; investigate oracle data |
| Info | `set_verified_periods` called with 0 periods | Warn in Slack; confirm intentional |

### Off-chain monitoring query (Stellar Horizon)

```bash
# Stream contract events for over_issue alerts
curl "https://horizon-testnet.stellar.org/accounts/{contract_id}/effects?order=desc" \
  | jq '.[] | select(.type == "contract_events") | select(.topic | contains("over_issue"))'
```

---

## Test Coverage

All invariant tests are in `carbon_credit/src/lib.rs` under
`mod cross_contract_invariant_tests`:

| Test | Scenario |
|------|----------|
| `test_no_oracle_mint_succeeds` | No oracle → permissive mode |
| `test_oracle_set_no_periods_mint_blocked` | Oracle set, no periods → 0 verified → blocked |
| `test_invariant_holds_when_no_oracle_configured` | Multiple mints, no oracle |
| `test_set_oracle_contract_stores_address` | Admin can set oracle |
| `test_non_admin_cannot_set_oracle_contract` | Auth check |
| `test_set_verified_periods_stored` | Periods registered |
| `test_non_admin_cannot_set_verified_periods` | Auth check |
| `test_issuance_exceeds_verified_error_code` | Error code = 23 |
| `test_invariant_failure_leaves_no_state` | No partial write on failure |
| `test_over_issue_event_emitted_on_violation` | Event emission path |
