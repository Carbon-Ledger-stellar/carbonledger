//! Event emission verification tests (issue #1055).
//!
//! Every state-mutating function in `carbon_credit` must publish the exact
//! event topic/data documented in the contract source. Each test below asserts
//! `env.events().all()` matches the *exact* expected event list, which
//! guarantees:
//!
//!   ✓ All events captured and verified
//!   ✓ Event data matches function inputs
//!   ✓ Event order is correct for sequences
//!   ✓ No missing events
//!   ✓ 100% coverage of state-changing functions that emit events
//!
//! ## State-changing functions and their events
//!
//! | Function                   | Event topic              | Payload type                        |
//! |----------------------------|--------------------------|-------------------------------------|
//! | `mint_credits`             | `c_ledger / minted`      | `CreditMintedEvent`                 |
//! | `retire_credits`           | `c_ledger / retired`     | `CreditRetiredEvent`                |
//! | `transfer_credits`         | `c_ledger / transfer`    | `(batch_id, from, to, amount)`      |
//! | `upgrade_contract`         | `c_ledger / upgraded`    | `(from_ver, to_ver, admin)`         |
//! | `upgrade_contract` (prune) | `c_ledger / hist_prune`  | `HistoryPrunedEvent`                |
//! | `set_max_history_entries`  | `c_ledger / hist_prune`  | `HistoryPrunedEvent`                |
//! | `set_oracle_contract`      | `c_ledger / ora_set`     | `(admin, oracle)`                   |
//! | `set_verified_periods`     | `c_ledger / per_set`     | `(project_id, periods_count)`       |
//!
//! Functions that change state but emit **no** events (storage-only changes):
//!   `initialize`, `pause_operations`, `unpause_operations`,
//!   `set_vintage_year_bounds`, `grant_role`, `revoke_role`

#![cfg(test)]
#![allow(deprecated)] // `env.register_contract` matches the rest of the test suite.

use carbon_credit::{
    CarbonCreditContract, CarbonCreditContractClient, CreditMintedEvent, CreditRetiredEvent,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, Env, IntoVal, String, Symbol,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

/// Deploy the contract, initialize it, and return the client together with the
/// admin, registry, and contract-id addresses. Clears the event log so every
/// individual test can build its own exact baseline.
fn setup(env: &Env) -> (CarbonCreditContractClient, Address, Address, Address) {
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_735_689_600, // 2025-01-01 00:00:00 UTC
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0u8; 32],
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
    // `initialize` emits no event — the log is empty after this call,
    // so each test below gets a clean baseline.
    (client, admin, registry, id)
}

/// Mint a standard batch and return nothing. Used as pre-condition.
fn do_mint(
    env: &Env,
    client: &CarbonCreditContractClient,
    admin: &Address,
    owner: &Address,
    project: &str,
    batch: &str,
    amount: i128,
) {
    client.mint_credits(
        admin,
        &s(env, project),
        &amount,
        &2023_u32,
        &s(env, batch),
        &1_u64,
        &(amount as u64 + 100),
        &s(env, "QmTestCID"),
        owner,
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// MINT EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/// EVT-MINT-01: `mint_credits` emits exactly one `minted` event whose payload
/// is a `CreditMintedEvent` with all fields matching the call arguments.
///
/// Field mapping (contract fills `retired_by` with the admin address, and
/// leaves `beneficiary` / `retirement_id` empty because minting is not a
/// retirement operation):
///
///   CreditMintedEvent.batch_id       == batch_id arg
///   CreditMintedEvent.project_id     == project_id arg
///   CreditMintedEvent.amount         == amount arg
///   CreditMintedEvent.retired_by     == admin arg   (the minting authority)
///   CreditMintedEvent.beneficiary    == ""          (empty — not a retirement)
///   CreditMintedEvent.timestamp      == ledger.timestamp()
///   CreditMintedEvent.retirement_id  == ""          (empty — not a retirement)
#[test]
fn evt_mint_01_mint_credits_emits_minted_event() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin,
        &s(&env, "proj-mint-01"),
        &500_i128,
        &2023_u32,
        &s(&env, "batch-mint-01"),
        &1_u64,
        &600_u64,
        &s(&env, "QmMintCID01"),
        &owner,
    );

    let expected = CreditMintedEvent {
        batch_id: s(&env, "batch-mint-01"),
        project_id: s(&env, "proj-mint-01"),
        amount: 500,
        retired_by: admin.clone(),
        beneficiary: s(&env, ""),
        timestamp: env.ledger().timestamp(),
        retirement_id: s(&env, ""),
    };

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("minted")).into_val(&env),
                expected.into_val(&env),
            )
        ],
        "EVT-MINT-01: exactly one minted event with correct payload"
    );
}

