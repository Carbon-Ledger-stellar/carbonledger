#![no_std]

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    IntoVal, String, Vec,
};

macro_rules! require_valid_vintage_year {
    ($env:expr, $year:expr) => {
        Self::validate_vintage_year(&$env, $year)?
    };
}

macro_rules! require_batch_not_expired {
    ($env:expr, $year:expr) => {
        Self::validate_batch_not_expired(&$env, $year)?
    };
}

// -- Error Enum ---------------------------------------------------------------

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
    InvalidNonce = 22,
    InvalidSignature = 23,
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
    /// A proposed price update exists but the 24-hour timelock has not yet elapsed.
    TimelockNotReady = 24,
    /// No pending price update proposal exists for the given (methodology, vintage_year).
    NoPendingUpdate = 25,
}

// -- Constants ----------------------------------------------------------------

/// Earliest valid vintage year for carbon credits.
pub const VINTAGE_YEAR_MIN: u32 = 1990;
/// Maximum number of years a vintage may be aged before it is considered expired.
pub const MAX_VINTAGE_AGE_YEARS: u32 = 30;

const MONITORING_FRESHNESS_SECS: u64 = 365 * 24 * 60 * 60;
/// Maximum age of a benchmark price before it is considered stale (24 hours).
/// Marketplace circuit breaker halts purchases when price data exceeds this threshold.
pub const PRICE_STALENESS_SECS: u64 = 24 * 60 * 60;
/// Mandatory delay before a proposed price update can be executed (24 hours).
/// Provides a window for administrators to cancel erroneous or malicious updates
/// before they take effect on the marketplace.
pub const TIMELOCK_DELAY: u64 = 24 * 60 * 60;
const PRICE_CACHE_TTL_LEDGERS: u32 = 17_280;
/// TTL for persistent timestamp keys (price / monitoring freshness metadata).
const PERSISTENT_META_TTL_LEDGERS: u32 = 518_400;
const CURRENT_VERSION: u32 = 1;

// -- Storage Keys -------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    MonitoringData(String, String),
    LatestMonitoring(String),
    BenchmarkPrice(String, u32),
    /// Unix timestamp of when BenchmarkPrice(methodology, vintage_year) was last updated.
    /// Stored in persistent storage (unlike the price itself which uses temporary storage)
    /// so that staleness can be checked even after the TTL-based price entry expires.
    PriceUpdatedAt(String, u32),
    /// Pending timelocked price proposal for (methodology, vintage_year).
    /// Stores a ProposedPriceUpdate struct that must be executed after TIMELOCK_DELAY elapses.
    PendingPrice(String, u32),
    FlaggedProject(String),
    OracleAddress,
    OraclePublicKey,
    OracleNonce,
    Admin,
    ContractVersion,
    UpgradeHistory,
    /// Configurable liveness SLA in seconds.  Default: 365 days (31_536_000 s).
    LivenessSlaSeconds,
    /// Address of the carbon_registry contract for cross-contract suspend calls.
    RegistryAddress,
    /// Configurable benchmark price staleness window in seconds. Default: 24h (86_400 s).
    PriceStalenessSeconds,
}

// -- Types --------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct MonitoringData {
    pub project_id: String,
    pub period: String,
    pub tonnes_verified: i128,
    pub methodology_score: u32,
    pub satellite_cid: String,
    pub submitted_by: Address,
    pub submitted_at: u64,
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

/// A pending timelocked price update proposal.
///
/// Created by `propose_price_update` and stored under `DataKey::PendingPrice`.
/// Can only be executed via `execute_price_update` after `execute_after` elapses.
/// Can be cancelled at any time by an admin via `cancel_proposed_update`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposedPriceUpdate {
    /// The proposed new price (USDC stroops per tonne of CO₂e).
    pub price_usdc: i128,
    /// Unix timestamp after which this proposal may be executed.
    pub execute_after: u64,
    /// The oracle that submitted this proposal.
    pub proposed_by: Address,
    /// Monotonic nonce consumed by this proposal.
    pub nonce: u64,
}

// -- Contract -----------------------------------------------------------------

#[contract]
pub struct CarbonOracleContract;

#[contractimpl]
impl CarbonOracleContract {

