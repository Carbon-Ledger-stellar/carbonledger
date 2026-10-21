//! Acceptance test suite for the emergency-pause feature on `carbon_marketplace`
//! (issue #1318).
//!
//! This mirrors `contracts/carbon_credit/tests/pause_acceptance.rs` for the
//! marketplace's own gated surface:
//!
//! | ID  | Criterion                            | Tests        |
//! |-----|--------------------------------------|--------------|
//! | AC1 | Pause blocks listing, delisting, purchase, admin writes | `ac1_*` |
//! | AC2 | Pause does not block queries         | `ac2_*`      |
//! | AC3 | Unpause unblocks operations          | `ac3_*`      |
//! | AC4 | Only admin can pause/unpause         | `ac4_*`      |
//! | AC5 | Events are emitted                   | `ac5_*`      |
//! | AC0 | Pause window is time-bounded (72h)   | `ac0_*`      |
//!
//! Feature contract under test (see `docs/adr/ADR-013-emergency-pause.md`):
//! `pause_operations` / `unpause_operations` are admin-only, the window is
//! `now < until <= now + 72h`, and `require_not_paused` is the first check in
//! every state-mutating entry point while read-only entry points stay
//! reachable.

#![cfg(test)]
#![allow(deprecated)] // `env.register_contract` matches the rest of the test suite.

use carbon_marketplace::{
    CarbonError, CarbonMarketplaceContract, CarbonMarketplaceContractClient, ListingStatus,
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

/// A single published event: (contract id, topics, data).
type Event = (Address, SorobanVec<Val>, Val);
/// The event log, as returned by the `Events` testutils trait.
type EventLog = SorobanVec<Event>;

/// Return type of every generated `try_*` client method.
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

/// Record the current event-log length.
///
/// The `Events` testutils trait only exposes `all()` -- there is no way to
/// clear the log -- and the log accumulates for the lifetime of the `Env`.
/// Taking a baseline before the call under test lets a test assert on exactly
/// the events that call produced.
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
        // 2025-01-01 00:00:00 UTC, so a 2023 vintage sits inside the
        // [1990, current year] validity window used by `validate_vintage_year`.
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
    client: CarbonMarketplaceContractClient<'a>,
    /// Address the contract is registered at - needed for event assertions.
    id: Address,
    admin: Address,
    seller: Address,
    treasury: Address,
}

impl<'a> PauseFixture<'a> {
    fn new(env: &'a Env) -> Self {
        env.mock_all_auths();
        env.ledger().set(ledger_info());

        let admin = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        // Neither the USDC token nor the credit contract is exercised by the
        // listing/delisting paths under test, so plain generated addresses are
        // enough; `mock_all_auths` covers their `require_auth` calls.
        let usdc = Address::generate(env);
        let credit_contract = Address::generate(env);

        let id = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_contract, &treasury);

        Self {
            client,
            id,
            admin,
            seller,
            treasury,
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

    fn try_list(&self, env: &Env, listing_id: &str) -> CallResult<()> {
        self.client.try_list_credits(
            &self.seller,
            &s(env, listing_id),
            &s(env, "batch-1"),
            &s(env, "proj-mp"),
            &500_i128,
            &1_000_i128,
            &2023_u32,
            &s(env, "Verra"),
            &s(env, "US"),
        )
    }

    fn list(&self, env: &Env, listing_id: &str) {
        self.client.list_credits(
            &self.seller,
            &s(env, listing_id),
            &s(env, "batch-1"),
            &s(env, "proj-mp"),
            &500_i128,
            &1_000_i128,
            &2023_u32,
            &s(env, "Verra"),
            &s(env, "US"),
        );
    }

    fn try_delist(&self, env: &Env, listing_id: &str) -> CallResult<()> {
        self.client
            .try_delist_credits(&self.seller, &s(env, listing_id))
    }
}

// ---------------------------------------------------------------------------
// AC0 - the pause window is time-bounded (supporting requirement)
// ---------------------------------------------------------------------------

/// AC0-01: `until_timestamp == now` is rejected.
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

/// AC0-03: a window longer than 72 hours is rejected.
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
        f.try_list(&env, "ac0-04"),
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
        f.try_list(&env, "ac0-05"),
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

    f.list(&env, "ac0-06");
    assert_eq!(
        f.client.get_active_listings().len(),
        1,
        "AC0-06: a rejected pause window must leave listing available"
    );
}