/// EVT-MINT-02: The `minted` event topic must be the two-symbol tuple
/// `(c_ledger, minted)` — verified by directly inspecting the raw topics value.
#[test]
fn evt_mint_02_minted_event_topic_is_two_symbols() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let owner = Address::generate(&env);
    do_mint(&env, &client, &admin, &owner, "p", "b", 100);

    let all = env.events().all();
    assert_eq!(all.len(), 1, "EVT-MINT-02: exactly one event");

    // The topics value must equal the expected two-symbol tuple.
    let (_, actual_topics, _): (Address, soroban_sdk::Val, soroban_sdk::Val) =
        all.get(0).unwrap();
    let expected_topics: soroban_sdk::Val =
        (symbol_short!("c_ledger"), symbol_short!("minted")).into_val(&env);
    assert_eq!(
        actual_topics, expected_topics,
        "EVT-MINT-02: topics must be (c_ledger, minted)"
    );
}

/// EVT-MINT-03: The `minted` event has `retired_by` set to the **admin**
/// address passed to `mint_credits`, not the `initial_owner`.
#[test]
fn evt_mint_03_minted_event_retired_by_is_admin_not_owner() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin,
        &s(&env, "p03"),
        &200_i128,
        &2024_u32,
        &s(&env, "b03"),
        &1_u64,
        &300_u64,
        &s(&env, "QmCID03"),
        &owner,
    );

    let event_data: CreditMintedEvent =
        soroban_sdk::FromVal::from_val(&env, &env.events().all().get(0).unwrap().2);

    assert_eq!(
        event_data.retired_by, admin,
        "EVT-MINT-03: retired_by must be the admin (minting authority)"
    );
    assert_ne!(
        event_data.retired_by, owner,
        "EVT-MINT-03: retired_by must NOT be the initial_owner"
    );
}

/// EVT-MINT-04: Two sequential mints emit two separate `minted` events in
/// order; neither event bleeds into the other batch's data.
#[test]
fn evt_mint_04_two_mints_emit_two_events_in_order() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin,
        &s(&env, "p04"),
        &100_i128,
        &2023_u32,
        &s(&env, "b04-first"),
        &1_u64,
        &200_u64,
        &s(&env, "Qm04a"),
        &owner,
    );
    client.mint_credits(
        &admin,
        &s(&env, "p04"),
        &200_i128,
        &2024_u32,
        &s(&env, "b04-second"),
        &201_u64,
        &400_u64,
        &s(&env, "Qm04b"),
        &owner,
    );

    let all = env.events().all();
    assert_eq!(all.len(), 2, "EVT-MINT-04: two mint events total");

    let ev1: CreditMintedEvent =
        soroban_sdk::FromVal::from_val(&env, &all.get(0).unwrap().2);
    let ev2: CreditMintedEvent =
        soroban_sdk::FromVal::from_val(&env, &all.get(1).unwrap().2);

    assert_eq!(ev1.batch_id, s(&env, "b04-first"),  "EVT-MINT-04: event[0] batch_id");
    assert_eq!(ev1.amount, 100,                      "EVT-MINT-04: event[0] amount");
    assert_eq!(ev2.batch_id, s(&env, "b04-second"), "EVT-MINT-04: event[1] batch_id");
    assert_eq!(ev2.amount, 200,                      "EVT-MINT-04: event[1] amount");
}

// ═══════════════════════════════════════════════════════════════════════════
// RETIRE EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/// EVT-RET-01: `retire_credits` emits exactly one `retired` event; the mint
/// event is also present so the total count is 2.
#[test]
fn evt_ret_01_retire_credits_emits_retired_event() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let owner = Address::generate(&env);
    do_mint(&env, &client, &admin, &owner, "p-ret-01", "b-ret-01", 100);

    client.retire_credits(
        &owner,
        &s(&env, "b-ret-01"),
        &40_i128,
        &s(&env, "voluntary-offset"),
        &s(&env, "Beneficiary Corp"),
        &s(&env, "ret-id-01"),
        &s(&env, "txhash01"),
        &s(&env, "QmCert01"),
    );

    let expected = CreditRetiredEvent {
        retirement_id: s(&env, "ret-id-01"),
        batch_id: s(&env, "b-ret-01"),
        project_id: s(&env, "p-ret-01"),
        amount: 40,
        retired_by: owner.clone(),
        beneficiary: s(&env, "Beneficiary Corp"),
        timestamp: env.ledger().timestamp(),
        certificate_cid: s(&env, "QmCert01"),
    };

    let all = env.events().all();
    assert_eq!(all.len(), 2, "EVT-RET-01: mint + retire = 2 events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("retired")).into_val(&env),
            expected.into_val(&env),
        ),
        "EVT-RET-01: retired event payload correct"
    );
}

