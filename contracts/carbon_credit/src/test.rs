#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, String, Symbol,
};
use crate::{
    CarbonCreditContract, CarbonCreditContractClient,
    CarbonError, METHODOLOGY_SCORE_MIN,
};

#[test]
fn test_mint_succeeds_at_score_70() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let registry_address = Address::generate(&env);
    let caller = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin, &registry_address);

    // Project with score 70 (minimum threshold)
    let project_id = 1;
    let amount = 5;
    let vintage_year = 2024;

    // Mint should succeed at score 70
    let result = client.try_mint_credits(&caller, &project_id, &amount, &vintage_year);
    assert!(result.is_ok());
}

#[test]
fn test_mint_fails_at_score_69() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let registry_address = Address::generate(&env);
    let caller = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin, &registry_address);

    // Project with score 69 (below threshold)
    let project_id = 2;
    let amount = 5;
    let vintage_year = 2024;

    // Mint should fail at score 69
    let result = client.try_mint_credits(&caller, &project_id, &amount, &vintage_year);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), CarbonError::MethodologyScoreLow);
}

#[test]
fn test_mint_fails_at_score_0() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let registry_address = Address::generate(&env);
    let caller = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin, &registry_address);

    // Project with score 0 (failing score)
    let project_id = 3;
    let amount = 5;
    let vintage_year = 2024;

    // Mint should fail at score 0
    let result = client.try_mint_credits(&caller, &project_id, &amount, &vintage_year);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), CarbonError::MethodologyScoreLow);
}

#[test]
fn test_mint_succeeds_with_high_score() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let registry_address = Address::generate(&env);
    let caller = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin, &registry_address);

    // Project with high score (90)
    let project_id = 4;
    let amount = 5;
    let vintage_year = 2024;

    // Mint should succeed
    let result = client.try_mint_credits(&caller, &project_id, &amount, &vintage_year);
    assert!(result.is_ok());
}

#[test]
fn test_get_methodology_score_min_constant() {
    let env = Env::default();

    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);

    let min_score = client.get_methodology_score_min();
    assert_eq!(min_score, 70);
}

#[test]
fn test_mint_fails_with_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let registry_address = Address::generate(&env);
    let caller = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin, &registry_address);

    // Project with valid score
    let project_id = 5;
    let amount = 0; // Invalid amount
    let vintage_year = 2024;

    // Mint should fail with InvalidAmount
    let result = client.try_mint_credits(&caller, &project_id, &amount, &vintage_year);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), CarbonError::InvalidAmount);
}