// ---------------------------------------------------------------------------
// AC1 - pause blocks listing, delisting and admin writes
// ---------------------------------------------------------------------------

/// AC1-01: `list_credits` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_list_credits() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.try_list(&env, "ac1-01"),
        CarbonError::EmergencyPaused,
        "AC1-01",
    );
}

/// AC1-02: `delist_credits` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_delist_credits() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac1-02");
    f.pause(&env, HOUR);

    assert_contract_err(
        f.try_delist(&env, "ac1-02"),
        CarbonError::EmergencyPaused,
        "AC1-02",
    );
}

/// AC1-03: `purchase_credits` is rejected with `EmergencyPaused`. The pause
/// guard runs before the guard that would otherwise reject the token, so the
/// pause error is what surfaces.
#[test]
fn ac1_pause_blocks_purchase_credits() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac1-03");
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client
            .try_purchase_credits(&Address::generate(&env), &s(&env, "ac1-03"), &100_i128),
        CarbonError::EmergencyPaused,
        "AC1-03",
    );
}

/// AC1-04: `bulk_purchase` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_bulk_purchase() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac1-04");
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client.try_bulk_purchase(
            &Address::generate(&env),
            &vec![&env, s(&env, "ac1-04")],
            &vec![&env, 100_i128],
        ),
        CarbonError::EmergencyPaused,
        "AC1-04",
    );
}

/// AC1-05: `set_fee_rate` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_set_fee_rate() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client.try_set_fee_rate(&f.admin, &5_i128, &100_i128),
        CarbonError::EmergencyPaused,
        "AC1-05",
    );
}

/// AC1-06: `update_treasury` is rejected with `EmergencyPaused`, so a pause
/// cannot be side-stepped by redirecting the treasury.
#[test]
fn ac1_pause_blocks_update_treasury() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client
            .try_update_treasury(&f.admin, &Address::generate(&env)),
        CarbonError::EmergencyPaused,
        "AC1-06",
    );
}

/// AC1-07: `suspend_project` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_suspend_project() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client.try_suspend_project(&f.admin, &s(&env, "proj-mp")),
        CarbonError::EmergencyPaused,
        "AC1-07",
    );
}

/// AC1-08: `set_vintage_year_bounds` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_set_vintage_year_bounds() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client
            .try_set_vintage_year_bounds(&f.admin, &2000_u32, &2020_u32),
        CarbonError::EmergencyPaused,
        "AC1-08",
    );
}

/// AC1-09: `set_sweep_threshold` and `sweep_fees` are rejected with
/// `EmergencyPaused`, so the fee machinery is frozen too.
#[test]
fn ac1_pause_blocks_fee_sweeping() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client.try_set_sweep_threshold(&f.admin, &500_i128),
        CarbonError::EmergencyPaused,
        "AC1-09",
    );
    assert_contract_err(
        f.client.try_sweep_fees(),
        CarbonError::EmergencyPaused,
        "AC1-09",
    );
}

/// AC1-10: `cleanup_expired_listings` is rejected with `EmergencyPaused`.
#[test]
fn ac1_pause_blocks_cleanup_expired_listings() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert_contract_err(
        f.client.try_cleanup_expired_listings(&f.admin),
        CarbonError::EmergencyPaused,
        "AC1-10",
    );
}

/// AC1-11: a blocked listing must not be persisted or indexed.
#[test]
fn ac1_blocked_listing_creates_no_listing() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    let _ = f.try_list(&env, "ac1-11");

    assert_contract_err(
        f.client.try_get_listing(&s(&env, "ac1-11")),
        CarbonError::ListingNotFound,
        "AC1-11",
    );
    assert_eq!(
        f.client.get_active_listings().len(),
        0,
        "AC1-11: a blocked listing must not appear in the active set"
    );
}

/// AC1-12: a blocked delisting must leave the listing active and owned by its
/// seller.
#[test]
fn ac1_blocked_delisting_leaves_listing_active() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac1-12");
    f.pause(&env, HOUR);

    let _ = f.try_delist(&env, "ac1-12");

    let listing = f.client.get_listing(&s(&env, "ac1-12"));
    assert_eq!(
        listing.status,
        ListingStatus::Active,
        "AC1-12: status must be unchanged"
    );
    assert_eq!(listing.seller, f.seller, "AC1-12: seller must be unchanged");
}

// ---------------------------------------------------------------------------
// AC2 - pause does not block queries
// ---------------------------------------------------------------------------

