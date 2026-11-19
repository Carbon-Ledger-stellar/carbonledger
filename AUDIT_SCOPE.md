# CarbonLedger — Smart Contract Audit Scope

> **Status:** Pre-mainnet | **Priority:** Critical | **Target:** Q2 2026  
> **Prepared:** 2026-04-24 | **Revision:** 1.0

---

## 1. Engagement Overview

CarbonLedger is a decentralised carbon credit marketplace on Stellar Soroban. Credits
represent real-world carbon sequestration tonnes (RWAs). Retirement is permanently
irreversible on-chain. The system handles USDC payments and enforces global serial-number
uniqueness to prevent double-counting.

We are seeking a full security audit of all four Soroban smart contracts before mainnet
deployment. The audit report must be published publicly as a condition of launch.

---

## 2. Contracts in Scope

| Contract | Source file | SLOC (approx.) | Role |
|---|---|---|---|
| `carbon_registry` | `contracts/carbon_registry/src/lib.rs` | ~260 | Project registration, verification, lifecycle |
| `carbon_credit` | `contracts/carbon_credit/src/lib.rs` | ~380 | Mint, retire, transfer credits; serial registry |
| `carbon_marketplace` | `contracts/carbon_marketplace/src/lib.rs` | ~320 | Listings, purchases, bulk buys, USDC settlement |
| `carbon_oracle` | `contracts/carbon_oracle/src/lib.rs` | ~240 | Monitoring data, benchmark prices, project flags |

**Total in-scope:** ~1,200 SLOC of Rust / Soroban SDK code.

### Out of scope
- Frontend (`frontend/`)
- Backend API (`backend/`)
- Oracle Python bridge (`oracle/`)
- Off-chain database (PostgreSQL / IPFS)
- Stellar network infrastructure

---

## 3. Audit Vectors (Required Coverage)

The following four vectors are **mandatory** and must each have dedicated findings sections
in the final report.

### 3.1 Reentrancy
Soroban's execution model differs from EVM, but cross-contract calls (e.g., the USDC
`token::Client` calls in `carbon_marketplace`) can still produce unexpected re-entrant
state if the callee invokes back into CarbonLedger contracts. Auditors must verify:

- `purchase_credits` and `bulk_purchase` follow strict checks-effects-interactions order
- No state mutation occurs after the `usdc_client.transfer()` calls
- `bulk_purchase` loop cannot be exploited to re-enter a partially-updated listing

### 3.2 Authorization
Every privileged function must be gated by both `require_auth()` and an on-chain role
check. Auditors must verify:

- `mint_credits` — admin-only; no path allows an arbitrary caller to mint
- `verify_project` / `reject_project` — verifier set enforced; verifier cannot self-approve
  a project they submitted
- `update_project_status` / `increment_issued` — oracle-only; oracle key compromise blast
  radius
- `retire_credits` — any holder can retire, but only credits they legitimately hold
- `delist_credits` — only the original seller; no admin override path
- `initialize` functions — callable only once; no re-initialisation vector
- `suspend_project` — admin-only; cannot be called by verifier or oracle

### 3.3 Integer Overflow / Underflow
All arithmetic uses `i128` (signed) and `u64` (serial numbers). Rust's default debug
overflow panics do not apply in `#![no_std]` Wasm release builds. Auditors must verify:

- `total_cost = price_per_credit * amount` in `purchase_credits` and `bulk_purchase` —
  overflow possible with large values
- `serial_start + already_retired as u64` in `retire_credits` — cast from `i128` to `u64`
  without bounds check
- `batch.amount - new_retired` — underflow if `new_retired` somehow exceeds `batch.amount`
- `total_credits_issued += amount` in `increment_issued` — unchecked addition
- Protocol fee calculation `total_cost / 100` — rounding behaviour and dust accumulation

### 3.4 Serial Number Collision / Double-Counting
The global `SerialRegistry` is the primary defence against double-counting. Auditors must
verify:

- `verify_serial_range_internal` correctly detects all overlap cases including:
  - Exact duplicates
  - Partial overlaps (new range starts inside existing range)
  - Containment (new range fully inside existing range)
  - Reverse containment (new range fully contains existing range)
- The `SerialRegistry` Vec grows unboundedly — assess DoS risk as registry scales
- `serial_end < serial_start` edge case (single-credit batch where `serial_end == serial_start`)
- The `already_retired as u64` cast in `retire_credits` serial slice computation
- No path exists to mint a batch with a `batch_id` that already exists but different serials

---

## 4. Security Model Overview

This section states the trust assumptions the protocol relies on. Auditors should treat
every assumption below as a potential finding if it cannot be justified by code.

### 4.1 Trust Assumptions per Actor

| Actor | Trusted to | If compromised / malicious |
|---|---|---|
| **Admin** | Initialize contracts correctly, suspend fraudulent projects, set the oracle key, and authorize upgrades. | Full protocol control: can suspend any project, repoint the oracle, and (via upgrade path) replace contract logic. Blast radius is protocol-wide; there is no timelock or multisig enforced on-chain. |
| **Verifier** | Approve or reject projects honestly and never self-approve a project they submitted. | Fraudulent projects can be verified and credits minted against non-existent sequestration. The verifier set is frozen at init, so a compromised verifier cannot be removed on-chain. |
| **Oracle** | Push truthful monitoring data, benchmark prices, and project status flags. | False monitoring data, manipulated benchmark prices, and arbitrary `update_project_status` / `increment_issued` calls. Single key — no quorum or deviation guard. |
| **Corporation / holder** | Retire only credits they legitimately hold and list only credits they own. | Note: `retire_credits` currently has no ownership check and `transfer_credits` is a no-op, so a holder's "ownership" is not enforced on-chain. A malicious holder can retire arbitrary batches (see §4.3). |
| **Anonymous public caller** | Nothing. All state-changing entry points must be gated by `require_auth()` plus a role check. | Any ungated entry point is a critical finding. Auditors must confirm no public path can mint, verify, suspend, or move funds. |
| **Off-chain backend / oracle bridge** | Compute monitoring inputs and sign oracle submissions with the oracle key. | Same blast radius as the oracle key itself. The bridge is out of audit scope, so its compromise is modelled as oracle compromise. |

