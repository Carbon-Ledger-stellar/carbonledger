# Contract Architecture: Pause Mechanism

> **Closes:** #1291  
> **Last updated:** 2026-09-25  
> **See also:** [ADR-013](adr/ADR-013-emergency-pause.md) | [Pause Specification](pause-specification.md) | [Pause API Reference](pause-api-reference.md)

This document describes how the emergency pause mechanism integrates into the CarbonLedger smart contract architecture. It includes updated architecture diagrams, sequence diagrams for pause flows, and storage model documentation.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Pause in the Contract Layer](#pause-in-the-contract-layer)
- [Updated Architecture Diagram](#updated-architecture-diagram)
- [Pause Flow Sequence Diagrams](#pause-flow-sequence-diagrams)
  - [Pause Activation Flow](#pause-activation-flow)
  - [Blocked Operation Flow (While Paused)](#blocked-operation-flow-while-paused)
  - [Unpause Flow](#unpause-flow)
  - [Auto-Expiry Flow](#auto-expiry-flow)
- [Storage Model](#storage-model)
- [Integration with Existing Functions](#integration-with-existing-functions)
- [Cross-Contract Interactions During Pause](#cross-contract-interactions-during-pause)
- [Off-Chain Architecture Impact](#off-chain-architecture-impact)

---

## Architecture Overview

CarbonLedger deploys four Soroban contracts. The pause mechanism applies to two of them:

```
┌──────────────────────────────────────────────────────────────────┐
│                    NEXT.JS 14 FRONTEND                           │
│   Marketplace │ Buy │ Retire │ Dashboard │ ⚠️ Pause Banner        │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│                  SOROBAN CONTRACTS (Rust)                        │
│                                                                  │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐  │
│  │  carbon_registry    │   │  carbon_credit  🔴 PAUSEABLE     │  │
│  │  (no pause)         │   │                                  │  │
│  │  register_project() │   │  mint_credits()  ──► pause guard │  │
│  │  verify_project()   │   │  retire_credits() ─► pause guard │  │
│  │  reject_project()   │   │  transfer_credits() ► pause guard│  │
│  └─────────────────────┘   └──────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────┐   ┌──────────────────────────────────┐  │
│  │  carbon_oracle      │   │  carbon_marketplace 🔴 PAUSEABLE │  │
│  │  (no pause)         │   │                                  │  │
│  │  submit_monitoring()│   │  list_credits()  ───► pause guard│  │
│  │  update_price()     │   │  purchase_credits() ► pause guard│  │
│  │  flag_project()     │   │  bulk_purchase() ───► pause guard│  │
│  └─────────────────────┘   └──────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The `carbon_registry` and `carbon_oracle` contracts do not implement the pause mechanism — they handle project registration and price/monitoring data respectively, which should remain available during an incident.

---

## Pause in the Contract Layer

The pause mechanism is implemented as a two-component design in each pauseable contract:

```
┌─────────────────────────────────────────────────────────────────┐
│  CONTRACT (carbon_credit OR carbon_marketplace)                 │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  PAUSE STATE (Persistent Storage)                          │ │
│  │                                                            │ │
│  │   PauseEnabled: bool  ────►  Is pause flag set?            │ │
│  │   PauseUntil:   u64   ────►  Expiry timestamp (Unix epoch) │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           │                                     │
│                           ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  require_not_paused() — internal guard                     │ │
│  │                                                            │ │
│  │   paused=false → Ok(())                                    │ │
│  │   paused=true, until > now → Err(EmergencyPaused)          │ │
│  │   paused=true, until ≤ now → auto-clear → Ok(())           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           │                                     │
│              called at entry of every write function            │
│                           │                                     │
│      ┌────────────────────┼──────────────────────────────┐     │
│      ▼                    ▼                               ▼     │
│  mint_credits()    retire_credits()              list_credits() │
│  transfer_credits()                               purchase()    │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ADMIN-ONLY ENTRY POINTS                                   │ │
│  │                                                            │ │
│  │   pause_operations(admin, until_timestamp)                 │ │
│  │   unpause_operations(admin)                                │ │
│  │                                                            │ │
│  │   Both require: admin.require_auth() + Admin role check    │ │
│  │   Neither calls require_not_paused (bypass intentional)    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Updated Architecture Diagram

The following diagram shows the full system architecture with the pause mechanism integrated:

```
┌──────────────────────────────────────────────────────────────────┐
│                    NEXT.JS 14 FRONTEND                           │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ Public Audit    │  │ Marketplace       │  │ Admin Panel    │  │
│  │ (no wallet)     │  │ Buy / Retire      │  │                │  │
│  │                 │  │ ⚠️ Pause Banner   │  │ pause_ops()   │  │
│  └─────────────────┘  └──────────────────┘  └────────────────┘  │
└─────────────────────────────────┬────────────────────────────────┘
                                  │  @stellar/stellar-sdk
                                  │  @stellar/freighter-api
┌─────────────────────────────────▼────────────────────────────────┐
│                  SOROBAN CONTRACTS (Rust)                        │
│                                                                  │
│  carbon_registry          carbon_credit          [🔴 PAUSEABLE]  │
│  ─────────────────        ──────────────────────────────────     │
│  register_project()  ◄──  mint_credits()                        │
│  verify_project()         retire_credits()    ←── require_not_  │
│  reject_project()         transfer_credits()       paused()     │
│                           ──────────────────────────────────     │
│                           pause_operations()  ←── Admin only    │
│                           unpause_operations()                   │
│                                                                  │
│  carbon_marketplace       carbon_oracle                          │
│  ─────────────────        ─────────────────                      │
│  list_credits()     [🔴]  submit_monitoring()                    │
│  purchase_credits() [🔴]  update_credit_price()                  │
│  bulk_purchase()    [🔴]  flag_project()                         │
│  ──────────────────       ─────────────────                      │
│  pause_operations()       (no pause — always                     │
│  unpause_operations()      available)                            │
│                                                                  │
│  [🔴] = blocked when paused                                      │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────┐
│                ORACLE / VERIFICATION BRIDGE (Python)             │
│   verification_listener │ price_oracle │ satellite_monitor       │
│                                                                  │
│   Monitors: PauseEnabled key on credit + marketplace contracts   │
│   Halts: oracle price submissions that depend on marketplace     │
│   Alerts: PagerDuty / Slack on pause activation detected         │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────┐
│              OFF-CHAIN LAYER (PostgreSQL + IPFS)                 │
│   Project docs │ Credit batches │ Retirements │ Certificates     │
│                                                                  │
│   Backend: surface pause state via REST API                      │
│   Frontend: display global pause banner when active             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Pause Flow Sequence Diagrams

### Pause Activation Flow

This diagram shows the sequence when an admin activates the emergency pause.

```
Admin          Frontend         Soroban          carbon_credit
  │                │                │                  │
  │─ Admin panel ─►│                │                  │
  │  clicks Pause  │                │                  │
  │                │                │                  │
  │◄── Confirm ────│                │                  │
  │  dialog shown  │                │                  │
  │                │                │                  │
  │─ Confirms ────►│                │                  │
  │                │                │                  │
  │                │── pause_ops() ─►                  │
  │                │   admin=ADMIN  │                  │
  │                │   until=T+4h   │                  │
  │                │                │── admin.require  │
  │                │                │    _auth()       │
  │                │                │──────────────────►
  │                │                │   require_role   │
  │                │                │   (Admin)        │
  │                │                │                  │
  │                │                │   validate:      │
  │                │                │   T+4h ∈ (now,   │
  │                │                │         now+72h] │
  │                │                │                  │
  │                │                │   write:         │
  │                │                │   PauseEnabled=T │
  │                │                │   PauseUntil=T+4h│
  │                │                │                  │
  │                │◄── Ok(()) ─────│                  │
  │                │                │                  │
  │◄── "Contract  ─│                │                  │
  │   paused until │                │                  │
  │   T+4h"        │                │                  │
```

### Blocked Operation Flow (While Paused)

This diagram shows what happens when a user attempts a state-mutating operation while the contract is paused.

```
User           Frontend         Soroban          carbon_credit
  │                │                │                  │
  │── Clicks ─────►│                │                  │
  │   "Buy Credits"│                │                  │
  │                │── purchase_    │                  │
  │                │   credits()   ─►                  │
  │                │                │── require_not    │
  │                │                │   _paused()      │
  │                │                │                  │
  │                │                │   read PauseEnabled=true
  │                │                │   read PauseUntil=T+4h
  │                │                │   now < T+4h     │
  │                │                │                  │
  │                │                │◄─ Err(EmergencyPaused=27)
  │                │                │                  │
  │                │◄── Error 27 ───│                  │
  │                │                │                  │
  │◄── "Service   ─│                │                  │
  │   temporarily  │                │                  │
  │   paused.      │                │                  │
  │   Resumes at   │                │                  │
  │   [T+4h]"      │                │                  │
```

**Note:** Read-only operations (browsing listings, viewing certificates) are not affected:

```
User           Frontend         Soroban          carbon_marketplace
  │                │                │                  │
  │── Browse ─────►│                │                  │
  │   Listings     │                │                  │
  │                │── get_active_  │                  │
  │                │   listings()  ─►                  │
  │                │                │── (no pause      │
  │                │                │    check)        │
  │                │                │                  │
  │                │◄── listings ───│                  │
  │                │                │                  │
  │◄── Shows ─────►│                │                  │
  │   listings     │                │                  │
  │   (with banner)│                │                  │
```

### Unpause Flow

This diagram shows the admin manually clearing a pause before the deadline.

```
Admin          Frontend         Soroban          carbon_credit
  │                │                │                  │
  │── Admin ──────►│                │                  │
  │   panel        │                │                  │
  │   "Unpause"    │                │                  │
  │                │── unpause_ops()│                  │
  │                │   admin=ADMIN  │                  │
  │                │               ─►                  │
  │                │                │── admin.require  │
  │                │                │    _auth()       │
  │                │                │   require_role   │
  │                │                │   (Admin)        │
  │                │                │                  │
  │                │                │   write:         │
  │                │                │   PauseEnabled=F │
  │                │                │   PauseUntil=0   │
  │                │                │                  │
  │                │◄── Ok(()) ─────│                  │
  │                │                │                  │
  │◄── "Contract  ─│                │                  │
  │   operational" │                │                  │
```

### Auto-Expiry Flow

This diagram shows the lazy auto-expiry: the first write operation after the deadline automatically clears the stale pause state.

```
Time line:  ────────────────────────────────────►

            T-pause     T-deadline    T-next-write
               │             │             │
               ▼             ▼             ▼
           pause active   pause           user attempts
           PauseEnabled   deadline        mint_credits()
           = true         passes          │
           PauseUntil     (no action      │
           = T-deadline   occurs)         ▼
                                    require_not_paused()
                                          │
                                    read PauseEnabled=true
                                    read PauseUntil=T-deadline
                                    now > T-deadline
                                          │
                                    AUTO-EXPIRE:
                                    write PauseEnabled=false
                                    write PauseUntil=0
                                          │
                                    return Ok(())
                                          │
                                    mint_credits proceeds ✓
```

**Key property:** No admin action required for recovery. The system self-heals on the first write operation after the deadline.

---

## Storage Model

### Pause State Keys

Both `carbon_credit` and `carbon_marketplace` use the same two `DataKey` variants:

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ... other keys ...
    PauseEnabled,   // bool  — pause is active
    PauseUntil,     // u64   — expiry timestamp (Unix seconds)
}
```

Both keys are stored in **Persistent** storage. This is significant:

| Storage type | Behavior |
|-------------|----------|
| **Persistent** ✅ | Survives across ledger closes; requires periodic TTL extension |
| Temporary | Cleared after each transaction |
| Instance | Tied to contract instance; cannot be selectively cleared |

Persistent storage is the right choice because pause state must survive across transactions and ledger closes for the duration of the pause window (up to 72 hours).

### Storage Layout Diagram

```
Persistent Ledger Storage (carbon_credit)
┌─────────────────────────────────────────────────────┐
│  DataKey::Admin         → Address                   │
│  DataKey::Roles(addr)   → Role                      │
│  DataKey::OracleContract→ Address                   │
│  DataKey::VintageYearMin→ u32                       │
│  DataKey::VintageYearMax→ u32                       │
│  ────────────────────────────────────────────────── │
│  DataKey::PauseEnabled  → bool        ◄── PAUSE     │
│  DataKey::PauseUntil    → u64         ◄── PAUSE     │
│  ────────────────────────────────────────────────── │
│  DataKey::Batch(id)     → CreditBatch               │
│  DataKey::Retirement(id)→ RetirementCertificate     │
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

### State Values Table

| `PauseEnabled` | `PauseUntil` | `now` | Effective state |
|---------------|--------------|-------|-----------------|
| `false` | any | any | **RUNNING** — operations proceed |
| `true` | `T` | `now < T` | **PAUSED** — all writes blocked |
| `true` | `T` | `now ≥ T` | **RUNNING** (stale flag) — auto-cleared on next write |
| absent | absent | any | **RUNNING** — defaults to false/0 |

---

## Integration with Existing Functions

The pause guard integrates as the **first check** in every state-mutating function, before any business logic runs:

```rust
// Pattern used in carbon_credit
pub fn mint_credits(
    env: Env,
    admin: Address,
    project_id: String,
    // ... other params
) -> Result<(), CarbonError> {
    admin.require_auth();
    Self::require_role(&env, &admin, Role::Admin)?;
    Self::require_not_paused(&env)?;   // ◄── PAUSE CHECK (3rd, after auth)
    // ... business logic
}

// Pattern used in carbon_marketplace (buyer-initiated)
pub fn purchase_credits(
    env: Env,
    buyer: Address,
    listing_id: String,
    amount: i128,
) -> Result<(), CarbonError> {
    buyer.require_auth();
    Self::require_not_paused(&env)?;   // ◄── PAUSE CHECK (2nd, after auth)
    // ... business logic
}
```

### Ordering: Auth Before Pause Check

The pause check intentionally comes **after** `require_auth()`. This ordering:
1. Ensures unauthenticated callers are rejected first (no information leakage about pause state to unauthorized parties in auth-required functions).
2. Allows the admin to call `unpause_operations` regardless of pause state (that function does not call `require_not_paused`).

### Functions That Bypass the Pause Check

These functions explicitly do **not** call `require_not_paused`:

| Function | Reason |
|----------|--------|
| `pause_operations` | Must work while paused (to extend or modify pause) |
| `unpause_operations` | Must work while paused (to clear the pause) |
| `initialize` | One-time setup, runs before any pause is set |
| All read-only queries | Reads do not mutate state |

---

## Cross-Contract Interactions During Pause

### `carbon_marketplace` → `carbon_credit` (purchase flow)

When a user calls `purchase_credits` on the marketplace, it triggers a cross-contract call to `carbon_credit.transfer_credits`:

```
User → purchase_credits (marketplace)
         │
         ├─ require_not_paused() ← marketplace pause checked here
         │
         └─► transfer_credits (carbon_credit)
                  │
                  └─ require_not_paused() ← credit pause checked here
```

**Both** contracts are checked independently. If either is paused, the full transaction fails and rolls back. This means:

- Pausing `carbon_credit` also effectively pauses marketplace purchases (the cross-contract call fails).
- Pausing `carbon_marketplace` blocks purchases at the marketplace level before the cross-contract call is made.
- Either contract can be paused independently for targeted containment.

### Pause Scope Summary

| Action | Pause `carbon_credit` | Pause `carbon_marketplace` | Both paused |
|--------|----------------------|---------------------------|-------------|
| Mint credits | ❌ Blocked | ✅ Allowed | ❌ Blocked |
| List credits | ✅ Allowed | ❌ Blocked | ❌ Blocked |
| Purchase credits | ❌ Blocked (cross-contract) | ❌ Blocked | ❌ Blocked |
| Retire credits | ❌ Blocked | ✅ Allowed | ❌ Blocked |
| Query listings | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| Query certificates | ✅ Allowed | ✅ Allowed | ✅ Allowed |

---

## Off-Chain Architecture Impact

### Backend API

The NestJS backend should expose pause state via the REST API so the frontend can display appropriate messaging:

```
GET /api/v1/contracts/pause-status

Response:
{
  "carbonCredit": {
    "paused": true,
    "until": "2026-09-26T10:00:00Z",
    "isEffective": true
  },
  "carbonMarketplace": {
    "paused": false,
    "until": null,
    "isEffective": false
  }
}
```

The backend determines `isEffective` by comparing `PauseUntil` against the current time — it must not rely solely on `PauseEnabled` due to the lazy auto-expiry behavior.

### Frontend Pause Banner

When either contract is paused, the marketplace and transaction pages should display a non-dismissable banner:

```
┌────────────────────────────────────────────────────────────┐
│  ⚠️  Contract temporarily paused for maintenance            │
│  Purchases and retirements are unavailable.                │
│  Estimated resume: September 26, 2026 at 10:00 UTC         │
│  You can still browse listings and view certificates.       │
└────────────────────────────────────────────────────────────┘
```

### Oracle Services

The Python oracle bridge should:
1. Check pause state before submitting price updates that depend on marketplace state.
2. Alert the security team immediately when a pause is detected.
3. Continue submitting satellite monitoring data — `carbon_oracle` is not affected by pause.

```python
# Example: oracle pause check before price submission
def submit_price_update(project_id, price):
    pause = soroban.get_storage(MARKETPLACE_CONTRACT, "PauseEnabled")
    until = soroban.get_storage(MARKETPLACE_CONTRACT, "PauseUntil")
    if pause and until > time.time():
        alert_team(f"Marketplace paused, skipping price update for {project_id}")
        return
    # proceed with price submission
```

---

## Related Documents

- [ADR-013: Emergency Pause Mechanism](adr/ADR-013-emergency-pause.md) — Architecture decision
- [Pause Specification](pause-specification.md) — Full design specification
- [Pause API Reference](pause-api-reference.md) — Function signatures and CLI examples
- [Pause Security Analysis](pause-security-analysis.md) — Threat model and mitigations
- [Incident Response](INCIDENT_RESPONSE.md) — When to use the pause
- [Smart Contract Development Guide](SMART_CONTRACTS.md) — Building and deploying contracts
- [Contract Events Reference](contract-events.md) — All contract events
