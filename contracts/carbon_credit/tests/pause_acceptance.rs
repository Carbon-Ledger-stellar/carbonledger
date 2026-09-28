//! Acceptance test suite for the emergency-pause feature (issue #1318).
//!
//! Acceptance criteria covered by this file:
//!
//! | ID  | Criterion                            | Tests        |
//! |-----|--------------------------------------|--------------|
//! | AC1 | Pause blocks mint, transfer, retire  | `ac1_*`      |
//! | AC2 | Pause does not block queries         | `ac2_*`      |
//! | AC3 | Unpause unblocks operations          | `ac3_*`      |
//! | AC4 | Only admin can pause/unpause         | `ac4_*`      |
//! | AC5 | Events are emitted                   | `ac5_*`      |
//! | AC0 | Pause window is time-bounded (72h)   | `ac0_*`      |
//!
//! AC0 is a supporting requirement: the 72-hour bound and its boundaries are
//! what make the pause a circuit breaker rather than a permanent shutdown.
//!
//! Feature contract under test (see `docs/adr/ADR-013-emergency-pause.md`):
//!
//! * `pause_operations(admin, until_timestamp)` - admin-only; requires
//!   `now < until <= now + 72h`; sets `PauseEnabled`/`PauseUntil` and emits
//!   `(c_ledger, paused) (admin, until_timestamp, paused_at)`.
//! * `unpause_operations(admin)` - admin-only; clears both keys and emits
//!   `(c_ledger, unpaused) (admin, unpaused_at)`.
//! * `require_not_paused` - the first check in every state-mutating entry
//!   point. Returns `EmergencyPaused` while the window is open, and lazily
//!   clears the flag once `ledger.timestamp() >= PauseUntil`.
//! * Read-only entry points deliberately do NOT call `require_not_paused`,
//!   so queries keep working while paused.
//!
//! The equivalent suite for `carbon_marketplace` lives in
//! `contracts/carbon_marketplace/tests/pause_acceptance.rs`.

#![cfg(test)]
#![allow(deprecated)] // `env.register_contract` matches the rest of the test suite.

use carbon_credit::{
    CarbonCreditContract, CarbonCreditContractClient, CarbonError, DataKey, RetirementCertificate,
    Role,
};
use soroban_sdk::Vec as SorobanVec;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, ConversionError, Env, IntoVal, InvokeError, String, Val,
};

/// One hour, in seconds.
const HOUR: u64 = 3_600;
/// Upper bound on a single pause window: 72 hours.
const MAX_WINDOW: u64 = 72 * HOUR;

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/// Return type of every generated `try_*` client method: the outer `Result`
/// fails when the call itself failed, carrying either a typed `CarbonError` or
/// an `InvokeError`; the inner `Result` fails on a return-value conversion
/// (`Error` rather than `ConversionError` for tuple return types).
type CallResult<T, E = ConversionError> = Result<Result<T, E>, Result<CarbonError, InvokeError>>;

/// Extract the [`CarbonError`] from a `try_*` client call that the contract
/// rejected.
fn contract_error<T, E>(res: CallResult<T, E>, ctx: &str) -> CarbonError {
    let outer = res
        .err()
        .unwrap_or_else(|| panic!("{ctx}: expected the call to be rejected, but it succeeded"));
    outer.unwrap_or_else(|e| panic!("{ctx}: expected a contract error, got a host error: {e:?}"))
}

/// Assert that a `try_*` call is rejected with exactly `expected`.
#[track_caller]
fn assert_contract_err<T, E>(res: CallResult<T, E>, expected: CarbonError, ctx: &str) {
    assert_eq!(contract_error(res, ctx), expected, "{ctx}");
}

/// A single published event: (contract id, topics, data).
type Event = (Address, SorobanVec<Val>, Val);
/// The event log, as returned by the `Events` testutils trait.
type EventLog = SorobanVec<Event>;

/// Record the current event-log length.
///
/// The `Events` testutils trait only exposes `all()` -- there is no way to
/// clear the log -- and the log accumulates for the lifetime of the `Env`
/// (notably `initialize` publishes one). Taking a baseline before the call
/// under test lets a test assert on exactly the events that call produced.
fn mark(env: &Env) -> u32 {
    env.events().all().len()
}

