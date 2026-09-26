# Pause Mechanism Security Analysis

> **Contracts:** `carbon_credit`, `carbon_marketplace`  
> **Last updated:** 2026-09-25  
> **Closes:** #1290

This document analyzes the security properties, threat model, and risk mitigations for the CarbonLedger pause mechanism.

---

## Table of Contents

- [Summary](#summary)
- [Threat Model](#threat-model)
- [Access Control Review](#access-control-review)
- [State Consistency Analysis](#state-consistency-analysis)
- [Edge Cases](#edge-cases)
- [Mitigation Strategies](#mitigation-strategies)
- [Recommendations](#recommendations)
- [Residual Risks](#residual-risks)

---

## Summary

The pause mechanism is an **emergency circuit breaker** implemented in both `carbon_credit` and `carbon_marketplace`. It provides a last-resort capability to halt state-mutating operations during active exploits or critical incidents.

**Security properties:**

| Property | Status | Notes |
|----------|--------|-------|
| Admin-only access | ✅ Enforced | Role check + Soroban auth required |
| Bounded pause duration | ✅ Enforced | 72-hour hard maximum |
| Auto-expiry on deadline | ✅ Implemented | Lazy clear on next call |
| No indefinite lockout | ✅ Guaranteed | Time bound prevents permanent freeze |
| Read operations unaffected | ✅ Verified | Only write-path checks `require_not_paused` |
| Pause is not pauseable | ✅ Guaranteed | `pause_operations` itself does not call `require_not_paused` |
| Unpause is not blocked | ✅ Guaranteed | `unpause_operations` does not call `require_not_paused` |

---

## Threat Model

### Assets Being Protected

1. **Carbon credit integrity** — Prevents minting of fraudulent credits or manipulation of existing batches during an incident.
2. **Marketplace liquidity** — Prevents purchases at manipulated prices if a price oracle is compromised.
3. **Retirement finality** — Prevents irreversible retirements from being triggered by an exploiter who has gained temporary control.
4. **Serial number registry** — Prevents double-issuance attacks during an active investigation.

### Threat Actors

| Actor | Trust Level | Threat |
|-------|------------|--------|
| Admin key holder | Fully trusted | Key compromise → unauthorized pause/unpause |
| Registered verifier | Partially trusted | Cannot access pause (Admin role required) |
| Oracle | Partially trusted | Cannot access pause (Admin role required) |
| Anonymous user | Untrusted | No access to pause functions |
| Malicious admin | Insider threat | Weaponized pause (denial of service) |

### Threat Scenarios

#### TH-01: Unauthorized Pause Activation

An attacker without admin credentials attempts to pause the contract to cause a denial of service.

**Attack vector:** Call `pause_operations` with a non-admin address.

**Mitigation:** `admin.require_auth()` fails at the Soroban layer before any contract logic runs. Additionally, `require_role`/`require_admin` provides a second check. The transaction is rejected.

**Residual risk:** None — both the Soroban auth check and the role check must pass.

---

#### TH-02: Admin Key Compromise → Weaponized Pause

An attacker compromises the admin private key and uses it to repeatedly pause the contract, preventing all operations.

**Attack vector:** Call `pause_operations` with a stolen admin key, setting `until_timestamp = now + 72h`. Repeat every 72 hours.

**Mitigation:**
- The 72-hour cap limits damage per incident — there is a predictable window to rotate the key.
- Key rotation (changing the admin address in the contract) renders the compromised key useless.
- Monitoring should alert when `pause_operations` is called (see [Recommendations](#recommendations)).

**Residual risk:** Medium. A compromised admin key can cause up to 72 hours of downtime per use. Key rotation procedures documented in [KEY_ROTATION_PROCEDURES.md](../docs/KEY_ROTATION_PROCEDURES.md) should be followed immediately.

---

#### TH-03: Admin Pause as Denial-of-Service (Malicious Insider)

A malicious admin deliberately pauses the contract to block a competitor's transactions or force a specific outcome in ongoing trades.

**Attack vector:** Legitimate admin credentials used to activate pause at a strategically chosen time.

**Mitigation:**
- The pause is visible on-chain — all invocations are recorded in Stellar's transaction history.
- The 72-hour cap limits exposure.
- Governance processes (multisig, timelocks) can be added to require consensus before pause activation (see [Recommendations](#recommendations)).
- Monitoring can alert on all pause activations.

**Residual risk:** Medium. Single-admin pause activation without multisig is a concentration of power. See [Recommendations](#recommendations).

---

#### TH-04: Pause Race Condition (Exploit During Response)

An attacker exploits a vulnerability and an admin initiates a pause simultaneously. The attacker front-runs the pause transaction.

**Attack vector:** Attacker submits exploit transaction and admin submits `pause_operations` in the same ledger close. On Stellar, transaction ordering within a ledger is deterministic but not controllable.

**Mitigation:**
- Stellar ledger close time (~5 seconds) limits the number of exploit transactions between detection and pause.
- The pause transaction itself has no fee-based front-running risk specific to pausing — both transactions compete on standard fee.
- Responding quickly (sub-ledger-close detection) minimizes the window.

**Residual risk:** Low-Medium. A small number of exploit transactions may execute before the pause takes effect. Post-incident recovery procedures should account for this.

---

#### TH-05: Pause Bypass via Read Path

An attacker attempts to bypass pause protection by exploiting a code path that does not call `require_not_paused`.

**Attack vector:** Identify a state-mutating function that lacks the `require_not_paused` call.

**Current exposure:** All state-mutating functions in scope have been verified to call `require_not_paused`. However, future additions could inadvertently omit this check.

**Mitigation:**
- `require_not_paused` is called as the first guard in every state-mutating function.
- Code review checklist should include "does this function call `require_not_paused`?"
- Audit tests (`adversarial_tests/tests/role_authorization.rs`) cover pause state enforcement.

**Residual risk:** Low under current code. Medium for future additions without enforced review.

---

#### TH-06: Timestamp Manipulation

An attacker attempts to manipulate `until_timestamp` or the ledger clock to bypass or prematurely end a pause.

**Attack vector:** Submit a `pause_operations` call with a past timestamp to immediately self-expire the pause, or rely on an unreliable ledger clock.

**Mitigation:**
- `until_timestamp <= now` is explicitly rejected with `InvalidPauseWindow`.
- `env.ledger().timestamp()` is the Stellar consensus timestamp — it cannot be manipulated by a single transaction submitter.
- Soroban uses the network-agreed ledger close time, not a local clock.

**Residual risk:** None for timestamp manipulation. The ledger timestamp is consensus-derived.

---

#### TH-07: Storage Key Collision

An attacker crafts a transaction that writes to `DataKey::PauseEnabled` directly, bypassing the pause function.

**Attack vector:** Direct storage manipulation via a crafted XDR.

**Mitigation:** Soroban does not allow arbitrary storage writes from outside a contract. Storage writes are only possible through contract entry points. The `DataKey` enum is contract-internal and not writable externally.

**Residual risk:** None — this is a Soroban platform guarantee.

---

## Access Control Review

### Role Hierarchy for Pause Operations

```
Admin
  ├── pause_operations()     ← Only Admin
  └── unpause_operations()   ← Only Admin

Verifier              ← Cannot pause
Oracle                ← Cannot pause
MarketplaceAdmin      ← Cannot pause (carbon_credit)
Anonymous             ← Cannot pause
```

### Authorization Chain

Every pause-related operation follows this authorization chain:

```
1. Soroban runtime: admin.require_auth()
   └── Validates transaction signature against admin address
   └── Failure: transaction rejected before any contract code runs

2. Role check: require_role(&env, &admin, Role::Admin)
   └── Reads admin address from contract storage
   └── Compares against the provided admin argument
   └── Failure: Err(Unauthorized) or Err(UnauthorizedVerifier)
```

Both checks must pass. The Soroban auth check is at the protocol level and cannot be bypassed by contract logic.

### Difference Between Contracts

| Check | `carbon_credit` | `carbon_marketplace` |
|-------|----------------|---------------------|
| Auth | `admin.require_auth()` | `admin.require_auth()` |
| Role | `require_role(&env, &admin, Role::Admin)` | `require_admin(&env, &admin)` |
| Behavior | Checks against `Role::Admin` in the roles storage map | Checks against the single admin address stored at initialization |

Both are equivalent in effect: only the designated contract administrator can invoke pause operations.

---

## State Consistency Analysis

### Atomicity

`pause_operations` writes two storage keys (`PauseEnabled` and `PauseUntil`) in sequence. In Soroban, all writes within a single invocation are committed atomically — either both succeed or neither persists. There is no scenario where `PauseEnabled = true` is stored without a corresponding `PauseUntil`.

### Consistency Under Concurrent Calls

Soroban does not allow true concurrent execution — the Stellar network processes transactions sequentially within a ledger. Two simultaneous `pause_operations` calls in the same ledger will be ordered deterministically. The last one to execute wins.

**Scenario:** Two admins call `pause_operations` simultaneously with different timestamps. The transaction that executes second sets the final `PauseUntil`. Both succeed, and the later timestamp wins.

This is an expected behavior — the second admin's intent supersedes the first. In practice, pause activation is a coordinated incident response action.

### Consistency of Auto-Expiry

Auto-expiry in `require_not_paused` writes to storage (clearing `PauseEnabled` and `PauseUntil`). This write consumes a small amount of gas on the first post-deadline call. Callers should be aware that the first successful call after a pause deadline may consume slightly more gas than subsequent calls.

The write is idempotent — if two transactions race to be the first post-deadline call, both will attempt to write `false` to `PauseEnabled`. The second write is a no-op at the storage level.

### Reentrancy

`pause_operations` and `unpause_operations` do not call external contracts. They only interact with the contract's own persistent storage. There is no reentrancy risk in the pause path.

`require_not_paused` is called before any external calls (including cross-contract calls to the oracle or credit contract), which is correct: the pause check happens before any state changes or external interactions.

---

## Edge Cases

### EC-01: Pause Immediately Before Expiry

**Scenario:** Admin calls `pause_operations` with `until_timestamp = now + 1` (one second in the future). The pause expires almost immediately.

**Analysis:** Valid per the constraints (`until_timestamp > now`). The pause is technically active for up to one ledger close (~5 seconds). Any transaction that lands in that window is blocked. In practice, a 1-second pause window is not useful operationally.

**Risk:** None — this is permitted behavior. No security implications.

---

### EC-02: Unpause of Non-Paused Contract

**Scenario:** Admin calls `unpause_operations` when `PauseEnabled = false`.

**Analysis:** The function writes `false` to `PauseEnabled` and `0` to `PauseUntil` — idempotent. Returns `Ok(())`.

**Risk:** None — this is intentionally idempotent. No state corruption.

---

### EC-03: Pause State Keys Absent from Storage

**Scenario:** The contract was just initialized and no pause has ever been set. Storage has no `PauseEnabled` or `PauseUntil` entries.

**Analysis:** `require_not_paused` uses `.unwrap_or(false)` and `.unwrap_or(0)` for both reads. Absent keys default to not-paused. The contract operates normally.

**Risk:** None — the default state is safe (unpaused).

---

### EC-04: Pause Activated During Pending Cross-Contract Call

**Scenario:** A `purchase_credits` call in `carbon_marketplace` has initiated a cross-contract call to `carbon_credit.transfer_credits`. The admin activates the pause on `carbon_credit` before the cross-contract call lands.

**Analysis:** Cross-contract calls in Soroban are synchronous and atomic within a single transaction. The pause activation is a separate transaction — it cannot interleave mid-transaction. The `purchase_credits` call either fully completes (if it executes before the pause transaction) or the pause is active before `purchase_credits` runs.

**Risk:** None — atomicity of Soroban transactions prevents mid-call state injection.

---

### EC-05: Pause on Already-Paused Contract

**Scenario:** Admin calls `pause_operations` when the contract is already paused.

**Analysis:** `pause_operations` does not check whether the contract is currently paused. It overwrites `PauseEnabled = true` and sets a new `PauseUntil`. The new deadline can be earlier or later than the existing one. The admin can extend or shorten a pause by calling `pause_operations` again.

**Risk:** Low. This allows extending a pause beyond the original window by repeated calls. Monitoring should alert on multiple rapid pause activations.

---

### EC-06: Admin Key Rotated While Contract is Paused

**Scenario:** During an active pause, the admin key is rotated (new admin address set in contract storage). The old admin's `unpause_operations` call now fails role check.

**Analysis:** Only the new admin can call `unpause_operations`. If the new admin is not operational yet, the contract remains paused until the deadline.

**Risk:** Medium. Key rotation during an active pause should be coordinated carefully to ensure the new admin can perform the unpause. Document this in the key rotation runbook.

---

### EC-07: Near-Max Timestamp Overflow

**Scenario:** Admin provides `until_timestamp` close to `u64::MAX`.

**Analysis:** The constraint `until_timestamp > now.saturating_add(72 * 60 * 60)` uses `saturating_add`, which returns `u64::MAX` rather than overflowing if `now` is near `u64::MAX`. The comparison `until_timestamp > u64::MAX` is always false, so any valid `until_timestamp` would fail the upper bound check. In practice, Stellar ledger timestamps are Unix epoch seconds and will not approach `u64::MAX` for billions of years.

**Risk:** None in practice.

---

## Mitigation Strategies

### M-01: Monitoring and Alerting

**Implementation:** Set up monitoring that triggers an alert whenever `pause_operations` or `unpause_operations` is called on either contract.

```python
# Example: monitor Stellar horizon for pause invocations
# Filter contract invocations by function name
horizon.operations().for_contract(CREDIT_CONTRACT_ID).stream(
    on_message=lambda op: alert_if_pause(op)
)
```

Alert channels: PagerDuty, Slack security channel, email to contract admin team.

**Covers:** TH-02, TH-03.

---

### M-02: Multisig Governance for Pause Activation

**Recommendation:** Require M-of-N admin approval before a pause can be activated (see [Recommendations](#recommendations)).

**Current gap:** A single admin can pause either contract unilaterally. The upgrade governance contract (`upgrade_governance`) demonstrates multisig patterns that could be adapted.

**Covers:** TH-03.

---

### M-03: Incident Response Runbook

**Implementation:** Maintain a runbook that documents:
1. When to activate the pause (criteria for emergency use)
2. Who is authorized to activate it
3. How to communicate the pause to affected users
4. How to investigate while paused
5. Criteria for unpausing or allowing the deadline to expire
6. Post-incident review process

**Reference:** [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) — add a "Contract Pause" section.

**Covers:** TH-02, TH-03, TH-04.

---

### M-04: Code Review Checklist for New Functions

**Implementation:** Add to the PR checklist: "Does this new state-mutating function call `require_not_paused` at the start?"

Optionally, create a procedural macro or trait that enforces this at compile time for all `#[contractimpl]` functions marked with a custom attribute.

**Covers:** TH-05.

---

### M-05: Key Rotation Procedures

**Implementation:** Follow [KEY_ROTATION_PROCEDURES.md](KEY_ROTATION_PROCEDURES.md) for admin key rotation. The runbook should include a step: "If the contract is currently paused, coordinate unpause timing with key rotation."

**Covers:** TH-02, EC-06.

---

## Recommendations

### High Priority

1. **Add monitoring for pause invocations.** Any pause activation should trigger an immediate alert to the security team. This is the single highest-value mitigation.

2. **Add a dedicated `get_pause_status` function.** Off-chain monitoring and the frontend need a reliable way to query effective pause state without reading raw storage keys and applying the `PauseEnabled && PauseUntil > now` logic themselves.

3. **Document the pause criteria.** Define in the incident response runbook exactly which incident types warrant activating the pause. Ambiguity leads to either under-use (failing to protect during an exploit) or over-use (unnecessary service disruption).

### Medium Priority

4. **Consider multisig for pause activation.** A single-admin pause is a concentration of power. Requiring 2-of-3 admin signatures would prevent a single compromised key from pausing the contract. The `upgrade_governance` contract provides a pattern for this.

5. **Emit events on pause/unpause.** Contract events make monitoring more reliable and reduce latency compared to polling storage keys. The cost (a small Soroban ledger fee) is justified by the improved observability during incidents.

6. **Add an explicit minimum pause duration guard.** While technically valid, a `until_timestamp = now + 1` pause is operationally meaningless. Consider a minimum of 60 seconds to prevent accidents.

### Low Priority

7. **Add invariant test for `require_not_paused` coverage.** Verify at test time that every function in the `#[contractimpl]` block that mutates state calls `require_not_paused`. This could be done with a test that inventories functions via the contract metadata.

8. **Clarify the behavior of `pause_operations` when already paused.** The current behavior (overwrite deadline) is correct but undocumented. Add a comment in the source code clarifying this is intentional.

---

## Residual Risks

| Risk | Likelihood | Impact | Accepted? | Notes |
|------|-----------|--------|-----------|-------|
| Admin key compromise enabling repeated pause | Low | High | Partially | Mitigated by 72h cap + key rotation procedures |
| Malicious insider pause (DoS) | Low | Medium | Partially | Mitigated by on-chain audit trail; multisig recommended |
| New function added without `require_not_paused` | Low | Medium | No | Add to PR review checklist |
| Missing monitoring creates delayed detection | Medium | Medium | No | Implement M-01 before mainnet |
| Single-admin pause without multisig | N/A | High | Partially | Accepted for now; multisig recommended before mainnet |

---

## Related Documents

- [Pause Specification](pause-specification.md) — Design decisions and state model
- [Pause API Reference](pause-api-reference.md) — Function signatures and parameters
- [ADR-013: Emergency Pause Mechanism](adr/ADR-013-emergency-pause.md) — Architecture decision
- [Incident Response](INCIDENT_RESPONSE.md) — Incident response procedures
- [Key Rotation Procedures](KEY_ROTATION_PROCEDURES.md) — Admin key rotation runbook
- [Access Control Policy](access-control.md) — Role definitions and authorization model
- [Security Principles](SECURITY_PRINCIPLES.md) — Overall security posture