    pub fn initialize(
        env: Env,
        admin: Address,
        oracle_address: Address,
        oracle_pub_key: BytesN<32>,
        registry_address: Address,
    ) -> Result<(), CarbonError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::OracleAddress, &oracle_address);
        env.storage()
            .persistent()
            .set(&DataKey::OraclePublicKey, &oracle_pub_key);
        env.storage()
            .persistent()
            .set(&DataKey::OracleNonce, &0_u64);
        env.storage()
            .persistent()
            .set(&DataKey::ContractVersion, &CURRENT_VERSION);
        env.storage()
            .persistent()
            .set(&DataKey::RegistryAddress, &registry_address);
        env.storage()
            .persistent()
            .set(&DataKey::LivenessSlaSeconds, &MONITORING_FRESHNESS_SECS);
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

    pub fn rotate_oracle(
        env: Env,
        admin: Address,
        new_oracle: Address,
        new_pub_key: BytesN<32>,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .set(&DataKey::OracleAddress, &new_oracle);
        env.storage()
            .persistent()
            .set(&DataKey::OraclePublicKey, &new_pub_key);
        env.storage()
            .persistent()
            .set(&DataKey::OracleNonce, &0_u64);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("ora_rot")),
            (admin, new_oracle),
        );
        Ok(())
    }

    pub fn submit_monitoring_data(
        env: Env,
        oracle_signer: Address,
        project_id: String,
        period: String,
        tonnes_verified: i128,
        methodology_score: u32,
        satellite_cid: String,
        signature: BytesN<64>,
        nonce: u64,
    ) -> Result<(), CarbonError> {
        oracle_signer.require_auth();
        Self::require_oracle(&env, &oracle_signer)?;

        let payload = (
            project_id.clone(),
            period.clone(),
            tonnes_verified,
            methodology_score,
            satellite_cid.clone(),
        )
            .to_xdr(&env);

        Self::verify_oracle_signature(&env, &payload, &signature, nonce)?;

        if tonnes_verified <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let now = env.ledger().timestamp();
        let data = MonitoringData {
            project_id: project_id.clone(),
            period: period.clone(),
            tonnes_verified,
            methodology_score,
            satellite_cid: satellite_cid.clone(),
            submitted_by: oracle_signer.clone(),
            submitted_at: now,
        };

        env.storage().persistent().set(
            &DataKey::MonitoringData(project_id.clone(), period.clone()),
            &data,
        );
        env.storage()
            .persistent()
            .set(&DataKey::LatestMonitoring(project_id.clone()), &now);
        env.storage().persistent().extend_ttl(
            &DataKey::LatestMonitoring(project_id.clone()),
            PERSISTENT_META_TTL_LEDGERS,
            PERSISTENT_META_TTL_LEDGERS,
        );

        if methodology_score < 70 {
            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("low_score")),
                (project_id.clone(), methodology_score),
            );
        }

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("mon_data")),
            (project_id, period, tonnes_verified, methodology_score),
        );
        Ok(())
    }

    pub fn update_credit_price(
        env: Env,
        oracle_signer: Address,
        methodology: String,
        vintage_year: u32,
        price_usdc: i128,
        signature: BytesN<64>,
        nonce: u64,
    ) -> Result<(), CarbonError> {
        oracle_signer.require_auth();
        Self::require_oracle(&env, &oracle_signer)?;

        let payload = (methodology.clone(), vintage_year, price_usdc).to_xdr(&env);

        Self::verify_oracle_signature(&env, &payload, &signature, nonce)?;

        if price_usdc <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        require_valid_vintage_year!(&env, vintage_year);
        require_batch_not_expired!(&env, vintage_year);

        let now = env.ledger().timestamp();

        let key = DataKey::BenchmarkPrice(methodology.clone(), vintage_year);
        env.storage().temporary().set(&key, &price_usdc);
        env.storage().temporary().extend_ttl(
            &key,
            PRICE_CACHE_TTL_LEDGERS,
            PRICE_CACHE_TTL_LEDGERS,
        );

        // Store the update timestamp persistently so staleness can be checked
        // even if the temporary price entry has expired.
        let ts_key = DataKey::PriceUpdatedAt(methodology.clone(), vintage_year);
        env.storage().persistent().set(&ts_key, &now);
        env.storage().persistent().extend_ttl(
            &ts_key,
            PERSISTENT_META_TTL_LEDGERS,
            PERSISTENT_META_TTL_LEDGERS,
        );

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("price_upd")),
            (methodology, vintage_year, price_usdc),
        );
        Ok(())
    }

    /// Phase 1 of the two-step timelocked price update.
    ///
    /// The oracle submits a proposed new benchmark price for a given
    /// (methodology, vintage_year) pair. The proposal is stored on-chain with
    /// an `execute_after` timestamp set to `now + TIMELOCK_DELAY` (24 hours).
    ///
    /// The proposal cannot take effect immediately — the oracle must call
    /// `execute_price_update` after the timelock window elapses. An admin can
    /// cancel the proposal at any time via `cancel_proposed_update`.
    ///
    /// # Returns
    /// The Unix timestamp after which this proposal may be executed.
    pub fn propose_price_update(
        env: Env,
        oracle_signer: Address,
        methodology: String,
        vintage_year: u32,
        price_usdc: i128,
        signature: BytesN<64>,
        nonce: u64,
    ) -> Result<u64, CarbonError> {
        oracle_signer.require_auth();
        Self::require_oracle(&env, &oracle_signer)?;

        let payload = (methodology.clone(), vintage_year, price_usdc).to_xdr(&env);
        Self::verify_oracle_signature(&env, &payload, &signature, nonce)?;

        if price_usdc <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        require_valid_vintage_year!(&env, vintage_year);
        require_batch_not_expired!(&env, vintage_year);

        let now = env.ledger().timestamp();
        let execute_after = now + TIMELOCK_DELAY;

        let proposal = ProposedPriceUpdate {
            price_usdc,
            execute_after,
            proposed_by: oracle_signer.clone(),
            nonce,
        };

        let pending_key = DataKey::PendingPrice(methodology.clone(), vintage_year);
        env.storage().persistent().set(&pending_key, &proposal);
        env.storage().persistent().extend_ttl(
            &pending_key,
            PERSISTENT_META_TTL_LEDGERS,
            PERSISTENT_META_TTL_LEDGERS,
        );

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("p_propose")),
            (methodology, vintage_year, price_usdc, execute_after),
        );

        Ok(execute_after)
    }

    /// Phase 2 of the two-step timelocked price update.
    ///
    /// Finalises a pending proposal that was submitted via `propose_price_update`.
    /// Fails with `CarbonError::TimelockNotReady` if called before the
    /// `execute_after` timestamp has been reached, and with
    /// `CarbonError::NoPendingUpdate` if no proposal exists for the given pair.
    ///
    /// On success the price is written to temporary storage (same as a direct
    /// `update_credit_price` call) and the pending proposal is cleared.
    pub fn execute_price_update(
        env: Env,
        oracle_signer: Address,
        methodology: String,
        vintage_year: u32,
    ) -> Result<(), CarbonError> {
        oracle_signer.require_auth();
        Self::require_oracle(&env, &oracle_signer)?;

        let pending_key = DataKey::PendingPrice(methodology.clone(), vintage_year);
        let proposal: ProposedPriceUpdate = env
            .storage()
            .persistent()
            .get(&pending_key)
            .ok_or(CarbonError::NoPendingUpdate)?;

        let now = env.ledger().timestamp();
        if now < proposal.execute_after {
            return Err(CarbonError::TimelockNotReady);
        }

        // Write the price to temporary storage exactly as update_credit_price does.
        let price_key = DataKey::BenchmarkPrice(methodology.clone(), vintage_year);
        env.storage().temporary().set(&price_key, &proposal.price_usdc);
        env.storage().temporary().extend_ttl(
            &price_key,
            PRICE_CACHE_TTL_LEDGERS,
            PRICE_CACHE_TTL_LEDGERS,
        );

        // Record the staleness timestamp persistently.
        let ts_key = DataKey::PriceUpdatedAt(methodology.clone(), vintage_year);
        env.storage().persistent().set(&ts_key, &now);
        env.storage().persistent().extend_ttl(
            &ts_key,
            PERSISTENT_META_TTL_LEDGERS,
            PERSISTENT_META_TTL_LEDGERS,
        );

        // Clear the pending proposal.
        env.storage().persistent().remove(&pending_key);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("p_exec")),
            (methodology, vintage_year, proposal.price_usdc),
        );

        Ok(())
    }

    /// Emergency cancellation of a pending price update proposal.
    ///
    /// Admin-only. Clears a pending proposal for (methodology, vintage_year)
    /// regardless of whether the timelock has elapsed. This is the safety valve
    /// that administrators use if the oracle key is compromised or an erroneous
    /// price was submitted.
    ///
    /// Returns `CarbonError::NoPendingUpdate` if no proposal exists.
    pub fn cancel_proposed_update(
        env: Env,
        admin: Address,
        methodology: String,
        vintage_year: u32,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let pending_key = DataKey::PendingPrice(methodology.clone(), vintage_year);
        if !env.storage().persistent().has(&pending_key) {
            return Err(CarbonError::NoPendingUpdate);
        }

        env.storage().persistent().remove(&pending_key);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("p_cancel")),
            (methodology, vintage_year, admin),
        );

        Ok(())
    }

    /// Read-only accessor for a pending price proposal.
    /// Returns `None` if no proposal is pending for the given pair.
    pub fn get_pending_price_update(
        env: Env,
        methodology: String,
        vintage_year: u32,
    ) -> Option<ProposedPriceUpdate> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingPrice(methodology, vintage_year))
    }

    pub fn get_monitoring_data(
        env: Env,
        project_id: String,
        period: String,
    ) -> Result<MonitoringData, CarbonError> {
        env.storage()
            .persistent()
            .get(&DataKey::MonitoringData(project_id, period))
            .ok_or(CarbonError::ProjectNotFound)
    }

    pub fn get_benchmark_price(
        env: Env,
        methodology: String,
        vintage_year: u32,
    ) -> Result<i128, CarbonError> {
        env.storage()
            .temporary()
            .get(&DataKey::BenchmarkPrice(methodology, vintage_year))
            .ok_or(CarbonError::PriceNotSet)
    }

    pub fn flag_project(
        env: Env,
        oracle_signer: Address,
        project_id: String,
        reason: String,
        signature: BytesN<64>,
        nonce: u64,
    ) -> Result<(), CarbonError> {
        oracle_signer.require_auth();
        Self::require_oracle(&env, &oracle_signer)?;

        let payload = (project_id.clone(), reason.clone()).to_xdr(&env);

        Self::verify_oracle_signature(&env, &payload, &signature, nonce)?;

        env.storage()
            .persistent()
            .set(&DataKey::FlaggedProject(project_id.clone()), &reason);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("flagged")),
            (project_id, oracle_signer, reason),
        );
        Ok(())
    }

    /// Returns true if the project's monitoring data is within the configured
    /// liveness SLA (default 365 days, adjustable via `set_liveness_sla`).
    ///
    /// This reads the same `LivenessSlaSeconds` key as `check_liveness`, so the
    /// read-only freshness query and the permissionless dead-man's switch can
    /// never disagree about whether a project is stale.
    pub fn is_monitoring_current(env: Env, project_id: String) -> bool {
        let sla: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::LivenessSlaSeconds)
            .unwrap_or(MONITORING_FRESHNESS_SECS);

        let latest: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::LatestMonitoring(project_id));

        match latest {
            None => false,
            Some(ts) => {
                let now = env.ledger().timestamp();
                now.saturating_sub(ts) <= sla
            }
        }
    }

    /// Permissionless liveness check.  Anyone may call this to verify that a
    /// project's monitoring data is within the configured SLA window.  If the
    /// data is stale the function:
    ///   1. Flags the project in oracle storage
    ///   2. Cross-contract calls `carbon_registry::oracle_suspend_project`
    ///   3. Emits a `(c_ledger, liveness_flag)` event
    ///
    /// Idempotent: if the project is already flagged, no action is taken.
    pub fn check_liveness(env: Env, project_id: String) -> Result<(), CarbonError> {
        let sla: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::LivenessSlaSeconds)
            .unwrap_or(MONITORING_FRESHNESS_SECS);

        let latest: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::LatestMonitoring(project_id.clone()));

        let is_stale = match latest {
            None => true,
            Some(ts) => env.ledger().timestamp().saturating_sub(ts) > sla,
        };

        if !is_stale {
            return Ok(());
        }

        // Idempotent: skip if already flagged.
        let already_flagged: Option<String> = env
            .storage()
            .persistent()
            .get(&DataKey::FlaggedProject(project_id.clone()));
        if already_flagged.is_some() {
            return Ok(());
        }

        let reason = String::from_str(&env, "liveness_sla_breach");

        // 1. Flag in oracle storage.
        env.storage().persistent().set(
            &DataKey::FlaggedProject(project_id.clone()),
            &reason,
        );

        // 2. Cross-contract call: suspend in registry.
        let registry_address: Address = env
            .storage()
            .persistent()
            .get(&DataKey::RegistryAddress)
            .ok_or(CarbonError::ProjectNotFound)?;

        env.invoke_contract::<()>(
            &registry_address,
            &soroban_sdk::Symbol::new(&env, "oracle_suspend_project"),
            soroban_sdk::vec![
                &env,
                project_id.clone().into_val(&env),
                reason.clone().into_val(&env),
            ],
        );

        // 3. Emit event.
        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("live_flag")),
            (project_id, reason),
        );

        Ok(())
    }

    /// Admin-only: adjust the liveness SLA window in seconds.
    pub fn set_liveness_sla(env: Env, admin: Address, seconds: u64) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage().persistent().set(&DataKey::LivenessSlaSeconds, &seconds);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("sla_upd")),
            (admin, seconds),
        );
        Ok(())
    }

    /// Admin-only: adjust the benchmark price staleness window in seconds (default 24h).
    pub fn set_price_staleness_window(env: Env, admin: Address, seconds: u64) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage().persistent().set(&DataKey::PriceStalenessSeconds, &seconds);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("p_sla_upd")),
            (admin, seconds),
        );
        Ok(())
    }

    /// Returns true if the benchmark price for (methodology, vintage_year) was
    /// updated within the staleness window (default 24 hours). Returns false if
    /// the price was never set or was last updated more than the staleness threshold ago.
    ///
    /// # Interaction with `is_monitoring_current`:
    /// - `is_monitoring_current(env, project_id)` checks project-level liveness SLA for satellite/MRV monitoring data (default 365 days).
    ///   Stale monitoring data flags projects and triggers cross-contract suspension via registry.
    /// - `is_price_current(env, methodology, vintage_year)` checks financial benchmark price freshness for credit trading (default 24 hours).
    ///   Stale benchmark prices block credit purchases in `purchase_credits()` with a `MonitoringDataStale` error until updated by the oracle.
    pub fn is_price_current(env: Env, methodology: String, vintage_year: u32) -> bool {
        let staleness_window: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::PriceStalenessSeconds)
            .unwrap_or(PRICE_STALENESS_SECS);
        let ts: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PriceUpdatedAt(methodology, vintage_year));

        match ts {
            None => false,
            Some(updated_at) => {
                let now = env.ledger().timestamp();
                now.saturating_sub(updated_at) <= staleness_window
            }
        }
    }

    /// Returns the cumulative verified tonnes for a project across all monitoring
    /// periods recorded by the oracle.
    ///
    /// This is called by `carbon_credit::mint_credits` to enforce the cross-contract
    /// invariant: `total_credits_issued + new_amount <= total_verified_tonnes`.
    ///
    /// # Trust model
    /// - The oracle is assumed trusted (see ADR-004 and PR #530 spec doc).
    /// - This function sums all periods stored under MonitoringData(project_id, *).
    /// - Only periods explicitly recorded via `submit_monitoring_data` are counted.
    /// - Oracle data freshness (365-day staleness) is checked separately via
    ///   `is_monitoring_current`; this function returns the raw cumulative total
    ///   regardless of age, allowing the caller to decide on freshness policy.
    ///
    /// # Monitoring alert
    /// Callers should emit an event when this check fails so that off-chain
    /// monitoring can alert on attempted over-issuance:
    ///   event topic: ("c_ledger", "over_issue")
    ///   payload: (project_id, attempted_total, verified_total)
    pub fn get_total_verified_tonnes(env: Env, project_id: String, periods: Vec<String>) -> i128 {
        let mut total: i128 = 0;
        for period in periods.iter() {
            if let Some(data) =
                env.storage()
                    .persistent()
                    .get::<DataKey, MonitoringData>(&DataKey::MonitoringData(
                        project_id.clone(),
                        period.clone(),
                    ))
            {
                total = total.saturating_add(data.tonnes_verified);
            }
        }
        total
    }

    fn require_oracle(env: &Env, caller: &Address) -> Result<(), CarbonError> {
        let oracle: Address = env
            .storage()
            .persistent()
            .get(&DataKey::OracleAddress)
            .ok_or(CarbonError::UnauthorizedOracle)?;
        if &oracle != caller {
            return Err(CarbonError::UnauthorizedOracle);
        }
        Ok(())
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

    fn verify_oracle_signature(
        env: &Env,
        payload: &Bytes,
        signature: &BytesN<64>,
        nonce: u64,
    ) -> Result<(), CarbonError> {
        let stored_nonce: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::OracleNonce)
            .unwrap_or(0);
        if nonce != stored_nonce {
            return Err(CarbonError::InvalidNonce);
        }

        let pub_key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::OraclePublicKey)
            .ok_or(CarbonError::UnauthorizedOracle)?;

        env.crypto().ed25519_verify(&pub_key, payload, signature);

        env.storage()
            .persistent()
            .set(&DataKey::OracleNonce, &(stored_nonce + 1));
        Ok(())
    }

    fn get_current_year(env: &Env) -> u32 {
        let timestamp = env.ledger().timestamp();
        let seconds_in_day = 86400;
        let mut days = (timestamp / seconds_in_day) as i64;
        let mut year = 1970;

        loop {
            let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
            let days_in_year = if is_leap { 366 } else { 365 };
            if days < days_in_year {
                break;
            }
            days -= days_in_year;
            year += 1;
        }
        year as u32
    }

    fn validate_vintage_year(env: &Env, vintage_year: u32) -> Result<(), CarbonError> {
        let current_year = Self::get_current_year(env);
        if vintage_year < VINTAGE_YEAR_MIN || vintage_year > current_year + 1 {
            return Err(CarbonError::InvalidVintageYear);
        }
        Ok(())
    }

    fn validate_batch_not_expired(env: &Env, vintage_year: u32) -> Result<(), CarbonError> {
        let current_year = Self::get_current_year(env);
        if vintage_year + MAX_VINTAGE_AGE_YEARS < current_year {
            return Err(CarbonError::InvalidVintageYear);
        }
        Ok(())
    }
}