/// Every event published after `baseline` was taken.
fn events_since(env: &Env, baseline: u32) -> EventLog {
    let tail: std::vec::Vec<Event> = env
        .events()
        .all()
        .into_iter()
        .skip(baseline as usize)
        .collect();
    SorobanVec::from_slice(env, &tail)
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn ledger_info() -> soroban_sdk::testutils::LedgerInfo {
    soroban_sdk::testutils::LedgerInfo {
        // 2025-01-01 00:00:00 UTC. `current_year` resolves this to 2025, so a
        // 2023 vintage sits inside the [1990, 2026] validity window and is
        // not yet expired (MAX_VINTAGE_AGE_YEARS = 30).
        timestamp: 1_735_689_600,
        protocol_version: 20,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 518_400,
    }
}

struct PauseFixture<'a> {
    client: CarbonCreditContractClient<'a>,
    /// Address the contract is registered at - needed for event assertions.
    id: Address,
    admin: Address,
    owner: Address,
    recipient: Address,
}

impl<'a> PauseFixture<'a> {
    /// Register and initialize the contract, then start from an empty event log
    /// so every event assertion below is exact rather than cumulative.
    fn new(env: &'a Env) -> Self {
        env.mock_all_auths();
        env.ledger().set(ledger_info());

        let admin = Address::generate(env);
        let owner = Address::generate(env);
        let recipient = Address::generate(env);
        let placeholder_registry = Address::generate(env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(env, &id);
        client.initialize(&admin, &placeholder_registry);

        // `mint_credits` cross-calls `register_serial_range_by_credit_contract`
        // on the configured registry for global serial uniqueness (#999) via
        // `invoke_contract`, which aborts when the target is not a contract.
        // The registry is out of scope for the pause feature, so clear the
        // configured address: `mint_credits` documents that it skips the
        // cross-call when no registry is configured. This keeps the suite
        // focused on pause semantics while letting the *unpaused* mint path
        // run to completion.
        env.as_contract(&id, || {
            env.storage()
                .persistent()
                .remove(&DataKey::RegistryContract);
        });

        Self {
            client,
            id,
            admin,
            owner,
            recipient,
        }
    }

    fn now(&self, env: &Env) -> u64 {
        env.ledger().timestamp()
    }

    /// Pause for `secs` seconds starting at the current ledger timestamp.
    fn pause(&self, env: &Env, secs: u64) {
        let until = self.now(env) + secs;
        self.client.pause_operations(&self.admin, &until);
    }

    /// `try_mint_credits` with valid arguments, for asserting rejection.
    fn try_mint(&self, env: &Env, batch: &str, serial_start: u64) -> CallResult<()> {
        self.client.try_mint_credits(
            &self.admin,
            &s(env, "proj-ac"),
            &500_i128,
            &2023_u32,
            &s(env, batch),
            &serial_start,
            &(serial_start + 600),
            &s(env, "QmAcceptanceCID"),
            &self.owner,
        )
    }

    /// Mint a valid batch. `serial_start` must be unique per call.
    fn mint(&self, env: &Env, batch: &str, amount: i128, serial_start: u64) {
        self.client.mint_credits(
            &self.admin,
            &s(env, "proj-ac"),
            &amount,
            &2023_u32,
            &s(env, batch),
            &serial_start,
            &(serial_start + amount as u64 + 100),
            &s(env, "QmAcceptanceCID"),
            &self.owner,
        );
    }

    fn try_transfer(&self, env: &Env, batch: &str, amount: i128) -> CallResult<()> {
        self.client
            .try_transfer_credits(&self.owner, &self.recipient, &s(env, batch), &amount)
    }

    fn transfer(&self, env: &Env, batch: &str, to: &Address, amount: i128) {
        self.client
            .transfer_credits(&self.owner, to, &s(env, batch), &amount);
    }

    fn try_retire(
        &self,
        env: &Env,
        batch: &str,
        amount: i128,
        retire_id: &str,
    ) -> CallResult<RetirementCertificate> {
        self.client.try_retire_credits(
            &self.owner,
            &s(env, batch),
            &amount,
            &s(env, "compliance"),
            &s(env, "0xbeneficiary"),
            &s(env, retire_id),
            &s(env, "0xtx"),
            &s(env, "QmCertCID"),
        )
    }

    fn retire(&self, env: &Env, batch: &str, amount: i128, retire_id: &str) {
        self.client.retire_credits(
            &self.owner,
            &s(env, batch),
            &amount,
            &s(env, "compliance"),
            &s(env, "0xbeneficiary"),
            &s(env, retire_id),
            &s(env, "0xtx"),
            &s(env, "QmCertCID"),
        );
    }
}

// ---------------------------------------------------------------------------
// AC0 - the pause window is time-bounded (supporting requirement)
// ---------------------------------------------------------------------------

/// AC0-01: `until_timestamp == now` is rejected - a zero-length window would
/// leave `PauseEnabled` set with no window in which the pause is observable.
#[test]
fn ac0_pause_rejects_window_ending_now() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);

    assert_contract_err(
        f.client.try_pause_operations(&f.admin, &now),
        CarbonError::InvalidPauseWindow,
        "AC0-01",
    );
}

