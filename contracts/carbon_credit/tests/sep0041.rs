#![cfg(feature = "sep-0041")]
#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient};

#[test]
fn test_mock_freighter_wallet_call() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);
    
    // Mock Freighter wallet checking token metadata and balance
    assert_eq!(client.decimals(), 7);
    assert_eq!(client.name(), String::from_str(&env, "Carbon Credit"));
    assert_eq!(client.symbol(), String::from_str(&env, "CREDIT"));
    
    let user = Address::generate(&env);
    let balance = client.balance(&user);
    assert_eq!(balance, 0);
}
