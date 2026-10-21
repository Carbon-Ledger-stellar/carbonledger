# Pause Functionality Specification

> **Closes:** #1198  
> **Contracts covered:** `carbon_credit` · `carbon_marketplace`  
> **Status:** Implemented  
> **Last updated:** 2026-09-27

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Goals](#2-design-goals)
3. [State Model](#3-state-model)
4. [State Transitions](#4-state-transitions)
5. [Function Specifications](#5-function-specifications)
   - [5.1 `pause_operations`](#51-pause_operations)
   - [5.2 `unpause_operations`](#52-unpause_operations)
   - [5.3 `require_not_paused` (internal)](#53-require_not_paused-internal)
6. [Event Definitions](#6-event-definitions)
7. [Error Handling](#7-error-handling)
8. [Operations Affected by Pause](#8-operations-affected-by-pause)
9. [Pause Window Constraints](#9-pause-window-constraints)
10. [Auto-Expiry Behavior](#10-auto-expiry-behavior)
11. [Design Rationale](#11-design-rationale)
12. [Security Considerations](#12-security-considerations)
13. [Related Documents](#13-related-documents)

---

## 1. Overview

The CarbonLedger pause mechanism provides an **emergency circuit breaker** for the `carbon_credit` and `carbon_marketplace` Soroban contracts. When activated by an authorized administrator, it immediately halts all state-mutating operations for a bounded time window — up to 72 hours — while an incident is investigated and resolved.

**Core properties:**

- **Time-bounded by design.** Every pause activation requires a future deadline not more than 72 hours ahead. The contract self-heals once the deadline passes, even if an admin is unavailable.
- **Write operations blocked, reads unaffected.** All mutation functions (`mint_credits`, `retire_credits`, `purchase_credits`, etc.) are blocked. Read-only queries (`get_credit_batch`, `get_active_listings`, etc.) continue operating normally.
- **Minimal on-chain footprint.** Pause state is stored in two persistent ledger keys per contract — a boolean flag and a u64 timestamp. No additional storage structures are required.
- **Lazy auto-expiry.** Once the deadline passes, the pause is cleared on the first subsequent write call. There is no background process or cron job.
- **Idempotent unpause.** Calling `unpause_operations` when the contract is already operational succeeds without error.

---

## 2. Design Goals

| Goal | How It Is Met |
|------|--------------|
| Halt all writes in a single on-chain transaction | `pause_operations` sets two storage keys atomically; `require_not_paused` gates every mutating function |
| Prevent indefinite lockout | `until_timestamp` is capped at `now + 72 * 3600`; enforced in `pause_operations` |
| Auto-recover from operator unavailability | `require_not_paused` clears stale pause flags when `until <= now` |
| Restrict activation to authorized operators | Admin role check via `admin.require_auth()` + `require_role` / `require_admin` |
| Preserve read access during incidents | Getter functions do not call `require_not_paused` |
| Minimal gas cost on the hot path | `require_not_paused` reads two small persistent keys (bool + u64), no struct deserialization |
| Durable state across ledger closes | Pause keys stored in `Persistent` storage (not `Temporary`) |
| Deterministic behavior | No timestamps from external sources; all timestamps use `env.ledger().timestamp()` |

---

## 3. State Model

Both `carbon_credit` and `carbon_marketplace` store pause state using exactly two `Persistent` ledger entries per contract:

| Storage Key | Rust Variant | Type | Initial Value | Description |
|-------------|-------------|------|---------------|-------------|
| `PauseEnabled` | `DataKey::PauseEnabled` | `bool` | `false` | Whether the pause flag is currently set |
| `PauseUntil` | `DataKey::PauseUntil` | `u64` | `0` | Unix timestamp (seconds) when the pause expires; `0` means no deadline |

**Initial state** (set during `initialize()`): `PauseEnabled = false`, `PauseUntil = 0`.

These values live in `Persistent` storage, which means they survive across ledger closes and TTL extension cycles. The pause state is durable for the entire duration of the pause window.

### Effective Pause Determination

The *effective* pause state is not simply `PauseEnabled`. A contract is effectively paused only when:

```
is_effectively_paused = (PauseEnabled == true) AND (PauseUntil > env.ledger().timestamp())
```

If `PauseEnabled` is `true` but `PauseUntil ≤ now`, the flag is stale. The contract is not blocking writes — it will auto-clear the flag on the next call to `require_not_paused`. Off-chain callers that read storage keys directly must apply this formula rather than relying on `PauseEnabled` alone.

---

## 4. State Transitions

```
                       pause_operations(admin, until)
                ┌──────────────────────────────────────────┐
                │  guard: admin role, now < until ≤ now+72h │
                ▼                                            │
        ┌───────────────┐                          ┌────────────────┐
        │               │   unpause_operations()   │                │
        │    RUNNING    │◄─────────────────────────│    PAUSED      │
        │               │    (admin role required) │                │
        └───────────────┘                          └────────────────┘
                ▲                                            │
                │   auto-expiry: until ≤ now                │
                │   (triggered by first write call)          │
                └────────────────────────────────────────────┘
```

### Transition Table

| From | To | Trigger | Guards |
|------|----|---------|--------|
| `RUNNING` | `PAUSED` | `pause_operations(admin, until)` | (1) `admin.require_auth()`, (2) Admin role, (3) `now < until ≤ now + 72h` |
| `PAUSED` | `RUNNING` | `unpause_operations(admin)` | (1) `admin.require_auth()`, (2) Admin role |
| `PAUSED` | `RUNNING` | Any write call reaching `require_not_paused` | `until ≤ now` (deadline has passed) |
| `RUNNING` | `RUNNING` | `unpause_operations(admin)` | (1) `admin.require_auth()`, (2) Admin role — succeeds as a no-op |

### Key Invariants

1. `PauseEnabled == false` implies `PauseUntil == 0` after any complete transition.
2. `PauseEnabled == true` implies `PauseUntil > 0`.
3. When `pause_operations` succeeds, `PauseUntil - PauseEnabled_write_time ≤ 72 * 3600`.
4. Reads never trigger a state transition — only write paths call `require_not_paused`.

---

## 5. Function Specifications

### 5.1 `pause_operations`

Activates the emergency pause. Subsequent calls to any state-mutating function will fail with `CarbonError::EmergencyPaused` until the deadline passes or `unpause_operations` is called.

#### Availability

| Contract | Public entry point |
|----------|--------------------|
| `carbon_credit` | ✅ |
| `carbon_marketplace` | ✅ |

#### Signature

```rust
pub fn pause_operations(
    env: Env,
    admin: Address,
    until_timestamp: u64,
) -> Result<(), CarbonError>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban execution environment (injected by runtime) |
| `admin` | `Address` | The contract administrator address. The invoking transaction must be authorized by this address. |
| `until_timestamp` | `u64` | Unix epoch timestamp (seconds) at which the pause automatically expires. Must satisfy: `env.ledger().timestamp() < until_timestamp ≤ env.ledger().timestamp() + 259200`. |

#### Authorization

- `admin.require_auth()` is called first — if the transaction is not signed by `admin`, Soroban panics before any other check.
- The `admin` address must hold the `Admin` role:
  - **`carbon_credit`:** `require_role(&env, &admin, Role::Admin)` → `Err(CarbonError::Unauthorized)` if not held.
  - **`carbon_marketplace`:** `require_admin(&env, &admin)` → `Err(CarbonError::Unauthorized)` if not matched.

#### Preconditions (checked in order)

1. `admin.require_auth()` — Soroban authorization must succeed (panics on failure).
2. Admin role check — caller must hold Admin role (`Err(Unauthorized)` on failure).
3. `until_timestamp > now` — deadline must be strictly in the future (`Err(InvalidPauseWindow)`).
4. `until_timestamp ≤ now + 259200` — deadline must not exceed 72 hours (`Err(InvalidPauseWindow)`).

#### Postconditions (on success)

```
DataKey::PauseEnabled  →  true
DataKey::PauseUntil    →  until_timestamp
```

All subsequent invocations of mutating functions will return `Err(CarbonError::EmergencyPaused)` until `until_timestamp ≤ env.ledger().timestamp()` or `unpause_operations` is called.

#### Returns

- `Ok(())` — pause activated successfully.
- `Err(CarbonError::InvalidPauseWindow)` — `until_timestamp` fails the window constraint.
- `Err(CarbonError::Unauthorized)` — caller does not hold the Admin role.
- Soroban auth panic — `admin.require_auth()` failed (transaction not signed by admin).

#### Implementation note

The window constraint uses `saturating_add` to avoid u64 overflow:

```rust
let now = env.ledger().timestamp();
let max_until = now.saturating_add(72 * 60 * 60);
if until_timestamp <= now || until_timestamp > max_until {
    return Err(CarbonError::InvalidPauseWindow);
}
```

---

### 5.2 `unpause_operations`

Immediately clears the emergency pause, restoring full contract functionality. This function is **idempotent**: calling it when the contract is already unpaused — or when the pause has already auto-expired — succeeds without error.

#### Availability

| Contract | Public entry point |
|----------|--------------------|
| `carbon_credit` | ✅ |
| `carbon_marketplace` | ✅ |

#### Signature

```rust
pub fn unpause_operations(
    env: Env,
    admin: Address,
) -> Result<(), CarbonError>
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban execution environment |
| `admin` | `Address` | The contract administrator address. Transaction must be authorized by this address. |

#### Authorization

Same as `pause_operations`: `admin.require_auth()` then Admin role check.

#### Preconditions

1. `admin.require_auth()` — panics if the transaction is not signed by admin.
2. Admin role check — `Err(Unauthorized)` if not held.

#### Postconditions (on success)

```
DataKey::PauseEnabled  →  false
DataKey::PauseUntil    →  0
```

This is unconditional — the keys are written regardless of whether the contract was actually paused.

#### Returns

- `Ok(())` — always (subject to auth checks passing).
- `Err(CarbonError::Unauthorized)` — caller does not hold the Admin role.
- Soroban auth panic — transaction not signed by admin.

---

### 5.3 `require_not_paused` (internal)

Internal guard function. Called at the top of every state-mutating public function before any business logic executes.

**Not a public entry point.** Cannot be invoked by external callers.

#### Signature

```rust
fn require_not_paused(env: &Env) -> Result<(), CarbonError>
```

#### Implementation

```rust
fn require_not_paused(env: &Env) -> Result<(), CarbonError> {
    let paused: bool = env
        .storage()
        .persistent()
        .get(&DataKey::PauseEnabled)
        .unwrap_or(false);

    let until: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::PauseUntil)
        .unwrap_or(0u64);

    let now = env.ledger().timestamp();

    if paused && until > now {
        // Pause is active — block the operation
        return Err(CarbonError::EmergencyPaused);
    }

    if paused && until <= now {
        // Pause has expired — clear stale flags (auto-expiry)
        env.storage().persistent().set(&DataKey::PauseEnabled, &false);
        env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
    }

    Ok(())
}
```

#### Behavior Table

| `PauseEnabled` | `PauseUntil` vs `now` | Keys absent? | Result |
|----------------|----------------------|-------------|--------|
| `false` | — | — | `Ok(())` — proceed |
| `true` | `until > now` | — | `Err(EmergencyPaused)` |
| `true` | `until ≤ now` | — | Clear both keys → `Ok(())` |
| — | — | Yes | Default `false` / `0` → `Ok(())` |

---

## 6. Event Definitions

The current implementation does **not emit Soroban contract events** for `pause_operations` or `unpause_operations`.

This is intentional — see [§11.3 Why no events?](#113-why-no-events) for the rationale.

**Off-chain monitoring approaches:**

1. **Poll the REST API.** `GET /api/v1/contract/status` returns the effective pause state derived from current storage keys and ledger timestamp.
2. **Read storage keys directly.** Use `stellar contract read` or the Soroban RPC `getLedgerEntry` to read `DataKey::PauseEnabled` and `DataKey::PauseUntil`.
3. **Scan Stellar transaction history.** Invocations of `pause_operations` and `unpause_operations` appear in Horizon transaction records. Use the Horizon API to filter by contract ID and function name.
4. **Webhook notifications.** The backend emits webhook events (`contract.paused`, `contract.unpaused`) when it proxies pause/unpause calls. See [Pause Webhook Events](pause-webhook-events.md).

**Planned future work:** A separate issue may introduce on-chain `OperationsPaused` and `OperationsUnpaused` events with `(admin: Address, until_timestamp: u64)` payload to improve observability for direct Soroban consumers.

---

## 7. Error Handling

### Error codes

| Error | `carbon_credit` code | `carbon_marketplace` code | HTTP equivalent | Condition |
|-------|---------------------|--------------------------|----------------|-----------|
| `EmergencyPaused` | 29 | 27 | 409 / 423 | A mutating function was called while the pause is active |
| `InvalidPauseWindow` | 28 | 26 | 400 | `until_timestamp` violates `(now, now + 72h]` constraint |
| `Unauthorized` | 30 | varies | 403 | Caller does not hold the Admin role |

### Error flows

**`pause_operations` call:**

```
caller → pause_operations(admin, until_timestamp)
    │
    ├── admin.require_auth() fails
    │       └── Soroban panics (auth error)
    │
    ├── require_role(Admin) fails
    │       └── Err(Unauthorized)  [code 30]
    │
    ├── until_timestamp ≤ now
    │       └── Err(InvalidPauseWindow)  [code 28/26]
    │
    ├── until_timestamp > now + 72h
    │       └── Err(InvalidPauseWindow)  [code 28/26]
    │
    └── All guards pass
            └── PauseEnabled=true, PauseUntil=until_timestamp → Ok(())
```

**Write call while paused:**

```
caller → mint_credits(...)  (or any other mutating function)
    │
    └── require_not_paused(&env)
            │
            ├── PauseEnabled=true, PauseUntil > now
            │       └── Err(EmergencyPaused)  [code 29/27]
            │
            ├── PauseEnabled=true, PauseUntil ≤ now
            │       └── clear flags → Ok(())  (auto-expiry)
            │               └── function continues normally
            │
            └── PauseEnabled=false
                    └── Ok(())  (function continues normally)
```

### Client handling guidelines

| Error code | Recommended client action |
|-----------|--------------------------|
| `EmergencyPaused` (29/27) | Surface a user-facing "service temporarily unavailable" message. Poll `/contract/status` and retry when `isPaused` is `false`. Do not treat as a permanent failure. |
| `InvalidPauseWindow` (28/26) | Fix the `until_timestamp` argument. Use a value strictly in `(now, now + 259200]`. |
| `Unauthorized` (30) | Verify that the signing key holds the Admin role. Do not retry with the same key. |

---

## 8. Operations Affected by Pause

### `carbon_credit` contract

Functions that call `require_not_paused` (blocked while paused):

| Function | Purpose |
|----------|---------|
| `mint_credits` | Mint a new credit batch for a verified project |
| `retire_credits` | Permanently retire credits on-chain |
| `transfer_credits` | Transfer credits between accounts |
| `set_verified_periods` | Set oracle-verified monitoring periods |
| `set_vintage_year_bounds` | Update valid vintage year range |

Functions that are **NOT** blocked by pause (reads):

| Function | Reason unblocked |
|----------|-----------------|
| `get_credit_batch` | Read-only query |
| `get_retirement_certificate` | Read-only query |
| `get_oracle_contract` | Read-only query |
| `get_project_batch_count` | Read-only query |
| `verify_serial_range` | Read-only check |
| `initialize` | Initialization only runs once; pause state is set after init |

### `carbon_marketplace` contract

Functions that call `require_not_paused` (blocked while paused):

| Function | Purpose |
|----------|---------|
| `list_credits` | Create a new marketplace listing |
| `delist_credits` | Remove an active listing |
| `purchase_credits` | Purchase credits from a listing |
| `bulk_purchase` | Multi-listing corporate purchase |
| `set_vintage_year_bounds` | Update valid vintage year range |

Functions that are **NOT** blocked by pause (reads):

| Function | Reason unblocked |
|----------|-----------------|
| `get_active_listings` | Read-only query |
| `get_listings_by_vintage` | Read-only query |
| `get_listing` | Read-only query |

---

## 9. Pause Window Constraints

The maximum allowed pause duration is **72 hours** (259,200 seconds).

### Constraint enforcement

Validated in `pause_operations` using `saturating_add` to prevent u64 overflow:

```rust
let now = env.ledger().timestamp();          // current ledger time
let max_until = now.saturating_add(72 * 60 * 60);  // now + 72h, saturates at u64::MAX

if until_timestamp <= now || until_timestamp > max_until {
    return Err(CarbonError::InvalidPauseWindow);
}
```

### Valid range

```
now < until_timestamp ≤ now + 259200
```

| Boundary | Behaviour |
|----------|-----------|
| `until_timestamp ≤ now` | Rejected — deadline must be strictly in the future |
| `until_timestamp == now + 1` | Valid — 1-second pause (useful for testing) |
| `until_timestamp == now + 259200` | Valid — maximum 72-hour pause |
| `until_timestamp > now + 259200` | Rejected — exceeds 72-hour cap |

### Why 72 hours?

- Provides sufficient time for: incident triage, fix preparation, coordinated comms, and deployment of a fix (if needed).
- Prevents accidental or malicious indefinite lockout.
- Ensures the contract self-recovers without requiring admin action if the pause is forgotten.
- Aligns with industry norms for emergency circuit breaker windows in DeFi protocols.

### Minimum pause duration

There is no enforced minimum. A 1-second pause is valid. In practice, there is no useful scenario for a sub-minute pause in production, but the constraint is intentionally permissive to allow integration testing.

---

## 10. Auto-Expiry Behavior

### Mechanism

The pause does not expire on a schedule or at a Stellar ledger boundary. It expires **lazily** — on the first call to `require_not_paused` after `PauseUntil ≤ now`.

The auto-expiry path in `require_not_paused`:

```rust
if paused && until <= now {
    env.storage().persistent().set(&DataKey::PauseEnabled, &false);
    env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
    // returns Ok(()) — the calling function proceeds normally
}
```

### Implications

**For on-chain state:** Between the `PauseUntil` timestamp and the first post-deadline write call, the contract storage shows `PauseEnabled = true`. This is a **stale flag** — the contract is not effectively paused and will succeed on write. The flag is cleared on the next write call.

**For off-chain monitoring:** Reading `PauseEnabled` directly from storage is not sufficient — always compare `PauseUntil` against the current time:

```javascript
// Correct effective pause check
const isEffectivelyPaused = status.isPaused && (status.pauseUntil > Math.floor(Date.now() / 1000));
```

The REST API `GET /api/v1/contract/status` applies this formula and returns a correct `isPaused` value.

**For read-only callers:** Read functions (`get_credit_batch`, `get_active_listings`, etc.) do **not** call `require_not_paused`. Calling these functions after the pause deadline passes will **not** trigger auto-expiry. The stale flag persists until a write operation is called.

**For retry logic:** Clients polling for operational status should check `isPaused` and compare `pauseUntil` against current time. Once `pauseUntil < now`, clients can attempt write operations immediately — they will succeed.

---

## 11. Design Rationale

### 11.1 Why time-bounded rather than indefinite?

An indefinite pause creates a single point of failure: if the admin key is lost, compromised, or the admin is incapacitated, the contract is permanently locked. A time-bounded pause ensures the system self-heals even in the worst case.

The 72-hour cap was chosen to balance:
- **Sufficient time** for most incident response workflows (identify, investigate, patch, coordinate, deploy).
- **Upper bound on lockout** for legitimate users who cannot transact during a pause.

If 72 hours is insufficient for a specific incident, an admin can re-pause the contract for another 72-hour window after the first expires.

### 11.2 Why two separate storage keys instead of a struct?

A `PauseState { enabled: bool, until: u64 }` struct approach would require:
1. Reading the full struct on every call to `require_not_paused`.
2. Deserializing the struct (ScVal → Rust struct) on every call.

`require_not_paused` is called at the top of every state-mutating function in both contracts. The two-key approach reduces this to two independent small reads with `unwrap_or` defaults — no deserialization overhead.

The tradeoff is two write operations per pause/unpause call instead of one. Since pause/unpause are rare administrative operations, write cost is irrelevant. Read cost on the hot path matters.

### 11.3 Why no events?

Soroban contract events incur on-chain storage costs (events are archived in the ledger). During an emergency pause:
- The mechanism must be as lean as possible — every XLM spent on non-essential ledger data during an incident is waste.
- The admin is already submitting a transaction; the transaction itself is the audit record.
- Stellar's Horizon API provides a complete, queryable history of all contract invocations without requiring explicit events.

The decision to omit events also avoids a subtle failure mode: if event emission somehow fails or exceeds storage limits, it must not prevent the pause from activating.

### 11.4 Why `Persistent` storage?

Soroban has three storage tiers:
- **Temporary** — cleared between transactions (no good).
- **Instance** — tied to the contract instance, could be cleared by TTL expiry.
- **Persistent** — survives across TTL cycles with explicit extension.

The pause state must survive across ledger closes for the full duration of the pause window (up to 72 hours). `Persistent` storage with appropriate TTL extension is the only tier that guarantees this. The backend monitors storage TTLs and extends them as part of normal operations.

### 11.5 Why lazy auto-expiry rather than scheduled?

Soroban does not have native scheduled execution (no "run this function at time T" primitive). Emulating it would require an off-chain keeper service — a new operational dependency that could itself fail during an incident.

Lazy expiry requires no external components. The contract auto-heals on the next organic call, which is acceptable because:
- The deadline is enforced conservatively (reads don't trigger expiry).
- The REST API correctly computes effective pause state at query time.
- Any legitimate write operation after the deadline succeeds, clearing the stale flag as a side effect.

### 11.6 Why no minimum pause duration?

A minimum floor (e.g. 5 minutes) would add complexity without benefit. Admins can already issue a follow-up `unpause_operations` immediately after `pause_operations` if a test pause was accidental. Enforcing a minimum would make test workflows awkward.

---

## 12. Security Considerations

### Authorization model

Only accounts holding the `Admin` role can activate or lift a pause. The Admin role is set at contract initialization and can only be rotated by the current admin. There is no ability for a Verifier or Oracle role to trigger a pause.

Both `pause_operations` and `unpause_operations` call `admin.require_auth()` as their first action. Soroban's auth model ensures the call fails atomically if the transaction is not signed by the admin's keypair — no partial state change is possible.

### Key compromise scenario

If the admin key is compromised and an attacker calls `pause_operations`, the maximum impact is a 72-hour pause. The attacker cannot pause indefinitely. The correct response is:

1. Observe the pause (alert fires on state change).
2. Wait for the 72-hour window to expire **or** rotate to a backup admin key and call `unpause_operations`.
3. Rotate the compromised admin key via the `set_admin` or equivalent role-management function.

See [Key Rotation Procedures](KEY_ROTATION_PROCEDURES.md) for the full runbook.

### DoS via repeated pauses

An attacker with the admin key could repeatedly re-pause the contract every 72 hours, causing sustained denial of service. Mitigations:
- Admin key should be held in a hardware security module (HSM) or multi-sig threshold wallet.
- Anomalous pause patterns should trigger automated alerts.
- The upcoming multisig upgrade governance (see ADR-007) will require M-of-N signatures for pause activation above a configurable duration threshold.

### Read-only bypass

Read functions deliberately bypass the pause. This is by design — querying credit batches, marketplace listings, and retirement certificates should always be available so users can see their holdings and plan responses during an incident. No sensitive state mutation can occur through read-only functions.

### Re-entrancy guard interaction

The re-entrancy guard (`ReentrancyDetected`, error 31 in `carbon_credit`) is orthogonal to the pause mechanism. Both `require_not_paused` and the re-entrancy lock are checked independently at the start of each mutating function. A paused contract with the re-entrancy lock set is still paused — the first check (`require_not_paused`) returns `EmergencyPaused` before the re-entrancy check is reached.

---

## 13. Related Documents

| Document | Description |
|----------|-------------|
| [Pause API Reference](pause-api-reference.md) | Complete function signatures, parameter tables, Stellar CLI examples |
| [Pause Operations Tutorial](tutorials/pause-operations-tutorial.md) | Developer guide for integrating pause handling in client applications |
| [Pause SDK Examples](sdk-examples/pause-integration-examples.md) | JS, Python, Go SDK code examples for all pause operations |
| [Postman Collection](postman/README.md) | Import and run all 4 pause endpoints in Postman |
| [ADR-013: Emergency Pause Mechanism](adr/ADR-013-emergency-pause.md) | Architecture decision record for the pause feature |
| [Pause Security Analysis](pause-security-analysis.md) | Threat model, attack vectors, and mitigations |
| [Access Control Policy](access-control.md) | Role definitions, assignment, and authorization patterns |
| [Error Code Reference](error-codes.md) | Complete listing of all contract error codes |
| [Key Rotation Procedures](KEY_ROTATION_PROCEDURES.md) | Runbook for admin key compromise and rotation |
| [Pause Webhook Events](pause-webhook-events.md) | Off-chain webhook events emitted by the backend |
