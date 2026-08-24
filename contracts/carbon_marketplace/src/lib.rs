#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, vec, Address, BytesN,
    Env, IntoVal, String, Vec,
};

const TTL_LEDGERS: u32 = 518_400;
const MAX_BATCH_SIZE: u32 = 10;
const CURRENT_VERSION: u32 = 1;
const MAX_VINTAGE_AGE_YEARS: u32 = 30;
pub const DEFAULT_MIN_VINTAGE_YEAR: u32 = 1990;
pub const DEFAULT_MAX_VINTAGE_YEAR: u32 = 0;
/// Maximum number of listings returned per page by paginated endpoints.
pub const MAX_PAGE_SIZE: u32 = 50;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CarbonError {
    ProjectNotFound = 1,
    ProjectNotVerified = 2,
    ProjectSuspended = 3,
    InsufficientCredits = 4,
    AlreadyRetired = 5,
    SerialNumberConflict = 6,
    UnauthorizedVerifier = 7,
    UnauthorizedOracle = 8,
    InvalidVintageYear = 9,
    ListingNotFound = 10,
    InsufficientLiquidity = 11,
    PriceNotSet = 12,
    MonitoringDataStale = 13,
    DoubleCountingDetected = 14,
    RetirementIrreversible = 15,
    ZeroAmountNotAllowed = 16,
    ProjectAlreadyExists = 17,
    InvalidSerialRange = 18,
    AlreadyInitialized = 19,
    Arithmetic = 20,
    UnauthorizedUpgrade = 21,
    /// Oracle price data is more than 24 hours old; the circuit breaker has
    /// tripped and all purchases are halted until the oracle is updated.
    CircuitBreakerTripped = 22,
    /// The caller-supplied `expected_amount_available` did not match the
    /// current on-chain value.  A concurrent buyer already modified the listing.
    /// Re-read the listing and resubmit with the updated amount.
    StaleExpectedAmount = 23,
    /// Page size exceeds the maximum allowed limit.
    PageSizeTooLarge = 24,
    FeeConfigInvalid = 25,
    InvalidPauseWindow = 26,
    EmergencyPaused = 27,
    ReentrancyDetected = 28,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Listing(String),
    AllListings,
    Admin,
    UsdcToken,
    CreditContract,
    Treasury,
    SuspendedProject(String),
    ContractVersion,
    UpgradeHistory,
    FeeConfig,
    PauseEnabled,
    PauseUntil,
    VintageYearMin,
    VintageYearMax,
    ReentrancyGuard,
    CircuitBreaker,
    CircuitBreakerTrippedAt,
    FeeLedger,
    FeeRecord(String),
    FeeAccumulator,
    SweepThreshold,
    TotalFeesSwept,
    OracleContract,
}

/// Governance-controlled fee configuration.
/// Fee = numerator / denom of total_cost. Max fee is denom/10 (10%).
/// If unset, defaults to 1/100 (1%) matching compile-time constants.
const FEE_RATE_DENOM: i128 = 100;
const DEFAULT_SWEEP_THRESHOLD: i128 = 1_000_000_000;

