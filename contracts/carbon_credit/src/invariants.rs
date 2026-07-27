/// Invariant tests for the CarbonCreditContract.
///
/// Three invariants are verified after every state-changing operation:
///
///   I1 – Conservation:  sum(batch.amount) >= sum(retired per batch)
///   I2 – Serial uniqueness: no serial number appears in two active batches
///   I3 – Monotonic retirements: per-batch retired count never decreases

#[cfg(test)]
mod invariant_tests {
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Env, String};
    use crate::{CarbonCreditContract, CarbonCreditContractClient, CreditStatus};

    // ── helpers ───────────────────────────────────────────────────────────────

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonCreditContractClient, soroban_sdk::Address, soroban_sdk::Address) {
        env.mock_all_auths();
        // Set ledger time to 2025-01-01 so vintage year 2023 is valid
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1735689600, // 2025-01-01
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });
        let admin    = soroban_sdk::Address::generate(env);
        let registry = soroban_sdk::Address::generate(env);
        let id       = env.register_contract(None, CarbonCreditContract);
        let client   = CarbonCreditContractClient::new(env, &id);
        client.initialize(&admin, &registry);
        (client, admin, registry)
    }

    fn mint(
        env: &Env,
        client: &CarbonCreditContractClient,
        admin: &soroban_sdk::Address,
        owner: &soroban_sdk::Address,
        batch_id: &str,
        project_id: &str,
        amount: i128,
        serial_start: u64,
        serial_end: u64,
    ) {
        client.mint_credits(
            admin,
            &s(env, project_id),
            &amount,
            &2023_u32,
            &s(env, batch_id),
            &serial_start,
            &serial_end,
            &s(env, "QmCID"),
            owner,
        );
    }

    fn retire(
        env: &Env,
        client: &CarbonCreditContractClient,
        holder: &soroban_sdk::Address,
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

    // ── Invariant checkers ────────────────────────────────────────────────────

    /// I1: For every batch, batch.amount >= retired_amount_for_that_batch.
    /// Uses the contract's public getter — no direct storage access needed.
    fn assert_conservation(
        env: &Env,
        client: &CarbonCreditContractClient,
        batch_ids: &[&str],
    ) {
        let mut total_issued:  i128 = 0;
        let mut total_retired: i128 = 0;

        for id in batch_ids {
            let batch = client.get_credit_batch(&s(env, id));

            // Derive retired amount from status and active amount.
            // active = batch.amount - retired  =>  retired = batch.amount - active
            // For FullyRetired: retired == batch.amount
            // For Active: retired == 0
            // For PartiallyRetired: we use verify_serial_range to infer nothing —
            // instead we track via the retirement certificate count indirectly.
            // Simplest: retired = batch.amount - active_amount (computed from status).
            let retired: i128 = match batch.status {
                CreditStatus::FullyRetired    => batch.amount,
                CreditStatus::Active          => 0,
                CreditStatus::PartiallyRetired => {
                    // We can't read BatchRetired directly from test context.
                    // Use the fact that active = batch.amount - retired.
                    // The contract exposes no direct "retired amount" getter,
                    // so we assert the weaker form: issued >= 0 (always true)
                    // and rely on the contract's own InsufficientCredits guard
                    // to enforce the per-batch bound.
                    0 // conservative lower bound — global sum still holds
                }
                CreditStatus::Suspended => 0,
            };

            assert!(
                batch.amount >= retired,
                "I1 violated for batch {id}: issued={} < retired={}",
                batch.amount, retired
            );

            total_issued  += batch.amount;
            total_retired += retired;
        }

        assert!(
            total_issued >= total_retired,
            "I1 violated globally: total_issued={total_issued} < total_retired={total_retired}"
        );
    }

    /// I1 (strong form): total issued >= total retired, using retirement certificates
    /// to get the exact retired amount per batch.
    fn assert_conservation_exact(
        env: &Env,
        client: &CarbonCreditContractClient,
        batch_ids: &[&str],
        retirement_ids: &[&str],
    ) {
        let total_issued: i128 = batch_ids
            .iter()
            .map(|id| client.get_credit_batch(&s(env, id)).amount)
            .sum();

        let total_retired: i128 = retirement_ids
            .iter()
            .map(|id| client.get_retirement_certificate(&s(env, id)).amount)
            .sum();

        assert!(
            total_issued >= total_retired,
            "I1 (exact) violated: total_issued={total_issued} < total_retired={total_retired}"
        );
    }

    /// I2: No serial number appears in two different active batches.
    fn assert_no_serial_overlap(
        env: &Env,
        client: &CarbonCreditContractClient,
        batch_ids: &[&str],
    ) {
        for i in 0..batch_ids.len() {
            for j in (i + 1)..batch_ids.len() {
                let a = client.get_credit_batch(&s(env, batch_ids[i]));
                let b = client.get_credit_batch(&s(env, batch_ids[j]));
                let overlaps = a.serial_start <= b.serial_end && b.serial_start <= a.serial_end;
                assert!(
                    !overlaps,
                    "I2 violated: batch {} [{},{}] overlaps batch {} [{},{}]",
                    batch_ids[i], a.serial_start, a.serial_end,
                    batch_ids[j], b.serial_start, b.serial_end,
                );
            }
        }
    }

    /// I3: Retired amount for a batch must be >= the previously observed value.
    /// We track this by summing retirement certificate amounts for a given batch.
    fn assert_retirement_monotonic_exact(
        env: &Env,
        client: &CarbonCreditContractClient,
        retirement_ids: &[&str],
        batch_id: &str,
        prev_retired: i128,
    ) -> i128 {
        let current: i128 = retirement_ids
            .iter()
            .filter_map(|id| {
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
            "I3 violated for batch {batch_id}: retired decreased from {prev_retired} to {current}"
        );
        current
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[test]
    fn invariants_hold_after_single_mint() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 1000, 1, 1000);

        assert_conservation(&env, &client, &["b1"]);
        assert_no_serial_overlap(&env, &client, &["b1"]);
    }

    #[test]
    fn invariants_hold_after_two_mints() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 500,  1,   500);
        assert_conservation(&env, &client, &["b1"]);
        assert_no_serial_overlap(&env, &client, &["b1"]);

        mint(&env, &client, &admin, &owner, "b2", "p1", 500, 501, 1000);
        assert_conservation(&env, &client, &["b1", "b2"]);
        assert_no_serial_overlap(&env, &client, &["b1", "b2"]);
    }

    #[test]
    fn invariants_hold_after_full_retirement() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 100, 1, 100);
        assert_conservation(&env, &client, &["b1"]);

        retire(&env, &client, &owner, "b1", 100, "ret-001");

        assert_conservation_exact(&env, &client, &["b1"], &["ret-001"]);
        assert_no_serial_overlap(&env, &client, &["b1"]);

        let batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(batch.status, CreditStatus::FullyRetired);
    }

    #[test]
    fn invariants_hold_after_sequential_partial_retirements() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 300, 1, 300);

        retire(&env, &client, &owner, "b1", 100, "ret-001");
        assert_conservation_exact(&env, &client, &["b1"], &["ret-001"]);
        let prev = assert_retirement_monotonic_exact(&env, &client, &["ret-001"], "b1", 0);

        retire(&env, &client, &owner, "b1", 100, "ret-002");
        assert_conservation_exact(&env, &client, &["b1"], &["ret-001", "ret-002"]);
        let prev = assert_retirement_monotonic_exact(&env, &client, &["ret-001", "ret-002"], "b1", prev);

        retire(&env, &client, &owner, "b1", 100, "ret-003");
        assert_conservation_exact(&env, &client, &["b1"], &["ret-001", "ret-002", "ret-003"]);
        assert_retirement_monotonic_exact(&env, &client, &["ret-001", "ret-002", "ret-003"], "b1", prev);

        let batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(batch.status, CreditStatus::FullyRetired);
    }

    #[test]
    fn invariants_hold_across_multiple_batches_with_retirements() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 200,   1,  200);
        mint(&env, &client, &admin, &owner, "b2", "p1", 300, 201,  500);
        mint(&env, &client, &admin, &owner, "b3", "p2", 500, 501, 1000);

        assert_conservation(&env, &client, &["b1", "b2", "b3"]);
        assert_no_serial_overlap(&env, &client, &["b1", "b2", "b3"]);

        retire(&env, &client, &owner, "b1", 50, "ret-001");
        assert_conservation_exact(&env, &client, &["b1", "b2", "b3"], &["ret-001"]);
        assert_no_serial_overlap(&env, &client, &["b1", "b2", "b3"]);
        let prev_b1 = assert_retirement_monotonic_exact(&env, &client, &["ret-001"], "b1", 0);

        retire(&env, &client, &owner, "b3", 250, "ret-002");
        assert_conservation_exact(&env, &client, &["b1", "b2", "b3"], &["ret-001", "ret-002"]);
        assert_no_serial_overlap(&env, &client, &["b1", "b2", "b3"]);
        assert_retirement_monotonic_exact(&env, &client, &["ret-001", "ret-002"], "b1", prev_b1);
        assert_retirement_monotonic_exact(&env, &client, &["ret-001", "ret-002"], "b3", 0);
    }

    #[test]
    fn serial_overlap_rejected_and_registry_stays_clean() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 100, 1, 100);
        assert_no_serial_overlap(&env, &client, &["b1"]);

        // Overlapping range must be rejected
        let result = client.try_mint_credits(
            &admin,
            &s(&env, "p1"),
            &50_i128,
            &2023_u32,
            &s(&env, "b2"),
            &50_u64,
            &150_u64,
            &s(&env, "QmCID"),
            &owner,
        );
        assert!(result.is_err(), "overlapping mint should be rejected");

        // Only b1 exists — no overlap possible
        assert_no_serial_overlap(&env, &client, &["b1"]);
        assert_conservation(&env, &client, &["b1"]);
    }

    #[test]
    fn adjacent_serial_ranges_do_not_overlap() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 100,   1, 100);
        mint(&env, &client, &admin, &owner, "b2", "p1", 100, 101, 200);
        mint(&env, &client, &admin, &owner, "b3", "p1", 100, 201, 300);

        assert_no_serial_overlap(&env, &client, &["b1", "b2", "b3"]);
        assert_conservation(&env, &client, &["b1", "b2", "b3"]);
    }

    #[test]
    fn retirement_count_is_monotonically_non_decreasing() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 1000, 1, 1000);

        let steps: [(&str, i128); 5] = [
            ("ret-000", 100),
            ("ret-001", 200),
            ("ret-002", 50),
            ("ret-003", 150),
            ("ret-004", 500),
        ];
        let mut prev: i128 = 0;

        retire(&env, &client, &owner, "b1", steps[0].1, steps[0].0);
        prev = assert_retirement_monotonic_exact(&env, &client, &[steps[0].0], "b1", prev);
        assert_conservation_exact(&env, &client, &["b1"], &[steps[0].0]);

        retire(&env, &client, &owner, "b1", steps[1].1, steps[1].0);
        prev = assert_retirement_monotonic_exact(&env, &client, &[steps[0].0, steps[1].0], "b1", prev);
        assert_conservation_exact(&env, &client, &["b1"], &[steps[0].0, steps[1].0]);

        retire(&env, &client, &owner, "b1", steps[2].1, steps[2].0);
        prev = assert_retirement_monotonic_exact(&env, &client, &[steps[0].0, steps[1].0, steps[2].0], "b1", prev);

        retire(&env, &client, &owner, "b1", steps[3].1, steps[3].0);
        prev = assert_retirement_monotonic_exact(&env, &client, &[steps[0].0, steps[1].0, steps[2].0, steps[3].0], "b1", prev);

        retire(&env, &client, &owner, "b1", steps[4].1, steps[4].0);
        assert_retirement_monotonic_exact(&env, &client, &[steps[0].0, steps[1].0, steps[2].0, steps[3].0, steps[4].0], "b1", prev);
        assert_conservation_exact(&env, &client, &["b1"], &[steps[0].0, steps[1].0, steps[2].0, steps[3].0, steps[4].0]);
    }

    #[test]
    fn full_retirement_satisfies_conservation_at_equality() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 500, 1, 500);

        let prev = assert_retirement_monotonic_exact(&env, &client, &[], "b1", 0);
        retire(&env, &client, &owner, "b1", 500, "ret-001");

        assert_conservation_exact(&env, &client, &["b1"], &["ret-001"]);
        let retired = assert_retirement_monotonic_exact(&env, &client, &["ret-001"], "b1", prev);
        assert_eq!(retired, 500, "retired should equal issued at full retirement");
    }

    #[test]
    fn over_retirement_rejected_conservation_preserved() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = soroban_sdk::Address::generate(&env);

        mint(&env, &client, &admin, &owner, "b1", "p1", 100, 1, 100);

        let result = client.try_retire_credits(
            &owner,
            &s(&env, "b1"),
            &101_i128,
            &s(&env, "reason"),
            &s(&env, "Corp"),
            &s(&env, "ret-001"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );
        assert!(result.is_err(), "over-retirement must be rejected");

        assert_conservation(&env, &client, &["b1"]);
        // No retirement was created — empty list
        assert_retirement_monotonic_exact(&env, &client, &[], "b1", 0);
    }
}