/// AC2-01: listing reads keep working while paused.
#[test]
fn ac2_pause_allows_listing_queries() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac2-01");
    f.pause(&env, HOUR);

    let listing = f.client.get_listing(&s(&env, "ac2-01"));
    assert_eq!(
        listing.amount_available, 500,
        "AC2-01: get_listing works while paused"
    );
    assert_eq!(
        listing.seller, f.seller,
        "AC2-01: seller is readable while paused"
    );
    assert_eq!(
        f.client.get_active_listings().len(),
        1,
        "AC2-01: get_active_listings works while paused"
    );
}

/// AC2-02: indexed and paged listing queries keep working while paused.
#[test]
fn ac2_pause_allows_indexed_queries() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac2-02");
    f.pause(&env, HOUR);

    assert_eq!(
        f.client.get_listings_by_project(&s(&env, "proj-mp")).len(),
        1,
        "AC2-02: get_listings_by_project works while paused"
    );
    assert_eq!(
        f.client.get_listings_by_vintage(&2023_u32).len(),
        1,
        "AC2-02: get_listings_by_vintage works while paused"
    );
    let page = f.client.get_listings_page(&0_u32, &10_u32);
    assert_eq!(
        page.items.len(),
        1,
        "AC2-02: get_listings_page works while paused"
    );
}

/// AC2-03: fee and version introspection keeps working -- operators need to be
/// able to inspect the contract while an incident is in progress.
#[test]
fn ac2_pause_allows_fee_and_version_queries() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    assert!(
        f.client.get_version() >= 1,
        "AC2-03: get_version works while paused"
    );
    assert_eq!(
        f.client.get_fee_ledger().len(),
        0,
        "AC2-03: get_fee_ledger is readable while paused"
    );
    assert_eq!(
        f.client.get_fee_accumulator(),
        0,
        "AC2-03: get_fee_accumulator is readable while paused"
    );
    assert!(
        f.client.get_sweep_threshold() > 0,
        "AC2-03: get_sweep_threshold is readable while paused"
    );
    assert_eq!(
        f.client.get_price_freshness_window(),
        86_400,
        "AC2-03: get_price_freshness_window is readable while paused"
    );
}

/// AC2-04: a query issued after a blocked mutation still succeeds and still
/// sees the pre-pause state.
#[test]
fn ac2_queries_still_work_after_blocked_mutation() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac2-04");
    f.pause(&env, HOUR);

    let _ = f.try_list(&env, "ac2-04-blocked");
    let _ = f.try_delist(&env, "ac2-04");

    let listing = f.client.get_listing(&s(&env, "ac2-04"));
    assert_eq!(
        listing.status,
        ListingStatus::Active,
        "AC2-04: status is unchanged by the blocked mutations"
    );
    assert_eq!(
        f.client.get_active_listings().len(),
        1,
        "AC2-04: the blocked listing added nothing to the active set"
    );
}

// ---------------------------------------------------------------------------
// AC3 - unpause unblocks operations
// ---------------------------------------------------------------------------

/// AC3-01: listing works again after `unpause_operations`.
#[test]
fn ac3_unpause_restores_listing() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    let _ = f.try_list(&env, "ac3-01-blocked");

    f.client.unpause_operations(&f.admin);
    f.list(&env, "ac3-01");

    assert_eq!(
        f.client.get_active_listings().len(),
        1,
        "AC3-01: listing succeeds after unpause"
    );
}

/// AC3-02: delisting works again after `unpause_operations`.
#[test]
fn ac3_unpause_restores_delisting() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac3-02");
    f.pause(&env, HOUR);

    let _ = f.try_delist(&env, "ac3-02");

    f.client.unpause_operations(&f.admin);
    f.client.delist_credits(&f.seller, &s(&env, "ac3-02"));

    assert_eq!(
        f.client.get_listing(&s(&env, "ac3-02")).status,
        ListingStatus::Delisted,
        "AC3-02: delisting succeeds after unpause"
    );
}

/// AC3-03: admin writes work again after `unpause_operations`.
#[test]
fn ac3_unpause_restores_admin_writes() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    let _ = f.client.try_set_fee_rate(&f.admin, &5_i128, &100_i128);

    f.client.unpause_operations(&f.admin);
    f.client.set_fee_rate(&f.admin, &5_i128, &100_i128);

    let config = f.client.get_fee_config();
    assert_eq!(
        config.numerator, 5,
        "AC3-03: the fee rate is applied after unpause"
    );
}

