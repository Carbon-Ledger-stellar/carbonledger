# CarbonLedger — Security Policy

> **Last updated:** 2026-04-24 | **Revision:** 1.0

---

## 1. Reporting a Vulnerability

If you discover a security vulnerability in CarbonLedger's smart contracts or
infrastructure, **do not open a public GitHub issue**.

Please report privately to: **security@carbonledger.io** (or your actual contact)

Include:
- Affected contract(s) and function(s)
- Description of the vulnerability and its impact
- Proof-of-concept or reproduction steps if available
- Your suggested severity (Critical / High / Medium / Low)

We will acknowledge receipt within **48 hours** and aim to provide a full response
within **7 days**. Critical findings will be triaged within **24 hours**.

We do not currently operate a bug bounty programme, but we will publicly credit
responsible disclosures in our audit report and changelog.

---

## 2. Known Assumptions and Design Decisions

The following are **intentional design choices**, not bugs. Auditors and security
researchers should be aware of these before filing findings.

### 2.1 Retirement is permanently irreversible
`retire_credits` has no undo path. This is a core protocol invariant. Any finding
that proposes adding a reversal mechanism will be rejected as out of scope.

### 2.2 Any address can retire any batch
`retire_credits` requires `holder.require_auth()` but does not enforce that `holder`
owns the batch. This is a **known gap** tracked for pre-mainnet resolution. The
current design assumes the marketplace is the primary entry point and that off-chain
access control prevents abuse. This will be replaced with an on-chain ownership map
before mainnet.

### 2.3 `transfer_credits` does not update an ownership map
`transfer_credits` emits an event but does not persist a new owner. This is a
**known gap**. Credit ownership is currently tracked off-chain via event indexing.
An on-chain ownership map is planned before mainnet.

### 2.4 `initialize()` can be called more than once
None of the four contracts guard against re-initialisation. A second call to
`initialize()` overwrites the admin, oracle, and verifier set. This is a **known
gap** and will be fixed before mainnet by adding a `has_been_initialized` flag.

### 2.5 Single oracle address
The oracle is a single trusted address. There is no multi-sig or threshold scheme.
Oracle key compromise allows an attacker to push false monitoring data and benchmark
prices. This is an accepted risk for the initial deployment; a multi-oracle scheme
is on the roadmap.

### 2.6 Verifier set is frozen at initialisation
There is no `add_verifier` or `remove_verifier` function. The verifier set can only
be changed by re-deploying the registry contract. This is intentional for the initial
deployment to minimise admin surface area.

### 2.7 `listing_id` is caller-supplied and not deduplicated
`list_credits` does not check whether a `listing_id` already exists. A duplicate
`listing_id` silently overwrites the previous listing. This is a **known gap**.

### 2.8 `bulk_purchase` is not atomic at the application layer
If a `bulk_purchase` call fails mid-loop (e.g., insufficient liquidity on listing N),
listings 0..N-1 will already have been updated and USDC transferred. Soroban
transaction semantics mean the entire transaction reverts on panic/error, so this
is only a risk if the error is swallowed. The current implementation propagates
errors immediately, so the Soroban runtime will revert the full transaction.
**However**, auditors should verify this revert behaviour holds for all failure modes.

### 2.9 Serial registry grows unboundedly
`DataKey::SerialRegistry` is a `Vec<SerialRange>` that grows with every minted batch.
The overlap check is O(n) over all historical ranges. This is a **known scalability
concern** but not a security vulnerability in the short term. A bitmap or sorted
interval tree is planned for a future upgrade.

---

## 3. Trust Model

### 3.1 Roles and privileges

| Role | Address type | Capabilities | Compromise impact |
|---|---|---|---|
| Admin | Single EOA | Initialize contracts, mint credits, suspend projects | Critical — can mint arbitrary credits, change oracle/verifier |
| Oracle | Single EOA | Submit monitoring data, update prices, flag projects, increment issued counter | High — can push false data; cannot mint or retire directly |
| Verifier | Set of EOAs (frozen at init) | Approve or reject projects | High — can approve fraudulent projects |
| Seller | Any EOA | List and delist credits | Low — limited to their own listings |
| Buyer / Holder | Any EOA | Purchase credits, retire credits | Medium — retire_credits has no ownership check (known gap) |
| Public | Any EOA | Read all state, verify serial numbers | None |

### 3.2 Trust boundaries

```
[Admin keypair]
      │ initialize(), mint_credits(), suspend_project()
      ▼
[carbon_registry] ◄──── [carbon_oracle] ◄──── [Oracle keypair]
      │                       │
      │ project status         │ monitoring data, prices, flags
      ▼                       ▼
[carbon_credit] ──────────────────────────────────────────────
      │ retire_credits(), transfer_credits()
      ▼
[carbon_marketplace] ◄──── [Seller EOA]
      │ purchase_credits(), bulk_purchase()
      ▼
[USDC token contract] ◄──── [Buyer EOA]
```

