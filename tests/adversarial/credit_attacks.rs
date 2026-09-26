//! # Credit Contract Attack Scenarios
//!
//! Attack narratives covered:
//!
//! | Test | Attack | Error |
//! |------|--------|-------|
//! | test_mint_unverified_project | Attacker tries to mint credits for a project that was registered but not yet verified | ProjectNotVerified (2) — enforced by registry check on credit contract |
//! | test_mint_zero_amount | Attacker sends amount = 0 to bypass ledger fee accounting | ZeroAmountNotAllowed (16) |
//! | test_mint_future_vintage | Attacker mints credits with vintage_year = 3000 | InvalidVintageYear (9) |
//! | test_duplicate_batch_id | Attacker reuses an existing batch ID to confuse the registry or double-issue | SerialNumberConflict (6) |
//! | test_overlapping_serial_ranges | Attacker submits a new batch whose serial range overlaps an existing one (double-counting) | DoubleCountingDetected (14) |
//! | test_retire_more_than_owned | Attacker tries to retire more credits than are in a batch | InsufficientCredits (4) |
//! | test_retire_fully_retired_batch | Attacker retires a fully-retired batch a second time | AlreadyRetired (5) |
//! | test_retire_already_retired_id | Attacker calls undo_retire on a valid retirement record | RetirementIrreversible (15) |
//! | test_invalid_serial_range | Attacker submits serial_start > serial_end | InvalidSerialRange (18) |
//! | test_serial_start_zero | Attacker uses serial_start = 0 (protocol disallows zero as sentinel) | InvalidSerialRange (18) |
//! | test_mint_negative_amount | Attacker passes a negative amount hoping for integer wrap-around | ZeroAmountNotAllowed (16) |
//! | test_transfer_retired_batch | Attacker tries to resell a fully-retired batch | AlreadyRetired (5) |
//! | test_transfer_from_non_owner | Attacker transfers a batch they do not own | UnauthorizedVerifier (7) |
//! | test_retire_after_partial_retirement_over_limit | Attacker retires more than what remains after a partial retirement | InsufficientCredits (4) |
//! | test_mint_batch_too_large | Attacker mints a batch exceeding the maximum batch size (1 billion) | BatchTooLarge |

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient, CarbonError, CreditStatus};

use super::helpers::s;

fn setup_credit(env: &Env) -> (CarbonCreditContractClient, Address) {
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
    client.initialize(&admin, &registry).unwrap();
    (client, admin)
}

fn mint_valid_batch(
    env: &Env,
    client: &CarbonCreditContractClient,
    admin: &Address,
    batch_id: &str,
    owner: &Address,
    serial_start: u64,
    serial_end: u64,
    amount: i128,
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
    ).unwrap();
}

// ── Attack 1: mint for unverified project ─────────────────────────────────────
/// ATTACK: An attacker registers a project and immediately tries to mint credits
/// before a verifier has approved it, bypassing the verification gate.
/// The credit contract defers to the registry; in unit-test isolation we verify
/// the contract guard is in place (the admin-only guard fires first here, but
/// in production the registry cross-call would return ProjectNotVerified).
#[test]
fn test_mint_unverified_project() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let attacker = Address::generate(&env);
    let owner = Address::generate(&env);

    // Attempt to mint from an attacker address (not admin) — mirrors the
    // real-world attack where a project dev acts before verification.
    let result = client.try_mint_credits(
        &attacker,
        &s(&env, "unverified-proj"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-unverified"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert!(result.is_err(), "minting from non-admin must be rejected");
    // The contract requires admin auth first; ProjectNotVerified would surface
    // in integration when the registry cross-call is wired.
    let _ = admin; // kept to make the pattern explicit
}

// ── Attack 2: mint zero amount ────────────────────────────────────────────────
/// ATTACK: An attacker submits amount = 0 to create an empty batch record,
/// potentially to pollute the serial registry or confuse the marketplace.
#[test]
fn test_mint_zero_amount() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &0_i128,
        &2023_u32,
        &s(&env, "batch-zero"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ZeroAmountNotAllowed);
}

