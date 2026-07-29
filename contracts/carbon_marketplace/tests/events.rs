//! Event emission verification tests (issue #640).
//!
//! Asserts the exact event topic/data published by every state-mutating
//! `carbon_marketplace` function, including the secondary `transfer` event
//! that `carbon_credit::transfer_credits` emits during a cross-contract
//! purchase. Schema is documented in `docs/contract-events.md`.

#![cfg(test)]
#![allow(deprecated)]

use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient};
use carbon_marketplace::{
    CarbonMarketplaceContract, CarbonMarketplaceContractClient, ListingCreatedEvent,
    PurchaseCompletedEvent,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    token, vec, Address, Env, IntoVal, String,
};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn ledger_info() -> soroban_sdk::testutils::LedgerInfo {
    soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_735_689_600, // 2025-01-01
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    }
}

/// Marketplace-only setup — no live credit contract behind `credit_contract`.
/// Sufficient for list/delist/suspend, which never cross-call.
fn setup(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address, Address, Address, Address) {
    env.mock_all_auths();
    env.ledger().set(ledger_info());
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let seller = Address::generate(env);
    let usdc = env.register_stellar_asset_contract(admin.clone());
    let credit_id = env.register_contract(None, CarbonCreditContract);
    let id = env.register_contract(None, CarbonMarketplaceContract);
    let client = CarbonMarketplaceContractClient::new(env, &id);
    client.initialize(&admin, &usdc, &credit_id, &treasury);
    (client, admin, treasury, seller, usdc, id)
}

/// Full setup with a live, initialized credit contract and a real minted
/// batch owned by `seller`, so `purchase_credits`/`bulk_purchase` can
/// complete their cross-contract `transfer_credits` call and emit events.
struct PurchaseFixture<'a> {
    mkt: CarbonMarketplaceContractClient<'a>,
    mkt_id: Address,
    credit_id: Address,
    admin: Address,
    treasury: Address,
    seller: Address,
    usdc: Address,
}

fn setup_with_credits(env: &Env) -> PurchaseFixture {
    env.mock_all_auths();
    env.ledger().set(ledger_info());
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let seller = Address::generate(env);
    let registry = Address::generate(env);
    let usdc = env.register_stellar_asset_contract(admin.clone());

    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit_client = CarbonCreditContractClient::new(env, &credit_id);
    credit_client.initialize(&admin, &registry);

    let mkt_id = env.register_contract(None, CarbonMarketplaceContract);
    let mkt = CarbonMarketplaceContractClient::new(env, &mkt_id);
    mkt.initialize(&admin, &usdc, &credit_id, &treasury);

    PurchaseFixture {
        mkt,
        mkt_id,
        credit_id,
        admin,
        treasury,
        seller,
        usdc,
    }
}

fn mint_batch(env: &Env, fx: &PurchaseFixture, batch_id: &str, project_id: &str, amount: i128) {
    let credit_client = CarbonCreditContractClient::new(env, &fx.credit_id);
    credit_client.mint_credits(
        &fx.admin,
        &s(env, project_id),
        &amount,
        &2023_u32,
        &s(env, batch_id),
        &1_u64,
        &(amount as u64),
        &s(env, "QmCID"),
        &fx.seller,
    );
}

fn mint_usdc(env: &Env, fx: &PurchaseFixture, to: &Address, amount: i128) {
    let usdc_admin = token::StellarAssetClient::new(env, &fx.usdc);
    usdc_admin.mint(to, &amount);
}

fn add_listing(env: &Env, fx: &PurchaseFixture, listing_id: &str, batch_id: &str, project_id: &str, amount: i128, price: i128) {
    fx.mkt.list_credits(
        &fx.seller,
        &s(env, listing_id),
        &s(env, batch_id),
        &s(env, project_id),
        &amount,
        &price,
        &2023_u32,
        &s(env, "VCS"),
        &s(env, "Brazil"),
    );
}

#[test]
fn test_list_credits_emits_listed_event() {
    let env = Env::default();
    let (client, _admin, _treasury, seller, _usdc, id) = setup(&env);

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
    );

    let expected = ListingCreatedEvent {
        listing_id: s(&env, "list-001"),
        seller: seller.clone(),
        batch_id: s(&env, "batch-001"),
        amount: 100,
        price_per_credit: 10_0000000,
        timestamp: env.ledger().timestamp(),
    };

    let all = env.events().all();
    assert_eq!(all.len(), 1);
    assert_eq!(
        all.get(0).unwrap(),
        (
            id.clone(),
            (symbol_short!("c_ledger"), symbol_short!("listed")).into_val(&env),
            expected.into_val(&env),
        )
    );
}

#[test]
fn test_delist_credits_emits_delisted_event() {
    let env = Env::default();
    let (client, _admin, _treasury, seller, _usdc, id) = setup(&env);
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
    );

    client.delist_credits(&seller, &s(&env, "list-001"));

    let all = env.events().all();
    assert_eq!(all.len(), 2, "expected listed + delisted events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id.clone(),
            (symbol_short!("c_ledger"), symbol_short!("delisted")).into_val(&env),
            (s(&env, "list-001"), seller.clone()).into_val(&env),
        )
    );
}

#[test]
fn test_suspend_project_emits_mkt_susp_event() {
    let env = Env::default();
    let (client, admin, _treasury, _seller, _usdc, id) = setup(&env);

    client.suspend_project(&admin, &s(&env, "proj-001"));

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("mkt_susp")).into_val(&env),
                s(&env, "proj-001").into_val(&env),
            )
        ]
    );
}

