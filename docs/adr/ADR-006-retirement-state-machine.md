# ADR-006: Retirement State Machine Invariants

**Status:** Accepted  
**Date:** 2026-07-25  
**Closes:** #528  
**Author:** CarbonLedger Core Team

---

## Context

Carbon credits in CarbonLedger go through a lifecycle from issuance to permanent
retirement.  The credibility of the entire system rests on a single guarantee:
**once a credit is retired, it can never be re-issued, re-sold, or un-retired**.
This ADR formalises that guarantee as a state machine specification, proves its
correctness, and documents the guard assertions enforcing it in code.

---

## State Machine Specification

### States

| State             | Meaning                                           | Terminal? |
|-------------------|---------------------------------------------------|-----------|
| `Active`          | All credits in the batch are available            | No        |
| `PartiallyRetired`| Some credits retired, some still active           | No        |
| `FullyRetired`    | All credits permanently retired                   | **Yes**   |
| `Suspended`       | Batch blocked by admin; no transfers or retirements| No (can be lifted) |

### Legal Transitions

```
mint_credits()
      │
      ▼
 ┌─────────┐  retire(partial)   ┌──────────────────┐
 │ Active  │ ─────────────────► │ PartiallyRetired │
 └─────────┘                    └──────────────────┘
      │  retire(all)                    │ retire(remaining)
      │                                 │
      ▼                                 ▼
 ┌──────────────┐◄────────────────────────────────┘
 │ FullyRetired │  ← TERMINAL STATE (irreversible)
 └──────────────┘

 ┌───────────┐
 │ Suspended │  ← BLOCKED (any retirement attempt returns ProjectSuspended)
 └───────────┘
```

### Illegal Transitions

The following transitions are **structurally impossible** in the contract:

| Attempted Transition          | Error Returned           | Enforcement Mechanism               |
|-------------------------------|--------------------------|-------------------------------------|
| `FullyRetired → Active`       | `AlreadyRetired` (5)     | Guard 1 in `retire_credits`         |
| `FullyRetired → PartiallyRetired` | `AlreadyRetired` (5) | Guard 1 in `retire_credits`         |
| `FullyRetired → FullyRetired` | `AlreadyRetired` (5)     | Guard 1 in `retire_credits`         |
| `Suspended → any retirement`  | `ProjectSuspended` (3)   | Guard 2 in `retire_credits`         |
| `FullyRetired → any transfer` | `AlreadyRetired` (5)     | Guard in `transfer_credits`         |

---

## Proof of Irreversibility

**Claim:** Once `batch.status == FullyRetired`, no execution path in the
`carbon_credit` contract can transition the batch to any other state.

**Proof:**

1. **Single writer rule.** The field `batch.status` is written in exactly two
   places:
   - `mint_credits`: writes `CreditStatus::Active` (initial state only).
   - `retire_credits`: writes `PartiallyRetired` or `FullyRetired`.
   No other function (`transfer_credits`, `upgrade`, `initialize`) writes
   `batch.status`.

2. **Guard 1 short-circuits retire_credits.**  At the top of `retire_credits`,
   before any state mutation:
   ```rust
   if batch.status == CreditStatus::FullyRetired {
       return Err(CarbonError::AlreadyRetired);
   }
   ```
   Since this returns before reaching the `env.storage().persistent().set()`
   call, no write occurs.

3. **mint_credits cannot overwrite.** `mint_credits` checks
   `env.storage().persistent().has(&DataKey::Batch(batch_id))` and returns
   `SerialNumberConflict` if the batch already exists.  A FullyRetired batch
   cannot be re-minted.

4. **No admin escape hatch.** There is no `set_status`, `reset_batch`, or
   `un-retire` function.  The contract has no privileged path that bypasses
   the state machine.

**Therefore:** `FullyRetired` is a terminal absorbing state.  QED.

---

## Guard Assertions (Code)

The following guard assertions in `carbon_credit/src/lib.rs` implement the
state machine:

```rust
// Guard 1: FullyRetired is terminal
if batch.status == CreditStatus::FullyRetired {
    return Err(CarbonError::AlreadyRetired);
}

// Guard 2: Suspended batches cannot be retired
if batch.status == CreditStatus::Suspended {
    return Err(CarbonError::ProjectSuspended);
}

// Guard 3 (implicit): only Active and PartiallyRetired reach this point.
// Any new CreditStatus variant added without updating these guards will be
// caught by the exhaustive match in state_machine_tests::test_all_credit_status_variants_covered().
```

---

## Test Coverage

All state transitions and all CreditStatus variants are covered in
`carbon_credit/src/lib.rs` under `mod state_machine_tests`:

| Test                                              | Transition Verified               |
|---------------------------------------------------|-----------------------------------|
| `test_state_initial_is_active`                    | mint → Active                     |
| `test_state_active_to_partially_retired`          | Active → PartiallyRetired         |
| `test_state_active_to_fully_retired`              | Active → FullyRetired             |
| `test_state_partially_retired_to_fully_retired`   | PartiallyRetired → FullyRetired   |
| `test_state_partially_retired_stays_partially_retired` | PartiallyRetired → PartiallyRetired |
| `test_guard_fully_retired_cannot_be_re_retired`   | FullyRetired → ⊥ (AlreadyRetired) |
| `test_guard_fully_retired_via_two_partials_*`     | FullyRetired → ⊥                  |
| `test_guard_fully_retired_transfer_also_blocked`  | FullyRetired transfer → ⊥         |
| `test_all_credit_status_variants_covered`         | 100% enum variant coverage        |
| `test_state_machine_three_step_retirement`        | Multi-step Active → Full          |

---

## Consequences

- **Positive:** The irreversibility guarantee is formally specified, code-enforced,
  and exhaustively tested.  Auditors and regulators can verify the state machine
  by reading this ADR and the corresponding tests.
- **Positive:** The exhaustive `match` in `test_all_credit_status_variants_covered`
  acts as a compile-time sentinel — adding a new `CreditStatus` variant without
  updating the tests causes a compile error.
- **Negative:** None.  The guards add one conditional check per retirement call,
  which has negligible overhead.

---

## Related ADRs

- ADR-001: Stellar over Ethereum (chain choice)
- ADR-002: Soroban over Stellar Classic (smart contract platform)
- ADR-004: Oracle design (monitoring freshness)
- ADR-005: Off-chain storage (IPFS for certificates)
