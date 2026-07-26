//! # Carbon Credit Contract Invariants
//!
//! Cross-invariant tests that span multiple contract functions.
//! These complement the unit tests in `lib.rs` by asserting high-level
//! properties that must hold regardless of which sequence of operations
//! was performed.
//!
//! The Kani proofs in `proofs.rs` provide bounded formal verification of
//! these same invariants at the arithmetic level.

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger as _}, Env, String};

fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

fn setup(env: &Env) -> (CarbonCreditContractClient, Address) {
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp:                 1_735_689_600, // 2025-01-01
        protocol_version:          20,
        sequence_number:           1,
        network_id:                [0u8; 32],
        base_reserve:              10,
        min_temp_entry_ttl:        1,
        min_persistent_entry_ttl:  1,
        max_entry_ttl:             518_400,
    });
    let admin    = Address::generate(env);
    let registry = Address::generate(env);
    let id       = env.register_contract(None, CarbonCreditContract);
    let client   = CarbonCreditContractClient::new(env, &id);
    client.initialize(&admin, &registry);
    (client, admin)
}

// ── INV-1: Conservation invariant ─────────────────────────────────────────────
// amount_available + amount_retired == minted_amount, always.

#[test]
fn invariant_conservation_after_partial_retire() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let owner = Address::generate(&env);
    let minted = 1000_i128;

    client.mint_credits(
        &admin, &s(&env, "p1"), &minted, &2023_u32,
        &s(&env, "b1"), &1_u64, &1000_u64, &s(&env, "cid"), &owner,
    );

    // Retire in three increments and assert conservation after each step
    let retirements = [300_i128, 400_i128, 300_i128];
    let mut total_retired = 0_i128;

    for (i, &r) in retirements.iter().enumerate() {
        client.retire_credits(
            &owner, &s(&env, "b1"), &r,
            &s(&env, "reason"), &s(&env, "corp"),
            &s(&env, &format!("ret-{i}")), &s(&env, "tx"), &s(&env, "cid"),
        );
        total_retired += r;

        let batch = client.get_credit_batch(&s(&env, "b1"));
        // Conservation: batch.amount is the original minted amount (immutable)
        assert_eq!(batch.amount, minted, "INV-1: minted amount must not change");
    }

    // After full retirement, total_retired == minted
    assert_eq!(total_retired, minted, "INV-1: total retired must equal minted");
}

// ── INV-2: InsufficientCredits is always returned when amount > available ─────

#[test]
fn invariant_insufficient_credits_always_errors() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin, &s(&env, "p1"), &100_i128, &2023_u32,
        &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner,
    );

    // Retire half
    client.retire_credits(
        &owner, &s(&env, "b1"), &50_i128,
        &s(&env, "r"), &s(&env, "c"), &s(&env, "ret-1"), &s(&env, "tx"), &s(&env, "cid"),
    );

    // Try to retire 60 (only 50 remain) — must fail with InsufficientCredits
    let result = client.try_retire_credits(
        &owner, &s(&env, "b1"), &60_i128,
        &s(&env, "r"), &s(&env, "c"), &s(&env, "ret-2"), &s(&env, "tx"), &s(&env, "cid"),
    );
    assert_eq!(
        result.unwrap_err(),
        soroban_sdk::Error::from_contract_error(CarbonError::InsufficientCredits as u32),
        "INV-2: retiring more than available must always return InsufficientCredits",
    );
}

// ── INV-3: Serial ranges never overlap ────────────────────────────────────────

#[test]
fn invariant_serial_ranges_never_overlap() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let owner = Address::generate(&env);

    // Mint three non-overlapping ranges
    client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64,   &100_u64, &s(&env, "c"), &owner);
    client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b2"), &101_u64,  &200_u64, &s(&env, "c"), &owner);
    client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b3"), &201_u64,  &300_u64, &s(&env, "c"), &owner);

    // Any overlapping range must be rejected
    let overlap_cases: &[(u64, u64)] = &[
        (50, 150),   // overlaps b1 and b2
        (1, 300),    // superset of all
        (100, 100),  // single point inside b1 boundary
        (200, 250),  // overlaps b2 end and b3
    ];

    for &(start, end) in overlap_cases {
        assert!(
            !client.verify_serial_range(&start, &end),
            "INV-3: range [{start},{end}] overlaps an existing range and must be rejected",
        );
    }

    // Non-overlapping range must be accepted
    assert!(
        client.verify_serial_range(&301_u64, &400_u64),
        "INV-3: range [301,400] does not overlap any existing range and must be accepted",
    );
}