/// AC0-02: an `until_timestamp` in the past is rejected.
#[test]
fn ac0_pause_rejects_window_in_the_past() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);

    assert_contract_err(
        f.client.try_pause_operations(&f.admin, &(now - 1)),
        CarbonError::InvalidPauseWindow,
        "AC0-02",
    );
}

/// AC0-03: a window longer than 72 hours is rejected, so a pause cannot be made
/// permanent by accident.
#[test]
fn ac0_pause_rejects_window_longer_than_72h() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);

    assert_contract_err(
        f.client
            .try_pause_operations(&f.admin, &(now + MAX_WINDOW + 1)),
        CarbonError::InvalidPauseWindow,
        "AC0-03",
    );
}

/// AC0-04: exactly 72 hours is the inclusive upper bound and yields an active
/// pause.
#[test]
fn ac0_pause_accepts_window_of_exactly_72h() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);

    f.client.pause_operations(&f.admin, &(now + MAX_WINDOW));

    assert_contract_err(
        f.try_mint(&env, "ac0-04", 1),
        CarbonError::EmergencyPaused,
        "AC0-04",
    );
}

/// AC0-05: the smallest legal window is one second.
#[test]
fn ac0_pause_accepts_minimum_one_second_window() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);

    f.client.pause_operations(&f.admin, &(now + 1));

    assert_contract_err(
        f.try_mint(&env, "ac0-05", 1),
        CarbonError::EmergencyPaused,
        "AC0-05",
    );
}

/// AC0-06: a rejected window must not leave the contract paused.
#[test]
fn ac0_rejected_window_leaves_contract_unpaused() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);

    let _ = f
        .client
        .try_pause_operations(&f.admin, &(now + MAX_WINDOW + 1));

    f.mint(&env, "ac0-06", 500, 1);
    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac0-06")).amount,
        500,
        "AC0-06: a rejected pause window must leave minting available"
    );
}

// ---------------------------------------------------------------------------
// AC1 - pause blocks mint, transfer and retire
// ---------------------------------------------------------------------------

/// AC1-01: `mint_credits` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_mint_credits() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.try_mint(&env, "ac1-01", 1),
        CarbonError::EmergencyPaused,
        "AC1-01",
    );
}

/// AC1-02: the deterministic-mint variant is gated by the same guard.
#[test]
fn ac1_pause_blocks_mint_credits_deterministic() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client.try_mint_credits_deterministic(
            &f.admin,
            &s(&env, "proj-ac"),
            &500_i128,
            &2023_u32,
            &s(&env, "ac1-02"),
            &s(&env, "QmAcceptanceCID"),
            &f.owner,
        ),
        CarbonError::EmergencyPaused,
        "AC1-02",
    );
}

/// AC1-03: `transfer_credits` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_transfer_credits() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac1-03", 500, 1);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.try_transfer(&env, "ac1-03", 100),
        CarbonError::EmergencyPaused,
        "AC1-03",
    );
}

