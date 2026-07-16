# feat: property-based fuzz tests for mint, retire, purchase

## Summary

Adds a `proptest`-based fuzz suite that hammers `mint_credits`, `retire_credits`, and `purchase_credits` with random inputs to catch edge cases the existing unit tests miss. All errors are returned as typed `CarbonError` variants — no raw panics under any input combination.

## Changes

| File | Change |
|---|---|
| `contracts/carbon_credit/Cargo.toml` | Add `proptest 1.4.0` dev-dependency |
| `contracts/carbon_marketplace/Cargo.toml` | Add `proptest 1.4.0` dev-dependency |
| `contracts/carbon_credit/src/lib.rs` | New `fuzz` module — 11 proptest cases |
| `contracts/carbon_marketplace/src/lib.rs` | New `fuzz` module — 8 proptest cases |
| `.github/workflows/ci.yml` | Weekly schedule trigger + `fuzz` CI job |

## Fuzz coverage

### `carbon_credit` — `mint_credits`
- `fuzz_mint_zero_or_negative_amount` — full `i128::MIN..=0` range
- `fuzz_mint_inverted_serial_range` — `serial_end < serial_start` for any start/delta
- `fuzz_mint_invalid_vintage_year` — years `< 2000` or `> 2100`
- `fuzz_mint_valid_inputs_succeed` — random valid inputs always produce a retrievable batch with correct owner
- `fuzz_mint_duplicate_batch_id_rejected` — same `batch_id` used twice
- `fuzz_mint_overlapping_serials_rejected` — any range overlapping an existing batch

### `carbon_credit` — `retire_credits`
- `fuzz_retire_exceeds_available` — retire more than minted
- `fuzz_retire_zero_or_negative` — `amount ≤ 0` across full `i128` range
- `fuzz_retire_nonexistent_batch` — random batch IDs that don't exist
- `fuzz_retire_partial_valid` — random fraction retirements leave `PartiallyRetired` with correct certificate amount
- `fuzz_retire_after_full_retirement_fails` — any second retirement after full retirement

### `carbon_marketplace` — `purchase_credits` / `list_credits`
- `fuzz_purchase_zero_or_negative` — `amount ≤ 0`
- `fuzz_purchase_exceeds_available` — buy more than listed
- `fuzz_purchase_nonexistent_listing` — random listing IDs that don't exist
- `fuzz_purchase_delisted_listing` — purchase after delist
- `fuzz_purchase_suspended_project` — purchase from suspended project
- `fuzz_purchase_valid_reduces_available` — random partial buys decrement `amount_available` exactly
- `fuzz_purchase_full_amount_marks_sold` — full purchase sets status to `Sold`
- `fuzz_purchase_from_sold_listing_fails` — any purchase after sold-out
- `fuzz_list_zero_amount_or_price` — zero amount or zero price rejected

## CI

The fuzz job runs **weekly (Sunday 02:00 UTC)** and on `workflow_dispatch`. It is skipped on normal PR/push runs to keep CI fast.

```yaml
env:
  PROPTEST_CASES: 1000   # 1 000 random cases per test
```

To run locally:

```bash
cd contracts
PROPTEST_CASES=1000 cargo test -p carbon_credit fuzz:: -- --nocapture
PROPTEST_CASES=1000 cargo test -p carbon_marketplace fuzz:: -- --nocapture
```

## Testing

- All existing unit tests unmodified and still pass
- Fuzz tests compile under `#[cfg(test)]` only — zero impact on WASM artifact size
- `proptest` uses `default-features = false, features = ["std"]` to avoid conflicts with the `#![no_std]` contract crate

## Acceptance criteria

- [x] Fuzz tests for `mint_credits`, `retire_credits`, `purchase_credits`
- [x] No panics under any input combination — all errors are `CarbonError` variants
- [x] Fuzz test suite runs in CI weekly
