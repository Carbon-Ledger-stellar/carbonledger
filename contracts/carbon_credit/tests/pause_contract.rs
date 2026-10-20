//! Acceptance-test suite for `pause_contract()` and `unpause_contract()`
//! (issues #1211, #1212, #1213).
//!
//! ## Acceptance criteria verified
//!
//! ### #1211 – is_paused storage flag
//! | ID        | Criterion                                                |
//! |-----------|----------------------------------------------------------|
//! | S-01      | Flag initialised to `false` on `initialize()`            |
//! | S-02      | `pause_contract()` sets flag to `true`                   |
//! | S-03      | `unpause_contract()` sets flag to `false`                |
//! | S-04      | Storage operations verified via `get_pause_state()`      |
//!
//! ### #1212 – `pause_contract()`
//! | ID        | Criterion                                                |
//! |-----------|----------------------------------------------------------|
//! | PC-01     | Admin-only: non-admin is rejected                        |
//! | PC-02     | Emits `PausedEvent` with admin address and timestamp     |
//! | PC-03     | Idempotent: calling twice succeeds without error         |
//! | PC-04     | Blocks state-mutating operations after call              |
//!
//! ### #1213 – `unpause_contract()`
//! | ID        | Criterion                                                |
//! |-----------|----------------------------------------------------------|
//! | UP-01     | Admin-only: non-admin is rejected                        |
//! | UP-02     | Emits `UnpausedEvent` with admin address and timestamp   |
//! | UP-03     | Idempotent: calling when already unpaused succeeds       |
//! | UP-04     | Restores state-mutating operations after call            |

#![cfg(test)]
#![allow(deprecated)] // env.register_contract matches rest of test suite

extern crate std;

use carbon_credit::{
    CarbonCreditContract, CarbonCreditContractClient, CarbonError, DataKey, PausedEvent,
    UnpausedEvent,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, Env, IntoVal, String,
};

// ── helpers ──────────────────────────────────────────────────────────────────

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn ledger_info() -> soroban_sdk::testutils::LedgerInfo {
    soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_735_689_600, // 2025-01-01 00:00:00 UTC
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    }
}

struct Fixture<'a> {
    client: CarbonCreditContractClient<'a>,
    id: Address,
    admin: Address,
}

