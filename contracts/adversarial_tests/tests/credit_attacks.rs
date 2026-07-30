//! # Credit Contract Attack Scenarios — carbon_credit contract
//!
//! | Test | Attack narrative | Expected error |
//! |------|------------------|----------------|
//! | test_mint_unverified_project         | Mint from non-admin (real-world: unverified project) | auth error |
//! | test_mint_zero_amount                | amount = 0 to bypass ledger fee / pollute serial registry | ZeroAmountNotAllowed (16) |
//! | test_mint_negative_amount            | amount = -1 for integer wrap-around | ZeroAmountNotAllowed (16) |
//! | test_mint_future_vintage             | vintage_year = 3000 (future fraud) | InvalidVintageYear (9) |
//! | test_duplicate_batch_id              | Reuse existing batch_id for double-issue | SerialNumberConflict (6) |
//! | test_overlapping_serial_ranges       | Overlapping serials = double-counting fraud | DoubleCountingDetected (14) |
//! | test_retire_more_than_owned          | Retire 150 from 100-credit batch | InsufficientCredits (4) |
//! | test_retire_fully_retired_batch      | Retire fully-retired batch a second time | AlreadyRetired (5) |
//! | test_retire_already_retired_id       | Attempt to undo a completed retirement | RetirementIrreversible (15) |
//! | test_invalid_serial_range            | serial_start > serial_end (inverted range) | InvalidSerialRange (18) |
//! | test_serial_start_zero               | serial_start = 0 (zero sentinel abuse) | InvalidSerialRange (18) |
//! | test_transfer_retired_batch          | Transfer fully-retired batch to re-sell | AlreadyRetired (5) |
//! | test_transfer_from_non_owner         | Steal credits from another account | UnauthorizedVerifier (7) |
//! | test_retire_after_partial_over_limit | Retire more than remaining after partial | InsufficientCredits (4) |
//! | test_mint_batch_too_large            | Mint 1 billion + 1 credits in one batch | BatchTooLarge |

use soroban_sdk::{testutils::Address as _, Address, Env};
use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient, CarbonError};

use crate::helpers::s;

fn setup_credit(env: &Env) -> (CarbonCreditContractClient, Address) {
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_735_689_600,
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    });
    let admin    = Address::generate(env);
    let registry = Address::generate(env);
    let id       = env.register_contract(None, CarbonCreditContract);
    let client   = CarbonCreditContractClient::new(env, &id);
    client.initialize(&admin, &registry).unwrap();
    (client, admin)
}

fn mint_batch(
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

// ── Attack 1: mint for unverified project (non-admin call) ────────────────────
/// ATTACK: A project developer who is not the contract admin calls mint_credits()
/// immediately after registration, before the verifier has approved the project.
/// In production the registry cross-call rejects ProjectNotVerified; here we
/// confirm the contract enforces admin-only access as the first gate.
#[test]
fn test_mint_unverified_project() {
    let env = Env::default();
    let (client, _admin) = setup_credit(&env);
    let attacker = Address::generate(&env);
    let owner    = Address::generate(&env);

    let result = client.try_mint_credits(
        &attacker,
        &s(&env, "unverified-proj"),
        &100_i128, &2023_u32,
        &s(&env, "batch-unverified"),
        &1_u64, &100_u64,
        &s(&env, "QmCID"), &owner,
    );
    assert!(result.is_err(), "minting from a non-admin must be rejected");
}

// ── Attack 2: mint zero amount ────────────────────────────────────────────────
/// ATTACK: Attacker submits amount = 0 to create an empty batch record,
/// polluting the serial registry or confusing the marketplace.
#[test]
fn test_mint_zero_amount() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-001"), &0_i128, &2023_u32,
        &s(&env, "batch-zero"), &1_u64, &100_u64,
        &s(&env, "QmCID"), &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ZeroAmountNotAllowed);
}

