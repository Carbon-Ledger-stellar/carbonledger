# CarbonLedger — Pre-Audit Internal Checklist

> **Purpose:** Internal self-review to be completed before handing off to the external
> auditor. Every item must be marked ✅ (pass), ❌ (fail / known gap), or ⚠️ (partial).
> Failures must have a linked issue or inline note.
>
> **Completed by:** (your name)  
> **Date:** (fill in before audit kickoff)  
> **Audit commit:** (fill in — tag `audit/v1.0`)

---

## Vector 1 — Reentrancy

Soroban does not have EVM-style reentrancy, but cross-contract calls can still produce
unexpected state if the callee re-enters the caller before state is finalised.

| # | Check | Contract | Status | Notes |
|---|---|---|---|---|
| R1 | All state mutations in `purchase_credits` occur **before** `usdc_client.transfer()` calls | `carbon_marketplace` | ✅ | Listing updated before both transfers |
| R2 | All state mutations in `bulk_purchase` occur **before** each `usdc_client.transfer()` call | `carbon_marketplace` | ✅ | Listing updated before transfers in each loop iteration |
| R3 | No function reads state after an external call and uses that state to make a security decision | all | ✅ | No post-call state reads found |
| R4 | `retire_credits` updates batch status before emitting the event | `carbon_credit` | ✅ | Status written before `env.events().publish()` |
| R5 | No function calls back into a CarbonLedger contract from within a CarbonLedger function | all | ✅ | Only outbound call is to USDC token |

---

## Vector 2 — Authorization

Every privileged function must require both `require_auth()` and an on-chain role check.

### 2.1 `carbon_registry`

| # | Check | Status | Notes |
|---|---|---|---|
| A1 | `initialize()` requires `admin.require_auth()` | ✅ | Present |
| A2 | `initialize()` cannot be called a second time | ❌ | **Known gap — no re-init guard** |
| A3 | `register_project()` requires admin auth + `require_admin()` check | ✅ | Both present |
| A4 | `verify_project()` requires verifier auth + `require_verifier()` check | ✅ | Both present |
| A5 | `reject_project()` requires verifier auth + `require_verifier()` check | ✅ | Both present |
| A6 | `update_project_status()` requires oracle auth + `require_oracle()` check | ✅ | Both present |
| A7 | `suspend_project()` requires admin auth + `require_admin()` check | ✅ | Both present |
| A8 | `increment_issued()` requires oracle auth + `require_oracle()` check | ✅ | Both present |
| A9 | A verifier cannot approve a project they are listed as `verifier_address` on | ⚠️ | No self-approval guard; any registered verifier can approve any project |

### 2.2 `carbon_credit`

| # | Check | Status | Notes |
|---|---|---|---|
| A10 | `initialize()` cannot be called a second time | ❌ | **Known gap — no re-init guard** |
| A11 | `mint_credits()` requires admin auth + `require_admin()` check | ✅ | Both present |
| A12 | `mint_credits()` verifies project is in `Verified` status before minting | ❌ | **Known gap — no cross-contract project status check** |
| A13 | `retire_credits()` requires `holder.require_auth()` | ✅ | Present |
| A14 | `retire_credits()` verifies `holder` owns the batch | ❌ | **Known gap — no ownership map** |
| A15 | `transfer_credits()` requires `from.require_auth()` | ✅ | Present |
| A16 | `transfer_credits()` updates an on-chain ownership record | ❌ | **Known gap — transfer is a no-op** |

### 2.3 `carbon_marketplace`

| # | Check | Status | Notes |
|---|---|---|---|
| A17 | `initialize()` cannot be called a second time | ❌ | **Known gap — no re-init guard** |
| A18 | `list_credits()` requires `seller.require_auth()` | ✅ | Present |
| A19 | `list_credits()` verifies seller holds the batch being listed | ❌ | **Known gap — no ownership check** |
| A20 | `delist_credits()` requires `seller.require_auth()` + seller == listing.seller | ✅ | Both present |
| A21 | `purchase_credits()` requires `buyer.require_auth()` | ✅ | Present |
| A22 | `bulk_purchase()` requires `buyer.require_auth()` | ✅ | Present |

### 2.4 `carbon_oracle`

| # | Check | Status | Notes |
|---|---|---|---|
| A23 | `initialize()` cannot be called a second time | ❌ | **Known gap — no re-init guard** |
| A24 | `submit_monitoring_data()` requires oracle auth + `require_oracle()` | ✅ | Both present |
| A25 | `update_credit_price()` requires oracle auth + `require_oracle()` | ✅ | Both present |
| A26 | `flag_project()` requires oracle auth + `require_oracle()` | ✅ | Both present |

---

## Vector 3 — Integer Overflow / Underflow

Rust's overflow behaviour in `#![no_std]` Wasm release builds is **wrapping** (not
panicking). All arithmetic on financial values must use checked or saturating operations.