/// AC1-04: `retire_credits` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_retire_credits() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac1-04", 500, 1);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.try_retire(&env, "ac1-04", 100, "ac1-04-ret"),
        CarbonError::EmergencyPaused,
        "AC1-04",
    );
}

/// AC1-05: the bulk retirement variant `retire_batch` is gated too.
#[test]
fn ac1_pause_blocks_retire_batch() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac1-05", 500, 1);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client.try_retire_batch(
            &f.owner,
            &s(&env, "ac1-05"),
            &vec![&env, 1_u64],
            &s(&env, "compliance"),
            &s(&env, "0xbeneficiary"),
            &s(&env, "ac1-05-ret"),
            &s(&env, "0xtx"),
            &s(&env, "QmCertCID"),
        ),
        CarbonError::EmergencyPaused,
        "AC1-05",
    );
}

/// AC1-06: a blocked mint must not create a batch.
#[test]
fn ac1_blocked_mint_creates_no_batch() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    let _ = f.try_mint(&env, "ac1-06", 1);

    assert_contract_err(
        f.client.try_get_credit_batch(&s(&env, "ac1-06")),
        CarbonError::ProjectNotFound,
        "AC1-06",
    );
    assert_eq!(
        f.client.get_project_credits(&s(&env, "proj-ac")).len(),
        0,
        "AC1-06: a blocked mint must not index a batch under its project"
    );
}

/// AC1-07: a blocked transfer must not move ownership or change the amount.
#[test]
fn ac1_blocked_transfer_leaves_ownership_unchanged() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac1-07", 500, 1);
    f.pause(&env, HOUR);

    let _ = f.try_transfer(&env, "ac1-07", 100);

    let batch = f.client.get_credit_batch(&s(&env, "ac1-07"));
    assert_eq!(batch.owner, f.owner, "AC1-07: owner must be unchanged");
    assert_eq!(batch.amount, 500, "AC1-07: amount must be unchanged");
}

/// AC1-08: a blocked retirement must not persist a certificate.
#[test]
fn ac1_blocked_retire_creates_no_certificate() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac1-08", 500, 1);
    f.pause(&env, HOUR);

    let _ = f.try_retire(&env, "ac1-08", 100, "ac1-08-ret");

    assert_contract_err(
        f.client
            .try_get_retirement_certificate(&s(&env, "ac1-08-ret")),
        CarbonError::ProjectNotFound,
        "AC1-08",
    );
}

/// AC1-09: a blocked transfer must not leave the re-entrancy lock held.
/// `transfer_credits` runs the pause guard BEFORE acquiring the lock, so a
/// blocked call must leave the contract fully usable.
#[test]
fn ac1_blocked_transfer_does_not_leak_reentrancy_lock() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac1-09", 500, 1);
    f.pause(&env, HOUR);

    let _ = f.try_transfer(&env, "ac1-09", 100);

    f.client.unpause_operations(&f.admin);
    f.transfer(&env, "ac1-09", &f.recipient, 100);

    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac1-09")).owner,
        f.recipient,
        "AC1-09: after unpause the transfer must succeed (no leaked lock)"
    );
}

/// AC1-10: administrative configuration mutations are gated too, so a pause
/// cannot be side-stepped by reconfiguring vintage bounds.
#[test]
fn ac1_pause_blocks_admin_configuration_mutation() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client
            .try_set_vintage_year_bounds(&f.admin, &2000_u32, &2020_u32),
        CarbonError::EmergencyPaused,
        "AC1-10",
    );
}

// ---------------------------------------------------------------------------
// AC2 - pause does not block queries
// ---------------------------------------------------------------------------

/// AC2-01: batch reads keep working while paused.
#[test]
fn ac2_pause_allows_batch_queries() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac2-01", 500, 1);
    f.pause(&env, HOUR);

    let batch = f.client.get_credit_batch(&s(&env, "ac2-01"));
    assert_eq!(
        batch.amount, 500,
        "AC2-01: get_credit_batch works while paused"
    );
    assert_eq!(
        batch.owner, f.owner,
        "AC2-01: owner is readable while paused"
    );

    let view = f.client.get_credit_batch_view(&s(&env, "ac2-01"));
    assert_eq!(
        view.batch_id,
        s(&env, "ac2-01"),
        "AC2-01: get_credit_batch_view works while paused"
    );
}

