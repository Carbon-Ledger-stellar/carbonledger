//! Tests for:
//!   #1009 — ProjectStatus enum with Active/Inactive and state transitions
//!   #1012 — Emergency pause mechanism for carbon_registry

#![cfg(test)]

use carbon_registry::{CarbonError, CarbonRegistryContract, CarbonRegistryContractClient, ProjectStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String,
};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn setup(env: &Env) -> (CarbonRegistryContractClient<'_>, Address, Address, Address) {
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
    (client, admin, oracle, verifier)
}

fn register(env: &Env, client: &CarbonRegistryContractClient, admin: &Address, pid: &str) {
    client.register_project(
        admin,
        &s(env, pid),
        &s(env, "Test Project"),
        &s(env, "QmCID"),
        &Address::generate(env),
        &s(env, "VCS"),
        &s(env, "Brazil"),
        &s(env, "forestry"),
        &80_u32,
        &2023_u32,
        &hash(env),
    );
}

// ── #1009 ProjectStatus enum ──────────────────────────────────────────────────

#[test]
fn test_new_project_starts_as_pending() {
    let env = Env::default();
    let (client, admin, _oracle, _verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    let p = client.get_project(&s(&env, "proj-001"));
    assert_eq!(p.status, ProjectStatus::Pending);
}

#[test]
fn test_verify_transitions_pending_to_verified() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    let p = client.get_project(&s(&env, "proj-001"));
    assert_eq!(p.status, ProjectStatus::Verified);
}

#[test]
fn test_verify_already_verified_fails_invalid_transition() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    // Can't verify again — already Verified
    let result = client.try_verify_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(result, Err(Ok(CarbonError::InvalidStatusTransition)));
}

#[test]
fn test_reject_transitions_pending_to_rejected() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.reject_project(&verifier, &s(&env, "proj-001"), &s(&env, "fraud"));
    let p = client.get_project(&s(&env, "proj-001"));
    assert_eq!(p.status, ProjectStatus::Rejected);
}

#[test]
fn test_reject_already_verified_fails_invalid_transition() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    // Can't reject a verified project
    let result = client.try_reject_project(&verifier, &s(&env, "proj-001"), &s(&env, "oops"));
    assert_eq!(result, Err(Ok(CarbonError::InvalidStatusTransition)));
}

#[test]
fn test_activate_transitions_verified_to_active() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    client.activate_project(&verifier, &s(&env, "proj-001"));
    let p = client.get_project(&s(&env, "proj-001"));
    assert_eq!(p.status, ProjectStatus::Active);
}

#[test]
fn test_activate_pending_project_fails() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    // Can't activate a Pending project
    let result = client.try_activate_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(result, Err(Ok(CarbonError::InvalidStatusTransition)));
}

#[test]
fn test_deactivate_transitions_active_to_inactive() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    client.activate_project(&verifier, &s(&env, "proj-001"));
    client.deactivate_project(&verifier, &s(&env, "proj-001"));
    let p = client.get_project(&s(&env, "proj-001"));
    assert_eq!(p.status, ProjectStatus::Inactive);
}

#[test]
fn test_deactivate_verified_project_fails() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    // Can't deactivate from Verified — must first activate
    let result = client.try_deactivate_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(result, Err(Ok(CarbonError::InvalidStatusTransition)));
}

#[test]
fn test_reactivate_inactive_project() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    client.activate_project(&verifier, &s(&env, "proj-001"));
    client.deactivate_project(&verifier, &s(&env, "proj-001"));
    // Re-activate from Inactive
    client.activate_project(&verifier, &s(&env, "proj-001"));
    let p = client.get_project(&s(&env, "proj-001"));
    assert_eq!(p.status, ProjectStatus::Active);
}