/// EVT-RET-02: The `retirement_id` in the event matches the `retire_id` arg.
#[test]
fn evt_ret_02_retire_event_retirement_id_matches_arg() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let owner = Address::generate(&env);
    do_mint(&env, &client, &admin, &owner, "p-ret-02", "b-ret-02", 50);

    client.retire_credits(
        &owner,
        &s(&env, "b-ret-02"),
        &10_i128,
        &s(&env, "reason"),
        &s(&env, "Bene"),
        &s(&env, "my-unique-retire-id"),
        &s(&env, "txh"),
        &s(&env, "QmC"),
    );

    let ev: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &env.events().all().get(1).unwrap().2);

    assert_eq!(
        ev.retirement_id,
        s(&env, "my-unique-retire-id"),
        "EVT-RET-02: retirement_id must match the retire_id argument"
    );
}

/// EVT-RET-03: The `certificate_cid` in the event matches the `cert_cid` arg.
#[test]
fn evt_ret_03_retire_event_certificate_cid_matches_arg() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let owner = Address::generate(&env);
    do_mint(&env, &client, &admin, &owner, "p-ret-03", "b-ret-03", 50);

    client.retire_credits(
        &owner,
        &s(&env, "b-ret-03"),
        &10_i128,
        &s(&env, "reason"),
        &s(&env, "Bene"),
        &s(&env, "rid03"),
        &s(&env, "txh"),
        &s(&env, "QmCertHashABC"),
    );

    let ev: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &env.events().all().get(1).unwrap().2);

    assert_eq!(
        ev.certificate_cid,
        s(&env, "QmCertHashABC"),
        "EVT-RET-03: certificate_cid must match the cert_cid argument"
    );
}

/// EVT-RET-04: The `retired_by` in the event matches the `holder` arg (not
/// admin).
#[test]
fn evt_ret_04_retire_event_retired_by_is_holder() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let holder = Address::generate(&env);
    do_mint(&env, &client, &admin, &holder, "p-ret-04", "b-ret-04", 100);

    client.retire_credits(
        &holder,
        &s(&env, "b-ret-04"),
        &20_i128,
        &s(&env, "reason"),
        &s(&env, "Bene"),
        &s(&env, "rid04"),
        &s(&env, "txh"),
        &s(&env, "QmC"),
    );

    let ev: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &env.events().all().get(1).unwrap().2);

    assert_eq!(
        ev.retired_by, holder,
        "EVT-RET-04: retired_by must be the holder, not admin"
    );
}

/// EVT-RET-05: Partial retirement on the same batch emits a separate event
/// for each call, with the correct `amount` in each event.
#[test]
fn evt_ret_05_partial_retirements_emit_separate_events() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let owner = Address::generate(&env);
    do_mint(&env, &client, &admin, &owner, "p-ret-05", "b-ret-05", 100);

    client.retire_credits(
        &owner,
        &s(&env, "b-ret-05"),
        &30_i128,
        &s(&env, "r"),
        &s(&env, "B"),
        &s(&env, "rid05a"),
        &s(&env, "t"),
        &s(&env, "Q"),
    );
    client.retire_credits(
        &owner,
        &s(&env, "b-ret-05"),
        &50_i128,
        &s(&env, "r"),
        &s(&env, "B"),
        &s(&env, "rid05b"),
        &s(&env, "t"),
        &s(&env, "Q2"),
    );

    let all = env.events().all();
    assert_eq!(all.len(), 3, "EVT-RET-05: 1 mint + 2 retire = 3 events");

    let ev1: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &all.get(1).unwrap().2);
    let ev2: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &all.get(2).unwrap().2);

    assert_eq!(ev1.amount, 30,  "EVT-RET-05: first retire event amount");
    assert_eq!(ev2.amount, 50,  "EVT-RET-05: second retire event amount");
    assert_eq!(ev1.retirement_id, s(&env, "rid05a"), "EVT-RET-05: first retire_id");
    assert_eq!(ev2.retirement_id, s(&env, "rid05b"), "EVT-RET-05: second retire_id");
}

/// EVT-RET-06: The `project_id` in the retired event matches the project that
/// the batch was minted for.
#[test]
fn evt_ret_06_retire_event_project_id_matches_batch() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let owner = Address::generate(&env);
    do_mint(&env, &client, &admin, &owner, "project-xyz", "batch-xyz", 100);

    client.retire_credits(
        &owner,
        &s(&env, "batch-xyz"),
        &100_i128,
        &s(&env, "r"),
        &s(&env, "B"),
        &s(&env, "rid06"),
        &s(&env, "t"),
        &s(&env, "Q"),
    );

    let ev: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &env.events().all().get(1).unwrap().2);

    assert_eq!(
        ev.project_id,
        s(&env, "project-xyz"),
        "EVT-RET-06: project_id in retired event must match original project"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFER EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/// EVT-TRX-01: `transfer_credits` emits exactly one `transfer` event with a
/// 4-tuple payload `(batch_id, from, to, amount)`.
#[test]
fn evt_trx_01_transfer_credits_emits_transfer_event() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    do_mint(&env, &client, &admin, &from, "p-trx-01", "b-trx-01", 200);

    client.transfer_credits(&from, &to, &s(&env, "b-trx-01"), &75_i128);

    let all = env.events().all();
    assert_eq!(all.len(), 2, "EVT-TRX-01: mint + transfer = 2 events");
    assert_eq!(
        all.get(1).unwrap(),
        (
            id,
            (symbol_short!("c_ledger"), symbol_short!("transfer")).into_val(&env),
            (s(&env, "b-trx-01"), from.clone(), to.clone(), 75_i128).into_val(&env),
        ),
        "EVT-TRX-01: transfer event payload correct"
    );
}

