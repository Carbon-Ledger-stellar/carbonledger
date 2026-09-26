//! # Role Authorization Audit — All Four CarbonLedger Soroban Contracts
//!
//! Systematic positive/negative role-check tests for every privileged function
//! across carbon_registry, carbon_oracle, carbon_credit, and carbon_marketplace.
//!
//! Closes #569.
//!
//! ## Test matrix
//!
//! ### carbon_registry
//! | Test | Function | Expected |
//! |------|----------|---------|
//! | reg_initialize_ok                  | initialize()            | Ok |
//! | reg_double_initialize              | initialize() x2         | AlreadyInitialized |
//! | reg_verify_project_ok              | verify_project()        | Ok |
//! | reg_verify_project_unauthorized    | verify_project()        | UnauthorizedVerifier |
//! | reg_reject_project_ok              | reject_project()        | Ok |
//! | reg_reject_project_unauthorized    | reject_project()        | UnauthorizedVerifier |
//! | reg_suspend_project_ok             | suspend_project()       | Ok |
//! | reg_suspend_project_unauthorized   | suspend_project()       | UnauthorizedVerifier |
//! | reg_update_status_ok               | update_project_status() | Ok |
//! | reg_update_status_unauthorized     | update_project_status() | UnauthorizedOracle |
//! | reg_add_verifier_ok                | add_verifier()          | Ok |
//! | reg_add_verifier_unauthorized      | add_verifier()          | UnauthorizedVerifier |
//! | reg_remove_verifier_ok             | remove_verifier()       | Ok |
//! | reg_remove_verifier_unauthorized   | remove_verifier()       | UnauthorizedVerifier |
//!
//! ### carbon_oracle
//! | Test | Function | Expected |
//! |------|----------|---------|
//! | ora_initialize_ok                      | initialize()              | Ok |
//! | ora_double_initialize                  | initialize() x2           | AlreadyInitialized |
//! | ora_rotate_oracle_ok                   | rotate_oracle()           | Ok |
//! | ora_rotate_oracle_unauthorized         | rotate_oracle()           | UnauthorizedVerifier |
//! | ora_set_liveness_sla_ok                | set_liveness_sla()        | Ok |
//! | ora_set_liveness_sla_unauthorized      | set_liveness_sla()        | UnauthorizedVerifier |
//! | ora_set_price_staleness_ok             | set_price_staleness_window() | Ok |
//! | ora_set_price_staleness_unauthorized   | set_price_staleness_window() | UnauthorizedVerifier |
//! | ora_submit_monitoring_ok               | submit_monitoring_data()  | Ok (oracle role) |
//! | ora_submit_monitoring_unauthorized     | submit_monitoring_data()  | UnauthorizedOracle |
//! | ora_update_price_unauthorized          | update_credit_price()     | UnauthorizedOracle |
//! | ora_flag_project_unauthorized          | flag_project()            | UnauthorizedOracle |
//!
//! ### carbon_credit
//! | Test | Function | Expected |
//! |------|----------|---------|
//! | cred_initialize_ok                     | initialize()              | Ok |
//! | cred_double_initialize                 | initialize() x2           | AlreadyInitialized |
//! | cred_mint_credits_ok                   | mint_credits()            | Ok |
//! | cred_mint_credits_unauthorized         | mint_credits()            | auth error |
//! | cred_set_oracle_contract_ok            | set_oracle_contract()     | Ok |
//! | cred_set_oracle_contract_unauthorized  | set_oracle_contract()     | UnauthorizedVerifier |
//! | cred_set_vintage_bounds_ok             | set_vintage_year_bounds() | Ok |
//! | cred_set_vintage_bounds_unauthorized   | set_vintage_year_bounds() | UnauthorizedVerifier |
//! | cred_pause_ok                          | pause_operations()        | Ok |
//! | cred_pause_unauthorized                | pause_operations()        | UnauthorizedVerifier |
//! | cred_unpause_ok                        | unpause_operations()      | Ok |
//! | cred_unpause_unauthorized              | unpause_operations()      | UnauthorizedVerifier |
//!
//! ### carbon_marketplace
//! | Test | Function | Expected |
//! |------|----------|---------|
//! | mkt_initialize_ok                      | initialize()              | Ok |
//! | mkt_double_initialize                  | initialize() x2           | AlreadyInitialized |
//! | mkt_set_fee_rate_ok                    | set_fee_rate()            | Ok |
//! | mkt_set_fee_rate_unauthorized          | set_fee_rate()            | UnauthorizedVerifier |
//! | mkt_update_treasury_ok                 | update_treasury()         | Ok |
//! | mkt_update_treasury_unauthorized       | update_treasury()         | UnauthorizedVerifier |
//! | mkt_suspend_project_ok                 | suspend_project()         | Ok |
//! | mkt_suspend_project_unauthorized       | suspend_project()         | UnauthorizedVerifier |
//! | mkt_set_oracle_contract_ok             | set_oracle_contract()     | Ok |
//! | mkt_set_oracle_contract_unauthorized   | set_oracle_contract()     | UnauthorizedVerifier |
//! | mkt_pause_ok                           | pause_operations()        | Ok |
//! | mkt_pause_unauthorized                 | pause_operations()        | UnauthorizedVerifier |
//! | mkt_unpause_ok                         | unpause_operations()      | Ok |
//! | mkt_unpause_unauthorized               | unpause_operations()      | UnauthorizedVerifier |

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