#[test]
fn test_full_transition_chain_pending_verified_active_inactive_active() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");

    let p = client.get_project(&s(&env, "proj-001"));
    assert_eq!(p.status, ProjectStatus::Pending);

    client.verify_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(client.get_project(&s(&env, "proj-001")).status, ProjectStatus::Verified);

    client.activate_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(client.get_project(&s(&env, "proj-001")).status, ProjectStatus::Active);

    client.deactivate_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(client.get_project(&s(&env, "proj-001")).status, ProjectStatus::Inactive);

    client.activate_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(client.get_project(&s(&env, "proj-001")).status, ProjectStatus::Active);
}

#[test]
fn test_non_verifier_cannot_activate() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));

    let rogue = Address::generate(&env);
    let result = client.try_activate_project(&rogue, &s(&env, "proj-001"));
    assert!(result.is_err());
}

// ── #1012 Emergency Pause (registry) ──────────────────────────────────────────

#[test]
fn test_is_paused_initially_false() {
    let env = Env::default();
    let (client, _admin, _oracle, _verifier) = setup(&env);
    assert!(!client.is_paused());
}

#[test]
fn test_pause_sets_paused_flag() {
    let env = Env::default();
    let (client, admin, _oracle, _verifier) = setup(&env);
    client.pause(&admin);
    assert!(client.is_paused());
}

#[test]
fn test_unpause_clears_paused_flag() {
    let env = Env::default();
    let (client, admin, _oracle, _verifier) = setup(&env);
    client.pause(&admin);
    client.unpause(&admin);
    assert!(!client.is_paused());
}

#[test]
fn test_register_project_rejected_when_paused() {
    let env = Env::default();
    let (client, admin, _oracle, _verifier) = setup(&env);
    client.pause(&admin);

    let result = client.try_register_project(
        &admin,
        &s(&env, "proj-001"),
        &s(&env, "Test"),
        &s(&env, "QmCID"),
        &Address::generate(&env),
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
        &s(&env, "forestry"),
        &80_u32,
        &2023_u32,
        &hash(&env),
    );
    assert_eq!(result, Err(Ok(CarbonError::EmergencyPaused)));
}

#[test]
fn test_verify_project_rejected_when_paused() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.pause(&admin);

    let result = client.try_verify_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(result, Err(Ok(CarbonError::EmergencyPaused)));
}

#[test]
fn test_activate_rejected_when_paused() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.verify_project(&verifier, &s(&env, "proj-001"));
    client.pause(&admin);

    let result = client.try_activate_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(result, Err(Ok(CarbonError::EmergencyPaused)));
}

#[test]
fn test_get_project_works_when_paused() {
    let env = Env::default();
    let (client, admin, _oracle, _verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");
    client.pause(&admin);

    // Query functions are unaffected by pause
    let p = client.get_project(&s(&env, "proj-001"));
    assert_eq!(p.status, ProjectStatus::Pending);
}

#[test]
fn test_state_mutations_resume_after_unpause() {
    let env = Env::default();
    let (client, admin, _oracle, verifier) = setup(&env);
    register(&env, &client, &admin, "proj-001");

    client.pause(&admin);
    let result = client.try_verify_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(result, Err(Ok(CarbonError::EmergencyPaused)));

    client.unpause(&admin);
    client.verify_project(&verifier, &s(&env, "proj-001"));
    assert_eq!(
        client.get_project(&s(&env, "proj-001")).status,
        ProjectStatus::Verified
    );
}

#[test]
fn test_non_admin_cannot_pause() {
    let env = Env::default();
    let (client, _admin, _oracle, _verifier) = setup(&env);
    let rogue = Address::generate(&env);
    let result = client.try_pause(&rogue);
    assert!(result.is_err());
}

#[test]
fn test_non_admin_cannot_unpause() {
    let env = Env::default();
    let (client, admin, _oracle, _verifier) = setup(&env);
    client.pause(&admin);
    let rogue = Address::generate(&env);
    let result = client.try_unpause(&rogue);
    assert!(result.is_err());
}