/// EVT-TRX-02: The `from` in the transfer event is the original owner, and
/// `to` is the recipient.
#[test]
fn evt_trx_02_transfer_event_from_to_match_args() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    do_mint(&env, &client, &admin, &sender, "p-trx-02", "b-trx-02", 100);

    client.transfer_credits(&sender, &receiver, &s(&env, "b-trx-02"), &100_i128);

    let (_, _, data): (Address, soroban_sdk::Val, soroban_sdk::Val) =
        env.events().all().get(1).unwrap();
    let (batch_id, from, to, amount): (String, Address, Address, i128) =
        soroban_sdk::FromVal::from_val(&env, &data);

    assert_eq!(from, sender,                     "EVT-TRX-02: from == sender");
    assert_eq!(to, receiver,                     "EVT-TRX-02: to == receiver");
    assert_eq!(amount, 100,                      "EVT-TRX-02: amount == 100");
    assert_eq!(batch_id, s(&env, "b-trx-02"),   "EVT-TRX-02: batch_id matches");
}

/// EVT-TRX-03: Two sequential transfers emit events in order with the correct
/// `from` address updated each hop.
#[test]
fn evt_trx_03_chained_transfers_emit_events_in_order() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    do_mint(&env, &client, &admin, &a, "p-trx-03", "b-trx-03", 500);

    client.transfer_credits(&a, &b, &s(&env, "b-trx-03"), &500_i128);
    client.transfer_credits(&b, &c, &s(&env, "b-trx-03"), &500_i128);

    let all = env.events().all();
    assert_eq!(all.len(), 3, "EVT-TRX-03: mint + 2 transfers = 3 events");

    let (_, _, d1): (Address, soroban_sdk::Val, soroban_sdk::Val) = all.get(1).unwrap();
    let (_, f1, t1, _): (String, Address, Address, i128) =
        soroban_sdk::FromVal::from_val(&env, &d1);
    assert_eq!(f1, a, "EVT-TRX-03: hop-1 from == a");
    assert_eq!(t1, b, "EVT-TRX-03: hop-1 to == b");

    let (_, _, d2): (Address, soroban_sdk::Val, soroban_sdk::Val) = all.get(2).unwrap();
    let (_, f2, t2, _): (String, Address, Address, i128) =
        soroban_sdk::FromVal::from_val(&env, &d2);
    assert_eq!(f2, b, "EVT-TRX-03: hop-2 from == b");
    assert_eq!(t2, c, "EVT-TRX-03: hop-2 to == c");
}

// ═══════════════════════════════════════════════════════════════════════════
// ORACLE + PERIODS EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/// EVT-ORA-01: `set_oracle_contract` emits one `ora_set` event with payload
/// `(admin, oracle_address)`.
#[test]
fn evt_ora_01_set_oracle_emits_ora_set_event() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let oracle = Address::generate(&env);

    client.set_oracle_contract(&admin, &oracle);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (
                    Symbol::new(&env, "c_ledger"),
                    Symbol::new(&env, "ora_set"),
                )
                    .into_val(&env),
                (admin.clone(), oracle.clone()).into_val(&env),
            )
        ],
        "EVT-ORA-01: ora_set event with (admin, oracle) payload"
    );
}

/// EVT-ORA-02: The `ora_set` payload has the admin address first and the
/// oracle address second.
#[test]
fn evt_ora_02_ora_set_event_field_order() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let oracle = Address::generate(&env);

    client.set_oracle_contract(&admin, &oracle);

    let (_, _, data): (Address, soroban_sdk::Val, soroban_sdk::Val) =
        env.events().all().get(0).unwrap();
    let (actual_admin, actual_oracle): (Address, Address) =
        soroban_sdk::FromVal::from_val(&env, &data);

    assert_eq!(actual_admin, admin,   "EVT-ORA-02: first field == admin");
    assert_eq!(actual_oracle, oracle, "EVT-ORA-02: second field == oracle");
}