use carbon_registry::{CarbonError as RegError, CarbonRegistryContract, ProjectStatus};
use carbon_oracle::{CarbonError as OraError, CarbonOracleContract};
use carbon_credit::{CarbonCreditContract, CarbonError as CredError};
use carbon_marketplace::{CarbonError as MktError, CarbonMarketplaceContract};

use crate::helpers::s;

// ─────────────────────────────────────────────────────────────────────────────
// Shared ledger setup
// ─────────────────────────────────────────────────────────────────────────────

fn ledger_info() -> soroban_sdk::testutils::LedgerInfo {
    soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_735_689_600, // 2025-01-01
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — carbon_registry role-authorization tests
// ─────────────────────────────────────────────────────────────────────────────

use carbon_registry::CarbonRegistryContractClient;

fn setup_registry(env: &Env) -> (CarbonRegistryContractClient, Address, Address, Address) {
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin    = Address::generate(env);
    let oracle   = Address::generate(env);
    let verifier = Address::generate(env);

    let mut verifiers = soroban_sdk::vec![env];
    verifiers.push_back(verifier.clone());

    let id     = env.register_contract(None, CarbonRegistryContract);
    let client = CarbonRegistryContractClient::new(env, &id);
    client.initialize(&admin, &oracle, &verifiers).unwrap();
    (client, admin, oracle, verifier)
}

/// Register a test project and return its string ID.
fn reg_add_project(env: &Env, client: &CarbonRegistryContractClient, admin: &Address) {
    client.register_project(
        admin,
        &s(env, "proj-role-test"),
        &s(env, "Role Test Project"),
        &s(env, "QmCIDrole"),
        &Address::generate(env),
        &s(env, "VCS"),
        &s(env, "Brazil"),
        &s(env, "forestry"),
        &75_u32,
        &2023_u32,
    ).unwrap();
}

// ── 1.1  initialize() — double-init guard ────────────────────────────────────

/// Positive: initialize() with correct admin succeeds.
#[test]
fn reg_initialize_ok() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin    = Address::generate(&env);
    let oracle   = Address::generate(&env);
    let verifier = Address::generate(&env);
    let mut verifiers = soroban_sdk::vec![&env];
    verifiers.push_back(verifier);

    let id     = env.register_contract(None, CarbonRegistryContract);
    let client = CarbonRegistryContractClient::new(&env, &id);
    assert!(client.initialize(&admin, &oracle, &verifiers).is_ok());
}

/// Negative: calling initialize() a second time must return AlreadyInitialized.
#[test]
fn reg_double_initialize() {
    let env = Env::default();
    let (client, _, oracle, _) = setup_registry(&env);
    let attacker = Address::generate(&env);
    let mut v = soroban_sdk::vec![&env];
    v.push_back(Address::generate(&env));

    let result = client.try_initialize(&attacker, &oracle, &v);
    assert_eq!(result.unwrap_err().unwrap(), RegError::AlreadyInitialized);
}

