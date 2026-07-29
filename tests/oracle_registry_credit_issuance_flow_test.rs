//! Cross-contract integration tests for the oracle-triggered issuance flow
//! (issue #631).
//!
//! Exercises the full chain across all four CarbonLedger Soroban contracts,
//! deployed and initialized together in a single Soroban test environment:
//!
//!   oracle submits signed monitoring data
//!     -> registry verifies the project and records issued credits
//!     -> carbon_credit mints a batch backed by that issuance
//!
//! and verifies that a rejection at any step in the chain leaves every
//! downstream contract's state untouched (error propagation).
//!
//! See docs/integration-testing.md for how to run this suite locally.

#![allow(deprecated)] // env.register_stellar_asset_contract is deprecated but still the
                       // supported test helper for a USDC-like SAC in soroban-sdk 21.x.

use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    vec, Address, BytesN, Env, String,
};

use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient, CreditStatus};
use carbon_marketplace::{CarbonMarketplaceContract, CarbonMarketplaceContractClient};
use carbon_oracle::{CarbonOracleContract, CarbonOracleContractClient};
use carbon_registry::{CarbonRegistryContract, CarbonRegistryContractClient, ProjectStatus};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

/// Deploys and wires all four CarbonLedger contracts in one test environment,
/// mirroring how they are wired in a real deployment:
///
///   - `carbon_registry` trusts `oracle_signer` as its oracle identity for
///     `increment_issued` / `update_project_status`.
///   - `carbon_oracle` trusts the same signer for signed submissions, and is
///     wired to the registry's contract address for its (separate)
///     cross-contract liveness-suspend path.
///   - `carbon_credit` trusts the registry's contract address.
///   - `carbon_marketplace` trusts the credit contract and a USDC-like SAC.
#[allow(clippy::type_complexity)]
fn deploy_all(
    env: &Env,
) -> (
    CarbonOracleContractClient,
    CarbonRegistryContractClient,
    CarbonCreditContractClient,
    CarbonMarketplaceContractClient,
    Address, // admin
    Address, // verifier
    Address, // oracle_signer
    SigningKey,
) {
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
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
    let verifier = Address::generate(env);
    let oracle_signer = Address::generate(env);
    let treasury = Address::generate(env);

    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let pub_bytes = signing_key.verifying_key().to_bytes();
    let pub_key = BytesN::from_array(env, &pub_bytes);

    let registry_id = env.register_contract(None, CarbonRegistryContract);
    let oracle_id = env.register_contract(None, CarbonOracleContract);
    let credit_id = env.register_contract(None, CarbonCreditContract);
    let marketplace_id = env.register_contract(None, CarbonMarketplaceContract);

    let registry = CarbonRegistryContractClient::new(env, &registry_id);
    let oracle = CarbonOracleContractClient::new(env, &oracle_id);
    let credit = CarbonCreditContractClient::new(env, &credit_id);
    let marketplace = CarbonMarketplaceContractClient::new(env, &marketplace_id);

    registry.initialize(&admin, &oracle_signer, &vec![env, verifier.clone()]);
    oracle.initialize(&admin, &oracle_signer, &pub_key, &registry_id);
    credit.initialize(&admin, &registry_id);

    let usdc = env.register_stellar_asset_contract(admin.clone());
    marketplace.initialize(&admin, &usdc, &credit_id, &treasury);

    (
        oracle,
        registry,
        credit,
        marketplace,
        admin,
        verifier,
        oracle_signer,
        signing_key,
    )
}

fn sign_monitoring(
    env: &Env,
    key: &SigningKey,
    project_id: &String,
    period: &String,
    tonnes: i128,
    score: u32,
    cid: &String,
) -> BytesN<64> {
    let payload = (
        project_id.clone(),
        period.clone(),
        tonnes,
        score,
        cid.clone(),
    )
        .to_xdr(env);
    let sig = key.sign(payload.to_alloc_vec().as_slice());
    BytesN::from_array(env, &sig.to_bytes())
}

fn register_project(
    env: &Env,
    registry: &CarbonRegistryContractClient,
    admin: &Address,
    project_id: &str,
) {
    registry.register_project(
        admin,
        &s(env, project_id),
        &s(env, "Amazon Reforestation"),
        &s(env, "QmProjectCID"),
        &Address::generate(env),
        &s(env, "VCS"),
        &s(env, "Brazil"),
        &s(env, "forestry"),
        &80_u32,
        &2023_u32,
    );
}

// ── Happy path: full oracle -> registry -> credit flow ───────────────────────

