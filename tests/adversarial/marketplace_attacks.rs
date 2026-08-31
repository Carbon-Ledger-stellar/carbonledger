//! # Marketplace Attack Scenarios
//!
//! Attack narratives covered:
//!
//! | Test | Attack | Error |
//! |------|--------|-------|
//! | test_list_suspended_project | Attacker lists credits from a project that was suspended for investigation | ProjectSuspended (3) |
//! | test_purchase_nonexistent | Attacker purchases from a listing ID that was never created | ListingNotFound (10) |
//! | test_purchase_more_than_listed | Attacker buys more credits than the listing contains | InsufficientLiquidity (11) |
//! | test_purchase_delisted | Attacker attempts to buy from a listing that was explicitly delisted | ListingNotFound (10) |
//! | test_zero_amount_purchase | Attacker purchases zero credits hoping to trigger a free token transfer | ZeroAmountNotAllowed (16) |
//! | test_zero_price_listing | Attacker creates a listing with price = 0 to drain buyer USDC with no payment | ZeroAmountNotAllowed (16) |
//! | test_delist_by_non_seller | Attacker delists a competitor's listing to sabotage their sales | UnauthorizedVerifier (7) |
//! | test_purchase_suspended_project | Attacker purchases from an active listing after project is suspended | ProjectSuspended (3) |
//! | test_double_initialize | Attacker calls initialize() a second time to replace admin and fee recipient | AlreadyInitialized (19) |
//! | test_non_admin_suspend_project | Non-admin tries to suspend a project via marketplace | UnauthorizedVerifier (7) |
//! | test_bulk_purchase_length_mismatch | Attacker crafts a mismatched arrays bulk_purchase call | InvalidSerialRange (18) |
//! | test_vintage_year_invalid_listing | Attacker lists credits with an invalid vintage year 1985 | InvalidVintageYear (9) |
//! | test_non_admin_update_treasury | Attacker redirects protocol fees to their own address | UnauthorizedVerifier (7) |

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use carbon_credit::CarbonCreditContract;
use carbon_marketplace::{CarbonMarketplaceContract, CarbonMarketplaceContractClient, CarbonError};

use super::helpers::s;

fn setup_marketplace(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address) {
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
    let treasury = Address::generate(env);
    let usdc = env.register_stellar_asset_contract(admin.clone());
    let credit_id = env.register_contract(None, CarbonCreditContract);
    let id = env.register_contract(None, CarbonMarketplaceContract);
    let client = CarbonMarketplaceContractClient::new(env, &id);
    client.initialize(&admin, &usdc, &credit_id, &treasury).unwrap();
    (client, admin, treasury)
}

fn add_listing(env: &Env, client: &CarbonMarketplaceContractClient, seller: &Address, project_id: &str, listing_id: &str) {
    client.list_credits(
        seller,
        &s(env, listing_id),
        &s(env, "batch-001"),
        &s(env, project_id),
        &100_i128,
        &10_0000000_i128,
        &2023_u32,
        &s(env, "VCS"),
        &s(env, "Brazil"),
    ).unwrap();
}

// ── Attack 1: list credits from suspended project ────────────────────────────
/// ATTACK: A project developer attempts to list and sell credits from a project
/// that has been suspended pending investigation for methodology fraud.
#[test]
fn test_list_suspended_project() {
    let env = Env::default();
    let (client, admin, _) = setup_marketplace(&env);
    let seller = Address::generate(&env);

    // Admin suspends the project.
    client.suspend_project(&admin, &s(&env, "proj-suspended")).unwrap();

    let result = client.try_list_credits(
        &seller,
        &s(&env, "list-susp"),
        &s(&env, "batch-susp"),
        &s(&env, "proj-suspended"),
        &100_i128,
        &10_0000000_i128,
        &2023_u32,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
}

// ── Attack 2: purchase from nonexistent listing ───────────────────────────────
/// ATTACK: An attacker crafts a purchase for a listing_id that was never
/// created — hoping to exploit a missing-key path or trigger a default value.
#[test]
fn test_purchase_nonexistent() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let buyer = Address::generate(&env);

    let result = client.try_purchase_credits(&buyer, &s(&env, "listing-ghost"), &10_i128);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ListingNotFound);
}

// ── Attack 3: purchase more than listed ──────────────────────────────────────
/// ATTACK: A buyer requests 999 credits from a listing that only has 100,
/// attempting to drain more credits than the seller authorized.
#[test]
fn test_purchase_more_than_listed() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    add_listing(&env, &client, &seller, "proj-liq", "list-liq");

    let result = client.try_purchase_credits(&buyer, &s(&env, "list-liq"), &999_i128);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InsufficientLiquidity);
}

// ── Attack 4: purchase from delisted listing ─────────────────────────────────
/// ATTACK: A seller delists their credits (changing their mind), but the attacker
/// replays a previously captured buy transaction to forcibly purchase the credits.
#[test]
fn test_purchase_delisted() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    add_listing(&env, &client, &seller, "proj-delist", "list-delist");
    client.delist_credits(&seller, &s(&env, "list-delist")).unwrap();

    let result = client.try_purchase_credits(&buyer, &s(&env, "list-delist"), &10_i128);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ListingNotFound);
}

