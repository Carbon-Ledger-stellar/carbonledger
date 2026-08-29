//! Tests for the sub-linear serial-range index (issue #887).
//!
//! Three groups:
//!
//! * **Structure** — the skip list's own invariants (ordering, level
//!   consistency, disjointness) after bulk insertion.
//! * **Overlap semantics** — boundary conditions, complete and partial
//!   overlaps, and adjacent allocations, checked both directly against the
//!   index and end-to-end through `mint_credits`.
//! * **Scaling** — that lookup and insert cost stay flat as the registry grows
//!   past 1,000 ranges, which is the property the flat map lacked.

use super::*;
use crate::{CarbonCreditContract, CarbonCreditContractClient, CarbonError, DataKey};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, LedgerInfo},
    Address, Env, String as SorobanString,
};

extern crate std;
use std::{format, vec::Vec as StdVec};

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

fn ledger(env: &Env) {
    env.ledger().set(LedgerInfo {
        timestamp: 1_735_689_600, // 2025-01-01
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    });
}

/// An `Env` with the contract registered, for exercising `serial_index`
/// directly inside `env.as_contract`.
fn raw_env() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    ledger(&env);
    let id = env.register_contract(None, CarbonCreditContract);
    (env, id)
}

/// An `Env` plus an initialized client, for end-to-end `mint_credits` checks.
fn client_env() -> (Env, CarbonCreditContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    ledger(&env);
    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &id);
    client.initialize(&admin, &registry);
    (env, client, admin)
}