impl<'a> Fixture<'a> {
    fn new(env: &'a Env) -> Self {
        env.mock_all_auths();
        env.ledger().set(ledger_info());

        let admin = Address::generate(env);
        let registry = Address::generate(env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(env, &id);
        client.initialize(&admin, &registry);

        // Remove the registry contract reference so mint calls do not try to
        // cross-invoke the registry (which is not deployed in unit tests).
        env.as_contract(&id, || {
            env.storage()
                .persistent()
                .remove(&DataKey::RegistryContract);
        });

        Self { client, id, admin }
    }

    fn now(&self, env: &Env) -> u64 {
        env.ledger().timestamp()
    }
}

/// Collect events published after `baseline` index.
fn events_since(env: &Env, baseline: u32) -> soroban_sdk::Vec<(Address, soroban_sdk::Vec<soroban_sdk::Val>, soroban_sdk::Val)> {
    let tail: std::vec::Vec<_> = env
        .events()
        .all()
        .into_iter()
        .skip(baseline as usize)
        .collect();
    soroban_sdk::Vec::from_slice(env, &tail)
}

fn mark(env: &Env) -> u32 {
    env.events().all().len()
}

fn do_mint(
    env: &Env,
    client: &CarbonCreditContractClient,
    admin: &Address,
    owner: &Address,
    batch: &str,
    serial_start: u64,
    amount: i128,
) {
    client.mint_credits(
        admin,
        &s(env, "proj-test"),
        &amount,
        &2023_u32,
        &s(env, batch),
        &serial_start,
        &(serial_start + amount as u64 + 100),
        &s(env, "QmTestCID"),
        owner,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// #1211 – Storage flag
// ─────────────────────────────────────────────────────────────────────────────

/// S-01: flag is `false` immediately after `initialize()`.
#[test]
fn s01_is_paused_flag_initialised_to_false() {
    let env = Env::default();
    let f = Fixture::new(&env);
    assert_eq!(
        f.client.get_pause_state(),
        false,
        "S-01: get_pause_state() must return false after initialize()"
    );
}

/// S-02: `pause_contract()` sets the flag to `true`.
#[test]
fn s02_pause_contract_sets_flag_true() {
    let env = Env::default();
    let f = Fixture::new(&env);
    f.client.pause_contract(&f.admin);
    assert_eq!(
        f.client.get_pause_state(),
        true,
        "S-02: get_pause_state() must return true after pause_contract()"
    );
}

/// S-03: `unpause_contract()` sets the flag back to `false`.
#[test]
fn s03_unpause_contract_clears_flag() {
    let env = Env::default();
    let f = Fixture::new(&env);
    f.client.pause_contract(&f.admin);
    f.client.unpause_contract(&f.admin);
    assert_eq!(
        f.client.get_pause_state(),
        false,
        "S-03: get_pause_state() must return false after unpause_contract()"
    );
}

/// S-04: `get_pause_state()` reflects the same storage observed by the
/// runtime guard (`require_not_paused`).
#[test]
fn s04_get_pause_state_matches_runtime_guard() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let owner = Address::generate(&env);

    // Initially unpaused – minting succeeds.
    assert!(!f.client.get_pause_state(), "S-04: pre-pause");
    do_mint(&env, &f.client, &f.admin, &owner, "b-s04-1", 1, 100);

    // Pause – minting must now fail.
    f.client.pause_contract(&f.admin);
    assert!(f.client.get_pause_state(), "S-04: during pause");
    assert!(
        f.client
            .try_mint_credits(
                &f.admin,
                &s(&env, "proj-test"),
                &100_i128,
                &2023_u32,
                &s(&env, "b-s04-2"),
                &201_u64,
                &300_u64,
                &s(&env, "QmCID"),
                &owner,
            )
            .is_err(),
        "S-04: mint must be rejected while paused"
    );

    // Unpause – minting succeeds again.
    f.client.unpause_contract(&f.admin);
    assert!(!f.client.get_pause_state(), "S-04: after unpause");
    do_mint(&env, &f.client, &f.admin, &owner, "b-s04-3", 301, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// #1212 – pause_contract()
// ─────────────────────────────────────────────────────────────────────────────

/// PC-01: non-admin is rejected with `UnauthorizedVerifier`.
#[test]
fn pc01_pause_contract_requires_admin() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let rogue = Address::generate(&env);

    let result = f.client.try_pause_contract(&rogue);
    assert_eq!(
        result.unwrap_err().unwrap(),
        CarbonError::UnauthorizedVerifier,
        "PC-01: non-admin must be rejected"
    );
}

/// PC-02: `pause_contract()` emits exactly one `(c_ledger, paused)` event
/// carrying a `PausedEvent` with the correct admin address and timestamp.
#[test]
fn pc02_pause_contract_emits_paused_event() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let base = mark(&env);
    let now = f.now(&env);

    f.client.pause_contract(&f.admin);

    let expected_event = PausedEvent {
        admin: f.admin.clone(),
        paused_at: now,
        reason: None,
    };

    assert_eq!(
        events_since(&env, base),
        vec![
            &env,
            (
                f.id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("paused")).into_val(&env),
                expected_event.into_val(&env),
            )
        ],
        "PC-02: exactly one paused event with PausedEvent payload"
    );
}

/// PC-02b: the `paused_at` timestamp in the event matches the ledger timestamp.
#[test]
fn pc02b_paused_event_timestamp_matches_ledger() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let now = f.now(&env);
    let base = mark(&env);

    f.client.pause_contract(&f.admin);

    let events = events_since(&env, base);
    let (_, _, data) = events.get(0).unwrap();
    let ev: PausedEvent = soroban_sdk::FromVal::from_val(&env, &data);

    assert_eq!(ev.paused_at, now, "PC-02b: paused_at must equal ledger timestamp");
    assert_eq!(ev.admin, f.admin, "PC-02b: admin must match caller");
}

/// PC-03: calling `pause_contract()` a second time when already paused
/// succeeds (idempotent) and emits another event.
#[test]
fn pc03_pause_contract_is_idempotent() {
    let env = Env::default();
    let f = Fixture::new(&env);

    // First call – should succeed.
    assert!(
        f.client.try_pause_contract(&f.admin).is_ok(),
        "PC-03: first pause_contract() must succeed"
    );
    // Second call – should also succeed (idempotent).
    assert!(
        f.client.try_pause_contract(&f.admin).is_ok(),
        "PC-03: second pause_contract() must succeed (idempotent)"
    );
    // Contract must still be paused.
    assert!(
        f.client.get_pause_state(),
        "PC-03: contract must be paused after two calls"
    );
}