/// AC3-04: `unpause_operations` is idempotent.
#[test]
fn ac3_unpause_is_idempotent() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);

    f.client.unpause_operations(&f.admin);
    f.client.unpause_operations(&f.admin);
    f.client.unpause_operations(&f.admin);

    f.list(&env, "ac3-04");
    assert_eq!(
        f.client.get_active_listings().len(),
        1,
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
        f.try_list(&env, "ac3-05"),
        CarbonError::EmergencyPaused,
        "AC3-05",
    );
}

/// AC3-06: the pause expires automatically at its deadline.
#[test]
fn ac3_pause_auto_expires_at_deadline() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let until = f.now(&env) + HOUR;
    f.client.pause_operations(&f.admin, &until);

    env.ledger().with_mut(|l| l.timestamp = until);

    f.list(&env, "ac3-06");
    assert_eq!(
        f.client.get_active_listings().len(),
        1,
        "AC3-06: the pause lapses automatically at its deadline"
    );
}

/// AC3-07: the lazy expiry is sticky.
#[test]
fn ac3_pause_remains_expired_after_lapsing() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let until = f.now(&env) + HOUR;
    f.client.pause_operations(&f.admin, &until);

    env.ledger().with_mut(|l| l.timestamp = until + 10);
    f.list(&env, "ac3-07");
    f.client.delist_credits(&f.seller, &s(&env, "ac3-07"));

    assert_eq!(
        f.client.get_listing(&s(&env, "ac3-07")).status,
        ListingStatus::Delisted,
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
        f.try_list(&env, "ac4-01"),
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

    f.list(&env, "ac4-02");
    assert_eq!(
        f.client.get_active_listings().len(),
        1,
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

    f.list(&env, "ac4-05");
    assert_eq!(
        f.client.get_active_listings().len(),
        1,
        "AC4-05: an unauthorized pause must not take effect"
    );
}

/// AC4-06: a rejected unpause must not lift an active pause -- otherwise anyone
/// could resume operations.
#[test]
fn ac4_unauthorized_unpause_does_not_lift_active_pause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    let rogue = Address::generate(&env);
    f.pause(&env, HOUR);

    let _ = f.client.try_unpause_operations(&rogue);

    assert_contract_err(
        f.try_list(&env, "ac4-06"),
        CarbonError::EmergencyPaused,
        "AC4-06",
    );
}

/// AC4-07: the seller cannot pause, even though it is the party whose listings
/// are frozen.
#[test]
fn ac4_seller_cannot_pause() {
    let env = Env::default();
    let f = PauseFixture::new(&env);

    assert_contract_err(
        f.client
            .try_pause_operations(&f.seller, &(f.now(&env) + HOUR)),
        CarbonError::UnauthorizedVerifier,
        "AC4-07",
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

/// AC5-07: a listing blocked by the pause publishes no event -- a rejected call
/// must not look like a state change to indexers.
#[test]
fn ac5_blocked_listing_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);
    let base = mark(&env);

    let _ = f.try_list(&env, "ac5-07");

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-07: a listing blocked by the pause publishes no event"
    );
}

/// AC5-08: a delisting blocked by the pause publishes no event.
#[test]
fn ac5_blocked_delisting_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.list(&env, "ac5-08");
    f.pause(&env, HOUR);
    let base = mark(&env);

    let _ = f.try_delist(&env, "ac5-08");

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-08: a delisting blocked by the pause publishes no event"
    );
}

/// AC5-09: an admin write blocked by the pause publishes no event.
#[test]
fn ac5_blocked_admin_write_emits_no_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);
    let base = mark(&env);

    let _ = f.client.try_set_fee_rate(&f.admin, &5_i128, &100_i128);

    assert_eq!(
        events_since(&env, base).len(),
        0,
        "AC5-09: an admin write blocked by the pause publishes no event"
    );
}

/// AC5-10: once unpaused, the same operation succeeds and DOES emit its normal
/// event -- the pause is the only thing suppressing it.
#[test]
fn ac5_operation_after_unpause_emits_its_event() {
    let env = Env::default();
    let f = PauseFixture::new(&env);
    f.pause(&env, HOUR);
    f.client.unpause_operations(&f.admin);
    let base = mark(&env);

    f.list(&env, "ac5-10");

    assert_eq!(
        events_since(&env, base).len(),
        1,
        "AC5-10: a successful listing emits its single `listed` event"
    );
}