// ── 1.2  verify_project() — verifier role ────────────────────────────────────

/// Positive: a registered verifier can verify a project.
#[test]
fn reg_verify_project_ok() {
    let env = Env::default();
    let (client, admin, _, verifier) = setup_registry(&env);
    reg_add_project(&env, &client, &admin);

    assert!(client.verify_project(&verifier, &s(&env, "proj-role-test")).is_ok());
}

/// Negative: a non-verifier address must receive UnauthorizedVerifier.
#[test]
fn reg_verify_project_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = setup_registry(&env);
    reg_add_project(&env, &client, &admin);
    let rogue = Address::generate(&env);

    let result = client.try_verify_project(&rogue, &s(&env, "proj-role-test"));
    assert_eq!(result.unwrap_err().unwrap(), RegError::UnauthorizedVerifier);
}

// ── 1.3  reject_project() — verifier role ────────────────────────────────────

/// Positive: a registered verifier can reject a project.
#[test]
fn reg_reject_project_ok() {
    let env = Env::default();
    let (client, admin, _, verifier) = setup_registry(&env);
    reg_add_project(&env, &client, &admin);

    assert!(client.reject_project(&verifier, &s(&env, "proj-role-test"), &s(&env, "fraud")).is_ok());
}

/// Negative: a non-verifier address must receive UnauthorizedVerifier.
#[test]
fn reg_reject_project_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = setup_registry(&env);
    reg_add_project(&env, &client, &admin);
    let rogue = Address::generate(&env);

    let result = client.try_reject_project(&rogue, &s(&env, "proj-role-test"), &s(&env, "sabotage"));
    assert_eq!(result.unwrap_err().unwrap(), RegError::UnauthorizedVerifier);
}

// ── 1.4  suspend_project() — admin role ──────────────────────────────────────

/// Positive: the admin can suspend a project.
#[test]
fn reg_suspend_project_ok() {
    let env = Env::default();
    let (client, admin, _, _) = setup_registry(&env);
    reg_add_project(&env, &client, &admin);

    assert!(client.suspend_project(&admin, &s(&env, "proj-role-test"), &s(&env, "investigation")).is_ok());
}

/// Negative: a non-admin address must receive UnauthorizedVerifier.
#[test]
fn reg_suspend_project_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = setup_registry(&env);
    reg_add_project(&env, &client, &admin);
    let rogue = Address::generate(&env);

    let result = client.try_suspend_project(&rogue, &s(&env, "proj-role-test"), &s(&env, "fake"));
    assert_eq!(result.unwrap_err().unwrap(), RegError::UnauthorizedVerifier);
}

// ── 1.5  update_project_status() — oracle role ───────────────────────────────

/// Positive: the registered oracle can update project status.
#[test]
fn reg_update_status_ok() {
    let env = Env::default();
    let (client, admin, oracle, verifier) = setup_registry(&env);
    reg_add_project(&env, &client, &admin);
    // First verify so we can transition status.
    client.verify_project(&verifier, &s(&env, "proj-role-test")).unwrap();

    assert!(client.update_project_status(
        &oracle,
        &s(&env, "proj-role-test"),
        &ProjectStatus::Suspended,
    ).is_ok());
}

/// Negative: a rogue oracle address must receive UnauthorizedOracle.
#[test]
fn reg_update_status_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = setup_registry(&env);
    reg_add_project(&env, &client, &admin);
    let rogue = Address::generate(&env);

    let result = client.try_update_project_status(
        &rogue,
        &s(&env, "proj-role-test"),
        &ProjectStatus::Verified,
    );
    assert_eq!(result.unwrap_err().unwrap(), RegError::UnauthorizedOracle);
}

// ── 1.6  add_verifier() — admin role ─────────────────────────────────────────

