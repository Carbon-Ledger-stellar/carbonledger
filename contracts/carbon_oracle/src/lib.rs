#![no_std]

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    String, Vec,
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
    /// Returned when execute_price is called before the 24-hour timelock expires.
    TimelockNotExpired = 24,
    /// Returned when execute_price or cancel_price is called with no pending proposal.
    NoPendingProposal = 25,
}

// -- Constants ----------------------------------------------------------------

/// Earliest valid vintage year for carbon credits.
pub const VINTAGE_YEAR_MIN: u32 = 1990;
/// Maximum number of years a vintage may be aged before it is considered expired.
pub const MAX_VINTAGE_AGE_YEARS: u32 = 30;

const MONITORING_FRESHNESS_SECS: u64 = 365 * 24 * 60 * 60;
/// Maximum age of a benchmark price before it is considered stale (24 hours).
pub const PRICE_STALENESS_SECS: u64 = 24 * 60 * 60;
/// Minimum delay that must elapse between propose_price and execute_price.
/// Set to 24 hours (86 400 seconds) to give time for key-compromise detection.
pub const PRICE_TIMELOCK_DELAY_SECS: u64 = 24 * 60 * 60;
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
    PriceUpdatedAt(String, u32),
    /// Pending (proposed but not yet executed) price update for (methodology, vintage_year).
    PendingPrice(String, u32),
    FlaggedProject(String),
    OracleAddress,
    OraclePublicKey,
    OracleNonce,
    Admin,
    ContractVersion,
    UpgradeHistory,
    /// Configurable liveness SLA in seconds. Default: 365 days.
    LivenessSlaSeconds,
    /// Address of the carbon_registry contract for cross-contract suspend calls.
    RegistryAddress,
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

