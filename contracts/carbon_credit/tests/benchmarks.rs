//! Performance regression benchmarks (issue #642).
//!
//! Methodology, including why `reads`/`writes` are hand-derived rather than
//! dynamically measured, is documented in `docs/benchmarking.md`.

#![cfg(test)]

use carbon_credit::{CarbonCreditContract, CarbonCreditContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn setup(env: &Env) -> (CarbonCreditContractClient, Address, Address) {
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
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
    let registry = Address::generate(env);
    let id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(env, &id);
    client.initialize(&admin, &registry);
    (client, admin, registry)
}

/// Hand-derived ledger read/write *operation-site* counts (not deduplicated
/// unique keys) — see docs/benchmarking.md. Update alongside the function.
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

/// Reads: has(Batch), get(SerialRegistry) x2 [verify_serial_range_internal
/// + ranges load], has(Batch) [extend_batch_ttl], get(ProjectBatches) = 5
/// Writes: set(SerialRegistry), set(Batch), extend_ttl(Batch),
/// set(ProjectBatches) = 4
#[test]
fn bench_mint_credits() {
    let env = Env::default();
    let (client, admin, _registry) = setup(&env);
    let owner = Address::generate(&env);

    let before_cpu = env.budget().cpu_instruction_cost();
    let before_mem = env.budget().memory_bytes_cost();

    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let cpu = env.budget().cpu_instruction_cost() - before_cpu;
    let mem = env.budget().memory_bytes_cost() - before_mem;
    report("mint_credits", cpu, mem, DeclaredIo { reads: 5, writes: 4 });
}

/// Reads: get(Batch) [load_batch], get(BatchRetired), has(Batch)
/// [extend_batch_ttl] = 3
/// Writes: extend_ttl(Batch) [load_batch], set(BatchRetired), set(Batch),
/// extend_ttl(Batch) [extend_batch_ttl], set(Retirement) = 5
#[test]
fn bench_retire_credits() {
    let env = Env::default();
    let (client, admin, _registry) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let before_cpu = env.budget().cpu_instruction_cost();
    let before_mem = env.budget().memory_bytes_cost();

    client.retire_credits(
        &owner,
        &s(&env, "batch-001"),
        &40_i128,
        &s(&env, "offset"),
        &s(&env, "beneficiary"),
        &s(&env, "retire-001"),
        &s(&env, "tx-hash"),
        &s(&env, "QmCert"),
    );

    let cpu = env.budget().cpu_instruction_cost() - before_cpu;
    let mem = env.budget().memory_bytes_cost() - before_mem;
    report("retire_credits", cpu, mem, DeclaredIo { reads: 3, writes: 5 });
}

/// Reads: get(SerialRegistry) = 1. Writes: 0 (read-only function).
#[test]
fn bench_verify_serial_range() {
    let env = Env::default();
    let (client, admin, _registry) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin,
        &s(&env, "proj-001"),
        &100_i128,
        &2023_u32,
        &s(&env, "batch-001"),
        &1_u64,
        &100_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let before_cpu = env.budget().cpu_instruction_cost();
    let before_mem = env.budget().memory_bytes_cost();

    client.verify_serial_range(&500_u64, &600_u64);

    let cpu = env.budget().cpu_instruction_cost() - before_cpu;
    let mem = env.budget().memory_bytes_cost() - before_mem;
    report(
        "verify_serial_range",
        cpu,
        mem,
        DeclaredIo { reads: 1, writes: 0 },
    );
}
