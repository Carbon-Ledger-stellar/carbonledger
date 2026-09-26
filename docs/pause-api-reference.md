# Pause API Reference

> **Contracts:** `carbon_credit`, `carbon_marketplace`  
> **Last updated:** 2026-09-25  
> **Closes:** #1289

This reference documents all Soroban contract functions related to the pause mechanism, including function signatures, parameters, return values, and error codes.

---

## Table of Contents

- [pause_operations](#pause_operations)
- [unpause_operations](#unpause_operations)
- [get_pause_status](#get_pause_status)
- [require_not_paused (internal)](#require_not_paused-internal)
- [Error Codes](#error-codes)
- [Storage Keys](#storage-keys)
- [Stellar CLI Examples](#stellar-cli-examples)

---

## `pause_operations`

Activates the emergency pause for the contract. All state-mutating operations will return `EmergencyPaused` until the pause expires or `unpause_operations` is called.

### Availability

| Contract | Entry point |
|----------|------------|
| `carbon_credit` | ✅ Yes |
| `carbon_marketplace` | ✅ Yes |

### Signature

```rust
pub fn pause_operations(
    env: Env,
    admin: Address,
    until_timestamp: u64,
) -> Result<(), CarbonError>
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `env` | `Env` | auto | Soroban execution environment (injected by the runtime) |
| `admin` | `Address` | Yes | Address of the contract administrator. The transaction must be signed by this address. |
| `until_timestamp` | `u64` | Yes | Unix epoch timestamp (seconds) when the pause automatically expires. Must be strictly greater than the current ledger timestamp and no more than 72 hours (259,200 seconds) in the future. |

### Authorization

- Requires `admin.require_auth()` — the transaction must include a valid Soroban authorization for this address.
- Requires the `Admin` role in `carbon_credit` (checked via `require_role(&env, &admin, Role::Admin)`).
- Requires admin match in `carbon_marketplace` (checked via `require_admin(&env, &admin)`).

### Return Values

| Value | Condition |
|-------|-----------|
| `Ok(())` | Pause was successfully activated |
| `Err(CarbonError::InvalidPauseWindow)` | `until_timestamp` is not in the valid window: `(now, now + 72h]` |
| `Err(CarbonError::Unauthorized)` | Caller does not hold the Admin role (`carbon_credit`) |
| Soroban auth panic | `admin.require_auth()` failed — transaction not signed by admin |

### Side Effects

On success, the following persistent storage keys are written:

```
DataKey::PauseEnabled  → true
DataKey::PauseUntil    → until_timestamp
```

### Constraints

```
now < until_timestamp ≤ now + 259200
```

Where `now = env.ledger().timestamp()` at the time of the call. The constraint is evaluated using `saturating_add` to prevent u64 overflow.

### Example — Stellar CLI

```bash
# Pause carbon_credit for 4 hours from now
# until_timestamp = $(date -d '+4 hours' +%s)  (Linux)
# until_timestamp = $(date -v+4H +%s)          (macOS)
UNTIL=$(date -d '+4 hours' +%s)

stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp "$UNTIL"
```

```bash
# Pause carbon_marketplace for 8 hours
UNTIL=$(date -d '+8 hours' +%s)

stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp "$UNTIL"
```

---

## `unpause_operations`

Immediately clears the emergency pause, restoring full contract functionality. This function is idempotent — calling it on an already-unpaused contract succeeds without error.

### Availability

| Contract | Entry point |
|----------|------------|
| `carbon_credit` | ✅ Yes |
| `carbon_marketplace` | ✅ Yes |

### Signature

```rust
pub fn unpause_operations(
    env: Env,
    admin: Address,
) -> Result<(), CarbonError>
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `env` | `Env` | auto | Soroban execution environment (injected by the runtime) |
| `admin` | `Address` | Yes | Address of the contract administrator. The transaction must be signed by this address. |

### Authorization

- Requires `admin.require_auth()`.
- Requires the `Admin` role (`carbon_credit`) or admin match (`carbon_marketplace`).

### Return Values

| Value | Condition |
|-------|-----------|
| `Ok(())` | Pause was cleared (or was already cleared — idempotent) |
| `Err(CarbonError::Unauthorized)` | Caller does not hold the Admin role |
| Soroban auth panic | Transaction not signed by admin |

### Side Effects

On success:

```
DataKey::PauseEnabled  → false
DataKey::PauseUntil    → 0
```

### Example — Stellar CLI

```bash
# Immediately unpause carbon_credit
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

```bash
# Immediately unpause carbon_marketplace
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

---

## `get_pause_status`

> **Note:** `get_pause_status` is not yet a public contract entry point. Pause state must currently be queried by reading the storage keys directly or by inferring from the current ledger timestamp.

### Querying Pause State via Storage (Current Method)

Until a dedicated `get_pause_status` function is added, pause state can be determined off-chain by reading storage keys and comparing against the current ledger time:

**Using Stellar CLI:**

```bash
# Read PauseEnabled key
stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseEnabled

# Read PauseUntil key
stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseUntil
```

**Effective pause determination:**

```
is_effectively_paused = (PauseEnabled == true) AND (PauseUntil > current_ledger_timestamp)
```

Even if `PauseEnabled` is `true`, the contract is **not** effectively paused if `PauseUntil ≤ current_ledger_timestamp`. The flag is stale and will be cleared automatically on the next state-mutating call.

### Planned Signature

When implemented, `get_pause_status` is expected to have the following signature:

```rust
pub fn get_pause_status(env: Env) -> PauseStatus
```

Where `PauseStatus` would be:

```rust
#[contracttype]
pub struct PauseStatus {
    /// Whether the pause flag is set in storage
    pub paused: bool,
    /// Epoch timestamp when pause expires (0 if not paused)
    pub until_timestamp: u64,
    /// Whether the pause is currently effective (paused && until > now)
    pub is_active: bool,
}
```

This function would require no authorization and would be safe to call at any time.

---

## `require_not_paused` (Internal)

This is an internal helper function — it is not a public contract entry point and cannot be invoked directly. It is documented here for contract developers and auditors.

### Signature

```rust
fn require_not_paused(env: &Env) -> Result<(), CarbonError>
```

### Implementation

```rust
fn require_not_paused(env: &Env) -> Result<(), CarbonError> {
    let paused: bool = env.storage().persistent()
        .get(&DataKey::PauseEnabled)
        .unwrap_or(false);
    let until: u64 = env.storage().persistent()
        .get(&DataKey::PauseUntil)
        .unwrap_or(0);
    let now = env.ledger().timestamp();
    if paused && until > now {
        return Err(CarbonError::EmergencyPaused);
    }
    if paused && until <= now {
        // Auto-expire: clear stale pause flags
        env.storage().persistent().set(&DataKey::PauseEnabled, &false);
        env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
    }
    Ok(())
}
```

### Behavior

| Condition | Result |
|-----------|--------|
| `paused = false` | Returns `Ok(())` immediately |
| `paused = true`, `until > now` | Returns `Err(EmergencyPaused)` |
| `paused = true`, `until ≤ now` | Clears `PauseEnabled` and `PauseUntil`, returns `Ok(())` |
| Keys absent from storage | Defaults to `paused = false`, `until = 0` → returns `Ok(())` |

### Functions That Call `require_not_paused`

#### `carbon_credit`

| Function | Paused behavior |
|----------|----------------|
| `mint_credits` | Blocked |
| `retire_credits` | Blocked |
| `transfer_credits` | Blocked |
| `set_verified_periods` | Blocked |
| `set_vintage_year_bounds` | Blocked |

#### `carbon_marketplace`

| Function | Paused behavior |
|----------|----------------|
| `list_credits` | Blocked |
| `delist_credits` | Blocked |
| `purchase_credits` | Blocked |
| `bulk_purchase` | Blocked |
| `set_vintage_year_bounds` | Blocked |

### Functions That Are NOT Blocked by Pause

All read-only query functions bypass `require_not_paused`. This includes:

- `carbon_credit`: `get_credit_batch`, `get_retirement_certificate`, `get_oracle_contract`, `get_project_batch_count`, `verify_serial_range`
- `carbon_marketplace`: `get_active_listings`, `get_listings_by_vintage`, `get_listing`
- Both contracts: `initialize` is also not blocked (would be called before any pause)

---

## Error Codes

### `EmergencyPaused`

| Contract | Error Code |
|----------|-----------|
| `carbon_credit` | 29 |
| `carbon_marketplace` | 27 |

**Meaning:** A state-mutating function was called while the contract is paused and the pause deadline has not yet passed.

**Resolution:** Wait for the pause to expire, or ask an admin to call `unpause_operations`.

**Soroban error representation:**

```
ContractError(29)  // carbon_credit
ContractError(27)  // carbon_marketplace
```

---

### `InvalidPauseWindow`

| Contract | Error Code |
|----------|-----------|
| `carbon_credit` | 28 |
| `carbon_marketplace` | 26 |

**Meaning:** The `until_timestamp` argument to `pause_operations` is invalid. Either:
- `until_timestamp ≤ now` (deadline is in the past or equal to current time), or
- `until_timestamp > now + 259200` (deadline exceeds 72-hour maximum).

**Resolution:** Provide a timestamp that is strictly in the future and at most 72 hours from now.

```bash
# Helper: compute a timestamp 6 hours from now (Linux)
echo $(($(date +%s) + 6 * 3600))
```

---

## Storage Keys

Both `carbon_credit` and `carbon_marketplace` use the same two `DataKey` variants for pause state:

| Key | Rust variant | Type | Default |
|-----|-------------|------|---------|
| Pause flag | `DataKey::PauseEnabled` | `bool` | `false` |
| Pause deadline | `DataKey::PauseUntil` | `u64` | `0` |

Both are stored in **Persistent** storage (not Temporary or Instance). This ensures pause state survives across ledger closes and is not accidentally cleared by TTL operations.

The keys are defined in the `DataKey` enum:

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ... other keys ...
    PauseEnabled,
    PauseUntil,
}
```

---

## Stellar CLI Examples

### Check if a contract is paused (read storage)

```bash
# Read both pause keys in one command using --output json
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  -- \
  get_credit_batch \
  --batch_id nonexistent 2>&1 | head -5
# If contract is paused, this will error with EmergencyPaused (29)
# If not paused, it will return ListingNotFound or similar
```

### Pause for 1 hour (quick test)

```bash
UNTIL=$(($(date +%s) + 3600))
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp $UNTIL
```

### Verify operations are blocked

```bash
# Attempt mint while paused — should return error code 29
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  mint_credits \
  --admin "$ADMIN_ADDRESS" \
  --project_id test-project \
  --amount 100 \
  --vintage_year 2024 \
  --batch_id test-batch \
  --serial_start 1000001 \
  --serial_end 1000101 \
  --metadata_cid bafytest \
  --initial_owner "$OWNER_ADDRESS"
# Expected: error ContractError(29)
```

### Unpause immediately

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

---

## Related Documents

- [Pause Specification](pause-specification.md) — Design decisions, state model, and rationale
- [Pause Security Analysis](pause-security-analysis.md) — Threat model and risk mitigation
- [ADR-013: Emergency Pause Mechanism](adr/ADR-013-emergency-pause.md) — Architecture decision record
- [Error Code Reference](error-codes.md) — Complete error code listing
- [Smart Contract Development Guide](SMART_CONTRACTS.md) — Building and invoking contracts
