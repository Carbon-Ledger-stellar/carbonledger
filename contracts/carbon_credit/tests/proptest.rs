//! Property-based test target for the `carbon_credit` contract (issue #1051).
//!
//! This is a dedicated integration-test target so the whole property suite
//! runs from one stable command:
//!
//! ```sh
//! cargo test --test proptest                    # from contracts/carbon_credit
//! cargo test -p carbon_credit --test proptest    # from the workspace root
//! ```
//!
//! It complements — rather than replaces — the in-crate `proptest!` modules
//! (`src/serial_fuzz_tests.rs`, the `proptest_invariant_tests` module in
//! `src/lib.rs`). Those concentrate on serial-range allocation; this target
//! pins the two invariants called out in issue #1051 against the *public*
//! contract API:
//!
//!   * **Supply conservation** — a batch's issued supply (`batch.amount`)
//!     never changes once minted, `Σ retired ≤ issued` at every step, and
//!     transferring ownership moves zero credits into or out of existence.
//!
//!   * **Ownership consistency** — `batch.owner` always equals the last
//!     address a successful `transfer_credits` handed the batch to, a
//!     non-owner can never move a batch, and a stale owner loses the ability
//!     to transfer the instant the batch changes hands.
//!
//! Every property runs at least 1,000 randomized cases (`ProptestConfig`
//! floor; raise it in CI with `PROPTEST_CASES`) and shrinking stays enabled
//! so a failing mint/retire/transfer sequence is minimised before it is
//! reported.

#![cfg(test)]
#![allow(deprecated)] // `env.register_contract` matches the rest of the test suite.

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

use carbon_credit::{
    CarbonCreditContract, CarbonCreditContractClient, CarbonError, CreditStatus, MAX_BATCH_SIZE,
};

// ── Fixtures ────────────────────────────────────────────────────────────────

/// Ledger timestamp used for every scenario. The contract's `current_year()`
/// derives 2024 from this, so the valid vintage window is [1990, 2025] and a
/// batch with vintage ≥ 1994 is never treated as expired.
const LEDGER_TIMESTAMP: u64 = 1_735_689_600;

/// Vintages in this range mint successfully and stay retirable/transferable
/// for the whole test (in bounds, not expired).
const MIN_LIVE_VINTAGE: u32 = 1994;
const MAX_LIVE_VINTAGE: u32 = 2025;

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

/// `seq_id("ret", 3)` -> `"ret-3"`. Keeps batch / retirement ids unique
/// within a single property case.
fn seq_id(prefix: &str, n: usize) -> std::string::String {
    format!("{prefix}-{n}")
}