fn mint_range(
    env: &Env,
    client: &CarbonCreditContractClient,
    admin: &Address,
    batch: &str,
    start: u64,
    end: u64,
) -> Result<(), CarbonError> {
    let owner = Address::generate(env);
    client
        .try_mint_credits(
            admin,
            &SorobanString::from_str(env, "proj-887"),
            &100_i128,
            &2023_u32,
            &SorobanString::from_str(env, batch),
            &start,
            &end,
            &SorobanString::from_str(env, "QmCID"),
            &owner,
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

/// Every range in the index, read off the level-0 chain in list order.
fn level0_ranges(env: &Env) -> StdVec<(u64, u64)> {
    let mut out = StdVec::new();
    let mut key = load_head(env).get(0).unwrap();
    while key != NIL {
        let node = load_node(env, key);
        out.push((node.start, node.end));
        key = node.next.get(0).unwrap();
    }
    out
}

/// Assert the skip list is well formed: level 0 is strictly ordered and
/// disjoint, every higher level is an ordered subsequence of level 0, no
/// forward pointer dangles, and the stored count matches reality.
fn assert_well_formed(env: &Env) {
    let ranges = level0_ranges(env);

    for window in ranges.windows(2) {
        let (a_start, a_end) = window[0];
        let (b_start, b_end) = window[1];
        assert!(a_start < b_start, "level 0 out of order: {a_start} !< {b_start}");
        assert!(a_start <= a_end, "malformed range [{a_start}, {a_end}]");
        assert!(b_start <= b_end, "malformed range [{b_start}, {b_end}]");
        assert!(
            a_end < b_start,
            "ranges overlap: [{a_start},{a_end}] vs [{b_start},{b_end}]"
        );
    }

    assert_eq!(
        len(env) as usize,
        ranges.len(),
        "stored count disagrees with the level-0 chain"
    );

    let head = load_head(env);
    assert_eq!(head.len() as usize, MAX_LEVEL, "head vector has the wrong height");

    for level in 1..MAX_LEVEL {
        let mut key = head.get(level as u32).unwrap();
        let mut previous = 0u64;
        while key != NIL {
            let node = load_node(env, key);
            assert!(key > previous, "level {level} out of order at key {key}");
            assert!(
                node.next.len() as usize > level,
                "node {key} appears on level {level} but has height {}",
                node.next.len()
            );
            assert!(
                ranges.iter().any(|(start, _)| *start == key),
                "level {level} references {key}, absent from level 0"
            );
            previous = key;
            key = node.next.get(level as u32).unwrap();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn empty_index_accepts_anything() {
    let (env, id) = raw_env();
    env.as_contract(&id, || {
        assert_eq!(len(&env), 0);
        assert!(is_free(&env, 1, 100));
        assert!(is_free(&env, u64::MAX - 1, u64::MAX));
    });
}

#[test]
fn insertion_in_ascending_order_is_well_formed() {
    let (env, id) = raw_env();
    env.budget().reset_unlimited();
    env.as_contract(&id, || {
        for i in 0..200u64 {
            let start = i * 10 + 1;
            insert(&env, start, start + 4);
        }
        assert_eq!(len(&env), 200);
        assert_well_formed(&env);
    });
}

#[test]
fn insertion_in_descending_order_is_well_formed() {
    let (env, id) = raw_env();
    env.budget().reset_unlimited();
    env.as_contract(&id, || {
        for i in (0..200u64).rev() {
            let start = i * 10 + 1;
            insert(&env, start, start + 4);
        }
        assert_eq!(len(&env), 200);
        assert_well_formed(&env);
    });
}

/// Insertion order must not affect the resulting set of ranges, and a
/// scattered order exercises splices in the middle of every level.
#[test]
fn insertion_in_scattered_order_is_well_formed() {
    let (env, id) = raw_env();
    env.budget().reset_unlimited();
    env.as_contract(&id, || {
        // A stride coprime with the modulus visits every slot exactly once.
        let mut slot = 0u64;
        for _ in 0..251u64 {
            slot = (slot + 97) % 251;
            let start = slot * 1_000 + 1;
            insert(&env, start, start + 999);
        }
        assert_eq!(len(&env), 251);
        assert_well_formed(&env);

        let ranges = level0_ranges(&env);
        assert_eq!(ranges.first().copied(), Some((1, 1_000)));
        assert_eq!(ranges.last().copied(), Some((250_001, 251_000)));
    });
}

#[test]
fn reinserting_the_same_start_is_a_no_op() {
    let (env, id) = raw_env();
    env.as_contract(&id, || {
        insert(&env, 100, 200);
        insert(&env, 100, 999);
        assert_eq!(len(&env), 1);
        assert_eq!(level0_ranges(&env), StdVec::from([(100u64, 200u64)]));
        assert_well_formed(&env);
    });
}

/// Node height must be a pure function of the key so every validator builds an
/// identical list from an identical mint sequence.
#[test]
fn node_level_is_deterministic_and_bounded() {
    for key in [1u64, 2, 3, 17, 1_000, 999_983, u64::MAX] {
        let level = level_for(key);
        assert_eq!(level, level_for(key), "level_for({key}) is not deterministic");
        assert!((1..=MAX_LEVEL).contains(&level), "level {level} out of range");
    }
}

/// A degenerate promotion rule (everything at level 1) would silently turn the
/// search back into a linear scan, so assert the distribution actually spreads.
#[test]
fn node_levels_are_geometrically_distributed() {
    let sample = 4_000u32;
    let mut promoted = 0u32;
    let mut max_seen = 0usize;
    for key in 1..=sample as u64 {
        let level = level_for(key * 7 + 1);
        if level > 1 {
            promoted += 1;
        }
        if level > max_seen {
            max_seen = level;
        }
    }
    // The expected promotion rate is 1/2; allow a wide band around it.
    assert!(
        (sample / 3..=sample * 2 / 3).contains(&promoted),
        "promotion rate {promoted}/{sample} is not near one half"
    );
    assert!(
        max_seen >= 8,
        "tallest node was only level {max_seen}; the list would stay flat"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlap semantics
// ─────────────────────────────────────────────────────────────────────────────

/// The core table: one range at [100, 200], every relative position tested.
#[test]
fn overlap_detection_covers_every_relative_position() {
    let (env, id) = raw_env();
    env.as_contract(&id, || {
        insert(&env, 100, 200);

        // Disjoint, including the two touching-but-adjacent cases.
        assert!(is_free(&env, 1, 99), "strictly before must be free");
        assert!(is_free(&env, 98, 99), "abutting on the left must be free");
        assert!(is_free(&env, 201, 300), "abutting on the right must be free");
        assert!(is_free(&env, 500, 600), "strictly after must be free");

        // Boundary contact by exactly one serial.
        assert!(!is_free(&env, 50, 100), "ending on the first serial overlaps");
        assert!(!is_free(&env, 200, 300), "starting on the last serial overlaps");

        // Complete overlaps.
        assert!(!is_free(&env, 100, 200), "identical range overlaps");
        assert!(!is_free(&env, 1, 1_000), "enclosing range overlaps");
        assert!(!is_free(&env, 120, 180), "enclosed range overlaps");

        // Partial overlaps.
        assert!(!is_free(&env, 50, 150), "left partial overlaps");
        assert!(!is_free(&env, 150, 250), "right partial overlaps");

        // Shared endpoints.
        assert!(!is_free(&env, 100, 150), "shared start overlaps");
        assert!(!is_free(&env, 150, 200), "shared end overlaps");

        // Single-serial probes.
        assert!(!is_free(&env, 150, 150), "single serial inside overlaps");
        assert!(is_free(&env, 99, 99), "single serial in the gap is free");
        assert!(is_free(&env, 201, 201), "single serial past the end is free");
    });
}

/// Ranges packed with a ten-serial gap between them: every gap must remain
/// allocatable and every occupied serial must stay rejected.
#[test]
fn adjacent_allocations_fill_gaps_exactly() {
    let (env, id) = raw_env();
    env.budget().reset_unlimited();
    env.as_contract(&id, || {
        // Occupy [1,10], [21,30], [41,50], ... leaving gaps [11,20], [31,40], ...
        for i in 0..100u64 {
            let start = i * 20 + 1;
            insert(&env, start, start + 9);
        }
        assert_well_formed(&env);

        for i in 0..100u64 {
            let gap_start = i * 20 + 11;
            let gap_end = gap_start + 9;
            assert!(is_free(&env, gap_start, gap_end), "gap {i} should be free");
            assert!(
                !is_free(&env, gap_start - 1, gap_end),
                "gap {i} extended left overlaps"
            );
            // Extending right runs into the next range — except past the last
            // one, where the serial space is simply empty.
            if i < 99 {
                assert!(
                    !is_free(&env, gap_start, gap_end + 1),
                    "gap {i} extended right overlaps"
                );
            } else {
                assert!(is_free(&env, gap_start, gap_end + 1), "past the last range is free");
            }
        }

        // Fill every gap; the index must then be one contiguous block.
        for i in 0..100u64 {
            let gap_start = i * 20 + 11;
            insert(&env, gap_start, gap_start + 9);
        }
        assert_eq!(len(&env), 200);
        assert_well_formed(&env);
        assert!(!is_free(&env, 1, 2_000), "fully packed space accepts nothing");
    });
}

#[test]
fn extremes_of_the_serial_space_are_handled() {
    let (env, id) = raw_env();
    env.as_contract(&id, || {
        insert(&env, 1, 1);
        insert(&env, u64::MAX, u64::MAX);
        assert_eq!(len(&env), 2);
        assert_well_formed(&env);

        assert!(!is_free(&env, 1, 1), "lowest serial is taken");
        assert!(!is_free(&env, u64::MAX, u64::MAX), "highest serial is taken");
        assert!(is_free(&env, 2, u64::MAX - 1), "the whole middle is free");
        assert!(!is_free(&env, 1, u64::MAX), "spanning range hits both ends");
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end through mint_credits
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn minting_rejects_overlaps_and_accepts_adjacent_ranges() {
    let (env, client, admin) = client_env();

    assert!(mint_range(&env, &client, &admin, "b1", 1_000, 1_999).is_ok());

    for (batch, start, end) in [
        ("x1", 1_000u64, 1_999u64), // identical
        ("x2", 900, 1_500),         // left partial
        ("x3", 1_500, 2_500),       // right partial
        ("x4", 1_200, 1_300),       // enclosed
        ("x5", 500, 5_000),         // enclosing
        ("x6", 999, 1_000),         // touches the first serial
        ("x7", 1_999, 2_500),       // touches the last serial
    ] {
        assert_eq!(
            mint_range(&env, &client, &admin, batch, start, end),
            Err(CarbonError::DoubleCountingDetected),
            "[{start}, {end}] should have been rejected",
        );
    }

    // Immediately adjacent on both sides must still be mintable.
    assert!(mint_range(&env, &client, &admin, "b2", 2_000, 2_999).is_ok());
    assert!(mint_range(&env, &client, &admin, "b3", 1, 999).is_ok());

    assert_eq!(client.serial_index_size(), 3);
    assert!(!client.verify_serial_range(&1_500, &1_600));
    assert!(client.verify_serial_range(&3_000, &4_000));
}

/// A rejected mint must leave no trace in the index — otherwise a failed batch
/// would permanently burn its serial range.
#[test]
fn rejected_mint_does_not_touch_the_index() {
    let (env, client, admin) = client_env();
    assert!(mint_range(&env, &client, &admin, "b1", 100, 200).is_ok());
    assert_eq!(client.serial_index_size(), 1);

    assert_eq!(
        mint_range(&env, &client, &admin, "b2", 150, 250),
        Err(CarbonError::DoubleCountingDetected)
    );
    assert_eq!(client.serial_index_size(), 1);

    // The range the failed mint wanted is still free once the conflict is gone.
    assert!(client.verify_serial_range(&201, &250));
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy migration
// ─────────────────────────────────────────────────────────────────────────────

/// Seed a pre-#887 flat registry directly, as an upgraded contract would have.
fn seed_legacy(env: &Env, id: &Address, ranges: &[(u64, u64)]) {
    env.as_contract(id, || {
        let mut map: soroban_sdk::Map<u64, u64> = soroban_sdk::Map::new(env);
        for (start, end) in ranges {
            map.set(*start, *end);
        }
        env.storage().persistent().set(&DataKey::SerialRegistry, &map);
    });
}

#[test]
fn legacy_ranges_are_enforced_before_and_during_migration() {
    let (env, client, admin) = client_env();
    let id = client.address.clone();
    seed_legacy(&env, &id, &[(100, 200), (300, 400), (500, 600)]);

    assert_eq!(client.serial_index_pending_migration(), 3);
    assert_eq!(client.serial_index_size(), 0);

    // Enforced while still entirely in the legacy map.
    assert!(!client.verify_serial_range(&150, &160));
    assert!(!client.verify_serial_range(&350, &450));
    assert!(client.verify_serial_range(&201, &299));

    // Migrate one at a time; the guarantee must hold at every step.
    for expected_remaining in [2u32, 1, 0] {
        assert_eq!(client.migrate_serial_index(&admin, &1), 1);
        assert_eq!(client.serial_index_pending_migration(), expected_remaining);
        assert!(!client.verify_serial_range(&150, &160));
        assert!(!client.verify_serial_range(&350, &360));
        assert!(!client.verify_serial_range(&550, &560));
        assert!(client.verify_serial_range(&201, &299));
    }

    assert_eq!(client.serial_index_size(), 3);
    assert_eq!(client.migrate_serial_index(&admin, &10), 0);
    env.as_contract(&id, || assert_well_formed(&env));
}

#[test]
fn migration_moves_ranges_verbatim_and_is_idempotent() {
    let (env, client, admin) = client_env();
    let id = client.address.clone();
    let seeded: StdVec<(u64, u64)> = (0..40u64).map(|i| (i * 100 + 1, i * 100 + 50)).collect();
    seed_legacy(&env, &id, &seeded);

    assert_eq!(client.migrate_serial_index(&admin, &1_000), 40);
    assert_eq!(client.serial_index_pending_migration(), 0);
    assert_eq!(client.serial_index_size(), 40);

    env.as_contract(&id, || {
        assert_well_formed(&env);
        assert_eq!(level0_ranges(&env), seeded);
    });

    // Re-running after the drain changes nothing.
    assert_eq!(client.migrate_serial_index(&admin, &1_000), 0);
    assert_eq!(client.serial_index_size(), 40);
}

#[test]
fn mints_interleave_with_a_partial_migration() {
    let (env, client, admin) = client_env();
    let id = client.address.clone();
    seed_legacy(&env, &id, &[(1_000, 1_999), (3_000, 3_999)]);

    assert_eq!(client.migrate_serial_index(&admin, &1), 1);

    // Conflicts with the migrated range and with the still-legacy one alike.
    assert_eq!(
        mint_range(&env, &client, &admin, "a", 1_500, 1_600),
        Err(CarbonError::DoubleCountingDetected)
    );
    assert_eq!(
        mint_range(&env, &client, &admin, "b", 3_500, 3_600),
        Err(CarbonError::DoubleCountingDetected)
    );
    // The gap between them is mintable, and lands in the new index.
    assert!(mint_range(&env, &client, &admin, "c", 2_000, 2_999).is_ok());

    assert_eq!(client.migrate_serial_index(&admin, &10), 1);
    assert_eq!(client.serial_index_pending_migration(), 0);
    assert_eq!(client.serial_index_size(), 3);
    env.as_contract(&id, || {
        assert_well_formed(&env);
        assert_eq!(
            level0_ranges(&env),
            StdVec::from([(1_000u64, 1_999u64), (2_000, 2_999), (3_000, 3_999)])
        );
    });
}

#[test]
fn migration_requires_admin_and_a_positive_limit() {
    let (env, client, admin) = client_env();
    let intruder = Address::generate(&env);

    assert_eq!(
        client
            .try_migrate_serial_index(&intruder, &10)
            .unwrap_err()
            .unwrap(),
        CarbonError::UnauthorizedVerifier
    );
    assert_eq!(
        client
            .try_migrate_serial_index(&admin, &0)
            .unwrap_err()
            .unwrap(),
        CarbonError::ZeroAmountNotAllowed
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scaling
// ─────────────────────────────────────────────────────────────────────────────

/// A fresh index filled with `size` evenly spaced ranges, one per ledger entry.
fn filled(size: u64) -> (Env, Address) {
    let (env, id) = raw_env();
    env.budget().reset_unlimited();
    env.as_contract(&id, || {
        for i in 0..size {
            let start = i * 1_000 + 1;
            insert(&env, start, start + 499);
        }
        assert_eq!(len(&env) as u64, size);
    });
    (env, id)
}

/// `log2(size)`, the yardstick a skip list's cost is supposed to track.
fn log2(size: u64) -> u32 {
    size.ilog2()
}

/// Ledger entries touched by one query and one insert against a registry of
/// `size`, both probing past the far end of the list — the deepest walk the
/// structure can be asked to perform.
///
/// Both are measured against a single filled index because building one is by
/// far the expensive part of these tests.
struct Cost {
    query_reads: u32,
    insert_reads: u32,
    insert_writes: u32,
}

fn measure(size: u64) -> Cost {
    let (env, id) = filled(size);
    env.as_contract(&id, || {
        let probe = size * 1_000 + 1;

        metrics::reset();
        assert!(is_free(&env, probe, probe + 100), "probe should be free");
        let query_reads = metrics::reads();

        metrics::reset();
        insert(&env, probe, probe + 499);
        Cost {
            query_reads,
            insert_reads: metrics::reads(),
            insert_writes: metrics::writes(),
        }
    })
}

/// The headline acceptance criterion. Ledger entries touched — not metered CPU
/// — is the honest measure here: the test host charges a storage *write* in
/// proportion to its entire in-memory storage map, which on-chain holds only
/// the transaction footprint, so budget figures for writes track the harness
/// rather than the contract. Entry counts are exact and translate directly to
/// gas.
///
/// The flat `Map<u64, u64>` this replaced always touched one entry — but that
/// single entry held every range, so its read, deserialise, and rewrite cost
/// grew with `N` without bound. Here each entry is small and fixed-shape, so a
/// bounded entry count really does mean bounded cost.
#[test]
fn cost_stays_sub_linear_past_a_thousand_ranges() {
    let small = measure(100);
    let thousand = measure(1_000);
    let large = measure(2_000);

    std::println!(
        "[#887] ledger entries — query reads 100:{} 1000:{} 2000:{} | \
         insert 100:{}r/{}w 1000:{}r/{}w 2000:{}r/{}w",
        small.query_reads,
        thousand.query_reads,
        large.query_reads,
        small.insert_reads,
        small.insert_writes,
        thousand.insert_reads,
        thousand.insert_writes,
        large.insert_reads,
        large.insert_writes,
    );

    // 20x the registry must not cost anything like 20x the work.
    assert!(
        large.query_reads <= small.query_reads * 2,
        "query reads grew from {} to {} between 100 and 2,000 ranges",
        small.query_reads,
        large.query_reads
    );
    assert!(
        large.insert_reads <= small.insert_reads * 2,
        "insert reads grew from {} to {} between 100 and 2,000 ranges",
        small.insert_reads,
        large.insert_reads
    );

    // Reads must sit in the band a skip list promises: ~2*log2(N) hops plus the
    // head. Generous slack absorbs the level distribution's variance while still
    // failing loudly on a regression to a linear scan.
    for (size, cost) in [(100u64, &small), (1_000, &thousand), (2_000, &large)] {
        let ceiling = 5 * log2(size) + 10;
        assert!(
            cost.query_reads <= ceiling,
            "{} query reads at {size} ranges exceeds the {ceiling} expected of O(log N)",
            cost.query_reads
        );

        // Writes are bounded by construction, independent of N: the new node, at
        // most one splice point per level it occupies, the head, and the counter.
        let write_ceiling = MAX_LEVEL as u32 + 2;
        assert!(
            cost.insert_writes <= write_ceiling,
            "insert at {size} ranges wrote {} entries, above the structural bound {write_ceiling}",
            cost.insert_writes
        );
    }
}

/// The structural reason the cost is bounded: no ledger entry the index writes
/// grows with the number of registered ranges. This is exactly what the flat
/// map got wrong — it accumulated every range in one entry, heading for
/// Soroban's entry-size ceiling.
#[test]
fn no_ledger_entry_grows_with_the_registry() {
    let mut widest_seen = StdVec::new();
    for size in [100u64, 2_000] {
        let (env, id) = filled(size);
        env.as_contract(&id, || {
            let head = load_head(&env);
            assert_eq!(head.len() as usize, MAX_LEVEL, "head height must be fixed");

            let mut widest = 0usize;
            let mut key = head.get(0).unwrap();
            while key != NIL {
                let node = load_node(&env, key);
                let height = node.next.len() as usize;
                assert!(
                    height <= MAX_LEVEL,
                    "node {key} has height {height}, above MAX_LEVEL"
                );
                if height > widest {
                    widest = height;
                }
                key = node.next.get(0).unwrap();
            }
            widest_seen.push((size, widest));
        });
    }

    std::println!("[#887] tallest node — {widest_seen:?}");

    // Node height tracks log2(N), not N, and is hard-capped at MAX_LEVEL. So the
    // largest entry the index can ever write is a constant: two u64 endpoints
    // plus at most MAX_LEVEL forward pointers.
    const MAX_NODE_BYTES: usize = 8 + 8 + 8 * MAX_LEVEL;
    for (size, widest) in widest_seen.iter().copied() {
        let bytes = 8 + 8 + 8 * widest;
        assert!(
            bytes <= MAX_NODE_BYTES,
            "widest node at {size} ranges is {bytes} bytes, above the {MAX_NODE_BYTES}-byte cap"
        );
        assert!(
            widest as u32 <= log2(size) + 4,
            "tallest node at {size} ranges is {widest} levels, above the log2 band"
        );
    }

    // The contrast that motivated the change: the flat Map<u64, u64> kept all
    // N ranges in one entry, so its size grew without bound.
    let (largest_size, widest) = widest_seen[widest_seen.len() - 1];
    let flat_map_bytes = largest_size as usize * 16;
    assert!(
        8 + 8 + 8 * widest < flat_map_bytes / 10,
        "the skip list's largest entry should be a small fraction of the flat map's"
    );
}

/// Correctness, not just cost, at the scale the issue calls out: with 1,000+
/// ranges registered every occupied span is rejected and every gap accepted.
#[test]
fn a_thousand_ranges_remain_exactly_queryable() {
    let (env, id) = raw_env();
    env.budget().reset_unlimited();
    env.as_contract(&id, || {
        for i in 0..1_500u64 {
            let start = i * 100 + 1;
            insert(&env, start, start + 79);
        }
        assert_eq!(len(&env), 1_500);
        assert_well_formed(&env);

        for i in (0..1_500u64).step_by(7) {
            // Range i occupies [start, start + 79]; the gap before range i + 1
            // is [start + 80, start + 99].
            let start = i * 100 + 1;
            assert!(!is_free(&env, start, start + 79), "range {i} should be taken");
            assert!(
                !is_free(&env, start + 79, start + 90),
                "range {i} tail overlaps"
            );
            assert!(
                is_free(&env, start + 80, start + 99),
                "gap after range {i} should be free"
            );
            assert!(
                !is_free(&env, start + 80, start + 100),
                "gap after range {i} extended into range {} overlaps",
                i + 1
            );
        }
    });
}

/// Same scale, driven through the real `mint_credits` entry point so the whole
/// path — auth, validation, index write — is covered, not just the index.
#[test]
fn minting_a_thousand_batches_keeps_the_index_consistent() {
    let (env, client, admin) = client_env();
    env.budget().reset_unlimited();

    for i in 0..1_000u64 {
        let start = i * 200 + 1;
        assert!(
            mint_range(&env, &client, &admin, &format!("batch-{i}"), start, start + 99).is_ok(),
            "mint {i} should succeed"
        );
    }
    assert_eq!(client.serial_index_size(), 1_000);

    assert!(!client.verify_serial_range(&1, &100));
    assert!(!client.verify_serial_range(&199_801, &199_900));
    assert!(client.verify_serial_range(&199_901, &200_000));

    let id = client.address.clone();
    env.as_contract(&id, || assert_well_formed(&env));
}
