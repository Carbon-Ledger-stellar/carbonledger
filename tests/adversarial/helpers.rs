//! Shared test helpers for the adversarial test suite.

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use carbon_registry::{CarbonRegistryContract, CarbonRegistryContractClient};

/// Convert a `&str` to a Soroban `String`.
pub fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

/// Deploy and initialize a fresh carbon_registry contract.
/// Returns `(client, admin, oracle, verifier)`.
pub fn make_registry(env: &Env) -> (CarbonRegistryContractClient, Address, Address, Address) {
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_735_689_600, // 2025-01-01
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    });
    let admin = Address::generate(env);
    let oracle = Address::generate(env);
    let verifier = Address::generate(env);
    let mut verifiers = soroban_sdk::vec![env];
    verifiers.push_back(verifier.clone());

    let id = env.register_contract(None, CarbonRegistryContract);
    let client = CarbonRegistryContractClient::new(env, &id);
    client.initialize(&admin, &oracle, &verifiers).unwrap();

    (client, admin, oracle, verifier)
}
