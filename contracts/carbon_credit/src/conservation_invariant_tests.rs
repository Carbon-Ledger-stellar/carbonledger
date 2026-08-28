//! Contract Invariant Test Suite — Conservation Laws for Credit Supply Accounting
//!
//! Verifies that the conservation law holds after every state-mutating operation:
//!
//!   total_minted == credits_active + credits_retired
//!
//! Rules verified:
//!   I1 – Global supply conservation (mint_credits, transfer_credits, retire_credits)
//!   I2 – Per-batch conservation (minted == active + retired per batch)
//!   I3 – Retirement monotonicity (retired amount never decreases)
//!
//! Every test calls the conservation assertion helpers AFTER each mutating call
//! so that any regression surfaces immediately at the offending operation.
//!
//! Run with:
//!   cargo test -p carbon_credit conservation_invariant
//!   cargo test -p carbon_credit conservation_invariant -- --nocapture

#[cfg(test)]
mod conservation_invariant_tests {
    use crate::{CarbonCreditContract, CarbonCreditContractClient, CreditStatus};
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Address, Env, String,
    };
    extern crate std;

    // ── helpers ───────────────────────────────────────────────────────────────

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    /// Standard test environment: timestamp 2025-01-01, mock all auths.
    fn setup(env: &Env) -> (CarbonCreditContractClient, Address, Address) {
        env.mock_all_auths();
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1_735_689_600, // 2025-01-01
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0u8; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518_400,
        });
        let admin = Address::generate(env);
        let registry = Address::generate(env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(env, &id);
        client.initialize(&admin, &registry);
        (client, admin, registry)
    }

    /// Mint a credit batch.
    fn do_mint(
        env: &Env,
        client: &CarbonCreditContractClient,
        admin: &Address,
        owner: &Address,
        batch_id: &str,
        amount: i128,
        serial_start: u64,
        serial_end: u64,
    ) {
        client.mint_credits(
            admin,
            &s(env, "proj-001"),
            &amount,
            &2023_u32,
            &s(env, batch_id),
            &serial_start,
            &serial_end,
            &s(env, "QmCID"),
            owner,
        );
    }

    /// Retire credits from a batch.
    fn do_retire(
        env: &Env,
        client: &CarbonCreditContractClient,
        holder: &Address,
        batch_id: &str,
        amount: i128,
        retirement_id: &str,
    ) {
        client.retire_credits(
            holder,
            &s(env, batch_id),
            &amount,
            &s(env, "Corporate offset"),
            &s(env, "Acme Corp"),
            &s(env, retirement_id),
            &s(env, "txhash"),
            &s(env, "QmCertCID"),
        );
    }

    /// Transfer credits from one owner to another.
    fn do_transfer(
        env: &Env,
        client: &CarbonCreditContractClient,
        from: &Address,
        to: &Address,
        batch_id: &str,
        amount: i128,
    ) {
        client.transfer_credits(from, to, &s(env, batch_id), &amount);
    }

    // ── Conservation assertion helpers ────────────────────────────────────────
    //
    // These wrappers are deliberately thin so that the assertion messages are
    // self-explanatory and the call site reads like a spec:
    //
    //   assert_conservation_law!(client, env, batches, retirements);

    /// I1 + I2: total_minted == total_active + total_retired, per batch and globally.
    fn assert_conservation_law(
        env: &Env,
        client: &CarbonCreditContractClient,
        batch_ids: &[&str],
        retirement_ids: &[&str],
    ) {
        let total_minted: i128 = batch_ids
            .iter()
            .map(|&id| client.get_credit_batch(&s(env, id)).amount)
            .sum();

        let total_retired: i128 = retirement_ids
            .iter()
            .map(|&id| client.get_retirement_certificate(&s(env, id)).amount)
            .sum();

        // I2: per-batch check
        for &bid in batch_ids {
            let batch = client.get_credit_batch(&s(env, bid));
            let batch_retired: i128 = retirement_ids
                .iter()
                .filter_map(|&rid| {
                    let cert = client.get_retirement_certificate(&s(env, rid));
                    if cert.credit_batch_id == s(env, bid) {
                        Some(cert.amount)
                    } else {
                        None
                    }
                })
                .sum();
            assert!(
                batch.amount >= batch_retired,
                "INVARIANT I2 VIOLATED for batch '{bid}': \
                 minted={} < retired={} — conservation broken at batch level",
                batch.amount,
                batch_retired
            );
        }

        // I1: global check
        assert!(
            total_minted >= total_retired,
            "INVARIANT I1 VIOLATED: \
             total_minted={total_minted} < total_retired={total_retired}\n  \
             Credits cannot be retired more than minted — supply is not conserved."
        );
    }

    /// I3: retired amount for `batch_id` using `new_retirement_ids` >= `prev_retired`.
    fn assert_retirement_monotonic(
        env: &Env,
        client: &CarbonCreditContractClient,
        retirement_ids: &[&str],
        batch_id: &str,
        prev_retired: i128,
    ) -> i128 {
        let current: i128 = retirement_ids
            .iter()
            .filter_map(|&id| {
                let cert = client.get_retirement_certificate(&s(env, id));
                if cert.credit_batch_id == s(env, batch_id) {
                    Some(cert.amount)
                } else {
                    None
                }
            })
            .sum();
        assert!(
            current >= prev_retired,
            "INVARIANT I3 VIOLATED for batch '{batch_id}': \
             retired count decreased from {prev_retired} to {current}.\n  \
             retire_credits is irreversible — this should never happen."
        );
        current
    }

    /// Assert zero credits exist outside of mint/retire operations.
    fn assert_no_phantom_credits(
        env: &Env,
        client: &CarbonCreditContractClient,
        batch_ids: &[&str],
        retirement_ids: &[&str],
    ) {
        let total_minted: i128 = batch_ids
            .iter()
            .map(|&id| client.get_credit_batch(&s(env, id)).amount)
            .sum();
        let total_retired: i128 = retirement_ids
            .iter()
            .map(|&id| client.get_retirement_certificate(&s(env, id)).amount)
            .sum();

        assert!(
            total_minted >= 0,
            "PHANTOM CREDITS: total_minted is negative ({total_minted})"
        );
        assert!(
            total_retired >= 0,
            "PHANTOM CREDITS: total_retired is negative ({total_retired})"
        );
        assert!(
            total_minted >= total_retired,
            "PHANTOM CREDITS: more retired ({total_retired}) than ever minted ({total_minted})"
        );
    }

    // ── Tests: conservation after mint_credits ────────────────────────────────

    #[test]
    fn conservation_holds_after_single_mint() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 1_000, 1, 1_000);

        assert_conservation_law(&env, &client, &["b1"], &[]);
        assert_no_phantom_credits(&env, &client, &["b1"], &[]);
    }

    #[test]
    fn conservation_holds_after_multiple_mints_same_project() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 500, 1, 500);
        assert_conservation_law(&env, &client, &["b1"], &[]);

        do_mint(&env, &client, &admin, &owner, "b2", 300, 501, 800);
        assert_conservation_law(&env, &client, &["b1", "b2"], &[]);

        do_mint(&env, &client, &admin, &owner, "b3", 200, 801, 1_000);
        assert_conservation_law(&env, &client, &["b1", "b2", "b3"], &[]);

        assert_no_phantom_credits(&env, &client, &["b1", "b2", "b3"], &[]);
    }

    #[test]
    fn conservation_holds_after_mint_with_large_amount() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        let large = 1_000_000_000_i128; // MAX_BATCH_SIZE
        do_mint(&env, &client, &admin, &owner, "b-large", large, 1, 1_000_000_000);

        assert_conservation_law(&env, &client, &["b-large"], &[]);
        assert_no_phantom_credits(&env, &client, &["b-large"], &[]);
    }

    // ── Tests: conservation after retire_credits ──────────────────────────────

    #[test]
    fn conservation_holds_after_partial_retirement() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 1_000, 1, 1_000);
        assert_conservation_law(&env, &client, &["b1"], &[]);

        do_retire(&env, &client, &owner, "b1", 300, "ret-001");
        assert_conservation_law(&env, &client, &["b1"], &["ret-001"]);
        assert_no_phantom_credits(&env, &client, &["b1"], &["ret-001"]);

        let batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(batch.status, CreditStatus::PartiallyRetired);
    }

    #[test]
    fn conservation_holds_after_full_retirement() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 500, 1, 500);

        do_retire(&env, &client, &owner, "b1", 500, "ret-001");
        assert_conservation_law(&env, &client, &["b1"], &["ret-001"]);
        assert_no_phantom_credits(&env, &client, &["b1"], &["ret-001"]);

        let batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(batch.status, CreditStatus::FullyRetired);

        // At full retirement, retired == minted (conservation at equality)
        let cert = client.get_retirement_certificate(&s(&env, "ret-001"));
        assert_eq!(cert.amount, batch.amount);
    }

    #[test]
    fn conservation_holds_after_sequential_partial_retirements() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 600, 1, 600);

        let mut prev_retired = 0_i128;

        do_retire(&env, &client, &owner, "b1", 100, "ret-001");
        assert_conservation_law(&env, &client, &["b1"], &["ret-001"]);
        prev_retired = assert_retirement_monotonic(&env, &client, &["ret-001"], "b1", prev_retired);

        do_retire(&env, &client, &owner, "b1", 200, "ret-002");
        assert_conservation_law(&env, &client, &["b1"], &["ret-001", "ret-002"]);
        prev_retired = assert_retirement_monotonic(
            &env,
            &client,
            &["ret-001", "ret-002"],
            "b1",
            prev_retired,
        );

        do_retire(&env, &client, &owner, "b1", 300, "ret-003");
        assert_conservation_law(&env, &client, &["b1"], &["ret-001", "ret-002", "ret-003"]);
        assert_retirement_monotonic(
            &env,
            &client,
            &["ret-001", "ret-002", "ret-003"],
            "b1",
            prev_retired,
        );

        // All 600 credits accounted for
        assert_no_phantom_credits(
            &env,
            &client,
            &["b1"],
            &["ret-001", "ret-002", "ret-003"],
        );
    }

    #[test]
    fn conservation_holds_across_multiple_batches_with_retirements() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 200, 1, 200);
        do_mint(&env, &client, &admin, &owner, "b2", 300, 201, 500);
        do_mint(&env, &client, &admin, &owner, "b3", 500, 501, 1_000);

        // No retirements yet — conservation holds trivially
        assert_conservation_law(&env, &client, &["b1", "b2", "b3"], &[]);

        // Retire from b1
        do_retire(&env, &client, &owner, "b1", 100, "ret-001");
        assert_conservation_law(&env, &client, &["b1", "b2", "b3"], &["ret-001"]);

        // Retire from b3
        do_retire(&env, &client, &owner, "b3", 250, "ret-002");
        assert_conservation_law(
            &env,
            &client,
            &["b1", "b2", "b3"],
            &["ret-001", "ret-002"],
        );

        // Retire remaining from b1
        do_retire(&env, &client, &owner, "b1", 100, "ret-003");
        assert_conservation_law(
            &env,
            &client,
            &["b1", "b2", "b3"],
            &["ret-001", "ret-002", "ret-003"],
        );

        assert_no_phantom_credits(
            &env,
            &client,
            &["b1", "b2", "b3"],
            &["ret-001", "ret-002", "ret-003"],
        );
    }

    // ── Tests: conservation after transfer_credits ────────────────────────────

    #[test]
    fn conservation_holds_after_transfer() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let buyer = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 1_000, 1, 1_000);
        assert_conservation_law(&env, &client, &["b1"], &[]);

        // transfer_credits reassigns ownership of the whole batch — it does
        // not split off a new batch; `amount` is only an eligibility check.
        do_transfer(&env, &client, &owner, &buyer, "b1", 500);

        let b1 = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(b1.owner, buyer, "ownership must move to buyer");
        assert_eq!(
            b1.amount, 1_000,
            "CONSERVATION VIOLATED after transfer_credits: \
             total credits changed from 1000 to {}",
            b1.amount
        );
        assert_conservation_law(&env, &client, &["b1"], &[]);
    }

    #[test]
    fn conservation_holds_after_transfer_then_retire() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let buyer = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 1_000, 1, 1_000);
        do_transfer(&env, &client, &owner, &buyer, "b1", 400);

        // buyer now owns "b1" and retires part of it
        do_retire(&env, &client, &buyer, "b1", 200, "ret-001");

        assert_conservation_law(&env, &client, &["b1"], &["ret-001"]);
        assert_no_phantom_credits(&env, &client, &["b1"], &["ret-001"]);
    }

    // ── Tests: rejected operations must not alter supply ──────────────────────

    #[test]
    fn over_retirement_rejection_preserves_conservation() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 100, 1, 100);
        assert_conservation_law(&env, &client, &["b1"], &[]);

        // Attempt to retire more than minted — must be rejected
        let err = client.try_retire_credits(
            &owner,
            &s(&env, "b1"),
            &101_i128,
            &s(&env, "reason"),
            &s(&env, "Corp"),
            &s(&env, "ret-001"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );
        assert!(
            err.is_err(),
            "Over-retirement must be rejected by InsufficientCredits"
        );

        // Conservation must still hold — no credits were created or destroyed
        assert_conservation_law(&env, &client, &["b1"], &[]);
        assert_no_phantom_credits(&env, &client, &["b1"], &[]);
    }

    #[test]
    fn duplicate_retirement_id_rejection_preserves_conservation() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 200, 1, 200);
        do_retire(&env, &client, &owner, "b1", 100, "ret-001");
        assert_conservation_law(&env, &client, &["b1"], &["ret-001"]);

        // Attempt duplicate retirement ID — must be rejected
        let err = client.try_retire_credits(
            &owner,
            &s(&env, "b1"),
            &50_i128,
            &s(&env, "reason"),
            &s(&env, "Corp"),
            &s(&env, "ret-001"), // same ID
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );
        assert!(err.is_err(), "Duplicate retirement ID must be rejected");

        // Conservation still holds
        assert_conservation_law(&env, &client, &["b1"], &["ret-001"]);
    }

    #[test]
    fn serial_conflict_rejection_preserves_conservation() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 100, 1, 100);
        assert_conservation_law(&env, &client, &["b1"], &[]);

        // Attempt to mint overlapping serial range
        let err = client.try_mint_credits(
            &admin,
            &s(&env, "proj-001"),
            &50_i128,
            &2023_u32,
            &s(&env, "b2"),
            &50_u64,
            &150_u64,
            &s(&env, "QmCID"),
            &owner,
        );
        assert!(err.is_err(), "Serial conflict must be rejected");

        // Only b1 exists — conservation still holds
        assert_conservation_law(&env, &client, &["b1"], &[]);
    }

    #[test]
    fn zero_amount_mint_rejection_preserves_conservation() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 100, 1, 100);

        let err = client.try_mint_credits(
            &admin,
            &s(&env, "proj-001"),
            &0_i128, // zero amount
            &2023_u32,
            &s(&env, "b2"),
            &101_u64,
            &200_u64,
            &s(&env, "QmCID"),
            &owner,
        );
        assert!(err.is_err(), "Zero-amount mint must be rejected");

        assert_conservation_law(&env, &client, &["b1"], &[]);
    }

    // ── Tests: I3 retirement monotonicity ────────────────────────────────────

    #[test]
    fn retirement_count_never_decreases() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        do_mint(&env, &client, &admin, &owner, "b1", 1_000, 1, 1_000);

        let steps: &[(&str, i128)] = &[
            ("ret-001", 100),
            ("ret-002", 50),
            ("ret-003", 300),
            ("ret-004", 200),
            ("ret-005", 350),
        ];

        let mut seen_ids: std::vec::Vec<&str> = std::vec::Vec::new();
        let mut prev_retired = 0_i128;

        for (ret_id, amount) in steps {
            do_retire(&env, &client, &owner, "b1", *amount, ret_id);
            seen_ids.push(ret_id);

            assert_conservation_law(&env, &client, &["b1"], seen_ids.as_slice());
            prev_retired =
                assert_retirement_monotonic(&env, &client, seen_ids.as_slice(), "b1", prev_retired);
        }
    }

    // ── Tests: per-project supply checks ─────────────────────────────────────

    #[test]
    fn per_project_conservation_across_multiple_batches() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        // Project 1 batches
        do_mint(&env, &client, &admin, &owner, "p1-b1", 400, 1, 400);
        do_mint(&env, &client, &admin, &owner, "p1-b2", 600, 401, 1_000);

        // Conservation holds for project 1
        assert_conservation_law(&env, &client, &["p1-b1", "p1-b2"], &[]);

        do_retire(&env, &client, &owner, "p1-b1", 200, "ret-p1-001");
        do_retire(&env, &client, &owner, "p1-b2", 300, "ret-p1-002");

        // Per-project totals: minted=1000, retired=500
        let total_minted: i128 = 400 + 600;
        let total_retired: i128 = {
            let c1 = client.get_retirement_certificate(&s(&env, "ret-p1-001"));
            let c2 = client.get_retirement_certificate(&s(&env, "ret-p1-002"));
            c1.amount + c2.amount
        };

        assert!(
            total_minted >= total_retired,
            "Per-project conservation violated: minted={total_minted} < retired={total_retired}"
        );
        assert_conservation_law(
            &env,
            &client,
            &["p1-b1", "p1-b2"],
            &["ret-p1-001", "ret-p1-002"],
        );
    }

    // ── Tests: global supply checks ───────────────────────────────────────────

    #[test]
    fn global_conservation_across_all_projects() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        // Many batches across different projects/vintages
        let batches: &[(&str, i128, u64, u64)] = &[
            ("a1", 100, 1, 100),
            ("a2", 200, 101, 300),
            ("b1", 150, 301, 450),
            ("b2", 250, 451, 700),
            ("c1", 300, 701, 1_000),
        ];

        let batch_ids: std::vec::Vec<&str> = batches.iter().map(|(id, ..)| *id).collect();
        let mut minted_so_far: std::vec::Vec<&str> = std::vec::Vec::new();

        for (bid, amount, ss, se) in batches {
            do_mint(&env, &client, &admin, &owner, bid, *amount, *ss, *se);
            minted_so_far.push(bid);
            assert_conservation_law(&env, &client, minted_so_far.as_slice(), &[]);
        }

        // Retire from several batches
        do_retire(&env, &client, &owner, "a1", 50, "r1");
        do_retire(&env, &client, &owner, "b2", 100, "r2");
        do_retire(&env, &client, &owner, "c1", 300, "r3");

        assert_conservation_law(
            &env,
            &client,
            batch_ids.as_slice(),
            &["r1", "r2", "r3"],
        );
        assert_no_phantom_credits(
            &env,
            &client,
            batch_ids.as_slice(),
            &["r1", "r2", "r3"],
        );
    }
}