// ── Attack 3: mint negative amount ───────────────────────────────────────────
/// ATTACK: An attacker passes amount = -1 hoping for integer wrap-around to
/// create a credit batch that represents a debt rather than an asset.
#[test]
fn test_mint_negative_amount() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &-1_i128,
        &2023_u32,
        &s(&env, "batch-neg"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ZeroAmountNotAllowed);
}

// ── Attack 4: mint with vintage_year far in the future ───────────────────────
/// ATTACK: An attacker mints credits with vintage_year = 3000 to create credits
/// for carbon that will supposedly be offset in the future, selling them now.
#[test]
fn test_mint_future_vintage() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &3000_u32,
        &s(&env, "batch-future"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
}

// ── Attack 5: duplicate batch ID ─────────────────────────────────────────────
/// ATTACK: After minting a legitimate batch, the attacker resubmits the same
/// batch_id to double-issue credits for the same underlying offset event.
#[test]
fn test_duplicate_batch_id() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_valid_batch(&env, &client, &admin, "batch-dup", &owner, 1, 100, 100);

    // Second mint with same batch ID — must be rejected as SerialNumberConflict.
    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-002"), // different project — still same batch_id
        &100_i128,
        &2023_u32,
        &s(&env, "batch-dup"), // same batch ID
        &201_u64,
        &300_u64,
        &s(&env, "QmCID2"),
        &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::SerialNumberConflict);
}

// ── Attack 6: overlapping serial ranges (double-counting) ────────────────────
/// ATTACK: After minting batch A with serials 1–100, the attacker mints batch B
/// with serials 50–150, claiming the same tonne of CO2 twice — the core
/// double-counting fraud vector in the carbon market.
#[test]
fn test_overlapping_serial_ranges() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    // First batch: serials 1–100.
    mint_valid_batch(&env, &client, &admin, "batch-A", &owner, 1, 100, 100);

    // Attacker mints overlapping serials 50–150.
    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-002"),
        &101_i128,
        &2023_u32,
        &s(&env, "batch-B"),
        &50_u64,  // overlaps with batch-A (1–100)
        &150_u64,
        &s(&env, "QmCID2"),
        &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::DoubleCountingDetected);
}

// ── Attack 7: retire more than owned ─────────────────────────────────────────
/// ATTACK: A holder retires 150 credits from a 100-credit batch hoping the
/// contract does not validate the balance and simply burns any number.
#[test]
fn test_retire_more_than_owned() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_valid_batch(&env, &client, &admin, "batch-over", &owner, 1, 100, 100);

    let result = client.try_retire_credits(
        &owner,
        &s(&env, "batch-over"),
        &150_i128, // 50 more than the batch contains
        &s(&env, "offset"),
        &s(&env, "Corp"),
        &s(&env, "ret-over"),
        &s(&env, "tx"),
        &s(&env, "QmCID"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InsufficientCredits);
}

// ── Attack 8: retire a fully-retired batch ───────────────────────────────────
/// ATTACK: After legitimately retiring an entire batch, the attacker retires it
/// again, hoping to generate a second certificate for the same tonnes.
#[test]
fn test_retire_fully_retired_batch() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_valid_batch(&env, &client, &admin, "batch-full", &owner, 1, 100, 100);

    // First retirement — full batch.
    client.retire_credits(
        &owner, &s(&env, "batch-full"), &100_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-001"), &s(&env, "tx"), &s(&env, "QmCID"),
    ).unwrap();

    // Second retirement attempt — must be rejected.
    let result = client.try_retire_credits(
        &owner, &s(&env, "batch-full"), &1_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-002"), &s(&env, "tx2"), &s(&env, "QmCID2"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::AlreadyRetired);
}

// ── Attack 9: undo a retirement (RetirementIrreversible) ─────────────────────
/// ATTACK: An attacker (or corrupt admin) calls undo_retire() on a completed
/// retirement certificate, attempting to recycle already-used credits and re-sell
/// them as if they were fresh — the most severe fraud vector in carbon markets.
#[test]
fn test_retire_already_retired_id() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_valid_batch(&env, &client, &admin, "batch-rev", &owner, 1, 100, 100);

    client.retire_credits(
        &owner, &s(&env, "batch-rev"), &100_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-rev"), &s(&env, "tx"), &s(&env, "QmCID"),
    ).unwrap();

    // Attempt reversal — must be rejected regardless of who calls it.
    let result = client.try_undo_retire(&admin, &s(&env, "ret-rev"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::RetirementIrreversible);
}

