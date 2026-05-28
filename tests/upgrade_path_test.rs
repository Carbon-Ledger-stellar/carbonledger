use soroban_sdk::{testutils::{Address as _}, Env, String, Vec, vec, BytesN, Address};
use carbon_registry::{CarbonRegistryContract, CarbonRegistryContractClient};
use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient};
use carbon_marketplace::{CarbonMarketplaceContract, CarbonMarketplaceContractClient};
use carbon_oracle::{CarbonOracleContract, CarbonOracleContractClient};

fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

// -- carbon_registry upgrade tests --------------------------------------------

#[test]
fn test_registry_upgrade_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let admin    = Address::generate(&env);
    let oracle   = Address::generate(&env);
    let verifier = Address::generate(&env);
    let id       = env.register_contract(None, CarbonRegistryContract);
    let client   = CarbonRegistryContractClient::new(&env, &id);
    client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]).unwrap();

    let attacker = Address::generate(&env);
    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_upgrade(&attacker, &fake_hash);
    assert!(result.is_err());

    // Admin upgrade succeeds
    client.upgrade(&admin, &fake_hash).unwrap();
    assert_eq!(client.get_version(), 2);
    let history = client.get_upgrade_history().unwrap();
    assert_eq!(history.from_version, 1);
    assert_eq!(history.to_version, 2);
    assert_eq!(history.upgraded_by, admin);
    assert_eq!(history.wasm_hash, fake_hash);
}

#[test]
fn test_registry_retired_credits_preserved_after_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let admin    = Address::generate(&env);
    let oracle   = Address::generate(&env);
    let verifier = Address::generate(&env);
    let id       = env.register_contract(None, CarbonRegistryContract);
    let client   = CarbonRegistryContractClient::new(&env, &id);
    client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]).unwrap();

    // Register and verify project
    client.register_project(
        &admin,
        &s(&env, "proj-001"),
        &s(&env, "Amazon Reforestation"),
        &s(&env, "QmCID123"),
        &verifier,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
        &s(&env, "forestry"),
        &75_u32,
        &2023_u32,
    ).unwrap();
    client.verify_project(&verifier, &s(&env, "proj-001")).unwrap();
    client.increment_issued(&oracle, &s(&env, "proj-001"), &1000_i128).unwrap();
    client.retire_credits(&admin, &s(&env, "proj-001"), &300_i128).unwrap();

    // Verify pre-upgrade state
    let pre = client.get_project(&s(&env, "proj-001")).unwrap();
    assert_eq!(pre.total_credits_retired, 300);

    // Upgrade
    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&admin, &fake_hash).unwrap();

    // Verify post-upgrade state is preserved
    let post = client.get_project(&s(&env, "proj-001")).unwrap();
    assert_eq!(post.total_credits_retired, 300);
    assert_eq!(post.total_credits_issued, 1000);

    // Retirement must still be irreversible
    let result = client.try_retire_credits(&admin, &s(&env, "proj-001"), &800_i128);
    assert!(result.is_err());
}

// -- carbon_credit upgrade tests ----------------------------------------------

#[test]
fn test_credit_upgrade_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let admin    = Address::generate(&env);
    let registry = Address::generate(&env);
    let id       = env.register_contract(None, CarbonCreditContract);
    let client   = CarbonCreditContractClient::new(&env, &id);
    client.initialize(&admin, &registry).unwrap();

    let attacker = Address::generate(&env);
    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_upgrade(&attacker, &fake_hash);
    assert!(result.is_err());

    client.upgrade(&admin, &fake_hash).unwrap();
    assert_eq!(client.get_version(), 2);
}

#[test]
fn test_credit_retired_records_preserved_after_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let admin    = Address::generate(&env);
    let registry = Address::generate(&env);
    let id       = env.register_contract(None, CarbonCreditContract);
    let client   = CarbonCreditContractClient::new(&env, &id);
    client.initialize(&admin, &registry).unwrap();

    let owner = Address::generate(&env);
    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &1000_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &1000_u64,
        &s(&env, "QmCID"),
        &owner,
    ).unwrap();

    client.retire_credits(
        &owner,
        &s(&env, "batch-001"),
        &800_i128,
        &s(&env, "offset"),
        &s(&env, "Acme Corp"),
        &s(&env, "ret-001"),
        &s(&env, "txhash"),
        &s(&env, "QmCertCID"),
    ).unwrap();

    // Verify pre-upgrade retirement
    let batch_pre = client.get_credit_batch(&s(&env, "batch-001")).unwrap();
    assert_eq!(batch_pre.status, carbon_credit::CreditStatus::PartiallyRetired);

    // Upgrade
    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&admin, &fake_hash).unwrap();

    // Verify post-upgrade retirement is preserved
    let batch_post = client.get_credit_batch(&s(&env, "batch-001")).unwrap();
    assert_eq!(batch_post.status, carbon_credit::CreditStatus::PartiallyRetired);

    let cert = client.get_retirement_certificate(&s(&env, "ret-001")).unwrap();
    assert_eq!(cert.amount, 800);

    // Cannot retire more than remaining
    let result = client.try_retire_credits(
        &owner,
        &s(&env, "batch-001"),
        &300_i128,
        &s(&env, "offset2"),
        &s(&env, "Acme Corp"),
        &s(&env, "ret-002"),
        &s(&env, "txhash2"),
        &s(&env, "QmCertCID2"),
    );
    assert!(result.is_err());
}

// -- carbon_marketplace upgrade tests -----------------------------------------