// ── Attack 3: mint negative amount ───────────────────────────────────────────
/// ATTACK: Attacker passes amount = -1 hoping for integer wrap-around to create
/// a credit batch that represents a negative balance (debt).
#[test]
fn test_mint_negative_amount() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-001"), &-1_i128, &2023_u32,
        &s(&env, "batch-neg"), &1_u64, &100_u64,
        &s(&env, "QmCID"), &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ZeroAmountNotAllowed);
}

// ── Valid vintage-year mint ────────────────────────────────────────────────
#[test]
fn test_mint_valid_vintage() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-001"), &100_i128, &2023_u32,
        &s(&env, "batch-valid"), &1_u64, &100_u64,
        &s(&env, "QmCID"), &owner,
    );
    assert!(result.is_ok(), "valid vintage years should be accepted");
}

// ── Too-old vintage-year mint ──────────────────────────────────────────────
#[test]
fn test_mint_too_old_vintage() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-001"), &100_i128, &1989_u32,
        &s(&env, "batch-old"), &1_u64, &100_u64,
        &s(&env, "QmCID"), &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
}

// ── Attack 4: mint with vintage_year = 3000 ───────────────────────────────────
/// ATTACK: Attacker mints credits with vintage_year = 3000 to create credits for
/// carbon that will supposedly be offset in the far future, selling them today.
#[test]
fn test_mint_future_vintage() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-001"), &100_i128, &3000_u32,
        &s(&env, "batch-future"), &1_u64, &100_u64,
        &s(&env, "QmCID"), &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
}

// ── Attack 5: duplicate batch ID ─────────────────────────────────────────────
/// ATTACK: After minting batch A, the attacker resubmits the same batch_id to
/// double-issue credits for the same underlying offset event.
#[test]
fn test_duplicate_batch_id() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_batch(&env, &client, &admin, "batch-dup", &owner, 1, 100, 100);

    // Same batch_id, different serial range — must be SerialNumberConflict.
    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-002"), &100_i128, &2023_u32,
        &s(&env, "batch-dup"), &201_u64, &300_u64,
        &s(&env, "QmCID2"), &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::SerialNumberConflict);
}

// ── Attack 6: overlapping serial ranges (double-counting fraud) ───────────────
/// ATTACK: After minting batch A with serials 1–100, attacker mints batch B with
/// serials 50–150, claiming the same tonne of CO2 twice — the core double-counting
/// fraud vector in voluntary carbon markets.
#[test]
fn test_overlapping_serial_ranges() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_batch(&env, &client, &admin, "batch-A", &owner, 1, 100, 100);

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-002"), &101_i128, &2023_u32,
        &s(&env, "batch-B"), &50_u64, &150_u64,
        &s(&env, "QmCID2"), &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::DoubleCountingDetected);
}

// ── Attack 7: retire more credits than the batch contains ────────────────────
/// ATTACK: A holder tries to retire 150 credits from a 100-credit batch, hoping
/// the contract does not validate the balance and simply burns any number.
#[test]
fn test_retire_more_than_owned() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_batch(&env, &client, &admin, "batch-over", &owner, 1, 100, 100);

    let result = client.try_retire_credits(
        &owner, &s(&env, "batch-over"), &150_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-over"), &s(&env, "tx"), &s(&env, "QmCID"),
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

    mint_batch(&env, &client, &admin, "batch-full", &owner, 1, 100, 100);

    client.retire_credits(
        &owner, &s(&env, "batch-full"), &100_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-001"), &s(&env, "tx"), &s(&env, "QmCID"),
    ).unwrap();

    let result = client.try_retire_credits(
        &owner, &s(&env, "batch-full"), &1_i128,
        &s(&env, "offset2"), &s(&env, "Corp"),
        &s(&env, "ret-002"), &s(&env, "tx2"), &s(&env, "QmCID2"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::AlreadyRetired);
}

// ── Attack 9: attempt to reverse a completed retirement ──────────────────────
/// ATTACK: An attacker (or corrupt admin) calls undo_retire() on a completed
/// retirement certificate, attempting to recycle already-retired credits and
/// re-sell them — the most severe fraud vector in carbon markets.
#[test]
fn test_retire_already_retired_id() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_batch(&env, &client, &admin, "batch-rev", &owner, 1, 100, 100);

    client.retire_credits(
        &owner, &s(&env, "batch-rev"), &100_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-rev"), &s(&env, "tx"), &s(&env, "QmCID"),
    ).unwrap();

    let result = client.try_undo_retire(&admin, &s(&env, "ret-rev"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::RetirementIrreversible);
}

// ── Attack 10: inverted serial range ─────────────────────────────────────────
/// ATTACK: Attacker submits serial_start = 500, serial_end = 100 (inverted),
/// hoping to confuse the range-checking logic and bypass double-counting guards.
#[test]
fn test_invalid_serial_range() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-001"), &100_i128, &2023_u32,
        &s(&env, "batch-inv"), &500_u64, &100_u64, // start > end
        &s(&env, "QmCID"), &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidSerialRange);
}

