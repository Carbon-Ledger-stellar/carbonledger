#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, String, Vec, IntoVal,
};
use soroban_sdk::BytesN;

// Import contract clients
use carbon_registry::{CarbonRegistryContract, CarbonRegistryContractClient};
use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient, CreditStatus};
use carbon_marketplace::{CarbonMarketplaceContract, CarbonMarketplaceContractClient};
use carbon_oracle::{CarbonOracleContract, CarbonOracleContractClient};

// ============================================
# Constants
// ============================================

const TTL_LEDGERS: u32 = 518_400;
const METHODOLOGY_SCORE_MIN: u32 = 70;
const LISTING_PRICE: i128 = 1000; // 1000 tokens per credit

// ============================================
# Test Helpers
// ============================================

fn setup_test_environment(env: &Env) -> SetupResult {
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: 1735689600, // 2025-01-01
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
    let buyer = Address::generate(env);
    let project_owner = Address::generate(env);

    // Deploy registry contract
    let registry_id = env.register_contract(None, CarbonRegistryContract);
    let registry_client = CarbonRegistryContractClient::new(env, &registry_id);
    registry_client.initialize(&admin);

    // Deploy credit contract
    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit_client = CarbonCreditContractClient::new(env, &credit_id);
    credit_client.initialize(&admin, &registry_id).unwrap();

    // Deploy oracle contract
    let oracle_id = env.register_contract(None, CarbonOracleContract);
    let oracle_client = CarbonOracleContractClient::new(env, &oracle_id);
    oracle_client.initialize(&admin);

    // Set oracle in credit contract
    credit_client.set_oracle_contract(&admin, &oracle_id);

    // Deploy marketplace contract
    let marketplace_id = env.register_contract(None, CarbonMarketplaceContract);
    let marketplace_client = CarbonMarketplaceContractClient::new(env, &marketplace_id);
    marketplace_client.initialize(&admin, &credit_id, &registry_id);

    SetupResult {
        admin,
        verifier,
        buyer,
        project_owner,
        registry_client,
        credit_client,
        oracle_client,
        marketplace_client,
        registry_id,
        credit_id,
        oracle_id,
        marketplace_id,
    }
}

struct SetupResult {
    admin: Address,
    verifier: Address,
    buyer: Address,
    project_owner: Address,
    registry_client: CarbonRegistryContractClient,
    credit_client: CarbonCreditContractClient,
    oracle_client: CarbonOracleContractClient,
    marketplace_client: CarbonMarketplaceContractClient,
    registry_id: Address,
    credit_id: Address,
    oracle_id: Address,
    marketplace_id: Address,
}

fn create_test_project(env: &Env, setup: &SetupResult) -> String {
    let project_id = String::from_str(env, "proj-001");
    let methodology = String::from_str(env, "VCS-REDD+");
    let metadata = String::from_str(env, "QmTestMetadata");
    let location = String::from_str(env, "Amazon Basin");
    let methodology_score = 85;

    setup.registry_client.register_project(
        &setup.admin,
        &project_id,
        &methodology,
        &metadata,
        &location,
        &methodology_score,
    );

    project_id
}

fn verify_project(env: &Env, setup: &SetupResult, project_id: &String) {
    setup.registry_client.verify_project(
        &setup.verifier,
        project_id,
    );
}

fn mint_credits(
    env: &Env,
    setup: &SetupResult,
    project_id: &String,
    amount: i128,
    batch_id: &str,
    serial_start: u64,
    serial_end: u64,
) {
    let batch_id_str = String::from_str(env, batch_id);
    let metadata = String::from_str(env, "QmTestCID");
    
    setup.credit_client.mint_credits(
        &setup.admin,
        project_id,
        &amount,
        &2023_u32,
        &batch_id_str,
        &serial_start,
        &serial_end,
        &metadata,
        &setup.project_owner,
    ).unwrap();
}

fn list_credits(
    env: &Env,
    setup: &SetupResult,
    batch_id: &str,
    price_per_credit: i128,
) {
    let batch_id_str = String::from_str(env, batch_id);
    setup.marketplace_client.list_credits(
        &setup.project_owner,
        &batch_id_str,
        &price_per_credit,
    );
}

// ============================================
# Happy Path Test
// ============================================