#[test]
fn test_marketplace_upgrade_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let admin    = Address::generate(&env);
    let treasury = Address::generate(&env);
    let usdc     = env.register_stellar_asset_contract(admin.clone());
    let credit_id = env.register_contract(None, CarbonCreditContract);
    let id       = env.register_contract(None, CarbonMarketplaceContract);
    let client   = CarbonMarketplaceContractClient::new(&env, &id);
    client.initialize(&admin, &usdc, &credit_id, &treasury).unwrap();

    let attacker = Address::generate(&env);
    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_upgrade(&attacker, &fake_hash);
    assert!(result.is_err());

    client.upgrade(&admin, &fake_hash).unwrap();
    assert_eq!(client.get_version(), 2);
}

#[test]
fn test_marketplace_listings_preserved_after_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let admin    = Address::generate(&env);
    let treasury = Address::generate(&env);
    let seller   = Address::generate(&env);
    let usdc     = env.register_stellar_asset_contract(admin.clone());
    let credit_id = env.register_contract(None, CarbonCreditContract);
    let id       = env.register_contract(None, CarbonMarketplaceContract);
    let client   = CarbonMarketplaceContractClient::new(&env, &id);
    client.initialize(&admin, &usdc, &credit_id, &treasury).unwrap();

    client.list_credits(
        &seller,
        &s(&env, "list-001"),
        &s(&env, "batch-001"),
        &s(&env, "proj-001"),
        &100_i128,
        &10_0000000_i128,
        &2023_u32,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    ).unwrap();

    let pre = client.get_listing(&s(&env, "list-001")).unwrap();
    assert_eq!(pre.amount_available, 100);

    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&admin, &fake_hash).unwrap();

    let post = client.get_listing(&s(&env, "list-001")).unwrap();
    assert_eq!(post.amount_available, 100);
    assert_eq!(post.status, carbon_marketplace::ListingStatus::Active);
}

// -- carbon_oracle upgrade tests ----------------------------------------------

#[test]
fn test_oracle_upgrade_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let admin  = Address::generate(&env);
    let oracle = Address::generate(&env);
    let id     = env.register_contract(None, CarbonOracleContract);
    let client = CarbonOracleContractClient::new(&env, &id);
    client.initialize(&admin, &oracle).unwrap();

    let attacker = Address::generate(&env);
    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_upgrade(&attacker, &fake_hash);
    assert!(result.is_err());

    client.upgrade(&admin, &fake_hash).unwrap();
    assert_eq!(client.get_version(), 2);
}

#[test]
fn test_oracle_monitoring_preserved_after_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let admin  = Address::generate(&env);
    let oracle = Address::generate(&env);
    let id     = env.register_contract(None, CarbonOracleContract);
    let client = CarbonOracleContractClient::new(&env, &id);
    client.initialize(&admin, &oracle).unwrap();

    client.submit_monitoring_data(
        &oracle,
        &s(&env, "proj-001"),
        &s(&env, "2023-Q1"),
        &5000_i128,
        &85_u32,
        &s(&env, "QmSatCID"),
    ).unwrap();

    let pre = client.get_monitoring_data(&s(&env, "proj-001"), &s(&env, "2023-Q1")).unwrap();
    assert_eq!(pre.tonnes_verified, 5000);

    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&admin, &fake_hash).unwrap();

    let post = client.get_monitoring_data(&s(&env, "proj-001"), &s(&env, "2023-Q1")).unwrap();
    assert_eq!(post.tonnes_verified, 5000);
    assert!(client.is_monitoring_current(&s(&env, "proj-001")));
}

// -- Cross-contract upgrade consistency test ----------------------------------

#[test]
fn test_all_contracts_version_consistency() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy all four contracts
    let admin    = Address::generate(&env);
    let oracle   = Address::generate(&env);
    let verifier = Address::generate(&env);
    let registry = Address::generate(&env);
    let treasury = Address::generate(&env);
    let usdc     = env.register_stellar_asset_contract(admin.clone());

    let reg_id   = env.register_contract(None, CarbonRegistryContract);
    let reg_client = CarbonRegistryContractClient::new(&env, &reg_id);
    reg_client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]).unwrap();

    let cred_id  = env.register_contract(None, CarbonCreditContract);
    let cred_client = CarbonCreditContractClient::new(&env, &cred_id);
    cred_client.initialize(&admin, &registry).unwrap();

    let mkt_id   = env.register_contract(None, CarbonMarketplaceContract);
    let mkt_client = CarbonMarketplaceContractClient::new(&env, &mkt_id);
    mkt_client.initialize(&admin, &usdc, &cred_id, &treasury).unwrap();

    let ora_id   = env.register_contract(None, CarbonOracleContract);
    let ora_client = CarbonOracleContractClient::new(&env, &ora_id);
    ora_client.initialize(&admin, &oracle).unwrap();

    // All start at version 1
    assert_eq!(reg_client.get_version(), 1);
    assert_eq!(cred_client.get_version(), 1);
    assert_eq!(mkt_client.get_version(), 1);
    assert_eq!(ora_client.get_version(), 1);

    // Upgrade all
    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    reg_client.upgrade(&admin, &fake_hash).unwrap();
    cred_client.upgrade(&admin, &fake_hash).unwrap();
    mkt_client.upgrade(&admin, &fake_hash).unwrap();
    ora_client.upgrade(&admin, &fake_hash).unwrap();

    // All now at version 2
    assert_eq!(reg_client.get_version(), 2);
    assert_eq!(cred_client.get_version(), 2);
    assert_eq!(mkt_client.get_version(), 2);
    assert_eq!(ora_client.get_version(), 2);
}