/// A pending price proposal that has been submitted but not yet executed.
/// Cannot be executed before `proposed_at + PRICE_TIMELOCK_DELAY_SECS`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PendingPriceProposal {
    /// The methodology this price applies to (e.g. "VCS", "Gold Standard").
    pub methodology: String,
    /// The vintage year this price applies to.
    pub vintage_year: u32,
    /// The proposed price in micro-USDC stroops.
    pub price_usdc: i128,
    /// The oracle address that submitted this proposal.
    pub proposed_by: Address,
    /// Ledger timestamp when the proposal was submitted.
    pub proposed_at: u64,
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
        Ok(())
    }

    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) -> Result<(), CarbonError> {
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

    // ── Timelock price update: propose / execute / cancel ───────────────────

    /// Phase 1 of the timelock price update flow.
    ///
    /// Stores a `PendingPriceProposal` with the current ledger timestamp.
    /// The proposal cannot be executed until `PRICE_TIMELOCK_DELAY_SECS`
    /// (24 hours) have elapsed.
    ///
    /// Replaces the former `update_credit_price` which applied prices immediately.
    /// A new proposal overwrites any existing pending proposal for the same
    /// (methodology, vintage_year) pair — the caller must re-call execute_price
    /// after the new 24-hour window.
    pub fn propose_price(
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

        let proposal = PendingPriceProposal {
            methodology: methodology.clone(),
            vintage_year,
            price_usdc,
            proposed_by: oracle_signer.clone(),
            proposed_at: now,
        };

        let key = DataKey::PendingPrice(methodology.clone(), vintage_year);
        env.storage().persistent().set(&key, &proposal);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_META_TTL_LEDGERS,
            PERSISTENT_META_TTL_LEDGERS,
        );

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("price_prp")),
            (methodology, vintage_year, price_usdc, now),
        );
        Ok(())
    }

    /// Phase 2 of the timelock price update flow.
    ///
    /// Applies the pending price proposal to the benchmark price storage.
    /// Callable by the oracle after `PRICE_TIMELOCK_DELAY_SECS` (24 hours)
    /// have elapsed since `propose_price` was called.
    ///
    /// Returns:
    ///  - `CarbonError::NoPendingProposal` if no proposal exists for the key
    ///  - `CarbonError::TimelockNotExpired` if fewer than 24 hours have elapsed
    pub fn execute_price(
        env: Env,
        oracle_signer: Address,
        methodology: String,
        vintage_year: u32,
    ) -> Result<(), CarbonError> {
        oracle_signer.require_auth();
        Self::require_oracle(&env, &oracle_signer)?;

        let pending_key = DataKey::PendingPrice(methodology.clone(), vintage_year);
        let proposal: PendingPriceProposal = env
            .storage()
            .persistent()
            .get(&pending_key)
            .ok_or(CarbonError::NoPendingProposal)?;

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(proposal.proposed_at);

        if elapsed < PRICE_TIMELOCK_DELAY_SECS {
            return Err(CarbonError::TimelockNotExpired);
        }

        // Timelock satisfied — apply the price
        let price_key = DataKey::BenchmarkPrice(methodology.clone(), vintage_year);
        env.storage().temporary().set(&price_key, &proposal.price_usdc);
        env.storage().temporary().extend_ttl(
            &price_key,
            PRICE_CACHE_TTL_LEDGERS,
            PRICE_CACHE_TTL_LEDGERS,
        );

        // Persist updated-at timestamp for staleness checks
        let ts_key = DataKey::PriceUpdatedAt(methodology.clone(), vintage_year);
        env.storage().persistent().set(&ts_key, &now);
        env.storage().persistent().extend_ttl(
            &ts_key,
            PERSISTENT_META_TTL_LEDGERS,
            PERSISTENT_META_TTL_LEDGERS,
        );

        // Remove the pending proposal — it has been consumed
        env.storage().persistent().remove(&pending_key);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("price_exe")),
            (methodology, vintage_year, proposal.price_usdc),
        );
        Ok(())
    }

    /// Emergency cancellation of a pending price proposal.
    ///
    /// Only the ADMIN may call this function. Intended for use when a
    /// compromised oracle key has submitted a malicious price proposal
    /// and the 24-hour window is still open.
    ///
    /// Returns `CarbonError::NoPendingProposal` if no proposal exists.
    pub fn cancel_price(
        env: Env,
        admin: Address,
        methodology: String,
        vintage_year: u32,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let key = DataKey::PendingPrice(methodology.clone(), vintage_year);
        if !env.storage().persistent().has(&key) {
            return Err(CarbonError::NoPendingProposal);
        }

        env.storage().persistent().remove(&key);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("price_cnl")),
            (methodology, vintage_year, admin),
        );
        Ok(())
    }

    /// Returns the pending price proposal for (methodology, vintage_year) if
    /// one exists, or None if no proposal is pending.
    pub fn get_pending_proposal(
        env: Env,
        methodology: String,
        vintage_year: u32,
    ) -> Option<PendingPriceProposal> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingPrice(methodology, vintage_year))
    }

    // ── Read functions ───────────────────────────────────────────────────────

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

    pub fn is_monitoring_current(env: Env, project_id: String) -> bool {
        let latest: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::LatestMonitoring(project_id));

        match latest {
            None => false,
            Some(ts) => {
                let now = env.ledger().timestamp();
                now.saturating_sub(ts) <= MONITORING_FRESHNESS_SECS
            }
        }
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

    /// Returns true if the benchmark price for (methodology, vintage_year) was
    /// updated within the last 24 hours.
    pub fn is_price_current(env: Env, methodology: String, vintage_year: u32) -> bool {
        let ts: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PriceUpdatedAt(methodology, vintage_year));

        match ts {
            None => false,
            Some(updated_at) => {
                let now = env.ledger().timestamp();
                now.saturating_sub(updated_at) <= PRICE_STALENESS_SECS
            }
        }
    }

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

    /// Permissionless liveness check.
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

        env.storage().persistent().set(
            &DataKey::FlaggedProject(project_id.clone()),
            &reason,
        );

        let registry_address: Address = env
            .storage()
            .persistent()
            .get(&DataKey::RegistryAddress)
            .ok_or(CarbonError::ProjectNotFound)?;

        env.invoke_contract(
            &registry_address,
            &env.symbol("oracle_suspend_project"),
            (
                project_id.clone(),
                reason.clone(),
            ).into_val(&env),
        );

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("liveness_flag")),
            (project_id, reason),
        );

        Ok(())
    }

    // ── Private helpers ──────────────────────────────────────────────────────

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
        let id = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(env, &id);

        client.initialize(&admin, &oracle, &pub_key);
        (client, admin, oracle, signing_key)
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

    fn sign_price(
        env: &Env,
        key: &SigningKey,
        methodology: &String,
        vintage_year: u32,
        price: i128,
        nonce: u64,
    ) -> BytesN<64> {
        let payload = (methodology.clone(), vintage_year, price).to_xdr(env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        BytesN::from_array(env, &sig.to_bytes())
    }

    // ── 1. propose_price stores a pending proposal ───────────────────────────

    #[test]
    fn test_propose_price_stores_pending_proposal() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        let proposal = client.get_pending_proposal(&method, &2023_u32);
        assert!(proposal.is_some(), "proposal should be stored");
        let p = proposal.unwrap();
        assert_eq!(p.price_usdc, price);
        assert_eq!(p.vintage_year, 2023);
    }

    // ── 2. execute_price before timelock returns TimelockNotExpired ──────────

    #[test]
    fn test_execute_price_before_timelock_returns_error() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        // Propose
        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Try to execute immediately — should fail
        let err = client
            .try_execute_price(&oracle, &method, &2023_u32)
            .unwrap_err()
            .unwrap();

        assert_eq!(err, CarbonError::TimelockNotExpired);
    }

    // ── 3. execute_price after 24h succeeds ──────────────────────────────────

    #[test]
    fn test_execute_price_after_24h_succeeds() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        // Propose
        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Advance exactly 24 hours
        advance_time(&env, PRICE_TIMELOCK_DELAY_SECS);

        // Execute — should succeed
        client.execute_price(&oracle, &method, &2023_u32);

        // Price should now be available
        let stored_price = client.get_benchmark_price(&method, &2023_u32);
        assert_eq!(stored_price, price);
    }

    // ── 4. execute_price at exactly timelock boundary (24h - 1s) fails ───────

    #[test]
    fn test_execute_price_one_second_before_timelock_fails() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Advance to 1 second before the timelock
        advance_time(&env, PRICE_TIMELOCK_DELAY_SECS - 1);

        let err = client
            .try_execute_price(&oracle, &method, &2023_u32)
            .unwrap_err()
            .unwrap();

        assert_eq!(err, CarbonError::TimelockNotExpired);
    }

    // ── 5. cancel_price removes pending proposal ─────────────────────────────

    #[test]
    fn test_cancel_price_removes_proposal() {
        let env = Env::default();
        let (client, admin, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Admin cancels during the timelock window
        client.cancel_price(&admin, &method, &2023_u32);

        let proposal = client.get_pending_proposal(&method, &2023_u32);
        assert!(proposal.is_none(), "proposal should be removed after cancel");
    }

    // ── 6. execute_price after cancel returns NoPendingProposal ─────────────

    #[test]
    fn test_execute_price_after_cancel_returns_no_pending() {
        let env = Env::default();
        let (client, admin, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Cancel
        client.cancel_price(&admin, &method, &2023_u32);

        // Advance past the timelock
        advance_time(&env, PRICE_TIMELOCK_DELAY_SECS + 1);

        let err = client
            .try_execute_price(&oracle, &method, &2023_u32)
            .unwrap_err()
            .unwrap();

        assert_eq!(err, CarbonError::NoPendingProposal);
    }

    // ── 7. execute_price with no proposal at all returns NoPendingProposal ───

    #[test]
    fn test_execute_price_with_no_proposal_returns_error() {
        let env = Env::default();
        let (client, _, oracle, _) = setup(&env);
        let method = s(&env, "VCS");

        let err = client
            .try_execute_price(&oracle, &method, &2023_u32)
            .unwrap_err()
            .unwrap();

        assert_eq!(err, CarbonError::NoPendingProposal);
    }

    // ── 8. cancel_price with no proposal returns NoPendingProposal ──────────

    #[test]
    fn test_cancel_price_with_no_proposal_returns_error() {
        let env = Env::default();
        let (client, admin, _, _) = setup(&env);
        let method = s(&env, "VCS");

        let err = client
            .try_cancel_price(&admin, &method, &2023_u32)
            .unwrap_err()
            .unwrap();

        assert_eq!(err, CarbonError::NoPendingProposal);
    }

    // ── 9. cancel_price cannot be called by non-admin ────────────────────────

    #[test]
    fn test_cancel_price_non_admin_not_authorized() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        // Use a random non-admin address
        let impostor = Address::generate(&env);
        let err = client
            .try_cancel_price(&impostor, &method, &2023_u32)
            .unwrap_err()
            .unwrap();

        assert_eq!(err, CarbonError::UnauthorizedVerifier);
    }

    // ── 10. pending proposal cleared after execute ───────────────────────────

    #[test]
    fn test_pending_proposal_cleared_after_execute() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        advance_time(&env, PRICE_TIMELOCK_DELAY_SECS);
        client.execute_price(&oracle, &method, &2023_u32);

        // Proposal should be removed
        let proposal = client.get_pending_proposal(&method, &2023_u32);
        assert!(proposal.is_none(), "proposal should be consumed by execute_price");
    }

    // ── 11. is_price_current is true after execute ───────────────────────────

    #[test]
    fn test_is_price_current_true_after_execute() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        let price = 25_0000000_i128;

        let sig = sign_price(&env, &key, &method, 2023, price, 0);
        client.propose_price(&oracle, &method, &2023_u32, &price, &sig, &0_u64);

        advance_time(&env, PRICE_TIMELOCK_DELAY_SECS);
        client.execute_price(&oracle, &method, &2023_u32);

        assert!(
            client.is_price_current(&method, &2023_u32),
            "price should be current after successful execute"
        );
    }

    // ── 12. Monitoring data submission still works ───────────────────────────

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

    // ── 13. Error constant values ─────────────────────────────────────────────

    #[test]
    fn test_timelock_error_code() {
        assert_eq!(CarbonError::TimelockNotExpired as u32, 24);
    }

    #[test]
    fn test_no_pending_proposal_error_code() {
        assert_eq!(CarbonError::NoPendingProposal as u32, 25);
    }

    // ── 14. propose → wait → execute full happy path ─────────────────────────

    #[test]
    fn test_full_timelock_flow() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "Gold Standard");
        let price = 30_0000000_i128;

        // 1. Propose
        let sig = sign_price(&env, &key, &method, 2024, price, 0);
        client.propose_price(&oracle, &method, &2024_u32, &price, &sig, &0_u64);

        // 2. Verify proposal is pending
        let pending = client.get_pending_proposal(&method, &2024_u32).unwrap();
        assert_eq!(pending.price_usdc, price);

        // 3. Cannot execute yet
        let err = client
            .try_execute_price(&oracle, &method, &2024_u32)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, CarbonError::TimelockNotExpired);

        // 4. Advance 24 hours
        advance_time(&env, PRICE_TIMELOCK_DELAY_SECS);

        // 5. Execute succeeds
        client.execute_price(&oracle, &method, &2024_u32);

        // 6. Price is now accessible
        assert_eq!(client.get_benchmark_price(&method, &2024_u32), price);
        assert!(client.is_price_current(&method, &2024_u32));

        // 7. Proposal is gone
        assert!(client.get_pending_proposal(&method, &2024_u32).is_none());
    }
}