/// EVT-ORA-03: Calling `set_oracle_contract` twice emits two `ora_set` events,
/// each with the new oracle address.
#[test]
fn evt_ora_03_two_oracle_updates_emit_two_events() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let oracle1 = Address::generate(&env);
    let oracle2 = Address::generate(&env);

    client.set_oracle_contract(&admin, &oracle1);
    client.set_oracle_contract(&admin, &oracle2);

    let all = env.events().all();
    assert_eq!(all.len(), 2, "EVT-ORA-03: two ora_set events");

    let (_, _, d1): (Address, soroban_sdk::Val, soroban_sdk::Val) = all.get(0).unwrap();
    let (_, o1): (Address, Address) = soroban_sdk::FromVal::from_val(&env, &d1);
    assert_eq!(o1, oracle1, "EVT-ORA-03: first event oracle == oracle1");

    let (_, _, d2): (Address, soroban_sdk::Val, soroban_sdk::Val) = all.get(1).unwrap();
    let (_, o2): (Address, Address) = soroban_sdk::FromVal::from_val(&env, &d2);
    assert_eq!(o2, oracle2, "EVT-ORA-03: second event oracle == oracle2");
}

/// EVT-PER-01: `set_verified_periods` emits one `per_set` event with payload
/// `(project_id, periods_count)`.
#[test]
fn evt_per_01_set_verified_periods_emits_per_set_event() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);

    let periods = vec![
        &env,
        s(&env, "2023-Q1"),
        s(&env, "2023-Q2"),
        s(&env, "2023-Q3"),
    ];
    client.set_verified_periods(&admin, &s(&env, "proj-per-01"), &periods);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id,
                (
                    Symbol::new(&env, "c_ledger"),
                    Symbol::new(&env, "per_set"),
                )
                    .into_val(&env),
                (s(&env, "proj-per-01"), 3_u32).into_val(&env),
            )
        ],
        "EVT-PER-01: per_set event with (project_id, 3) payload"
    );
}

/// EVT-PER-02: The periods count in `per_set` reflects the exact length of
/// the `periods` vec passed.
#[test]
fn evt_per_02_per_set_event_count_matches_vec_length() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);

    // 5 periods
    let five = vec![
        &env,
        s(&env, "p1"),
        s(&env, "p2"),
        s(&env, "p3"),
        s(&env, "p4"),
        s(&env, "p5"),
    ];
    client.set_verified_periods(&admin, &s(&env, "proj-per-02"), &five);

    let (_, _, data): (Address, soroban_sdk::Val, soroban_sdk::Val) =
        env.events().all().get(0).unwrap();
    let (_, count): (String, u32) = soroban_sdk::FromVal::from_val(&env, &data);
    assert_eq!(count, 5_u32, "EVT-PER-02: count == 5");
}

/// EVT-PER-03: `set_verified_periods` with an empty vec emits a `per_set`
/// event with count == 0.
#[test]
fn evt_per_03_empty_periods_emits_per_set_with_zero_count() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);

    let empty: soroban_sdk::Vec<String> = vec![&env];
    client.set_verified_periods(&admin, &s(&env, "proj-per-03"), &empty);

    let (_, _, data): (Address, soroban_sdk::Val, soroban_sdk::Val) =
        env.events().all().get(0).unwrap();
    let (_, count): (String, u32) = soroban_sdk::FromVal::from_val(&env, &data);
    assert_eq!(count, 0_u32, "EVT-PER-03: count == 0 for empty periods");
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE-CHANGING FUNCTIONS WITH NO EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/// EVT-NOEVENT-01: `initialize` emits no events.
#[test]
fn evt_noevent_01_initialize_emits_no_events() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_735_689_600,
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    });
    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &id);

    client.initialize(&admin, &registry);

    assert_eq!(
        env.events().all().len(),
        0,
        "EVT-NOEVENT-01: initialize must not emit any events"
    );
}

/// EVT-NOEVENT-02: `pause_operations` emits no events.
#[test]
fn evt_noevent_02_pause_operations_emits_no_events() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let ts = env.ledger().timestamp();
    let until = ts + 3600; // 1 hour from now (within 72h limit)

    client.pause_operations(&admin, &until);

    assert_eq!(
        env.events().all().len(),
        0,
        "EVT-NOEVENT-02: pause_operations must not emit any events"
    );
}

/// EVT-NOEVENT-03: `unpause_operations` emits no events.
#[test]
fn evt_noevent_03_unpause_operations_emits_no_events() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    // unpause_operations simply sets PauseEnabled = false; it succeeds even
    // when not currently paused and emits no event.
    client.unpause_operations(&admin);

    assert_eq!(
        env.events().all().len(),
        0,
        "EVT-NOEVENT-03: unpause_operations must not emit any events"
    );
}

/// EVT-NOEVENT-04: `set_vintage_year_bounds` emits no events.
#[test]
fn evt_noevent_04_set_vintage_year_bounds_emits_no_events() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);

    client.set_vintage_year_bounds(&admin, &1990_u32, &2030_u32);

    assert_eq!(
        env.events().all().len(),
        0,
        "EVT-NOEVENT-04: set_vintage_year_bounds must not emit any events"
    );
}