/// AC2-02: project enumeration and serial verification keep working.
#[test]
fn ac2_pause_allows_project_and_serial_queries() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac2-02", 500, 1);
    f.pause(&env, HOUR);

    assert_eq!(
        f.client.get_project_credits(&s(&env, "proj-ac")).len(),
        1,
        "AC2-02: get_project_credits works while paused"
    );
    assert!(
        !f.client.verify_serial_range(&1_u64, &700_u64),
        "AC2-02: verify_serial_range answers while paused (range is taken)"
    );
    assert!(
        f.client.verify_serial_range(&10_000_u64, &10_100_u64),
        "AC2-02: verify_serial_range answers while paused (range is free)"
    );
}

/// AC2-03: role and version introspection keeps working - operators need to be
/// able to inspect the contract while an incident is in progress.
#[test]
fn ac2_pause_allows_role_and_version_queries() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_eq!(
        f.client.get_role(&f.admin),
        Some(Role::Admin),
        "AC2-03: get_role works while paused"
    );
    assert!(
        f.client.has_role(&f.admin, &Role::Admin),
        "AC2-03: has_role works while paused"
    );
    assert!(
        f.client.get_version() >= 1,
        "AC2-03: get_version works while paused"
    );
    assert_eq!(
        f.client.serial_index_size(),
        0,
        "AC2-03: serial_index_size is readable while paused"
    );
}

/// AC2-04: a retirement certificate created BEFORE the pause stays readable.
#[test]
fn ac2_pause_allows_retirement_certificate_query() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac2-04", 500, 1);
    f.retire(&env, "ac2-04", 100, "ac2-04-ret");
    f.pause(&env, HOUR);

    let cert = f.client.get_retirement_certificate(&s(&env, "ac2-04-ret"));
    assert_eq!(
        cert.amount, 100,
        "AC2-04: get_retirement_certificate works while paused"
    );
}

/// AC2-05: a query issued AFTER a blocked mutation still succeeds and still
/// sees the pre-pause state - the pause must not corrupt reads.
#[test]
fn ac2_queries_still_work_after_blocked_mutation() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac2-05", 500, 1);
    f.pause(&env, HOUR);

    let _ = f.try_mint(&env, "ac2-05-new", 10_000);

    let batch = f.client.get_credit_batch(&s(&env, "ac2-05"));
    assert_eq!(
        batch.owner, f.owner,
        "AC2-05: state is unchanged by the blocked mutation"
    );
    assert_eq!(
        batch.amount, 500,
        "AC2-05: amount is unchanged by the blocked mutation"
    );
    assert_eq!(
        f.client.get_project_credits(&s(&env, "proj-ac")).len(),
        1,
        "AC2-05: the blocked mint added no project batch"
    );
}

// ---------------------------------------------------------------------------
// AC3 - unpause unblocks operations
// ---------------------------------------------------------------------------

/// AC3-01: minting works again after `unpause_operations`.
#[test]
fn ac3_unpause_restores_mint() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    let _ = f.try_mint(&env, "ac3-01-blocked", 1);

    f.client.unpause_operations(&f.admin);
    f.mint(&env, "ac3-01", 500, 1);

    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac3-01")).amount,
        500,
        "AC3-01: minting succeeds after unpause"
    );
}

/// AC3-02: transfers work again after `unpause_operations` and move ownership.
#[test]
fn ac3_unpause_restores_transfer() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac3-02", 500, 1);
    f.pause(&env, HOUR);

    let _ = f.try_transfer(&env, "ac3-02", 100);

    f.client.unpause_operations(&f.admin);
    f.transfer(&env, "ac3-02", &f.recipient, 100);

    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac3-02")).owner,
        f.recipient,
        "AC3-02: ownership moves after unpause"
    );
}