#[test]
fn test_full_lifecycle_happy_path() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    // 1. Register Project
    let project_id = create_test_project(&env, &setup);
    let project = setup.registry_client.get_project(&project_id);
    assert_eq!(project.methodology_score, 85);
    assert_eq!(project.status, 0); // Pending verification

    // 2. Verify Project
    verify_project(&env, &setup, &project_id);
    let project_after = setup.registry_client.get_project(&project_id);
    assert_eq!(project_after.status, 1); // Verified

    // 3. Mint Credits
    let amount = 1000;
    let batch_id = "batch-001";
    mint_credits(&env, &setup, &project_id, amount, batch_id, 1, 1000);
    let batch = setup.credit_client.get_credit_batch(&String::from_str(&env, batch_id));
    assert_eq!(batch.amount, amount);
    assert_eq!(batch.status, CreditStatus::Active);

    // 4. List Credits on Marketplace
    list_credits(&env, &setup, batch_id, LISTING_PRICE);
    let listing = setup.marketplace_client.get_listing(&String::from_str(&env, batch_id));
    assert_eq!(listing.price_per_credit, LISTING_PRICE);
    assert_eq!(listing.available_amount, amount);
    assert_eq!(listing.status, 0); // Active

    // 5. Purchase Credits
    let purchase_amount = 500;
    setup.marketplace_client.purchase_credits(
        &setup.buyer,
        &String::from_str(&env, batch_id),
        &purchase_amount,
    );

    // Verify purchase
    let listing_after = setup.marketplace_client.get_listing(&String::from_str(&env, batch_id));
    assert_eq!(listing_after.available_amount, amount - purchase_amount);
    
    // Verify buyer now owns the credits
    let buyer_batches = setup.credit_client.get_user_batches(&setup.buyer);
    assert_eq!(buyer_batches.len(), 1);

    // 6. Retire Credits
    let retire_amount = 250;
    let retire_id = String::from_str(&env, "retire-001");
    let reason = String::from_str(&env, "Offset emissions");
    let beneficiary = String::from_str(&env, "Climate Fund");
    let tx_hash = String::from_str(&env, "0xabc123");
    let cert_cid = String::from_str(&env, "QmRetireCID");

    setup.credit_client.retire_credits(
        &setup.buyer,
        &String::from_str(&env, batch_id),
        &retire_amount,
        &reason,
        &beneficiary,
        &retire_id,
        &tx_hash,
        &cert_cid,
    ).unwrap();

    // 7. Get Retirement Certificate
    let certificate = setup.credit_client.get_retirement_certificate(&retire_id);
    assert_eq!(certificate.amount, retire_amount);
    assert_eq!(certificate.retired_by, setup.buyer);
    assert_eq!(certificate.beneficiary, beneficiary);
    assert_eq!(certificate.retirement_reason, reason);
    assert_eq!(certificate.credit_batch_id, String::from_str(&env, batch_id));
}

// ============================================
# Error Path Tests
// ============================================

#[test]
fn test_purchase_suspended_project_fails() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    // Register and verify project
    let project_id = create_test_project(&env, &setup);
    verify_project(&env, &setup, &project_id);

    // Mint credits
    let amount = 1000;
    let batch_id = "batch-suspended";
    mint_credits(&env, &setup, &project_id, amount, batch_id, 1, 1000);

    // List credits
    list_credits(&env, &setup, batch_id, LISTING_PRICE);

    // Suspend the project
    setup.registry_client.suspend_project(&setup.admin, &project_id);

    // Attempt purchase - should fail
    let result = setup.marketplace_client.try_purchase_credits(
        &setup.buyer,
        &String::from_str(&env, batch_id),
        &100,
    );
    assert!(result.is_err());
}

#[test]
fn test_purchase_insufficient_credits_fails() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    // Register and verify project
    let project_id = create_test_project(&env, &setup);
    verify_project(&env, &setup, &project_id);

    // Mint only 100 credits
    let amount = 100;
    let batch_id = "batch-small";
    mint_credits(&env, &setup, &setup, &setup.project_owner, project_id, amount, batch_id, 1, 100);

    // List credits
    list_credits(&env, &setup, batch_id, LISTING_PRICE);

    // Attempt to purchase more than available - should fail
    let result = setup.marketplace_client.try_purchase_credits(
        &setup.buyer,
        &String::from_str(&env, batch_id),
        &200,
    );
    assert!(result.is_err());
}

#[test]
fn test_retire_already_retired_batch_fails() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    // Register and verify project
    let project_id = create_test_project(&env, &setup);
    verify_project(&env, &setup, &project_id);

    // Mint credits
    let amount = 1000;
    let batch_id = "batch-retired";
    mint_credits(&env, &setup, &project_id, amount, batch_id, 1, 1000);

    // Retire all credits
    let retire_id = String::from_str(&env, "retire-full");
    setup.credit_client.retire_credits(
        &setup.project_owner,
        &String::from_str(&env, batch_id),
        &amount,
        &String::from_str(&env, "Full retirement"),
        &String::from_str(&env, "Climate Fund"),
        &retire_id,
        &String::from_str(&env, "0xabc123"),
        &String::from_str(&env, "QmRetireCID"),
    ).unwrap();

    // Attempt to retire again - should fail
    let result = setup.credit_client.try_retire_credits(
        &setup.project_owner,
        &String::from_str(&env, batch_id),
        &100,
        &String::from_str(&env, "Second retirement"),
        &String::from_str(&env, "Climate Fund"),
        &String::from_str(&env, "retire-dup"),
        &String::from_str(&env, "0xdef456"),
        &String::from_str(&env, "QmRetireCID2"),
    );
    assert!(result.is_err());
}