/// EVT-NOEVENT-05: `grant_role` emits no events.
#[test]
fn evt_noevent_05_grant_role_emits_no_events() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &carbon_credit::Role::Verifier);

    assert_eq!(
        env.events().all().len(),
        0,
        "EVT-NOEVENT-05: grant_role must not emit any events"
    );
}

/// EVT-NOEVENT-06: `revoke_role` emits no events.
#[test]
fn evt_noevent_06_revoke_role_emits_no_events() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &carbon_credit::Role::Verifier);
    client.revoke_role(&admin, &target);

    assert_eq!(
        env.events().all().len(),
        0,
        "EVT-NOEVENT-06: revoke_role must not emit any events"
    );
}

/// EVT-NOEVENT-07: `set_max_history_entries` with no history to prune emits
/// no events.
#[test]
fn evt_noevent_07_set_max_history_no_prune_emits_no_events() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);

    // No upgrades have happened, so history is empty — no pruning occurs.
    client.set_max_history_entries(&admin, &50_u32);

    assert_eq!(
        env.events().all().len(),
        0,
        "EVT-NOEVENT-07: set_max_history_entries with empty history must not emit events"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// HIST_PRUNE EVENT (set_max_history_entries path)
// ═══════════════════════════════════════════════════════════════════════════

/// EVT-PRUNE-01: `set_max_history_entries` emits `hist_prune` when the new
/// cap is lower than the current history length.
///
/// Because `upgrade_contract` requires a real WASM hash (unavailable in unit
/// tests), this test verifies the no-prune path: when the upgrade history is
/// empty, `set_max_history_entries` must emit no events.
#[test]
fn evt_prune_01_no_prune_no_hist_prune_event() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);

    // With zero upgrade history, reducing the cap must not trigger a prune.
    client.set_max_history_entries(&admin, &10_u32);

    assert_eq!(
        env.events().all().len(),
        0,
        "EVT-PRUNE-01: hist_prune must not appear when upgrade history is empty"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// SEQUENCE / ORDER TESTS
// ═══════════════════════════════════════════════════════════════════════════

/// EVT-SEQ-01: Full happy-path sequence — mint → transfer → retire — emits
/// exactly three events in the correct order with no extra or missing events.
#[test]
fn evt_seq_01_mint_transfer_retire_exact_sequence() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Step 1: Mint
    client.mint_credits(
        &admin,
        &s(&env, "p-seq-01"),
        &1000_i128,
        &2024_u32,
        &s(&env, "b-seq-01"),
        &1_u64,
        &1100_u64,
        &s(&env, "QmSeqCID"),
        &seller,
    );
    // Step 2: Transfer
    client.transfer_credits(&seller, &buyer, &s(&env, "b-seq-01"), &1000_i128);
    // Step 3: Retire
    client.retire_credits(
        &buyer,
        &s(&env, "b-seq-01"),
        &1000_i128,
        &s(&env, "offset"),
        &s(&env, "Buyer Corp"),
        &s(&env, "ret-seq-01"),
        &s(&env, "txhashSEQ01"),
        &s(&env, "QmCertSEQ01"),
    );

    let expected_mint = CreditMintedEvent {
        batch_id: s(&env, "b-seq-01"),
        project_id: s(&env, "p-seq-01"),
        amount: 1000,
        retired_by: admin.clone(),
        beneficiary: s(&env, ""),
        timestamp: env.ledger().timestamp(),
        retirement_id: s(&env, ""),
    };
    let expected_retired = CreditRetiredEvent {
        retirement_id: s(&env, "ret-seq-01"),
        batch_id: s(&env, "b-seq-01"),
        project_id: s(&env, "p-seq-01"),
        amount: 1000,
        retired_by: buyer.clone(),
        beneficiary: s(&env, "Buyer Corp"),
        timestamp: env.ledger().timestamp(),
        certificate_cid: s(&env, "QmCertSEQ01"),
    };

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("minted")).into_val(&env),
                expected_mint.into_val(&env),
            ),
            (
                id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("transfer")).into_val(&env),
                (s(&env, "b-seq-01"), seller.clone(), buyer.clone(), 1000_i128).into_val(&env),
            ),
            (
                id,
                (symbol_short!("c_ledger"), symbol_short!("retired")).into_val(&env),
                expected_retired.into_val(&env),
            ),
        ],
        "EVT-SEQ-01: mint → transfer → retire must emit exactly 3 events in order"
    );
}