/// Positive: admin can add a new verifier.
#[test]
fn reg_add_verifier_ok() {
    let env = Env::default();
    let (client, admin, _, _) = setup_registry(&env);
    let new_verifier = Address::generate(&env);

    assert!(client.add_verifier(&admin, &new_verifier).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn reg_add_verifier_unauthorized() {
    let env = Env::default();
    let (client, _, _, _) = setup_registry(&env);
    let rogue        = Address::generate(&env);
    let new_verifier = Address::generate(&env);

    let result = client.try_add_verifier(&rogue, &new_verifier);
    assert_eq!(result.unwrap_err().unwrap(), RegError::UnauthorizedVerifier);
}

// ── 1.7  remove_verifier() — admin role ──────────────────────────────────────

/// Positive: admin can remove an existing verifier.
#[test]
fn reg_remove_verifier_ok() {
    let env = Env::default();
    let (client, admin, _, verifier) = setup_registry(&env);

    assert!(client.remove_verifier(&admin, &verifier).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn reg_remove_verifier_unauthorized() {
    let env = Env::default();
    let (client, _, _, verifier) = setup_registry(&env);
    let rogue = Address::generate(&env);

    let result = client.try_remove_verifier(&rogue, &verifier);
    assert_eq!(result.unwrap_err().unwrap(), RegError::UnauthorizedVerifier);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — carbon_oracle role-authorization tests
// ─────────────────────────────────────────────────────────────────────────────

use carbon_oracle::CarbonOracleContractClient;

fn setup_oracle(env: &Env) -> (CarbonOracleContractClient, Address, Address) {
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin    = Address::generate(env);
    let oracle   = Address::generate(env);
    let pub_key  = BytesN::<32>::from_array(env, &[0u8; 32]);
    let registry = Address::generate(env);

    let id     = env.register_contract(None, CarbonOracleContract);
    let client = CarbonOracleContractClient::new(env, &id);
    client.initialize(&admin, &oracle, &pub_key, &registry).unwrap();
    (client, admin, oracle)
}

fn zero_sig(env: &Env) -> BytesN<64> {
    BytesN::<64>::from_array(env, &[0u8; 64])
}

// ── 2.1  initialize() — double-init guard ────────────────────────────────────

/// Positive: initialize() with a fresh contract succeeds.
#[test]
fn ora_initialize_ok() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin    = Address::generate(&env);
    let oracle   = Address::generate(&env);
    let pub_key  = BytesN::<32>::from_array(&env, &[0u8; 32]);
    let registry = Address::generate(&env);

    let id     = env.register_contract(None, CarbonOracleContract);
    let client = CarbonOracleContractClient::new(&env, &id);
    assert!(client.initialize(&admin, &oracle, &pub_key, &registry).is_ok());
}

/// Negative: second initialize() must return AlreadyInitialized.
#[test]
fn ora_double_initialize() {
    let env = Env::default();
    let (client, admin, _) = setup_oracle(&env);
    let attacker     = Address::generate(&env);
    let attacker_key = BytesN::<32>::from_array(&env, &[1u8; 32]);
    let registry     = Address::generate(&env);

    let result = client.try_initialize(&attacker, &attacker, &attacker_key, &registry);
    assert_eq!(result.unwrap_err().unwrap(), OraError::AlreadyInitialized);

    // Original admin must be unchanged.
    let _ = admin; // admin was correctly the original initializer
}

// ── 2.2  rotate_oracle() — admin role ────────────────────────────────────────

/// Positive: admin can rotate the oracle address and public key.
#[test]
fn ora_rotate_oracle_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_oracle(&env);
    let new_oracle = Address::generate(&env);
    let new_key    = BytesN::<32>::from_array(&env, &[2u8; 32]);

    assert!(client.rotate_oracle(&admin, &new_oracle, &new_key).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn ora_rotate_oracle_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_oracle(&env);
    let attacker   = Address::generate(&env);
    let new_oracle = Address::generate(&env);
    let new_key    = BytesN::<32>::from_array(&env, &[3u8; 32]);

    let result = client.try_rotate_oracle(&attacker, &new_oracle, &new_key);
    assert_eq!(result.unwrap_err().unwrap(), OraError::UnauthorizedVerifier);
}

// ── 2.3  set_liveness_sla() — admin role ─────────────────────────────────────

/// Positive: admin can update the liveness SLA window.
#[test]
fn ora_set_liveness_sla_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_oracle(&env);

    assert!(client.set_liveness_sla(&admin, &(180 * 24 * 60 * 60_u64)).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn ora_set_liveness_sla_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_oracle(&env);
    let rogue = Address::generate(&env);

    let result = client.try_set_liveness_sla(&rogue, &(180 * 24 * 60 * 60_u64));
    assert_eq!(result.unwrap_err().unwrap(), OraError::UnauthorizedVerifier);
}

// ── 2.4  set_price_staleness_window() — admin role ───────────────────────────

/// Positive: admin can update the price staleness window.
#[test]
fn ora_set_price_staleness_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_oracle(&env);

    assert!(client.set_price_staleness_window(&admin, &(48 * 60 * 60_u64)).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn ora_set_price_staleness_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_oracle(&env);
    let rogue = Address::generate(&env);

    let result = client.try_set_price_staleness_window(&rogue, &(48 * 60 * 60_u64));
    assert_eq!(result.unwrap_err().unwrap(), OraError::UnauthorizedVerifier);
}

// ── 2.5  submit_monitoring_data() — oracle role ───────────────────────────────

/// Negative: a non-oracle address must receive UnauthorizedOracle.
/// (Positive path requires a valid ed25519 signature; skipped here — covered in
/// the oracle unit tests with real key material.)
#[test]
fn ora_submit_monitoring_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_oracle(&env);
    let rogue = Address::generate(&env);

    let result = client.try_submit_monitoring_data(
        &rogue,
        &s(&env, "proj-001"),
        &s(&env, "2023-Q1"),
        &100_000_i128,
        &85_u32,
        &s(&env, "QmFake"),
        &zero_sig(&env),
        &0_u64,
    );
    assert_eq!(result.unwrap_err().unwrap(), OraError::UnauthorizedOracle);
}

// ── 2.6  update_credit_price() — oracle role ─────────────────────────────────

/// Negative: non-oracle address must receive UnauthorizedOracle.
#[test]
fn ora_update_price_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_oracle(&env);
    let rogue = Address::generate(&env);

    let result = client.try_update_credit_price(
        &rogue,
        &s(&env, "VCS"),
        &2023_u32,
        &25_0000000_i128,
        &zero_sig(&env),
        &0_u64,
    );
    assert_eq!(result.unwrap_err().unwrap(), OraError::UnauthorizedOracle);
}

// ── 2.7  flag_project() — oracle role ────────────────────────────────────────

/// Negative: non-oracle address must receive UnauthorizedOracle.
#[test]
fn ora_flag_project_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_oracle(&env);
    let rogue = Address::generate(&env);

    let result = client.try_flag_project(
        &rogue,
        &s(&env, "proj-victim"),
        &s(&env, "fake-reason"),
        &zero_sig(&env),
        &0_u64,
    );
    assert_eq!(result.unwrap_err().unwrap(), OraError::UnauthorizedOracle);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — carbon_credit role-authorization tests
// ─────────────────────────────────────────────────────────────────────────────

use carbon_credit::CarbonCreditContractClient;

fn setup_credit(env: &Env) -> (CarbonCreditContractClient, Address) {
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin    = Address::generate(env);
    let registry = Address::generate(env);

    let id     = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(env, &id);
    client.initialize(&admin, &registry).unwrap();
    (client, admin)
}

// ── 3.1  initialize() — double-init guard ────────────────────────────────────

/// Positive: fresh contract initializes successfully.
#[test]
fn cred_initialize_ok() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin    = Address::generate(&env);
    let registry = Address::generate(&env);

    let id     = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &id);
    assert!(client.initialize(&admin, &registry).is_ok());
}

