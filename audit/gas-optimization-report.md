# Gas / Resource Optimization Report

## Scope

This report captures the Soroban resource-optimization pass for the hot-path marketplace and credit functions requested in the audit scope:

- `purchase_credits`
- `retire_credits`
- `list_credits`
- `get_active_listings`

The changes are implemented in:

- [contracts/carbon_marketplace/src/lib.rs](contracts/carbon_marketplace/src/lib.rs)
- [contracts/carbon_credit/src/lib.rs](contracts/carbon_credit/src/lib.rs)
- [contracts/carbon_marketplace/tests/benchmarks.rs](contracts/carbon_marketplace/tests/benchmarks.rs)
- [contracts/carbon_credit/tests/benchmarks.rs](contracts/carbon_credit/tests/benchmarks.rs)

## What changed

### Marketplace contract

- `get_active_listings` now reads the persisted listing ID index once and iterates through the stored listing entries directly, avoiding an extra indirection through the shared filtering helper for the common active-listing query.
- `list_credits` and `purchase_credits` keep the same external behavior while reusing the ledger timestamp once per call and reducing avoidable temporary state churn in the hot path.

### Credit contract

- `retire_credits` now reuses the ledger timestamp already captured during retirement certificate creation and avoids redundant state access patterns in the retirement path.
- The retirement and batch lifecycle logic remains behaviorally identical; only the execution path was simplified.

## Resource-impact summary

The in-contract changes are intentionally low-risk and semantic-preserving. The measured impact is expected to be a reduction in Soroban instruction spend from fewer redundant reads and less temporary work, especially for read-heavy and state-update-heavy paths.

### Expected direction of change

| Function | Change | Rationale |
| --- | --- | --- |
| `list_credits` | Slight CPU / memory reduction | Avoids unnecessary repeated work around listing creation and state setup. |
| `purchase_credits` | Moderate CPU / memory reduction | Reuses timestamp state and avoids redundant work during fee/accounting updates. |
| `retire_credits` | Moderate CPU / memory reduction | Simplifies the retirement bookkeeping path and removes redundant timestamp/state handling. |
| `get_active_listings` | Larger read-path reduction | Avoids the extra helper indirection and reads the active listing index more directly. |

## Benchmarking status

The benchmark harnesses are in place and emit machine-readable `BENCH_RESULT` lines for:

- `list_credits`
- `purchase_credits`
- `get_active_listings`
- `retire_credits`
- `mint_credits`
- `bulk_purchase`

The commands to run locally are:

```bash
cd contracts/carbon_marketplace
cargo test --test benchmarks -- --nocapture

cd ../carbon_credit
cargo test --test benchmarks -- --nocapture
```

Because the environment was instructed to avoid running tests, the report records the implementation and the benchmark scaffolding, but no fresh benchmark numbers are attached here.

## Notes

- The optimization keeps external behavior unchanged.
- The storage and pause hardening changes remain additive and do not alter the intended public API.
- If a future run is permitted, the benchmark outputs should be compared against the current baseline and recorded in the same format used by the existing tooling.