/// AC3-03: retirements work again after `unpause_operations`.
///
/// `batch.amount` is the originally minted figure and is never decremented;
/// retirement is tracked in `RetiredKey::BatchRetired` and the spendable
/// balance is `amount - retired`. So the retirement is verified by driving the
/// active amount to zero: the batch accepts exactly the remaining credits and
/// then rejects one more.
#[test]
fn ac3_unpause_restores_retire() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac3-03", 500, 1);
    f.pause(&env, HOUR);

    let _ = f.try_retire(&env, "ac3-03", 100, "ac3-03-blocked");

    f.client.unpause_operations(&f.admin);
    f.retire(&env, "ac3-03", 100, "ac3-03-ret");

    assert_eq!(
        f.client
            .get_retirement_certificate(&s(&env, "ac3-03-ret"))
            .amount,
        100,
        "AC3-03: the post-unpause certificate exists"
    );

    // The remaining 400 active credits are spendable, and spending them flips
    // the batch to `FullyRetired`, so a further retirement is rejected.
    f.retire(&env, "ac3-03", 400, "ac3-03-ret2");
    assert_contract_err(
        f.try_retire(&env, "ac3-03", 1, "ac3-03-ret3"),
        CarbonError::AlreadyRetired,
        "AC3-03",
    );
}

/// AC3-04: `unpause_operations` is idempotent - calling it repeatedly leaves the
/// contract usable.
#[test]
fn ac3_unpause_is_idempotent() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    f.client.unpause_operations(&f.admin);
    f.client.unpause_operations(&f.admin);
    f.client.unpause_operations(&f.admin);

    f.mint(&env, "ac3-04", 500, 1);
    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac3-04")).amount,
        500,
        "AC3-04: repeated unpause leaves the contract usable"
    );
}

/// AC3-05: the pause is still active one second before its deadline.
#[test]
fn ac3_pause_is_active_just_before_expiry() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let until = f.now(&env) + HOUR;
    f.client.pause_operations(&f.admin, &until);

    env.ledger().with_mut(|l| l.timestamp = until - 1);

    assert_contract_err(
        f.try_mint(&env, "ac3-05", 1),
        CarbonError::EmergencyPaused,
        "AC3-05",
    );
}

/// AC3-06: the pause expires automatically at its deadline - no manual unpause
/// is required. `require_not_paused` treats `timestamp >= PauseUntil` as
/// expired and lazily clears the flag.
#[test]
fn ac3_pause_auto_expires_at_deadline() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let until = f.now(&env) + HOUR;
    f.client.pause_operations(&f.admin, &until);

    env.ledger().with_mut(|l| l.timestamp = until);

    f.mint(&env, "ac3-06", 500, 1);
    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac3-06")).amount,
        500,
        "AC3-06: the pause lapses automatically at its deadline"
    );
}

/// AC3-07: the lazy expiry is sticky - once cleared, later calls stay unpaused
/// and a fresh pause is required to block operations again.
#[test]
fn ac3_pause_remains_expired_after_lapsing() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let until = f.now(&env) + HOUR;
    f.client.pause_operations(&f.admin, &until);

    env.ledger().with_mut(|l| l.timestamp = until + 10);
    f.mint(&env, "ac3-07", 500, 1);
    f.transfer(&env, "ac3-07", &f.recipient, 100);

    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac3-07")).owner,
        f.recipient,
        "AC3-07: the contract stays unpaused after the window lapses"
    );
}

// ---------------------------------------------------------------------------
// AC4 - only the admin can pause / unpause
// ---------------------------------------------------------------------------

/// AC4-01: the admin can pause.
#[test]
fn ac4_admin_can_pause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.try_mint(&env, "ac4-01", 1),
        CarbonError::EmergencyPaused,
        "AC4-01",
    );
}

/// AC4-02: the admin can unpause.
#[test]
fn ac4_admin_can_unpause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);
    f.client.unpause_operations(&f.admin);

    f.mint(&env, "ac4-02", 500, 1);
    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac4-02")).amount,
        500,
        "AC4-02: an admin unpause takes effect"
    );
}

/// AC4-03: an address with no role cannot pause.
#[test]
fn ac4_non_admin_cannot_pause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let rogue = Address::generate(&env);

    assert_contract_err(
        f.client.try_pause_operations(&rogue, &(f.now(&env) + HOUR)),
        CarbonError::UnauthorizedVerifier,
        "AC4-03",
    );
}