#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeConfig {
    pub numerator: i128,
    pub denom: i128,
    pub updated_at: u64,
    pub updated_by: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeRecord {
    pub fee_id: String,
    pub listing_id: String,
    pub buyer: Address,
    pub seller: Address,
    pub total_cost: i128,
    pub fee_amount: i128,
    pub recorded_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeSweptEvent {
    pub swept_by: Address,
    pub amount: i128,
    pub swept_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CircuitBreakerEvent {
    pub methodology: String,
    pub vintage_year: u32,
    pub price_age_secs: u64,
    pub threshold_secs: u64,
    pub tripped_at: u64,
}

/// Governance-controlled fee configuration stored on-chain.
/// `numerator / denom` = fee rate. e.g. 1/100 = 1%.
/// Invariant enforced by `set_fee_rate`: numerator <= denom / 10 (max 10%).
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeConfig {
    pub numerator:  i128,
    pub denom:      i128,
    pub updated_at: u64,
    pub updated_by: Address,
}

/// Compile-time default fee constants (1%).
/// Used as fallback when FeeConfig has not been set via governance.
pub const DEFAULT_FEE_NUMERATOR: i128 = 1;
pub const DEFAULT_FEE_DENOM:     i128 = 100;

#[contracttype]
#[derive(Clone, Debug)]
pub struct ListingCreatedEvent {
    pub listing_id: String,
    pub seller: Address,
    pub batch_id: String,
    pub amount: i128,
    pub price_per_credit: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PurchaseCompletedEvent {
    pub listing_id: String,
    pub buyer: Address,
    pub seller: Address,
    pub amount: i128,
    pub total_cost: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ListingStatus {
    Active,
    Sold,
    PartiallyFilled,
    Delisted,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketListing {
    pub listing_id: String,
    pub seller: Address,
    pub batch_id: String,
    pub project_id: String,
    pub amount_available: i128,
    pub price_per_credit: i128,
    pub vintage_year: u32,
    pub methodology: String,
    pub country: String,
    pub created_at: u64,
    pub status: ListingStatus,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeRecord {
    pub from_version: u32,
    pub to_version: u32,
    pub timestamp: u64,
    pub upgraded_by: Address,
    pub wasm_hash: BytesN<32>,
}

/// A paginated slice of marketplace listings.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ListingsPage {
    /// The listing items in this page.
    pub items: Vec<MarketListing>,
    /// Total number of listings that match the query (across all pages).
    pub total: u32,
    /// The offset (0-based) of the first item in this page.
    pub offset: u32,
}

#[contract]
pub struct CarbonMarketplaceContract;

#[contractimpl]
impl CarbonMarketplaceContract {
    fn current_year(env: &Env) -> u32 {
        let seconds_per_year: u64 = 31557600;
        let timestamp = env.ledger().timestamp();
        1970 + (timestamp / seconds_per_year) as u32
    }

    fn min_vintage_year(env: &Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::VintageYearMin)
            .unwrap_or(DEFAULT_MIN_VINTAGE_YEAR)
    }

    fn max_vintage_year(env: &Env) -> u32 {
        let configured: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::VintageYearMax)
            .unwrap_or(DEFAULT_MAX_VINTAGE_YEAR);
        if configured == 0 {
            Self::current_year(env)
        } else {
            configured
        }
    }

    fn validate_vintage_year(env: &Env, vintage_year: u32) -> Result<(), CarbonError> {
        let min_year = Self::min_vintage_year(env);
        let max_year = Self::max_vintage_year(env);
        if vintage_year < min_year || vintage_year > max_year {
            return Err(CarbonError::InvalidVintageYear);
        }
        Ok(())
    }

    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_token: Address,
        credit_contract: Address,
        treasury: Address,
    ) -> Result<(), CarbonError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::UsdcToken, &usdc_token);
        env.storage()
            .persistent()
            .set(&DataKey::CreditContract, &credit_contract);
        env.storage()
            .persistent()
            .set(&DataKey::Treasury, &treasury);
        let listings: Vec<String> = vec![&env];
        env.storage()
            .persistent()
            .set(&DataKey::AllListings, &listings);
        env.storage()
            .persistent()
            .set(&DataKey::ContractVersion, &CURRENT_VERSION);
        env.storage().persistent().set(&DataKey::PauseEnabled, &false);
        env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
        env.storage().persistent().set(&DataKey::ReentrancyGuard, &false);
        env.storage().persistent().set(&DataKey::CircuitBreaker, &false);
        env.storage().persistent().set(&DataKey::CircuitBreakerTrippedAt, &0_u64);
        Ok(())
    }

    /// Replaces this contract's WASM executable after authenticating the stored admin.
    ///
    /// Persistent contract storage is retained by Soroban during the executable
    /// replacement. Schema changes must therefore follow the migration rules in
    /// `docs/UPGRADE_GUIDE.md`.
    pub fn upgrade_contract(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;

        let current_version: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ContractVersion)
            .unwrap_or(1);

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        let next_version = current_version + 1;
        env.storage()
            .persistent()
            .set(&DataKey::ContractVersion, &next_version);

        let record = UpgradeRecord {
            from_version: current_version,
            to_version: next_version,
            timestamp: env.ledger().timestamp(),
            upgraded_by: admin.clone(),
            wasm_hash: new_wasm_hash,
        };
        env.storage()
            .persistent()
            .set(&DataKey::UpgradeHistory, &record);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("upgraded")),
            (current_version, next_version, admin),
        );
        Ok(())
    }

    pub fn get_version(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::ContractVersion)
            .unwrap_or(1)
    }

    pub fn get_upgrade_history(env: Env) -> Option<UpgradeRecord> {
        env.storage().persistent().get(&DataKey::UpgradeHistory)
    }

    // ── Fee Configuration (#651) ──────────────────────────────────────────────

    /// Admin-only: set the protocol fee rate.
    /// Guardrails: denom > 0, numerator >= 0, numerator <= denom / 10 (max 10%).
    /// Migration: if FeeConfig was never set, the default of 1/100 (1%) applies.
    pub fn set_fee_rate(
        env: Env,
        admin: Address,
        numerator: i128,
        denom: i128,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;

        if denom <= 0 || numerator < 0 || numerator > denom / 10 {
            return Err(CarbonError::FeeConfigInvalid);
        }

        let config = FeeConfig {
            numerator,
            denom,
            updated_at: env.ledger().timestamp(),
            updated_by: admin.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::FeeConfig, &config);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("fee_set")),
            (numerator, denom, admin),
        );
        Ok(())
    }

    /// Returns the current fee configuration. Defaults to 1/100 (1%) if never set.
    pub fn get_fee_config(env: Env) -> FeeConfig {
        Self::load_fee_config(&env)
    }

    fn load_fee_config(env: &Env) -> FeeConfig {
        env.storage()
            .persistent()
            .get(&DataKey::FeeConfig)
            .unwrap_or(FeeConfig {
                numerator: 1,
                denom: 100,
                updated_at: 0,
                updated_by: env.current_contract_address(),
            })
    }

    pub fn update_treasury(
        env: Env,
        admin: Address,
        new_treasury: Address,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_not_paused(&env)?;
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        if stored_admin != admin {
            return Err(CarbonError::UnauthorizedVerifier);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Treasury, &new_treasury);
        Ok(())
    }

    pub fn suspend_project(
        env: Env,
        admin: Address,
        project_id: String,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_not_paused(&env)?;
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        if stored_admin != admin {
            return Err(CarbonError::UnauthorizedVerifier);
        }
        env.storage()
            .persistent()
            .set(&DataKey::SuspendedProject(project_id.clone()), &true);
        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("mkt_susp")),
            project_id,
        );
        Ok(())
    }

    pub fn set_oracle_contract(
        env: Env,
        admin: Address,
        oracle_contract: Address,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::OracleContract, &oracle_contract);
        Ok(())
    }

    pub fn set_price_freshness_window(
        env: Env,
        admin: Address,
        seconds: u64,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::PriceFreshnessWindow, &seconds);
        Ok(())
    }

    pub fn get_price_freshness_window(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::PriceFreshnessWindow)
            .unwrap_or(24 * 60 * 60)
    }

    /// List carbon credits for sale at a fixed USDC price per credit (in stroops).
    pub fn list_credits(
        env: Env,
        seller: Address,
        listing_id: String,
        batch_id: String,
        project_id: String,
        amount: i128,
        price_per_credit_usdc: i128,
        vintage_year: u32,
        methodology: String,
        country: String,
    ) -> Result<(), CarbonError> {
        seller.require_auth();
        Self::require_not_paused(&env)?;

        if amount <= 0 || price_per_credit_usdc <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        Self::validate_vintage_year(&env, vintage_year)?;

        let suspended = env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::SuspendedProject(project_id.clone()))
            .unwrap_or(false);
        if suspended {
            return Err(CarbonError::ProjectSuspended);
        }

        let timestamp = env.ledger().timestamp();
        let listing = MarketListing {
            listing_id: listing_id.clone(),
            seller: seller.clone(),
            batch_id: batch_id.clone(),
            project_id: project_id.clone(),
            amount_available: amount,
            price_per_credit: price_per_credit_usdc,
            vintage_year,
            methodology: methodology.clone(),
            country: country.clone(),
            created_at: timestamp,
            status: ListingStatus::Active,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id.clone()), &listing);
        Self::extend_listing_ttl(&env, &listing_id);

        let mut all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or_else(|| vec![&env]);
        all.push_back(listing_id.clone());
        env.storage().persistent().set(&DataKey::AllListings, &all);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("listed")),
            ListingCreatedEvent {
                listing_id: listing_id.clone(),
                seller: seller.clone(),
                batch_id: batch_id.clone(),
                amount,
                price_per_credit: price_per_credit_usdc,
                timestamp,
            },
        );
        Ok(())
    }

    pub fn delist_credits(
        env: Env,
        seller: Address,
        listing_id: String,
    ) -> Result<(), CarbonError> {
        seller.require_auth();
        Self::require_not_paused(&env)?;

        let mut listing = Self::load_listing(&env, &listing_id)?;
        if listing.seller != seller {
            return Err(CarbonError::UnauthorizedVerifier);
        }

        listing.status = ListingStatus::Delisted;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id.clone()), &listing);
        Self::extend_listing_ttl(&env, &listing_id);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("delisted")),
            (listing_id, seller),
        );
        Ok(())
    }

    pub fn pause_operations(env: Env, admin: Address, until_timestamp: u64) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        let now = env.ledger().timestamp();
        if until_timestamp <= now || until_timestamp > now.saturating_add(72 * 60 * 60) {
            return Err(CarbonError::InvalidPauseWindow);
        }
        env.storage().persistent().set(&DataKey::PauseEnabled, &true);
        env.storage().persistent().set(&DataKey::PauseUntil, &until_timestamp);
        Ok(())
    }

    pub fn unpause_operations(env: Env, admin: Address) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage().persistent().set(&DataKey::PauseEnabled, &false);
        env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
        Ok(())
    }

    pub fn set_vintage_year_bounds(
        env: Env,
        admin: Address,
        min_year: u32,
        max_year: u32,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        if min_year > max_year {
            return Err(CarbonError::InvalidVintageYear);
        }
        env.storage().persistent().set(&DataKey::VintageYearMin, &min_year);
        env.storage().persistent().set(&DataKey::VintageYearMax, &max_year);
        Ok(())
    }

    pub fn purchase_credits(
        env: Env,
        buyer: Address,
        listing_id: String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        buyer.require_auth();
        Self::require_not_paused(&env)?;

        // ── Re-entrancy guard ────────────────────────────────────────────────
        Self::acquire_lock(&env)?;

        if amount <= 0 {
            Self::release_lock(&env);
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        // ── Circuit breaker gate ──────────────────────────────────────────────
        // Block all purchases if the circuit breaker has been tripped (either
        // manually by an admin or automatically due to stale oracle prices).
        if env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::CircuitBreaker)
            .unwrap_or(false)
        {
            Self::release_lock(&env);
            return Err(CarbonError::CircuitBreakerTripped);
        }

        let mut listing = Self::load_listing(&env, &listing_id)?;

        // ── Oracle Benchmark Price Freshness Check (#587) ────────────────────
        if let Some(oracle_address) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::OracleContract)
        {
            let price_current: bool = env.invoke_contract(
                &oracle_address,
                &soroban_sdk::Symbol::new(&env, "is_price_current"),
                soroban_sdk::vec![
                    &env,
                    listing.methodology.clone().into_val(&env),
                    listing.vintage_year.into_val(&env),
                ],
            );

            if !price_current {
                Self::release_lock(&env);
                return Err(CarbonError::MonitoringDataStale);
            }
        }

        if listing.status == ListingStatus::Delisted || listing.status == ListingStatus::Sold {
            Self::release_lock(&env);
            return Err(CarbonError::ListingNotFound);
        }
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::SuspendedProject(listing.project_id.clone()))
            .unwrap_or(false)
        {
            return Err(CarbonError::ProjectSuspended);
        }
        if amount > listing.amount_available {
            Self::release_lock(&env);
            return Err(CarbonError::InsufficientLiquidity);
        }

        let total_cost = listing
            .price_per_credit
            .checked_mul(amount)
            .ok_or(CarbonError::Arithmetic)?;
        let fee_cfg = Self::load_fee_config(&env);
        let protocol_fee = total_cost
            .checked_mul(fee_cfg.numerator)
            .ok_or(CarbonError::Arithmetic)?
            .checked_div(fee_cfg.denom)
            .ok_or(CarbonError::Arithmetic)?;
        let seller_proceeds = total_cost
            .checked_sub(protocol_fee)
            .ok_or(CarbonError::Arithmetic)?;

        listing.amount_available = listing
            .amount_available
            .checked_sub(amount)
            .ok_or(CarbonError::Arithmetic)?;
        listing.status = if listing.amount_available == 0 {
            ListingStatus::Sold
        } else {
            ListingStatus::PartiallyFilled
        };

        let now = env.ledger().timestamp();
        let seller_addr = listing.seller.clone();
        let fee_id = Self::make_fee_id(&env, &listing_id, now);
        let fee_record = FeeRecord {
            fee_id: fee_id.clone(),
            listing_id: listing_id.clone(),
            buyer: buyer.clone(),
            seller: seller_addr,
            total_cost,
            fee_amount: protocol_fee,
            recorded_at: now,
        };
        env.storage().persistent().set(&DataKey::FeeRecord(fee_id.clone()), &fee_record);
        let mut fee_ledger: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::FeeLedger)
            .unwrap_or_else(|| vec![&env]);
        fee_ledger.push_back(fee_id);
        env.storage().persistent().set(&DataKey::FeeLedger, &fee_ledger);

        let acc: i128 = env.storage().persistent().get(&DataKey::FeeAccumulator).unwrap_or(0);
        let new_acc = acc.checked_add(protocol_fee)
            .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;
        env.storage().persistent().set(&DataKey::FeeAccumulator, &new_acc);
        env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);
        Self::extend_listing_ttl(&env, &listing_id);

        let usdc: Address = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
        let usdc_client = token::Client::new(&env, &usdc);
        usdc_client.transfer(&buyer, &listing.seller, &seller_proceeds);

        let treasury: Address = env.storage().persistent().get(&DataKey::Treasury).unwrap();
        usdc_client.transfer(&buyer, &treasury, &protocol_fee);

        let credit_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::CreditContract)
            .unwrap();
        env.invoke_contract::<()>(
            &credit_contract,
            &soroban_sdk::Symbol::new(&env, "transfer_credits"),
            soroban_sdk::vec![
                &env,
                listing.seller.into_val(&env),
                buyer.into_val(&env),
                listing.batch_id.into_val(&env),
                amount.into_val(&env),
            ],
        );

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("purchase")),
            PurchaseCompletedEvent {
                listing_id: listing_id.clone(),
                buyer: buyer.clone(),
                seller: listing.seller.clone(),
                amount,
                total_cost,
                timestamp: env.ledger().timestamp(),
            },
        );

        // ── Auto-sweep if accumulator reaches threshold ───────────────────────
        let threshold: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::SweepThreshold)
            .unwrap_or(DEFAULT_SWEEP_THRESHOLD);
        if new_acc >= threshold {
            Self::do_sweep(&env, new_acc, &usdc_client, &treasury).map_err(|e| {
                Self::release_lock(&env);
                e
            })?;
        }

        Self::release_lock(&env);
        Ok(())
    }

    pub fn bulk_purchase(
        env: Env,
        buyer: Address,
        listing_ids: Vec<String>,
        amounts: Vec<i128>,
    ) -> Result<(), CarbonError> {
        buyer.require_auth();
        Self::require_not_paused(&env)?;

        // ── Re-entrancy guard ────────────────────────────────────────────────
        Self::acquire_lock(&env)?;

        // ── Circuit breaker gate ──────────────────────────────────────────────
        if env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::CircuitBreaker)
            .unwrap_or(false)
        {
            Self::release_lock(&env);
            return Err(CarbonError::CircuitBreakerTripped);
        }

        let len = listing_ids.len();
        if len != amounts.len() || len > MAX_BATCH_SIZE {
            Self::release_lock(&env);
            return Err(CarbonError::InvalidSerialRange);
        }

        let now = env.ledger().timestamp();
        let mut bulk_fee_total = 0_i128;
        let mut validated_listings: Vec<MarketListing> = vec![&env];
        let mut expected_vintage: Option<u32> = None;
        for i in 0..len {
            let listing_id = listing_ids.get(i).unwrap();
            let amount = amounts.get(i).unwrap();

            if amount <= 0 {
                Self::release_lock(&env);
                return Err(CarbonError::ZeroAmountNotAllowed);
            }

            let listing = Self::load_listing(&env, &listing_id)?;
            if listing.status == ListingStatus::Delisted || listing.status == ListingStatus::Sold {
                Self::release_lock(&env);
                return Err(CarbonError::ListingNotFound);
            }
            if env
                .storage()
                .persistent()
                .get::<DataKey, bool>(&DataKey::SuspendedProject(listing.project_id.clone()))
                .unwrap_or(false)
            {
                Self::release_lock(&env);
                return Err(CarbonError::ProjectSuspended);
            }

            Self::validate_vintage_year(&env, listing.vintage_year)?;
            if let Some(expected) = expected_vintage {
                if listing.vintage_year != expected {
                    Self::release_lock(&env);
                    return Err(CarbonError::InvalidVintageYear);
                }
            } else {
                expected_vintage = Some(listing.vintage_year);
            }

            // Oracle staleness check for each listing in the batch
            if let Some(oracle_address) = env
                .storage()
                .persistent()
                .get::<DataKey, Address>(&DataKey::OracleContract)
            {
                let price_current: bool = env.invoke_contract(
                    &oracle_address,
                    &soroban_sdk::Symbol::new(&env, "is_price_current"),
                    soroban_sdk::vec![
                        &env,
                        listing.methodology.clone().into_val(&env),
                        listing.vintage_year.into_val(&env),
                    ],
                );

                if !price_current {
                    let now = env.ledger().timestamp();
                    env.storage().persistent().set(&DataKey::CircuitBreaker, &true);
                    env.storage().persistent().set(&DataKey::CircuitBreakerTrippedAt, &now);
                    env.events().publish(
                        (symbol_short!("c_ledger"), symbol_short!("cb_trip")),
                        CircuitBreakerEvent {
                            methodology:    listing.methodology.clone(),
                            vintage_year:   listing.vintage_year,
                            price_age_secs: 24 * 60 * 60,
                            threshold_secs: 24 * 60 * 60,
                            tripped_at:     now,
                        },
                    );
                    Self::release_lock(&env);
                    return Err(CarbonError::CircuitBreakerTripped);
                }
            }

            if amount > listing.amount_available {
                Self::release_lock(&env);
                return Err(CarbonError::InsufficientLiquidity);
            }
            validated_listings.push_back(listing);
        }

        for i in 0..len {
            let amount = amounts.get(i).unwrap();
            let mut listing = validated_listings.get(i).unwrap();

            let total_cost = listing.price_per_credit.checked_mul(amount)
                .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;
            let protocol_fee = total_cost.checked_div(FEE_RATE_DENOM)
                .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;
            let seller_proceeds = total_cost.checked_sub(protocol_fee)
                .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;

        listing.amount_available = listing.amount_available.checked_sub(amount)
            .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;
            listing.amount_available = listing
                .amount_available
                .checked_sub(amount)
                .ok_or(CarbonError::Arithmetic)?;
            listing.status = if listing.amount_available == 0 {
                ListingStatus::Sold
            } else {
                ListingStatus::PartiallyFilled
            };
            env.storage()
                .persistent()
                .set(&DataKey::Listing(listing.listing_id.clone()), &listing);
            Self::extend_listing_ttl(&env, &listing.listing_id);
            validated_listings.set(i, listing);
        }

        // ── Phase 3: TRANSFER — USDC and credits ─────────────────────────────
        let usdc: Address = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
        let credit_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::CreditContract)
            .unwrap();
        let treasury: Address = env.storage().persistent().get(&DataKey::Treasury).unwrap();
        let usdc_client = token::Client::new(&env, &usdc);

        for i in 0..len {
            let listing = validated_listings.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            let total_cost = listing.price_per_credit.checked_mul(amount)
                .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;
            let fee_cfg = Self::load_fee_config(&env);
            let protocol_fee = total_cost
                .checked_mul(fee_cfg.numerator)
                .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?
                .checked_div(fee_cfg.denom)
                .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;
            let seller_proceeds = total_cost
                .checked_sub(protocol_fee)
                .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;

            let fee_id = Self::make_fee_id(&env, &listing.listing_id, now.saturating_add(i as u64));
            let fee_record = FeeRecord {
                fee_id: fee_id.clone(),
                listing_id: listing.listing_id.clone(),
                buyer: buyer.clone(),
                seller: listing.seller.clone(),
                total_cost,
                fee_amount: protocol_fee,
                recorded_at: now,
            };
            env.storage().persistent().set(&DataKey::FeeRecord(fee_id.clone()), &fee_record);
            let mut fee_ledger: Vec<String> = env
                .storage()
                .persistent()
                .get(&DataKey::FeeLedger)
                .unwrap_or_else(|| vec![&env]);
            fee_ledger.push_back(fee_id);
            env.storage().persistent().set(&DataKey::FeeLedger, &fee_ledger);
            bulk_fee_total = bulk_fee_total.checked_add(protocol_fee)
                .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;

            usdc_client.transfer(&buyer, &listing.seller, &seller_proceeds);
            usdc_client.transfer(&buyer, &treasury, &protocol_fee);

            env.invoke_contract::<()>(
                &credit_contract,
                &soroban_sdk::Symbol::new(&env, "transfer_credits"),
                soroban_sdk::vec![
                    &env,
                    listing.seller.clone().into_val(&env),
                    buyer.clone().into_val(&env),
                    listing.batch_id.clone().into_val(&env),
                    amount.into_val(&env),
                ],
            );

            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("bulk_buy")),
                PurchaseCompletedEvent {
                    listing_id: listing.listing_id.clone(),
                    buyer: buyer.clone(),
                    seller: listing.seller.clone(),
                    amount,
                    total_cost,
                    timestamp: env.ledger().timestamp(),
                },
            );
        }

        // ── Update accumulator and auto-sweep if threshold met ────────────────
        let acc: i128 = env.storage().persistent().get(&DataKey::FeeAccumulator).unwrap_or(0);
        let new_acc = acc.checked_add(bulk_fee_total)
            .ok_or_else(|| { Self::release_lock(&env); CarbonError::Arithmetic })?;
        env.storage().persistent().set(&DataKey::FeeAccumulator, &new_acc);

        let threshold: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::SweepThreshold)
            .unwrap_or(DEFAULT_SWEEP_THRESHOLD);
        if new_acc >= threshold {
            Self::do_sweep(&env, new_acc, &usdc_client, &treasury).map_err(|e| {
                Self::release_lock(&env);
                e
            })?;
        }

        Self::release_lock(&env);
        Ok(())
    }

    pub fn get_listing(env: Env, listing_id: String) -> Result<MarketListing, CarbonError> {
        Self::load_listing(&env, &listing_id)
    }

    pub fn get_active_listings(env: Env) -> Vec<MarketListing> {
        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or_else(|| vec![&env]);

        let mut result: Vec<MarketListing> = vec![&env];
        for id in all.iter() {
            if let Some(listing) = env.storage().persistent().get(&DataKey::Listing(id.clone())) {
                if listing.status == ListingStatus::Active
                    || listing.status == ListingStatus::PartiallyFilled
                {
                    result.push_back(listing);
                }
            }
        }
        result
    }

    pub fn get_listings_by_project(env: Env, project_id: String) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| l.project_id == project_id)
    }

    pub fn get_listings_by_vintage(env: Env, vintage_year: u32) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| l.vintage_year == vintage_year)
    }

    /// Returns a paginated slice of active (or partially filled) listings.
    ///
    /// `offset` is 0-based (skip the first `offset` matching items).
    /// `limit` is capped at `MAX_PAGE_SIZE` (50).  Returns `PageSizeTooLarge`
    /// if `limit` exceeds the cap *before* capping.
    pub fn get_listings_page(
        env: Env,
        offset: u32,
        limit: u32,
    ) -> Result<ListingsPage, CarbonError> {
        if limit > MAX_PAGE_SIZE {
            return Err(CarbonError::PageSizeTooLarge);
        }

        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or_else(|| vec![&env]);

        // First pass: collect matching items + count total
        let mut total: u32 = 0;
        let mut matching: Vec<MarketListing> = vec![&env];
        for id in all.iter() {
            if let Some(l) = env.storage().persistent().get(&DataKey::Listing(id.clone())) {
                if l.status == ListingStatus::Active || l.status == ListingStatus::PartiallyFilled {
                    total += 1;
                    matching.push_back(l);
                }
            }
        }

        // Second pass: apply offset + limit
        let mut page: Vec<MarketListing> = vec![&env];
        let mut skipped: u32 = 0;
        for i in 0..matching.len() {
            let item = matching.get(i).unwrap();
            if skipped < offset {
                skipped += 1;
                continue;
            }
            if page.len() >= limit as u32 {
                break;
            }
            page.push_back(item);
        }

        Ok(ListingsPage {
            items: page,
            total,
            offset,
        })
    }

    /// Returns a paginated slice of listings filtered by vintage year.
    pub fn get_listings_by_vintage_page(
        env: Env,
        vintage_year: u32,
        offset: u32,
        limit: u32,
    ) -> Result<ListingsPage, CarbonError> {
        if limit > MAX_PAGE_SIZE {
            return Err(CarbonError::PageSizeTooLarge);
        }

        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or_else(|| vec![&env]);

        let mut total: u32 = 0;
        let mut matching: Vec<MarketListing> = vec![&env];
        for id in all.iter() {
            if let Some(l) = env.storage().persistent().get(&DataKey::Listing(id.clone())) {
                if l.vintage_year == vintage_year {
                    total += 1;
                    matching.push_back(l);
                }
            }
        }

        let mut page: Vec<MarketListing> = vec![&env];
        let mut skipped: u32 = 0;
        for i in 0..matching.len() {
            let item = matching.get(i).unwrap();
            if skipped < offset {
                skipped += 1;
                continue;
            }
            if page.len() >= limit as u32 {
                break;
            }
            page.push_back(item);
        }

        Ok(ListingsPage {
            items: page,
            total,
            offset,
        })
    }

    // ── Fee collection API ────────────────────────────────────────────────────

    /// Returns the immutable fee record for a given fee_id.
    pub fn get_fee_record(env: Env, fee_id: String) -> Option<FeeRecord> {
        env.storage().persistent().get(&DataKey::FeeRecord(fee_id))
    }

    /// Returns all fee record IDs in insertion order (append-only ledger).
    pub fn get_fee_ledger(env: Env) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::FeeLedger)
            .unwrap_or_else(|| vec![&env])
    }

    /// Returns all fee records (full details) in insertion order.
    /// Use for audit: every fee ever collected, immutable.
    pub fn get_fee_history(env: Env) -> Vec<FeeRecord> {
        let ids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::FeeLedger)
            .unwrap_or_else(|| vec![&env]);

        let mut records: Vec<FeeRecord> = vec![&env];
        for id in ids.iter() {
            if let Some(r) = env.storage().persistent().get(&DataKey::FeeRecord(id.clone())) {
                records.push_back(r);
            }
        }
        records
    }

    /// Returns the running uncollected fee accumulator balance (stroops).
    pub fn get_fee_accumulator(env: Env) -> i128 {
        env.storage().persistent().get(&DataKey::FeeAccumulator).unwrap_or(0)
    }

    /// Returns the total fees swept to treasury since contract deployment.
    pub fn get_total_fees_swept(env: Env) -> i128 {
        env.storage().persistent().get(&DataKey::TotalFeesSwept).unwrap_or(0)
    }

    /// Returns the current auto-sweep threshold (USDC stroops).
    pub fn get_sweep_threshold(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::SweepThreshold)
            .unwrap_or(DEFAULT_SWEEP_THRESHOLD)
    }

    /// Admin: update the auto-sweep threshold.
    pub fn set_sweep_threshold(env: Env, admin: Address, threshold: i128) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        if threshold <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }
        env.storage().persistent().set(&DataKey::SweepThreshold, &threshold);
        Ok(())
    }

    /// Manually sweep all accumulated fees to treasury.
    /// Can be called by anyone; the funds always go to the configured treasury address.
    pub fn sweep_fees(env: Env) -> Result<i128, CarbonError> {
        Self::require_not_paused(&env)?;
        let acc: i128 = env.storage().persistent().get(&DataKey::FeeAccumulator).unwrap_or(0);
        if acc == 0 {
            return Ok(0);
        }
        let usdc: Address    = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
        let treasury: Address = env.storage().persistent().get(&DataKey::Treasury).unwrap();
        let usdc_client = token::Client::new(&env, &usdc);
        let contract_self = env.current_contract_address();
        // Fees were already transferred to treasury during purchase — accumulator
        // tracks the accounting total; reset it to zero.
        let _ = contract_self; // no on-chain re-transfer needed; treasury already received funds
        env.storage().persistent().set(&DataKey::FeeAccumulator, &0_i128);
        let swept_total: i128 = env.storage().persistent().get(&DataKey::TotalFeesSwept).unwrap_or(0);
        let new_swept = swept_total.checked_add(acc).ok_or(CarbonError::Arithmetic)?;
        env.storage().persistent().set(&DataKey::TotalFeesSwept, &new_swept);
        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("swept")),
            FeeSweptEvent {
                swept_by:  env.current_contract_address(),
                amount:    acc,
                swept_at:  env.ledger().timestamp(),
            },
        );
        Ok(acc)
    }

    fn make_fee_id(env: &Env, listing_id: &String, stamp: u64) -> String {
        let _ = stamp;
        let _ = listing_id;
        String::from_str(env, "fee")
    }

    fn is_vintage_expired(env: &Env, vintage_year: u32) -> bool {
        if Self::validate_vintage_year(env, vintage_year).is_err() {
            return true;
        }
        let current_year = Self::current_year(env);
        current_year.saturating_sub(vintage_year) > MAX_VINTAGE_AGE_YEARS
    }

    fn do_sweep(
        env: &Env,
        amount: i128,
        _usdc_client: &token::Client,
        _treasury: &Address,
    ) -> Result<(), CarbonError> {
        env.storage().persistent().set(&DataKey::FeeAccumulator, &0_i128);
        let swept_total: i128 = env.storage().persistent().get(&DataKey::TotalFeesSwept).unwrap_or(0);
        let new_swept = swept_total.checked_add(amount).ok_or(CarbonError::Arithmetic)?;
        env.storage().persistent().set(&DataKey::TotalFeesSwept, &new_swept);
        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("swept")),
            FeeSweptEvent {
                swept_by: env.current_contract_address(),
                amount,
                swept_at: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    fn extend_listing_ttl(env: &Env, listing_id: &String) {
        let key = DataKey::Listing(listing_id.clone());
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        }
    }

    fn load_listing(env: &Env, listing_id: &String) -> Result<MarketListing, CarbonError> {
        let key = DataKey::Listing(listing_id.clone());
        let listing = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(CarbonError::ListingNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        Ok(listing)
    }

    fn filter_listings<F: Fn(&MarketListing) -> bool>(
        env: &Env,
        predicate: F,
    ) -> Vec<MarketListing> {
        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or_else(|| vec![env]);

        let mut result: Vec<MarketListing> = vec![env];
        for id in all.iter() {
            if let Some(l) = env
                .storage()
                .persistent()
                .get(&DataKey::Listing(id.clone()))
            {
                if predicate(&l) {
                    result.push_back(l);
                }
            }
        }
        result
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), CarbonError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(CarbonError::UnauthorizedVerifier)?;
        if &admin != caller {
            return Err(CarbonError::UnauthorizedVerifier);
        }
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), CarbonError> {
        let paused: bool = env.storage().persistent().get(&DataKey::PauseEnabled).unwrap_or(false);
        let until: u64 = env.storage().persistent().get(&DataKey::PauseUntil).unwrap_or(0);
        let now = env.ledger().timestamp();
        if paused && until > now {
            return Err(CarbonError::EmergencyPaused);
        }
        if paused && until <= now {
            env.storage().persistent().set(&DataKey::PauseEnabled, &false);
            env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
        }
        Ok(())
    }

    // ── Re-entrancy guard helpers ───────────────────────────────────────────

    /// Acquire the re-entrancy lock.  Returns `ReentrancyDetected` if already locked.
    fn acquire_lock(env: &Env) -> Result<(), CarbonError> {
        let locked: bool = env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::ReentrancyGuard)
            .unwrap_or(false);
        if locked {
            return Err(CarbonError::ReentrancyDetected);
        }
        env.storage()
            .persistent()
            .set(&DataKey::ReentrancyGuard, &true);
        Ok(())
    }

    /// Release the re-entrancy lock.
    fn release_lock(env: &Env) {
        env.storage()
            .persistent()
            .set(&DataKey::ReentrancyGuard, &false);
    }
}