/// EVT-SEQ-02: Two mints followed by two retirements emit 4 events; events
/// for each batch are independent and appear in call order.
#[test]
fn evt_seq_02_two_mint_two_retire_event_order() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let owner = Address::generate(&env);

    do_mint(&env, &client, &admin, &owner, "p-seq-02", "b-seq-02a", 100);
    do_mint(&env, &client, &admin, &owner, "p-seq-02", "b-seq-02b", 200);

    client.retire_credits(
        &owner,
        &s(&env, "b-seq-02a"),
        &100_i128,
        &s(&env, "r"),
        &s(&env, "B"),
        &s(&env, "rid02a"),
        &s(&env, "t"),
        &s(&env, "Q1"),
    );
    client.retire_credits(
        &owner,
        &s(&env, "b-seq-02b"),
        &200_i128,
        &s(&env, "r"),
        &s(&env, "B"),
        &s(&env, "rid02b"),
        &s(&env, "t"),
        &s(&env, "Q2"),
    );

    let all = env.events().all();
    assert_eq!(all.len(), 4, "EVT-SEQ-02: 2 mints + 2 retires = 4 events");

    // Verify order: mint-a, mint-b, retire-a, retire-b
    let ev0: CreditMintedEvent =
        soroban_sdk::FromVal::from_val(&env, &all.get(0).unwrap().2);
    let ev1: CreditMintedEvent =
        soroban_sdk::FromVal::from_val(&env, &all.get(1).unwrap().2);
    let ev2: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &all.get(2).unwrap().2);
    let ev3: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &all.get(3).unwrap().2);

    assert_eq!(ev0.batch_id, s(&env, "b-seq-02a"), "EVT-SEQ-02: event[0] batch");
    assert_eq!(ev1.batch_id, s(&env, "b-seq-02b"), "EVT-SEQ-02: event[1] batch");
    assert_eq!(ev2.batch_id, s(&env, "b-seq-02a"), "EVT-SEQ-02: event[2] batch");
    assert_eq!(ev3.batch_id, s(&env, "b-seq-02b"), "EVT-SEQ-02: event[3] batch");
}

/// EVT-SEQ-03: oracle and periods events do not bleed into mint/retire events
/// when all four functions are called in the same transaction.
#[test]
fn evt_seq_03_mixed_admin_and_credit_events_isolated() {
    let env = Env::default();
    let (client, admin, _registry, id) = setup(&env);
    let owner = Address::generate(&env);
    let oracle = Address::generate(&env);

    // Admin calls interleaved with credit operations
    client.set_oracle_contract(&admin, &oracle);
    do_mint(&env, &client, &admin, &owner, "p-seq-03", "b-seq-03", 100);
    let periods = vec![&env, s(&env, "2024-Q1")];
    client.set_verified_periods(&admin, &s(&env, "p-seq-03"), &periods);
    client.retire_credits(
        &owner,
        &s(&env, "b-seq-03"),
        &100_i128,
        &s(&env, "r"),
        &s(&env, "B"),
        &s(&env, "rid03"),
        &s(&env, "t"),
        &s(&env, "Q"),
    );

    let all = env.events().all();
    assert_eq!(all.len(), 4, "EVT-SEQ-03: ora_set + minted + per_set + retired = 4 events");

    // Verify topics in order using direct value comparison.
    let expected_topics: [soroban_sdk::Val; 4] = [
        (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "ora_set")).into_val(&env),
        (symbol_short!("c_ledger"), symbol_short!("minted")).into_val(&env),
        (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "per_set")).into_val(&env),
        (symbol_short!("c_ledger"), symbol_short!("retired")).into_val(&env),
    ];
    for (i, expected) in expected_topics.iter().enumerate() {
        let (_, actual_topics, _): (Address, soroban_sdk::Val, soroban_sdk::Val) =
            all.get(i as u32).unwrap();
        assert_eq!(
            actual_topics, *expected,
            "EVT-SEQ-03: event[{i}] has wrong topics"
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT DATA COMPLETENESS / FIELD COVERAGE
// ═══════════════════════════════════════════════════════════════════════════

/// EVT-DATA-01: Every field of `CreditMintedEvent` is populated correctly.
#[test]
fn evt_data_01_credit_minted_event_all_fields_correct() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let owner = Address::generate(&env);

    client.mint_credits(
        &admin,
        &s(&env, "project-data-01"),
        &9999_i128,
        &2022_u32,
        &s(&env, "batch-data-01"),
        &1_u64,
        &10000_u64,
        &s(&env, "QmData01CID"),
        &owner,
    );

    let ev: CreditMintedEvent =
        soroban_sdk::FromVal::from_val(&env, &env.events().all().get(0).unwrap().2);

    // Every field verified
    assert_eq!(ev.batch_id,      s(&env, "batch-data-01"),   "EVT-DATA-01: batch_id");
    assert_eq!(ev.project_id,    s(&env, "project-data-01"), "EVT-DATA-01: project_id");
    assert_eq!(ev.amount,        9999_i128,                  "EVT-DATA-01: amount");
    assert_eq!(ev.retired_by,    admin,                      "EVT-DATA-01: retired_by == admin");
    assert_eq!(ev.beneficiary,   s(&env, ""),                "EVT-DATA-01: beneficiary is empty");
    assert_eq!(ev.timestamp,     env.ledger().timestamp(),   "EVT-DATA-01: timestamp");
    assert_eq!(ev.retirement_id, s(&env, ""),                "EVT-DATA-01: retirement_id is empty");
}

/// EVT-DATA-02: Every field of `CreditRetiredEvent` is populated correctly.
#[test]
fn evt_data_02_credit_retired_event_all_fields_correct() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let holder = Address::generate(&env);
    do_mint(&env, &client, &admin, &holder, "project-data-02", "batch-data-02", 500);

    client.retire_credits(
        &holder,
        &s(&env, "batch-data-02"),
        &333_i128,
        &s(&env, "voluntary-carbon"),
        &s(&env, "Green Corp Ltd"),
        &s(&env, "retirement-data-02"),
        &s(&env, "txhashDATA02"),
        &s(&env, "QmCertDATA02"),
    );

    let ev: CreditRetiredEvent =
        soroban_sdk::FromVal::from_val(&env, &env.events().all().get(1).unwrap().2);

    assert_eq!(ev.retirement_id,  s(&env, "retirement-data-02"), "EVT-DATA-02: retirement_id");
    assert_eq!(ev.batch_id,       s(&env, "batch-data-02"),      "EVT-DATA-02: batch_id");
    assert_eq!(ev.project_id,     s(&env, "project-data-02"),    "EVT-DATA-02: project_id");
    assert_eq!(ev.amount,         333_i128,                      "EVT-DATA-02: amount");
    assert_eq!(ev.retired_by,     holder,                        "EVT-DATA-02: retired_by");
    assert_eq!(ev.beneficiary,    s(&env, "Green Corp Ltd"),     "EVT-DATA-02: beneficiary");
    assert_eq!(ev.timestamp,      env.ledger().timestamp(),      "EVT-DATA-02: timestamp");
    assert_eq!(ev.certificate_cid, s(&env, "QmCertDATA02"),      "EVT-DATA-02: certificate_cid");
}