/// AC4-04: an address with no role cannot unpause.
#[test]
fn ac4_non_admin_cannot_unpause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let rogue = Address::generate(&env);

    assert_contract_err(
        f.client.try_unpause_operations(&rogue),
        CarbonError::UnauthorizedVerifier,
        "AC4-04",
    );
}

/// AC4-05: a rejected pause must leave the contract unpaused.
#[test]
fn ac4_unauthorized_pause_leaves_contract_unpaused() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let rogue = Address::generate(&env);

    let _ = f.client.try_pause_operations(&rogue, &(f.now(&env) + HOUR));

    f.mint(&env, "ac4-05", 500, 1);
    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac4-05")).amount,
        500,
        "AC4-05: an unauthorized pause must not take effect"
    );
}

/// AC4-06: a rejected unpause must not lift an active pause. This is the
/// important negative case - otherwise anyone could resume operations.
#[test]
fn ac4_unauthorized_unpause_does_not_lift_active_pause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let rogue = Address::generate(&env);
    f.pause(&env, HOUR);

    let _ = f.client.try_unpause_operations(&rogue);

    assert_contract_err(
        f.try_mint(&env, "ac4-06", 1),
        CarbonError::EmergencyPaused,
        "AC4-06",
    );
}

/// AC4-07: a second admin (granted `Role::Admin`) can pause and unpause. Admin
/// authority is role-based rather than hard-coded to the deployer, so key
/// handover does not require a redeploy.
#[test]
fn ac4_granted_admin_can_pause_and_unpause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let successor = Address::generate(&env);
    f.client.grant_role(&f.admin, &successor, &Role::Admin);

    let until = f.now(&env) + HOUR;
    f.client.pause_operations(&successor, &until);
    assert_contract_err(
        f.try_mint(&env, "ac4-07", 1),
        CarbonError::EmergencyPaused,
        "AC4-07",
    );

    f.client.unpause_operations(&successor);
    f.mint(&env, "ac4-07", 500, 1);
    assert_eq!(
        f.client.get_credit_batch(&s(&env, "ac4-07")).amount,
        500,
        "AC4-07: a granted Role::Admin may unpause"
    );
}

/// AC4-08: holding a non-admin role must not grant pause authority. Each role
/// goes to a distinct address so none accumulates roles.
#[test]
fn ac4_non_admin_roles_cannot_pause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);

    let until = f.now(&env) + HOUR;

    for (label, role) in [
        ("Verifier", Role::Verifier),
        ("Developer", Role::Developer),
        ("Oracle", Role::Oracle),
        ("MarketplaceAdmin", Role::MarketplaceAdmin),
    ] {
        let holder = Address::generate(&env);
        f.client.grant_role(&f.admin, &holder, &role);

        assert_contract_err(
            f.client.try_pause_operations(&holder, &until),
            CarbonError::UnauthorizedVerifier,
            &format!("AC4-08: {label} must not be able to pause"),
        );
    }
}

/// AC4-09: revoking the admin role withdraws pause authority.
#[test]
fn ac4_revoked_admin_cannot_pause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.client.revoke_role(&f.admin, &f.admin);

    assert_contract_err(
        f.client
            .try_pause_operations(&f.admin, &(f.now(&env) + HOUR)),
        CarbonError::UnauthorizedVerifier,
        "AC4-09",
    );
}

// ---------------------------------------------------------------------------
// AC5 - events are emitted
// ---------------------------------------------------------------------------

/// AC5-01: `pause_operations` emits exactly one `(c_ledger, paused)` event
/// carrying `(admin, until_timestamp, paused_at)`.
#[test]
fn ac5_pause_emits_paused_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);
    let until = now + HOUR;
    let base = mark(&env);

    f.client.pause_operations(&f.admin, &until);

    assert_eq!(
        events_since(&env, base),
        vec![
            &env,
            (
                f.id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("paused")).into_val(&env),
                (f.admin.clone(), until, now).into_val(&env),
            )
        ],
        "AC5-01: one `paused` event with (admin, until, paused_at)"
    );
}

