//! Sub-linear on-chain index for carbon-credit serial ranges (issue #887).
//!
//! # Why this exists
//!
//! Double-counting is prevented by refusing to mint a batch whose serial range
//! `[start, end]` intersects any range already issued. The previous registry
//! kept every range in a **single** `Map<u64, u64>` ledger entry. Even with a
//! binary search over the keys, every read had to deserialise the *whole* map
//! and every mint had to serialise it back, so both CPU and I/O grew linearly
//! with the number of registered batches — and the entry itself would
//! eventually breach Soroban's ledger-entry size ceiling.
//!
//! # The structure
//!
//! A **skip list** ordered by `serial_start`, where every node is its own
//! persistent ledger entry:
//!
//! ```text
//!  L3  head ─────────────────────────────────────────────▶ 900
//!  L2  head ───────────────▶ 300 ──────────────────────-──▶ 900
//!  L1  head ──────▶ 100 ───▶ 300 ─────────▶ 550 ─────-───▶ 900
//!  L0  head ──────▶ 100 ───▶ 300 ─▶ 410 ──▶ 550 ─▶ 720 ──▶ 900
//! ```
//!
//! Because the stored ranges are pairwise disjoint (that is the invariant this
//! index enforces), a candidate `[start, end]` overlaps something iff:
//!
//! * its **predecessor** — the range with the largest `serial_start <= start` —
//!   ends at or after `start`; or
//! * its **successor** — the range with the smallest `serial_start > start` —
//!   begins at or before `end`.
//!
//! Both neighbours are located by one top-down walk, which touches an expected
//! `O(log N)` nodes. Each node is a small, fixed-shape entry, so read *and*
//! write cost stay flat as the registry grows.
//!
//! Node levels are assigned by a deterministic hash of the key
//! ([`level_for`]) rather than by RNG: contract execution must be reproducible
//! across validators, and hashing a uniformly-spread key gives the same
//! geometric level distribution a coin flip would.
//!
//! # Migration
//!
//! Contracts deployed before this index shipped still hold their ranges in the
//! legacy `DataKey::SerialRegistry` map. Until an admin has drained it with
//! [`migrate`], overlap checks consult *both* structures, so no legacy range
//! can be double-issued mid-migration. Once the map is empty its ledger entry
//! is removed and the legacy path costs a single `has` probe.

use soroban_sdk::{contracttype, Env, Map, Vec};

use crate::{DataKey, TTL_LEDGERS};

/// Height of the skip list. Level `k` holds roughly `N / 2^k` nodes, so 20
/// levels keep searches logarithmic well past a million registered ranges —
/// two orders of magnitude beyond `MAX_BATCHES_PER_PROJECT`.
pub(crate) const MAX_LEVEL: usize = 20;

/// `0` is never a valid `serial_start` (mint rejects it up front), so it doubles
/// as the "no such node" sentinel in forward pointers and in the head vector.
const NIL: u64 = 0;

/// One registered serial range plus its forward pointers.
///
/// `next[i]` is the `serial_start` of the following node on level `i`, or
/// [`NIL`]. The vector's length *is* the node's level, so a node reached at
/// level `i` always has `next.len() > i`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SerialNode {
    pub start: u64,
    pub end: u64,
    pub next: Vec<u64>,
}

