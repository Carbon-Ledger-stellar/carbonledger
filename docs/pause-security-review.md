# Pause Feature — Security Review

> **Closes:** #1200  
> **Contracts:** `carbon_credit`, `carbon_marketplace`  
> **Last updated:** 2026-09-27  
> **Related:** [Pause Feature Spec](pause-feature-spec.md) · [Pause Contract API](pause-contract-api.md) · [ADR-013](adr/ADR-013-emergency-pause.md) · [Key Rotation Procedures](KEY_ROTATION_PROCEDURES.md)

This document provides a structured security review of the CarbonLedger emergency pause mechanism. It covers threat analysis, access control, state consistency, edge cases, mitigations, and actionable recommendations.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Threat Analysis](#2-threat-analysis)
3. [Access Control Review](#3-access-control-review)
4. [State Consistency Analysis](#4-state-consistency-analysis)
5. [Edge Cases](#5-edge-cases)
6. [Mitigation Strategies](#6-mitigation-strategies)
7. [Recommendations](#7-recommendations)
8. [Residual Risk Register](#8-residual-risk-register)
9. [Related Documents](#9-related-documents)

---

## 1. Executive Summary

The pause mechanism is an **emergency circuit breaker** for `carbon_credit` and `carbon_marketplace`. It halts all state-mutating operations for a bounded time window, giving incident responders a safe window to investigate without new on-chain state being written.

### Security Properties

| Property | Status | Evidence |
|----------|--------|---------|
| Admin-only access | ✅ Enforced | `admin.require_auth()` + role check both required |
| Bounded pause duration | ✅ Enforced | 72-hour hard cap in constraint check |
| Auto-expiry on deadline | ✅ Implemented | `require_not_paused()` lazy-clears expired flags |
| No indefinite lockout | ✅ Guaranteed | Time bound ensures recovery without action |
| Read operations unaffected | ✅ Verified | Only write-path functions call `require_not_paused` |
| Pause is not self-blocking | ✅ Guaranteed | `pause_operations` does not call `require_not_paused` |
| Unpause is not blocked | ✅ Guaranteed | `unpause_operations` does not call `require_not_paused` |
| Role rotation during pause | ✅ Verified | `grant_role`/`revoke_role` bypass pause guard (`carbon_credit`) |
| On-chain audit trail | ✅ Guaranteed | Every pause/unpause is a public Stellar transaction |

### Overall Risk Rating

**Medium** — The contract-level implementation is sound. The primary residual risks are operational: single-admin authorization (no multisig), absence of automated monitoring, and the possibility of new functions being added without the `require_not_paused` guard.

---

## 2. Threat Analysis

### 2.1 Assets Being Protected

| Asset | Protection Goal |
|-------|----------------|
| Credit balances | Prevent unauthorized minting or balance manipulation |
| Marketplace listings | Prevent price manipulation or unauthorized delistings |
| USDC flows | Prevent purchases at manipulated prices |
| Serial number registry | Prevent double-issuance during active investigation |
| Retirement certificates | Prevent fraudulent retirements from being written |

### 2.2 Threat Actors

| Actor | Trust Level | Relevant Threats |
|-------|------------|------------------|
| Admin key holder | Fully trusted | TH-01 (key compromise), TH-03 (malicious insider) |
| Registered verifier | Partially trusted | No pause access; cannot activate/deactivate |
| Oracle service | Partially trusted | No pause access; cannot activate/deactivate |
| Anonymous user | Untrusted | TH-02 (unauthorized activation attempt) |
| Malicious admin | Insider threat | TH-03 (weaponized pause), TH-05 (repeated pausing) |

---

### 2.3 Threat Scenarios

#### TH-01: Admin Key Compromise → Weaponized Pause

**Description:** An attacker compromises the admin private key and calls `pause_operations` with `until_timestamp = now + 72h`, causing a 72-hour outage. The attacker repeats this every 72 hours to maintain continuous disruption.

**Attack surface:** External (key exfiltration, phishing, insecure key storage).

**Current mitigations:**
- The 72-hour cap bounds damage per incident to a predictable maximum outage window.
- The compromised key can be rotated: `grant_role` and `revoke_role` remain available during a pause in `carbon_credit`. Once revoked, the compromised key can no longer call `unpause_operations` or `pause_operations`.
- All invocations are on-chain and publicly visible — anomalous pause activity can be detected.

**Detection:** Monitoring on `pause_operations` invocations (see M-01). Alert if pause is activated outside a known incident.

**Residual risk:** Medium — damage is bounded by 72h cap, but key rotation must complete before the attacker calls again.

---

#### TH-02: Unauthorized Pause Activation (No Admin Key)

**Description:** An attacker without admin credentials calls `pause_operations` to cause a denial of service.

**Attack surface:** Any Stellar account can submit a transaction invoking `pause_operations`.

**Mitigation chain:**
1. `admin.require_auth()` — Soroban protocol-level check. The transaction must be signed by the admin address. This check runs before any contract logic and cannot be bypassed by contract code.
2. Role check — `require_role(&env, &admin, Role::Admin)` (carbon_credit) / `require_admin(&env, &admin)` (carbon_marketplace). Reads admin address from contract storage and compares.

**Both checks must pass.** A transaction not signed by the admin address fails at step 1 before step 2 is even evaluated.

**Residual risk:** None — the Soroban auth guarantee is enforced by the protocol, not by contract code.

---

#### TH-03: Malicious Insider — Pause as Denial of Service

**Description:** A legitimate admin activates the pause to block a competitor's trades, force liquidations, or manipulate market conditions at a strategically chosen time.

**Attack surface:** Internal — valid admin credentials used maliciously.

**Mitigations:**
- Every pause activation is a public on-chain transaction — it creates an immutable, publicly visible record.
- The 72-hour cap limits the duration of each malicious pause.
- Multisig governance (recommended) would require M-of-N admins to agree, making unilateral malicious pauses impossible.
- Monitoring and alerting provide rapid detection.

**Residual risk:** Medium — single-admin model allows unilateral pause. On-chain transparency and 72h cap provide deterrence and recovery bounds, but do not prevent a determined malicious insider.

---

#### TH-04: Pause Race Condition (Exploit During Response)

**Description:** An attacker exploits a vulnerability and an admin initiates a pause in the same ledger close window. The exploit transaction lands before the pause takes effect.

**Attack surface:** The window between exploit detection and pause activation (seconds to minutes).

**Mitigations:**
- Stellar ledger close time is approximately 5 seconds. This limits the number of exploit transactions that can land during detection/response.
- No fee-based front-running mechanism is specific to pausing — both transactions compete on normal fees.
- Pre-scripted pause activation (see [PAUSE_OPERATIONS_GUIDE.md](PAUSE_OPERATIONS_GUIDE.md)) reduces response time to under 60 seconds.

**Residual risk:** Low-Medium — some exploit transactions may land before the pause is active. Post-incident recovery must account for state written between exploit detection and pause activation.

---

#### TH-05: Pause Bypass via Missing Guard (New Functions)

**Description:** A new state-mutating function is added to a contract without the `require_not_paused` call. An attacker uses this function during an active pause to circumvent the circuit breaker.

**Attack surface:** Development and code review process.

**Current exposure:** All existing state-mutating functions in `carbon_credit` and `carbon_marketplace` call `require_not_paused`. This has been manually verified.

**Mitigations:**
- PR review checklist: "Does every new state-mutating function call `require_not_paused`?"
- Adversarial tests in `contracts/adversarial_tests/tests/role_authorization.rs` cover pause enforcement.
- The internal `require_not_paused` function is well-documented and consistently placed as the first guard.

**Residual risk:** Low for existing code. Medium for future additions without enforced review process.

---

#### TH-06: Timestamp Manipulation

**Description:** An attacker attempts to manipulate `until_timestamp` or the ledger timestamp to bypass the pause window constraint or prematurely end an active pause.

**Attack surface:** Transaction submission.

**Mitigations:**
- The ledger timestamp (`env.ledger().timestamp()`) is the Stellar **consensus timestamp** — it is the agreed close time of the most recently closed ledger. No single transaction submitter can influence this value.
- `until_timestamp ≤ now` is explicitly rejected with `InvalidPauseWindow`.
- Soroban does not allow reading a "local clock" — only the consensus ledger timestamp is available.

**Residual risk:** None — Stellar's consensus mechanism makes ledger timestamp manipulation impossible for any single party.

---

#### TH-07: Direct Storage Manipulation

**Description:** An attacker crafts a transaction that writes directly to `DataKey::PauseEnabled` or `DataKey::PauseUntil`, setting pause state without calling the authorized entry points.

**Attack surface:** Soroban contract storage.

**Mitigation:** Soroban's execution model does not permit external arbitrary writes to contract storage. Storage is only writable through authorized contract entry points. The `DataKey` variants are internal to the contract and cannot be written from outside.

**Residual risk:** None — this is a Soroban platform-level guarantee.

---

#### TH-08: Cross-Contract Pause Propagation (Intended vs. Accidental)

**Description:** An admin pauses `carbon_credit` but not `carbon_marketplace`. A user's marketplace purchase that involves a cross-contract call to `carbon_credit.transfer_credits` fails mid-transaction.

**Analysis:** This is **expected behavior**, not a vulnerability. Soroban transactions are atomic — the entire `purchase_credits` call either fully succeeds or fully reverts. If the credit contract is paused, the cross-contract call fails, the entire `purchase_credits` transaction reverts, and no USDC is transferred and no credits change hands.

**Risk to users:** Users receive `ContractError(29)` from a marketplace transaction when only the credit contract is paused. This may be confusing but causes no financial loss.

**Mitigation:** User documentation clearly explains this scenario (see [Pause FAQ](pause-faq.md), question 17). The frontend should handle `ContractError(29)` received from a marketplace call with the same user-friendly error message.

**Residual risk:** None (functional), Low (UX confusion).

---

## 3. Access Control Review

### 3.1 Authorization Chain

Every pause operation enforces a two-layer authorization chain:

```
Layer 1: Soroban Protocol Auth
  admin.require_auth()
  └── Validates that the transaction includes a valid authorization
      signed by 'admin'. Failure causes transaction abort BEFORE
      any contract code runs. Cannot be bypassed by contract logic.

Layer 2: Role Check
  carbon_credit:      require_role(&env, &admin, Role::Admin)
  carbon_marketplace: require_admin(&env, &admin)
  └── Reads the stored admin address / admin role from persistent
      storage. Compares against the 'admin' argument.
      Failure: Err(Unauthorized).
```

Both layers must pass. The Soroban auth check (Layer 1) is the stronger guarantee — it operates at the protocol level independently of all contract code.

### 3.2 Role Comparison: `carbon_credit` vs `carbon_marketplace`

| Aspect | `carbon_credit` | `carbon_marketplace` |
|--------|----------------|---------------------|
| Auth check | `admin.require_auth()` | `admin.require_auth()` |
| Role check method | `require_role(&env, &admin, Role::Admin)` | `require_admin(&env, &admin)` |
| Storage model | Role map keyed by address | Single admin address stored at init |
| Equivalent security | ✅ Yes | ✅ Yes |

### 3.3 Functions That Bypass the Pause Guard

By design, the following functions do **not** call `require_not_paused`:

| Function | Reason |
|----------|--------|
| `pause_operations` | Must be callable to activate pause; calling `require_not_paused` would block re-pausing |
| `unpause_operations` | Must always be callable to restore service |
| `grant_role` / `revoke_role` | Must be available for emergency key rotation during pause |
| `initialize` | Called once at deployment before any pause state exists |
| All `get_*` query functions | Read-only; no state mutation; intentionally unrestricted |

### 3.4 Privilege Escalation Analysis

No function in the pause path allows a caller to elevate their own privileges. `pause_operations` only accepts an `admin` argument that must match the pre-stored admin address/role — a caller cannot pass a different address they control and have it accepted.

---

## 4. State Consistency Analysis

### 4.1 Atomicity

Both `pause_operations` and `unpause_operations` write two storage keys (`PauseEnabled` and `PauseUntil`) in sequence within a single Soroban invocation. Soroban commits all writes atomically at invocation end. There is no scenario where `PauseEnabled = true` is stored without a matching `PauseUntil`, or vice versa.

### 4.2 Concurrent Call Ordering

Stellar processes transactions sequentially within a ledger. Two simultaneous `pause_operations` calls in the same ledger are ordered deterministically by the network. The second transaction to execute overwrites the first. Both succeed; the last deadline wins.

This is expected behavior: in a multi-admin incident response scenario, the most recently set deadline takes precedence. Operational coordination is recommended to avoid conflicting pauses.

### 4.3 Auto-Expiry Write Safety

`require_not_paused` auto-clears stale flags by writing to storage after the deadline passes. This write is idempotent — if two transactions race on the first post-deadline call, both attempt to write `false` to `PauseEnabled`. The second write is a no-op at the storage value level but still incurs a small gas cost.

The auto-expiry write does not affect any other state and cannot cause inconsistency.

### 4.4 Reentrancy

`pause_operations` and `unpause_operations` do not make any external contract calls. They only write to the contract's own persistent storage. There is no reentrancy risk in the pause path.

`require_not_paused` is called before any external calls within gated functions — the pause check and potential auto-expiry write complete before any cross-contract interactions occur.

### 4.5 Persistence Across Ledger TTL

Pause state is stored in `Persistent` ledger entries (not `Temporary` or `Instance`). Persistent entries are not subject to automatic expiry by TTL. The pause state survives ledger entry TTL operations and cannot be accidentally cleared by routine storage maintenance.

---

## 5. Edge Cases

### EC-01: Minimal Pause Window

**Scenario:** Admin sets `until_timestamp = now + 1` (one second in the future).

**Analysis:** Valid per the constraint (`until_timestamp > now`). The pause window is at most one ledger close (~5 seconds). Any transaction landing in that window is blocked. This is technically correct but operationally pointless.

**Risk:** None. **Recommendation:** Consider a minimum guard of 60 seconds to prevent accidents (see R-06).

---

### EC-02: Pause of Already-Paused Contract

**Scenario:** Admin calls `pause_operations` while the contract is already paused.

**Analysis:** `pause_operations` does not check existing pause state before writing. It overwrites `PauseEnabled = true` with the new `PauseUntil`. The admin can effectively extend or shorten the pause deadline by calling `pause_operations` again. This is intentional and documented.

**Risk:** Low — allows extending a pause beyond the original window through repeated calls. Monitoring should alert on multiple rapid activations.

---

### EC-03: Absent Storage Keys

**Scenario:** Contract was just initialized; `PauseEnabled` and `PauseUntil` have never been written.

**Analysis:** `require_not_paused` uses `.unwrap_or(false)` and `.unwrap_or(0)` for both reads. Missing keys default to `paused = false, until = 0` — the safe, unpaused state.

**Risk:** None. The default is always safe.

---

### EC-04: Admin Key Rotated During Active Pause

**Scenario:** Admin calls `grant_role` to add a new admin during an active pause, then revokes the old admin. The old admin can no longer call `unpause_operations`.

**Analysis:** The new admin can call `unpause_operations`. If the new admin key is not yet available, the pause remains active until the deadline. This is the correct and intended behavior — the pause provides protection while the key rotation completes.

**Risk:** Medium if the new admin is unavailable. The [key rotation runbook](runbooks/key-compromise.md) should include a step to verify the new admin can perform an unpause before revoking the old key.

---

### EC-05: Near-Max Timestamp

**Scenario:** Admin sets `until_timestamp` close to `u64::MAX`.

**Analysis:** The upper bound check uses `now.saturating_add(72 * 60 * 60)`, which saturates to `u64::MAX` rather than overflowing. The comparison `until_timestamp > u64::MAX` is always `false`, so any `until_timestamp` would fail the upper bound check when `now` is near `u64::MAX`. In practice, Stellar ledger timestamps are seconds since Unix epoch and will not approach `u64::MAX` for billions of years.

**Risk:** None in practice.

---

### EC-06: Pause During Pending Frontend Session

**Scenario:** A user's browser is mid-flow (e.g., typing a purchase amount) when the contract is paused. The user submits and receives an unexpected error.

**Analysis:** The transaction fails with `ContractError(27)` or `ContractError(29)`. No funds are transferred. The user sees a contract error, which without frontend handling may be confusing.

**Risk:** Low (UX), None (financial). The proposed `PausedErrorMessage` component (see feature spec section 7.2) addresses this.

---

## 6. Mitigation Strategies

### M-01: Real-Time Monitoring and Alerting

**Target threats:** TH-01, TH-03

**Implementation:** Subscribe to Stellar Horizon's operation stream and alert immediately when `pause_operations` or `unpause_operations` is invoked on either contract.

```python
from stellar_sdk import Server

server = Server("https://horizon-testnet.stellar.org")

def monitor_pause_events(contract_id):
    ops = server.operations().for_contract(contract_id).cursor("now").stream()
    for op in ops:
        if op.get("function") in ("pause_operations", "unpause_operations"):
            send_alert(op)
```

Alert channels: PagerDuty (P1 for unexpected pause), Slack security channel, email to admin team.

---

### M-02: Pre-Scripted Emergency Pause Command

**Target threats:** TH-04 (response latency)

**Implementation:** Maintain a ready-to-run script that pauses both contracts in sequence with a configurable duration. Store it in a secure location accessible to all on-call admins.

```bash
#!/bin/bash
# Emergency pause both contracts for $1 hours (default: 6)
HOURS=${1:-6}
UNTIL=$(($(date +%s) + HOURS * 3600))

for CONTRACT in "$CARBON_CREDIT_CONTRACT_ID" "$CARBON_MARKETPLACE_CONTRACT_ID"; do
  stellar contract invoke --id "$CONTRACT" --source-account carbonledger-admin --network mainnet \
    -- pause_operations --admin "$ADMIN_ADDRESS" --until_timestamp "$UNTIL"
  echo "Paused $CONTRACT until $(date -d @$UNTIL)"
done
```

Target: admin can pause both contracts in under 5 minutes from decision to execution.

---

### M-03: PR Review Checklist for `require_not_paused`

**Target threat:** TH-05

**Implementation:** Add the following item to the PR template in `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
- [ ] Every new state-mutating function added to `carbon_credit` or `carbon_marketplace`
      calls `require_not_paused(&env)?` before any state changes or external calls.
```

Additionally, write a test that inventories all `pub fn` functions in the `#[contractimpl]` block and asserts each one that modifies storage calls `require_not_paused`.

---

### M-04: Multisig Governance for Pause Activation

**Target threat:** TH-03

**Recommendation:** Before mainnet, require M-of-N (e.g., 2-of-3) admin signatures to activate the pause. The `upgrade_governance` contract provides a multisig pattern that can be adapted. This eliminates single-admin unilateral pause risk.

---

### M-05: Admin Key Rotation Runbook

**Target threats:** TH-01, EC-04

**Implementation:** Maintain [KEY_ROTATION_PROCEDURES.md](KEY_ROTATION_PROCEDURES.md) with a dedicated section: "Key Rotation During Active Pause." Steps:

1. Verify new admin key is available and functional.
2. Call `unpause_operations` with new admin key (to confirm it has the role).
3. Re-activate pause with old admin key (still valid).
4. Call `revoke_role` for old admin.
5. New admin is now the sole authorized key.

---

### M-06: `get_pause_status` Public Function

**Target threats:** Operational visibility, TH-03 detection

**Implementation:** Add `get_pause_status()` to both contracts (FR-9 in the feature spec). This allows off-chain monitoring to reliably poll pause state without needing to read raw storage keys and apply the `PauseEnabled && until > now` logic externally. Reduces the risk of monitoring bugs missing an active pause.

---

## 7. Recommendations

### High Priority (Before Mainnet)

**R-01: Implement real-time monitoring (M-01).** Automated alerting on pause invocations is the single highest-value mitigation. An undetected unauthorized pause compounds into a key compromise incident.

**R-02: Add `get_pause_status` to both contracts (FR-9).** Reliable off-chain pause status querying is required for frontend accuracy and monitoring correctness.

**R-03: Add PR checklist item for `require_not_paused` (M-03).** This prevents TH-05 from materializing as the codebase grows.

**R-04: Document pause criteria.** Define in the incident response runbook exactly which incident types warrant activating the pause. Ambiguity leads to over-use or under-use, both of which carry risk.

### Medium Priority (Before Mainnet Recommended)

**R-05: Implement multisig for pause activation (M-04).** Single-admin pause is the largest structural risk. The `upgrade_governance` pattern demonstrates how to implement this on Stellar.

**R-06: Add minimum pause duration guard.** A 1-second pause is valid but operationally meaningless. Consider rejecting `until_timestamp < now + 60` to prevent accidental near-zero-duration pauses.

**R-07: Emit contract events on pause/unpause (FR-8).** Event-driven monitoring is lower latency and more reliable than polling storage keys.

### Low Priority (Post-Mainnet)

**R-08: Add compile-time or test-time coverage check for `require_not_paused`.** A test that automatically inventories state-mutating functions and verifies each calls `require_not_paused` would catch TH-05 before code review.

**R-09: Document the "overwrite behavior" of `pause_operations` on already-paused contract.** Currently undocumented in the source code. A comment clarifying that re-calling `pause_operations` intentionally extends or shortens the window prevents future confusion.

---

## 8. Residual Risk Register

| Risk ID | Description | Likelihood | Impact | Accepted | Owner | Notes |
|---------|-------------|-----------|--------|----------|-------|-------|
| RR-01 | Admin key compromise → weaponized pause | Low | High | Partial | Security team | Mitigated by 72h cap + key rotation; monitoring needed |
| RR-02 | Malicious insider pause (DoS) | Low | Medium | Partial | Governance | On-chain trail provides deterrence; multisig recommended |
| RR-03 | New function added without `require_not_paused` | Low | Medium | No | Engineering | Add to PR checklist (R-03) |
| RR-04 | Missing monitoring → delayed detection | Medium | Medium | No | Ops | Implement M-01 before mainnet (R-01) |
| RR-05 | Single-admin model without multisig | N/A | High | Partial | Architecture | Accepted for testnet; multisig required before mainnet |
| RR-06 | Frontend shows raw error codes instead of friendly message | Medium | Low | No | Frontend | Implement PausedErrorMessage component |

---

## 9. Related Documents

- [Pause Feature Specification](pause-feature-spec.md) — Full cross-stack feature spec
- [Pause FAQ](pause-faq.md) — Common questions for admins and users
- [Pause Contract API Reference](pause-contract-api.md) — Function signatures and error codes
- [ADR-013: Emergency Pause Mechanism](adr/ADR-013-emergency-pause.md) — Architecture decision
- [Incident Response](INCIDENT_RESPONSE.md) — Incident response procedures
- [Key Rotation Procedures](KEY_ROTATION_PROCEDURES.md) — Admin key rotation runbook
- [Emergency Pause Runbook](runbooks/emergency-pause.md) — Step-by-step incident runbook
- [Access Control Policy](access-control.md) — Role definitions and authorization model
- [Security Principles](SECURITY_PRINCIPLES.md) — Overall security posture
- [Adversarial Tests](../contracts/adversarial_tests/tests/role_authorization.rs) — Pause enforcement tests
