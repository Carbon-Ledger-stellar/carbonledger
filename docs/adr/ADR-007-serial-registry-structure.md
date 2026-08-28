# ADR-007: Serial Registry Data Structure — Sorted Map + Binary Search

**Status:** Accepted  
**Date:** 2026-07-30  
**Issue:** [#650](https://github.com/carbonledger/carbonledger/issues/650)  
**Relevant contract:** `contracts/carbon_credit/src/lib.rs`

---

## Context

`verify_serial_range()` in `carbon_credit` detects double-counting by checking
whether a new `[serial_start, serial_end]` interval overlaps any previously
minted batch. The original implementation stored the registry as a flat
`Vec<SerialRange>` and scanned every element on every mint — an O(n) operation
that eventually hits Soroban instruction limits.

At 10 000 batches this is 10 000 comparisons per mint, each paying metered
Soroban instruction cost.

---

## Decision

Replace the flat `Vec<SerialRange>` (stored under `DataKey::SerialRegistry`)
with a `soroban_sdk::Map<u64, u64>` (stored under `DataKey::SerialMap`) where:

- **key** = `serial_start`
- **value** = `serial_end`

Soroban `Map` maintains entries in key-sorted order. Overlap detection uses two
binary searches (O(log n) each):

1. **Left neighbour** — largest key ≤ `start`. Overlaps if its value ≥ `start`.
2. **Right neighbour** — smallest key > `start`. Overlaps if its key ≤ `end`.

Total cost: **O(log n)** versus the previous **O(n)**.

### Migration

On the first mint after a contract upgrade, if `DataKey::SerialRegistry` is
present, all entries are migrated into `DataKey::SerialMap` and the legacy key
is removed. No separate migration transaction is required.

---

## Consequences

### Positive
- Mint instruction cost grows as O(log n) instead of O(n).
- A project with 10 000 batches requires ~14 comparisons instead of 10 000.
- No change to external API or existing tests.
- Automatic one-time migration from legacy Vec on first post-upgrade mint.

### Negative
- `Map` serialization is slightly larger per entry than a bare `(u64, u64)` tuple.
  At typical batch counts (< 50 000) the overhead is negligible.
- Binary search is implemented manually (no stdlib bisect in `no_std` Soroban).

### Neutral
- `SerialRange` struct kept for migration deserialization only.
- `DataKey::SerialRegistry` kept in the enum for migration reads, but never
  written after the upgrade.

---

## Alternatives Considered

| Option | Complexity | Soroban compatible? | Notes |
|--------|-----------|---------------------|-------|
| Keep Vec, add sorted insert + binary search | Medium | Yes | Still O(n) read for deserialization |
| Segment tree / interval tree | High | No | Requires heap allocation; not feasible in `no_std` |
| One entry per serial number | Very high | No | Storage explosion |
| **Sorted Map (chosen)** | Low | Yes | Leverages built-in Soroban Map ordering |

---

## References

- [Soroban SDK Map documentation](https://docs.rs/soroban-sdk/latest/soroban_sdk/struct.Map.html)
- [CarbonLedger issue #650](https://github.com/carbonledger/carbonledger/issues/650)