/// Fresh env + initialized contract. Returns the env (kept alive by the
/// caller), a client, and the admin address authorised to mint.
fn setup() -> (Env, CarbonCreditContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: LEDGER_TIMESTAMP,
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

/// Mint a batch through the public entry point, flattening the soroban `try_`
/// double-`Result` down to `Result<(), CarbonError>`.
#[allow(clippy::too_many_arguments)]
fn mint(
    env: &Env,
    client: &CarbonCreditContractClient,
    admin: &Address,
    owner: &Address,
    project: &str,
    batch: &str,
    amount: i128,
    vintage: u32,
    serial_start: u64,
    serial_end: u64,
) -> Result<(), CarbonError> {
    client
        .try_mint_credits(
            admin,
            &s(env, project),
            &amount,
            &vintage,
            &s(env, batch),
            &serial_start,
            &serial_end,
            &s(env, "QmMetadataCID"),
            owner,
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

/// Retire `amount` credits from `batch`, flattening the `try_` result.
fn retire(
    env: &Env,
    client: &CarbonCreditContractClient,
    holder: &Address,
    batch: &str,
    amount: i128,
    retire_id: &str,
) -> Result<(), CarbonError> {
    client
        .try_retire_credits(
            holder,
            &s(env, batch),
            &amount,
            &s(env, "voluntary offset"),
            &s(env, "Beneficiary Corp"),
            &s(env, retire_id),
            &s(env, "tx-hash"),
            &s(env, "QmCertCID"),
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

/// Transfer whole-batch ownership from `from` to `to`, flattening the result.
fn transfer(
    env: &Env,
    client: &CarbonCreditContractClient,
    from: &Address,
    to: &Address,
    batch: &str,
    amount: i128,
) -> Result<(), CarbonError> {
    client
        .try_transfer_credits(from, to, &s(env, batch), &amount)
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

/// Shared proptest configuration: ≥ 1,000 cases and generous shrinking.
///
/// `ProptestConfig` is `#[non_exhaustive]`, so it is built from `with_cases`
/// and then tuned by field, not with a struct literal.
fn config() -> ProptestConfig {
    let mut cfg = ProptestConfig::with_cases(1_000);
    // Acceptance criterion: shrinking enabled for failure diagnosis. Keep the
    // default behaviour but give the shrinker room to minimise a failing
    // operation sequence.
    cfg.max_shrink_iters = 8_192;
    cfg
}

// ═══════════════════════════════════════════════════════════════════════════
// Supply conservation
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(config())]

    /// SC-1: a batch's issued supply (`batch.amount`) is immutable across any
    /// sequence of partial retirements, `Σ retired ≤ issued` holds after every
    /// step, and the reported status tracks the remaining active amount.
    #[test]
    fn sc1_issued_supply_immutable_under_retirement(
        amount in 4_i128..=200_000_i128,
        vintage in MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
        fracs in prop::collection::vec(1_u32..=100_u32, 1..=8),
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);

        prop_assert!(
            mint(&env, &client, &admin, &owner, "p-sc1", "b-sc1", amount, vintage, 1, amount as u64 + 2).is_ok(),
            "mint of a well-formed batch must succeed",
        );

        let issued = client.get_credit_batch(&s(&env, "b-sc1")).amount;
        prop_assert_eq!(issued, amount, "issued supply must equal the minted amount");

        let mut retired_total: i128 = 0;
        for (i, frac) in fracs.iter().enumerate() {
            let remaining = issued - retired_total;
            if remaining <= 0 {
                break;
            }
            let chunk = (remaining * *frac as i128 / 100).clamp(0, remaining);
            if chunk < 1 {
                continue;
            }

            prop_assert!(
                retire(&env, &client, &owner, "b-sc1", chunk, &seq_id("ret-sc1", i)).is_ok(),
                "retiring {chunk} of {remaining} remaining must succeed",
            );
            retired_total += chunk;

            let batch = client.get_credit_batch(&s(&env, "b-sc1"));
            prop_assert_eq!(batch.amount, issued, "SC-1: issued supply changed after a retirement");
            prop_assert!(
                retired_total <= issued,
                "SC-1: Σ retired ({retired_total}) exceeded issued ({issued})",
            );

            let active = issued - retired_total;
            let expected = if active == 0 {
                CreditStatus::FullyRetired
            } else {
                CreditStatus::PartiallyRetired
            };
            prop_assert_eq!(batch.status, expected, "SC-1: status does not match remaining active amount");
        }
    }

    /// SC-2: an over-retirement is rejected with `InsufficientCredits` and
    /// leaves both the issued supply and the active balance untouched — the
    /// exact remaining amount is still retirable afterwards.
    #[test]
    fn sc2_overretirement_rejected_supply_preserved(
        total in 10_i128..=200_000_i128,
        first_frac in 10_u32..=90_u32,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "p-sc2", "b-sc2", total, 2020, 1, total as u64 + 2).is_ok(),
        );

        let first = (total * first_frac as i128 / 100).clamp(1, total - 1);
        prop_assert!(retire(&env, &client, &owner, "b-sc2", first, "ret-sc2-a").is_ok());

        let remaining = total - first;
        let err = retire(&env, &client, &owner, "b-sc2", remaining + 1, "ret-sc2-b")
            .expect_err("SC-2: over-retirement must fail");
        prop_assert_eq!(err, CarbonError::InsufficientCredits);

        // Supply and status are unchanged by the rejected call.
        let batch = client.get_credit_batch(&s(&env, "b-sc2"));
        prop_assert_eq!(batch.amount, total, "SC-2: issued supply moved on a rejected retirement");
        prop_assert_eq!(batch.status, CreditStatus::PartiallyRetired);

        // The genuine remaining balance is still exactly retirable.
        prop_assert!(retire(&env, &client, &owner, "b-sc2", remaining, "ret-sc2-c").is_ok());
        prop_assert_eq!(
            client.get_credit_batch(&s(&env, "b-sc2")).status,
            CreditStatus::FullyRetired,
        );
    }

    /// SC-3: transferring ownership never creates or destroys credits — the
    /// issued supply is identical before and after an arbitrary chain of
    /// transfers, and remains retirable in full by the final owner.
    #[test]
    fn sc3_transfer_conserves_supply(
        amount in 4_i128..=200_000_i128,
        hops in 1_usize..=8,
        move_frac in 1_u32..=100_u32,
    ) {
        let (env, client, admin) = setup();
        let first_owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &first_owner, "p-sc3", "b-sc3", amount, 2021, 1, amount as u64 + 2).is_ok(),
        );
        let issued = client.get_credit_batch(&s(&env, "b-sc3")).amount;

        let mut current = first_owner;
        for _ in 0..hops {
            let next = Address::generate(&env);
            let move_amount = (amount * move_frac as i128 / 100).clamp(1, amount);
            prop_assert!(transfer(&env, &client, &current, &next, "b-sc3", move_amount).is_ok());

            let batch = client.get_credit_batch(&s(&env, "b-sc3"));
            prop_assert_eq!(batch.amount, issued, "SC-3: transfer changed the issued supply");
            prop_assert_eq!(batch.status, CreditStatus::Active, "SC-3: transfer must not retire credits");
            current = next;
        }

        // Every credit still exists and belongs to the final owner.
        prop_assert!(retire(&env, &client, &current, "b-sc3", issued, "ret-sc3").is_ok());
        prop_assert_eq!(
            client.get_credit_batch(&s(&env, "b-sc3")).status,
            CreditStatus::FullyRetired,
        );
    }

    /// SC-4: across many independent batches, total issued supply equals the
    /// sum of the minted amounts, and retiring from one batch leaves every
    /// other batch's issued supply untouched.
    #[test]
    fn sc4_total_supply_is_sum_of_mints(
        mints in prop::collection::vec(2_i128..=20_000_i128, 1..=10),
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);

        let mut cursor: u64 = 1;
        let mut expected_total: i128 = 0;
        for (i, amount) in mints.iter().enumerate() {
            let start = cursor;
            let end = start + *amount as u64 + 1;
            cursor = end + 1;
            prop_assert!(
                mint(&env, &client, &admin, &owner, "p-sc4", &seq_id("b-sc4", i), *amount, 2022, start, end).is_ok(),
                "disjoint serial ranges must all mint",
            );
            expected_total += *amount;
        }

        let sum_issued: i128 = mints
            .iter()
            .enumerate()
            .map(|(i, _)| client.get_credit_batch(&s(&env, &seq_id("b-sc4", i))).amount)
            .sum();
        prop_assert_eq!(sum_issued, expected_total, "SC-4: Σ batch.amount != Σ minted");

        // Retire half of the first batch; the others must not move.
        let first_amount = mints[0];
        let half = (first_amount / 2).max(1);
        prop_assert!(retire(&env, &client, &owner, &seq_id("b-sc4", 0), half, "ret-sc4").is_ok());

        for (i, amount) in mints.iter().enumerate().skip(1) {
            prop_assert_eq!(
                client.get_credit_batch(&s(&env, &seq_id("b-sc4", i))).amount,
                *amount,
                "SC-4: retiring from batch 0 changed the issued supply of batch {i}",
            );
        }
        // The retired-from batch still reports its full issued supply.
        prop_assert_eq!(
            client.get_credit_batch(&s(&env, &seq_id("b-sc4", 0))).amount,
            first_amount,
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Ownership consistency
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(config())]

    /// OC-1: after a successful transfer the batch owner is exactly the
    /// recipient, for any transfer amount within the active balance.
    #[test]
    fn oc1_transfer_sets_owner_to_recipient(
        amount in 2_i128..=200_000_i128,
        move_amount in 1_i128..=200_000_i128,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "p-oc1", "b-oc1", amount, 2020, 1, amount as u64 + 2).is_ok(),
        );

        let move_amount = move_amount.clamp(1, amount);
        prop_assert!(transfer(&env, &client, &owner, &recipient, "b-oc1", move_amount).is_ok());
        prop_assert_eq!(
            client.get_credit_batch(&s(&env, "b-oc1")).owner,
            recipient,
            "OC-1: owner is not the transfer recipient",
        );
    }

    /// OC-2: a non-owner can never transfer the batch. The call fails with
    /// `UnauthorizedVerifier` and the recorded owner is unchanged.
    #[test]
    fn oc2_non_owner_cannot_transfer(
        amount in 2_i128..=200_000_i128,
        move_amount in 1_i128..=200_000_i128,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let stranger = Address::generate(&env);
        let victim = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "p-oc2", "b-oc2", amount, 2020, 1, amount as u64 + 2).is_ok(),
        );

        let err = transfer(&env, &client, &stranger, &victim, "b-oc2", move_amount.clamp(1, amount))
            .expect_err("OC-2: non-owner transfer must fail");
        prop_assert_eq!(err, CarbonError::UnauthorizedVerifier);
        prop_assert_eq!(
            client.get_credit_batch(&s(&env, "b-oc2")).owner,
            owner,
            "OC-2: a rejected transfer still moved ownership",
        );
    }

    /// OC-3: through a chain of hand-offs the owner is always the most recent
    /// recipient, and at every step the previous (now stale) owner can no
    /// longer move the batch.
    #[test]
    fn oc3_owner_is_last_recipient_in_chain(
        amount in 2_i128..=200_000_i128,
        chain_len in 1_usize..=10,
    ) {
        let (env, client, admin) = setup();
        let a0 = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &a0, "p-oc3", "b-oc3", amount, 2020, 1, amount as u64 + 2).is_ok(),
        );

        let mut current = a0;
        for _ in 0..chain_len {
            let next = Address::generate(&env);
            let stale = current.clone();

            prop_assert!(transfer(&env, &client, &current, &next, "b-oc3", 1).is_ok());
            prop_assert_eq!(
                client.get_credit_batch(&s(&env, "b-oc3")).owner,
                next.clone(),
                "OC-3: owner is not the latest recipient",
            );

            // The address that just gave the batch away cannot move it again.
            let third = Address::generate(&env);
            let err = transfer(&env, &client, &stale, &third, "b-oc3", 1)
                .expect_err("OC-3: stale owner must not be able to transfer");
            prop_assert_eq!(err, CarbonError::UnauthorizedVerifier);
            prop_assert_eq!(
                client.get_credit_batch(&s(&env, "b-oc3")).owner,
                next.clone(),
                "OC-3: stale-owner attempt still changed ownership",
            );

            current = next;
        }
    }

    /// OC-4: a self-transfer (`from == to`) is a no-op for ownership and
    /// leaves the issued supply and status untouched.
    #[test]
    fn oc4_self_transfer_is_a_noop(
        amount in 2_i128..=200_000_i128,
        move_amount in 1_i128..=200_000_i128,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "p-oc4", "b-oc4", amount, 2020, 1, amount as u64 + 2).is_ok(),
        );

        prop_assert!(transfer(&env, &client, &owner, &owner, "b-oc4", move_amount.clamp(1, amount)).is_ok());
        let batch = client.get_credit_batch(&s(&env, "b-oc4"));
        prop_assert_eq!(batch.owner, owner, "OC-4: self-transfer changed the owner");
        prop_assert_eq!(batch.amount, amount, "OC-4: self-transfer changed the issued supply");
        prop_assert_eq!(batch.status, CreditStatus::Active);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Core-function properties (mint)
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(config())]

    /// M-1: a well-formed mint always succeeds and every field of the stored
    /// batch round-trips the arguments it was minted with.
    #[test]
    fn m1_valid_mint_round_trips(
        amount in 1_i128..=MAX_BATCH_SIZE,
        vintage in MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
        serial_start in 1_u64..=1_000_000_u64,
        width in 1_u64..=500_000_u64,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let serial_end = serial_start + width;

        prop_assert!(
            mint(&env, &client, &admin, &owner, "p-m1", "b-m1", amount, vintage, serial_start, serial_end).is_ok(),
            "M-1: a well-formed mint was rejected",
        );

        let batch = client.get_credit_batch(&s(&env, "b-m1"));
        prop_assert_eq!(batch.batch_id, s(&env, "b-m1"));
        prop_assert_eq!(batch.project_id, s(&env, "p-m1"));
        prop_assert_eq!(batch.amount, amount);
        prop_assert_eq!(batch.vintage_year, vintage);
        prop_assert_eq!(batch.serial_start, serial_start);
        prop_assert_eq!(batch.serial_end, serial_end);
        prop_assert_eq!(batch.owner, owner);
        prop_assert_eq!(batch.status, CreditStatus::Active);
    }

    /// M-2: a degenerate serial range (`start == 0`, or `end <= start`) is
    /// always rejected with `InvalidSerialRange` and persists no batch — the
    /// same id still mints cleanly afterwards.
    #[test]
    fn m2_mint_rejects_degenerate_serial_range(
        amount in 1_i128..=10_000_i128,
        pick in 0_u32..3_u32,
        a in 1_u64..=1_000_000_u64,
    ) {
        let (start, end) = match pick {
            0 => (0_u64, a),                 // start == 0
            1 => (a, a),                     // end == start
            _ => (a.saturating_add(1), a),   // end < start
        };

        let (env, client, admin) = setup();
        let owner = Address::generate(&env);

        let err = mint(&env, &client, &admin, &owner, "p-m2", "b-m2", amount, 2020, start, end)
            .expect_err("M-2: a degenerate serial range must be rejected");
        prop_assert_eq!(err, CarbonError::InvalidSerialRange);

        // A rejected mint must not have half-written the batch.
        prop_assert!(
            mint(&env, &client, &admin, &owner, "p-m2", "b-m2", amount, 2020, 10, 20).is_ok(),
            "M-2: a rejected mint left a partial batch behind",
        );
    }

    /// M-3: mint amounts outside `(0, MAX_BATCH_SIZE]` are always rejected —
    /// zero/negative with `ZeroAmountNotAllowed`, oversize with `BatchTooLarge`.
    #[test]
    fn m3_mint_rejects_out_of_range_amount(
        amount in prop_oneof![i128::MIN..=0_i128, (MAX_BATCH_SIZE + 1)..=i128::MAX],
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);

        let err = mint(&env, &client, &admin, &owner, "p-m3", "b-m3", amount, 2020, 1, 1_000)
            .expect_err("M-3: an out-of-range mint amount must be rejected");
        let expected = if amount <= 0 {
            CarbonError::ZeroAmountNotAllowed
        } else {
            CarbonError::BatchTooLarge
        };
        prop_assert_eq!(err, expected);
    }
}