// ── Attack 11: serial_start = 0 ──────────────────────────────────────────────
/// ATTACK: Attacker uses serial_start = 0 (reserved sentinel value), hoping it
/// underflows arithmetic or bypasses the bounds check in the serial registry.
#[test]
fn test_serial_start_zero() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-001"), &100_i128, &2023_u32,
        &s(&env, "batch-zero-serial"), &0_u64, &100_u64, // zero start
        &s(&env, "QmCID"), &owner,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidSerialRange);
}

// ── Attack 12: transfer a fully-retired batch ─────────────────────────────────
/// ATTACK: After retiring all credits in a batch, the attacker attempts to
/// transfer the same batch to a fresh wallet to re-sell the retired credits.
#[test]
fn test_transfer_retired_batch() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);

    mint_batch(&env, &client, &admin, "batch-retired-tx", &owner, 1, 100, 100);

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
/// ATTACK: An attacker who does NOT own a batch calls transfer_credits() to steal
/// credits and sell them on a secondary market without the owner's consent.
#[test]
fn test_transfer_from_non_owner() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner    = Address::generate(&env);
    let attacker = Address::generate(&env);
    let victim   = Address::generate(&env);

    mint_batch(&env, &client, &admin, "batch-steal", &owner, 1, 100, 100);

    let result = client.try_transfer_credits(
        &attacker, &victim, &s(&env, "batch-steal"), &100_i128,
    );
    assert!(result.is_err(), "transfer from non-owner must fail");
}

// ── Attack 14: retire more than remaining after partial retirement ────────────
/// ATTACK: After retiring 60 of 100 credits, the attacker attempts to retire 50
/// more (only 40 remain), hoping the contract does not track the running retired
/// total correctly.
#[test]
fn test_retire_after_partial_over_limit() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    mint_batch(&env, &client, &admin, "batch-partial", &owner, 1, 100, 100);

    client.retire_credits(
        &owner, &s(&env, "batch-partial"), &60_i128,
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-p1"), &s(&env, "tx"), &s(&env, "QmCID"),
    ).unwrap();

    let result = client.try_retire_credits(
        &owner, &s(&env, "batch-partial"), &50_i128, // only 40 remain
        &s(&env, "offset"), &s(&env, "Corp"),
        &s(&env, "ret-p2"), &s(&env, "tx2"), &s(&env, "QmCID2"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InsufficientCredits);
}

// ── Attack 15: batch exceeding MAX_BATCH_SIZE ─────────────────────────────────
/// ATTACK: Attacker mints 1 billion + 1 credits in a single batch, hoping the
/// contract does not enforce the maximum batch size limit, generating a serial
/// range so wide it would overflow the registry's range-check arithmetic.
#[test]
fn test_mint_batch_too_large() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner     = Address::generate(&env);
    let oversized = 1_000_000_001_i128; // MAX_BATCH_SIZE + 1

    let result = client.try_mint_credits(
        &admin, &s(&env, "proj-001"), &oversized, &2023_u32,
        &s(&env, "batch-huge"), &1_u64, &(oversized as u64),
        &s(&env, "QmCID"), &owner,
    );
    assert!(result.is_err(), "batch exceeding MAX_BATCH_SIZE must be rejected");
}