// ── Attack 5: zero-amount purchase ───────────────────────────────────────────
/// ATTACK: An attacker buys 0 credits hoping to trigger a free USDC transfer
/// to themselves (amount × price = 0, bypassing payment) or to pollute events.
#[test]
fn test_zero_amount_purchase() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    add_listing(&env, &client, &seller, "proj-zero", "list-zero");

    let result = client.try_purchase_credits(&buyer, &s(&env, "list-zero"), &0_i128);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ZeroAmountNotAllowed);
}

// ── Attack 6: zero-price listing ─────────────────────────────────────────────
/// ATTACK: An attacker creates a listing with price_per_credit = 0 so that
/// buyers can acquire credits for free, then blames the seller for the loss.
#[test]
fn test_zero_price_listing() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let seller = Address::generate(&env);

    let result = client.try_list_credits(
        &seller,
        &s(&env, "list-free"),
        &s(&env, "batch-free"),
        &s(&env, "proj-free"),
        &100_i128,
        &0_i128, // zero price
        &2023_u32,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ZeroAmountNotAllowed);
}

// ── Attack 7: delist by non-seller ───────────────────────────────────────────
/// ATTACK: A competitor calls delist_credits() on a rival's active listing to
/// remove it from the marketplace and suppress competition.
#[test]
fn test_delist_by_non_seller() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let seller = Address::generate(&env);
    let attacker = Address::generate(&env);

    add_listing(&env, &client, &seller, "proj-delist2", "list-delist2");

    let result = client.try_delist_credits(&attacker, &s(&env, "list-delist2"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);
}

// ── Attack 8: purchase from an active listing after project suspension ────────
/// ATTACK: A project is suspended mid-flight; a buyer with a queued order
/// attempts to purchase credits from the suspended project's listing.
#[test]
fn test_purchase_suspended_project() {
    let env = Env::default();
    let (client, admin, _) = setup_marketplace(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    add_listing(&env, &client, &seller, "proj-active", "list-active");

    // Project is subsequently suspended.
    client.suspend_project(&admin, &s(&env, "proj-active")).unwrap();

    let result = client.try_purchase_credits(&buyer, &s(&env, "list-active"), &10_i128);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
}

// ── Attack 9: double-initialize marketplace ───────────────────────────────────
/// ATTACK: An attacker calls initialize() a second time to replace the admin,
/// USDC token, credit contract reference, and treasury address with their own.
#[test]
fn test_double_initialize() {
    let env = Env::default();
    let (client, admin, treasury) = setup_marketplace(&env);
    let usdc_alt = Address::generate(&env);
    let credit_alt = Address::generate(&env);

    let result = client.try_initialize(&admin, &usdc_alt, &credit_alt, &treasury);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::AlreadyInitialized);
}

// ── Attack 10: non-admin project suspension ───────────────────────────────────
/// ATTACK: A rogue user calls suspend_project() on the marketplace to block a
/// legitimate project from trading without having admin authority.
#[test]
fn test_non_admin_suspend_project() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let rogue = Address::generate(&env);

    let result = client.try_suspend_project(&rogue, &s(&env, "proj-target"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);
}

// ── Attack 11: bulk_purchase with mismatched array lengths ───────────────────
/// ATTACK: Attacker crafts a bulk_purchase call where listing_ids has 3 entries
/// but amounts has only 1, hoping to leave two listings' payments unprocessed
/// while receiving the credits.
#[test]
fn test_bulk_purchase_length_mismatch() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let buyer = Address::generate(&env);

    let ids = soroban_sdk::vec![
        &env,
        s(&env, "l1"),
        s(&env, "l2"),
        s(&env, "l3"),
    ];
    let amounts = soroban_sdk::vec![&env, 10_i128]; // only 1 amount for 3 listings

    let result = client.try_bulk_purchase(&buyer, &ids, &amounts);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidSerialRange);
}

// ── Attack 12: listing with invalid vintage year ──────────────────────────────
/// ATTACK: An attacker tries to list credits dated 1985 (before the protocol
/// minimum of 1990) to trade junk credits with no legitimate backing.
#[test]
fn test_vintage_year_invalid_listing() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let seller = Address::generate(&env);

    let result = client.try_list_credits(
        &seller,
        &s(&env, "list-old"),
        &s(&env, "batch-old"),
        &s(&env, "proj-old"),
        &100_i128,
        &10_0000000_i128,
        &1985_u32, // before 1990 minimum
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
}

// ── Attack 13: non-admin update treasury ─────────────────────────────────────
/// ATTACK: An attacker calls update_treasury() to redirect the 1% protocol fee
/// stream to their own wallet address, draining all future trading revenue.
#[test]
fn test_non_admin_update_treasury() {
    let env = Env::default();
    let (client, _, _) = setup_marketplace(&env);
    let attacker = Address::generate(&env);
    let attacker_wallet = Address::generate(&env);

    let result = client.try_update_treasury(&attacker, &attacker_wallet);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);
}
