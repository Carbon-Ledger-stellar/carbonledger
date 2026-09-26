# Formal Verification — CarbonLedger Carbon Credit Contract

> **Issue:** #692  
> **Branch:** `feat/kani-formal-verification-692`  
> **Files:** `contracts/carbon_credit/src/proofs.rs`, `contracts/carbon_credit/src/invariants.rs`

---

## Overview

The `carbon_credit` contract handles real-money transactions and irreversible
on-chain state.  Fuzz testing (proptest) gives probabilistic coverage; formal
verification provides mathematical certainty.

CarbonLedger uses **Kani**, a bounded model checker from AWS for Rust, to prove
three critical invariants of the `carbon_credit` contract.  Kani exhaustively
explores all possible inputs (within a configurable loop unwind bound) and
either proves a property or produces a concrete counterexample.

---

## What is Kani?

[Kani](https://model-checking.github.io/kani/) is a tool that:

1. Compiles Rust code to a symbolic representation (using CBMC under the hood).
2. Inserts symbolic ("unconstrained") values in place of function inputs.
3. Explores all possible execution paths up to a bound.
4. Proves that assertions hold for **all** inputs, or produces a minimal
   counterexample.

Unlike fuzzing (which samples inputs randomly), Kani is exhaustive — within the
bound, there is no path it misses.

---

## Bounded vs. Unbounded Proofs

Kani performs *bounded* model checking (BMC).  Every loop must be unrolled to a
finite depth via `--unwind N`.  This means:

- Proofs hold for **all inputs** within the unwind bound.
- Properties with no loops are proved **unconditionally** (the bound is irrelevant).
- Properties involving loops require explicit justification for the chosen bound.

### When does `--unwind N` give a complete proof?

A BMC proof with `--unwind N` is complete (i.e., equivalent to an unbounded
proof) when:

1. The property has no loops (e.g., `INV-1`, `INV-2`), OR
2. Every loop in the proof terminates in ≤ N steps for all symbolic inputs.

If the bound is too low, Kani emits `UNWIND FAILURE`.  See §Troubleshooting.

---

## Proved Invariants

### INV-1 — Conservation

**Property:** `amount_available + amount_retired == minted_amount`, always.

**Proof harnesses:** `proof_conservation`, `proof_conservation_multi_step`

**Completeness:** No loops in the proof — proved for **all** `i128` values
satisfying:
- `minted > 0`
- `minted <= MAX_BATCH_SIZE` (10⁹)
- `0 <= retired <= minted`

**Why this matters:** Ensures that credits cannot be created or destroyed by
the retire operation — only moved from the "available" pool to the "retired"
pool.

---

### INV-2 — InsufficientCredits Guard

**Property:** Calling `retire_credits(amount > active_amount)` always returns
`InsufficientCredits`.

**Proof harness:** `proof_insufficient_credits`

**Completeness:** Single comparison — proved for **all** `i128` pairs where
`active_amount >= 0` and `retire_amount > 0`.

**Why this matters:** Prevents any caller from retiring more credits than are
available in a batch, regardless of the current state or input values.

---

### INV-3 — Serial Number Non-Overlap

**Property:** After any sequence of valid mint operations, no two batches share
a serial number.  Equivalently, `verify_serial_range_internal` correctly detects
all overlaps.

**Proof harness:** `proof_serial_no_overlap`

**Completeness:** Bounded.  With `--unwind 8` the proof covers registries of up
to 7 existing ranges.

**Bound justification:** The loop in `verify_serial_range_internal` iterates
once per existing range.  With `--unwind 8` we prove exhaustively for all
64-bit start/end values when up to 7 ranges are already in the registry.  The
proptest suite (`serial_fuzz_tests`) provides complementary probabilistic
coverage for arbitrarily large registries (10,000+ iterations, unbounded
registry size).

**Why this matters:** Serial number uniqueness is the on-chain guarantee against
double-counting.  A bug here would allow the same tonne of CO₂ to be sold
multiple times.

---

## Running the Proofs Locally

### Prerequisites

```bash
# Kani requires rustup
rustup update stable

# Install Kani
cargo install --locked kani-verifier
cargo kani setup
```

### Run all proofs

```bash
cd contracts/carbon_credit

# Run all four harnesses
cargo kani \
  --harness proof_conservation \
  --harness proof_conservation_multi_step \
  --harness proof_insufficient_credits \
  --harness proof_serial_no_overlap \
  --unwind 8 \
  --jobs auto
```

### Expected output

```
VERIFICATION:- SUCCESSFUL  proof_conservation
VERIFICATION:- SUCCESSFUL  proof_conservation_multi_step
VERIFICATION:- SUCCESSFUL  proof_insufficient_credits
VERIFICATION:- SUCCESSFUL  proof_serial_no_overlap
```

### Run a single harness

```bash
cargo kani --harness proof_conservation
```

---

## CI Integration

The Kani proofs run in CI as the `kani` job in `.github/workflows/ci.yml`:

- **Timeout:** 5 minutes.
- **Trigger:** On push to `main`, on PRs, and on the nightly schedule.
- **Failure behaviour:** Each harness runs as a separate step.  Failure of any
  harness fails the CI check and **blocks merge**.
- **Artifacts:** Kani output logs are uploaded as `kani-proof-logs` (14-day
  retention) for debugging.
- **PR comment:** A summary table is posted on pull requests showing pass/fail
  per invariant.

---

## Troubleshooting

### `UNWIND FAILURE` on INV-3

If Kani emits `UNWIND FAILURE` for `proof_serial_no_overlap`, the registry
in CI has grown beyond 7 existing ranges.  Increase the bound:

1. Change `--unwind 8` to a higher value (e.g., `--unwind 16`).
2. Measure the new CI runtime to ensure it stays within the 5-minute timeout.
3. Update this document with the new bound and justification.

**Rule of thumb:** Each doubling of `--unwind` roughly doubles the runtime.
If the proof exceeds 5 minutes, split it into a separate scheduled job
(hourly/daily) rather than blocking PR merges.

### Counterexample found

If Kani finds a counterexample, it prints:

```
COUNTEREXAMPLE:
  ...variable assignments...
```

This is a **real bug**.  The counterexample values are a concrete input that
violates the invariant.  Fix the contract logic before merging.

---

## Invariants NOT Amenable to Kani

| Invariant | Reason not provable with Kani | Alternative |
|-----------|-------------------------------|-------------|
| Serial non-overlap for unbounded registries | Unbounded loop | Proptest 10,000+ cases |
| Cross-contract oracle check (`issued ≤ verified`) | Requires live Soroban Env with cross-contract calls | Integration tests on testnet |
| Re-init guard | Requires persistent storage state from a prior tx | Unit test `test_double_init` |
| Retirement irreversibility across contract upgrades | Requires reasoning about future WASM | Manual review + upgrade runbook |

---

## Relationship to Other Testing Layers

```
┌──────────────────────────────────────────────────────────────────┐
│                   Assurance Pyramid                              │
│                                                                  │
│   ┌────────────────────┐                                         │
│   │  Formal (Kani)     │ ← unbounded for simple properties      │
│   │  INV-1, INV-2      │   bounded (unwind 8) for INV-3         │
│   └────────────────────┘                                         │
│   ┌────────────────────┐                                         │
│   │  Proptest (fuzz)   │ ← 10,000+ random inputs, unbounded     │
│   │  serial_fuzz_tests │   registry size                        │
│   └────────────────────┘                                         │
│   ┌────────────────────┐                                         │
│   │  Unit tests        │ ← deterministic, fast, full contract   │
│   │  (30+ tests)       │   lifecycle coverage                   │
│   └────────────────────┘                                         │
│   ┌────────────────────┐                                         │
│   │  Testnet           │ ← cross-contract, oracle, real network  │
│   │  integration tests │                                         │
│   └────────────────────┘                                         │
└──────────────────────────────────────────────────────────────────┘
```

No single layer is sufficient on its own.  The combination of formal proofs,
property-based fuzz tests, unit tests, and testnet integration tests provides
the highest achievable assurance for a production carbon credit contract.

---

## References

- [Kani Model Checker documentation](https://model-checking.github.io/kani/)
- [Kani GitHub repository](https://github.com/model-checking/kani)
- [Bounded Model Checking (Wikipedia)](https://en.wikipedia.org/wiki/Bounded_model_checking)
- [`contracts/carbon_credit/src/proofs.rs`](../contracts/carbon_credit/src/proofs.rs) — proof harnesses
- [`contracts/carbon_credit/src/invariants.rs`](../contracts/carbon_credit/src/invariants.rs) — invariant unit tests
- [`audit/pre-audit-checklist.md`](../audit/pre-audit-checklist.md) — Vector 5 formal verification status