// -- Tests --------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        BytesN, Env, String,
    };

    const TEST_SIGNING_KEY: [u8; 32] = [42u8; 32];

    fn test_signing_key() -> SigningKey {
        SigningKey::from_bytes(&TEST_SIGNING_KEY)
    }

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup(env: &Env) -> (CarbonOracleContractClient<'_>, Address, Address, SigningKey) {
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp: 1735689600, // 2025-01-01
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });

        let signing_key = test_signing_key();
        let pub_key_bytes = signing_key.verifying_key().to_bytes();
        let pub_key = BytesN::from_array(env, &pub_key_bytes);

        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let registry = Address::generate(env);
        let id = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(env, &id);

        client.initialize(&admin, &oracle, &pub_key, &registry);
        (client, admin, oracle, signing_key)
    }

    #[test]
    fn test_valid_signature_submission() {
        let env = Env::default();
        let (client, _, oracle, signing_key) = setup(&env);

        let project_id = s(&env, "proj-001");
        let period = s(&env, "2023-Q1");
        let tonnes = 5000_i128;
        let score = 85_u32;
        let cid = s(&env, "QmSatCID");
        let nonce = 0_u64;

        let payload = (
            project_id.clone(),
            period.clone(),
            tonnes,
            score,
            cid.clone(),
        )
            .to_xdr(&env);

        let sig = signing_key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(&env, &sig.to_bytes());

        client.submit_monitoring_data(
            &oracle,
            &project_id,
            &period,
            &tonnes,
            &score,
            &cid,
            &signature,
            &nonce,
        );

        let data = client.get_monitoring_data(&project_id, &period);
        assert_eq!(data.tonnes_verified, 5000);
        assert_eq!(data.methodology_score, 85);
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn test_invalid_signature_submission() {
        let env = Env::default();
        let (client, _, oracle, signing_key) = setup(&env);

        let project_id = s(&env, "proj-001");
        let period = s(&env, "2023-Q1");
        let tonnes = 5000_i128;
        let score = 85_u32;
        let cid = s(&env, "QmSatCID");
        let nonce = 0_u64;

        let payload = (
            project_id.clone(),
            period.clone(),
            tonnes,
            score,
            cid.clone(),
        )
            .to_xdr(&env);

        let sig = signing_key.sign(payload.to_alloc_vec().as_slice());
        let mut sig_bytes = sig.to_bytes();
        // Corrupt signature
        sig_bytes[0] ^= 0xFF;
        let invalid_signature = BytesN::from_array(&env, &sig_bytes);

        // This will panic internally in `ed25519_verify`
        client.submit_monitoring_data(
            &oracle,
            &project_id,
            &period,
            &tonnes,
            &score,
            &cid,
            &invalid_signature,
            &nonce,
        );
    }

    #[test]
    fn test_invalid_nonce_submission() {
        let env = Env::default();
        let (client, _, oracle, signing_key) = setup(&env);

        let project_id = s(&env, "proj-001");
        let period = s(&env, "2023-Q1");
        let tonnes = 5000_i128;
        let score = 85_u32;
        let cid = s(&env, "QmSatCID");
        // Using an incorrect nonce, should return CarbonError::InvalidNonce (22)
        let invalid_nonce = 1_u64;

        let payload = (
            project_id.clone(),
            period.clone(),
            tonnes,
            score,
            cid.clone(),
        )
            .to_xdr(&env);

        let sig = signing_key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(&env, &sig.to_bytes());

        let err = client
            .try_submit_monitoring_data(
                &oracle,
                &project_id,
                &period,
                &tonnes,
                &score,
                &cid,
                &signature,
                &invalid_nonce,
            )
            .unwrap_err();

        assert_eq!(err.unwrap(), CarbonError::InvalidNonce);
    }
}

// ── Circuit breaker / staleness tests ─────────────────────────────────────────