### 3.3 Cross-contract call surface

| Caller contract | Callee contract | Function | Auth required |
|---|---|---|---|
| `carbon_marketplace` | USDC token | `transfer()` | Buyer signs marketplace tx |
| `carbon_credit` | `carbon_registry` | `increment_issued()` | Oracle address |

No other cross-contract calls exist in the current codebase.

---

## 4. Threat Model

### 4.1 Threat actors

| Actor | Motivation | Capability |
|---|---|---|
| Malicious project developer | Mint credits for non-existent sequestration | Can register projects; cannot self-verify |
| Compromised verifier | Approve fraudulent projects | Has verifier keypair |
| Compromised oracle | Push false monitoring data or prices | Has oracle keypair |
| Compromised admin | Mint arbitrary credits, change roles | Has admin keypair |
| Malicious buyer | Retire credits they do not own | Any EOA (known gap) |
| Malicious seller | List credits they do not hold | Any EOA; no on-chain credit ownership check |
| Griefing attacker | DoS serial registry or listing index | Can spam mint/list calls |

### 4.2 Attack scenarios

#### S1 — Re-initialisation takeover (Critical)
An attacker who can call `initialize()` a second time can replace the admin, oracle,
and verifier set with addresses they control, then mint arbitrary credits.

**Current state:** No guard. **Planned fix:** One-time init flag.

#### S2 — Unauthorized retirement (High)
Any authenticated address can call `retire_credits` on any batch, permanently
destroying credits they do not own.

**Current state:** No ownership check. **Planned fix:** On-chain ownership map.

#### S3 — Serial range integer overflow (High)
`retire_credits` computes `batch.serial_start + already_retired as u64`. If
`already_retired` (an `i128`) exceeds `u64::MAX`, the cast truncates silently in
release Wasm builds, producing incorrect serial numbers in the retirement certificate.

**Current state:** No bounds check. **Planned fix:** Explicit checked cast with error.

#### S4 — Purchase price overflow (High)
`total_cost = listing.price_per_credit * amount` uses unchecked `i128` multiplication.
With `price_per_credit = i128::MAX / 2` and `amount = 2`, this overflows.

**Current state:** No overflow guard. **Planned fix:** `checked_mul` with error.

#### S5 — Listing ID overwrite (Medium)
A seller can overwrite an existing active listing by reusing its `listing_id`, setting
`amount_available` to 0 and `price_per_credit` to an arbitrary value.

**Current state:** No deduplication check. **Planned fix:** Check for existing listing
before write.

#### S6 — Oracle single point of failure (Medium)
A compromised oracle can submit false monitoring data (inflating verified tonnes),
update benchmark prices to manipulate the market, and flag legitimate projects to
halt their credit issuance.

**Current state:** Accepted risk. **Planned fix:** Multi-oracle threshold scheme.

#### S7 — Serial registry DoS (Low)
An attacker with admin access can mint thousands of 1-credit batches, growing the
`SerialRegistry` Vec until the O(n) overlap check exceeds Soroban's instruction limit,
preventing any further minting.

**Current state:** Accepted scalability risk. **Planned fix:** Sorted interval structure.

#### S8 — `bulk_purchase` partial state on revert (Low)
If Soroban does not revert USDC transfers on contract error (e.g., if the token
contract's transfer is a separate transaction), a mid-loop failure could leave the
buyer having paid for some listings but not received credits for others.

**Current state:** Assumed safe by Soroban atomicity. **Auditor action:** Verify.

---

## 5. Security Invariants

The following invariants must hold at all times. Any finding that violates one of
these is automatically Critical or High severity.

1. **No credit can be retired twice.** Once `batch.status == FullyRetired`, no further
   retirement is possible.
2. **Serial numbers are globally unique.** No two batches may share any serial number.
3. **Retirement is irreversible.** No function may set a retired batch back to Active.
4. **Only verified projects can have credits minted.** `mint_credits` must fail if the
   project is Pending, Rejected, or Suspended.
5. **USDC flows only to the seller and admin.** No other address may receive USDC from
   a purchase.
6. **Only the registered oracle may push monitoring data or prices.**
7. **Only registered verifiers may approve or reject projects.**

> Note: Invariants 4 and 5 are partially enforced today. Invariant 4 is not enforced
> in `carbon_credit` (it does not call `carbon_registry` to check project status before
> minting). This is a **known gap**.

---

## 6. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-04-24 | 1.0 | Initial security policy |
