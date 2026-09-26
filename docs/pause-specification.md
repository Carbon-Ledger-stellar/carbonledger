# Pause Mechanism Specification

> **Contracts covered:** `carbon_credit`, `carbon_marketplace`  
> **Last updated:** 2026-09-25  
> **Closes:** #1288

---

## Table of Contents

- [Overview](#overview)
- [Design Goals](#design-goals)
- [State Model](#state-model)
- [State Transitions](#state-transitions)
- [Function Specifications](#function-specifications)
- [Event Definitions](#event-definitions)
- [Error Handling](#error-handling)
- [Pause Window Constraints](#pause-window-constraints)
- [Auto-Expiry Behavior](#auto-expiry-behavior)
- [Design Rationale](#design-rationale)
- [Operations Affected by Pause](#operations-affected-by-pause)
- [Related Documents](#related-documents)

---

## Overview

The CarbonLedger pause mechanism provides an **emergency circuit breaker** for the `carbon_credit` and `carbon_marketplace` Soroban contracts. When activated, it halts all state-mutating operations for a bounded time window, preventing further writes until the pause expires or an administrator explicitly lifts it.

The pause is **time-bounded by design**: every activation requires a future deadline no more than 72 hours ahead. This prevents indefinite operational lockouts and ensures the system can recover from a forgotten pause without requiring any action.

---

## Design Goals

| Goal | Implementation |
|------|----------------|
| Protect against active exploits | Block all state writes immediately on activation |
| Prevent indefinite lockout | Hard maximum of 72 hours per pause window |
| Auto-recover from forgotten pauses | `require_not_paused` clears state once deadline passes |
| Restrict to authorized operators | Admin role required for all pause operations |
| Minimal on-chain storage | Two persistent keys: `PauseEnabled` (bool) + `PauseUntil` (u64) |
| Read operations unaffected | Queries are never blocked by pause state |

---

## State Model

Both `carbon_credit` and `carbon_marketplace` store pause state in two `Persistent` ledger entries:

| Storage Key | Type | Purpose |
|-------------|------|---------|
| `DataKey::PauseEnabled` | `bool` | Whether the contract is currently paused |
| `DataKey::PauseUntil` | `u64` | Unix timestamp (seconds) of when the pause expires |

**Initial state** after `initialize()`: `PauseEnabled = false`, `PauseUntil = 0`.

The state is stored in `Persistent` storage, meaning it survives ledger entry TTL extension cycles and is not ephemeral. The pause persists across transactions until it expires or is explicitly cleared.

---

## State Transitions

```
                       pause_operations(admin, until)
                ┌──────────────────────────────────────┐
                │         [now < until ≤ now+72h]       │
                ▼                                        │
        ┌───────────────┐                        ┌───────────────┐
        │               │  unpause_operations()  │               │
        │    RUNNING    │◄───────────────────────│    PAUSED     │
        │               │      (admin only)      │               │
        └───────────────┘                        └───────────────┘
                ▲                                        │
                │       deadline reached (until ≤ now)  │
                └───────────────────────────────────────┘
                         (auto-cleared on next call to
                          require_not_paused)
```

### Transition Rules

| From | To | Trigger | Guard |
|------|----|---------|-------|
| RUNNING | PAUSED | `pause_operations(admin, until)` | Admin role, `now < until ≤ now + 72h` |
| PAUSED | RUNNING | `unpause_operations(admin)` | Admin role |
| PAUSED | RUNNING | Any call via `require_not_paused` | `until ≤ now` (auto-expiry) |
| RUNNING | RUNNING | `unpause_operations(admin)` | Admin role (idempotent — clears stale keys) |

---

## Function Specifications

### `pause_operations`

Activates the emergency pause for the contract.

```rust
pub fn pause_operations(
    env: Env,
    admin: Address,
    until_timestamp: u64,
) -> Result<(), CarbonError>
```

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban execution environment |
| `admin` | `Address` | Must be the configured Admin; transaction must be authorized by this address |
| `until_timestamp` | `u64` | Unix timestamp (seconds) when pause automatically expires |

**Preconditions**

1. `admin.require_auth()` — Soroban authorization check must pass.
2. `admin` must hold the `Admin` role (verified via `require_role` / `require_admin`).
3. `until_timestamp > env.ledger().timestamp()` — deadline must be in the future.
4. `until_timestamp ≤ env.ledger().timestamp() + 72 * 3600` — deadline must be within 72 hours.

**Postconditions**

- `DataKey::PauseEnabled` is set to `true`.
- `DataKey::PauseUntil` is set to `until_timestamp`.
- All subsequent calls that invoke `require_not_paused` will return `CarbonError::EmergencyPaused` until the deadline passes or `unpause_operations` is called.

**Returns**

`Ok(())` on success. Returns `CarbonError` variants on failure (see [Error Handling](#error-handling)).

---

### `unpause_operations`

Clears the emergency pause immediately, regardless of remaining time.

```rust
pub fn unpause_operations(
    env: Env,
    admin: Address,
) -> Result<(), CarbonError>
```

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban execution environment |
| `admin` | `Address` | Must be the configured Admin; transaction must be authorized |

**Preconditions**

1. `admin.require_auth()` — authorization check must pass.
2. `admin` must hold the `Admin` role.

**Postconditions**

- `DataKey::PauseEnabled` is set to `false`.
- `DataKey::PauseUntil` is set to `0`.
- All subsequent calls will proceed normally (subject to other checks).

**Returns**

`Ok(())` on success. This function is **idempotent**: calling it when the contract is already unpaused succeeds without error.

---

### `require_not_paused` (Internal)

Internal guard function called at the entry point of every state-mutating operation.

```rust
fn require_not_paused(env: &Env) -> Result<(), CarbonError>
```

**Behavior**

1. Read `PauseEnabled` from persistent storage (defaults to `false` if absent).
2. Read `PauseUntil` from persistent storage (defaults to `0` if absent).
3. Read `env.ledger().timestamp()` as `now`.
4. If `paused && until > now` → return `Err(CarbonError::EmergencyPaused)`.
5. If `paused && until <= now` → **auto-expire**: write `PauseEnabled = false` and `PauseUntil = 0`, then return `Ok(())`.
6. Otherwise → return `Ok(())`.

This function is never exposed as a public entry point; it is always called internally before any write operation proceeds.

---

## Event Definitions

The current implementation does **not emit events** for `pause_operations` or `unpause_operations`. This is intentional — see [Design Rationale](#design-rationale).

Off-chain monitoring should rely on polling the `PauseEnabled` storage key or tracking invocations of these functions through Stellar's transaction history.

> **Future work:** A separate issue may introduce `OperationsPaused` and `OperationsUnpaused` contract events with `(admin, until_timestamp)` payload to improve observability.

---

## Error Handling

| Error | Code (carbon_credit) | Code (carbon_marketplace) | Condition |
|-------|---------------------|--------------------------|-----------|
| `EmergencyPaused` | 29 | 27 | A state-mutating operation was attempted while the contract is actively paused |
| `InvalidPauseWindow` | 28 | 26 | `until_timestamp` is not strictly in the future or exceeds now + 72 hours |
| `Unauthorized` / `UnauthorizedVerifier` | 30 | varies | Caller does not hold the Admin role |

### Error Flow

```
caller → pause_operations(admin, until_timestamp)
              │
              ├── admin.require_auth() fails → panic (Soroban auth error)
              ├── require_role(Admin) fails → Err(Unauthorized)
              ├── until_timestamp <= now → Err(InvalidPauseWindow)
              ├── until_timestamp > now + 72h → Err(InvalidPauseWindow)
              └── Ok → writes PauseEnabled=true, PauseUntil=until_timestamp
```

```
any_state_mutating_call()
              │
              └── require_not_paused()
                        │
                        ├── paused=true, until > now → Err(EmergencyPaused)
                        ├── paused=true, until <= now → clear + Ok
                        └── paused=false → Ok
```

---

## Pause Window Constraints

The maximum pause duration is **72 hours** (259,200 seconds).

This constraint is enforced in `pause_operations`:

```rust
let now = env.ledger().timestamp();
if until_timestamp <= now || until_timestamp > now.saturating_add(72 * 60 * 60) {
    return Err(CarbonError::InvalidPauseWindow);
}
```

**Rationale for 72-hour cap:**
- Provides enough time for incident investigation and coordinated response.
- Prevents accidental or malicious indefinite lockout.
- Ensures the contract self-recovers without requiring admin action if the incident is resolved before the deadline.

**Minimum pause duration:** Any value in `(now, now + 72h]` is valid. There is no enforced minimum — an admin can set a 1-second pause for testing, though this has no practical effect in production.

---

## Auto-Expiry Behavior

The auto-expiry mechanism triggers lazily on the **first state-mutating call after the deadline passes**. It does not run on a schedule or at block boundaries.

**Implications:**

1. Between the deadline and the first post-deadline call, the on-chain state still shows `PauseEnabled = true`. This is a stale flag, not an active pause — `require_not_paused` will clear it on the next call.
2. Off-chain monitoring that reads `PauseEnabled` directly must also check `PauseUntil` against the current ledger time to determine effective pause state.
3. Calling `get_credit_batch`, `get_active_listings`, or any read-only function does **not** trigger auto-expiry because those functions do not call `require_not_paused`.

**Effective pause state formula:**

```
is_effectively_paused = PauseEnabled == true && PauseUntil > ledger.timestamp()
```

---

## Operations Affected by Pause

### `carbon_credit` contract

The following functions call `require_not_paused` and will fail with `EmergencyPaused` while the pause is active:

| Function | Purpose |
|----------|---------|
| `mint_credits` | Minting new credit batches |
| `retire_credits` | Permanently retiring credits |
| `transfer_credits` | Transferring credits between accounts |
| `set_verified_periods` | Setting oracle-verified periods for a project |
| `set_vintage_year_bounds` | Updating valid vintage year range |

Read-only functions (`get_credit_batch`, `get_retirement_certificate`, `get_oracle_contract`, etc.) are **not** affected by pause state.

### `carbon_marketplace` contract

The following functions call `require_not_paused`:

| Function | Purpose |
|----------|---------|
| `list_credits` | Creating new marketplace listings |
| `delist_credits` | Removing active listings |
| `purchase_credits` | Purchasing credits from a listing |
| `bulk_purchase` | Multi-listing corporate purchases |
| `set_vintage_year_bounds` | Updating valid vintage year range |

Read-only functions (`get_active_listings`, `get_listings_by_vintage`, `get_listing`, etc.) are **not** affected.

---

## Design Rationale

### Why time-bounded rather than indefinite?

An indefinite pause is a single point of failure: if the admin key is lost or the admin is unavailable, the contract could be permanently locked. A time-bounded pause self-heals, reducing operational risk.

### Why no events?

Events in Soroban have an on-chain storage cost. During an emergency pause, the goal is to minimize ledger operations and keep the mechanism lean. Transaction history on Stellar provides adequate audit trail for pause/unpause invocations without dedicated events.

### Why store pause state in Persistent storage?

Temporary storage is cleared between transactions. The pause state must survive across transactions and ledger closes. Persistent storage with appropriate TTL extension ensures the pause state is durable for the duration of the window.

### Why two storage keys instead of a struct?

Writing individual keys avoids deserializing a full struct on every call to `require_not_paused`. Reading two small values is cheaper than reading and deserializing a struct, which matters because `require_not_paused` is called at the start of every state-mutating function.

---

## Related Documents

- [Pause API Reference](pause-api-reference.md) — Full function signatures and parameter details
- [Pause Security Analysis](pause-security-analysis.md) — Threat model and risk mitigation
- [ADR-013: Emergency Pause Mechanism](adr/ADR-013-emergency-pause.md) — Architecture decision record
- [Error Code Reference](error-codes.md) — All contract error codes
- [Access Control Policy](access-control.md) — Role definitions and authorization
- [Contract Events Reference](contract-events.md) — All emitted contract events