#[test]
fn test_mint_with_low_methodology_score_fails() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    // Register project with low score
    let project_id = String::from_str(&env, "proj-low");
    let methodology = String::from_str(&env, "ACM0002");
    let metadata = String::from_str(&env, "QmTestMetadata");
    let location = String::from_str(&env, "Amazon Basin");
    let methodology_score = 50; // Below threshold

    setup.registry_client.register_project(
        &setup.admin,
        &project_id,
        &methodology,
        &metadata,
        &location,
        &methodology_score,
    );

    // Try to mint - should fail
    let result = setup.credit_client.try_mint_credits(
        &setup.admin,
        &project_id,
        &1000,
        &2023_u32,
        &String::from_str(&env, "batch-low"),
        &1_u64,
        &1000_u64,
        &String::from_str(&env, "QmTestCID"),
        &setup.project_owner,
    );
    assert!(result.is_err());
}

// ============================================
# Circuit Breaker Tests
// ============================================

#[test]
fn test_purchase_with_circuit_breaker_tripped_fails() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    // Register and verify project
    let project_id = create_test_project(&env, &setup);
    verify_project(&env, &setup, &project_id);

    // Mint credits
    let amount = 1000;
    let batch_id = "batch-circuit";
    mint_credits(&env, &setup, &project_id, amount, batch_id, 1, 1000);

    // List credits
    list_credits(&env, &setup, batch_id, LISTING_PRICE);

    // Trip circuit breaker
    setup.marketplace_client.trip_circuit_breaker(&setup.admin);

    // Attempt purchase - should fail
    let result = setup.marketplace_client.try_purchase_credits(
        &setup.buyer,
        &String::from_str(&env, batch_id),
        &100,
    );
    assert!(result.is_err());
}

#[test]
fn test_circuit_breaker_reset_allows_purchase() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    // Register and verify project
    let project_id = create_test_project(&env, &setup);
    verify_project(&env, &setup, &project_id);

    // Mint credits
    let amount = 1000;
    let batch_id = "batch-reset";
    mint_credits(&env, &setup, &project_id, amount, batch_id, 1, 1000);

    // List credits
    list_credits(&env, &setup, batch_id, LISTING_PRICE);

    // Trip circuit breaker
    setup.marketplace_client.trip_circuit_breaker(&setup.admin);

    // Attempt purchase - should fail
    let result = setup.marketplace_client.try_purchase_credits(
        &setup.buyer,
        &String::from_str(&env, batch_id),
        &100,
    );
    assert!(result.is_err());

    // Reset circuit breaker
    setup.marketplace_client.reset_circuit_breaker(&setup.admin);

    // Purchase should now succeed
    setup.marketplace_client.purchase_credits(
        &setup.buyer,
        &String::from_str(&env, batch_id),
        &100,
    );
    let listing = setup.marketplace_client.get_listing(&String::from_str(&env, batch_id));
    assert_eq!(listing.available_amount, amount - 100);
}

// ============================================
# Snapshot Tests
// ============================================

#[test]
fn test_snapshot_register_project() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    let project_id = create_test_project(&env, &setup);
    let project = setup.registry_client.get_project(&project_id);
    
    // Snapshot will be saved to contracts/carbon_registry/test_snapshots/
    // This is a placeholder - actual snapshot would be created with insta or similar
    assert_eq!(project.methodology_score, 85);
    assert_eq!(project.status, 0);
}

#[test]
fn test_snapshot_credit_batch() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    let project_id = create_test_project(&env, &setup);
    verify_project(&env, &setup, &project_id);
    mint_credits(&env, &setup, &project_id, 1000, "batch-snap", 1, 1000);

    let batch = setup.credit_client.get_credit_batch(&String::from_str(&env, "batch-snap"));
    assert_eq!(batch.amount, 1000);
    assert_eq!(batch.status, CreditStatus::Active);
}

#[test]
fn test_snapshot_marketplace_listing() {
    let env = Env::default();
    let setup = setup_test_environment(&env);

    let project_id = create_test_project(&env, &setup);
    verify_project(&env, &setup, &project_id);
    mint_credits(&env, &setup, &project_id, 1000, "batch-market", 1, 1000);
    list_credits(&env, &setup, "batch-market", LISTING_PRICE);

    let listing = setup.marketplace_client.get_listing(&String::from_str(&env, "batch-market"));
    assert_eq!(listing.price_per_credit, LISTING_PRICE);
    assert_eq!(listing.available_amount, 1000);
    assert_eq!(listing.status, 0);
}
