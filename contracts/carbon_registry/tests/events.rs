//! Event emission verification tests (issue #640).
//!
//! Asserts the exact event topic/data published by every state-mutating
//! `carbon_registry` function. Schema is documented in
//! `docs/contract-events.md`.
//!
//! `oracle_suspend_project` authenticates via `env.invoker()`, so it can
//! only be exercised end-to-end via a real cross-contract call — see
//! `carbon_oracle`'s `check_liveness` event tests, which cover the resulting
//! `suspended` event on this contract as part of that cross-contract flow.

#![cfg(test)]

use carbon_registry::{CarbonRegistryContract, CarbonRegistryContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, Env, IntoVal, String,
};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn setup(env: &Env) -> (CarbonRegistryContractClient, Address, Address, Address, Address) {
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
    let oracle = Address::generate(env);
    let verifier = Address::generate(env);
    let id = env.register_contract(None, CarbonRegistryContract);
    let client = CarbonRegistryContractClient::new(env, &id);
    client.initialize(&admin, &oracle, &vec![env, verifier.clone()]);
    (client, admin, oracle, verifier, id)
}

fn register(env: &Env, client: &CarbonRegistryContractClient, admin: &Address, project_id: &str) {
    client.register_project(
        admin,
        &s(env, project_id),
        &s(env, "Test Project"),
        &s(env, "QmCID"),
        &Address::generate(env),
        &s(env, "VCS"),
        &s(env, "Brazil"),
        &s(env, "forestry"),
        &75_u32,
        &2023_u32,
    );
}

#[test]
fn test_register_project_emits_reg_proj_event() {
    let env = Env::default();
    let (client, admin, _oracle, _verifier, id) = setup(&env);
    let verifier_addr = Address::generate(&env);

    client.register_project(
        &admin,
        &s(&env, "proj-001"),
        &s(&env, "Test Project"),
        &s(&env, "QmCID"),
        &verifier_addr,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
        &s(&env, "forestry"),
        &75_u32,
        &2023_u32,
    );

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("reg_proj")).into_val(&env),
                (
                    s(&env, "proj-001"),
                    s(&env, "VCS"),
                    s(&env, "Brazil"),
                    2023_u32,
                    75_u32
                )
                    .into_val(&env),
            )
        ]
    );
}

#[test]
fn test_verify_project_emits_verified_event() {
    let env = Env::default();
    let (client, admin, _oracle, verifier, id) = setup(&env);
    register(&env, &client, &admin, "proj-001");

    client.verify_project(&verifier, &s(&env, "proj-001"));

    let all = env.events().all();
    assert_eq!(all.len(), 2, "expected reg_proj + verified events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("verified")).into_val(&env),
            (s(&env, "proj-001"), verifier.clone()).into_val(&env),
        )
    );
}

#[test]
fn test_reject_project_emits_rejected_event() {
    let env = Env::default();
    let (client, admin, _oracle, verifier, id) = setup(&env);
    register(&env, &client, &admin, "proj-001");

    client.reject_project(&verifier, &s(&env, "proj-001"), &s(&env, "incomplete docs"));

    let all = env.events().all();
    assert_eq!(all.len(), 2, "expected reg_proj + rejected events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("rejected")).into_val(&env),
            (
                s(&env, "proj-001"),
                verifier.clone(),
                s(&env, "incomplete docs")
            )
                .into_val(&env),
        )
    );
}

#[test]
fn test_update_project_status_emits_st_update_event() {
    let env = Env::default();
    let (client, admin, oracle, _verifier, id) = setup(&env);
    register(&env, &client, &admin, "proj-001");

    client.update_project_status(
        &oracle,
        &s(&env, "proj-001"),
        &carbon_registry::ProjectStatus::Completed,
    );

    let all = env.events().all();
    assert_eq!(all.len(), 2, "expected reg_proj + st_update events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("st_update")).into_val(&env),
            (s(&env, "proj-001"), oracle.clone()).into_val(&env),
        )
    );
}

#[test]
fn test_suspend_project_emits_suspended_event() {
    let env = Env::default();
    let (client, admin, _oracle, _verifier, id) = setup(&env);
    register(&env, &client, &admin, "proj-001");

    client.suspend_project(&admin, &s(&env, "proj-001"), &s(&env, "fraud investigation"));

    let all = env.events().all();
    assert_eq!(all.len(), 2, "expected reg_proj + suspended events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("suspended")).into_val(&env),
            (
                s(&env, "proj-001"),
                admin.clone(),
                s(&env, "fraud investigation")
            )
                .into_val(&env),
        )
    );
}

#[test]
fn test_retire_credits_emits_retired_event() {
    let env = Env::default();
    let (client, admin, oracle, _verifier, id) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.increment_issued(&oracle, &s(&env, "proj-001"), &100_i128);

    client.retire_credits(&admin, &s(&env, "proj-001"), &40_i128);

    let all = env.events().all();
    assert_eq!(all.len(), 2, "expected reg_proj + retired events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("retired")).into_val(&env),
            (s(&env, "proj-001"), 40_i128).into_val(&env),
        )
    );
}

/// Happy-path flow: register -> verify -> retire must emit exactly the
/// three documented events, in order, with nothing extra or missing.
#[test]
fn test_happy_path_emits_exact_event_sequence() {
    let env = Env::default();
    let (client, admin, oracle, verifier, id) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    client.increment_issued(&oracle, &s(&env, "proj-001"), &100_i128);
    client.retire_credits(&admin, &s(&env, "proj-001"), &30_i128);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("reg_proj")).into_val(&env),
                (
                    s(&env, "proj-001"),
                    s(&env, "VCS"),
                    s(&env, "Brazil"),
                    2023_u32,
                    75_u32
                )
                    .into_val(&env),
            ),
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("verified")).into_val(&env),
                (s(&env, "proj-001"), verifier.clone()).into_val(&env),
            ),
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("retired")).into_val(&env),
                (s(&env, "proj-001"), 30_i128).into_val(&env),
            ),
        ]
    );
}
