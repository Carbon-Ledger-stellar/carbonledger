# Pause Contract API Reference

> **Closes:** #1199  
> **Contracts:** `carbon_credit`, `carbon_marketplace`  
> **Last updated:** 2026-09-27  
> **Related:** [Pause Feature Spec](pause-feature-spec.md) · [Pause Security Review](pause-security-review.md) · [Pause FAQ](pause-faq.md) · [Error Codes](error-codes.md)

Complete reference for all Soroban contract functions related to the CarbonLedger pause mechanism. Covers function signatures, parameters, return values, authorization, side effects, error codes, and storage model.

---

## Table of Contents

- [Function Index](#function-index)
- [pause_operations](#pause_operations)
- [unpause_operations](#unpause_operations)
- [get_pause_status (Proposed)](#get_pause_status-proposed)
- [require_not_paused (Internal)](#require_not_paused-internal)
- [Error Codes](#error-codes)
- [Storage Keys](#storage-keys)
- [Gated Functions Reference](#gated-functions-reference)
- [Stellar CLI Examples](#stellar-cli-examples)
- [JavaScript SDK Examples](#javascript-sdk-examples)

---

## Function Index

| Function | Visibility | Auth Required | `carbon_credit` | `carbon_marketplace` |
|----------|-----------|--------------|:--------------:|:-------------------:|
| `pause_operations` | Public | Admin | ✅ | ✅ |
| `unpause_operations` | Public | Admin | ✅ | ✅ |
| `get_pause_status` | Public | None | 🟡 Proposed | 🟡 Proposed |
| `require_not_paused` | Internal | N/A | ✅ | ✅ |

---

## `pause_operations`

Activates the emergency pause for the contract. All state-mutating operations will fail with `EmergencyPaused` until the pause expires or `unpause_operations` is called.

### Contracts

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
| `env` | `Env` | Auto (runtime) | Soroban execution environment. Injected by the Soroban runtime — not passed by the caller. |
| `admin` | `Address` | Yes | Address of the contract administrator. The transaction must include a valid Soroban authorization for this address. |
| `until_timestamp` | `u64` | Yes | Unix epoch timestamp (seconds) when the pause automatically expires. Must satisfy: `now < until_timestamp ≤ now + 259200` (72 hours). |

### Authorization

Two independent checks must both pass:

1. **Soroban auth** — `admin.require_auth()`. The transaction must be signed by `admin`. This check runs at the protocol level before any contract code executes.
2. **Role check:**
   - `carbon_credit`: `require_role(&env, &admin, Role::Admin)` — reads the roles map from storage and confirms `admin` holds `Role::Admin`.
   - `carbon_marketplace`: `require_admin(&env, &admin)` — reads the single stored admin address and confirms it matches `admin`.

### Return Values

| Return value | Condition |
|-------------|-----------|
| `Ok(())` | Pause successfully activated |
| `Err(CarbonError::InvalidPauseWindow)` | `until_timestamp ≤ now` (deadline in the past or equal to current time) OR `until_timestamp > now + 259200` (exceeds 72-hour maximum) |
| `Err(CarbonError::Unauthorized)` | `admin` does not hold the Admin role (`carbon_credit`) |
| Soroban auth panic | `admin.require_auth()` failed — transaction not signed by `admin` |

### Constraints

```
let now = env.ledger().timestamp();
assert!(until_timestamp > now);
assert!(until_timestamp <= now.saturating_add(72 * 60 * 60));  // 259,200 seconds
```

`saturating_add` prevents `u64` overflow when `now` is near `u64::MAX`. In practice, Stellar ledger timestamps are Unix epoch seconds and will not overflow for billions of years.

### Side Effects

On `Ok(())`, the following persistent storage keys are written:

```
DataKey::PauseEnabled  ← true
DataKey::PauseUntil    ← until_timestamp
```

A contract event is emitted:

```rust
env.events().publish(
    (symbol_short!("c_ledger"), symbol_short!("paused")),
    (admin, until_timestamp, now),
);
```

| Event topic | Value |
|-------------|-------|
| Topic 1 | `"c_ledger"` (symbol) |
| Topic 2 | `"paused"` (symbol) |
| Data | `(admin: Address, until_timestamp: u64, now: u64)` |

### Behavior When Already Paused

`pause_operations` does not check existing pause state before writing. If the contract is already paused, this call overwrites the existing `PauseUntil`. This allows an admin to:
- **Extend** a pause by setting a later deadline.
- **Shorten** a pause by setting an earlier deadline.

This is intentional. The new deadline replaces the old one atomically.

### Source

- `carbon_credit`: `contracts/carbon_credit/src/lib.rs`, function `pause_operations`
- `carbon_marketplace`: `contracts/carbon_marketplace/src/lib.rs`, function `pause_operations`

---

## `unpause_operations`

Immediately clears the emergency pause, restoring full contract functionality. This function is **idempotent** — calling it on a contract that is already unpaused returns `Ok(())` without error.

### Contracts

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
| `env` | `Env` | Auto (runtime) | Soroban execution environment. Injected by the runtime. |
| `admin` | `Address` | Yes | Address of the contract administrator. The transaction must be signed by this address. |

### Authorization

Same two-layer chain as `pause_operations`:

1. `admin.require_auth()` — protocol-level signature check.
2. Role check — `require_role(Admin)` or `require_admin` (depending on contract).

### Return Values

| Return value | Condition |
|-------------|-----------|
| `Ok(())` | Pause cleared (or was already cleared — idempotent) |
| `Err(CarbonError::Unauthorized)` | `admin` does not hold the Admin role (`carbon_credit`) |
| Soroban auth panic | Transaction not signed by `admin` |

### Side Effects

On `Ok(())`, the following persistent storage keys are written regardless of previous state:

```
DataKey::PauseEnabled  ← false
DataKey::PauseUntil    ← 0
```

A contract event is emitted:

```rust
env.events().publish(
    (symbol_short!("c_ledger"), symbol_short!("unpaused")),
    (admin, env.ledger().timestamp()),
);
```

| Event topic | Value |
|-------------|-------|
| Topic 1 | `"c_ledger"` (symbol) |
| Topic 2 | `"unpaused"` (symbol) |
| Data | `(admin: Address, now: u64)` |

### Source

- `carbon_credit`: `contracts/carbon_credit/src/lib.rs`, function `unpause_operations`
- `carbon_marketplace`: `contracts/carbon_marketplace/src/lib.rs`, function `unpause_operations`

---

## `get_pause_status` (Proposed)

> **Status:** Proposed (FR-9 in [Pause Feature Spec](pause-feature-spec.md)). Not yet implemented. This section documents the planned interface.

Returns the effective pause status for the contract. Requires no authorization — safe to call at any time.

### Planned Signature

```rust
pub fn get_pause_status(env: Env) -> PauseStatus
```

### Planned Return Type

```rust
#[contracttype]
pub struct PauseStatus {
    /// Whether PauseEnabled is set to true in storage
    pub paused: bool,
    /// The deadline stored in PauseUntil (0 if not paused)
    pub until_timestamp: u64,
    /// Whether the pause is currently effective: paused && until_timestamp > now
    pub is_active: bool,
    /// Seconds until the pause expires (0 if not active)
    pub seconds_remaining: u64,
}
```

### Current Workaround

Until this function is implemented, determine pause state off-chain by reading storage keys and applying the logic manually:

```bash
# Read both keys
stellar contract read --id "$CONTRACT_ID" --network testnet --key PauseEnabled
stellar contract read --id "$CONTRACT_ID" --network testnet --key PauseUntil
```

Effective pause determination:

```
is_active = (PauseEnabled == true) AND (PauseUntil > current_ledger_timestamp)
```

If `PauseEnabled` is `true` but `PauseUntil ≤ current_ledger_timestamp`, the pause is stale and will be auto-cleared on the next state-mutating call.

---

## `require_not_paused` (Internal)

This is a private helper function — it is not a public contract entry point and cannot be invoked externally. It is documented here for contract developers and security auditors.

### Signature

```rust
fn require_not_paused(env: &Env) -> Result<(), CarbonError>
```

### Implementation

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
        .unwrap_or(0);
    let now = env.ledger().timestamp();

    if paused && until > now {
        return Err(CarbonError::EmergencyPaused);
    }
    if paused && until <= now {
        // Auto-expire: clear stale pause flags so callers pay cleanup cost only once
        env.storage().persistent().set(&DataKey::PauseEnabled, &false);
        env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
    }
    Ok(())
}
```

### Behavior Table

| `PauseEnabled` | `PauseUntil` vs `now` | Result | Side effect |
|---------------|----------------------|--------|-------------|
| `false` | any | `Ok(())` | None |
| absent | any | `Ok(())` (defaults to false) | None |
| `true` | `until > now` | `Err(EmergencyPaused)` | None |
| `true` | `until ≤ now` | `Ok(())` | Writes `false` + `0` to storage (auto-expire) |

### Gas Impact

- **Normal path (not paused):** 2 persistent storage reads.
- **Paused path:** 2 reads + returns error. The function exits before any further work.
- **Auto-expiry path (first call after deadline):** 2 reads + 2 writes. Subsequent calls in the same ledger see the cleared state (1 read each, early exit).

### Usage Pattern

`require_not_paused` is always called as one of the first guards in a state-mutating function, before any state changes or external calls:

```rust
pub fn mint_credits(
    env: Env,
    admin: Address,
    // ... other parameters
) -> Result<(), CarbonError> {
    admin.require_auth();
    Self::require_role(&env, &admin, Role::Admin)?;
    Self::require_not_paused(&env)?;   // ← pause check here
    // ... rest of function logic
}
```

---

## Error Codes

### `EmergencyPaused`

| Contract | Numeric code | Soroban representation |
|----------|-------------|----------------------|
| `carbon_credit` | **29** | `ContractError(29)` |
| `carbon_marketplace` | **27** | `ContractError(27)` |

**Meaning:** A state-mutating function was called while the contract's pause is active (i.e., `PauseEnabled == true` AND `PauseUntil > current_ledger_timestamp`).

**Trigger:** Returned by `require_not_paused` on the blocked call path.

**Resolution:**
- For users: wait for the pause to expire, or check the CarbonLedger status page for an estimated resume time.
- For admins: call `unpause_operations` to lift the pause immediately.

**Note:** `EmergencyPaused` is never returned by `pause_operations`, `unpause_operations`, or any read-only function.

---

### `InvalidPauseWindow`

| Contract | Numeric code | Soroban representation |
|----------|-------------|----------------------|
| `carbon_credit` | **28** | `ContractError(28)` |
| `carbon_marketplace` | **26** | `ContractError(26)` |

**Meaning:** The `until_timestamp` argument to `pause_operations` is invalid. Either:
- `until_timestamp ≤ now` — deadline is in the past or equals current ledger time, OR
- `until_timestamp > now + 259200` — deadline exceeds the 72-hour maximum.

**Trigger:** Returned by `pause_operations` when the window constraint fails.

**Resolution:** Provide a timestamp that is:
1. Strictly greater than the current ledger timestamp (`now`).
2. No more than 72 hours ahead of `now` (`now + 259200`).

```bash
# Helper: timestamp exactly 6 hours from now (Linux)
echo $(($(date +%s) + 6 * 3600))

# Helper: timestamp exactly 6 hours from now (macOS)
echo $(($(date -v+6H +%s)))
```

---

## Storage Keys

Both contracts use the same two `DataKey` variants to store pause state:

| Key | Rust enum variant | Type | Persistence | Default |
|-----|------------------|------|-------------|---------|
| Pause flag | `DataKey::PauseEnabled` | `bool` | `Persistent` | `false` (via `unwrap_or`) |
| Pause deadline | `DataKey::PauseUntil` | `u64` | `Persistent` | `0` (via `unwrap_or`) |

### Persistence Level

Both keys use **Persistent** storage (not `Temporary` or `Instance`). This ensures:
- Pause state survives across ledger closes.
- Pause state is not lost due to ledger entry TTL expiry.
- The pause persists until explicitly cleared or auto-expired.

### DataKey Definition

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ... other keys ...
    PauseEnabled,
    PauseUntil,
}
```

### Reading Storage Off-Chain

```bash
# Read PauseEnabled for carbon_credit
stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseEnabled

# Read PauseUntil for carbon_marketplace
stellar contract read \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --network testnet \
  --key PauseUntil
```

---

## Gated Functions Reference

The following functions call `require_not_paused` and are blocked while the respective contract is paused.

### `carbon_credit` — Blocked While Paused

| Function | Description |
|----------|-------------|
| `mint_credits` | Minting new credit batches |
| `retire_credits` | Permanently retiring credits |
| `transfer_credits` | Transferring credits between accounts |
| `set_verified_periods` | Setting verified monitoring periods |
| `set_vintage_year_bounds` | Updating vintage year constraints |

### `carbon_marketplace` — Blocked While Paused

| Function | Description |
|----------|-------------|
| `list_credits` | Creating a new marketplace listing |
| `delist_credits` | Removing an active listing |
| `purchase_credits` | Single-credit purchase |
| `bulk_purchase` | Multi-project bulk purchase |
| `set_vintage_year_bounds` | Updating vintage year constraints |

### Functions Always Available (Not Gated)

The following are never blocked, regardless of pause state:

**`carbon_credit`:**
`get_credit_batch`, `get_retirement_certificate`, `get_oracle_contract`, `get_project_batch_count`, `verify_serial_range`, `grant_role`, `revoke_role`, `pause_operations`, `unpause_operations`, `initialize`

**`carbon_marketplace`:**
`get_active_listings`, `get_listings_by_vintage`, `get_listing`, `pause_operations`, `unpause_operations`, `initialize`

---

## Stellar CLI Examples

### Pause `carbon_credit` for 6 hours

```bash
# Compute 6-hour deadline (Linux)
UNTIL=$(($(date +%s) + 6 * 3600))

stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp "$UNTIL"
```

### Pause `carbon_marketplace` for 12 hours

```bash
UNTIL=$(($(date +%s) + 12 * 3600))

stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp "$UNTIL"
```

### Pause both contracts (emergency sequence)

```bash
UNTIL=$(($(date +%s) + 6 * 3600))

# Pause credit contract
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp "$UNTIL"

# Pause marketplace contract
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp "$UNTIL"

echo "Both contracts paused until $(date -d @$UNTIL 2>/dev/null || date -r $UNTIL)"
```

### Unpause `carbon_credit`

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

### Unpause `carbon_marketplace`

```bash
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

### Verify operations are blocked while paused

```bash
# Attempt a mint — should return ContractError(29) if credit contract is paused
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  mint_credits \
  --admin "$ADMIN_ADDRESS" \
  --project_id "test-project" \
  --amount 100 \
  --vintage_year 2024 \
  --batch_id "test-batch-001" \
  --serial_start 1000001 \
  --serial_end 1000100 \
  --metadata_cid "bafytest" \
  --initial_owner "$OWNER_ADDRESS"
# Expected output: error ContractError(29)
```

### Check effective pause status via storage (no get_pause_status yet)

```bash
ENABLED=$(stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseEnabled 2>/dev/null || echo "false")

UNTIL=$(stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseUntil 2>/dev/null || echo "0")

NOW=$(date +%s)

if [ "$ENABLED" = "true" ] && [ "$UNTIL" -gt "$NOW" ]; then
  echo "Carbon credit contract IS PAUSED until $(date -d @$UNTIL 2>/dev/null || date -r $UNTIL)"
else
  echo "Carbon credit contract is NOT paused"
fi
```

---

## JavaScript SDK Examples

### Invoke `pause_operations` using `@stellar/stellar-sdk`

```typescript
import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';

const rpc = new SorobanRpc.Server('https://soroban-testnet.stellar.org');

async function pauseContract(
  contractId: string,
  adminKeypair: Keypair,
  durationHours: number
): Promise<string> {
  const adminAddress = adminKeypair.publicKey();
  const now = Math.floor(Date.now() / 1000);
  const untilTimestamp = now + durationHours * 3600;

  const account = await rpc.getAccount(adminAddress);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'pause_operations',
        new Address(adminAddress).toScVal(),
        nativeToScVal(BigInt(untilTimestamp), { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build();

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(adminKeypair);

  const result = await rpc.sendTransaction(prepared);
  return result.hash;
}
```

### Invoke `unpause_operations`

```typescript
async function unpauseContract(
  contractId: string,
  adminKeypair: Keypair
): Promise<string> {
  const adminAddress = adminKeypair.publicKey();
  const account = await rpc.getAccount(adminAddress);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'unpause_operations',
        new Address(adminAddress).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(adminKeypair);

  const result = await rpc.sendTransaction(prepared);
  return result.hash;
}
```

### Handle `EmergencyPaused` error in UI

```typescript
import { SorobanRpc } from '@stellar/stellar-sdk';

// Error codes by contract
const EMERGENCY_PAUSED_CODES = {
  carbon_credit: 29,
  carbon_marketplace: 27,
};

function isEmergencyPaused(error: unknown, contract: 'carbon_credit' | 'carbon_marketplace'): boolean {
  if (!(error instanceof Error)) return false;
  const code = EMERGENCY_PAUSED_CODES[contract];
  return error.message.includes(`ContractError(${code})`);
}

// Usage in a purchase flow
async function purchaseCredits(/* ... */) {
  try {
    await invokePurchase(/* ... */);
  } catch (err) {
    if (isEmergencyPaused(err, 'carbon_marketplace') || isEmergencyPaused(err, 'carbon_credit')) {
      showPausedErrorMessage(); // Display user-friendly UI
    } else {
      throw err;
    }
  }
}
```

---

## Related Documents

- [Pause Feature Specification](pause-feature-spec.md) — Full cross-stack spec including backend and frontend
- [Pause Security Review](pause-security-review.md) — Threat model and mitigation strategies
- [Pause FAQ](pause-faq.md) — Common questions for admins and users
- [ADR-013: Emergency Pause Mechanism](adr/ADR-013-emergency-pause.md) — Architecture decision record
- [Error Codes Reference](error-codes.md) — Complete list of all contract error codes
- [Pause Operations Guide](PAUSE_OPERATIONS_GUIDE.md) — Step-by-step admin runbook
- [Pause Testing Guide](PAUSE_TESTING_GUIDE.md) — Test matrix and verification procedures
- [Smart Contracts Guide](SMART_CONTRACTS.md) — General Soroban contract reference