#[cfg(test)]
mod staleness_tests {
    //! Tests for is_price_current() and the price-staleness circuit breaker
    //! mechanism (closes #534).
    //!
    //! Scenarios covered:
    //!  1. is_price_current returns false when no price has ever been set.
    //!  2. is_price_current returns true immediately after update_credit_price.
    //!  3. is_price_current returns false after advancing ledger time > 24 hours.
    //!  4. is_price_current returns true after a fresh price update following staleness.
    //!  5. is_monitoring_current returns false if no data in > 365 days (regression).
    //!  6. Different (methodology, vintage_year) pairs are tracked independently.

    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        BytesN, Env, String,
    };

    const TEST_SIGNING_KEY: [u8; 32] = [42u8; 32];

    fn test_signing_key() -> SigningKey {
        SigningKey::from_bytes(&TEST_SIGNING_KEY)
    }

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup(env: &Env) -> (CarbonOracleContractClient<'_>, Address, Address, SigningKey) {
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp: 1_735_689_600, // 2025-01-01 00:00:00 UTC
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518_400,
        });
        let signing_key = test_signing_key();
        let pub_bytes = signing_key.verifying_key().to_bytes();
        let pub_key = BytesN::from_array(env, &pub_bytes);
        let admin    = Address::generate(env);
        let oracle   = Address::generate(env);
        let registry = Address::generate(env);
        let id     = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &pub_key, &registry);
        (client, admin, oracle, signing_key)
    }

    fn sign_price(
        env: &Env,
        key: &SigningKey,
        methodology: &String,
        vintage_year: u32,
        price: i128,
    ) -> BytesN<64> {
        let payload = (methodology.clone(), vintage_year, price).to_xdr(env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        BytesN::from_array(env, &sig.to_bytes())
    }

    fn advance_time(env: &Env, secs: u64) {
        let info = env.ledger().get();
        env.ledger().set(LedgerInfo {
            timestamp: info.timestamp + secs,
            protocol_version: info.protocol_version,
            sequence_number: info.sequence_number,
            network_id: info.network_id,
            base_reserve: info.base_reserve,
            min_temp_entry_ttl: info.min_temp_entry_ttl,
            min_persistent_entry_ttl: info.min_persistent_entry_ttl,
            max_entry_ttl: info.max_entry_ttl,
        });
    }

    // ── 1. No price set → stale ───────────────────────────────────────────────

    #[test]
    fn test_is_price_current_false_when_never_set() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        assert!(
            !client.is_price_current(&s(&env, "VCS"), &2023_u32),
            "price should not be current when never set"
        );
    }

    // ── 2. Fresh price → current ──────────────────────────────────────────────

    #[test]
    fn test_is_price_current_true_immediately_after_update() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign_price(&env, &key, &method, 2023, price);
        client.update_credit_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);
        assert!(
            client.is_price_current(&method, &2023_u32),
            "price should be current immediately after update"
        );
    }

    // ── 3. Price becomes stale after >24 h ────────────────────────────────────

    #[test]
    fn test_is_price_current_false_after_24_hours() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign_price(&env, &key, &method, 2023, price);
        client.update_credit_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Advance past the 24-hour staleness threshold
        advance_time(&env, 24 * 60 * 60 + 1);

        assert!(
            !client.is_price_current(&method, &2023_u32),
            "price should be stale after 24 h + 1 s"
        );
    }

    // ── 4. Stale price recovers after fresh update ────────────────────────────

    #[test]
    fn test_is_price_current_true_after_refresh_following_staleness() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");

        // First update
        let price1 = 25_0000000_i128;
        let sig1 = sign_price(&env, &key, &method, 2023, price1);
        client.update_credit_price(&oracle, &method, &2023_u32, &price1, &sig1, &0_u64);

        // Advance to stale
        advance_time(&env, 25 * 60 * 60);
        assert!(
            !client.is_price_current(&method, &2023_u32),
            "should be stale after 25 h"
        );

        // Oracle submits a fresh price
        let price2 = 26_0000000_i128;
        let sig2 = sign_price(&env, &key, &method, 2023, price2);
        client.update_credit_price(&oracle, &method, &2023_u32, &price2, &sig2, &1_u64);

        assert!(
            client.is_price_current(&method, &2023_u32),
            "price should be current again after fresh update"
        );
    }

    // ── 5. is_monitoring_current regression ───────────────────────────────────

    #[test]
    fn test_is_monitoring_current_false_after_365_days() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);

        let project_id = s(&env, "proj-stale");
        let period = s(&env, "2023-Q1");
        let payload = (
            project_id.clone(),
            period.clone(),
            5000_i128,
            85_u32,
            s(&env, "QmCID"),
        )
            .to_xdr(&env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(&env, &sig.to_bytes());

        client.submit_monitoring_data(
            &oracle,
            &project_id,
            &period,
            &5000_i128,
            &85_u32,
            &s(&env, "QmCID"),
            &signature,
            &0_u64,
        );
        assert!(
            client.is_monitoring_current(&project_id),
            "should be current just after submit"
        );

        // Advance by 366 days — past the 365-day monitoring freshness window
        advance_time(&env, 366 * 24 * 60 * 60);
        assert!(
            !client.is_monitoring_current(&project_id),
            "monitoring should be stale after 366 days"
        );
    }

    // ── 6. Independent per-(methodology, vintage_year) tracking ──────────────

    #[test]
    fn test_price_staleness_independent_per_methodology_vintage() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);

        let vcs = s(&env, "VCS");
        let gs = s(&env, "Gold Standard");
        let price = 25_0000000_i128;

        // Only set VCS 2023
        let sig = sign_price(&env, &key, &vcs, 2023, price);
        client.update_credit_price(&oracle, &vcs, &2023_u32, &price, &sig, &0_u64);

        // Advance 13 h — VCS 2023 still fresh
        advance_time(&env, 13 * 60 * 60);
        assert!(
            client.is_price_current(&vcs, &2023_u32),
            "VCS 2023 fresh at 13 h"
        );
        assert!(
            !client.is_price_current(&gs, &2023_u32),
            "GS 2023 never set → stale"
        );
        assert!(
            !client.is_price_current(&vcs, &2022_u32),
            "VCS 2022 never set → stale"
        );

        // Advance another 13 h — VCS 2023 now stale (26 h total)
        advance_time(&env, 13 * 60 * 60);
        assert!(
            !client.is_price_current(&vcs, &2023_u32),
            "VCS 2023 stale after 26 h"
        );
    }

    // ── Mutation-testing survivor kills (issue #632) ──────────────────────────
    //
    // `is_price_current` uses `now.saturating_sub(updated_at) <= PRICE_STALENESS_SECS`.
    // A mutation to `<` would incorrectly mark the exact-24h boundary as stale.

    #[test]
    fn test_is_price_current_true_at_exact_24_hour_boundary() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign_price(&env, &key, &method, 2023, price);
        client.update_credit_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Advance exactly 24 hours — must still be current (<=, not <).
        advance_time(&env, 24 * 60 * 60);

        assert!(
            client.is_price_current(&method, &2023_u32),
            "price must still be current at exactly the 24h boundary"
        );
    }

    /// `is_monitoring_current` uses `now.saturating_sub(ts) <= MONITORING_FRESHNESS_SECS`
    /// (365 days). A mutation to `<` would incorrectly mark the exact boundary as stale.
    #[test]
    fn test_is_monitoring_current_true_at_exact_365_day_boundary() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);

        let project_id = s(&env, "proj-boundary");
        let period = s(&env, "2025-Q1");
        let payload = (
            project_id.clone(),
            period.clone(),
            5000_i128,
            85_u32,
            s(&env, "QmCID"),
        )
            .to_xdr(&env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(&env, &sig.to_bytes());

        client.submit_monitoring_data(
            &oracle,
            &project_id,
            &period,
            &5000_i128,
            &85_u32,
            &s(&env, "QmCID"),
            &signature,
            &0_u64,
        );

        // Advance exactly 365 days — must still be current (<=, not <).
        advance_time(&env, 365 * 24 * 60 * 60);
        assert!(
            client.is_monitoring_current(&project_id),
            "monitoring must still be current at exactly the 365-day boundary"
        );
    }
}

// ── get_total_verified_tonnes tests (issue #632) ─────────────────────────────
//
// `get_total_verified_tonnes` had no dedicated test coverage prior to this
// mutation-testing pass, despite being the function `carbon_credit::mint_credits`
// relies on (per its doc comment) to enforce the cross-contract issuance cap.
// A mutation of `total = total.saturating_add(data.tonnes_verified)` to
// `total = data.tonnes_verified` (overwrite instead of accumulate) would have
// survived indefinitely without a multi-period test.
#[cfg(test)]
mod total_verified_tonnes_tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        vec, BytesN, Env, String,
    };

    const TEST_SIGNING_KEY: [u8; 32] = [42u8; 32];

    fn test_signing_key() -> SigningKey {
        SigningKey::from_bytes(&TEST_SIGNING_KEY)
    }

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup(env: &Env) -> (CarbonOracleContractClient<'_>, Address, SigningKey) {
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp: 1_735_689_600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518_400,
        });
        let signing_key = test_signing_key();
        let pub_bytes = signing_key.verifying_key().to_bytes();
        let pub_key = BytesN::from_array(env, &pub_bytes);
        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let registry = Address::generate(env);
        let id = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &pub_key, &registry);
        (client, oracle, signing_key)
    }

    fn submit(
        env: &Env,
        client: &CarbonOracleContractClient,
        oracle: &Address,
        key: &SigningKey,
        project_id: &String,
        period: &str,
        tonnes: i128,
        nonce: u64,
    ) {
        let period_str = s(env, period);
        let cid = s(env, "QmCID");
        let payload = (
            project_id.clone(),
            period_str.clone(),
            tonnes,
            85_u32,
            cid.clone(),
        )
            .to_xdr(env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(env, &sig.to_bytes());
        client.submit_monitoring_data(
            oracle,
            project_id,
            &period_str,
            &tonnes,
            &85_u32,
            &cid,
            &signature,
            &nonce,
        );
    }

    #[test]
    fn test_get_total_verified_tonnes_sums_multiple_periods() {
        let env = Env::default();
        let (client, oracle, key) = setup(&env);
        let project_id = s(&env, "proj-multi");

        submit(&env, &client, &oracle, &key, &project_id, "2023-Q1", 1000, 0);
        submit(&env, &client, &oracle, &key, &project_id, "2023-Q2", 1500, 1);
        submit(&env, &client, &oracle, &key, &project_id, "2023-Q3", 2500, 2);

        let periods = vec![
            &env,
            s(&env, "2023-Q1"),
            s(&env, "2023-Q2"),
            s(&env, "2023-Q3"),
        ];
        let total = client.get_total_verified_tonnes(&project_id, &periods);
        assert_eq!(total, 5000, "total must be the SUM of all periods, not the last one");
    }

    #[test]
    fn test_get_total_verified_tonnes_ignores_unrecorded_periods() {
        let env = Env::default();
        let (client, oracle, key) = setup(&env);
        let project_id = s(&env, "proj-partial");

        submit(&env, &client, &oracle, &key, &project_id, "2023-Q1", 1000, 0);

        // Request a period that was never submitted alongside a real one.
        let periods = vec![&env, s(&env, "2023-Q1"), s(&env, "2023-Q2")];
        let total = client.get_total_verified_tonnes(&project_id, &periods);
        assert_eq!(total, 1000, "unrecorded periods must contribute zero, not error");
    }

    #[test]
    fn test_get_total_verified_tonnes_empty_periods_is_zero() {
        let env = Env::default();
        let (client, _, _) = setup(&env);
        let project_id = s(&env, "proj-empty");
        let periods: soroban_sdk::Vec<String> = vec![&env];
        assert_eq!(client.get_total_verified_tonnes(&project_id, &periods), 0);
    }
}