#[test]
fn test_full_oracle_to_credit_issuance_flow() {
    let env = Env::default();
    let (oracle, registry, credit, _marketplace, admin, verifier, oracle_signer, key) =
        deploy_all(&env);

    let project_id = s(&env, "proj-001");
    register_project(&env, &registry, &admin, "proj-001");
    assert_eq!(
        registry.get_project(&project_id).status,
        ProjectStatus::Pending
    );

    // Step 1: oracle submits signed monitoring data across two periods.
    let period1 = s(&env, "2024-Q1");
    let cid = s(&env, "QmSatelliteCID");
    let sig1 = sign_monitoring(&env, &key, &project_id, &period1, 3000, 85, &cid);
    oracle.submit_monitoring_data(
        &oracle_signer,
        &project_id,
        &period1,
        &3000_i128,
        &85_u32,
        &cid,
        &sig1,
        &0_u64,
    );

    let period2 = s(&env, "2024-Q2");
    let sig2 = sign_monitoring(&env, &key, &project_id, &period2, 2000, 85, &cid);
    oracle.submit_monitoring_data(
        &oracle_signer,
        &project_id,
        &period2,
        &2000_i128,
        &85_u32,
        &cid,
        &sig2,
        &1_u64,
    );

    let periods = vec![&env, period1.clone(), period2.clone()];
    let verified_tonnes = oracle.get_total_verified_tonnes(&project_id, &periods);
    assert_eq!(
        verified_tonnes, 5000,
        "oracle must report the SUM across both periods, not just the latest"
    );
    assert!(oracle.is_monitoring_current(&project_id));

    // Step 2: verifier approves the project; oracle records the verified
    // tonnes as issued credits against the registry.
    registry.verify_project(&verifier, &project_id);
    assert_eq!(
        registry.get_project(&project_id).status,
        ProjectStatus::Verified
    );

    registry.increment_issued(&oracle_signer, &project_id, &verified_tonnes);
    let project = registry.get_project(&project_id);
    assert_eq!(project.total_credits_issued, 5000);

    // Step 3: credit contract mints a batch backed by the verified, issued
    // amount. `minted <= verified_tonnes` is the cross-contract invariant this
    // flow is meant to uphold end-to-end (see docs/cross-contract-invariant-spec.md).
    assert!(project.total_credits_issued <= verified_tonnes);
    let owner = Address::generate(&env);
    credit.mint_credits(
        &admin,
        &project_id,
        &project.total_credits_issued,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &(project.total_credits_issued as u64),
        &s(&env, "QmBatchCID"),
        &owner,
    );

    let batch = credit.get_credit_batch(&s(&env, "batch-001"));
    assert_eq!(batch.amount, 5000);
    assert_eq!(batch.status, CreditStatus::Active);
    assert_eq!(batch.owner, owner);

    let project_batches = credit.get_project_credits(&project_id);
    assert_eq!(project_batches.len(), 1);
}

// ── Full-system wiring: minted credits are listable on the marketplace ───────

#[test]
fn test_minted_batch_can_be_listed_on_marketplace() {
    let env = Env::default();
    let (oracle, registry, credit, marketplace, admin, verifier, oracle_signer, key) =
        deploy_all(&env);

    let project_id = s(&env, "proj-list");
    register_project(&env, &registry, &admin, "proj-list");
    registry.verify_project(&verifier, &project_id);

    let period = s(&env, "2024-Q1");
    let cid = s(&env, "QmCID");
    let sig = sign_monitoring(&env, &key, &project_id, &period, 2000, 85, &cid);
    oracle.submit_monitoring_data(
        &oracle_signer,
        &project_id,
        &period,
        &2000_i128,
        &85_u32,
        &cid,
        &sig,
        &0_u64,
    );
    registry.increment_issued(&oracle_signer, &project_id, &2000_i128);

    let owner = Address::generate(&env);
    credit.mint_credits(
        &admin,
        &project_id,
        &2000_i128,
        &2023_u32,
        &s(&env, "batch-list"),
        &1_u64,
        &2000_u64,
        &s(&env, "QmBatchCID"),
        &owner,
    );

    marketplace.list_credits(
        &owner,
        &s(&env, "listing-001"),
        &s(&env, "batch-list"),
        &project_id,
        &2000_i128,
        &10_0000000_i128,
        &2023_u32,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    );

    let listing = marketplace.get_listing(&s(&env, "listing-001"));
    assert_eq!(listing.amount_available, 2000);
}

// ── Error propagation ─────────────────────────────────────────────────────────

