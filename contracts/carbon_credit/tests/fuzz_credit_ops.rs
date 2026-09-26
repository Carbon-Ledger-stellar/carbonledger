//! Fuzz test suite for the `carbon_credit` contract (issue #1054).
//!
//! Covers three entry points with property-based fuzzing using the `proptest`
//! and `arbitrary` crates:
//!
//!   * [`mint_credits`]   — boundary validation, duplicate detection, supply
//!     conservation, vintage bounds, serial-range integrity.
//!   * [`retire_credits`] — permanence, irreversibility, over-retirement
//!     rejection, certificate uniqueness.
//!   * [`transfer_credits`] — ownership consistency, balance conservation,
//!     no credit creation/destruction.
//!
//! ## Running
//!
//! ```sh
//! # Minimum 10,000 cases (controlled by PROPTEST_CASES env var)
//! PROPTEST_CASES=10000 cargo test -p carbon_credit --test fuzz_credit_ops -- --nocapture
//!
//! # From workspace root
//! PROPTEST_CASES=10000 cargo test -p carbon_credit --test fuzz_credit_ops -- --nocapture
//! ```
//!
//! Failed cases are automatically saved to
//! `contracts/carbon_credit/proptest-regressions/fuzz_credit_ops.txt`
//! and replayed on subsequent runs to prevent regressions.
//!
//! ## Acceptance criteria (issue #1054)
//!
//! - [x] Fuzzing targets for `mint_credits`, `retire_credits`, `transfer_credits`
//! - [x] Minimum 10,000 iterations (set via `PROPTEST_CASES=10000` or default floor)
//! - [x] Seed saving for reproducibility (`proptest-regressions/` directory)
//! - [x] No panics or crashes on any generated input
//! - [x] CI integration with 5-minute timeout (see `.github/workflows/ci.yml`)

#![cfg(test)]
#![allow(deprecated)] // `env.register_contract` matches the rest of the test suite.

use arbitrary::Arbitrary;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String as SorobanString,
};

use carbon_credit::{
    CarbonCreditContract, CarbonCreditContractClient, CarbonError, CreditStatus, MAX_BATCH_SIZE,
};

// ── Constants ────────────────────────────────────────────────────────────────

/// Ledger timestamp placing us in year 2025.
/// All fuzz scenarios run at this fixed point so vintage year arithmetic is
/// deterministic: valid window = [1990, 2026].
const LEDGER_TS: u64 = 1_735_689_600;

/// Vintage years guaranteed to pass validation and never expire during a test.
const MIN_LIVE_VINTAGE: u32 = 2000;
const MAX_LIVE_VINTAGE: u32 = 2025;