| # | Expression | Contract | Status | Notes |
|---|---|---|---|---|
| I1 | `listing.price_per_credit * amount` (total_cost) | `carbon_marketplace` | ❌ | **Unchecked i128 multiplication — overflow possible** |
| I2 | `total_cost / 100` (protocol fee) | `carbon_marketplace` | ✅ | Division cannot overflow |
| I3 | `total_cost - protocol_fee` (seller proceeds) | `carbon_marketplace` | ✅ | `protocol_fee <= total_cost` always |
| I4 | `listing.amount_available -= amount` | `carbon_marketplace` | ✅ | Guarded by `amount > listing.amount_available` check |
| I5 | `batch.serial_start + already_retired as u64` | `carbon_credit` | ❌ | **i128 → u64 cast without bounds check; wraps if already_retired > u64::MAX** |
| I6 | `retire_serial_start + amount as u64 - 1` | `carbon_credit` | ❌ | **i128 → u64 cast; also underflows if amount == 0 (guarded, but cast is unsafe)** |
| I7 | `batch.amount - new_retired` | `carbon_credit` | ✅ | `new_retired = already_retired + amount`; `amount <= active_amount` is checked |
| I8 | `already_retired + amount` (new_retired) | `carbon_credit` | ⚠️ | Both are i128; overflow requires >9.2×10¹⁸ credits — practically impossible but unchecked |
| I9 | `project.total_credits_issued += amount` | `carbon_registry` | ⚠️ | Unchecked i128 addition; overflow requires astronomical credit volumes |
| I10 | Serial range overlap check `start <= r.end && end >= r.start` | `carbon_credit` | ✅ | Pure comparison, no arithmetic |

---

## Vector 4 — Serial Number Collision / Double-Counting

| # | Check | Status | Notes |
|---|---|---|---|
| S1 | Exact duplicate range `[1,100]` vs `[1,100]` is rejected | ✅ | Overlap check catches this |
| S2 | Partial overlap `[1,100]` vs `[50,150]` is rejected | ✅ | `50 <= 100 && 150 >= 1` → true |
| S3 | Containment `[1,100]` vs `[20,80]` is rejected | ✅ | `20 <= 100 && 80 >= 1` → true |
| S4 | Reverse containment `[20,80]` vs `[1,100]` is rejected | ✅ | `1 <= 80 && 100 >= 20` → true |
| S5 | Adjacent ranges `[1,100]` vs `[101,200]` are allowed | ✅ | `101 <= 100` is false → no overlap |
| S6 | Single-credit batch `serial_start == serial_end` is handled | ✅ | `serial_end < serial_start` check allows equal values |
| S7 | `serial_end < serial_start` is rejected | ✅ | Explicit check in `mint_credits` |
| S8 | Duplicate `batch_id` with different serial range is rejected | ✅ | `has(&DataKey::Batch(batch_id))` check |
| S9 | `SerialRegistry` is initialised to empty Vec on first `initialize()` | ✅ | `vec![&env]` set in `initialize()` |
| S10 | `SerialRegistry` is read with `unwrap_or_else(|| vec![env])` fallback | ✅ | Safe if storage entry missing |
| S11 | Serial numbers in retirement certificate match the correct slice of the batch | ⚠️ | Correct when `already_retired` fits in u64; see I5 |
| S12 | `SerialRegistry` Vec growth is bounded or has a DoS mitigation | ❌ | **Unbounded growth; O(n) check; no mitigation** |

---

## General Checks

| # | Check | Status | Notes |
|---|---|---|---|
| G1 | All `unwrap()` calls on storage reads are safe (value always present) | ⚠️ | `get(&DataKey::UsdcToken).unwrap()` and `get(&DataKey::Admin).unwrap()` in marketplace will panic if called before `initialize()` |
| G2 | All events include sufficient data for off-chain indexing | ✅ | All events include IDs and key values |
| G3 | No secret keys or credentials in source code | ✅ | |
| G4 | `#![no_std]` is declared in all contracts | ✅ | |
| G5 | All contracts use `contracterror` for error types | ✅ | |
| G6 | Retirement certificate `retirement_id` is caller-supplied — collision possible | ❌ | **No deduplication check on retirement_id** |
| G7 | `tx_hash` in retirement certificate is caller-supplied — can be falsified | ⚠️ | Accepted; Soroban does not expose tx hash natively |
| G8 | Price cache uses `temporary()` storage with TTL extension | ✅ | 24-hour TTL set correctly |
| G9 | Monitoring freshness check uses `saturating_sub` to avoid underflow | ✅ | `now.saturating_sub(ts)` |
| G10 | All 30 unit tests pass on `cargo test` | (run before audit kickoff) | |

---

## Pre-Audit Sign-Off

Before tagging `audit/v1.0`, confirm:

- [ ] All ✅ items verified by a second team member
- [ ] All ❌ items have a linked GitHub issue with `pre-mainnet` label
- [ ] `cargo test` passes with zero failures
- [ ] `cargo clippy -- -D warnings` passes with zero warnings
- [ ] `cargo build --target wasm32-unknown-unknown --release` succeeds for all four contracts
- [ ] AUDIT_SCOPE.md, SECURITY.md, and this checklist committed to the audit branch
- [ ] Audit commit hash communicated to auditor

---

## Known Gaps Summary (items requiring pre-mainnet fixes)

| ID | Gap | Severity estimate | Contract(s) |
|---|---|---|---|
| KG-1 | No re-initialisation guard on any `initialize()` | Critical | all four |
| KG-2 | `retire_credits` has no ownership check | High | `carbon_credit` |
| KG-3 | `transfer_credits` does not update ownership | High | `carbon_credit` |
| KG-4 | `mint_credits` does not check project status | High | `carbon_credit` |
| KG-5 | `i128 → u64` cast in serial slice computation | High | `carbon_credit` |
| KG-6 | Unchecked `i128` multiplication in purchase total | High | `carbon_marketplace` |
| KG-7 | `listing_id` not deduplicated in `list_credits` | Medium | `carbon_marketplace` |
| KG-8 | `retirement_id` not deduplicated in `retire_credits` | Medium | `carbon_credit` |
| KG-9 | `list_credits` does not verify seller holds the batch | Medium | `carbon_marketplace` |
| KG-10 | `SerialRegistry` grows unboundedly | Low | `carbon_credit` |
