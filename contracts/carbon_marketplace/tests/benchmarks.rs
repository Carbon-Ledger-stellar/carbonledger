//! Performance regression benchmarks (issue #642).
//!
//! Methodology, including why `reads`/`writes` are hand-derived rather than
//! dynamically measured, is documented in `docs/benchmarking.md`. The
//! per-listing declared IO for `bulk_purchase` reuses the analysis already
//! committed in `docs/resource-profile.md`.

#![cfg(test)]
#![allow(deprecated)]

use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient};
use carbon_marketplace::{CarbonMarketplaceContract, CarbonMarketplaceContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Env, String,
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

struct DeclaredIo {
    reads: u32,
    writes: u32,
}

fn report(name: &str, cpu_instructions: u64, mem_bytes: u64, io: DeclaredIo) {
    println!(
        "BENCH_RESULT {{\"function\":\"{name}\",\"cpu_instructions\":{cpu_instructions},\"mem_bytes\":{mem_bytes},\"reads\":{reads},\"writes\":{writes}}}",
        name = name,
        cpu_instructions = cpu_instructions,
        mem_bytes = mem_bytes,
        reads = io.reads,
        writes = io.writes,
    );
}

/// docs/resource-profile.md: 3 shared reads (UsdcToken, Admin,
/// CreditContract) + ~9 reads / 8 writes per listing. Benchmarked with a
/// 2-listing batch: reads = 3 + 9*2 = 21, writes = 8*2 = 16.
#[test]
fn bench_list_credits() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let seller = Address::generate(&env);
    let registry = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract(admin.clone());

    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit_client = CarbonCreditContractClient::new(&env, &credit_id);
    credit_client.initialize(&admin, &registry);

    let mkt_id = env.register_contract(None, CarbonMarketplaceContract);
    let mkt = CarbonMarketplaceContractClient::new(&env, &mkt_id);
    mkt.initialize(&admin, &usdc, &credit_id, &treasury);

    credit_client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &seller,
    );

    let before_cpu = env.budget().cpu_instruction_cost();
    let before_mem = env.budget().memory_bytes_cost();

    mkt.list_credits(
        &seller,
        &s(&env, "list-001"),
        &s(&env, "batch-001"),
        &s(&env, "proj-001"),
        &100_i128,
        &1_0000000_i128,
        &2023_u32,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    );

    let cpu = env.budget().cpu_instruction_cost() - before_cpu;
    let mem = env.budget().memory_bytes_cost() - before_mem;
    report("list_credits", cpu, mem, DeclaredIo { reads: 2, writes: 2 });
}

#[test]
fn bench_purchase_credits() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let registry = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract(admin.clone());

    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit_client = CarbonCreditContractClient::new(&env, &credit_id);
    credit_client.initialize(&admin, &registry);

    let mkt_id = env.register_contract(None, CarbonMarketplaceContract);
    let mkt = CarbonMarketplaceContractClient::new(&env, &mkt_id);
    mkt.initialize(&admin, &usdc, &credit_id, &treasury);

    credit_client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &seller,
    );
    mkt.list_credits(
        &seller,
        &s(&env, "list-001"),
        &s(&env, "batch-001"),
        &s(&env, "proj-001"),
        &100_i128,
        &1_0000000_i128,
        &2023_u32,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    );
    token::StellarAssetClient::new(&env, &usdc).mint(&buyer, &1_000_0000000_i128);

    let before_cpu = env.budget().cpu_instruction_cost();
    let before_mem = env.budget().memory_bytes_cost();

    mkt.purchase_credits(&buyer, &s(&env, "list-001"), &10_i128);

    let cpu = env.budget().cpu_instruction_cost() - before_cpu;
    let mem = env.budget().memory_bytes_cost() - before_mem;
    report("purchase_credits", cpu, mem, DeclaredIo { reads: 4, writes: 3 });
}

#[test]
fn bench_get_active_listings() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let seller = Address::generate(&env);
    let registry = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract(admin.clone());

    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit_client = CarbonCreditContractClient::new(&env, &credit_id);
    credit_client.initialize(&admin, &registry);

    let mkt_id = env.register_contract(None, CarbonMarketplaceContract);
    let mkt = CarbonMarketplaceContractClient::new(&env, &mkt_id);
    mkt.initialize(&admin, &usdc, &credit_id, &treasury);

    credit_client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &seller,
    );
    mkt.list_credits(
        &seller,
        &s(&env, "list-001"),
        &s(&env, "batch-001"),
        &s(&env, "proj-001"),
        &100_i128,
        &1_0000000_i128,
        &2023_u32,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
    );

    let before_cpu = env.budget().cpu_instruction_cost();
    let before_mem = env.budget().memory_bytes_cost();

    let _active = mkt.get_active_listings();

    let cpu = env.budget().cpu_instruction_cost() - before_cpu;
    let mem = env.budget().memory_bytes_cost() - before_mem;
    report("get_active_listings", cpu, mem, DeclaredIo { reads: 2, writes: 0 });
}

#[test]
fn bench_bulk_purchase() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info());

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let seller = Address::generate(&env);
    let registry = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract(admin.clone());

    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit_client = CarbonCreditContractClient::new(&env, &credit_id);
    credit_client.initialize(&admin, &registry);

    let mkt_id = env.register_contract(None, CarbonMarketplaceContract);
    let mkt = CarbonMarketplaceContractClient::new(&env, &mkt_id);
    mkt.initialize(&admin, &usdc, &credit_id, &treasury);

    for (batch_id, project_id, listing_id, price) in [
        ("batch-001", "proj-001", "list-001", 1_0000000_i128),
        ("batch-002", "proj-002", "list-002", 2_0000000_i128),
    ] {
        credit_client.mint_credits(
            &admin,
            &s(&env, project_id),
            &100_i128,
            &2023_u32,
            &s(&env, batch_id),
            &1_u64,
            &100_u64,
            &s(&env, "QmCID"),
            &seller,
        );
        mkt.list_credits(
            &seller,
            &s(&env, listing_id),
            &s(&env, batch_id),
            &s(&env, project_id),
            &100_i128,
            &price,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );
    }

    let buyer = Address::generate(&env);
    token::StellarAssetClient::new(&env, &usdc).mint(&buyer, &1_000_0000000_i128);

    let ids = vec![&env, s(&env, "list-001"), s(&env, "list-002")];
    let amounts = vec![&env, 10_i128, 5_i128];

    let before_cpu = env.budget().cpu_instruction_cost();
    let before_mem = env.budget().memory_bytes_cost();

    mkt.bulk_purchase(&buyer, &ids, &amounts);

    let cpu = env.budget().cpu_instruction_cost() - before_cpu;
    let mem = env.budget().memory_bytes_cost() - before_mem;
    report(
        "bulk_purchase",
        cpu,
        mem,
        DeclaredIo {
            reads: 21,
            writes: 16,
        },
    );
}