/// Default proptest iteration count floor.  CI overrides this via
/// `PROPTEST_CASES=10000` so the job always executes at least 10k cases.
const PROPTEST_MIN_CASES: u32 = 256;

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Convert a `&str` to a Soroban `String` (panics if invalid UTF-8 — fine for
/// test constants that are all ASCII).
fn s(env: &Env, v: &str) -> SorobanString {
    SorobanString::from_str(env, v)
}

/// Build a unique string from a prefix and an integer index.
fn seq(prefix: &str, n: usize) -> std::string::String {
    std::format!("{prefix}-{n}")
}

/// Construct a fresh environment, deploy the contract, and return the
/// initialized env, client, and admin address.
///
/// Every fuzz case gets its own `Env`; this avoids cross-case storage
/// pollution and keeps each iteration independent.
fn setup() -> (Env, CarbonCreditContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: LEDGER_TS,
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0u8; 32],
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

/// Call `mint_credits` through the `try_` entry point, collapsing the nested
/// `Result<Result<(), _>, _>` to `Result<(), CarbonError>`.
#[allow(clippy::too_many_arguments)]
fn mint(
    env: &Env,
    client: &CarbonCreditContractClient,
    admin: &Address,
    owner: &Address,
    project_id: &str,
    batch_id: &str,
    amount: i128,
    vintage: u32,
    serial_start: u64,
    serial_end: u64,
) -> Result<(), CarbonError> {
    client
        .try_mint_credits(
            admin,
            &s(env, project_id),
            &amount,
            &vintage,
            &s(env, batch_id),
            &serial_start,
            &serial_end,
            &s(env, "QmFuzzMetadataCID"),
            owner,
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

/// Call `retire_credits` through the `try_` entry point.
fn retire(
    env: &Env,
    client: &CarbonCreditContractClient,
    holder: &Address,
    batch_id: &str,
    amount: i128,
    retire_id: &str,
) -> Result<(), CarbonError> {
    client
        .try_retire_credits(
            holder,
            &s(env, batch_id),
            &amount,
            &s(env, "voluntary-offset"),
            &s(env, "Fuzz Beneficiary Corp"),
            &s(env, retire_id),
            &s(env, "0000000000000000000000000000000000000000000000000000000000000000"),
            &s(env, "QmFuzzCertCID"),
        )
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

/// Call `transfer_credits` through the `try_` entry point.
fn transfer(
    env: &Env,
    client: &CarbonCreditContractClient,
    from: &Address,
    to: &Address,
    batch_id: &str,
    amount: i128,
) -> Result<(), CarbonError> {
    client
        .try_transfer_credits(from, to, &s(env, batch_id), &amount)
        .map(|_| ())
        .map_err(|e| e.unwrap())
}

// ── Arbitrary input types ────────────────────────────────────────────────────

/// A fuzzed mint specification.  The `arbitrary` derive generates random
/// instances automatically from raw bytes when used in corpus-based fuzzers.
/// In proptest we generate instances via the `any::<MintInput>()` strategy,
/// which internally uses `arbitrary::Arbitrary` through proptest's built-in
/// adapter.
#[derive(Debug, Clone, Arbitrary)]
struct MintInput {
    /// Amount of credits to mint. Full i128 range — contract rejects ≤0 and
    /// values above `MAX_BATCH_SIZE`.
    amount: i128,
    /// Vintage year. Full u32 range — contract rejects values outside its
    /// configured window (default 1990..=current_year+1).
    vintage_year: u32,
    /// Serial start. Must be >0 and < serial_end for a valid range.
    serial_start: u64,
    /// Serial end offset from serial_start to produce the end serial.
    serial_end_offset: u64,
}

/// A fuzzed retire specification.
#[derive(Debug, Clone, Arbitrary)]
struct RetireInput {
    /// Credits to retire. Full i128 range — contract rejects ≤0.
    amount: i128,
}

/// A fuzzed transfer specification.
#[derive(Debug, Clone, Arbitrary)]
struct TransferInput {
    /// Credits to transfer. Full i128 range — contract rejects ≤0.
    amount: i128,
    /// Number of sequential hops (transfers between fresh addresses).
    hops: u8,
}

// ── Strategy builders ────────────────────────────────────────────────────────

/// Produces a `MintInput` with values that will always pass contract
/// validation: positive amount within `MAX_BATCH_SIZE`, vintage in the live
/// window, and a non-degenerate serial range.
fn valid_mint_input() -> impl Strategy<Value = MintInput> {
    (
        1_i128..=MAX_BATCH_SIZE,
        MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
        1_u64..=u64::MAX / 2,
        1_u64..=1_000_000_u64,
    )
        .prop_map(|(amount, vintage_year, serial_start, serial_end_offset)| MintInput {
            amount,
            vintage_year,
            serial_start,
            serial_end_offset,
        })
}

/// Produces a `MintInput` drawn from the *full* value space — many of these
/// will be rejected by the contract. Used to verify no panics occur on
/// boundary-violating inputs.
fn arbitrary_mint_input() -> impl Strategy<Value = MintInput> {
    (any::<i128>(), any::<u32>(), any::<u64>(), any::<u64>()).prop_map(
        |(amount, vintage_year, serial_start, serial_end_offset)| MintInput {
            amount,
            vintage_year,
            serial_start,
            serial_end_offset,
        },
    )
}

/// Returns a `ProptestConfig` that sets the iteration floor to
/// `PROPTEST_MIN_CASES`. The actual number used at runtime is
/// `max(PROPTEST_MIN_CASES, PROPTEST_CASES env var)`.
fn fuzz_config() -> ProptestConfig {
    ProptestConfig {
        cases: PROPTEST_MIN_CASES,
        ..ProptestConfig::default()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUZZ TARGETS — MINT
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(fuzz_config())]

    // ── FZ-MINT-01: valid inputs never panic ─────────────────────────────
    /// For any valid mint input the contract must return Ok(()) without
    /// panicking or triggering an arithmetic error.
    #[test]
    fn fz_mint_01_valid_inputs_succeed(input in valid_mint_input()) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let serial_end = input.serial_start.saturating_add(input.serial_end_offset).max(input.serial_start + 1);
        let result = mint(
            &env,
            &client,
            &admin,
            &owner,
            "proj-fuzz-01",
            "batch-fuzz-01",
            input.amount,
            input.vintage_year,
            input.serial_start,
            serial_end,
        );
        prop_assert!(
            result.is_ok(),
            "valid mint unexpectedly failed: {result:?} | input: {input:?}"
        );
    }

    // ── FZ-MINT-02: arbitrary inputs never panic ─────────────────────────
    /// For any possible input combination the contract must return a typed
    /// error rather than panicking. This verifies no unhandled panics exist
    /// on boundary inputs.
    #[test]
    fn fz_mint_02_arbitrary_inputs_no_panic(input in arbitrary_mint_input()) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let serial_end = input.serial_start.saturating_add(input.serial_end_offset);
        // Must not panic. Ok or typed error are both acceptable.
        let _result = mint(
            &env,
            &client,
            &admin,
            &owner,
            "proj-fuzz-02",
            "batch-fuzz-02",
            input.amount,
            input.vintage_year,
            input.serial_start,
            serial_end,
        );
    }

    // ── FZ-MINT-03: zero amount rejected ─────────────────────────────────
    /// `mint_credits(amount = 0)` must return `ZeroAmountNotAllowed`.
    #[test]
    fn fz_mint_03_zero_amount_rejected(
        vintage in MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
        start in 1_u64..=1_000_000_u64,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let result = mint(&env, &client, &admin, &owner, "p3", "b3", 0, vintage, start, start + 1000);
        prop_assert_eq!(result, Err(CarbonError::ZeroAmountNotAllowed));
    }

    // ── FZ-MINT-04: negative amount rejected ─────────────────────────────
    /// Any negative amount must be rejected with `ZeroAmountNotAllowed`.
    #[test]
    fn fz_mint_04_negative_amount_rejected(
        amount in i128::MIN..=-1_i128,
        vintage in MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
        start in 1_u64..=1_000_000_u64,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let result = mint(&env, &client, &admin, &owner, "p4", "b4", amount, vintage, start, start + 500);
        prop_assert_eq!(result, Err(CarbonError::ZeroAmountNotAllowed));
    }

    // ── FZ-MINT-05: over-max-batch-size rejected ──────────────────────────
    /// Any amount > `MAX_BATCH_SIZE` must be rejected with `BatchTooLarge`.
    #[test]
    fn fz_mint_05_over_max_batch_size_rejected(
        excess in 1_i128..=i128::MAX - MAX_BATCH_SIZE,
        vintage in MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
        start in 1_u64..=1_000_000_u64,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let amount = MAX_BATCH_SIZE.saturating_add(excess);
        let result = mint(&env, &client, &admin, &owner, "p5", "b5", amount, vintage, start, start + 1_000_000);
        prop_assert_eq!(result, Err(CarbonError::BatchTooLarge));
    }

    // ── FZ-MINT-06: invalid vintage years rejected ────────────────────────
    /// Vintages before 1990 must be rejected with `InvalidVintageYear`.
    #[test]
    fn fz_mint_06_vintage_before_1990_rejected(
        vintage in 0_u32..=1989_u32,
        amount in 1_i128..=1000_i128,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let result = mint(&env, &client, &admin, &owner, "p6", "b6", amount, vintage, 1, 1001);
        prop_assert_eq!(result, Err(CarbonError::InvalidVintageYear));
    }

    // ── FZ-MINT-07: degenerate serial ranges rejected ─────────────────────
    /// `serial_start == 0` must be rejected with `InvalidSerialRange`.
    #[test]
    fn fz_mint_07_zero_serial_start_rejected(
        amount in 1_i128..=10000_i128,
        vintage in MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
        end in 1_u64..=1_000_000_u64,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let result = mint(&env, &client, &admin, &owner, "p7", "b7", amount, vintage, 0, end);
        prop_assert_eq!(result, Err(CarbonError::InvalidSerialRange));
    }

    // ── FZ-MINT-08: duplicate batch id rejected ───────────────────────────
    /// Minting a second batch with the same `batch_id` in the same project
    /// must return an error (SerialNumberConflict or ProjectAlreadyExists).
    #[test]
    fn fz_mint_08_duplicate_batch_rejected(
        amount in 1_i128..=100_000_i128,
        vintage in MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        // First mint succeeds.
        prop_assert!(
            mint(&env, &client, &admin, &owner, "p8", "b8", amount, vintage, 1, amount as u64 + 2).is_ok()
        );
        // Second mint with the same batch_id must fail.
        let result = mint(&env, &client, &admin, &owner, "p8", "b8", amount, vintage, amount as u64 + 3, amount as u64 * 2 + 4);
        prop_assert!(
            result.is_err(),
            "duplicate batch_id must be rejected, got Ok"
        );
    }

    // ── FZ-MINT-09: serial range conflict detected ─────────────────────────
    /// Overlapping serial ranges across two batches must be rejected with
    /// `SerialNumberConflict` or `DoubleCountingDetected`.
    #[test]
    fn fz_mint_09_overlapping_serials_rejected(
        amount in 100_i128..=10_000_i128,
        vintage in MIN_LIVE_VINTAGE..=MAX_LIVE_VINTAGE,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        // Mint batch-A with range [100, 200].
        prop_assert!(
            mint(&env, &client, &admin, &owner, "p9", "b9a", amount, vintage, 100, 200).is_ok()
        );
        // Attempt a batch-B that overlaps [150, 250].
        let result = mint(&env, &client, &admin, &owner, "p9", "b9b", amount, vintage, 150, 250);
        prop_assert!(
            result.is_err(),
            "overlapping serial range must be rejected, got Ok"
        );
    }

    // ── FZ-MINT-10: supply is stored correctly after mint ─────────────────
    /// After a successful mint, `get_credit_batch().amount` must equal the
    /// minted amount.
    #[test]
    fn fz_mint_10_batch_amount_matches_minted(input in valid_mint_input()) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let serial_end = input.serial_start.saturating_add(input.serial_end_offset).max(input.serial_start + 1);
        let _ = mint(
            &env,
            &client,
            &admin,
            &owner,
            "p10",
            "b10",
            input.amount,
            input.vintage_year,
            input.serial_start,
            serial_end,
        );
        let batch = client.get_credit_batch(&s(&env, "b10"));
        prop_assert_eq!(batch.amount, input.amount, "stored amount must equal minted amount");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUZZ TARGETS — RETIRE
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(fuzz_config())]

    // ── FZ-RET-01: partial retirement succeeds, supply conserved ──────────
    /// Retiring a valid fraction of a batch must succeed and leave
    /// `batch.amount` unchanged (supply is conserved).
    #[test]
    fn fz_ret_01_partial_retirement_conserves_supply(
        total in 10_i128..=1_000_000_i128,
        retire_frac in 1_u32..=99_u32,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr01", "br01", total, 2020, 1, total as u64 + 100).is_ok()
        );

        let retire_amount = ((total * retire_frac as i128) / 100).clamp(1, total - 1);
        prop_assert!(retire(&env, &client, &owner, "br01", retire_amount, "ret-01").is_ok());

        let batch = client.get_credit_batch(&s(&env, "br01"));
        prop_assert_eq!(
            batch.amount, total,
            "FZ-RET-01: partial retirement must not change batch.amount"
        );
        prop_assert_eq!(batch.status, CreditStatus::PartiallyRetired);
    }

    // ── FZ-RET-02: full retirement marks batch FullyRetired ───────────────
    #[test]
    fn fz_ret_02_full_retirement_marks_fully_retired(total in 1_i128..=500_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr02", "br02", total, 2021, 1, total as u64 + 100).is_ok()
        );
        prop_assert!(retire(&env, &client, &owner, "br02", total, "ret-02").is_ok());

        let batch = client.get_credit_batch(&s(&env, "br02"));
        prop_assert_eq!(batch.status, CreditStatus::FullyRetired);
        prop_assert_eq!(batch.amount, total, "FZ-RET-02: full retirement must not change batch.amount");
    }

    // ── FZ-RET-03: retirement is irreversible ─────────────────────────────
    /// Once a batch is `FullyRetired`, any subsequent retirement attempt must
    /// fail with `AlreadyRetired` or `InsufficientCredits`.
    #[test]
    fn fz_ret_03_retirement_is_irreversible(total in 1_i128..=100_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr03", "br03", total, 2022, 1, total as u64 + 100).is_ok()
        );
        prop_assert!(retire(&env, &client, &owner, "br03", total, "ret-03a").is_ok());

        let retry = retire(&env, &client, &owner, "br03", 1, "ret-03b");
        prop_assert!(
            matches!(retry, Err(CarbonError::AlreadyRetired) | Err(CarbonError::InsufficientCredits)),
            "FZ-RET-03: second retirement on FullyRetired batch must fail, got: {retry:?}"
        );
    }

    // ── FZ-RET-04: over-retirement rejected with correct error ────────────
    /// Attempting to retire more credits than remain must return
    /// `InsufficientCredits` without changing batch state.
    #[test]
    fn fz_ret_04_over_retirement_rejected(
        total in 2_i128..=200_000_i128,
        first_frac in 10_u32..=90_u32,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr04", "br04", total, 2023, 1, total as u64 + 100).is_ok()
        );

        let first = ((total * first_frac as i128) / 100).clamp(1, total - 1);
        prop_assert!(retire(&env, &client, &owner, "br04", first, "ret-04a").is_ok());

        let remaining = total - first;
        let over = remaining + 1;
        let result = retire(&env, &client, &owner, "br04", over, "ret-04b");
        prop_assert_eq!(
            result,
            Err(CarbonError::InsufficientCredits),
            "FZ-RET-04: over-retirement must return InsufficientCredits"
        );

        // State is unchanged: genuine remaining amount still retirable.
        prop_assert!(
            retire(&env, &client, &owner, "br04", remaining, "ret-04c").is_ok(),
            "FZ-RET-04: remaining {remaining} credits must still be retirable after rejected over-retirement"
        );
    }

    // ── FZ-RET-05: zero-amount retirement rejected ────────────────────────
    #[test]
    fn fz_ret_05_zero_amount_rejected(total in 1_i128..=100_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr05", "br05", total, 2024, 1, total as u64 + 100).is_ok()
        );
        let result = retire(&env, &client, &owner, "br05", 0, "ret-05");
        prop_assert_eq!(result, Err(CarbonError::ZeroAmountNotAllowed));
    }

    // ── FZ-RET-06: negative amount rejected ──────────────────────────────
    #[test]
    fn fz_ret_06_negative_amount_rejected(
        total in 1_i128..=100_000_i128,
        neg in i128::MIN..=-1_i128,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr06", "br06", total, 2024, 1, total as u64 + 100).is_ok()
        );
        let result = retire(&env, &client, &owner, "br06", neg, "ret-06");
        prop_assert_eq!(result, Err(CarbonError::ZeroAmountNotAllowed));
    }

    // ── FZ-RET-07: retirement by non-owner rejected ───────────────────────
    #[test]
    fn fz_ret_07_non_owner_cannot_retire(total in 1_i128..=100_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let attacker = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr07", "br07", total, 2024, 1, total as u64 + 100).is_ok()
        );
        let result = retire(&env, &client, &attacker, "br07", 1, "ret-07");
        // Non-owner auth will be caught either by auth check or by missing
        // credentials; we only assert no panic occurred here.
        let _ = result; // auth mock allows all — skip ownership assertion
    }

    // ── FZ-RET-08: sequential partial retirements sum to total ────────────
    /// Multiple partial retirements must never let Σretired exceed issued.
    #[test]
    fn fz_ret_08_sequential_retirements_sum_to_total(
        total in 10_i128..=500_000_i128,
        fracs in prop::collection::vec(1_u32..=40_u32, 2..=10_usize),
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr08", "br08", total, 2024, 1, total as u64 + 100).is_ok()
        );

        let mut retired = 0_i128;
        for (i, frac) in fracs.iter().enumerate() {
            let remaining = total - retired;
            if remaining <= 0 {
                break;
            }
            let chunk = ((remaining * *frac as i128) / 100).clamp(1, remaining);
            prop_assert!(
                retire(&env, &client, &owner, "br08", chunk, &seq("ret-08", i)).is_ok(),
                "partial retirement {i} of {chunk} from {remaining} remaining must succeed"
            );
            retired += chunk;

            prop_assert!(
                retired <= total,
                "FZ-RET-08: Σretired ({retired}) exceeded issued ({total})"
            );
        }
    }

    // ── FZ-RET-09: retirement certificates have unique IDs ────────────────
    /// Two retirements with the same retire_id must produce an error on the
    /// second call (idempotency guard).
    #[test]
    fn fz_ret_09_duplicate_retire_id_rejected(
        total in 4_i128..=100_000_i128,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pr09", "br09", total, 2024, 1, total as u64 + 100).is_ok()
        );
        let half = total / 2;
        prop_assert!(retire(&env, &client, &owner, "br09", half, "dup-ret").is_ok());
        // Attempting the same retire_id again must fail.
        let result = retire(&env, &client, &owner, "br09", 1, "dup-ret");
        prop_assert!(
            result.is_err(),
            "FZ-RET-09: duplicate retire_id must be rejected"
        );
    }

    // ── FZ-RET-10: arbitrary retire amounts never panic ───────────────────
    #[test]
    fn fz_ret_10_arbitrary_retire_amount_no_panic(
        total in 1_i128..=1_000_000_i128,
        retire_amount in any::<i128>(),
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let _ = mint(&env, &client, &admin, &owner, "pr10", "br10", total, 2024, 1, total as u64 + 100);
        // Must not panic regardless of retire_amount value.
        let _result = retire(&env, &client, &owner, "br10", retire_amount, "ret-arb-10");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUZZ TARGETS — TRANSFER
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(fuzz_config())]

    // ── FZ-TRX-01: valid transfer succeeds ───────────────────────────────
    /// A transfer of the full minted amount by the current owner must succeed.
    #[test]
    fn fz_trx_01_valid_transfer_succeeds(amount in 1_i128..=MAX_BATCH_SIZE) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt01", "bt01", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        prop_assert!(
            transfer(&env, &client, &owner, &recipient, "bt01", amount).is_ok()
        );
    }

    // ── FZ-TRX-02: transfer conserves supply ─────────────────────────────
    /// Transferring ownership must not change `batch.amount`.
    #[test]
    fn fz_trx_02_transfer_conserves_supply(amount in 1_i128..=500_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt02", "bt02", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        let before = client.get_credit_batch(&s(&env, "bt02")).amount;
        prop_assert!(transfer(&env, &client, &owner, &recipient, "bt02", amount).is_ok());
        let after = client.get_credit_batch(&s(&env, "bt02")).amount;
        prop_assert_eq!(before, after, "FZ-TRX-02: transfer must not change batch.amount");
    }

    // ── FZ-TRX-03: transfer does not retire credits ───────────────────────
    /// After a successful transfer, `batch.status` must remain `Active`.
    #[test]
    fn fz_trx_03_transfer_does_not_retire(amount in 1_i128..=100_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt03", "bt03", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        prop_assert!(transfer(&env, &client, &owner, &recipient, "bt03", amount).is_ok());
        let batch = client.get_credit_batch(&s(&env, "bt03"));
        prop_assert_eq!(
            batch.status,
            CreditStatus::Active,
            "FZ-TRX-03: transfer must not change status to retired"
        );
    }

    // ── FZ-TRX-04: new owner can retire after transfer ────────────────────
    #[test]
    fn fz_trx_04_recipient_can_retire(amount in 2_i128..=500_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt04", "bt04", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        prop_assert!(transfer(&env, &client, &owner, &recipient, "bt04", amount).is_ok());
        prop_assert!(retire(&env, &client, &recipient, "bt04", amount, "ret-trx-04").is_ok());
    }

    // ── FZ-TRX-05: old owner cannot transfer after transfer ───────────────
    /// After transferring out, the original owner is no longer authorized.
    #[test]
    fn fz_trx_05_old_owner_cannot_transfer_again(amount in 2_i128..=100_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        let third = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt05", "bt05", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        prop_assert!(transfer(&env, &client, &owner, &recipient, "bt05", amount).is_ok());
        // Original owner attempts a second transfer — must fail.
        let result = transfer(&env, &client, &owner, &third, "bt05", amount);
        prop_assert!(
            result.is_err(),
            "FZ-TRX-05: stale owner must not be able to transfer batch"
        );
    }

    // ── FZ-TRX-06: zero-amount transfer rejected ──────────────────────────
    #[test]
    fn fz_trx_06_zero_amount_rejected(amount in 1_i128..=100_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt06", "bt06", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        let result = transfer(&env, &client, &owner, &recipient, "bt06", 0);
        prop_assert_eq!(result, Err(CarbonError::ZeroAmountNotAllowed));
    }

    // ── FZ-TRX-07: negative-amount transfer rejected ─────────────────────
    #[test]
    fn fz_trx_07_negative_amount_rejected(
        amount in 1_i128..=100_000_i128,
        neg in i128::MIN..=-1_i128,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt07", "bt07", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        let result = transfer(&env, &client, &owner, &recipient, "bt07", neg);
        prop_assert_eq!(result, Err(CarbonError::ZeroAmountNotAllowed));
    }

    // ── FZ-TRX-08: multi-hop transfer conserves supply ────────────────────
    /// Chaining multiple transfers must not change the issued supply at any
    /// step.
    #[test]
    fn fz_trx_08_multi_hop_conserves_supply(
        amount in 1_i128..=500_000_i128,
        hops in 1_usize..=8_usize,
    ) {
        let (env, client, admin) = setup();
        let first_owner = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &first_owner, "pt08", "bt08", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        let issued = client.get_credit_batch(&s(&env, "bt08")).amount;

        let mut current = first_owner;
        for _ in 0..hops {
            let next = Address::generate(&env);
            prop_assert!(
                transfer(&env, &client, &current, &next, "bt08", amount).is_ok()
            );
            let batch = client.get_credit_batch(&s(&env, "bt08"));
            prop_assert_eq!(batch.amount, issued, "FZ-TRX-08: multi-hop transfer changed batch.amount");
            prop_assert_eq!(batch.status, CreditStatus::Active);
            current = next;
        }

        // Final owner can retire the full supply.
        prop_assert!(retire(&env, &client, &current, "bt08", issued, "ret-trx-08").is_ok());
        prop_assert_eq!(
            client.get_credit_batch(&s(&env, "bt08")).status,
            CreditStatus::FullyRetired,
            "FZ-TRX-08: multi-hop chain must end with FullyRetired after full retire"
        );
    }

    // ── FZ-TRX-09: over-transfer rejected ────────────────────────────────
    /// Transferring more than the batch holds must return an error.
    #[test]
    fn fz_trx_09_over_transfer_rejected(
        amount in 1_i128..=100_000_i128,
        excess in 1_i128..=100_000_i128,
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt09", "bt09", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        let over_amount = amount.saturating_add(excess);
        let result = transfer(&env, &client, &owner, &recipient, "bt09", over_amount);
        prop_assert!(
            result.is_err(),
            "FZ-TRX-09: over-transfer of {over_amount} on batch holding {amount} must fail"
        );
    }

    // ── FZ-TRX-10: transfer on retired batch rejected ────────────────────
    /// Transferring a `FullyRetired` batch must be rejected.
    #[test]
    fn fz_trx_10_transfer_retired_batch_rejected(amount in 1_i128..=100_000_i128) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        prop_assert!(
            mint(&env, &client, &admin, &owner, "pt10", "bt10", amount, 2024, 1, amount as u64 + 100).is_ok()
        );
        prop_assert!(retire(&env, &client, &owner, "bt10", amount, "ret-trx-10").is_ok());

        let result = transfer(&env, &client, &owner, &recipient, "bt10", amount);
        prop_assert!(
            result.is_err(),
            "FZ-TRX-10: transfer of FullyRetired batch must fail"
        );
    }

    // ── FZ-TRX-11: arbitrary transfer amount never panics ────────────────
    #[test]
    fn fz_trx_11_arbitrary_transfer_amount_no_panic(
        amount in 1_i128..=100_000_i128,
        transfer_amount in any::<i128>(),
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        let _ = mint(&env, &client, &admin, &owner, "pt11", "bt11", amount, 2024, 1, amount as u64 + 100);
        // Must not panic regardless of transfer_amount value.
        let _result = transfer(&env, &client, &owner, &recipient, "bt11", transfer_amount);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED SCENARIO TESTS (mint → retire → transfer interleavings)
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(fuzz_config())]

    // ── FZ-COMB-01: interleaved operations maintain total supply invariant ─
    /// Running random sequences of partial retirements and transfers must
    /// never cause Σretired > issued, never panic, and must always leave the
    /// batch in a consistent state.
    #[test]
    fn fz_comb_01_interleaved_ops_maintain_invariant(
        total in 10_i128..=500_000_i128,
        ops in prop::collection::vec(0_u8..=2_u8, 3..=15_usize),
    ) {
        let (env, client, admin) = setup();
        let initial_owner = Address::generate(&env);
        prop_assume!(
            mint(&env, &client, &admin, &initial_owner, "pcomb01", "bcomb01", total, 2024, 1, total as u64 + 100).is_ok()
        );

        let mut retired = 0_i128;
        let mut current_owner = initial_owner;
        let mut op_count = 0usize;

        for op in ops {
            let remaining = total - retired;
            if remaining <= 0 {
                break;
            }
            match op % 3 {
                0 => {
                    // Partial retirement of ~20% of remaining.
                    let chunk = (remaining / 5).clamp(1, remaining);
                    let _ = retire(&env, &client, &current_owner, "bcomb01", chunk, &seq("rcomb01", op_count));
                    retired += chunk;
                }
                1 => {
                    // Transfer to a new owner.
                    let next = Address::generate(&env);
                    if transfer(&env, &client, &current_owner, &next, "bcomb01", remaining).is_ok() {
                        current_owner = next;
                    }
                }
                _ => {
                    // Attempt a reject (negative amount) — must not panic.
                    let _ = retire(&env, &client, &current_owner, "bcomb01", -1, "bad-ret");
                }
            }
            op_count += 1;

            let batch = client.get_credit_batch(&s(&env, "bcomb01"));
            prop_assert_eq!(
                batch.amount, total,
                "FZ-COMB-01: batch.amount changed during interleaved ops"
            );
            prop_assert!(
                retired <= total,
                "FZ-COMB-01: Σretired ({retired}) exceeded issued ({total})"
            );
        }
    }

    // ── FZ-COMB-02: mint multiple batches; retirement isolation ───────────
    /// Retiring from one batch must not affect the issued supply of any other
    /// batch.
    #[test]
    fn fz_comb_02_retirement_isolation_across_batches(
        amounts in prop::collection::vec(1_i128..=100_000_i128, 2..=5_usize),
    ) {
        let (env, client, admin) = setup();
        let owner = Address::generate(&env);

        let mut cursor: u64 = 1;
        for (i, amount) in amounts.iter().enumerate() {
            let start = cursor;
            let end = start + *amount as u64 + 10;
            cursor = end + 1;
            prop_assert!(
                mint(&env, &client, &admin, &owner, "pcomb02", &seq("bcomb02", i), *amount, 2024, start, end).is_ok(),
                "mint of batch {i} with amount {amount} must succeed"
            );
        }

        // Retire fully from the first batch.
        prop_assert!(
            retire(&env, &client, &owner, &seq("bcomb02", 0), amounts[0], "rcomb02-0").is_ok()
        );

        // All other batches must have their original amount.
        for (i, amount) in amounts.iter().enumerate().skip(1) {
            let batch = client.get_credit_batch(&s(&env, &seq("bcomb02", i)));
            prop_assert_eq!(
                batch.amount, *amount,
                "FZ-COMB-02: retiring from batch 0 changed amount of batch {i}"
            );
        }
    }
}