### 4.2 Admin Powers and Upgrade Paths

Privileged operations and how they are authorized:

| Operation | Authorization | Notes |
|---|---|---|
| `initialize` | First caller only (no on-chain guard against re-init) | Second call overwrites admin — see §5. |
| `suspend_project` | Admin `require_auth()` | Admin-only; verifier and oracle cannot call it. |
| Verifier set | Set at `initialize`; **no** `add_verifier` / `remove_verifier` | Frozen for contract lifetime. |
| Oracle key | Set at `initialize`; changed only via admin path | Single key, no rotation ceremony enforced on-chain. |
| Contract upgrade / versioning | Admin-authorized deployment of `carbon_registry_v1` → `carbon_registry_v2` (and equivalents for other contracts) | Upgrades are executed by deploying a new contract version and migrating state; there is no in-place `upgrade()` entry point. Auditors must review the migration path and confirm callers are repointed atomically. |

Upgrade authorization is therefore an **off-chain governance decision** executed by the
admin key. There is no on-chain timelock, multisig threshold, or upgrade delay; this is an
accepted risk documented below.

### 4.3 Known Limitations (Accepted Risks)

The following are known and accepted for the v1.0 audit; auditors should still assess
impact and confirm the mitigations described in `SECURITY.md`:

- **Single oracle key** — no quorum; compromise = full oracle power.
- **Frozen verifier set** — no on-chain add/remove; a compromised verifier persists.
- **Unbounded `SerialRegistry` growth** — registry Vec grows with every mint; DoS risk as it scales.
- **No on-chain price-deviation guard** — a single oracle update can move price arbitrarily.
- **`transfer_credits` no-op** — emits an event but updates no ownership mapping.
- **`bulk_purchase` atomicity** — partial failure mid-loop can leave listings updated and USDC transferred.

Disclosure policy, secrets handling, and incident response are documented in
[`SECURITY.md`](./SECURITY.md); auditors should read it alongside this scope.

---

## 5. Additional Areas of Interest

These are not primary vectors but should be covered in the report:

| Area | Concern |
|---|---|
| Re-initialisation | `initialize()` has no guard against being called twice; second call overwrites admin |
| Oracle single point of failure | Single oracle address; compromise = ability to push false monitoring data and prices |
| Verifier set mutability | No `add_verifier` / `remove_verifier` function; verifier set is frozen at init |
| Listing ID collision | `list_credits` does not check if `listing_id` already exists; silently overwrites |
| `retire_credits` holder check | Any address can retire any batch — no ownership model enforced |
| `transfer_credits` no-op | Transfer emits an event but does not update any ownership mapping |
| Price deviation | No on-chain guard against a single oracle update moving price by >15% |
| Methodology score | Score below 70 emits a warning event but does not block credit issuance |
| `bulk_purchase` atomicity | Partial failure mid-loop leaves some listings updated and USDC transferred |

---

## 6. Acceptance Criteria

| Severity | Requirement before mainnet |
|---|---|
| Critical | All findings resolved and re-audited |
| High | All findings resolved and re-audited |
| Medium | All findings resolved OR formally accepted with written rationale |
| Low / Informational | Acknowledged in public report; resolution at team discretion |

A **re-audit** of any contract that receives code changes post-fix is required before
mainnet deployment. Re-audit scope is limited to changed contracts plus any contracts
that call them.

---

## 7. Deliverables Expected from Auditor

1. Full written audit report (PDF + Markdown)
2. Findings classified by severity: Critical / High / Medium / Low / Informational
3. Per-finding: description, impact, proof-of-concept or reproduction steps, recommended fix
4. Executive summary suitable for public disclosure
5. Re-audit report after fixes are applied
6. Public disclosure of final report (we will publish on our GitHub and website)

---

## 8. Methodology

Auditors should apply:

- Manual code review of all in-scope Rust source files
- Soroban-specific threat modelling (cross-contract calls, storage TTL, auth model)
- Fuzzing of arithmetic-heavy paths (serial range checks, fee calculations)
- Symbolic execution where applicable
- Review of all 30 existing unit tests for coverage gaps

---

## 9. Repository Access

```
https://github.com/YOUR_USERNAME/carbonledger
Branch: main
Commit: (pin to audit commit hash before engagement starts)
```

Auditors will be given read access to the private repository for the duration of the
engagement. A frozen audit commit will be tagged `audit/v1.0` before work begins.

---

## 10. Timeline

| Milestone | Target date |
|---|---|
| Auditor selected and NDA signed | 2026-05-07 |
| Audit commit tagged (`audit/v1.0`) | 2026-05-09 |
| Audit kickoff call | 2026-05-12 |
| Preliminary findings delivered | 2026-05-26 |
| Fix window | 2026-05-27 – 2026-06-06 |
| Re-audit complete | 2026-06-13 |
| Final report published | 2026-06-17 |
| Mainnet deployment | 2026-06-24 |

---

## 11. Contact

| Role | Contact |
|---|---|
| Technical lead | (your name / email) |
| Security lead | (your name / email) |
| Escalation | (your name / email) |

Questions during the audit should be filed as issues in the private audit repository
provided at kickoff.