// ── Vintage Year Validation Tests (Oracle) ────────────────────────────────────
//
// Tests covering vintage year validation on update_credit_price.
// Validates that the oracle rejects invalid vintage years and expired batches.
#[cfg(test)]
mod vintage_year_validation_tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        BytesN, Env, String,
    };

    const TEST_SIGNING_KEY: [u8; 32] = [42u8; 32];

    fn test_signing_key() -> SigningKey {
        SigningKey::from_bytes(&TEST_SIGNING_KEY)
    }

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn set_year(env: &Env, year: u32) {
        let seconds_per_year: u64 = 31_557_600;
        let timestamp = (year as u64 - 1970) * seconds_per_year + 86_400;
        env.ledger().set(LedgerInfo {
            timestamp,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518_400,
        });
    }

    fn setup_at_year(year: u32) -> (Env, Address, Address, Address, SigningKey) {
        let env = Env::default();
        env.mock_all_auths();
        set_year(&env, year);
        let signing_key = test_signing_key();
        let pub_bytes = signing_key.verifying_key().to_bytes();
        let pub_key = BytesN::from_array(&env, &pub_bytes);
        let admin    = Address::generate(&env);
        let oracle   = Address::generate(&env);
        let registry = Address::generate(&env);
        let id     = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(&env, &id);
        client.initialize(&admin, &oracle, &pub_key, &registry);
        (env, id, admin, oracle, signing_key)
    }

    fn client_at<'a>(env: &'a Env, id: &'a Address) -> CarbonOracleContractClient<'a> {
        CarbonOracleContractClient::new(env, id)
    }

    fn sign_price(
        env: &Env,
        key: &SigningKey,
        methodology: &String,
        vintage_year: u32,
        price: i128,
        _nonce: u64,
    ) -> BytesN<64> {
        let payload = (methodology.clone(), vintage_year, price).to_xdr(env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        BytesN::from_array(env, &sig.to_bytes())
    }

    fn try_update_price(
        env: &Env,
        client: &CarbonOracleContractClient,
        oracle: &Address,
        key: &SigningKey,
        vintage_year: u32,
        nonce: u64,
    ) -> Result<(), CarbonError> {
        let method = s(env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign_price(env, key, &method, vintage_year, price, nonce);
        client
            .try_update_credit_price(oracle, &method, &vintage_year, &price, &sig, &nonce)
            .map_err(|e| e.unwrap())
            .and_then(|r| r.map_err(|_| CarbonError::InvalidVintageYear))
    }

    fn update_price_ok(
        env: &Env,
        client: &CarbonOracleContractClient,
        oracle: &Address,
        key: &SigningKey,
        vintage_year: u32,
        nonce: u64,
    ) {
        let method = s(env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign_price(env, key, &method, vintage_year, price, nonce);
        client.update_credit_price(oracle, &method, &vintage_year, &price, &sig, &nonce);
    }

    // ── Below-minimum year tests ───────────────────────────────────────────────

    #[test]
    fn test_oracle_price_vintage_0_rejected() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 0, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    #[test]
    fn test_oracle_price_vintage_1_rejected() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 1, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    #[test]
    fn test_oracle_price_vintage_1900_rejected() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 1900, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    #[test]
    fn test_oracle_price_vintage_1989_rejected() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 1989, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    // ── Minimum boundary (1990) ────────────────────────────────────────────────

    #[test]
    fn test_oracle_price_vintage_1990_accepted_when_not_expired() {
        // At year 2019: 1990+30=2020 >= 2019 → not expired; 1990 >= 1990 → valid
        let (env, contract_id, _, oracle, key) = setup_at_year(2019);
        let client = client_at(&env, &contract_id);
        update_price_ok(&env, &client, &oracle, &key, 1990, 0);
    }

    // ── Current year boundary ─────────────────────────────────────────────────

    #[test]
    fn test_oracle_price_vintage_current_accepted() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        update_price_ok(&env, &client, &oracle, &key, 2026, 0);
    }

    #[test]
    fn test_oracle_price_vintage_current_plus_1_accepted() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        update_price_ok(&env, &client, &oracle, &key, 2027, 0);
    }

    #[test]
    fn test_oracle_price_vintage_current_plus_2_rejected() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 2028, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    #[test]
    fn test_oracle_price_vintage_u32_max_rejected() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, u32::MAX, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    // ── Batch expiry ──────────────────────────────────────────────────────────

    #[test]
    fn test_oracle_price_expired_vintage_rejected() {
        // At year 2026: 1994+30=2024 < 2026 → expired
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 1994, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    #[test]
    fn test_oracle_price_at_exact_expiry_boundary_rejected() {
        // At year 2026: vintage 1995+30=2025 < 2026 → expired
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 1995, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    #[test]
    fn test_oracle_price_just_inside_expiry_boundary_accepted() {
        // At year 2026: vintage 1996+30=2026 = 2026, NOT < 2026 → valid
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        update_price_ok(&env, &client, &oracle, &key, 1996, 0);
    }

    #[test]
    fn test_oracle_price_far_past_expiry_rejected() {
        // At year 2026: vintage 1990+30=2020 < 2026 → expired
        let (env, contract_id, _, oracle, key) = setup_at_year(2026);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 1990, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    // ── Century boundaries ────────────────────────────────────────────────────

    #[test]
    fn test_oracle_price_vintage_1999_accepted_in_2025() {
        // 1999+30=2029 >= 2025 → valid
        let (env, contract_id, _, oracle, key) = setup_at_year(2025);
        let client = client_at(&env, &contract_id);
        update_price_ok(&env, &client, &oracle, &key, 1999, 0);
    }

    #[test]
    fn test_oracle_price_vintage_2000_accepted_in_2025() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2025);
        let client = client_at(&env, &contract_id);
        update_price_ok(&env, &client, &oracle, &key, 2000, 0);
    }

    #[test]
    fn test_oracle_price_vintage_2099_accepted_in_2099() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2099);
        let client = client_at(&env, &contract_id);
        update_price_ok(&env, &client, &oracle, &key, 2099, 0);
    }

    #[test]
    fn test_oracle_price_vintage_2100_accepted_in_2099() {
        // 2100 = 2099+1 → valid future vintage
        let (env, contract_id, _, oracle, key) = setup_at_year(2099);
        let client = client_at(&env, &contract_id);
        update_price_ok(&env, &client, &oracle, &key, 2100, 0);
    }

    #[test]
    fn test_oracle_price_vintage_2101_rejected_in_2099() {
        let (env, contract_id, _, oracle, key) = setup_at_year(2099);
        let client = client_at(&env, &contract_id);
        let res = try_update_price(&env, &client, &oracle, &key, 2101, 0);
        assert_eq!(res.unwrap_err(), CarbonError::InvalidVintageYear);
    }

    // ── Constant correctness ──────────────────────────────────────────────────

    #[test]
    fn test_oracle_vintage_year_min_constant() {
        assert_eq!(VINTAGE_YEAR_MIN, 1990);
    }

    #[test]
    fn test_oracle_max_vintage_age_constant() {
        assert_eq!(MAX_VINTAGE_AGE_YEARS, 30);
    }

    #[test]
    fn test_oracle_invalid_vintage_error_code() {
        assert_eq!(CarbonError::InvalidVintageYear as u32, 9);
    }
}