// ── Staleness tests (retained from original) ─────────────────────────────────

#[cfg(test)]
mod staleness_tests {
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
        let id = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &pub_key);
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

    fn propose_and_execute(
        env: &Env,
        client: &CarbonOracleContractClient,
        oracle: &Address,
        key: &SigningKey,
        methodology: &String,
        vintage_year: u32,
        price: i128,
        nonce: u64,
    ) {
        let sig = sign_price(env, key, methodology, vintage_year, price);
        // We need to rebuild the payload with nonce for the full sign_price with nonce
        let payload = (methodology.clone(), vintage_year, price).to_xdr(env);
        let raw_sig = key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(env, &raw_sig.to_bytes());
        let _ = sig;
        client.propose_price(oracle, methodology, &vintage_year, &price, &signature, &nonce);
        advance_time(env, PRICE_TIMELOCK_DELAY_SECS);
        client.execute_price(oracle, methodology, &vintage_year);
    }

    #[test]
    fn test_is_price_current_false_when_never_set() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        assert!(!client.is_price_current(&s(&env, "VCS"), &2023_u32));
    }

    #[test]
    fn test_is_price_current_true_after_execute() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        propose_and_execute(&env, &client, &oracle, &key, &method, 2023, 25_0000000, 0);
        assert!(client.is_price_current(&method, &2023_u32));
    }

    #[test]
    fn test_is_price_current_false_after_24_hours_from_execute() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);
        let method = s(&env, "VCS");
        propose_and_execute(&env, &client, &oracle, &key, &method, 2023, 25_0000000, 0);
        advance_time(&env, PRICE_STALENESS_SECS + 1);
        assert!(!client.is_price_current(&method, &2023_u32));
    }

    #[test]
    fn test_is_monitoring_current_false_after_365_days() {
        let env = Env::default();
        let (client, _, oracle, key) = setup(&env);

        let project_id = s(&env, "proj-stale");
        let period = s(&env, "2023-Q1");
        let payload = (
            project_id.clone(), period.clone(), 5000_i128, 85_u32, s(&env, "QmCID"),
        ).to_xdr(&env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(&env, &sig.to_bytes());

        client.submit_monitoring_data(
            &oracle, &project_id, &period, &5000_i128, &85_u32,
            &s(&env, "QmCID"), &signature, &0_u64,
        );
        assert!(client.is_monitoring_current(&project_id));

        advance_time(&env, 366 * 24 * 60 * 60);
        assert!(!client.is_monitoring_current(&project_id));
    }
}