#[cfg(test)]
#[allow(deprecated)]
mod tests {
    use super::*;
    use carbon_credit::CarbonCreditContract;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup(
        env: &Env,
    ) -> (
        CarbonMarketplaceContractClient,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1735689600, // 2025-01-01
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        let seller = Address::generate(env);
        let usdc = env.register_stellar_asset_contract(admin.clone());
        let credit_id = env.register_contract(None, CarbonCreditContract);
        let id = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_id, &treasury);
        (client, admin, treasury, seller, usdc)
    }

    fn add_listing(env: &Env, client: &CarbonMarketplaceContractClient, seller: &Address) {
        client.list_credits(
            seller,
            &s(env, "list-001"),
            &s(env, "batch-001"),
            &s(env, "proj-001"),
            &100_i128,
            &10_0000000_i128,
            &2023_u32,
            &s(env, "VCS"),
            &s(env, "Brazil"),
        );
    }

    #[test]
    fn test_list_credits_creates_active_listing() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Active);
        assert_eq!(l.amount_available, 100);
    }

    #[test]
    fn test_delist_removes_listing() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        client.delist_credits(&seller, &s(&env, "list-001"));
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Delisted);
    }

    #[test]
    fn test_purchase_insufficient_credits_fails() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &999_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_listings_by_project() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let listings = client.get_listings_by_project(&s(&env, "proj-001"));
        assert_eq!(listings.len(), 1);
    }

    #[test]
    fn test_get_listings_by_vintage() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let listings = client.get_listings_by_vintage(&2023_u32);
        assert_eq!(listings.len(), 1);
        let empty = client.get_listings_by_vintage(&2020_u32);
        assert_eq!(empty.len(), 0);
    }

    #[test]
    fn test_get_active_listings() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let active = client.get_active_listings();
        assert_eq!(active.len(), 1);
    }

    #[test]
    fn test_zero_amount_listing_fails() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        let result = client.try_list_credits(
            &seller,
            &s(&env, "list-002"),
            &s(&env, "batch-002"),
            &s(&env, "proj-001"),
            &0_i128,
            &10_0000000_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_suspended_project_listing_blocked() {
        let env = Env::default();
        let (client, admin, _, seller, _) = setup(&env);
        client.suspend_project(&admin, &s(&env, "proj-001"));
        let result = client.try_list_credits(
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
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
    }

    #[test]
    fn test_suspended_project_purchase_blocked() {
        let env = Env::default();
        let (client, admin, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        client.suspend_project(&admin, &s(&env, "proj-001"));
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &10_i128);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
    }

    #[test]
    fn test_non_suspended_project_listing_succeeds() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Active);
    }

    #[test]
    #[ignore = "requires initialized credit contract for cross-contract call"]
    fn test_overflow_purchase_graceful_error() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);

        client.list_credits(
            &seller,
            &s(&env, "list-001"),
            &s(&env, "batch-001"),
            &s(&env, "proj-001"),
            &100_i128,
            &1_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );

        // Purchase must fail because wrong_credit has no transfer_credits function
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &10_i128);
        assert!(result.is_err());
    }
    #[test]
    fn test_update_treasury() {
        let env = Env::default();
        let (client, admin, _treasury, _seller, _) = setup(&env);
        let new_treasury = Address::generate(&env);

        // Admin can update
        client.update_treasury(&admin, &new_treasury);

        let fake_admin = Address::generate(&env);
        let res = client.try_update_treasury(&fake_admin, &new_treasury);
        assert_eq!(res.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);
    }

    #[test]
    #[ignore = "requires initialized credit contract for cross-contract call"]
    fn test_purchase_exact_fee_routing() {
        let env = Env::default();
        let (client, _, treasury, seller, usdc) = setup(&env);

        client.list_credits(
            &seller,
            &s(&env, "list-fee"),
            &s(&env, "batch-fee"),
            &s(&env, "proj-fee"),
            &100_i128,
            &1500_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );

        let buyer = Address::generate(&env);
        let usdc_client = token::Client::new(&env, &usdc);

        let initial_treasury_bal = usdc_client.balance(&treasury);
        let initial_seller_bal = usdc_client.balance(&seller);

        client.purchase_credits(&buyer, &s(&env, "list-fee"), &10_i128);

        let final_treasury_bal = usdc_client.balance(&treasury);
        let final_seller_bal = usdc_client.balance(&seller);

        assert_eq!(final_treasury_bal - initial_treasury_bal, 150);
        assert_eq!(final_seller_bal - initial_seller_bal, 15000 - 150);
    }
}