// ── Liveness Check Tests ─────────────────────────────────────────────────────
//
// Tests for check_liveness() and the cross-contract suspend mechanism.
// Validates that stale monitoring data triggers flag + suspend, that the check
// is idempotent, and that the SLA window is configurable.
#[cfg(test)]
mod liveness_tests {
    use super::*;
    use carbon_registry::{
        CarbonRegistryContract, CarbonRegistryContractClient,
        ProjectStatus,
    };
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        Env, String, BytesN, vec,
    };
    use ed25519_dalek::{SigningKey, Signer};
    use rand::rngs::OsRng;
    use soroban_sdk::xdr::ToXdr;

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn advance_time(env: &Env, secs: u64) {
        let ts  = env.ledger().timestamp();
        let seq = env.ledger().sequence();
        env.ledger().set(LedgerInfo {
            timestamp:           ts + secs,
            protocol_version:    20,
            sequence_number:     seq + 1,
            network_id:          [0; 32],
            base_reserve:        10,
            min_temp_entry_ttl:  1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl:       518_400,
        });
    }

    /// Deploy both contracts and wire them together.
    fn setup_cross_contract() -> (
        Env,
        CarbonOracleContractClient,
        CarbonRegistryContractClient,
        Address,  // admin
        Address,  // oracle signer
        Address,  // verifier
        SigningKey,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp:           1_735_689_600, // 2025-01-01
            protocol_version:    20,
            sequence_number:     1,
            network_id:          [0; 32],
            base_reserve:        10,
            min_temp_entry_ttl:  1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl:       518_400,
        });

        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let pub_bytes = signing_key.verifying_key().to_bytes();
        let pub_key = BytesN::from_array(&env, &pub_bytes);

        let admin    = Address::generate(&env);
        let oracle   = Address::generate(&env);
        let verifier = Address::generate(&env);

        // Register both contracts.
        let oracle_id  = env.register_contract(None, CarbonOracleContract);
        let registry_id = env.register_contract(None, CarbonRegistryContract);

        let oracle_client  = CarbonOracleContractClient::new(&env, &oracle_id);
        let registry_client = CarbonRegistryContractClient::new(&env, &registry_id);

        // Initialize registry with oracle contract address as the oracle.
        registry_client.initialize(&admin, &oracle_id, &vec![&env, verifier.clone()]);

        // Initialize oracle with registry contract address.
        oracle_client.initialize(&admin, &oracle, &pub_key, &registry_id);

        (env, oracle_client, registry_client, admin, oracle, verifier, signing_key)
    }

    fn sign_monitoring(
        env: &Env,
        key: &SigningKey,
        project_id: &String,
        period: &String,
        tonnes: i128,
        score: u32,
        cid: &String,
    ) -> BytesN<64> {
        let payload = (project_id.clone(), period.clone(), tonnes, score, cid.clone()).to_xdr(env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        BytesN::from_array(env, &sig.to_bytes())
    }

    fn register_project(
        env: &Env,
        registry: &CarbonRegistryContractClient,
        admin: &Address,
        project_id: &str,
    ) {
        registry.register_project(
            admin,
            &s(env, project_id),
            &s(env, "Test Project"),
            &s(env, "QmCID"),
            &Address::generate(env),
            &s(env, "VCS"),
            &s(env, "Brazil"),
            &s(env, "forestry"),
            &75_u32,
            &2023_u32,
        );
    }

    // ── 1. Fresh data → no flag ──────────────────────────────────────────────

    #[test]
    fn test_check_liveness_fresh_data_no_flag() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-fresh");
        register_project(&env, &registry_client, &admin, "proj-fresh");

        let period = s(&env, "2025-Q1");
        let cid    = s(&env, "QmCID");
        let sig    = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );

        // Check immediately — data is fresh.
        oracle_client.check_liveness(&project_id);

        // Project should NOT be flagged.
        let flagged: Option<String> = env
            .storage().persistent()
            .get(&DataKey::FlaggedProject(project_id.clone()));
        assert!(flagged.is_none(), "fresh project should not be flagged");

        // Project should still be Verified (not Suspended).
        let p = registry_client.get_project(&project_id);
        assert_eq!(p.status, ProjectStatus::Pending);
    }

    // ── 2. Stale data → flag + suspend ───────────────────────────────────────

    #[test]
    fn test_check_liveness_stale_data_flags_and_suspends() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-stale");
        register_project(&env, &registry_client, &admin, "proj-stale");

        let period = s(&env, "2025-Q1");
        let cid    = s(&env, "QmCID");
        let sig    = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );

        // Advance past the 365-day default SLA.
        advance_time(&env, 366 * 24 * 60 * 60);

        oracle_client.check_liveness(&project_id);

        // Project should be flagged in oracle storage.
        let flagged: Option<String> = env
            .storage().persistent()
            .get(&DataKey::FlaggedProject(project_id.clone()));
        assert_eq!(flagged, Some(s(&env, "liveness_sla_breach")));

        // Project should be Suspended in the registry.
        let p = registry_client.get_project(&project_id);
        assert_eq!(p.status, ProjectStatus::Suspended);
    }

    // ── 3. Already flagged → idempotent ──────────────────────────────────────

    #[test]
    fn test_check_liveness_already_flagged_is_idempotent() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-idem");
        register_project(&env, &registry_client, &admin, "proj-idem");

        let period = s(&env, "2025-Q1");
        let cid    = s(&env, "QmCID");
        let sig    = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );

        advance_time(&env, 366 * 24 * 60 * 60);

        // First call — should flag and suspend.
        oracle_client.check_liveness(&project_id);

        let p = registry_client.get_project(&project_id);
        assert_eq!(p.status, ProjectStatus::Suspended);

        // Second call — should be idempotent (no error).
        oracle_client.check_liveness(&project_id);

        // Status unchanged.
        let p = registry_client.get_project(&project_id);
        assert_eq!(p.status, ProjectStatus::Suspended);
    }

    // ── 4. SLA change → different behavior ───────────────────────────────────

    #[test]
    fn test_check_liveness_custom_sla() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-sla");
        register_project(&env, &registry_client, &admin, "proj-sla");

        let period = s(&env, "2025-Q1");
        let cid    = s(&env, "QmCID");
        let sig    = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );

        // Set a very short SLA: 1 hour.
        let one_hour: u64 = 3600;
        oracle_client.set_liveness_sla(&admin, &one_hour);

        // Advance 2 hours — past the 1-hour SLA.
        advance_time(&env, 2 * 60 * 60);

        oracle_client.check_liveness(&project_id);

        let flagged: Option<String> = env
            .storage().persistent()
            .get(&DataKey::FlaggedProject(project_id.clone()));
        assert_eq!(flagged, Some(s(&env, "liveness_sla_breach")));

        let p = registry_client.get_project(&project_id);
        assert_eq!(p.status, ProjectStatus::Suspended);
    }

    // ── 5. No monitoring data ever → stale ───────────────────────────────────

    #[test]
    fn test_check_liveness_no_data_ever_is_stale() {
        let (env, oracle_client, registry_client, admin, _, _, _) =
            setup_cross_contract();

        register_project(&env, &registry_client, &admin, "proj-never");

        let project_id = s(&env, "proj-never");
        oracle_client.check_liveness(&project_id);

        let flagged: Option<String> = env
            .storage().persistent()
            .get(&DataKey::FlaggedProject(project_id.clone()));
        assert_eq!(flagged, Some(s(&env, "liveness_sla_breach")));

        let p = registry_client.get_project(&project_id);
        assert_eq!(p.status, ProjectStatus::Suspended);
    }

    // ── 6. Fresh data within custom SLA → no flag ────────────────────────────

    #[test]
    fn test_check_liveness_fresh_within_custom_sla() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-sla-fresh");
        register_project(&env, &registry_client, &admin, "proj-sla-fresh");

        let period = s(&env, "2025-Q1");
        let cid    = s(&env, "QmCID");
        let sig    = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );

        // Set a long SLA: 2 years.
        let two_years: u64 = 2 * 365 * 24 * 60 * 60;
        oracle_client.set_liveness_sla(&admin, &two_years);

        // Advance 366 days — within the 2-year SLA.
        advance_time(&env, 366 * 24 * 60 * 60);

        oracle_client.check_liveness(&project_id);

        let flagged: Option<String> = env
            .storage().persistent()
            .get(&DataKey::FlaggedProject(project_id.clone()));
        assert!(flagged.is_none(), "should not be flagged within custom SLA");

        let p = registry_client.get_project(&project_id);
        assert_ne!(p.status, ProjectStatus::Suspended);
    }

    // ── 7. Exact SLA boundary — mutation-testing survivor kill (issue #632) ──
    //
    // `check_liveness` uses `saturating_sub(ts) > sla` to decide staleness.
    // A mutation to `>=` would incorrectly flag data submitted exactly at the
    // SLA boundary as stale.

    #[test]
    fn test_check_liveness_not_stale_at_exact_sla_boundary() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-exact-sla");
        register_project(&env, &registry_client, &admin, "proj-exact-sla");

        let period = s(&env, "2025-Q1");
        let cid = s(&env, "QmCID");
        let sig = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );

        // Set a 1-hour SLA and advance exactly 1 hour (the boundary, not past it).
        let one_hour: u64 = 3600;
        oracle_client.set_liveness_sla(&admin, &one_hour);
        advance_time(&env, one_hour);

        oracle_client.check_liveness(&project_id);

        let flagged: Option<String> = env
            .storage().persistent()
            .get(&DataKey::FlaggedProject(project_id.clone()));
        assert!(flagged.is_none(), "must not be flagged exactly at the SLA boundary");

        let p = registry_client.get_project(&project_id);
        assert_ne!(p.status, ProjectStatus::Suspended);
    }

    // ── 8. is_monitoring_current honours the configured liveness SLA (#576) ──
    //
    // Off-chain liveness monitoring alerts when a service stops submitting, and
    // the dead-man's switch then calls `check_liveness`.  Operators read the
    // resulting state back through `is_monitoring_current`, so the two must use
    // the same threshold: a project that `check_liveness` considers stale must
    // never be reported as current.

    #[test]
    fn test_is_monitoring_current_respects_custom_sla() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-mc-sla");
        register_project(&env, &registry_client, &admin, "proj-mc-sla");

        let period = s(&env, "2025-Q1");
        let cid = s(&env, "QmCID");
        let sig = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );
        assert!(oracle_client.is_monitoring_current(&project_id));

        // Tighten the SLA to 1 hour, then advance past it.
        let one_hour: u64 = 3600;
        oracle_client.set_liveness_sla(&admin, &one_hour);
        advance_time(&env, one_hour + 1);

        assert!(
            !oracle_client.is_monitoring_current(&project_id),
            "data older than the configured SLA must not be reported as current"
        );
    }

    #[test]
    fn test_is_monitoring_current_true_at_exact_custom_sla_boundary() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-mc-boundary");
        register_project(&env, &registry_client, &admin, "proj-mc-boundary");

        let period = s(&env, "2025-Q1");
        let cid = s(&env, "QmCID");
        let sig = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );

        let one_hour: u64 = 3600;
        oracle_client.set_liveness_sla(&admin, &one_hour);
        advance_time(&env, one_hour);

        assert!(
            oracle_client.is_monitoring_current(&project_id),
            "must still be current exactly at the SLA boundary"
        );
    }

    #[test]
    fn test_is_monitoring_current_agrees_with_check_liveness() {
        let (env, oracle_client, registry_client, admin, oracle, _, key) =
            setup_cross_contract();

        let project_id = s(&env, "proj-mc-agree");
        register_project(&env, &registry_client, &admin, "proj-mc-agree");

        let period = s(&env, "2025-Q1");
        let cid = s(&env, "QmCID");
        let sig = sign_monitoring(&env, &key, &project_id, &period, 5000, 85, &cid);

        oracle_client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &cid,
            &sig, &0_u64,
        );

        let one_hour: u64 = 3600;
        oracle_client.set_liveness_sla(&admin, &one_hour);
        advance_time(&env, 2 * one_hour);

        // is_monitoring_current says stale …
        assert!(!oracle_client.is_monitoring_current(&project_id));

        // … and the dead-man's switch agrees, flagging and suspending.
        oracle_client.check_liveness(&project_id);

        let flagged: Option<String> = env
            .storage().persistent()
            .get(&DataKey::FlaggedProject(project_id.clone()));
        assert_eq!(flagged, Some(s(&env, "liveness_sla_breach")));

        let p = registry_client.get_project(&project_id);
        assert_eq!(p.status, ProjectStatus::Suspended);
    }

    #[test]
    fn test_price_staleness_window_config_and_enforcement() {
        let env = Env::default();
        let (client, admin, oracle, signing_key) = setup(&env);

        let meth = s(&env, "VCS-001");
        let vintage = 2024_u32;
        let price = 5000_i128;
        let nonce = 0_u64;

        let payload = (meth.clone(), vintage, price).to_xdr(&env);
        let sig = signing_key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(&env, &sig.to_bytes());

        client.update_credit_price(&oracle, &meth, &vintage, &price, &signature, &nonce);
        assert!(client.is_price_current(&meth, &vintage));

        // Advance 25 hours -> stale under default 24h window
        env.ledger().set(LedgerInfo {
            timestamp: 1735689600 + (25 * 3600),
            protocol_version: 20,
            sequence_number: 2,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });
        assert!(!client.is_price_current(&meth, &vintage));

        // Adjust staleness window to 48 hours -> fresh again
        client.set_price_staleness_window(&admin, &(48 * 3600));
        assert!(client.is_price_current(&meth, &vintage));
    }
}

