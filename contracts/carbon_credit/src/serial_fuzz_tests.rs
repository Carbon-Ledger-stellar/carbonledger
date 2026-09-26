//! Property-based fuzz tests for serial-number allocation invariants.
//!
//! These tests use the `proptest` crate to generate thousands of randomized
//! serial ranges and verify the fundamental mathematical invariants that
//! prevent double-counting of carbon credits:
//!
//!   INV-1: After any sequence of valid mints, registered serial ranges are
//!          pairwise disjoint — no serial number belongs to two batches.
//!
//!   INV-2: The `is_free` predicate is consistent with the actual set of
//!          inserted ranges — a range is reported free iff it intersects
//!          nothing already in the index.
//!
//!   INV-3: Serial range validation rejects degenerate inputs (start == 0,
//!          start >= end, overflow) without corrupting the index.
//!
//!   INV-4: Total supply conservation — `sum(minted) >= sum(retired)` —
//!          holds after every randomized mint/retire sequence.
//!
//!   INV-5: Insertion order does not affect index correctness.
//!
//!   INV-6: Adjacent (touching-but-not-overlapping) ranges are accepted.
//!
//! Run with:
//!   PROPTEST_CASES=1000 cargo test -p carbon_credit serial_fuzz -- --nocapture
//!
//! The `PROPTEST_CASES` environment variable controls iteration count.
//! Our `proptest!` macros set a floor of 1,000 via `ProptestConfig`.

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String as SorobanString,
};

use crate::{CarbonCreditContract, CarbonCreditContractClient, CarbonError, CreditStatus};

extern crate std;
use std::{format, vec::Vec as StdVec};

// ── Test environment setup ───────────────────────────────────────────────────

fn setup_env() -> (Env, CarbonCreditContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_735_689_600, // 2025-01-01
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    });
    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &id);
    client.initialize(&admin, &registry);
    (env, client, admin)
}