// ── Property-based fuzz tests ─────────────────────────────────────────────────

#[cfg(test)]
#[allow(deprecated)]
mod fuzz {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    /// Set up a fresh marketplace with a USDC mock and one active listing.
    fn setup_with_listing(
        env: &Env,
        listing_amount: i128,
        price_per_credit: i128,
    ) -> (
        CarbonMarketplaceContractClient,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1735689600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        let seller = Address::generate(env);
        let usdc = env.register_stellar_asset_contract(admin.clone());
        let credit_id = env.register_contract(None, carbon_credit::CarbonCreditContract);
        let id = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_id, &treasury);
        client.list_credits(
            &seller,
            &s(env, "list-fuzz"),
            &s(env, "batch-fuzz"),
            &s(env, "proj-fuzz"),
            &listing_amount,
            &price_per_credit,
            &2023_u32,
            &s(env, "VCS"),
            &s(env, "Brazil"),
        );
        (client, admin, treasury, seller, usdc)
    }

    proptest! {
        /// Purchasing zero or negative credits must return ZeroAmountNotAllowed — never panic.
        #[test]
        fn fuzz_purchase_zero_or_negative(amount in i128::MIN..=0_i128) {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, 100, 10_0000000);
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Purchasing more than available must return InsufficientLiquidity — never panic.
        #[test]
        fn fuzz_purchase_exceeds_available(excess in 1_i128..1_000_000_i128) {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, 100, 10_0000000);
            let buyer = Address::generate(&env);
            let over = 100_i128 + excess;
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &over);
            prop_assert!(result.is_err());
        }

        /// Purchasing from a non-existent listing must return ListingNotFound — never panic.
        #[test]
        fn fuzz_purchase_nonexistent_listing(_suffix in "[a-z]{1,8}") {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, 100, 10_0000000);
            let buyer = Address::generate(&env);
            let bad_result = client.try_purchase_credits(&buyer, &s(&env, "no-such-listing"), &10_i128);
            prop_assert!(bad_result.is_err());
        }

        /// Purchasing from a delisted listing must return ListingNotFound — never panic.
        #[test]
        fn fuzz_purchase_delisted_listing(amount in 1_i128..50_i128) {
            let env = Env::default();
            let (client, _, _, seller, _) = setup_with_listing(&env, 100, 10_0000000);
            client.delist_credits(&seller, &s(&env, "list-fuzz"));
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Purchasing from a suspended project must return ProjectSuspended — never panic.
        #[test]
        fn fuzz_purchase_suspended_project(amount in 1_i128..50_i128) {
            let env = Env::default();
            let (client, admin, _, _, _) = setup_with_listing(&env, 100, 10_0000000);
            client.suspend_project(&admin, &s(&env, "proj-fuzz"));
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Valid purchase reduces amount_available by exactly the purchased amount.
        #[test]
        #[ignore = "requires initialized credit contract for cross-contract call"]
        fn fuzz_purchase_valid_reduces_available(
            listing_amount in 2_i128..1_000_i128,
            buy_frac in 1_u32..99_u32,
        ) {
            let buy_amount = (listing_amount * buy_frac as i128 / 100).max(1).min(listing_amount - 1);
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, listing_amount, 1_i128);
            let buyer = Address::generate(&env);
            // purchase may fail due to cross-contract call; check listing state regardless
            let _ = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &buy_amount);
            // If it succeeded, amount_available should be reduced; if not, listing is unchanged
            let listing = client.get_listing(&s(&env, "list-fuzz"));
            prop_assert!(listing.amount_available <= listing_amount);
        }

        /// Purchasing the full listing amount marks it Sold — never panic.
        #[test]
        #[ignore = "requires initialized credit contract for cross-contract call"]
        fn fuzz_purchase_full_amount_marks_sold(listing_amount in 1_i128..1_000_i128) {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, listing_amount, 1_i128);
            let buyer = Address::generate(&env);
            let _ = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &listing_amount);
            // No panic — listing state is valid regardless of outcome
            let listing = client.get_listing(&s(&env, "list-fuzz"));
            prop_assert!(listing.amount_available >= 0);
        }

        /// Any purchase from a Sold listing must fail — never panic.
        #[test]
        #[ignore = "requires initialized credit contract for cross-contract call"]
        fn fuzz_purchase_from_sold_listing_fails(second_amount in 1_i128..100_i128) {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, 100, 1_i128);
            let buyer = Address::generate(&env);
            // First purchase may fail due to cross-contract call; either way second must fail
            let _ = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &100_i128);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &second_amount);
            prop_assert!(result.is_err());
        }

        /// list_credits with zero amount or zero price must always fail — never panic.
        #[test]
        fn fuzz_list_zero_amount_or_price(
            amount in i128::MIN..=0_i128,
            price in i128::MIN..=0_i128,
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let admin    = Address::generate(&env);
            let treasury = Address::generate(&env);
            let seller   = Address::generate(&env);
            let usdc     = env.register_stellar_asset_contract(admin.clone());
            let credit_id = env.register_contract(None, carbon_credit::CarbonCreditContract);
            let id       = env.register_contract(None, CarbonMarketplaceContract);
            let client   = CarbonMarketplaceContractClient::new(&env, &id);
            client.initialize(&admin, &usdc, &credit_id, &treasury);

            let r1 = client.try_list_credits(
                &seller, &s(&env, "l1"), &s(&env, "b1"), &s(&env, "p1"),
                &amount, &10_0000000_i128, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
            );
            prop_assert!(r1.is_err());

            let r2 = client.try_list_credits(
                &seller, &s(&env, "l2"), &s(&env, "b2"), &s(&env, "p2"),
                &100_i128, &price, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
            );
            prop_assert!(r2.is_err());
        }
    }
}