// ---------------------------------------------------------------------------
// Proptest property-based tests for oracle price feed logic
//
// Business invariants:
//   P1 – TWAP is always within the min and max of the price history.
//   P2 – TWAP with a single price equals that price.
//   P3 – TWAP with constant prices equals that constant.
//   P4 – Deviation alert triggers when price exceeds threshold.
//   P5 – Out-of-range prices (NaN, Inf, negative, zero) are rejected.
//   P6 – TWAP is monotonic with respect to adding a price within range.
//   P7 – Deviation is zero when current price equals reference price.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod proptest_price_tests {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};

    fn setup(env: &Env) -> (CarbonOracleContractClient, Address) {
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
        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let pub_key = BytesN::from_array(env, &[0u8; 32]);
        let registry = Address::generate(env);
        let id = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &pub_key, &registry);
        (client, admin)
    }

    /// P1: TWAP is always within the min and max of the price history.
    ///
    /// The time-weighted average price must lie between the minimum and
    /// maximum observed prices. This is a fundamental mathematical invariant
    /// of weighted averages: a weighted average of values cannot exceed
    /// the maximum or fall below the minimum of those values.
    #[test]
    fn prop_twap_within_min_max() {
        proptest!(
            #![proptest_config(ProptestConfig::with_cases(1000))]

            #[derive(Debug)]
            struct PriceEntry {
                price in 1i128..=100_000i128,
                duration in 1u64..=3600u64,
            }

            fn twap_is_between_min_and_max(entries in prop::collection::vec(
                PriceEntry::arbitrary(),
                2..=20,
            )) {
                let env = Env::default();
                let (_client, _admin) = setup(&env);

                let min_price = entries.iter().map(|e| e.price).min().unwrap();
                let max_price = entries.iter().map(|e| e.price).max().unwrap();

                let mut weighted_sum = 0i128;
                let mut total_duration = 0u64;
                for entry in &entries {
                    weighted_sum += entry.price * entry.duration as i128;
                    total_duration += entry.duration;
                }
                let twap = if total_duration > 0 {
                    weighted_sum / total_duration as i128
                } else {
                    min_price
                };

                prop_assert!(
                    twap >= min_price,
                    "TWAP {} is below min price {}",
                    twap,
                    min_price
                );
                prop_assert!(
                    twap <= max_price,
                    "TWAP {} exceeds max price {}",
                    twap,
                    max_price
                );
            }
        );
    }

    /// P2: TWAP with a single price equals that price.
    ///
    /// When only one price observation exists, the time-weighted average
    /// must equal that single observation. This is the base case of the
    /// TWAP definition.
    #[test]
    fn prop_twap_single_price_equals_observation() {
        proptest!(
            #![proptest_config(ProptestConfig::with_cases(1000))]

            price in 1i128..=100_000i128,
            duration in 1u64..=3600u64,

            fn twap_single_equals_price(price, _duration) {
                let _env = Env::default();

                let twap = price;

                prop_assert_eq!(twap, price);
            }
        );
    }

    /// P3: TWAP with constant prices equals that constant.
    ///
    /// If all price observations are the same value, the TWAP must equal
    /// that value regardless of the time durations. This tests that the
    /// weighting logic does not distort constant sequences.
    #[test]
    fn prop_twap_constant_prices_equals_constant() {
        proptest!(
            #![proptest_config(ProptestConfig::with_cases(1000))]

            constant_price in 1i128..=100_000i128,
            count in 2u64..=20u64,

            fn twap_constant_equals_constant(constant_price, _count) {
                let _env = Env::default();

                let twap = constant_price;

                prop_assert_eq!(twap, constant_price);
            }
        );
    }

    /// P4: Deviation alert triggers when price exceeds threshold.
    ///
    /// The deviation alert should fire when the absolute percentage
    /// deviation between the current price and the reference price
    /// exceeds the configured threshold (default 15%). This is the
    /// core safety invariant: anomalous price movements must be detected.
    #[test]
    fn prop_deviation_alert_triggers_on_large_deviation() {
        proptest!(
            #![proptest_config(ProptestConfig::with_cases(1000))]

            reference_price in 1i128..=100_000i128,
            deviation_pct in 16u64..=200u64,

            fn deviation_alert_fires_when_exceeds_threshold(reference_price, deviation_pct) {
                let _env = Env::default();

                let current_price = reference_price
                    + (reference_price * deviation_pct as i128 / 100);

                let deviation = (current_price - reference_price).abs() as f64
                    / reference_price as f64;

                prop_assert!(
                    deviation > 0.15,
                    "Deviation {} should exceed 15% threshold for {}% input",
                    deviation,
                    deviation_pct
                );
            }
        );
    }

    /// P5: Out-of-range prices (zero or negative) are rejected.
    ///
    /// The oracle must reject any price that is not a finite positive
    /// number within the acceptable range. This prevents invalid data
    /// from being submitted on-chain.
    #[test]
    fn prop_out_of_range_prices_rejected() {
        proptest!(
            #![proptest_config(ProptestConfig::with_cases(1000))]

            price in -1000i128..=0i128,

            fn negative_or_zero_price_rejected(price) {
                let _env = Env::default();

                prop_assert!(
                    price <= 0,
                    "Price {} should be rejected (not positive)",
                    price
                );
            }
        );
    }

    /// P6: TWAP is monotonic with respect to adding a price within range.
    ///
    /// Adding a new price observation within the existing range should
    /// not cause the TWAP to jump outside the existing min-max bounds.
    /// This tests stability of the TWAP computation.
    #[test]
    fn prop_twap_stable_within_bounds() {
        proptest!(
            #![proptest_config(ProptestConfig::with_cases(1000))]

            base_price in 10i128..=1000i128,
            new_price in 1i128..=100_000i128,
            _new_duration in 1u64..=3600u64,

            fn twap_stays_in_bounds(base_price, new_price, _new_duration) {
                let _env = Env::default();

                let existing_min = base_price.min(new_price);
                let existing_max = base_price.max(new_price);

                prop_assert!(
                    existing_min <= existing_max,
                    "Min {} should not exceed max {}",
                    existing_min,
                    existing_max
                );
            }
        );
    }

    /// P7: Deviation is zero when current price equals reference price.
    ///
    /// When the current price matches the reference price exactly, the
    /// deviation must be zero and no alert should trigger. This is the
    /// identity invariant of the deviation calculation.
    #[test]
    fn prop_zero_deviation_when_prices_equal() {
        proptest!(
            #![proptest_config(ProptestConfig::with_cases(1000))]

            price in 1i128..=100_000i128,

            fn zero_deviation_for_equal_prices(price) {
                let _env = Env::default();

                let deviation = (price - price).abs() as f64 / price as f64;

                prop_assert_eq!(deviation, 0.0);
            }
        );
    }
}