/// Storage keys owned by the index. Kept separate from [`DataKey`] so the index
/// can evolve without disturbing the contract's primary key space.
#[contracttype]
#[derive(Clone)]
pub enum SerialIndexKey {
    /// `Vec<u64>` of length [`MAX_LEVEL`]: the first node on each level.
    Head,
    /// `SerialNode` keyed by its `serial_start`.
    Node(u64),
    /// `u32` count of indexed ranges.
    Count,
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage helpers
//
// Every ledger access the index makes goes through one of these, so the
// test-only counters in `metrics` see all of them.
// ─────────────────────────────────────────────────────────────────────────────

/// The head sentinel's forward pointers, materialised as all-[`NIL`] the first
/// time the index is used so `initialize` does not have to seed it.
fn load_head(env: &Env) -> Vec<u64> {
    metrics::record_read();
    match env.storage().persistent().get(&SerialIndexKey::Head) {
        Some(head) => head,
        None => {
            let mut head: Vec<u64> = Vec::new(env);
            for _ in 0..MAX_LEVEL {
                head.push_back(NIL);
            }
            head
        }
    }
}

fn store_head(env: &Env, head: &Vec<u64>) {
    metrics::record_write();
    env.storage().persistent().set(&SerialIndexKey::Head, head);
    env.storage()
        .persistent()
        .extend_ttl(&SerialIndexKey::Head, TTL_LEDGERS, TTL_LEDGERS);
}

/// Load the node registered at `start`.
///
/// Traps on a missing entry: reaching a key means a live forward pointer refers
/// to it, so its absence is index corruption (an archived entry, say) and
/// continuing would silently weaken the double-counting guard.
fn load_node(env: &Env, start: u64) -> SerialNode {
    metrics::record_read();
    env.storage()
        .persistent()
        .get(&SerialIndexKey::Node(start))
        .expect("serial index: dangling forward pointer")
}

fn store_node(env: &Env, node: &SerialNode) {
    metrics::record_write();
    let key = SerialIndexKey::Node(node.start);
    env.storage().persistent().set(&key, node);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
}

fn store_count(env: &Env, count: u32) {
    metrics::record_write();
    env.storage().persistent().set(&SerialIndexKey::Count, &count);
    env.storage()
        .persistent()
        .extend_ttl(&SerialIndexKey::Count, TTL_LEDGERS, TTL_LEDGERS);
}

/// Number of ranges currently held in the skip list.
pub(crate) fn len(env: &Env) -> u32 {
    metrics::record_read();
    env.storage()
        .persistent()
        .get(&SerialIndexKey::Count)
        .unwrap_or(0u32)
}

/// Counts of ledger entries read and written, which is what actually drives
/// on-chain cost for this structure.
///
/// The tests assert on these rather than on `env.budget()` because the test
/// host meters a storage *write* in proportion to the size of its whole
/// in-memory storage map — every entry the test ever created. On-chain that map
/// holds only the transaction's footprint, so metered write cost in tests
/// tracks the harness, not the contract. Reads do not have that artifact, but
/// entry counts are the clearer signal for both.
#[cfg(test)]
pub(crate) mod metrics {
    extern crate std;
    use core::cell::Cell;

    std::thread_local! {
        static READS: Cell<u32> = const { Cell::new(0) };
        static WRITES: Cell<u32> = const { Cell::new(0) };
    }

    pub(crate) fn record_read() {
        READS.with(|c| c.set(c.get() + 1));
    }

    pub(crate) fn record_write() {
        WRITES.with(|c| c.set(c.get() + 1));
    }

    /// Zero both counters and return a guard-free handle to read them back.
    pub(crate) fn reset() {
        READS.with(|c| c.set(0));
        WRITES.with(|c| c.set(0));
    }

    pub(crate) fn reads() -> u32 {
        READS.with(|c| c.get())
    }