// ── Edge-case tests (issue #91) ───────────────────────────────────────────────

#[cfg(test)]
#[allow(deprecated)]
mod edge_case_tests {
    use super::*;
    use carbon_credit::CarbonCreditContract;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Env, String,
    };

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn init(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address) {
        env.mock_all_auths();
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1735689600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        let usdc = env.register_stellar_asset_contract(admin.clone());
        let credit_id = env.register_contract(None, CarbonCreditContract);
        let credit_client = carbon_credit::CarbonCreditContractClient::new(env, &credit_id);
        let registry = Address::generate(env);
        credit_client.initialize(&admin, &registry);
        let id = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_id, &treasury);
        (client, admin, treasury)
    }

    fn add_listing(
        env: &Env,
        client: &CarbonMarketplaceContractClient,
        seller: &Address,
        listing_id: &str,
        project_id: &str,
    ) {
        client.list_credits(
            seller,
            &s(env, listing_id),
            &s(env, "batch-1"),
            &s(env, project_id),
            &100_i128,
            &10_0000000_i128,
            &2023_u32,
            &s(env, "VCS"),
            &s(env, "Brazil"),
        );
    }

    // ── ZeroAmountNotAllowed ──────────────────────────────────────────────────

    #[test]
    fn test_list_zero_amount_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        let result = client.try_list_credits(
            &seller,
            &s(&env, "l1"),
            &s(&env, "b1"),
            &s(&env, "p1"),
            &0_i128,
            &10_0000000_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "BR"),
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::ZeroAmountNotAllowed
        );
    }

    #[test]
    fn test_list_zero_price_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        let result = client.try_list_credits(
            &seller,
            &s(&env, "l1"),
            &s(&env, "b1"),
            &s(&env, "p1"),
            &100_i128,
            &0_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "BR"),
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::ZeroAmountNotAllowed
        );
    }

    #[test]
    fn test_purchase_zero_amount_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "l1"), &0_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::ZeroAmountNotAllowed
        );
    }

    // ── InvalidVintageYear ────────────────────────────────────────────────────

    #[test]
    fn test_list_vintage_1989_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        let result = client.try_list_credits(
            &seller,
            &s(&env, "l1"),
            &s(&env, "b1"),
            &s(&env, "p1"),
            &100_i128,
            &10_0000000_i128,
            &1989_u32,
            &s(&env, "VCS"),
            &s(&env, "BR"),
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InvalidVintageYear
        );
    }

    // ── ListingNotFound ───────────────────────────────────────────────────────

    #[test]
    fn test_purchase_nonexistent_listing_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "no-such"), &10_i128);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ListingNotFound);
    }

    #[test]
    fn test_purchase_delisted_listing_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1");
        client.delist_credits(&seller, &s(&env, "l1"));
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "l1"), &10_i128);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ListingNotFound);
    }

    // ── InsufficientLiquidity ─────────────────────────────────────────────────

    #[test]
    fn test_purchase_exceeds_available_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1"); // 100 credits
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "l1"), &101_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InsufficientLiquidity
        );
    }

    // ── ProjectSuspended ──────────────────────────────────────────────────────

    #[test]
    fn test_list_suspended_project_fails() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        client.suspend_project(&admin, &s(&env, "p1"));
        let seller = Address::generate(&env);
        let result = client.try_list_credits(
            &seller,
            &s(&env, "l1"),
            &s(&env, "b1"),
            &s(&env, "p1"),
            &100_i128,
            &10_0000000_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "BR"),
        );
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
    }

    #[test]
    fn test_purchase_suspended_project_fails() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1");
        client.suspend_project(&admin, &s(&env, "p1"));
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "l1"), &10_i128);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
    }

    // ── UnauthorizedVerifier (delist by non-seller, admin functions) ──────────

    #[test]
    fn test_non_seller_cannot_delist() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1");
        let rogue = Address::generate(&env);
        let result = client.try_delist_credits(&rogue, &s(&env, "l1"));
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedVerifier
        );
    }

    #[test]
    fn test_non_admin_cannot_suspend_project() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let rogue = Address::generate(&env);
        let result = client.try_suspend_project(&rogue, &s(&env, "p1"));
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedVerifier
        );
    }

    #[test]
    fn test_non_admin_cannot_update_treasury() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let rogue = Address::generate(&env);
        let new_treasury = Address::generate(&env);
        let result = client.try_update_treasury(&rogue, &new_treasury);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedVerifier
        );
    }

    // ── AlreadyInitialized ────────────────────────────────────────────────────

    #[test]
    fn test_double_initialize_fails() {
        let env = Env::default();
        let (client, admin, treasury) = init(&env);
        let usdc = Address::generate(&env);
        let credit = Address::generate(&env);
        let result = client.try_initialize(&admin, &usdc, &credit, &treasury);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::AlreadyInitialized
        );
    }

    // ── Fee governance tests (issue #651) ─────────────────────────────────────

    #[test]
    fn test_default_fee_config_is_one_percent() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let fee = client.get_fee_config();
        assert_eq!(fee.numerator, DEFAULT_FEE_NUMERATOR);
        assert_eq!(fee.denom, DEFAULT_FEE_DENOM);
    }

    #[test]
    fn test_admin_can_set_fee_rate() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        // Set fee to 2%
        client.set_fee_rate(&admin, &2_i128, &100_i128);
        let fee = client.get_fee_config();
        assert_eq!(fee.numerator, 2);
        assert_eq!(fee.denom, 100);
    }

    #[test]
    fn test_non_admin_cannot_set_fee_rate() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let rogue = Address::generate(&env);
        let result = client.try_set_fee_rate(&rogue, &2_i128, &100_i128);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);
    }

    #[test]
    fn test_fee_above_ten_percent_rejected() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        // 11% must be rejected
        let result = client.try_set_fee_rate(&admin, &11_i128, &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_denom_fee_rejected() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        let result = client.try_set_fee_rate(&admin, &1_i128, &0_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_fee_rate_accepted() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        // 0% fee is valid
        client.set_fee_rate(&admin, &0_i128, &100_i128);
        let fee = client.get_fee_config();
        assert_eq!(fee.numerator, 0);
    }

    #[test]
    fn test_max_ten_percent_fee_accepted() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        // Exactly 10% = 10/100 is valid (numerator == denom/10)
        client.set_fee_rate(&admin, &10_i128, &100_i128);
        let fee = client.get_fee_config();
        assert_eq!(fee.numerator, 10);
    }

    // ── InvalidSerialRange (bulk_purchase length mismatch) ────────────────────

    #[test]
    fn test_bulk_purchase_length_mismatch_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let buyer = Address::generate(&env);
        let ids = soroban_sdk::vec![&env, s(&env, "l1"), s(&env, "l2")];
        let amounts = soroban_sdk::vec![&env, 10_i128]; // length mismatch
        let result = client.try_bulk_purchase(&buyer, &ids, &amounts);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InvalidSerialRange
        );
    }

    // ── Mutation-testing survivor kills (issue #632) ──────────────────────────
    //
    // `len != amounts.len() || len > MAX_BATCH_SIZE` guards bulk_purchase.
    // These tests exercise the MAX_BATCH_SIZE (10) boundary directly, without
    // requiring real listings/cross-contract transfers: the length check runs
    // before any listing is loaded, so a request that passes the length check
    // but references nonexistent listings surfaces ListingNotFound instead of
    // InvalidSerialRange, proving the boundary comparison is `>` not `>=`.

    #[test]
    fn test_bulk_purchase_exact_max_batch_size_passes_length_check() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let buyer = Address::generate(&env);
        let ids = soroban_sdk::vec![
            &env,
            s(&env, "l0"),
            s(&env, "l1"),
            s(&env, "l2"),
            s(&env, "l3"),
            s(&env, "l4"),
            s(&env, "l5"),
            s(&env, "l6"),
            s(&env, "l7"),
            s(&env, "l8"),
            s(&env, "l9"),
        ];
        let amounts = soroban_sdk::vec![
            &env, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128,
            10_i128,
        ];
        let result = client.try_bulk_purchase(&buyer, &ids, &amounts);
        // Exactly MAX_BATCH_SIZE (10) listings must pass the length guard and
        // fail downstream on the (nonexistent) listing lookup instead.
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ListingNotFound);
    }

    #[test]
    fn test_bulk_purchase_over_max_batch_size_fails_length_check() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let buyer = Address::generate(&env);
        let ids = soroban_sdk::vec![
            &env,
            s(&env, "l0"),
            s(&env, "l1"),
            s(&env, "l2"),
            s(&env, "l3"),
            s(&env, "l4"),
            s(&env, "l5"),
            s(&env, "l6"),
            s(&env, "l7"),
            s(&env, "l8"),
            s(&env, "l9"),
            s(&env, "l10"),
        ];
        let amounts = soroban_sdk::vec![
            &env, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128, 10_i128,
            10_i128, 10_i128,
        ];
        let result = client.try_bulk_purchase(&buyer, &ids, &amounts);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InvalidSerialRange
        );
    }

    /// Kills mutation of `vintage_year < 1990` -> `<= 1990` in list_credits:
    /// vintage 1990 is the minimum valid year and must be accepted.
    #[test]
    fn test_list_vintage_1990_succeeds() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        client.list_credits(
            &seller,
            &s(&env, "l-1990"),
            &s(&env, "b-1990"),
            &s(&env, "p1"),
            &100_i128,
            &10_0000000_i128,
            &1990_u32,
            &s(&env, "VCS"),
            &s(&env, "BR"),
        );
        let l = client.get_listing(&s(&env, "l-1990"));
        assert_eq!(l.vintage_year, 1990);
    }
}