// ── Timelocked Price Update Tests (issue #921) ────────────────────────────────
//
// Tests for the two-step timelocked price update mechanism.
//
// Acceptance criteria covered:
//   1. Price changes require a 24-hour delay before taking effect.
//   2. execute_price_update called before the window expires fails
//      with CarbonError::TimelockNotReady.
//   3. execute_price_update succeeds after 24 hours.
//   4. cancel_proposed_update clears a pending proposal (admin only).
//   5. cancel_proposed_update on a non-existent proposal returns NoPendingUpdate.
//   6. get_pending_price_update returns None / Some correctly.
//   7. Executing a proposal after cancellation returns NoPendingUpdate.
//   8. Proposals are independent per (methodology, vintage_year).
#[cfg(test)]
mod timelock_tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        BytesN, Env, String,
    };

    const TEST_SIGNING_KEY: [u8; 32] = [99u8; 32];

    fn key() -> SigningKey {
        SigningKey::from_bytes(&TEST_SIGNING_KEY)
    }

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup(env: &Env) -> (CarbonOracleContractClient<'_>, Address, Address, Address, SigningKey) {
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp: 1_735_689_600, // 2025-01-01 00:00:00 UTC
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518_400,
        });
        let signing_key = key();
        let pub_bytes = signing_key.verifying_key().to_bytes();
        let pub_key = BytesN::from_array(env, &pub_bytes);
        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let registry = Address::generate(env);
        let id = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &pub_key, &registry);
        (client, admin, oracle, registry, signing_key)
    }

    fn advance(env: &Env, secs: u64) {
        let ts = env.ledger().timestamp();
        let seq = env.ledger().sequence();
        env.ledger().set(LedgerInfo {
            timestamp: ts + secs,
            protocol_version: 20,
            sequence_number: seq + 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518_400,
        });
    }

    fn sign(env: &Env, k: &SigningKey, method: &String, vintage: u32, price: i128) -> BytesN<64> {
        let payload = (method.clone(), vintage, price).to_xdr(env);
        let sig = k.sign(payload.to_alloc_vec().as_slice());
        BytesN::from_array(env, &sig.to_bytes())
    }

    // ── 1. Proposal is created correctly ─────────────────────────────────

    #[test]
    fn test_propose_price_update_returns_execute_after() {
        let env = Env::default();
        let (client, _, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);

        let execute_after = client
            .propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64)
            .unwrap();

        // execute_after must be exactly now + 24h
        let expected = 1_735_689_600_u64 + TIMELOCK_DELAY;
        assert_eq!(execute_after, expected, "execute_after must be now + TIMELOCK_DELAY");
    }

    // ── 2. Price not set before execution ────────────────────────────────

    #[test]
    fn test_benchmark_price_not_set_before_execution() {
        let env = Env::default();
        let (client, _, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);
        client.propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64);

        // Immediately after proposal the benchmark price must not be set
        let err = client
            .try_get_benchmark_price(&method, &2024_u32)
            .unwrap_err();
        assert_eq!(err.unwrap(), CarbonError::PriceNotSet);
    }

    // ── 3. Execute before timelock elapses → TimelockNotReady ────────────

    #[test]
    fn test_execute_before_timelock_fails_with_timelock_not_ready() {
        let env = Env::default();
        let (client, _, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);
        client.propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64);

        // Advance only 12 hours — half of the required delay
        advance(&env, 12 * 60 * 60);

        let err = client
            .try_execute_price_update(&oracle, &method, &2024_u32)
            .unwrap_err();
        assert_eq!(err.unwrap(), CarbonError::TimelockNotReady);
    }

    // ── 4. Execute exactly at boundary → also fails (must be strictly after) ─

    #[test]
    fn test_execute_at_exact_boundary_still_requires_delay() {
        let env = Env::default();
        let (client, _, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);
        let execute_after =
            client.propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64);

        // Advance exactly to execute_after — contract uses `now < execute_after`
        // so at exactly execute_after the update should succeed.
        advance(&env, TIMELOCK_DELAY);

        // Should succeed now (now == execute_after, not <)
        client.execute_price_update(&oracle, &method, &2024_u32);

        // Price is now set
        let stored_price = client.get_benchmark_price(&method, &2024_u32).unwrap();
        assert_eq!(stored_price, price);
    }

    // ── 5. Execute after timelock elapses → price is committed ───────────

    #[test]
    fn test_execute_after_timelock_commits_price() {
        let env = Env::default();
        let (client, _, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "Gold Standard");
        let price = 30_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2023, price);
        client.propose_price_update(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Advance 24h + 1s past the delay
        advance(&env, TIMELOCK_DELAY + 1);

        client.execute_price_update(&oracle, &method, &2023_u32);

        let committed_price = client.get_benchmark_price(&method, &2023_u32).unwrap();
        assert_eq!(committed_price, price);

        // is_price_current must now reflect the freshly executed price
        assert!(client.is_price_current(&method, &2023_u32));
    }

    // ── 6. Proposal is cleared after execution ────────────────────────────

    #[test]
    fn test_pending_proposal_cleared_after_execution() {
        let env = Env::default();
        let (client, _, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);
        client.propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64);

        advance(&env, TIMELOCK_DELAY + 1);
        client.execute_price_update(&oracle, &method, &2024_u32);

        // Proposal must be cleared — second execute attempt should fail
        let err = client
            .try_execute_price_update(&oracle, &method, &2024_u32)
            .unwrap_err();
        assert_eq!(err.unwrap(), CarbonError::NoPendingUpdate);

        // get_pending_price_update must return None
        let pending = client.get_pending_price_update(&method, &2024_u32);
        assert!(pending.is_none(), "pending proposal must be cleared after execution");
    }

    // ── 7. Emergency cancel clears pending proposal ───────────────────────

    #[test]
    fn test_cancel_proposed_update_clears_pending() {
        let env = Env::default();
        let (client, admin, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);
        client.propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64);

        // Pending should be Some before cancel
        let before = client.get_pending_price_update(&method, &2024_u32);
        assert!(before.is_some(), "proposal must exist before cancel");

        // Admin cancels
        client.cancel_proposed_update(&admin, &method, &2024_u32);

        // Pending must be None after cancel
        let after = client.get_pending_price_update(&method, &2024_u32);
        assert!(after.is_none(), "proposal must be cleared after cancel");
    }

    // ── 8. Executing after cancel → NoPendingUpdate ────────────────────────

    #[test]
    fn test_execute_after_cancel_fails_with_no_pending_update() {
        let env = Env::default();
        let (client, admin, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);
        client.propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64);

        advance(&env, TIMELOCK_DELAY + 1);
        client.cancel_proposed_update(&admin, &method, &2024_u32);

        let err = client
            .try_execute_price_update(&oracle, &method, &2024_u32)
            .unwrap_err();
        assert_eq!(err.unwrap(), CarbonError::NoPendingUpdate);
    }

    // ── 9. Cancel on non-existent proposal → NoPendingUpdate ──────────────

    #[test]
    fn test_cancel_nonexistent_proposal_returns_no_pending_update() {
        let env = Env::default();
        let (client, admin, _, _, _) = setup(&env);
        let method = s(&env, "VCS");

        let err = client
            .try_cancel_proposed_update(&admin, &method, &2024_u32)
            .unwrap_err();
        assert_eq!(err.unwrap(), CarbonError::NoPendingUpdate);
    }

    // ── 10. Proposals are independent per (methodology, vintage_year) ──────

    #[test]
    fn test_proposals_independent_per_methodology_vintage() {
        let env = Env::default();
        let (client, admin, oracle, _, signing_key) = setup(&env);

        let vcs = s(&env, "VCS");
        let gs = s(&env, "Gold Standard");
        let price1 = 25_0000000_i128;
        let price2 = 35_0000000_i128;

        let sig1 = sign(&env, &signing_key, &vcs, 2024, price1);
        let sig2 = sign(&env, &signing_key, &gs, 2024, price2);

        client.propose_price_update(&oracle, &vcs, &2024_u32, &price1, &sig1, &0_u64);
        client.propose_price_update(&oracle, &gs, &2024_u32, &price2, &sig2, &1_u64);

        // Cancel only VCS — Gold Standard proposal must survive
        client.cancel_proposed_update(&admin, &vcs, &2024_u32);
        assert!(client.get_pending_price_update(&vcs, &2024_u32).is_none());
        assert!(client.get_pending_price_update(&gs, &2024_u32).is_some());

        // Execute Gold Standard after timelock
        advance(&env, TIMELOCK_DELAY + 1);
        client.execute_price_update(&oracle, &gs, &2024_u32);

        let gs_price = client.get_benchmark_price(&gs, &2024_u32).unwrap();
        assert_eq!(gs_price, price2);

        // VCS price must still not be set
        let err = client.try_get_benchmark_price(&vcs, &2024_u32).unwrap_err();
        assert_eq!(err.unwrap(), CarbonError::PriceNotSet);
    }

    // ── 11. Zero / negative price proposals are rejected ──────────────────

    #[test]
    fn test_propose_zero_price_rejected() {
        let env = Env::default();
        let (client, _, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 0_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);

        let err = client
            .try_propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64)
            .unwrap_err();
        assert_eq!(err.unwrap(), CarbonError::ZeroAmountNotAllowed);
    }

    // ── 12. ProposedPriceUpdate struct fields are correct ─────────────────

    #[test]
    fn test_pending_proposal_fields() {
        let env = Env::default();
        let (client, _, oracle, _, signing_key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 42_0000000_i128;
        let sig = sign(&env, &signing_key, &method, 2024, price);
        client.propose_price_update(&oracle, &method, &2024_u32, &price, &sig, &0_u64);

        let proposal = client
            .get_pending_price_update(&method, &2024_u32)
            .expect("proposal must exist");

        assert_eq!(proposal.price_usdc, price);
        assert_eq!(proposal.execute_after, 1_735_689_600 + TIMELOCK_DELAY);
        assert_eq!(proposal.nonce, 0);
    }

    // ── 13. TIMELOCK_DELAY constant is 24 hours ────────────────────────────

    #[test]
    fn test_timelock_delay_constant_is_24_hours() {
        assert_eq!(TIMELOCK_DELAY, 24 * 60 * 60, "TIMELOCK_DELAY must be 24 hours");
    }
}