#[test]
fn test_purchase_credits_emits_purchase_event() {
    let env = Env::default();
    let fx = setup_with_credits(&env);
    mint_batch(&env, &fx, "batch-001", "proj-001", 100);
    add_listing(&env, &fx, "list-001", "batch-001", "proj-001", 100, 10_0000000);

    let buyer = Address::generate(&env);
    mint_usdc(&env, &fx, &buyer, 1_000_0000000);

    fx.mkt.purchase_credits(&buyer, &s(&env, "list-001"), &10_i128);

    let total_cost = 10_i128 * 10_0000000;
    let expected_purchase = PurchaseCompletedEvent {
        listing_id: s(&env, "list-001"),
        buyer: buyer.clone(),
        seller: fx.seller.clone(),
        amount: 10,
        total_cost,
        timestamp: env.ledger().timestamp(),
    };

    // The cross-contract `transfer_credits` call on carbon_credit publishes
    // its own "transfer" event before the marketplace publishes "purchase".
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                fx.credit_id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("transfer")).into_val(&env),
                (
                    s(&env, "batch-001"),
                    fx.seller.clone(),
                    buyer.clone(),
                    10_i128
                )
                    .into_val(&env),
            ),
            (
                fx.mkt_id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("purchase")).into_val(&env),
                expected_purchase.into_val(&env),
            ),
        ]
    );
}

#[test]
fn test_bulk_purchase_emits_bulk_buy_event_per_listing() {
    let env = Env::default();
    let fx = setup_with_credits(&env);
    mint_batch(&env, &fx, "batch-001", "proj-001", 100);
    mint_batch(&env, &fx, "batch-002", "proj-002", 100);
    add_listing(&env, &fx, "list-001", "batch-001", "proj-001", 100, 1_0000000);
    add_listing(&env, &fx, "list-002", "batch-002", "proj-002", 100, 2_0000000);

    let buyer = Address::generate(&env);
    mint_usdc(&env, &fx, &buyer, 1_000_0000000);

    let ids = vec![&env, s(&env, "list-001"), s(&env, "list-002")];
    let amounts = vec![&env, 10_i128, 5_i128];
    fx.mkt.bulk_purchase(&buyer, &ids, &amounts);

    let all = env.events().all();
    // Per listing: one "transfer" event from carbon_credit + one "bulk_buy"
    // event from carbon_marketplace = 4 events total, in listing order.
    assert_eq!(all.len(), 4);

    let (c0, t0, _) = all.get(0).unwrap();
    assert_eq!(c0, fx.credit_id);
    assert_eq!(
        t0,
        (symbol_short!("c_ledger"), symbol_short!("transfer")).into_val(&env)
    );

    let (c1, t1, d1) = all.get(1).unwrap();
    assert_eq!(c1, fx.mkt_id);
    assert_eq!(
        t1,
        (symbol_short!("c_ledger"), symbol_short!("bulk_buy")).into_val(&env)
    );
    let expected0 = PurchaseCompletedEvent {
        listing_id: s(&env, "list-001"),
        buyer: buyer.clone(),
        seller: fx.seller.clone(),
        amount: 10,
        total_cost: 10 * 1_0000000,
        timestamp: env.ledger().timestamp(),
    };
    assert_eq!(d1, expected0.into_val(&env));

    let (c2, t2, _) = all.get(2).unwrap();
    assert_eq!(c2, fx.credit_id);
    assert_eq!(
        t2,
        (symbol_short!("c_ledger"), symbol_short!("transfer")).into_val(&env)
    );

    let (c3, t3, d3) = all.get(3).unwrap();
    assert_eq!(c3, fx.mkt_id);
    assert_eq!(
        t3,
        (symbol_short!("c_ledger"), symbol_short!("bulk_buy")).into_val(&env)
    );
    let expected1 = PurchaseCompletedEvent {
        listing_id: s(&env, "list-002"),
        buyer: buyer.clone(),
        seller: fx.seller.clone(),
        amount: 5,
        total_cost: 5 * 2_0000000,
        timestamp: env.ledger().timestamp(),
    };
    assert_eq!(d3, expected1.into_val(&env));
}

/// Happy-path flow: list -> purchase -> delist must emit exactly the
/// documented events, in order, with nothing extra or missing.
#[test]
fn test_happy_path_emits_exact_event_sequence() {
    let env = Env::default();
    let fx = setup_with_credits(&env);
    mint_batch(&env, &fx, "batch-001", "proj-001", 100);

    fx.mkt.list_credits(
        &fx.seller,
        &s(&env, "list-001"),
        &s(&env, "batch-001"),
        &s(&env, "proj-001"),
        &100_i128,
        &10_0000000_i128,
        &2023_u32,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    );

    let buyer = Address::generate(&env);
    mint_usdc(&env, &fx, &buyer, 1_000_0000000);
    fx.mkt.purchase_credits(&buyer, &s(&env, "list-001"), &50_i128);

    let listed = ListingCreatedEvent {
        listing_id: s(&env, "list-001"),
        seller: fx.seller.clone(),
        batch_id: s(&env, "batch-001"),
        amount: 100,
        price_per_credit: 10_0000000,
        timestamp: env.ledger().timestamp(),
    };
    let purchased = PurchaseCompletedEvent {
        listing_id: s(&env, "list-001"),
        buyer: buyer.clone(),
        seller: fx.seller.clone(),
        amount: 50,
        total_cost: 50 * 10_0000000,
        timestamp: env.ledger().timestamp(),
    };

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                fx.mkt_id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("listed")).into_val(&env),
                listed.into_val(&env),
            ),
            (
                fx.credit_id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("transfer")).into_val(&env),
                (s(&env, "batch-001"), fx.seller.clone(), buyer.clone(), 50_i128).into_val(&env),
            ),
            (
                fx.mkt_id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("purchase")).into_val(&env),
                purchased.into_val(&env),
            ),
        ]
    );
}