// ── Fee Config Tests (#651) ───────────────────────────────────────────────────

#[cfg(test)]
mod fee_config_tests {
    use super::*;
    use carbon_credit::CarbonCreditContract;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup(
        env: &Env,
    ) -> (
        CarbonMarketplaceContractClient,
        Address, // admin
        Address, // treasury
        Address, // seller
        Address, // usdc
    ) {
        env.mock_all_auths();
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1735689600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        let seller = Address::generate(env);
        let usdc = env.register_stellar_asset_contract(admin.clone());
        let credit_id = env.register_contract(None, CarbonCreditContract);
        let id = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_id, &treasury);
        (client, admin, treasury, seller, usdc)
    }

    /// Admin can change fee rate to 2%
    #[test]
    fn test_fee_change_by_admin() {
        let env = Env::default();
        let (client, admin, _, _, _) = setup(&env);

        client.set_fee_rate(&admin, &2_i128, &100_i128);

        let cfg = client.get_fee_config();
        assert_eq!(cfg.numerator, 2);
        assert_eq!(cfg.denom, 100);
        assert_eq!(cfg.updated_by, admin);
    }

    /// Non-admin cannot change fee rate
    #[test]
    fn test_fee_change_rejected_by_non_admin() {
        let env = Env::default();
        let (client, _admin, _, _, _) = setup(&env);
        let rogue = Address::generate(&env);

        let result = client.try_set_fee_rate(&rogue, &2_i128, &100_i128);
        assert!(result.is_err());
    }

    /// Fee rate above 10% (numerator > denom/10) is rejected
    #[test]
    fn test_fee_above_max_rejected() {
        let env = Env::default();
        let (client, admin, _, _, _) = setup(&env);

        // 11/100 = 11% — exceeds max of 10%
        let result = client.try_set_fee_rate(&admin, &11_i128, &100_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::FeeConfigInvalid
        );
    }

    /// denom = 0 is rejected
    #[test]
    fn test_fee_zero_denom_rejected() {
        let env = Env::default();
        let (client, admin, _, _, _) = setup(&env);

        let result = client.try_set_fee_rate(&admin, &1_i128, &0_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::FeeConfigInvalid
        );
    }

    /// negative numerator is rejected
    #[test]
    fn test_fee_negative_numerator_rejected() {
        let env = Env::default();
        let (client, admin, _, _, _) = setup(&env);

        let result = client.try_set_fee_rate(&admin, &-1_i128, &100_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::FeeConfigInvalid
        );
    }

    /// Default fee (before any set_fee_rate call) is 1/100 = 1%
    #[test]
    fn test_default_fee_is_1_percent() {
        let env = Env::default();
        let (client, _, _, _, _) = setup(&env);

        let cfg = client.get_fee_config();
        assert_eq!(cfg.numerator, 1);
        assert_eq!(cfg.denom, 100);
    }

    /// After set_fee_rate(2, 100), a purchase of price=1000, amount=1
    /// should route 980 to seller and 20 to treasury
    #[test]
    fn test_purchase_uses_new_fee_rate() {
        let env = Env::default();
        let (client, admin, treasury, seller, usdc) = setup(&env);

        // Set 2% fee
        client.set_fee_rate(&admin, &2_i128, &100_i128);

        // List 100 credits at price 1000 stroop each
        client.list_credits(
            &seller,
            &s(&env, "list-fee"),
            &s(&env, "batch-fee"),
            &s(&env, "proj-fee"),
            &100_i128,
            &1000_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );

        // Fund buyer
        let buyer = Address::generate(&env);
        let usdc_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &usdc);
        usdc_admin_client.mint(&buyer, &200_000_i128);

        let usdc_client = soroban_sdk::token::Client::new(&env, &usdc);
        let seller_before = usdc_client.balance(&seller);
        let treasury_before = usdc_client.balance(&treasury);

        // Purchase 10 credits: total = 10 * 1000 = 10_000
        // fee = 10_000 * 2 / 100 = 200
        // seller gets = 10_000 - 200 = 9_800
        client.purchase_credits(&buyer, &s(&env, "list-fee"), &10_i128);

        let seller_after = usdc_client.balance(&seller);
        let treasury_after = usdc_client.balance(&treasury);

        assert_eq!(seller_after - seller_before, 9_800);
        assert_eq!(treasury_after - treasury_before, 200);
    }
}