/// PC-03b: idempotent double-pause does NOT leave the contract unpaused.
#[test]
fn pc03b_double_pause_leaves_contract_paused() {
    let env = Env::default();
    let f = Fixture::new(&env);
    f.client.pause_contract(&f.admin);
    f.client.pause_contract(&f.admin); // second call

    assert!(
        f.client.get_pause_state(),
        "PC-03b: two pause_contract() calls must leave the contract paused"
    );
}

/// PC-04: `pause_contract()` blocks `mint_credits`, `transfer_credits`, and
/// `retire_credits` immediately after the call.
#[test]
fn pc04_pause_contract_blocks_state_mutations() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Mint a batch before pausing.
    do_mint(&env, &f.client, &f.admin, &owner, "b-pc04", 1, 500);

    f.client.pause_contract(&f.admin);

    // mint must be blocked.
    assert_eq!(
        f.client
            .try_mint_credits(
                &f.admin,
                &s(&env, "proj-test"),
                &100_i128,
                &2023_u32,
                &s(&env, "b-pc04-blocked"),
                &701_u64,
                &800_u64,
                &s(&env, "QmCID"),
                &owner,
            )
            .unwrap_err()
            .unwrap(),
        CarbonError::EmergencyPaused,
        "PC-04: mint_credits must be rejected while paused"
    );

    // transfer must be blocked.
    assert_eq!(
        f.client
            .try_transfer_credits(&owner, &buyer, &s(&env, "b-pc04"), &100_i128)
            .unwrap_err()
            .unwrap(),
        CarbonError::EmergencyPaused,
        "PC-04: transfer_credits must be rejected while paused"
    );

    // retire must be blocked.
    assert_eq!(
        f.client
            .try_retire_credits(
                &owner,
                &s(&env, "b-pc04"),
                &100_i128,
                &s(&env, "reason"),
                &s(&env, "Corp"),
                &s(&env, "ret-pc04"),
                &s(&env, "tx"),
                &s(&env, "QmCert"),
            )
            .unwrap_err()
            .unwrap(),
        CarbonError::EmergencyPaused,
        "PC-04: retire_credits must be rejected while paused"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// #1213 – unpause_contract()
// ─────────────────────────────────────────────────────────────────────────────

/// UP-01: non-admin is rejected with `UnauthorizedVerifier`.
#[test]
fn up01_unpause_contract_requires_admin() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let rogue = Address::generate(&env);

    let result = f.client.try_unpause_contract(&rogue);
    assert_eq!(
        result.unwrap_err().unwrap(),
        CarbonError::UnauthorizedVerifier,
        "UP-01: non-admin must be rejected"
    );
}

/// UP-02: `unpause_contract()` emits exactly one `(c_ledger, unpaused)` event
/// carrying an `UnpausedEvent` with the correct admin address and timestamp.
#[test]
fn up02_unpause_contract_emits_unpaused_event() {
    let env = Env::default();
    let f = Fixture::new(&env);
    f.client.pause_contract(&f.admin);

    let base = mark(&env);
    // Advance time slightly so the unpaused_at timestamp is distinct from paused_at.
    env.ledger().with_mut(|l| l.timestamp += 600);
    let now_after = env.ledger().timestamp();

    f.client.unpause_contract(&f.admin);

    let expected_event = UnpausedEvent {
        admin: f.admin.clone(),
        unpaused_at: now_after,
        reason: None,
    };

    assert_eq!(
        events_since(&env, base),
        vec![
            &env,
            (
                f.id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("unpaused")).into_val(&env),
                expected_event.into_val(&env),
            )
        ],
        "UP-02: exactly one unpaused event with UnpausedEvent payload"
    );
}

