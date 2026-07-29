//! Event emission verification tests (issue #640).
//!
//! Asserts the exact event topic/data published by every state-mutating
//! `carbon_oracle` function. Schema is documented in
//! `docs/contract-events.md`.

#![cfg(test)]

use carbon_oracle::{CarbonOracleContract, CarbonOracleContractClient};
use carbon_registry::{CarbonRegistryContract, CarbonRegistryContractClient};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _, LedgerInfo},
    vec, Address, BytesN, Bytes, Env, IntoVal, String,
};

const TEST_SIGNING_KEY: [u8; 32] = [42u8; 32];

fn test_signing_key() -> SigningKey {
    SigningKey::from_bytes(&TEST_SIGNING_KEY)
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn ledger_info(timestamp: u64) -> LedgerInfo {
    LedgerInfo {
        timestamp,
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    }
}

/// Single-contract setup (no live registry) for functions that don't
/// cross-call: rotate_oracle, submit_monitoring_data, update_credit_price,
/// flag_project, set_liveness_sla.
fn setup(env: &Env) -> (CarbonOracleContractClient, Address, Address, Address, SigningKey) {
    env.mock_all_auths();
    env.ledger().set(ledger_info(1_735_689_600)); // 2025-01-01
    let signing_key = test_signing_key();
    let pub_key = BytesN::from_array(env, &signing_key.verifying_key().to_bytes());
    let admin = Address::generate(env);
    let oracle = Address::generate(env);
    let registry = Address::generate(env);
    let id = env.register_contract(None, CarbonOracleContract);
    let client = CarbonOracleContractClient::new(env, &id);
    client.initialize(&admin, &oracle, &pub_key, &registry);
    (client, admin, oracle, id, signing_key)
}

fn sign(env: &Env, key: &SigningKey, payload: Bytes) -> BytesN<64> {
    let sig = key.sign(payload.to_alloc_vec().as_slice());
    BytesN::from_array(env, &sig.to_bytes())
}

#[test]
fn test_rotate_oracle_emits_ora_rot_event() {
    let env = Env::default();
    let (client, admin, _oracle, id, _key) = setup(&env);
    let new_oracle = Address::generate(&env);
    let new_key = SigningKey::from_bytes(&[7u8; 32]);
    let new_pub_key = BytesN::from_array(&env, &new_key.verifying_key().to_bytes());

    client.rotate_oracle(&admin, &new_oracle, &new_pub_key);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("ora_rot")).into_val(&env),
                (admin.clone(), new_oracle.clone()).into_val(&env),
            )
        ]
    );
}

#[test]
fn test_submit_monitoring_data_emits_mon_data_event() {
    let env = Env::default();
    let (client, _admin, oracle, id, key) = setup(&env);
    let project_id = s(&env, "proj-001");
    let period = s(&env, "2025-Q1");
    let cid = s(&env, "QmCID");
    let payload = (
        project_id.clone(),
        period.clone(),
        5000_i128,
        85_u32,
        cid.clone(),
    )
        .to_xdr(&env);
    let sig = sign(&env, &key, payload);

    client.submit_monitoring_data(
        &oracle,
        &project_id,
        &period,
        &5000_i128,
        &85_u32,
        &cid,
        &sig,
        &0_u64,
    );

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("mon_data")).into_val(&env),
                (project_id, period, 5000_i128, 85_u32).into_val(&env),
            )
        ]
    );
}

#[test]
fn test_submit_monitoring_data_low_score_emits_extra_low_score_event() {
    let env = Env::default();
    let (client, _admin, oracle, id, key) = setup(&env);
    let project_id = s(&env, "proj-001");
    let period = s(&env, "2025-Q1");
    let cid = s(&env, "QmCID");
    let payload = (
        project_id.clone(),
        period.clone(),
        5000_i128,
        50_u32,
        cid.clone(),
    )
        .to_xdr(&env);
    let sig = sign(&env, &key, payload);

    client.submit_monitoring_data(
        &oracle,
        &project_id,
        &period,
        &5000_i128,
        &50_u32,
        &cid,
        &sig,
        &0_u64,
    );

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("low_score")).into_val(&env),
                (project_id.clone(), 50_u32).into_val(&env),
            ),
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("mon_data")).into_val(&env),
                (project_id, period, 5000_i128, 50_u32).into_val(&env),
            ),
        ]
    );
}

#[test]
fn test_update_credit_price_emits_price_upd_event() {
    let env = Env::default();
    let (client, _admin, oracle, id, key) = setup(&env);
    let methodology = s(&env, "VCS");
    let payload = (methodology.clone(), 2023_u32, 10_0000000_i128).to_xdr(&env);
    let sig = sign(&env, &key, payload);

    client.update_credit_price(&oracle, &methodology, &2023_u32, &10_0000000_i128, &sig, &0_u64);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("price_upd")).into_val(&env),
                (methodology, 2023_u32, 10_0000000_i128).into_val(&env),
            )
        ]
    );
}