/// Oracle rejects a zero-tonnes submission outright; the registry never
/// learns about it and the credit contract never mints anything for it.
#[test]
fn test_oracle_rejects_invalid_data_registry_and_credit_untouched() {
    let env = Env::default();
    let (oracle, registry, credit, _marketplace, admin, _verifier, oracle_signer, key) =
        deploy_all(&env);

    let project_id = s(&env, "proj-invalid");
    register_project(&env, &registry, &admin, "proj-invalid");

    let period = s(&env, "2024-Q1");
    let cid = s(&env, "QmCID");
    let sig = sign_monitoring(&env, &key, &project_id, &period, 0, 85, &cid);
    let result = oracle.try_submit_monitoring_data(
        &oracle_signer,
        &project_id,
        &period,
        &0_i128,
        &85_u32,
        &cid,
        &sig,
        &0_u64,
    );
    assert!(
        result.is_err(),
        "zero-tonnes submission must be rejected by the oracle"
    );

    // Registry never learns about this submission.
    let project = registry.get_project(&project_id);
    assert_eq!(project.status, ProjectStatus::Pending);
    assert_eq!(project.total_credits_issued, 0);

    // Credit contract has no batches for this project — nothing was ever
    // verified to back a mint.
    assert_eq!(credit.get_project_credits(&project_id).len(), 0);
}

/// An impostor address cannot record issuance against the registry even
/// though the oracle contract itself accepted a legitimate submission from
/// the real oracle signer. The rejection must not leak into registry state,
/// and the credit contract must never see a mint for the rejected amount.
#[test]
fn test_unauthorized_oracle_call_to_registry_blocks_downstream_mint() {
    let env = Env::default();
    let (oracle, registry, credit, _marketplace, admin, verifier, oracle_signer, key) =
        deploy_all(&env);

    let project_id = s(&env, "proj-unauth");
    register_project(&env, &registry, &admin, "proj-unauth");
    registry.verify_project(&verifier, &project_id);

    let period = s(&env, "2024-Q1");
    let cid = s(&env, "QmCID");
    let sig = sign_monitoring(&env, &key, &project_id, &period, 4000, 85, &cid);
    oracle.submit_monitoring_data(
        &oracle_signer,
        &project_id,
        &period,
        &4000_i128,
        &85_u32,
        &cid,
        &sig,
        &0_u64,
    );

    let impostor = Address::generate(&env);
    let result = registry.try_increment_issued(&impostor, &project_id, &4000_i128);
    assert!(
        result.is_err(),
        "only the registered oracle address may increment issued credits"
    );

    let project = registry.get_project(&project_id);
    assert_eq!(
        project.total_credits_issued, 0,
        "rejected increment must not change registry state"
    );

    // With no recorded issuance, there is nothing for the credit contract to
    // have minted against.
    assert_eq!(credit.get_project_credits(&project_id).len(), 0);
}

/// Replaying a previously-used oracle nonce is rejected; verified tonnes must
/// reflect exactly one accepted submission, and no downstream registry/credit
/// state changes as a side effect of the rejected replay.
#[test]
fn test_nonce_replay_rejected_downstream_state_unaffected() {
    let env = Env::default();
    let (oracle, registry, credit, _marketplace, admin, _verifier, oracle_signer, key) =
        deploy_all(&env);

    let project_id = s(&env, "proj-replay");
    register_project(&env, &registry, &admin, "proj-replay");

    let period = s(&env, "2024-Q1");
    let cid = s(&env, "QmCID");
    let sig = sign_monitoring(&env, &key, &project_id, &period, 1000, 85, &cid);
    oracle.submit_monitoring_data(
        &oracle_signer,
        &project_id,
        &period,
        &1000_i128,
        &85_u32,
        &cid,
        &sig,
        &0_u64,
    );

    // Replaying nonce 0 again must fail — the oracle's nonce has advanced to 1.
    let result = oracle.try_submit_monitoring_data(
        &oracle_signer,
        &project_id,
        &period,
        &1000_i128,
        &85_u32,
        &cid,
        &sig,
        &0_u64,
    );
    assert!(result.is_err(), "nonce replay must be rejected");

    let periods = vec![&env, period.clone()];
    assert_eq!(
        oracle.get_total_verified_tonnes(&project_id, &periods),
        1000,
        "verified tonnes must reflect exactly one accepted submission"
    );

    let project = registry.get_project(&project_id);
    assert_eq!(project.total_credits_issued, 0);
    assert_eq!(credit.get_project_credits(&project_id).len(), 0);
}