/// AC5-02: `unpause_operations` emits exactly one `(c_ledger, unpaused)` event
/// carrying `(admin, unpaused_at)`.
#[test]
fn ac5_unpause_emits_unpaused_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);
    f.client.pause_operations(&f.admin, &(now + HOUR));
    let base = mark(&env);

    env.ledger().with_mut(|l| l.timestamp = now + 600);
    f.client.unpause_operations(&f.admin);

    assert_eq!(
        events_since(&env, base),
        vec![
            &env,
            (
                f.id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("unpaused")).into_val(&env),
                (f.admin.clone(), now + 600).into_val(&env),
            )
        ],
        "AC5-02: one `unpaused` event with (admin, unpaused_at)"
    );
}

/// AC5-03: a pause -> unpause cycle emits `paused` then `unpaused`, in order.
#[test]
fn ac5_pause_then_unpause_emits_both_in_order() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);
    let until = now + HOUR;
    let base = mark(&env);

    f.client.pause_operations(&f.admin, &until);
    env.ledger().with_mut(|l| l.timestamp = now + 300);
    f.client.unpause_operations(&f.admin);

    assert_eq!(
        events_since(&env, base),
        vec![
            &env,
            (
                f.id.clone(),
                (symbol_short!("c_ledger"), symbol_short!("paused")).into_val(&env),
                (f.admin.clone(), until, now).into_val(&env),
            ),
            (
                f.id,
                (symbol_short!("c_ledger"), symbol_short!("unpaused")).into_val(&env),
                (f.admin, now + 300).into_val(&env),
            ),
        ],
        "AC5-03: `paused` precedes `unpaused`"
    );
}

/// AC5-04: a rejected pause window publishes no event.
#[test]
fn ac5_invalid_window_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let now = f.now(&env);
    let base = mark(&env);

    let _ = f
        .client
        .try_pause_operations(&f.admin, &(now + MAX_WINDOW + 1));

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-04: a rejected pause publishes no event"
    );
}

/// AC5-05: an unauthorized pause publishes no event.
#[test]
fn ac5_unauthorized_pause_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let rogue = Address::generate(&env);
    let base = mark(&env);

    let _ = f.client.try_pause_operations(&rogue, &(f.now(&env) + HOUR));

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-05: an unauthorized pause publishes no event"
    );
}

/// AC5-06: an unauthorized unpause publishes no event.
#[test]
fn ac5_unauthorized_unpause_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let rogue = Address::generate(&env);
    let base = mark(&env);

    let _ = f.client.try_unpause_operations(&rogue);

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-06: an unauthorized unpause publishes no event"
    );
}

/// AC5-07: a mint blocked by the pause publishes no event - a rejected call
/// must not look like a state change to indexers.
#[test]
fn ac5_blocked_mint_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);
    let base = mark(&env);

    let _ = f.try_mint(&env, "ac5-07", 1);

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-07: a mint blocked by the pause publishes no event"
    );
}

/// AC5-08: a transfer blocked by the pause publishes no event.
#[test]
fn ac5_blocked_transfer_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac5-08", 500, 1);
    f.pause(&env, HOUR);
    let base = mark(&env);

    let _ = f.try_transfer(&env, "ac5-08", 100);

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-08: a transfer blocked by the pause publishes no event"
    );
}

/// AC5-09: a retirement blocked by the pause publishes no event.
#[test]
fn ac5_blocked_retire_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.mint(&env, "ac5-09", 500, 1);
    f.pause(&env, HOUR);
    let base = mark(&env);

    let _ = f.try_retire(&env, "ac5-09", 100, "ac5-09-ret");

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-09: a retirement blocked by the pause publishes no event"
    );
}

/// AC5-10: once unpaused, the same operation succeeds and DOES emit its normal
/// event - the pause is the only thing suppressing it.
#[test]
fn ac5_operation_after_unpause_emits_its_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);
    f.client.unpause_operations(&f.admin);
    let base = mark(&env);

    f.mint(&env, "ac5-10", 500, 1);

    assert_eq!(
        events_since(&env, base).len(),
        1,
        "AC5-10: a successful mint emits its single `minted` event"
    );
}
