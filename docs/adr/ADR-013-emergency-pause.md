# ADR-013: Emergency Pause Mechanism

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-09-25 |
| Deciders | Smart Contract Team, Security Team |

## Context

CarbonLedger's `carbon_credit` and `carbon_marketplace` contracts handle real-world asset value — tokenized carbon credits with verified provenance and USDC payments. In the event of an active exploit, a compromised oracle, or a critical bug, the team needs a capability to halt all state-mutating operations immediately to limit damage while an investigation and fix are coordinated.

**Design challenges:**

1. **Immediate effect** — The pause must take effect on the next transaction, not after a delay.
2. **No indefinite lockout** — An indefinite pause is a single point of failure: if the admin key is lost, the contract could be permanently frozen.
3. **Admin-only access** — Unauthorized parties must not be able to trigger a denial-of-service by pausing the contract.
4. **Minimal complexity** — The pause mechanism itself must be simple enough to be obviously correct; a complex pause introduces its own attack surface.
5. **Read path continuity** — Auditors, regulators, and users should be able to query on-chain data even when writes are blocked.
6. **Self-healing** — The contract should recover automatically without requiring admin action if the incident resolves before the pause window expires.

## Decision

Implement a **time-bounded emergency pause** in both `carbon_credit` and `carbon_marketplace` with the following design:

### Storage Model

Two `Persistent` ledger keys per contract:

```rust
DataKey::PauseEnabled  // bool  — whether the pause is active
DataKey::PauseUntil    // u64   — Unix timestamp of auto-expiry
```

Both keys default to `false` / `0` when absent (the contract starts unpaused).

### Public API

```rust
// Activate pause; until_timestamp must be in (now, now + 72h]
pub fn pause_operations(
    env: Env,
    admin: Address,
    until_timestamp: u64,
) -> Result<(), CarbonError>

// Immediately clear pause; idempotent
pub fn unpause_operations(
    env: Env,
    admin: Address,
) -> Result<(), CarbonError>
```

Both functions require:
- `admin.require_auth()` at the Soroban protocol level.
- `Admin` role verification from contract storage.

### Internal Guard

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
    if paused && until <= now {
        env.storage().persistent().set(&DataKey::PauseEnabled, &false);
        env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
    }
    Ok(())
}
```

This function is called at the entry of every state-mutating function. Read-only functions are not gated.

### Pause Window

```
now < until_timestamp ≤ now + 259200   (72 hours maximum)
```

Validated using `saturating_add` to prevent u64 overflow.

### Auto-Expiry

The pause expires lazily: on the first state-mutating call after `PauseUntil ≤ now`, the guard clears the stale flags and returns `Ok(())`. This means the contract self-heals without admin intervention.

### State Transition Diagram

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
              │         until ≤ now (auto-expiry)      │
              └───────────────────────────────────────┘
                       (lazy: clears on next write call)
```

### Functions Gated by Pause

**`carbon_credit`:** `mint_credits`, `retire_credits`, `transfer_credits`, `set_verified_periods`, `set_vintage_year_bounds`

**`carbon_marketplace`:** `list_credits`, `delist_credits`, `purchase_credits`, `bulk_purchase`, `set_vintage_year_bounds`

**Not gated (intentionally):** `pause_operations`, `unpause_operations`, and all read-only queries.

## Alternatives Considered

### Option A: Indefinite Pause (No Time Bound)

**Rejected.** An indefinite pause has no self-healing capability. If the admin key is lost or the admin is incapacitated, the contract is permanently frozen. This is a worse failure mode than the exploit it was designed to prevent.

### Option B: Multisig Pause (N-of-M Admin Signatures)

**Deferred.** Requiring M-of-N admin approval before pausing would prevent a single compromised key from activating a DoS. However, it also slows down the emergency response. In an active exploit scenario, every ledger close costs real money. Single-admin pause with a 72-hour cap was chosen for speed of response. Multisig can be layered on top in a future upgrade.

### Option C: Governance Contract Pause

**Deferred.** Routing pause activation through the `upgrade_governance` multisig contract would add governance overhead. Acceptable for planned maintenance windows but too slow for emergency response.

### Option D: Pause per Operation Type (Granular Pause)

**Rejected.** A granular pause (e.g., "pause minting but not transfers") adds complexity to both the contract logic and the operational runbook. In an emergency, the operator must make fast decisions. A single on/off switch is simpler, less error-prone, and faster to activate.

### Option E: Upgrade-Based Circuit Breaker

**Rejected.** Deploying a new contract version to block operations is too slow (requires building, simulating, and deploying WASM) and introduces risk of a bug in the replacement contract. In-contract pause is faster and safer.

## Consequences

### Positive

- **Immediate halting capability** — Any exploit that requires state writes can be interrupted within one ledger close (~5 seconds).
- **Self-healing** — The contract auto-recovers when the deadline passes without admin action.
- **No permanent lockout** — The 72-hour cap guarantees the contract will eventually resume.
- **Read continuity** — Auditors and regulators can query on-chain state even during a pause.
- **Minimal storage cost** — Two persistent boolean/integer keys per contract.
- **Simple and auditable** — The guard is a straightforward 10-line function with no complex state machine.

### Negative

- **Single point of activation** — One admin can pause the contract unilaterally. This is both a feature (speed) and a risk (abuse or compromise).
- **No event emitted** — Pause activations are not currently surfaced as contract events. Off-chain monitoring must poll storage keys or track invocations from transaction history.
- **Lazy auto-expiry** — Stale `PauseEnabled = true` flags remain in storage until the next write call. Off-chain tools must account for this.
- **No minimum duration** — There is no enforced minimum pause window. A 1-second pause is technically valid.

### Mitigation of Negative Consequences

- Monitoring should alert on every pause invocation (track by function name in Stellar transaction history).
- A `get_pause_status` public function should be added to expose effective pause state without requiring raw storage reads.
- Events for `OperationsPaused` / `OperationsUnpaused` should be added in a subsequent iteration.
- Consider multisig requirement for production mainnet deployment (upgrade governance pattern from `upgrade_governance` contract can be adapted).

## Implementation Notes

The error codes differ between the two contracts due to independent error enum evolution:

| Error | `carbon_credit` | `carbon_marketplace` |
|-------|----------------|---------------------|
| `EmergencyPaused` | 29 | 27 |
| `InvalidPauseWindow` | 28 | 26 |

When implementing a unified SDK or frontend error handler, map both codes to the same user-facing message.

## Related ADRs

- **ADR-007 (MultiSig Upgrade)** — upgrade governance pattern; can be adapted for multisig pause
- **ADR-011 (Soroban Contract Architecture)** — overall contract patterns including upgrade path
- **ADR-006 (Retirement State Machine)** — irreversible operations that must be protected by pause

## Related Documents

- [Pause Specification](../pause-specification.md) — full design spec
- [Pause API Reference](../pause-api-reference.md) — function signatures and CLI examples
- [Pause Security Analysis](../pause-security-analysis.md) — threat model and mitigations
- [Incident Response](../INCIDENT_RESPONSE.md) — when and how to activate the pause