#[test]
fn test_flag_project_emits_flagged_event() {
    let env = Env::default();
    let (client, _admin, oracle, id, key) = setup(&env);
    let project_id = s(&env, "proj-001");
    let reason = s(&env, "satellite mismatch");
    let payload = (project_id.clone(), reason.clone()).to_xdr(&env);
    let sig = sign(&env, &key, payload);

    client.flag_project(&oracle, &project_id, &reason, &sig, &0_u64);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("flagged")).into_val(&env),
                (project_id, oracle.clone(), reason).into_val(&env),
            )
        ]
    );
}

#[test]
fn test_set_liveness_sla_emits_sla_upd_event() {
    let env = Env::default();
    let (client, admin, _oracle, id, _key) = setup(&env);

    client.set_liveness_sla(&admin, &(90 * 24 * 60 * 60_u64));

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("sla_upd")).into_val(&env),
                (admin.clone(), 90 * 24 * 60 * 60_u64).into_val(&env),
            )
        ]
    );
}

// ── check_liveness: cross-contract flow ─────────────────────────────────────
// Requires a live registry contract, since a stale check both emits
// `liveness_flag` on the oracle contract AND cross-calls
// `oracle_suspend_project` on the registry (which emits `suspended` there).

fn setup_cross_contract(
    env: &Env,
) -> (
    CarbonOracleContractClient,
    CarbonRegistryContractClient,
    Address, // oracle id
    Address, // registry id
    Address, // admin
    Address, // oracle signer
    SigningKey,
) {
    env.mock_all_auths();
    env.ledger().set(ledger_info(1_735_689_600));

    let signing_key = test_signing_key();
    let pub_key = BytesN::from_array(env, &signing_key.verifying_key().to_bytes());
    let admin = Address::generate(env);
    let oracle = Address::generate(env);
    let verifier = Address::generate(env);

    let oracle_id = env.register_contract(None, CarbonOracleContract);
    let registry_id = env.register_contract(None, CarbonRegistryContract);
    let oracle_client = CarbonOracleContractClient::new(env, &oracle_id);
    let registry_client = CarbonRegistryContractClient::new(env, &registry_id);

    registry_client.initialize(&admin, &oracle_id, &vec![env, verifier]);
    oracle_client.initialize(&admin, &oracle, &pub_key, &registry_id);

    (
        oracle_client,
        registry_client,
        oracle_id,
        registry_id,
        admin,
        oracle,
        signing_key,
    )
}

#[test]
fn test_check_liveness_stale_data_emits_liveness_flag_and_registry_suspended() {
    let env = Env::default();
    let (oracle_client, registry_client, oracle_id, registry_id, admin, _oracle, _key) =
        setup_cross_contract(&env);

    let project_id = s(&env, "proj-stale");
    registry_client.register_project(
        &admin,
        &project_id,
        &s(&env, "Test Project"),
        &s(&env, "QmCID"),
        &Address::generate(&env),
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
        &s(&env, "forestry"),
        &75_u32,
        &2023_u32,
    );

    // No monitoring data was ever submitted, so the project is immediately
    // stale — check_liveness must flag it and suspend it cross-contract.
    oracle_client.check_liveness(&project_id);

    let reason = s(&env, "liveness_sla_breach");
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                registry_id,
                (symbol_short!("c_ledger"), symbol_short!("suspended")).into_val(&env),
                (project_id.clone(), oracle_id.clone(), reason.clone()).into_val(&env),
            ),
            (
                oracle_id,
                (symbol_short!("c_ledger"), symbol_short!("liveness_flag")).into_val(&env),
                (project_id, reason).into_val(&env),
            ),
        ]
    );
}

/// Happy-path flow: rotate_oracle -> set_liveness_sla must emit exactly the
/// two documented events, in order, with nothing extra or missing.
#[test]
fn test_happy_path_emits_exact_event_sequence() {
    let env = Env::default();
    let (client, admin, _oracle, id, _key) = setup(&env);
    let new_oracle = Address::generate(&env);
    let new_key = SigningKey::from_bytes(&[7u8; 32]);
    let new_pub_key = BytesN::from_array(&env, &new_key.verifying_key().to_bytes());

    client.rotate_oracle(&admin, &new_oracle, &new_pub_key);
    client.set_liveness_sla(&admin, &(180 * 24 * 60 * 60_u64));

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("ora_rot")).into_val(&env),
                (admin.clone(), new_oracle).into_val(&env),
            ),
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("sla_upd")).into_val(&env),
                (admin, 180 * 24 * 60 * 60_u64).into_val(&env),
            ),
        ]
    );
}
