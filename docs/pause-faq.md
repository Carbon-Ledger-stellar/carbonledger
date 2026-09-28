# Emergency Pause — Frequently Asked Questions

> **Closes:** #1209  
> **Audience:** Administrators, marketplace users (buyers/sellers/project developers), and technical integrators  
> **Last updated:** 2026-09-27  
> **Related:** [Pause Feature Spec](pause-feature-spec.md) · [Pause Contract API](pause-contract-api.md) · [Pause Security Review](pause-security-review.md) · [Operations Guide](PAUSE_OPERATIONS_GUIDE.md)

---

## Table of Contents

- [General Questions](#general-questions)
- [Admin-Focused Questions](#admin-focused-questions)
- [User-Focused Questions](#user-focused-questions)
- [Technical Questions](#technical-questions)
- [Operational Questions](#operational-questions)

---

## General Questions

### 1. What is the emergency pause feature?

The emergency pause is a time-limited circuit breaker built into the `carbon_credit` and `carbon_marketplace` Soroban contracts. When activated by an administrator, it immediately halts all state-changing operations — such as minting, transferring, retiring, listing, and purchasing credits — until the pause expires or an administrator manually lifts it.

The pause is a defensive tool used during active incidents: suspected exploits, oracle price manipulation, serial-number conflicts, or any situation where new on-chain writes could worsen a problem under investigation.

### 2. Which contracts can be paused?

Only two contracts support the pause mechanism:

| Contract | Pause support |
|----------|--------------|
| `carbon_credit` | ✅ Yes |
| `carbon_marketplace` | ✅ Yes |
| `carbon_registry` | ❌ No |
| `carbon_oracle` | ❌ No |
| `carbon_zk_verifier` | ❌ No |

Each contract is paused **independently**. Pausing `carbon_credit` does not automatically pause `carbon_marketplace`, and vice versa.

### 3. How long can a pause last?

Every pause has a hard maximum of **72 hours** from the time it is activated. The pause deadline is set by the administrator at activation time but cannot exceed `now + 72 hours`. When the deadline is reached the pause lifts automatically — no action is needed.

Administrators can end the pause earlier by calling `unpause_operations` at any time. They can also extend it by calling `pause_operations` again (each new call resets the deadline, still capped at 72 hours from the moment of the call).

### 4. Are my funds and credits safe during a pause?

Yes. A pause **only blocks new transactions**. Your credit balances, retirement certificates, marketplace listings, USDC balances, and all historical data remain exactly as they were when the pause was activated. Nothing is deleted, reversed, or moved without your authorization. Everything is still visible on-chain and in the application.

### 5. How do I know if the platform is currently paused?

Check the CarbonLedger status page and official announcement channels. The application may display a banner message. You can also identify a pause from error codes:

| Error code | Meaning |
|-----------|---------|
| `ContractError(27)` | `carbon_marketplace` is paused |
| `ContractError(29)` | `carbon_credit` is paused |

If you encounter either error and there is no announced pause, contact support immediately — an unannounced pause may indicate a security incident.

---

## Admin-Focused Questions

### 6. Who is authorized to pause the contracts?

Only addresses holding the **Admin role** for each contract can call `pause_operations` or `unpause_operations`. This is enforced at two layers:

1. **Soroban authentication** — the transaction must be cryptographically signed by the admin address.
2. **Role check** — `carbon_credit` verifies the `Admin` role via `require_role`; `carbon_marketplace` verifies via `require_admin`.

No other role (Verifier, Oracle, or anonymous user) can activate or deactivate the pause.

### 7. How do I activate the pause?

Use the Stellar CLI or any Soroban-compatible client:

```bash
# Compute a timestamp 6 hours from now (Linux)
UNTIL=$(($(date +%s) + 6 * 3600))

# Pause carbon_credit
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp "$UNTIL"

# Pause carbon_marketplace
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp "$UNTIL"
```

For a step-by-step walkthrough, see [PAUSE_OPERATIONS_GUIDE.md](PAUSE_OPERATIONS_GUIDE.md).

### 8. How do I unpause early?

```bash
# Unpause carbon_credit immediately
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

Unpausing is **idempotent** — calling `unpause_operations` on a contract that is already unpaused returns successfully without error.

### 9. Can I pause both contracts at once?

Not in a single atomic transaction. You must invoke `pause_operations` separately on each contract. Submit both transactions in close succession to minimize the window between pauses. For coordinated incident response, the [emergency pause runbook](runbooks/emergency-pause.md) documents the recommended sequence.

### 10. What happens if the admin key is compromised during a pause?

If the admin key is compromised:

1. Follow the [key compromise runbook](runbooks/key-compromise.md) immediately.
2. Use the `grant_role` / `revoke_role` functions (which remain available during a pause in `carbon_credit`) to rotate the admin role to a new key.
3. The compromised key can no longer call `unpause_operations` once its role is revoked.
4. The new admin key can call `unpause_operations` to resume operations after key rotation is complete.

### 11. Can the pause be used to target a specific user or transaction?

No. The pause is a **global contract-level switch** — it affects all users of the contract equally. There is no mechanism to block individual addresses or transactions while allowing others.

### 12. How should I communicate a pause to users?

Before or immediately after activating a pause:

1. Post an update on the CarbonLedger status page.
2. Send an announcement via official channels (email list, Discord, etc.).
3. Include: what is paused, why (at an appropriate level of detail), expected duration, and where to follow updates.

Users whose transactions failed with `ContractError(27)` or `ContractError(29)` should be advised to retry after the pause lifts — their transactions were not applied and no funds were charged.

---

## User-Focused Questions

### 13. What can I not do while the contracts are paused?

| Operation | Affected contract | Blocked? |
|-----------|------------------|---------|
| Buy credits (single or bulk) | `carbon_marketplace` + `carbon_credit` | ✅ If either is paused |
| Create a listing | `carbon_marketplace` | ✅ If marketplace paused |
| Remove a listing | `carbon_marketplace` | ✅ If marketplace paused |
| Transfer credits | `carbon_credit` | ✅ If credit paused |
| Retire credits | `carbon_credit` | ✅ If credit paused |
| Receive minted credits | `carbon_credit` | ✅ If credit paused |
| View projects and balances | Any | ❌ Always available |
| View listings | Any | ❌ Always available |
| View retirement certificates | Any | ❌ Always available |
| Look up serial numbers | Any | ❌ Always available |
| Project registration / verification | `carbon_registry` | ❌ Not affected |
| Oracle price updates | `carbon_oracle` | ❌ Not affected |

### 14. I tried to buy credits and got an error. Was I charged?

**No.** On Stellar, a transaction that fails is not applied at all. You will not be charged for the credits, and your USDC was not transferred. The only cost is the small network fee for submitting the transaction (a fraction of a cent). You can safely retry once the pause lifts.

### 15. Will my active marketplace listings expire during the pause?

Listings expire 90 days after creation, and **that clock continues running during a pause**. If your listing was close to its 90-day expiry when the pause started, check it after the pause lifts and relist if necessary.

Prices are not affected by the pause — your listing price remains exactly as you set it.

### 16. Do I need to take any action after the pause ends?

No action is required. Simply **retry** the operation you were attempting. Nothing that failed during the pause went through, so there is nothing to cancel, and no operation will run twice.

### 17. What does the pause error message look like?

The application may display a generic contract error. The specific codes to look for are:

| Error | Contract paused |
|-------|----------------|
| `Error(Contract, #27)` | `carbon_marketplace` |
| `Error(Contract, #29)` | `carbon_credit` |

If you see a purchase that mentions a cross-contract call failure or "abort," it typically means `carbon_credit` is paused while the marketplace is still open.

---

## Technical Questions

### 18. How is the pause enforced at the contract level?

Every state-mutating function in `carbon_credit` and `carbon_marketplace` calls `require_not_paused` as one of its first guards. This internal function reads two persistent storage keys — `PauseEnabled` (bool) and `PauseUntil` (u64 timestamp) — and returns `Err(CarbonError::EmergencyPaused)` if the contract is actively paused.

```rust
fn require_not_paused(env: &Env) -> Result<(), CarbonError> {
    let paused: bool = env.storage().persistent()
        .get(&DataKey::PauseEnabled).unwrap_or(false);
    let until: u64 = env.storage().persistent()
        .get(&DataKey::PauseUntil).unwrap_or(0);
    let now = env.ledger().timestamp();
    if paused && until > now {
        return Err(CarbonError::EmergencyPaused);
    }
    // Auto-expire: clear stale flags after deadline passes
    if paused && until <= now {
        env.storage().persistent().set(&DataKey::PauseEnabled, &false);
        env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
    }
    Ok(())
}
```

Read-only functions (such as `get_credit_batch`, `get_active_listings`, `get_retirement_certificate`) never call `require_not_paused` and are always accessible.

### 19. Is there a way to query pause status on-chain?

Currently, there is no public `get_pause_status` entry point on either contract. Pause state can be determined off-chain by reading the storage keys directly:

```bash
# Read PauseEnabled
stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseEnabled

# Read PauseUntil
stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseUntil
```

A contract is effectively paused when `PauseEnabled == true` **AND** `PauseUntil > current_ledger_timestamp`. If `PauseEnabled` is true but the deadline has already passed, the pause is stale and will be auto-cleared on the next state-mutating call.

A public `get_pause_status` function is planned (tracked as FR-9 in the feature specification).

### 20. Does pausing affect the gas cost of subsequent transactions?

The first state-mutating call after a pause deadline expires will incur a small extra cost — it writes `false` and `0` to two storage keys to clear the stale pause flags. Subsequent calls have normal gas costs. This auto-expiry cleanup is an expected and documented side effect.

---

## Operational Questions

### 21. What criteria justify activating the pause?

The pause should be activated when there is evidence or strong suspicion of:

- An active exploit in a contract function
- Unexpected or manipulated oracle data that could affect purchase prices
- A serial number conflict indicating potential double-counting
- A compromised admin or verifier key being used maliciously

It should **not** be used for routine maintenance, planned upgrades, or to benefit specific market participants. Every pause activation is recorded on-chain and is publicly visible.

### 22. What is the expected response time to activate a pause?

An operator with the admin key and access to the Stellar CLI can pause the contract in under 5 minutes. For faster response, pre-configure a pause script with the contract IDs and admin key alias. The [PAUSE_OPERATIONS_GUIDE.md](PAUSE_OPERATIONS_GUIDE.md) includes a ready-to-run emergency script.

### 23. What happens when the pause expires naturally?

When the ledger timestamp passes `PauseUntil`, the pause is logically expired. The contract behaves as if it is not paused — the next call to any state-mutating function will automatically clear the stale `PauseEnabled` flag from storage. No administrator action is needed.

### 24. How is the pause audit trail maintained?

Every `pause_operations` and `unpause_operations` invocation is a Soroban transaction on the Stellar network. These transactions are permanently recorded in the ledger history and are publicly verifiable by anyone using Stellar Horizon or a block explorer. Contract events are also emitted on each pause/unpause (see [PAUSE_EVENTS.md](PAUSE_EVENTS.md)).

---

## Related Documents

- [Pause Feature Specification](pause-feature-spec.md) — Full cross-stack feature spec
- [Pause Contract API Reference](pause-contract-api.md) — Function signatures and parameters
- [Pause Security Review](pause-security-review.md) — Threat model and mitigations
- [Pause Operations Guide](PAUSE_OPERATIONS_GUIDE.md) — Step-by-step admin runbook
- [Emergency Pause Runbook](runbooks/emergency-pause.md) — Incident response procedures
- [Pause Testing Guide](PAUSE_TESTING_GUIDE.md) — How to test pause functionality
- [Error Codes Reference](error-codes.md) — Complete error code listing