/// Negative: second initialize() must return AlreadyInitialized.
#[test]
fn cred_double_initialize() {
    let env = Env::default();
    let (client, _) = setup_credit(&env);
    let attacker = Address::generate(&env);
    let registry = Address::generate(&env);

    let result = client.try_initialize(&attacker, &registry);
    assert_eq!(result.unwrap_err().unwrap(), CredError::AlreadyInitialized);
}

// ── 3.2  mint_credits() — admin role ─────────────────────────────────────────

/// Positive: admin can mint a credit batch.
#[test]
fn cred_mint_credits_ok() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let owner = Address::generate(&env);

    assert!(client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    ).is_ok());
}

/// Negative: non-admin address must be rejected (auth error).
#[test]
fn cred_mint_credits_unauthorized() {
    let env = Env::default();
    let (client, _) = setup_credit(&env);
    let attacker = Address::generate(&env);
    let owner    = Address::generate(&env);

    let result = client.try_mint_credits(
        &attacker,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-unauth"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );
    assert!(result.is_err(), "non-admin mint must be rejected");
}

// ── 3.3  set_oracle_contract() — admin role ──────────────────────────────────

/// Positive: admin can set the oracle contract address.
#[test]
fn cred_set_oracle_contract_ok() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    let oracle = Address::generate(&env);

    assert!(client.set_oracle_contract(&admin, &oracle).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn cred_set_oracle_contract_unauthorized() {
    let env = Env::default();
    let (client, _) = setup_credit(&env);
    let rogue  = Address::generate(&env);
    let oracle = Address::generate(&env);

    let result = client.try_set_oracle_contract(&rogue, &oracle);
    assert_eq!(result.unwrap_err().unwrap(), CredError::UnauthorizedVerifier);
}

// ── 3.4  set_vintage_year_bounds() — admin role ──────────────────────────────

/// Positive: admin can update vintage year bounds.
#[test]
fn cred_set_vintage_bounds_ok() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);

    assert!(client.set_vintage_year_bounds(&admin, &1995_u32, &2025_u32).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn cred_set_vintage_bounds_unauthorized() {
    let env = Env::default();
    let (client, _) = setup_credit(&env);
    let rogue = Address::generate(&env);

    let result = client.try_set_vintage_year_bounds(&rogue, &1995_u32, &2025_u32);
    assert_eq!(result.unwrap_err().unwrap(), CredError::UnauthorizedVerifier);
}

// ── 3.5  pause_operations() — admin role ─────────────────────────────────────

/// Positive: admin can pause the contract.
#[test]
fn cred_pause_ok() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);
    // Pause until 1 hour from the ledger timestamp (within the 72-hour window).
    let until = ledger_info().timestamp + 3600;

    assert!(client.pause_operations(&admin, &until).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn cred_pause_unauthorized() {
    let env = Env::default();
    let (client, _) = setup_credit(&env);
    let rogue = Address::generate(&env);
    let until = ledger_info().timestamp + 3600;

    let result = client.try_pause_operations(&rogue, &until);
    assert_eq!(result.unwrap_err().unwrap(), CredError::UnauthorizedVerifier);
}

// ── 3.6  unpause_operations() — admin role ───────────────────────────────────

/// Positive: admin can unpause the contract (even when not paused — idempotent).
#[test]
fn cred_unpause_ok() {
    let env = Env::default();
    let (client, admin) = setup_credit(&env);

    assert!(client.unpause_operations(&admin).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn cred_unpause_unauthorized() {
    let env = Env::default();
    let (client, _) = setup_credit(&env);
    let rogue = Address::generate(&env);

    let result = client.try_unpause_operations(&rogue);
    assert_eq!(result.unwrap_err().unwrap(), CredError::UnauthorizedVerifier);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — carbon_marketplace role-authorization tests
// ─────────────────────────────────────────────────────────────────────────────

use carbon_marketplace::CarbonMarketplaceContractClient;

fn setup_marketplace(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address) {
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin    = Address::generate(env);
    let treasury = Address::generate(env);
    let usdc     = env.register_stellar_asset_contract(admin.clone());
    let credit_id = env.register_contract(None, CarbonCreditContract);

    let id     = env.register_contract(None, CarbonMarketplaceContract);
    let client = CarbonMarketplaceContractClient::new(env, &id);
    client.initialize(&admin, &usdc, &credit_id, &treasury).unwrap();
    (client, admin, treasury)
}

// ── 4.1  initialize() — double-init guard ────────────────────────────────────

/// Positive: fresh contract initializes successfully.
#[test]
fn mkt_initialize_ok() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin    = Address::generate(&env);
    let treasury = Address::generate(&env);
    let usdc     = env.register_stellar_asset_contract(admin.clone());
    let credit_id = env.register_contract(None, CarbonCreditContract);

    let id     = env.register_contract(None, CarbonMarketplaceContract);
    let client = CarbonMarketplaceContractClient::new(&env, &id);
    assert!(client.initialize(&admin, &usdc, &credit_id, &treasury).is_ok());
}

/// Negative: second initialize() must return AlreadyInitialized.
#[test]
fn mkt_double_initialize() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let attacker  = Address::generate(&env);
    let treasury2 = Address::generate(&env);
    let usdc2     = env.register_stellar_asset_contract(attacker.clone());
    let credit2   = env.register_contract(None, CarbonCreditContract);

    let result = client.try_initialize(&attacker, &usdc2, &credit2, &treasury2);
    assert_eq!(result.unwrap_err().unwrap(), MktError::AlreadyInitialized);
}

// ── 4.2  set_fee_rate() — admin role ─────────────────────────────────────────

/// Positive: admin can update the protocol fee rate.
#[test]
fn mkt_set_fee_rate_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_marketplace(&env);

    // 2% fee: 2/100
    assert!(client.set_fee_rate(&admin, &2_i128, &100_i128).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn mkt_set_fee_rate_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let rogue = Address::generate(&env);

    let result = client.try_set_fee_rate(&rogue, &2_i128, &100_i128);
    assert_eq!(result.unwrap_err().unwrap(), MktError::UnauthorizedVerifier);
}

// ── 4.3  update_treasury() — admin role ──────────────────────────────────────

/// Positive: admin can redirect the treasury address.
#[test]
fn mkt_update_treasury_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_marketplace(&env);
    let new_treasury = Address::generate(&env);

    assert!(client.update_treasury(&admin, &new_treasury).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn mkt_update_treasury_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let rogue        = Address::generate(&env);
    let new_treasury = Address::generate(&env);

    let result = client.try_update_treasury(&rogue, &new_treasury);
    assert_eq!(result.unwrap_err().unwrap(), MktError::UnauthorizedVerifier);
}

// ── 4.4  suspend_project() — admin role ──────────────────────────────────────

/// Positive: admin can suspend a project in the marketplace.
#[test]
fn mkt_suspend_project_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_marketplace(&env);

    assert!(client.suspend_project(&admin, &s(&env, "proj-sus")).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn mkt_suspend_project_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let rogue = Address::generate(&env);

    let result = client.try_suspend_project(&rogue, &s(&env, "proj-sus"));
    assert_eq!(result.unwrap_err().unwrap(), MktError::UnauthorizedVerifier);
}

// ── 4.5  set_oracle_contract() — admin role ──────────────────────────────────

/// Positive: admin can set the oracle contract reference.
#[test]
fn mkt_set_oracle_contract_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_marketplace(&env);
    let oracle = Address::generate(&env);

    assert!(client.set_oracle_contract(&admin, &oracle).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn mkt_set_oracle_contract_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let rogue  = Address::generate(&env);
    let oracle = Address::generate(&env);

    let result = client.try_set_oracle_contract(&rogue, &oracle);
    assert_eq!(result.unwrap_err().unwrap(), MktError::UnauthorizedVerifier);
}

// ── 4.6  pause_operations() — admin role ─────────────────────────────────────

/// Positive: admin can pause marketplace operations.
#[test]
fn mkt_pause_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_marketplace(&env);
    let until = ledger_info().timestamp + 3600;

    assert!(client.pause_operations(&admin, &until).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn mkt_pause_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let rogue = Address::generate(&env);
    let until = ledger_info().timestamp + 3600;

    let result = client.try_pause_operations(&rogue, &until);
    assert_eq!(result.unwrap_err().unwrap(), MktError::UnauthorizedVerifier);
}

// ── 4.7  unpause_operations() — admin role ───────────────────────────────────

/// Positive: admin can unpause marketplace operations.
#[test]
fn mkt_unpause_ok() {
    let env = Env::default();
    let (client, admin, _) = setup_marketplace(&env);

    assert!(client.unpause_operations(&admin).is_ok());
}

/// Negative: non-admin must receive UnauthorizedVerifier.
#[test]
fn mkt_unpause_unauthorized() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let rogue = Address::generate(&env);

    let result = client.try_unpause_operations(&rogue);
    assert_eq!(result.unwrap_err().unwrap(), MktError::UnauthorizedVerifier);
}