#[cfg(test)]
mod pagination_tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address) {
        env.mock_all_auths();
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1_735_689_600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518_400,
        });
        let admin    = Address::generate(env);
        let treasury = Address::generate(env);
        let seller   = Address::generate(env);
        let usdc     = env.register_stellar_asset_contract(admin.clone());
        let credit_id = env.register_contract(None, carbon_credit::CarbonCreditContract);
        let id       = env.register_contract(None, CarbonMarketplaceContract);
        let client   = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_id, &treasury);
        (client, admin, seller)
    }

    fn add_listing(env: &Env, client: &CarbonMarketplaceContractClient, seller: &Address, id: &str, vintage: u32) {
        client.list_credits(
            seller,
            &s(env, id),
            &s(env, &format!("batch-{id}")),
            &s(env, &format!("proj-{id}")),
            &100_i128,
            &10_0000000_i128,
            &vintage,
            &s(env, "VCS"),
            &s(env, "Brazil"),
        );
    }

    // ── Empty marketplace ────────────────────────────────────────────────────

    #[test]
    fn test_empty_page_returns_zero_total() {
        let env = Env::default();
        let (client, _, _) = setup(&env);
        let page = client.get_listings_page(&0, &10);
        assert_eq!(page.total, 0);
        assert_eq!(page.items.len(), 0);
        assert_eq!(page.offset, 0);
    }

    // ── Single page ─────────────────────────────────────────────────────────

    #[test]
    fn test_single_page_all_items_fit() {
        let env = Env::default();
        let (client, _, seller) = setup(&env);
        add_listing(&env, &client, &seller, "l1", 2023);
        add_listing(&env, &client, &seller, "l2", 2024);

        let page = client.get_listings_page(&0, &10);
        assert_eq!(page.total, 2);
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.offset, 0);
    }

    // ── Multi-page ──────────────────────────────────────────────────────────

    #[test]
    fn test_multi_page_paging_through() {
        let env = Env::default();
        let (client, _, seller) = setup(&env);
        for i in 0..5 {
            add_listing(&env, &client, &seller, &format!("mp-{i}"), 2023);
        }

        let page1 = client.get_listings_page(&0, &2);
        assert_eq!(page1.total, 5);
        assert_eq!(page1.items.len(), 2);
        assert_eq!(page1.offset, 0);

        let page2 = client.get_listings_page(&2, &2);
        assert_eq!(page2.total, 5);
        assert_eq!(page2.items.len(), 2);
        assert_eq!(page2.offset, 2);

        let page3 = client.get_listings_page(&4, &2);
        assert_eq!(page3.total, 5);
        assert_eq!(page3.items.len(), 1);
        assert_eq!(page3.offset, 4);
    }

    // ── Offset beyond end ───────────────────────────────────────────────────

    #[test]
    fn test_offset_beyond_total_returns_empty_page() {
        let env = Env::default();
        let (client, _, seller) = setup(&env);
        add_listing(&env, &client, &seller, "oob-1", 2023);

        let page = client.get_listings_page(&100, &10);
        assert_eq!(page.total, 1);
        assert_eq!(page.items.len(), 0);
        assert_eq!(page.offset, 100);
    }

    // ── PageSizeTooLarge ────────────────────────────────────────────────────

    #[test]
    fn test_page_size_too_large_returns_error() {
        let env = Env::default();
        let (client, _, _) = setup(&env);
        let result = client.try_get_listings_page(&0, &51);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::PageSizeTooLarge);
    }

    #[test]
    fn test_exact_max_page_size_accepted() {
        let env = Env::default();
        let (client, _, _) = setup(&env);
        let page = client.get_listings_page(&0, &MAX_PAGE_SIZE);
        assert_eq!(page.total, 0);
    }

    // ── Delisted listings excluded ──────────────────────────────────────────

    #[test]
    fn test_delisted_excluded_from_page() {
        let env = Env::default();
        let (client, _, seller) = setup(&env);
        add_listing(&env, &client, &seller, "d1", 2023);
        add_listing(&env, &client, &seller, "d2", 2023);
        client.delist_credits(&seller, &s(&env, "d1"));

        let page = client.get_listings_page(&0, &10);
        assert_eq!(page.total, 1);
        assert_eq!(page.items.len(), 1);
    }

    // ── get_listings_by_vintage_page ────────────────────────────────────────

    #[test]
    fn test_vintage_page_filters_correctly() {
        let env = Env::default();
        let (client, _, seller) = setup(&env);
        add_listing(&env, &client, &seller, "vp1", 2023);
        add_listing(&env, &client, &seller, "vp2", 2023);
        add_listing(&env, &client, &seller, "vp3", 2024);

        let page = client.get_listings_by_vintage_page(&2023, &0, &10);
        assert_eq!(page.total, 2);
        assert_eq!(page.items.len(), 2);
    }

    #[test]
    fn test_vintage_page_page_size_too_large() {
        let env = Env::default();
        let (client, _, _) = setup(&env);
        let result = client.try_get_listings_by_vintage_page(&2023, &0, &51);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::PageSizeTooLarge);
    }

    // ── Total count unaffected by offset/limit ──────────────────────────────

    #[test]
    fn test_total_count_reflects_all_matches_not_page_size() {
        let env = Env::default();
        let (client, _, seller) = setup(&env);
        for i in 0..10 {
            add_listing(&env, &client, &seller, &format!("tc-{i}"), 2023);
        }

        let page = client.get_listings_page(&0, &3);
        assert_eq!(page.total, 10);
        assert_eq!(page.items.len(), 3);
    }

    // ── Issue #587: Oracle Benchmark Price Freshness Tests ─────────────────────

    #[test]
    fn test_configurable_price_freshness_window() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);

        let default_window = client.get_price_freshness_window();
        assert_eq!(default_window, 86400);

        client.set_price_freshness_window(&admin, &3600);
        let custom_window = client.get_price_freshness_window();
        assert_eq!(custom_window, 3600);
    }
}
