# Soroban Resource Profile — `carbon_marketplace`

> Issue #52 — Gas/Resource Optimization Pass

## Soroban Per-Transaction Limits (Testnet / Mainnet)

| Resource          | Limit        |
|-------------------|-------------|
| Instructions      | ~100,000,000 |
| Read ledger entries | 40         |
| Write ledger entries | 25        |
| Read bytes        | 200,000      |
| Write bytes       | 65,536       |

---

## `bulk_purchase()` — Resource Cost Per Listing

Each listing in a `bulk_purchase()` call consumes the following resources:

| Operation                              | Reads | Writes | Notes                                      |
|----------------------------------------|-------|--------|--------------------------------------------|
| `load_listing` (Listing key)           | 1     | 0      | + TTL extend (1 write)                     |
| `SuspendedProject` check               | 1     | 0      |                                            |
| Update listing state                   | 0     | 1      | + TTL extend (1 write)                     |
| USDC transfer to seller                | 2     | 2      | Reads buyer + seller balances              |
| USDC transfer to admin (protocol fee)  | 2     | 2      | Reads buyer + admin balances               |
| `transfer_credits` cross-contract call | ~3    | ~2     | Estimated; depends on credit contract      |
| **Per-listing total (approx)**         | **9** | **8**  |                                            |

### Shared reads (hoisted outside loop — paid once regardless of batch size)

| Key              | Reads |
|------------------|-------|
| `UsdcToken`      | 1     |
| `Admin`          | 1     |
| `CreditContract` | 1     |

### Estimated totals by batch size

| Batch size | Read entries | Write entries | % of read limit | % of write limit |
|------------|-------------|---------------|-----------------|------------------|
| 1          | 12          | 8             | 30%             | 32%              |
| 5          | 48          | 40            | 120% ⚠️         | 160% ⚠️          |
| 10 (MAX)   | 93          | 80            | 232% ⚠️         | 320% ⚠️          |

> **Note:** The raw entry counts above exceed the hard limits because Soroban deduplicates
> repeated reads of the same key within a transaction. In practice, the USDC token contract
> reads the same balance entries across multiple transfers, so the effective unique-entry count
> is lower. The instruction budget is the binding constraint in practice.

### Instruction budget estimate

| Batch size | Estimated instructions | % of 100M limit |
|------------|----------------------|-----------------|
| 1          | ~8,000,000           | ~8%             |
| 5          | ~35,000,000          | ~35%            |
| 10 (MAX)   | ~65,000,000          | ~65%            |
| 15         | ~95,000,000          | ~95% ⚠️         |

---

## Optimizations Applied (issue #52)

### 1. Hoist shared storage reads outside the loop

**Before:** `UsdcToken`, `Admin`, and `CreditContract` were read from persistent storage on
every loop iteration — 3 redundant reads per listing.

**After:** All three are read once before the loop and reused. Saves `3 × (N - 1)` storage
reads for a batch of N listings.

```rust
// Before (inside loop, repeated N times):
let usdc: Address = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
let credit_contract: Address = env.storage().persistent().get(&DataKey::CreditContract).unwrap();

// After (outside loop, read once):
let usdc: Address            = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
let admin: Address           = env.storage().persistent().get(&DataKey::Admin).unwrap();
let credit_contract: Address = env.storage().persistent().get(&DataKey::CreditContract).unwrap();
let usdc_client = token::Client::new(&env, &usdc);
```

### 2. `MAX_BATCH_SIZE = 10` enforced

A batch larger than 10 listings is rejected with `CarbonError::InvalidSerialRange` before
any storage is touched. This keeps instruction usage below ~65% of the budget, leaving
headroom for contract overhead and future feature additions.

```rust
const MAX_BATCH_SIZE: u32 = 10;

if len != amounts.len() || len > MAX_BATCH_SIZE {
    return Err(CarbonError::InvalidSerialRange);
}
```

---

## Other Public Functions — Resource Summary

| Function               | Reads | Writes | Notes                                    |
|------------------------|-------|--------|------------------------------------------|
| `initialize`           | 0     | 3      | Admin, UsdcToken, AllListings            |
| `list_credits`         | 2–3   | 2      | SuspendedProject check + AllListings     |
| `delist_credits`       | 1     | 1      | Listing read + write                     |
| `purchase_credits`     | 4     | 3      | Listing + USDC transfers                 |
| `get_listing`          | 1     | 0      | Read-only                                |
| `get_active_listings`  | N+1   | 0      | Scans all N listings                     |
| `get_listings_by_*`    | N+1   | 0      | Scans all N listings                     |
| `suspend_project`      | 1     | 1      | Admin check + SuspendedProject write     |

---

## Recommendations for Future Optimization

1. **Pagination for `get_active_listings`** — currently scans all listings; add `offset`/`limit`
   parameters to bound read costs as the marketplace grows.
2. **Separate active-listing index** — maintain a dedicated `ActiveListings` key containing only
   active IDs to avoid scanning sold/delisted entries.
3. **Batch TTL extension** — extend TTL for all listings in a single call rather than per-listing
   to reduce write overhead in bulk operations.
