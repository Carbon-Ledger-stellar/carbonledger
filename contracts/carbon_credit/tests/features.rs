//! Tests for:
//!   #1001 — Fractional credit minting (2 decimal precision, scaled × 100)
//!   #1012 — Emergency pause mechanism for carbon_credit

#![cfg(test)]

use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient, CarbonError};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn setup(env: &Env) -> (CarbonCreditContractClient<'_>, Address, Address) {
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
    let admin = Address::generate(env);
    let registry = Address::generate(env);
    let id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(env, &id);
    client.initialize(&admin, &registry);
    (client, admin, registry)
}

// ── #1001 Fractional Credits ──────────────────────────────────────────────────

/// 0.5 credits = amount_scaled 50 → fractional balance 50
#[test]
fn test_fractional_mint_half_credit() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    client.fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &50_i128,   // 0.50 credits
        &2023_u32,
        &s(&env, "batch-frac-001"),
        &1_u64,
        &2_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let balance = client.get_fractional_balance(&s(&env, "batch-frac-001"));
    assert_eq!(balance, Some(50_i128));
}

/// 1.75 credits = amount_scaled 175
#[test]
fn test_fractional_mint_one_and_three_quarters() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    client.fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &175_i128,  // 1.75 credits
        &2023_u32,
        &s(&env, "batch-frac-002"),
        &1_u64,
        &3_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let balance = client.get_fractional_balance(&s(&env, "batch-frac-002"));
    assert_eq!(balance, Some(175_i128));
}

/// Whole credits still work through fractional_mint (100 credits = 10000 scaled)
#[test]
fn test_fractional_mint_whole_credits() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    client.fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &10000_i128,    // 100.00 credits
        &2023_u32,
        &s(&env, "batch-frac-003"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let balance = client.get_fractional_balance(&s(&env, "batch-frac-003"));
    assert_eq!(balance, Some(10000_i128));
}

/// Zero amount is not allowed
#[test]
fn test_fractional_mint_zero_amount_fails() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    let result = client.try_fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &0_i128,
        &2023_u32,
        &s(&env, "batch-zero"),
        &1_u64,
        &2_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result, Err(Ok(CarbonError::ZeroAmountNotAllowed)));
}

/// Negative amount is not allowed
#[test]
fn test_fractional_mint_negative_amount_fails() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    let result = client.try_fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &-100_i128,
        &2023_u32,
        &s(&env, "batch-neg"),
        &1_u64,
        &2_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result, Err(Ok(CarbonError::ZeroAmountNotAllowed)));
}

/// Duplicate batch_id is rejected
#[test]
fn test_fractional_mint_duplicate_batch_fails() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    client.fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &50_i128,
        &2023_u32,
        &s(&env, "batch-dup"),
        &1_u64,
        &2_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let result = client.try_fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &50_i128,
        &2023_u32,
        &s(&env, "batch-dup"),  // same batch_id
        &3_u64,
        &4_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result, Err(Ok(CarbonError::SerialNumberConflict)));
}

/// get_fractional_balance returns None for a non-fractional (regular) batch
#[test]
fn test_get_fractional_balance_returns_none_for_regular_batch() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    // Mint via regular mint
    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-regular"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let balance = client.get_fractional_balance(&s(&env, "batch-regular"));
    assert_eq!(balance, None);
}

/// Serial conflict is detected between fractional and regular batches
#[test]
fn test_fractional_mint_serial_conflict_fails() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &10_i128,
        &2023_u32,
        &s(&env, "batch-a"),
        &1_u64,
        &10_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    // Try fractional mint overlapping serials
    let result = client.try_fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &50_i128,
        &2023_u32,
        &s(&env, "batch-b"),
        &5_u64,   // overlaps [1,10]
        &15_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result, Err(Ok(CarbonError::DoubleCountingDetected)));
}

/// Non-admin cannot call fractional_mint
#[test]
fn test_fractional_mint_non_admin_fails() {
    let env = Env::default();
    let (client, _admin, _) = setup(&env);
    let rogue = Address::generate(&env);
    let owner = Address::generate(&env);

    let result = client.try_fractional_mint(
        &rogue,
        &s(&env, "proj-001"),
        &50_i128,
        &2023_u32,
        &s(&env, "batch-auth"),
        &1_u64,
        &2_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert!(result.is_err());
}

// ── #1012 Emergency Pause (carbon_credit) ─────────────────────────────────────

#[test]
fn test_credit_is_paused_initially_false() {
    let env = Env::default();
    let (client, _admin, _) = setup(&env);
    assert!(!client.is_paused());
}

#[test]
fn test_credit_pause_sets_flag() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    client.pause(&admin);
    assert!(client.is_paused());
}

#[test]
fn test_credit_unpause_clears_flag() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    client.pause(&admin);
    client.unpause(&admin);
    assert!(!client.is_paused());
}

#[test]
fn test_mint_credits_rejected_when_paused() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);
    client.pause(&admin);

    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-paused"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result, Err(Ok(CarbonError::EmergencyPaused)));
}

#[test]
fn test_fractional_mint_rejected_when_paused() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);
    client.pause(&admin);

    let result = client.try_fractional_mint(
        &admin,
        &s(&env, "proj-001"),
        &50_i128,
        &2023_u32,
        &s(&env, "batch-frac-paused"),
        &1_u64,
        &2_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result, Err(Ok(CarbonError::EmergencyPaused)));
}

#[test]
fn test_retire_credits_rejected_when_paused() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    // Mint first (before pause)
    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    client.pause(&admin);

    let result = client.try_retire_credits(
        &owner,
        &s(&env, "batch-001"),
        &10_i128,
        &s(&env, "carbon offset"),
        &s(&env, "Corp ABC"),
        &s(&env, "ret-001"),
        &s(&env, "0xtx"),
        &s(&env, "QmCert"),
    );
    assert_eq!(result, Err(Ok(CarbonError::EmergencyPaused)));
}

#[test]
fn test_credit_get_batch_works_when_paused() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    client.pause(&admin);

    // Read-only query must still succeed while paused
    let batch = client.get_credit_batch(&s(&env, "batch-001"));
    assert_eq!(batch.amount, 100_i128);
}

#[test]
fn test_credit_operations_resume_after_unpause() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    let owner = Address::generate(&env);

    client.pause(&admin);
    let result = client.try_mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert_eq!(result, Err(Ok(CarbonError::EmergencyPaused)));

    client.unpause(&admin);

    // Should succeed after unpause
    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    let batch = client.get_credit_batch(&s(&env, "batch-001"));
    assert_eq!(batch.amount, 100_i128);
}

#[test]
fn test_credit_non_admin_cannot_pause() {
    let env = Env::default();
    let (client, _admin, _) = setup(&env);
    let rogue = Address::generate(&env);
    let result = client.try_pause(&rogue);
    assert!(result.is_err());
}

#[test]
fn test_credit_non_admin_cannot_unpause() {
    let env = Env::default();
    let (client, admin, _) = setup(&env);
    client.pause(&admin);
    let rogue = Address::generate(&env);
    let result = client.try_unpause(&rogue);
    assert!(result.is_err());
}
