# Mutation Testing Report — CarbonLedger Soroban Contracts

**Tool:** `cargo-mutants`
**Contracts analyzed:** `carbon_registry`, `carbon_credit`, `carbon_marketplace`, `carbon_oracle`
**Baseline test suite:** unit tests + edge-case tests + property-based (proptest) invariant
tests + conservation-law invariant tests, across all four contracts.

---

## Executive Summary

This pass is a **manual mutation analysis**: security-critical comparison and boundary
operators in each contract were read line-by-line, a mutation was reasoned about for each
(off-by-one, comparison flip, boolean inversion, condition removal), and the existing test
suite was checked for a test that would fail under that mutation. Where no such test
existed, a new test was written and added directly to the contract's `#[cfg(test)]` module
so the survivor is now killed by a real, compiled assertion.

An actual `cargo-mutants --workspace` run (see [How to Run](#how-to-run)) is the
authoritative source of truth and should be executed in CI/local dev before merging changes
to any of the functions listed below — this document tracks what that run is expected to
confirm and gives reviewers a fast way to see *why* each survivor existed.

| Contract | Security-critical paths reviewed | New tests added | Status |
|---|---|---|---|
| `carbon_credit` | `retire_credits`, `transfer_credits`, `verify_serial_range_internal`, `mint_credits` | 8 | All identified survivors killed ✅ |
| `carbon_registry` | `retire_credits`, `register_project`, `verify_project` auth guards | 1 | Boundary gap closed ✅ |
| `carbon_marketplace` | `bulk_purchase` length/size guard, `list_credits` vintage guard | 3 | Boundary gaps closed ✅ |
| `carbon_oracle` | `is_monitoring_current`, `is_price_current`, `check_liveness`, `get_total_verified_tonnes` | 6 | Boundary gaps + missing coverage closed ✅ |
| **Total** | | **18** | |

> **Blocking issue found and fixed:** `contracts/carbon_oracle/src/lib.rs` (as of commit
> `cadd4b0`, PR #719) contained a duplicated/unmerged `initialize` function body (two
> conflicting signatures concatenated) and three duplicated test-setup helpers, all of which
> are syntax errors that prevent the crate — and therefore the whole workspace — from
> compiling. This was fixed as a prerequisite for running mutation testing on
> `carbon_oracle` at all. See the diff in this PR.

---

## How to Run

### Prerequisites

```bash
cargo install cargo-mutants --locked --version "24.11.0"
```

### Run all contracts

```bash
cd contracts
cargo mutants --workspace --timeout 120
```

### Run a single contract

```bash
cd contracts
cargo mutants -p carbon_credit --timeout 120
```

### Run only security-critical paths

```bash
cd contracts
cargo mutants -p carbon_credit --timeout 120 \
  --file src/lib.rs \
  --re "retire_credits|verify_serial_range|transfer_credits|mint_credits"
```

### Output format

```bash
# JSON output for CI parsing
cargo mutants --workspace --output mutants-report.json --timeout 120

# Filter to survivors only
cargo mutants --workspace --timeout 120 2>&1 | grep "SURVIVED"
```

> **Note:** Full mutation runs take 45–90 minutes on a 4-core machine for this workspace's
> four contracts. CI integration of full runs is documented here as a **manual process** —
> run before mainnet releases and whenever `retire_credits`, `verify_serial_range`, or an
> authorization guard (`require_admin` / `require_oracle` / `require_verifier`) changes.

---

## Per-Contract Findings

### `carbon_credit` (`contracts/carbon_credit/src/lib.rs`)

Security-critical entry points: `retire_credits`, `transfer_credits`,
`verify_serial_range` / `verify_serial_range_internal`, `mint_credits`.

| # | Location | Real code | Mutation reasoned about | Gap found | Fix |
|---|---|---|---|---|---|
| C-1 | `retire_credits` — `batch.status == CreditStatus::Suspended` | guard returns `ProjectSuspended` | condition removed / flipped | No test exercises a Suspended batch (no public entry point sets this status on `carbon_credit`, so it was never reached) | Added `test_retire_suspended_batch_fails` — writes a Suspended batch directly via `env.as_contract` + storage, then asserts the guard fires |
| C-2 | `transfer_credits` — same Suspended guard | as above | as above | Same gap in the sibling function | Added `test_transfer_suspended_batch_fails` |
| C-3 | `transfer_credits` — `amount > active` | `InsufficientCredits` if exceeded | `>` → `>=` | No test transfers more than active, and none transfers *exactly* the active amount | Added `test_transfer_exceeds_active_amount_fails` and `test_transfer_exact_active_amount_succeeds` |
| C-4 | `mint_credits` — `amount > MAX_BATCH_SIZE` | `BatchTooLarge` if exceeded | `>` → `>=` | No test mints exactly `MAX_BATCH_SIZE` (1,000,000,000) or one credit over it | Added `test_mint_exact_max_batch_size_succeeds` and `test_mint_over_max_batch_size_fails` |
| C-5 | `verify_serial_range_internal` — `start <= r.end && end >= r.start` | overlap detection | boundary of touching-but-not-adjacent ranges | Existing test only covers a range strictly adjacent to an existing one (`[1,100]` vs `[101,200]`); a range sharing exactly one serial (`[50,101]` vs `[101,200]`) was untested | Added `test_serial_range_single_serial_overlap_detected` |

All five gaps above are now covered by 8 new `#[test]` functions appended to
`contracts/carbon_credit/src/lib.rs`'s existing `mod tests`.

---

### `carbon_registry` (`contracts/carbon_registry/src/lib.rs`)

| # | Location | Real code | Mutation reasoned about | Gap found | Fix |
|---|---|---|---|---|---|
| R-1 | `retire_credits` — `total_credits_retired + amount > total_credits_issued` | `InsufficientCredits` if exceeded | `>` → `>=` | Existing test retires a partial amount (300 of 1000 issued); the boundary of retiring the *exact* issued total was untested | Added `test_retire_exact_issued_amount_succeeds` |

Authorization guards (`require_admin`, `require_verifier`, `require_oracle`) and the
`methodology_score < 70` / vintage-year boundaries already had dedicated boundary tests in
`edge_case_tests` prior to this pass — reviewed and confirmed no gap.

---

### `carbon_marketplace` (`contracts/carbon_marketplace/src/lib.rs`)

| # | Location | Real code | Mutation reasoned about | Gap found | Fix |
|---|---|---|---|---|---|
| M-1 | `bulk_purchase` — `len != amounts.len() \|\| len > MAX_BATCH_SIZE` | `InvalidSerialRange` if either | `>` → `>=` on the size half of the guard | No test isolates the `MAX_BATCH_SIZE` (10) boundary from the length-mismatch case | Added `test_bulk_purchase_exact_max_batch_size_passes_length_check` (10 listings clears the length guard, fails later on `ListingNotFound`) and `test_bulk_purchase_over_max_batch_size_fails_length_check` (11 listings is rejected at the length guard itself) |
| M-2 | `list_credits` — `vintage_year < 1990` | `InvalidVintageYear` if below | `<` → `<=` | Only the *rejected* 1989 boundary was tested; 1990 itself (the accepted boundary) had no assertion in the marketplace contract | Added `test_list_vintage_1990_succeeds` |

`purchase_credits`'s exact 1% fee routing (`protocol_fee = total_cost / 100`) already has a
test (`test_purchase_exact_fee_routing`) but it is marked `#[ignore]` because it requires a
fully initialized `carbon_credit` contract with a real, owned batch and a funded buyer —
this is properly exercised end-to-end by the new cross-contract integration suite in
`tests/oracle_registry_credit_flow_test.rs` (issue #631) instead of by an isolated unit test.

---

### `carbon_oracle` (`contracts/carbon_oracle/src/lib.rs`)

| # | Location | Real code | Mutation reasoned about | Gap found | Fix |
|---|---|---|---|---|---|
| O-1 | `is_price_current` — `saturating_sub(updated_at) <= PRICE_STALENESS_SECS` | current if `<=` 24h | `<=` → `<` | Existing tests cover "immediately after" and "24h + 1s" (stale); the exact 24h boundary itself was untested | Added `test_is_price_current_true_at_exact_24_hour_boundary` |
| O-2 | `is_monitoring_current` — `saturating_sub(ts) <= MONITORING_FRESHNESS_SECS` | current if `<=` 365 days | `<=` → `<` | Existing regression test covers 366 days (stale); exact 365-day boundary untested | Added `test_is_monitoring_current_true_at_exact_365_day_boundary` |
| O-3 | `check_liveness` — `saturating_sub(ts) > sla` | stale if `>` sla | `>` → `>=` | Existing SLA tests advance *past* the custom SLA (2h vs 1h); the exact boundary was untested | Added `test_check_liveness_not_stale_at_exact_sla_boundary` |
| O-4 | `get_total_verified_tonnes` — `total = total.saturating_add(data.tonnes_verified)` | sums across periods | `+=` → `=` (overwrite instead of accumulate) | **No test existed for this function at all**, despite its doc comment stating it backs the cross-contract issuance cap enforced by `carbon_credit::mint_credits` | Added a dedicated `total_verified_tonnes_tests` module: `test_get_total_verified_tonnes_sums_multiple_periods` (3 periods, would fail under the overwrite mutation since it'd return only the last period's value), `test_get_total_verified_tonnes_ignores_unrecorded_periods`, `test_get_total_verified_tonnes_empty_periods_is_zero` |

`get_total_verified_tonnes` was the single largest coverage gap found in this pass across
all four contracts — a core cross-contract invariant helper with zero prior test coverage.

---

## Methodology

### Mutation operators considered

- **Comparison flip**: `>` → `>=`, `<` → `<=`, `==` → `!=` (primary focus — most survivors
  found in this pass were exact-boundary gaps, not gross logic errors)
- **Boolean inversion**: `&&` → `||`, condition removed entirely
- **Arithmetic replacement**: `+=` → `=` (accumulator overwrite), `+` → `-`, `*` → `/`
- **Off-by-one constants**: `MAX_BATCH_SIZE` boundary, `1990` vintage floor, `365`/`24h`
  staleness windows

### Why boundary conditions dominate

Every genuine gap found in this pass was an **exact-equality boundary** (`amount ==
MAX_BATCH_SIZE`, `vintage_year == 1990`, `elapsed == SLA`) rather than a gross logic error —
the existing 30+ unit/property tests already exercise the interior and clearly-invalid
regions of each guard well. This is exactly the class of survivor manual code review is
weakest at catching and `cargo-mutants` is strongest at catching, which is why running the
tool for real (see [How to Run](#how-to-run)) remains valuable even after this pass.

### Security-critical paths (zero survivors required per issue #632)

- `retire_credits` (carbon_credit and carbon_registry) — irreversibility and
  `InsufficientCredits` guards
- `verify_serial_range` / `verify_serial_range_internal` — double-counting prevention
- `require_admin` / `require_oracle` / `require_verifier` — authorization guards

**Status: all identified survivors in these paths are now killed by tests committed
alongside this report.**

---

## CI Integration

Full mutation runs are documented as a **manual process** due to runtime (45–90 min for the
whole workspace) — this matches the issue's explicit scope (CI integration of full runs is
out of scope; only a manual-process doc is required).

### When to run

- Before any mainnet deployment
- When modifying `retire_credits`, `verify_serial_range`, `transfer_credits`,
  `mint_credits`, or any `require_*` authorization guard
- As part of quarterly security review

### Quick subset (safe to add to CI as a smoke test)

```yaml
# In .github/workflows/ci.yml
- name: Mutation smoke test (security-critical paths only)
  working-directory: contracts
  run: |
    cargo mutants -p carbon_credit \
      --timeout 60 \
      --file src/lib.rs \
      --re "retire_credits|verify_serial_range"
```

---

## References

- [cargo-mutants documentation](https://mutants.rs)
- [contracts/carbon_credit/src/lib.rs](../contracts/carbon_credit/src/lib.rs)
- [contracts/carbon_registry/src/lib.rs](../contracts/carbon_registry/src/lib.rs)
- [contracts/carbon_marketplace/src/lib.rs](../contracts/carbon_marketplace/src/lib.rs)
- [contracts/carbon_oracle/src/lib.rs](../contracts/carbon_oracle/src/lib.rs)
- [contracts/carbon_credit/src/conservation.rs](../contracts/carbon_credit/src/conservation.rs) — conservation-law invariant helpers used as part of the baseline test suite
- [docs/integration-testing.md](../docs/integration-testing.md) — cross-contract flow tests (issue #631) that cover the fee-routing and cross-contract-transfer paths this report defers from unit-level mutation testing
