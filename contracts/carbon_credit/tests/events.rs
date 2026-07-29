//! Event emission verification tests (issue #640).
//!
//! Every state-mutating function in `carbon_credit` must publish the exact
//! event topic/data documented in `docs/contract-events.md`. Each test below
//! asserts `env.events().all()` equals the *exact* expected event list, which
//! also guarantees no extra or missing events are published in the happy path.

#![cfg(test)]

use carbon_credit::{
    CarbonCreditContract, CarbonCreditContractClient, CreditMintedEvent, CreditRetiredEvent,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, Env, IntoVal, String,
};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn setup(env: &Env) -> (CarbonCreditContractClient, Address, Address, Address) {
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
    // `initialize` publishes no event — events().all() is empty here, so each
    // test below can assert an exact event list without a baseline offset.
    (client, admin, registry, id)
}

#[test]
fn test_mint_credits_emits_minted_event() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
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

    let expected = CreditMintedEvent {
        batch_id: s(&env, "batch-001"),
        project_id: s(&env, "proj-001"),
        admin: admin.clone(),
        amount: 100,
        vintage_year: 2023,
        serial_start: 1,
        serial_end: 100,
        timestamp: env.ledger().timestamp(),
    };

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("minted")).into_val(&env),
                expected.into_val(&env),
            )
        ]
    );
}

#[test]
fn test_retire_credits_emits_retired_event() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
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

    client.retire_credits(
        &owner,
        &s(&env, "batch-001"),
        &40_i128,
        &s(&env, "offset"),
        &s(&env, "beneficiary"),
        &s(&env, "retire-001"),
        &s(&env, "tx-hash"),
        &s(&env, "QmCert"),
    );

    let expected = CreditRetiredEvent {
        retirement_id: s(&env, "retire-001"),
        batch_id: s(&env, "batch-001"),
        project_id: s(&env, "proj-001"),
        amount: 40,
        retired_by: owner.clone(),
        beneficiary: s(&env, "beneficiary"),
        timestamp: env.ledger().timestamp(),
    };

    let all = env.events().all();
    assert_eq!(all.len(), 2, "expected mint + retire events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("retired")).into_val(&env),
            expected.into_val(&env),
        )
    );
}

#[test]
fn test_transfer_credits_emits_transfer_event() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);

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

    client.transfer_credits(&owner, &buyer, &s(&env, "batch-001"), &25_i128);

    let all = env.events().all();
    assert_eq!(all.len(), 2, "expected mint + transfer events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("transfer")).into_val(&env),
            (s(&env, "batch-001"), owner.clone(), buyer.clone(), 25_i128).into_val(&env),
        )
    );
}

/// Happy-path flow: mint -> transfer -> retire must emit exactly the three
/// documented events, in order, with no extras and nothing missing.
#[test]
fn test_happy_path_emits_exact_event_sequence() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);

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
    client.transfer_credits(&owner, &buyer, &s(&env, "batch-001"), &25_i128);
    client.retire_credits(
        &buyer,
        &s(&env, "batch-001"),
        &25_i128,
        &s(&env, "offset"),
        &s(&env, "beneficiary"),
        &s(&env, "retire-001"),
        &s(&env, "tx-hash"),
        &s(&env, "QmCert"),
    );

    let minted = CreditMintedEvent {
        batch_id: s(&env, "batch-001"),
        project_id: s(&env, "proj-001"),
        admin: admin.clone(),
        amount: 100,
        vintage_year: 2023,
        serial_start: 1,
        serial_end: 100,
        timestamp: env.ledger().timestamp(),
    };
    let retired = CreditRetiredEvent {
        retirement_id: s(&env, "retire-001"),
        batch_id: s(&env, "batch-001"),
        project_id: s(&env, "proj-001"),
        amount: 25,
        retired_by: buyer.clone(),
        beneficiary: s(&env, "beneficiary"),
        timestamp: env.ledger().timestamp(),
    };

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("minted")).into_val(&env),
                minted.into_val(&env),
            ),
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("transfer")).into_val(&env),
                (s(&env, "batch-001"), owner.clone(), buyer.clone(), 25_i128).into_val(&env),
            ),
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("retired")).into_val(&env),
                retired.into_val(&env),
            ),
        ]
    );
}