/// UP-02b: the `unpaused_at` timestamp in the event matches the ledger.
#[test]
fn up02b_unpaused_event_timestamp_matches_ledger() {
    let env = Env::default();
    let f = Fixture::new(&env);
    f.client.pause_contract(&f.admin);

    env.ledger().with_mut(|l| l.timestamp += 300);
    let ts = env.ledger().timestamp();
    let base = mark(&env);

    f.client.unpause_contract(&f.admin);

    let events = events_since(&env, base);
    let (_, _, data) = events.get(0).unwrap();
    let ev: UnpausedEvent = soroban_sdk::FromVal::from_val(&env, &data);

    assert_eq!(ev.unpaused_at, ts, "UP-02b: unpaused_at must equal ledger timestamp");
    assert_eq!(ev.admin, f.admin, "UP-02b: admin must match caller");
}

/// UP-03: calling `unpause_contract()` when the contract is already unpaused
/// succeeds (idempotent) and emits an `UnpausedEvent`.
#[test]
fn up03_unpause_contract_is_idempotent() {
    let env = Env::default();
    let f = Fixture::new(&env);

    // Not paused — first unpause should succeed.
    assert!(
        f.client.try_unpause_contract(&f.admin).is_ok(),
        "UP-03: unpause_contract() when already unpaused must succeed"
    );
    // Second call — still succeeds.
    assert!(
        f.client.try_unpause_contract(&f.admin).is_ok(),
        "UP-03: second unpause_contract() must succeed (idempotent)"
    );
    // Contract must be unpaused.
    assert!(
        !f.client.get_pause_state(),
        "UP-03: contract must remain unpaused after repeated calls"
    );
}

/// UP-03b: idempotent double-unpause does NOT accidentally pause the contract.
#[test]
fn up03b_double_unpause_leaves_contract_unpaused() {
    let env = Env::default();
    let f = Fixture::new(&env);
    f.client.pause_contract(&f.admin);
    f.client.unpause_contract(&f.admin);
    f.client.unpause_contract(&f.admin); // second call

    assert!(
        !f.client.get_pause_state(),
        "UP-03b: two unpause_contract() calls must leave the contract unpaused"
    );
}

/// UP-04: `unpause_contract()` restores `mint_credits`, `transfer_credits`,
/// and `retire_credits` after they were blocked by `pause_contract()`.
#[test]
fn up04_unpause_contract_restores_state_mutations() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Pause.
    f.client.pause_contract(&f.admin);
    assert!(
        f.client
            .try_mint_credits(
                &f.admin,
                &s(&env, "proj-test"),
                &500_i128,
                &2023_u32,
                &s(&env, "b-up04"),
                &1_u64,
                &600_u64,
                &s(&env, "QmCID"),
                &owner,
            )
            .is_err(),
        "UP-04: mint must fail while paused"
    );

    // Unpause.
    f.client.unpause_contract(&f.admin);

    // Mint must now succeed.
    f.client.mint_credits(
        &f.admin,
        &s(&env, "proj-test"),
        &500_i128,
        &2023_u32,
        &s(&env, "b-up04"),
        &1_u64,
        &600_u64,
        &s(&env, "QmCID"),
        &owner,
    );

    let batch = f.client.get_credit_batch(&s(&env, "b-up04"));
    assert_eq!(batch.amount, 500, "UP-04: mint_credits succeeded after unpause");

    // Transfer must now succeed.
    f.client.transfer_credits(&owner, &buyer, &s(&env, "b-up04"), &200_i128);
    assert_eq!(
        f.client.get_credit_batch(&s(&env, "b-up04")).owner,
        buyer,
        "UP-04: transfer_credits succeeded after unpause"
    );

    // Retire must now succeed.
    let cert = f.client.retire_credits(
        &buyer,
        &s(&env, "b-up04"),
        &100_i128,
        &s(&env, "reason"),
        &s(&env, "Corp"),
        &s(&env, "ret-up04"),
        &s(&env, "tx"),
        &s(&env, "QmCert"),
    );
    assert_eq!(cert.amount, 100, "UP-04: retire_credits succeeded after unpause");
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration: pause_contract / unpause_contract vs. pause_operations
// ─────────────────────────────────────────────────────────────────────────────