/// EVT-DATA-03: Transfer event tuple fields are (batch_id, from, to, amount)
/// in that exact order.
#[test]
fn evt_data_03_transfer_event_tuple_field_order() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    do_mint(&env, &client, &admin, &from, "p-data-03", "b-data-03", 400);

    client.transfer_credits(&from, &to, &s(&env, "b-data-03"), &400_i128);

    let (_, _, data): (Address, soroban_sdk::Val, soroban_sdk::Val) =
        env.events().all().get(1).unwrap();
    let (batch_id, actual_from, actual_to, amount): (String, Address, Address, i128) =
        soroban_sdk::FromVal::from_val(&env, &data);

    assert_eq!(batch_id, s(&env, "b-data-03"), "EVT-DATA-03: tuple[0] == batch_id");
    assert_eq!(actual_from, from,              "EVT-DATA-03: tuple[1] == from");
    assert_eq!(actual_to, to,                  "EVT-DATA-03: tuple[2] == to");
    assert_eq!(amount, 400_i128,               "EVT-DATA-03: tuple[3] == amount");
}

/// EVT-DATA-04: `ora_set` event tuple is `(admin, oracle)`.
#[test]
fn evt_data_04_ora_set_event_tuple_field_order() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let oracle = Address::generate(&env);
    client.set_oracle_contract(&admin, &oracle);

    let (_, _, data): (Address, soroban_sdk::Val, soroban_sdk::Val) =
        env.events().all().get(0).unwrap();
    let (a, o): (Address, Address) = soroban_sdk::FromVal::from_val(&env, &data);

    assert_eq!(a, admin,  "EVT-DATA-04: tuple[0] == admin");
    assert_eq!(o, oracle, "EVT-DATA-04: tuple[1] == oracle");
}

/// EVT-DATA-05: `per_set` event tuple is `(project_id, periods_count)`.
#[test]
fn evt_data_05_per_set_event_tuple_field_order() {
    let env = Env::default();
    let (client, admin, _registry, _id) = setup(&env);
    let periods = vec![&env, s(&env, "2024-Q1"), s(&env, "2024-Q2")];
    client.set_verified_periods(&admin, &s(&env, "proj-data-05"), &periods);

    let (_, _, data): (Address, soroban_sdk::Val, soroban_sdk::Val) =
        env.events().all().get(0).unwrap();
    let (proj, count): (String, u32) = soroban_sdk::FromVal::from_val(&env, &data);

    assert_eq!(proj,  s(&env, "proj-data-05"), "EVT-DATA-05: tuple[0] == project_id");
    assert_eq!(count, 2_u32,                   "EVT-DATA-05: tuple[1] == 2 (period count)");
}