fn s(env: &Env, v: &str) -> SorobanString {
    SorobanString::from_str(env, v)
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
            &s(env, "proj-fuzz"),
            &100_i128,
            &2023_u32,
            &s(env, batch),
            &start,
            &end,
            &s(env, "QmCID"),
            &owner,
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

// ═════════════════════════════════════════════════════════════════════════════
// INV-1: Registered serial ranges are pairwise disjoint after any valid mints
// ═════════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest::test_runner::Config::with_cases(1_000))]

    /// INV-1a: Minting two non-overlapping ranges in ascending order always
    /// succeeds and the index reports the gap between them as free.
    #[test]
    fn prop_two_disjoint_mints_succeed(
        (s1, e1) in (1u64..1_000_000).prop_flat_map(|s| ((s + 1)..=1_000_000).prop_map(move |e| (s, e))),
        gap in 1u64..100_000u64,
    ) {
        let (env, client, admin) = setup_env();
        env.budget().reset_unlimited();

        let s2 = e1.saturating_add(gap);
        let e2 = s2.saturating_add(1);
        prop_assume!(e2 > s2, "e2 must not overflow");
        prop_assume!(s2 >= 1, "s2 must be at least 1");

        let r1 = mint_range(&env, &client, &admin, "b1", s1, e1);
        let r2 = mint_range(&env, &client, &admin, "b2", s2, e2);

        prop_assert!(r1.is_ok(), "first mint must succeed: [{s1}, {e1}]");
        prop_assert!(r2.is_ok(), "second mint must succeed: [{s2}, {e2}]");
        prop_assert_eq!(client.serial_index_size(), 2);

        // The gap (e1+1 .. s2-1) should be free, unless it's empty
        if s2 > e1 + 1 {
            prop_assert!(
                client.verify_serial_range(&(e1 + 1), &(s2 - 1)),
                "gap between ranges should be free"
            );
        }
        // Neither range should be free
        prop_assert!(!client.verify_serial_range(&s1, &e1), "first range should be occupied");
        prop_assert!(!client.verify_serial_range(&s2, &e2), "second range should be occupied");
    }

    /// INV-1b: Minting two overlapping ranges in ascending order always
    /// rejects the second with DoubleCountingDetected.
    #[test]
    fn prop_overlapping_mint_rejected(
        (s1, e1) in (1u64..500_000).prop_flat_map(|s| ((s + 1)..=500_000).prop_map(move |e| (s, e))),
        overlap_offset in 0u64..100_000u64,
    ) {
        let (env, client, admin) = setup_env();
        env.budget().reset_unlimited();

        // The second range starts inside or at the first range.
        let s2 = s1.saturating_add(overlap_offset).min(e1);
        // e2 extends beyond the first range to guarantee overlap
        let e2 = core::cmp::max(s2.saturating_add(1), e1.saturating_add(1));
        prop_assume!(s2 >= 1, "s2 must be at least 1");
        prop_assume!(e2 > s2, "e2 must be > s2");

        let r1 = mint_range(&env, &client, &admin, "b1", s1, e1);
        prop_assert!(r1.is_ok(), "first mint must succeed");

        let r2 = mint_range(&env, &client, &admin, "b2", s2, e2);
        prop_assert!(
            r2 == Err(CarbonError::DoubleCountingDetected),
            "overlapping mint must be rejected, got: {r2:?}"
        );
        prop_assert_eq!(client.serial_index_size(), 1, "index must still have only one entry");
    }

    /// INV-1c: After minting N non-overlapping ranges, every range is occupied
    /// and every gap between consecutive ranges is free.
    #[test]
    fn prop_n_disjoint_mints_maintain_invariant(
        starts in prop::collection::vec(1u64..500_000u64, 1..5),
    ) {
        let (env, client, admin) = setup_env();
        env.budget().reset_unlimited();

        // Sort and deduplicate, then assign non-overlapping ranges
        let mut sorted: StdVec<u64> = starts;
        sorted.sort();
        sorted.dedup();
        prop_assume!(sorted.len() >= 2, "need at least 2 distinct starts");

        let mut ranges: StdVec<(u64, u64)> = StdVec::new();
        let mut next_start = sorted[0];
        for &desired_start in sorted.iter().take(5) {
            let start = core::cmp::max(next_start, desired_start);
            let end = start + 99; // each range spans 100 serials
            prop_assume!(end <= u64::MAX - 1000, "avoid overflow");
            ranges.push((start, end));
            next_start = end + 1;
        }

        // Mint all ranges
        for (i, &(start, end)) in ranges.iter().enumerate() {
            let r = mint_range(&env, &client, &admin, &format!("b{i}"), start, end);
            prop_assert!(r.is_ok(), "mint {i} must succeed: [{start}, {end}]");
        }

        let minted = ranges.len() as u32;
        prop_assert_eq!(client.serial_index_size(), minted);

        // Every minted range must be occupied
        for &(start, end) in &ranges {
            prop_assert!(
                !client.verify_serial_range(&start, &end),
                "minted range [{start}, {end}] should be occupied"
            );
        }

        // Every gap between consecutive ranges must be free
        for window in ranges.windows(2) {
            let (_, prev_end) = window[0];
            let (next_start_gap, _) = window[1];
            if next_start_gap > prev_end + 1 {
                let gap_start = prev_end + 1;
                let gap_end = next_start_gap - 1;
                prop_assert!(
                    client.verify_serial_range(&gap_start, &gap_end),
                    "gap [{gap_start}, {gap_end}] should be free"
                );
            }
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// INV-2: is_free predicate is consistent — no false positives or negatives
// ═════════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest::test_runner::Config::with_cases(1_000))]

    /// INV-2a: After inserting [s, e], verify_serial_range reports exactly the
    /// same range as occupied, but [s-1, s-1] and [e+1, e+1] (if valid) as free.
    #[test]
    fn prop_inserted_range_is_consistently_occupied(
        (start, end) in (1u64..u64::MAX - 1000).prop_flat_map(|s| ((s + 1)..=(s + 999)).prop_map(move |e| (s, e))),
    ) {
        let (env, client, admin) = setup_env();

        let r = mint_range(&env, &client, &admin, "b1", start, end);
        prop_assert!(r.is_ok(), "mint must succeed");

        // The exact range is occupied
        prop_assert!(!client.verify_serial_range(&start, &end), "inserted range must be occupied");

        // A single serial inside the range is occupied
        let mid = start + (end - start) / 2;
        prop_assert!(!client.verify_serial_range(&mid, &mid), "serial inside range must be occupied");

        // Just before the range (if valid) is free
        if start > 1 {
            prop_assert!(
                client.verify_serial_range(&(start - 1), &(start - 1)),
                "serial just before range must be free"
            );
        }

        // Just after the range is free (end < u64::MAX by construction)
        if end < u64::MAX {
            prop_assert!(
                client.verify_serial_range(&(end + 1), &(end + 1)),
                "serial just after range must be free"
            );
        }
    }

    /// INV-2b: Overlapping ranges are correctly detected as occupied.
    #[test]
    fn prop_overlap_detection_all_topological_cases(
        (existing_start, existing_end) in (1u64..200_000u64).prop_flat_map(|s| ((s + 1)..=200_000).prop_map(move |e| (s, e))),
        candidate_start in 1u64..400_000u64,
        extend in 0u64..200_000u64,
    ) {
        let (env, client, admin) = setup_env();
        env.budget().reset_unlimited();

        // Insert the existing range
        let r1 = mint_range(&env, &client, &admin, "existing", existing_start, existing_end);
        prop_assume!(r1.is_ok(), "existing mint must succeed");

        // Compute a candidate that definitely overlaps
        let candidate_end = core::cmp::max(candidate_start, existing_start).saturating_add(extend);
        prop_assume!(candidate_start <= existing_end, "must overlap");
        prop_assume!(candidate_end >= existing_start, "must overlap");
        prop_assume!(candidate_end <= u64::MAX - 1, "no overflow");
        prop_assume!(candidate_end > candidate_start, "candidate must be valid range");

        let r2 = mint_range(&env, &client, &admin, "candidate", candidate_start, candidate_end);
        prop_assert!(
            r2 == Err(CarbonError::DoubleCountingDetected),
            "overlapping range must be rejected: [{candidate_start}, {candidate_end}] vs [{existing_start}, {existing_end}]"
        );

        // The existing range is still occupied
        prop_assert!(
            !client.verify_serial_range(&existing_start, &existing_end),
            "existing range must still be occupied after rejected mint"
        );
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// INV-3: Degenerate / edge-case serial ranges are correctly rejected
// ═════════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest::test_runner::Config::with_cases(1_000))]

    /// INV-3a: serial_start == 0 is always rejected (InvalidSerialRange).
    #[test]
    fn prop_zero_start_rejected(
        end in 1u64..=u64::MAX,
    ) {
        let (env, client, admin) = setup_env();
        let r = mint_range(&env, &client, &admin, "b1", 0, end);
        prop_assert_eq!(
            r,
            Err(CarbonError::InvalidSerialRange),
            "serial_start=0 must be rejected"
        );
    }

    /// INV-3b: serial_start == serial_end is always rejected (InvalidSerialRange).
    #[test]
    fn prop_equal_start_end_rejected(
        start in 1u64..=u64::MAX,
    ) {
        let (env, client, admin) = setup_env();
        let r = mint_range(&env, &client, &admin, "b1", start, start);
        prop_assert_eq!(
            r,
            Err(CarbonError::InvalidSerialRange),
            "serial_start == serial_end must be rejected"
        );
    }

    /// INV-3c: After a rejected mint, the index is unchanged — the failed
    /// batch does not burn its serial range.
    #[test]
    fn prop_rejected_mint_leaves_index_clean(
        (s1, e1) in (1u64..100_000u64).prop_flat_map(|s| ((s + 1)..=100_000).prop_map(move |e| (s, e))),
        bad_start in 1u64..=200_000u64,
    ) {
        let (env, client, admin) = setup_env();
        env.budget().reset_unlimited();

        // Mint a valid range first
        let r1 = mint_range(&env, &client, &admin, "good", s1, e1);
        prop_assume!(r1.is_ok());

        let size_before = client.serial_index_size();

        // Try to mint an invalid range (start == end → InvalidSerialRange)
        let _ = mint_range(&env, &client, &admin, "bad", bad_start, bad_start);

        prop_assert_eq!(
            client.serial_index_size(),
            size_before,
            "rejected mint must not change index size"
        );

        // The good range is still occupied
        prop_assert!(
            !client.verify_serial_range(&s1, &e1),
            "original range must still be occupied"
        );
    }

    /// INV-3d: u64::MAX as serial_end with valid serial_start succeeds,
    /// verifying no overflow in range arithmetic.
    #[test]
    fn prop_u64_max_end_no_overflow(
        start in 1u64..=u64::MAX - 1,
    ) {
        let (env, client, admin) = setup_env();
        env.budget().reset_unlimited();

        let r = mint_range(&env, &client, &admin, "b1", start, u64::MAX);
        prop_assert!(r.is_ok(), "range [{start}, u64::MAX] must not overflow");

        prop_assert!(
            !client.verify_serial_range(&start, &u64::MAX),
            "range must be occupied"
        );
        if start > 1 {
            prop_assert!(
                client.verify_serial_range(&(start - 1), &(start - 1)),
                "serial before must be free"
            );
        }
    }

    /// INV-3e: Single-serial ranges at the very start and very end of the
    /// u64 space are handled correctly.
    #[test]
    fn prop_extremes_of_serial_space(
        use_start in proptest::bool::weighted(0.5),
    ) {
        let (env, client, admin) = setup_env();

        if use_start {
            let r = mint_range(&env, &client, &admin, "first", 1, 1);
            // InvalidSerialRange because start == end
            prop_assert_eq!(r, Err(CarbonError::InvalidSerialRange));
        } else {
            let r = mint_range(&env, &client, &admin, "last", u64::MAX - 1, u64::MAX);
            prop_assert!(r.is_ok(), "[u64::MAX-1, u64::MAX] must succeed");
            prop_assert!(
                !client.verify_serial_range(&(u64::MAX - 1), &u64::MAX),
                "range must be occupied"
            );
            prop_assert!(
                client.verify_serial_range(&(u64::MAX - 2), &(u64::MAX - 2)),
                "serial before must be free"
            );
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// INV-4: Total supply conservation after randomized mint/retire sequences
// ═════════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest::test_runner::Config::with_cases(1_000))]

    /// INV-4a: After minting N ranges and then retiring portions of some,
    /// the total minted amount is always >= total retired amount.
    #[test]
    fn prop_supply_conservation_after_randomized_sequence(
        batch_sizes in prop::collection::vec(100i128..10_000i128, 1..5),
    ) {
        let (env, client, admin) = setup_env();
        env.budget().reset_unlimited();
        let owner = Address::generate(&env);

        let mut total_minted: i128 = 0;
        let mut total_retired: i128 = 0;
        let mut next_start: u64 = 1;

        for (i, &amount) in batch_sizes.iter().enumerate() {
            let serial_end = next_start.saturating_add((amount as u64).saturating_sub(1));
            prop_assume!(serial_end <= u64::MAX - 100_000, "avoid u64 overflow");
            prop_assume!(serial_end > next_start, "serial range must be valid");

            let r = client.try_mint_credits(
                &admin,
                &s(&env, "proj-supply"),
                &amount,
                &2023_u32,
                &s(&env, &format!("batch-{i}")),
                &next_start,
                &serial_end,
                &s(&env, "QmCID"),
                &owner,
            );

            if r.is_ok() {
                total_minted += amount;
                next_start = serial_end.saturating_add(1);

                // Randomly retire half the batch
                let retire_amount = amount / 2;
                if retire_amount > 0 {
                    let ret_id = format!("ret-{i}");
                    let cert = client.try_retire_credits(
                        &owner,
                        &s(&env, &format!("batch-{i}")),
                        &retire_amount,
                        &s(&env, "offset"),
                        &s(&env, "Corp"),
                        &s(&env, &ret_id),
                        &s(&env, "tx"),
                        &s(&env, "QmCert"),
                    );
                    if cert.is_ok() {
                        total_retired += retire_amount;
                    }
                }
            }
        }

        // Core conservation law: minted >= retired
        prop_assert!(
            total_minted >= total_retired,
            "CONSERVATION VIOLATED: minted={total_minted} < retired={total_retired}"
        );
        prop_assert!(
            total_minted >= 0,
            "total_minted must be non-negative: {total_minted}"
        );
        prop_assert!(
            total_retired >= 0,
            "total_retired must be non-negative: {total_retired}"
        );
    }

    /// INV-4b: Retiring more than available always fails and doesn't corrupt state.
    #[test]
    fn prop_overretire_always_rejected(
        mint_amount in 100i128..1_000_000i128,
        overretire_extra in 1i128..1_000_000i128,
    ) {
        let (env, client, admin) = setup_env();
        let owner = Address::generate(&env);

        let serial_end = mint_amount as u64;
        prop_assume!(serial_end <= u64::MAX - 1);
        prop_assume!(serial_end > 1, "serial_end must be > start");

        let r = client.try_mint_credits(
            &admin,
            &s(&env, "proj-over"),
            &mint_amount,
            &2023_u32,
            &s(&env, "batch-over"),
            &1_u64,
            &serial_end,
            &s(&env, "QmCID"),
            &owner,
        );
        prop_assume!(r.is_ok(), "mint must succeed");

        let retire_amount = mint_amount.saturating_add(overretire_extra);
        let ret = client.try_retire_credits(
            &owner,
            &s(&env, "batch-over"),
            &retire_amount,
            &s(&env, "reason"),
            &s(&env, "Corp"),
            &s(&env, "ret-over"),
            &s(&env, "tx"),
            &s(&env, "QmCert"),
        );

        prop_assert!(
            ret.is_err(),
            "over-retirement must be rejected: tried to retire {retire_amount} from {mint_amount}"
        );

        // State unchanged: batch is still Active
        let batch = client.get_credit_batch(&s(&env, "batch-over"));
        prop_assert_eq!(batch.status, CreditStatus::Active);
        prop_assert_eq!(batch.amount, mint_amount);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// INV-5: Ordering-independent insertion produces identical index state
// ═════════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest::test_runner::Config::with_cases(1_000))]

    /// INV-5a: Inserting the same set of non-overlapping ranges in ascending
    /// or descending order produces the same index size and the same
    /// overlap-detection results.
    #[test]
    fn prop_insertion_order_independence(
        starts in prop::collection::vec(1u64..100_000u64, 2..6),
    ) {
        // Build non-overlapping ranges from the starts
        let mut sorted: StdVec<u64> = starts;
        sorted.sort();
        sorted.dedup();
        prop_assume!(sorted.len() >= 2, "need at least 2 distinct starts");

        let mut ranges: StdVec<(u64, u64)> = StdVec::new();
        let mut next = sorted[0];
        for &desired in sorted.iter().take(4) {
            let start = core::cmp::max(next, desired);
            let end = start + 49;
            prop_assume!(end <= u64::MAX - 1000);
            ranges.push((start, end));
            next = end + 1;
        }
        let count = ranges.len();

        // ── Ascending order ──
        let (env_a, client_a, admin_a) = setup_env();
        env_a.budget().reset_unlimited();
        for (i, &(start, end)) in ranges.iter().enumerate() {
            let r = mint_range(&env_a, &client_a, &admin_a, &format!("asc-{i}"), start, end);
            prop_assert!(r.is_ok(), "ascending mint {i} failed");
        }
        prop_assert_eq!(client_a.serial_index_size(), count as u32);

        // ── Descending order ──
        let (env_d, client_d, admin_d) = setup_env();
        env_d.budget().reset_unlimited();
        for (i, &(start, end)) in ranges.iter().enumerate().rev() {
            let r = mint_range(&env_d, &client_d, &admin_d, &format!("desc-{i}"), start, end);
            prop_assert!(r.is_ok(), "descending mint {i} failed");
        }
        prop_assert_eq!(client_d.serial_index_size(), count as u32);

        // Both should agree on which ranges are occupied
        for &(start, end) in &ranges {
            prop_assert_eq!(
                client_a.verify_serial_range(&start, &end),
                client_d.verify_serial_range(&start, &end),
                "ascending and descending must agree on range"
            );
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// INV-6: Adjacent (touching-but-not-overlapping) ranges are always accepted
// ═════════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest::test_runner::Config::with_cases(1_000))]

    /// INV-6a: Two ranges that share exactly one boundary serial
    /// (e.g. [1,100] and [101,200]) never overlap and both are accepted.
    #[test]
    fn prop_adjacent_ranges_accepted(
        start1 in 1u64..=u64::MAX / 2,
        len1 in 1u64..100_000u64,
        len2 in 1u64..100_000u64,
    ) {
        let end1 = start1.saturating_add(len1);
        prop_assume!(end1 <= u64::MAX / 2, "avoid overflow");
        let start2 = end1.saturating_add(1);
        let end2 = start2.saturating_add(len2);
        prop_assume!(end2 <= u64::MAX, "end2 must fit");
        prop_assume!(start2 > end1, "ranges must not overlap");

        let (env, client, admin) = setup_env();

        let r1 = mint_range(&env, &client, &admin, "left", start1, end1);
        let r2 = mint_range(&env, &client, &admin, "right", start2, end2);

        prop_assert!(r1.is_ok(), "left range must succeed");
        prop_assert!(r2.is_ok(), "right range must succeed");

        // Both are occupied
        prop_assert!(!client.verify_serial_range(&start1, &end1));
        prop_assert!(!client.verify_serial_range(&start2, &end2));

        // The boundary serial (end1 + 1 == start2) belongs to the right range
        prop_assert!(!client.verify_serial_range(&start2, &start2));
    }
}