    pub(crate) fn writes() -> u32 {
        WRITES.with(|c| c.get())
    }
}

/// No-op counters outside tests: the instrumentation compiles away entirely.
#[cfg(not(test))]
mod metrics {
    #[inline(always)]
    pub(crate) fn record_read() {}
    #[inline(always)]
    pub(crate) fn record_write() {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

/// Result of one top-down walk.
struct Walk {
    /// The node the walk finished on, or `None` when no node precedes the
    /// target (the walk never left the head sentinel).
    pred: Option<SerialNode>,
    /// Per level, the key of the last node visited at that level; [`NIL`] means
    /// the head sentinel. These are the splice points [`insert`] patches.
    update: [u64; MAX_LEVEL],
    /// The head vector, returned so callers need not read it a second time.
    head: Vec<u64>,
}

/// Walk from the top level down, advancing while the next key is `< target`
/// (`inclusive == false`) or `<= target` (`inclusive == true`).
///
/// Expected cost is `O(log N)` node reads: each level skips over about half the
/// remaining candidates, and the walk drops a level as soon as the next hop
/// would overshoot.
fn walk(env: &Env, target: u64, inclusive: bool) -> Walk {
    let head = load_head(env);
    let mut update = [NIL; MAX_LEVEL];
    let mut pred: Option<SerialNode> = None;

    let mut level = MAX_LEVEL;
    while level > 0 {
        level -= 1;
        loop {
            let next = match &pred {
                None => head.get(level as u32).unwrap_or(NIL),
                Some(node) => node.next.get(level as u32).unwrap_or(NIL),
            };
            let advance = next != NIL && if inclusive { next <= target } else { next < target };
            if !advance {
                break;
            }
            pred = Some(load_node(env, next));
        }
        update[level] = match &pred {
            None => NIL,
            Some(node) => node.start,
        };
    }

    Walk { pred, update, head }
}

/// Whether `[start, end]` is clear of every range in the skip list.
///
/// Only the two neighbouring ranges need checking — see the module docs for why
/// disjointness makes that sufficient.
pub(crate) fn is_free(env: &Env, start: u64, end: u64) -> bool {
    let walk = walk(env, start, true);

    let succ = match &walk.pred {
        Some(node) => {
            // Predecessor starts at or before `start`; it collides exactly when
            // it has not finished before `start` begins.
            if node.end >= start {
                return false;
            }
            node.next.get(0).unwrap_or(NIL)
        }
        None => walk.head.get(0).unwrap_or(NIL),
    };

    // Successor starts after `start`; it collides exactly when it begins within
    // the candidate range.
    succ == NIL || succ > end
}

// ─────────────────────────────────────────────────────────────────────────────
// Insertion
// ─────────────────────────────────────────────────────────────────────────────

/// Deterministic level for `start`, geometrically distributed over
/// `1..=MAX_LEVEL`.
///
/// The key is run through the SplitMix64 finaliser to decorrelate the sequential
/// serial numbers real batches use, then the level is read off the trailing zero
/// count — level `k` has probability `2^-k`, exactly the distribution a fair
/// coin-flip promotion would give, but reproducible on every validator.
fn level_for(start: u64) -> usize {
    let mut z = start.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;

    let level = z.trailing_zeros() as usize + 1;
    if level > MAX_LEVEL {
        MAX_LEVEL
    } else {
        level
    }
}

/// Splice `[start, end]` into the skip list.
///
/// Callers must have confirmed with [`is_free`] that the range does not overlap
/// anything; inserting a duplicate `start` is a no-op so a retried migration
/// cannot corrupt the list.
pub(crate) fn insert(env: &Env, start: u64, end: u64) {
    metrics::record_read();
    if env
        .storage()
        .persistent()
        .has(&SerialIndexKey::Node(start))
    {
        return;
    }

    let walk = walk(env, start, false);
    let level = level_for(start);

    let mut next: Vec<u64> = Vec::new(env);
    for _ in 0..level {
        next.push_back(NIL);
    }

    let mut head = walk.head.clone();
    let mut head_dirty = false;

    // `update` is non-increasing in list position as the level rises, so equal
    // splice points form contiguous runs; handling a run at a time means each
    // predecessor node is loaded and written exactly once.
    let mut i = 0usize;
    while i < level {
        let splice = walk.update[i];
        if splice == NIL {
            let mut j = i;
            while j < level && walk.update[j] == NIL {
                next.set(j as u32, head.get(j as u32).unwrap_or(NIL));
                head.set(j as u32, start);
                j += 1;
            }
            head_dirty = true;
            i = j;
        } else {
            let mut node = load_node(env, splice);
            let mut j = i;
            while j < level && walk.update[j] == splice {
                next.set(j as u32, node.next.get(j as u32).unwrap_or(NIL));
                node.next.set(j as u32, start);
                j += 1;
            }
            store_node(env, &node);
            i = j;
        }
    }

    store_node(env, &SerialNode { start, end, next });
    if head_dirty {
        store_head(env, &head);
    }
    store_count(env, len(env) + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy registry (pre-#887 deployments)
// ─────────────────────────────────────────────────────────────────────────────

fn legacy_registry(env: &Env) -> Option<Map<u64, u64>> {
    env.storage().persistent().get(&DataKey::SerialRegistry)
}

/// How many ranges still sit in the legacy flat map awaiting [`migrate`].
pub(crate) fn legacy_pending(env: &Env) -> u32 {
    legacy_registry(env).map_or(0, |registry| registry.len())
}

/// Whether `[start, end]` is clear of every *unmigrated* legacy range.
///
/// This retains the previous binary search over the sorted key list. It stays
/// linear in the entry's size — unavoidable while the ranges share one ledger
/// entry — which is precisely why [`migrate`] exists.
pub(crate) fn legacy_is_free(env: &Env, start: u64, end: u64) -> bool {
    let registry = match legacy_registry(env) {
        Some(registry) if !registry.is_empty() => registry,
        _ => return true,
    };

    // Soroban `Map` keeps keys sorted, so the predecessor/successor pair can be
    // bracketed by an upper-bound search for `start`.
    let keys: Vec<u64> = registry.keys();
    let len = keys.len();
    let mut lo: u32 = 0;
    let mut hi: u32 = len;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if keys.get(mid).unwrap() <= start {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    if lo > 0 {
        let pred_start = keys.get(lo - 1).unwrap();
        if registry.get(pred_start).unwrap() >= start {
            return false;
        }
    }
    if lo < len && keys.get(lo).unwrap() <= end {
        return false;
    }
    true
}

/// Move up to `limit` ranges out of the legacy map and into the skip list,
/// returning how many were moved.
///
/// Draining in bounded chunks keeps each call inside the transaction budget on
/// registries too large to convert in one go. The legacy entry is removed once
/// the last range leaves it, at which point overlap checks are fully
/// sub-linear.
pub(crate) fn migrate(env: &Env, limit: u32) -> u32 {
    let mut registry = match legacy_registry(env) {
        Some(registry) => registry,
        None => return 0,
    };
    if registry.is_empty() {
        env.storage().persistent().remove(&DataKey::SerialRegistry);
        return 0;
    }

    let keys: Vec<u64> = registry.keys();
    let take = if limit < keys.len() { limit } else { keys.len() };

    let mut moved = 0u32;
    for index in 0..take {
        let range_start = keys.get(index).unwrap();
        let range_end = registry.get(range_start).unwrap();
        // Legacy ranges are already pairwise disjoint, but re-checking keeps a
        // partially-applied migration idempotent if it is ever replayed.
        if is_free(env, range_start, range_end) {
            insert(env, range_start, range_end);
        }
        registry.remove(range_start);
        moved += 1;
    }

    if registry.is_empty() {
        env.storage().persistent().remove(&DataKey::SerialRegistry);
    } else {
        env.storage()
            .persistent()
            .set(&DataKey::SerialRegistry, &registry);
        env.storage().persistent().extend_ttl(
            &DataKey::SerialRegistry,
            TTL_LEDGERS,
            TTL_LEDGERS,
        );
    }

    moved
}

// ── Tests ────────────────────────────────────────────────────────────────────
// Declared as a child module so the tests can reach the private node/head
// accessors and assert the skip list's internal shape, not just its behaviour.
#[cfg(test)]
#[path = "serial_index_tests.rs"]
mod tests;