/// The two pause mechanisms share the same `PauseEnabled` storage flag, so
/// `unpause_contract()` must also clear a pause set by `pause_operations()`.
#[test]
fn integration_unpause_contract_clears_pause_operations() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let owner = Address::generate(&env);

    // Set a timed pause via pause_operations.
    let until = env.ledger().timestamp() + 3_600;
    f.client.pause_operations(&f.admin, &until);

    // Verify minting is blocked.
    assert!(f.client
        .try_mint_credits(
            &f.admin,
            &s(&env, "proj-test"),
            &100_i128,
            &2023_u32,
            &s(&env, "b-int-1"),
            &1_u64,
            &100_u64,
            &s(&env, "Q"),
            &owner,
        )
        .is_err());

    // unpause_contract() must clear the flag.
    f.client.unpause_contract(&f.admin);
    assert!(!f.client.get_pause_state(), "timed pause cleared by unpause_contract");

    // Minting must succeed after unpause.
    f.client.mint_credits(
        &f.admin,
        &s(&env, "proj-test"),
        &100_i128,
        &2023_u32,
        &s(&env, "b-int-1"),
        &1_u64,
        &100_u64,
        &s(&env, "Q"),
        &owner,
    );
}

/// `pause_contract()` must set an indefinite pause even if a timed pause
/// window has already expired.
#[test]
fn integration_pause_contract_after_expired_timed_pause() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let owner = Address::generate(&env);

    // Set a 1-second timed pause.
    let until = env.ledger().timestamp() + 1;
    f.client.pause_operations(&f.admin, &until);

    // Advance past the expiry — lazy-clear fires on next state-mutating call.
    env.ledger().with_mut(|l| l.timestamp = until + 1);
    // Trigger the lazy clear (mint succeeds because pause expired).
    f.client.mint_credits(
        &f.admin,
        &s(&env, "proj-test"),
        &100_i128,
        &2023_u32,
        &s(&env, "b-int-2"),
        &1_u64,
        &100_u64,
        &s(&env, "Q"),
        &owner,
    );

    // Now the contract is unpaused; pause_contract() must set it paused again.
    f.client.pause_contract(&f.admin);
    assert!(f.client.get_pause_state());
}

/// Admin granted via `grant_role` may call `pause_contract` and `unpause_contract`.
#[test]
fn integration_granted_admin_may_pause_and_unpause() {
    let env = Env::default();
    let f = Fixture::new(&env);
    let successor = Address::generate(&env);
    f.client.grant_role(&f.admin, &successor, &carbon_credit::Role::Admin);

    f.client.pause_contract(&successor);
    assert!(f.client.get_pause_state(), "granted admin can pause");

    f.client.unpause_contract(&successor);
    assert!(!f.client.get_pause_state(), "granted admin can unpause");
}

/// Non-admin roles must NOT be able to call `pause_contract`.
#[test]
fn integration_non_admin_roles_cannot_pause_contract() {
    let env = Env::default();
    let f = Fixture::new(&env);

    for (label, role) in [
        ("Verifier", carbon_credit::Role::Verifier),
        ("Developer", carbon_credit::Role::Developer),
        ("Oracle", carbon_credit::Role::Oracle),
        ("MarketplaceAdmin", carbon_credit::Role::MarketplaceAdmin),
    ] {
        let holder = Address::generate(&env);
        f.client.grant_role(&f.admin, &holder, &role);
        assert_eq!(
            f.client.try_pause_contract(&holder).unwrap_err().unwrap(),
            CarbonError::UnauthorizedVerifier,
            "non-admin role {label} must not be able to call pause_contract"
        );
    }
}

/// Non-admin roles must NOT be able to call `unpause_contract`.
#[test]
fn integration_non_admin_roles_cannot_unpause_contract() {
    let env = Env::default();
    let f = Fixture::new(&env);
    f.client.pause_contract(&f.admin);

    for (label, role) in [
        ("Verifier", carbon_credit::Role::Verifier),
        ("Developer", carbon_credit::Role::Developer),
    ] {
        let holder = Address::generate(&env);
        f.client.grant_role(&f.admin, &holder, &role);
        assert_eq!(
            f.client.try_unpause_contract(&holder).unwrap_err().unwrap(),
            CarbonError::UnauthorizedVerifier,
            "non-admin role {label} must not be able to call unpause_contract"
        );
    }
    // Contract must still be paused (none of the unauthorized calls succeeded).
    assert!(
        f.client.get_pause_state(),
        "unauthorized unpause attempts must not lift the pause"
    );
}