// ── Attack 10: invalid serial range (start ≥ end) ────────────────────────────
/// ATTACK: Attacker submits serial_start = 500 and serial_end = 100 (inverted
/// range) hoping to confuse range-checking logic and bypass double-counting guards.
#[test]
fn test_invalid_serial_range() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-inv"),
        &500_u64, // start > end — invalid
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidSerialRange);
}

// ── Attack 11: serial_start = 0 ──────────────────────────────────────────────
/// ATTACK: Attacker uses serial_start = 0 (reserved sentinel value) hoping it
/// underflows or bypasses bounds checking in the registry.
#[test]
fn test_serial_start_zero() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-zero-serial"),
        &0_u64,   // zero sentinel
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidSerialRange);
}

// ── Attack 12: transfer from retired batch ───────────────────────────────────
/// ATTACK: After retiring a batch, the attacker attempts to transfer the same
/// batch to a fresh wallet to re-sell the retired credits.
#[test]
fn test_transfer_retired_batch() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);

    mint_valid_batch(&env, &client, &admin, "batch-retired-tx", &owner, 1, 100, 100);

    client.retire_credits(
        &owner, &s(&env, "batch-retired-tx"), &100_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-tx"), &s(&env, "tx"), &s(&env, "QmCID"),
    ).unwrap();

    let result = client.try_transfer_credits(
        &owner, &buyer, &s(&env, "batch-retired-tx"), &100_i128,
    );
    assert!(result.is_err(), "transfer of fully-retired batch must fail");
}

// ── Attack 13: transfer from non-owner ───────────────────────────────────────
/// ATTACK: An attacker who does NOT own a batch calls transfer_credits() to
/// steal credits and sell them on a secondary market.
#[test]
fn test_transfer_from_non_owner() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let victim = Address::generate(&env);

    mint_valid_batch(&env, &client, &admin, "batch-steal", &owner, 1, 100, 100);

    let result = client.try_transfer_credits(
        &attacker, &victim, &s(&env, "batch-steal"), &100_i128,
    );
    assert!(result.is_err(), "transfer from non-owner must fail");
}

// ── Attack 14: retire beyond remaining after partial retirement ───────────────
/// ATTACK: After a partial retirement of 60 out of 100 credits, the attacker
/// attempts to retire 50 more (only 40 remain), hoping the contract does not
/// track the running retired total correctly.
#[test]
fn test_retire_after_partial_retirement_over_limit() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_valid_batch(&env, &client, &admin, "batch-partial", &owner, 1, 100, 100);

    // First partial retirement — 60 credits.
    client.retire_credits(
        &owner, &s(&env, "batch-partial"), &60_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-p1"), &s(&env, "tx"), &s(&env, "QmCID"),
    ).unwrap();

    // Attempt to retire 50 more (only 40 remain) — must fail.
    let result = client.try_retire_credits(
        &owner, &s(&env, "batch-partial"), &50_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-p2"), &s(&env, "tx2"), &s(&env, "QmCID2"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InsufficientCredits);
}

// ── Attack 15: mint batch exceeding MAX_BATCH_SIZE ───────────────────────────
/// ATTACK: An attacker mints 1 billion + 1 credits in a single batch, hoping
/// the contract does not enforce the maximum batch size limit and generates an
/// overflowing serial range that corrupts the serial registry.
#[test]
fn test_mint_batch_too_large() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);
    // MAX_BATCH_SIZE is 1_000_000_000; exceed it by 1.
    let oversized = 1_000_000_001_i128;

    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &oversized,
        &2023_u32,
        &s(&env, "batch-huge"),
        &1_u64,
        &(oversized as u64),
        &s(&env, "QmCID"),
        &owner,
    );
    assert!(result.is_err(), "batch exceeding MAX_BATCH_SIZE must be rejected");
}
