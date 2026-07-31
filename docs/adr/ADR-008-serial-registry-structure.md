# ADR-008: O(log n) Serial Registry Structure

## Status
Accepted

## Context
The `carbon_credit` serial registry stored issued ranges as `Vec<SerialRange>`
(a flat list of `(start, end)` tuples). On every `mint_credits` call,
`verify_serial_range_internal` iterated the entire list and ran a full
range-overlap comparison against each entry — O(n) comparisons per mint.

At 10,000 batches this means 10,000 comparisons per mint, each consuming
Soroban metered instruction cost. At scale this would hit instruction limits
and prevent minting new credits.

## Decision
Replace `Vec<SerialRange>` with `Map<u64, u64>` keyed on `serial_start`, value
`serial_end`.

Soroban's persistent `Map` stores entries in ascending key order. The overlap
detection algorithm exploits this ordering via binary search over
`Map::keys()`, which only needs to inspect the **predecessor** and
**successor** of the candidate range — the only two existing ranges that could
possibly overlap it, since the registry is non-overlapping by construction:

```rust
fn verify_serial_range_internal(env: &Env, start: u64, end: u64) -> bool {
    let registry: Map<u64, u64> = env.storage().persistent()
        .get(&DataKey::SerialRegistry).unwrap_or_else(|| Map::new(env));

    if registry.is_empty() { return true; }

    // Map<start, end> is sorted by key (Soroban Map guarantees key ordering).
    let keys: Vec<u64> = registry.keys();
    let len = keys.len() as usize;

    // Upper-bound binary search: find count of keys strictly <= start.
    let mut lo = 0usize;
    let mut hi = len;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if keys.get(mid as u32).unwrap() <= start { lo = mid + 1; }
        else { hi = mid; }
    }
    // Predecessor (largest existing start <= new_start): overlap if pred_end >= new_start.
    if lo > 0 {
        let pred_end = registry.get(keys.get((lo-1) as u32).unwrap()).unwrap();
        if pred_end >= start { return false; }
    }
    // Successor (smallest existing start > new_start): overlap if succ_start <= new_end.
    if lo < len {
        let succ_start = keys.get(lo as u32).unwrap();
        if succ_start <= end { return false; }
    }
    true
}
```

Only two map lookups plus a binary search over the key list are needed per
call — the comparison work itself is O(log n), independent of registry size.

## Storage format change
`DataKey::SerialRegistry` changes type from `Vec<SerialRange>` to
`Map<u64, u64>`. `initialize()` seeds an empty `Map`. On first read after an
upgrade where the key is absent, the code falls back to an empty `Map` —
zero-downtime for new deployments; an existing-data migration would be
required before a mainnet upgrade from the old `Vec<SerialRange>` layout.

## Complexity
- **Overlap check (the hot path this issue targets):** O(log n) comparisons
  via binary search, versus O(n) full-range comparisons previously. Every
  `mint_credits` call pays for this check, so this is what drove the
  instruction-limit risk at scale.
- **Registry read/write I/O:** fetching `registry.keys()` and persisting the
  updated `Map` are still O(n) in storage size — an unavoidable cost of
  persistent collections that grow by one entry per mint. This is not the
  cost the issue was concerned with: the previous implementation's problem was
  O(n) *comparison* work (checking full ranges against every existing entry)
  on every single mint, not the underlying storage I/O.

## Benchmark
`carbon_credit::serial_benchmark::bench_serial_registry_growth` mints credits
up to registry sizes of 10, 50, 100, and 250 batches, resetting the Soroban
test budget immediately before the mint at each checkpoint and printing the
CPU instruction cost of that single `mint_credits` call:

```
cargo test -p carbon_credit --lib bench_serial_registry_growth -- --nocapture
```

Because the overlap check is now two binary-searched map lookups instead of a
full linear scan, per-mint instruction growth comes only from the storage
read/write of the growing `Map`, not from comparison work scaling with
registry size the way the old linear scan did.

## Proptest fuzz coverage
`serial_registry_proptest_tests` (5,000 cases per property) validates the
structure:
- **SR1** — non-overlapping ranges (with a gap) are always accepted.
- **SR2** — overlapping ranges (containment, partial overlap, exact
  duplicates) are always rejected with `DoubleCountingDetected`.
- **SR3** — sequential non-overlapping batches all succeed and remain
  queryable.
- **SR4** — boundary conditions: adjacent ranges, ranges strictly before an
  existing range, and an exact duplicate of an existing range.

This complements the general P1–P4 conservation-invariant properties from
#655 (including P2, which separately covers overlap rejection as part of the
broader invariant suite).

## Consequences
- Per-mint overlap-check cost is O(log n) in comparisons, addressing the
  instruction-limit risk raised in the issue.
- Registry storage I/O remains O(n) per mint in the number of existing
  entries — expected and acceptable; it is far cheaper per-element than the
  old comparison-heavy scan it replaced.
- `Map` key ordering is a Soroban storage guarantee this design depends on;
  if that guarantee ever changed, the binary search would need to fall back
  to sorting `keys()` explicitly before searching.
- All existing `carbon_credit` unit tests and proptest invariant suites pass
  unchanged.
