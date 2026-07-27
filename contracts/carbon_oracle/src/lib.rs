#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec,
    symbol_short, vec, BytesN, Bytes
};
use soroban_sdk::xdr::ToXdr;

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
    ProjectNotFound        = 1,
    ProjectNotVerified     = 2,
    ProjectSuspended       = 3,
    InsufficientCredits    = 4,
    AlreadyRetired         = 5,
    SerialNumberConflict   = 6,
    UnauthorizedVerifier   = 7,
    UnauthorizedOracle     = 8,
    InvalidNonce           = 22,
    InvalidSignature       = 23,
    InvalidVintageYear     = 9,
    ListingNotFound        = 10,
    InsufficientLiquidity  = 11,
    PriceNotSet            = 12,
    MonitoringDataStale    = 13,
    DoubleCountingDetected = 14,
    RetirementIrreversible = 15,
    ZeroAmountNotAllowed   = 16,
    ProjectAlreadyExists   = 17,
    InvalidSerialRange     = 18,
    AlreadyInitialized     = 19,
    Arithmetic             = 20,
    UnauthorizedUpgrade    = 21,
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
const PRICE_CACHE_TTL_LEDGERS: u32 = 17_280;
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
}

// -- Types --------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct MonitoringData {
    pub project_id:        String,
    pub period:            String,
    pub tonnes_verified:   i128,
    pub methodology_score: u32,
    pub satellite_cid:     String,
    pub submitted_by:      Address,
    pub submitted_at:      u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeRecord {
    pub from_version: u32,
    pub to_version:   u32,
    pub timestamp:    u64,
    pub upgraded_by:  Address,
    pub wasm_hash:    BytesN<32>,
}

// -- Contract -----------------------------------------------------------------

#[contract]
pub struct CarbonOracleContract;

#[contractimpl]
impl CarbonOracleContract {

    pub fn initialize(env: Env, admin: Address, oracle_address: Address, oracle_pub_key: BytesN<32>, registry_address: Address) -> Result<(), CarbonError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::OracleAddress, &oracle_address);
        env.storage().persistent().set(&DataKey::OraclePublicKey, &oracle_pub_key);
        env.storage().persistent().set(&DataKey::OracleNonce, &0_u64);
        env.storage().persistent().set(&DataKey::ContractVersion, &CURRENT_VERSION);
        env.storage().persistent().set(&DataKey::RegistryAddress, &registry_address);
        env.storage().persistent().set(&DataKey::LivenessSlaSeconds, &MONITORING_FRESHNESS_SECS);
        Ok(())
    }

    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let current_version: u32 = env.storage()
            .persistent()
            .get(&DataKey::ContractVersion)
            .unwrap_or(1);

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        let next_version = current_version + 1;
        env.storage().persistent().set(&DataKey::ContractVersion, &next_version);

        let record = UpgradeRecord {
            from_version: current_version,
            to_version:   next_version,
            timestamp:    env.ledger().timestamp(),
            upgraded_by:  admin.clone(),
            wasm_hash:    new_wasm_hash,
        };
        env.storage().persistent().set(&DataKey::UpgradeHistory, &record);

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
        env.storage()
            .persistent()
            .get(&DataKey::UpgradeHistory)
    }

    pub fn rotate_oracle(
        env: Env,
        admin: Address,
        new_oracle: Address,
        new_pub_key: BytesN<32>,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        env.storage().persistent().set(&DataKey::OracleAddress, &new_oracle);
        env.storage().persistent().set(&DataKey::OraclePublicKey, &new_pub_key);
        env.storage().persistent().set(&DataKey::OracleNonce, &0_u64);

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
        ).to_xdr(&env);

        Self::verify_oracle_signature(&env, &payload, &signature, nonce)?;

        if tonnes_verified <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let now = env.ledger().timestamp();
        let data = MonitoringData {
            project_id:        project_id.clone(),
            period:            period.clone(),
            tonnes_verified,
            methodology_score,
            satellite_cid:     satellite_cid.clone(),
            submitted_by:      oracle_signer.clone(),
            submitted_at:      now,
        };

        env.storage().persistent().set(
            &DataKey::MonitoringData(project_id.clone(), period.clone()),
            &data,
        );
        env.storage().persistent().set(&DataKey::LatestMonitoring(project_id.clone()), &now);

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

        let payload = (
            methodology.clone(),
            vintage_year,
            price_usdc,
        ).to_xdr(&env);

        Self::verify_oracle_signature(&env, &payload, &signature, nonce)?;

        if price_usdc <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        require_valid_vintage_year!(&env, vintage_year);
        require_batch_not_expired!(&env, vintage_year);

        let now = env.ledger().timestamp();

        let key = DataKey::BenchmarkPrice(methodology.clone(), vintage_year);
        env.storage().temporary().set(&key, &price_usdc);
        env.storage().temporary().extend_ttl(&key, PRICE_CACHE_TTL_LEDGERS, PRICE_CACHE_TTL_LEDGERS);

        // Store the update timestamp persistently so staleness can be checked
        // even if the temporary price entry has expired.
        let ts_key = DataKey::PriceUpdatedAt(methodology.clone(), vintage_year);
        env.storage().persistent().set(&ts_key, &now);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("price_upd")),
            (methodology, vintage_year, price_usdc),
        );
        Ok(())
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

        let payload = (
            project_id.clone(),
            reason.clone(),
        ).to_xdr(&env);

        Self::verify_oracle_signature(&env, &payload, &signature, nonce)?;

        env.storage().persistent().set(&DataKey::FlaggedProject(project_id.clone()), &reason);

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

        env.invoke_contract(
            &registry_address,
            &env.symbol("oracle_suspend_project"),
            (
                project_id.clone(),
                reason.clone(),
            ).into_val(&env),
        );

        // 3. Emit event.
        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("liveness_flag")),
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

    /// Returns true if the benchmark price for (methodology, vintage_year) was
    /// updated within the last 24 hours.  Returns false if the price was never
    /// set or was last updated more than PRICE_STALENESS_SECS (24 h) ago.
    ///
    /// This is the primary gate used by the marketplace circuit breaker:
    /// purchase_credits() calls this before allowing any trade to proceed.
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
    pub fn get_total_verified_tonnes(
        env: Env,
        project_id: String,
        periods: Vec<String>,
    ) -> i128 {
        let mut total: i128 = 0;
        for period in periods.iter() {
            if let Some(data) = env.storage().persistent().get::<DataKey, MonitoringData>(
                &DataKey::MonitoringData(project_id.clone(), period.clone()),
            ) {
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
        let stored_nonce: u64 = env.storage().persistent().get(&DataKey::OracleNonce).unwrap_or(0);
        if nonce != stored_nonce {
            return Err(CarbonError::InvalidNonce);
        }

        let pub_key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::OraclePublicKey)
            .ok_or(CarbonError::UnauthorizedOracle)?;

        env.crypto().ed25519_verify(&pub_key, payload, signature);

        env.storage().persistent().set(&DataKey::OracleNonce, &(stored_nonce + 1));
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
    use soroban_sdk::{testutils::{Address as _, Ledger, LedgerInfo}, Env, String, Bytes, BytesN};
    use ed25519_dalek::{SigningKey, Signer};
    use rand::rngs::OsRng;
    use soroban_sdk::xdr::ToXdr;

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonOracleContractClient, Address, Address, SigningKey) {
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

        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let pub_key_bytes = signing_key.verifying_key().to_bytes();
        let pub_key = BytesN::from_array(env, &pub_key_bytes);

        let admin  = Address::generate(env);
        let oracle = Address::generate(env);
        let registry = Address::generate(env);
        let id     = env.register_contract(None, CarbonOracleContract);
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
        ).to_xdr(&env);

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
        ).to_xdr(&env);

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
        ).to_xdr(&env);

        let sig = signing_key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(&env, &sig.to_bytes());

        let err = client.try_submit_monitoring_data(
            &oracle,
            &project_id,
            &period,
            &tonnes,
            &score,
            &cid,
            &signature,
            &invalid_nonce,
        ).unwrap_err();
        
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
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        Env, String, BytesN,
    };
    use ed25519_dalek::{SigningKey, Signer};
    use rand::rngs::OsRng;
    use soroban_sdk::xdr::ToXdr;

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonOracleContractClient, Address, Address, SigningKey) {
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp:           1_735_689_600, // 2025-01-01 00:00:00 UTC
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
        let price  = 25_0000000_i128;
        let sig    = sign_price(&env, &key, &method, 2023, price);
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
        let price  = 25_0000000_i128;
        let sig    = sign_price(&env, &key, &method, 2023, price);
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
        let sig1   = sign_price(&env, &key, &method, 2023, price1);
        client.update_credit_price(&oracle, &method, &2023_u32, &price1, &sig1, &0_u64);

        // Advance to stale
        advance_time(&env, 25 * 60 * 60);
        assert!(!client.is_price_current(&method, &2023_u32), "should be stale after 25 h");

        // Oracle submits a fresh price
        let price2 = 26_0000000_i128;
        let sig2   = sign_price(&env, &key, &method, 2023, price2);
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
        let period     = s(&env, "2023-Q1");
        let payload = (
            project_id.clone(), period.clone(),
            5000_i128, 85_u32, s(&env, "QmCID"),
        ).to_xdr(&env);
        let sig = key.sign(payload.to_alloc_vec().as_slice());
        let signature = BytesN::from_array(&env, &sig.to_bytes());

        client.submit_monitoring_data(
            &oracle, &project_id, &period,
            &5000_i128, &85_u32, &s(&env, "QmCID"),
            &signature, &0_u64,
        );
        assert!(client.is_monitoring_current(&project_id), "should be current just after submit");

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
        let gs  = s(&env, "Gold Standard");
        let price = 25_0000000_i128;

        // Only set VCS 2023
        let sig = sign_price(&env, &key, &vcs, 2023, price);
        client.update_credit_price(&oracle, &vcs, &2023_u32, &price, &sig, &0_u64);

        // Advance 13 h — VCS 2023 still fresh
        advance_time(&env, 13 * 60 * 60);
        assert!(client.is_price_current(&vcs, &2023_u32),  "VCS 2023 fresh at 13 h");
        assert!(!client.is_price_current(&gs,  &2023_u32), "GS 2023 never set → stale");
        assert!(!client.is_price_current(&vcs, &2022_u32), "VCS 2022 never set → stale");

        // Advance another 13 h — VCS 2023 now stale (26 h total)
        advance_time(&env, 13 * 60 * 60);
        assert!(!client.is_price_current(&vcs, &2023_u32), "VCS 2023 stale after 26 h");
    }
}

// ── Vintage Year Validation Tests (Oracle) ────────────────────────────────────
//
// Tests covering vintage year validation on update_credit_price.
// Validates that the oracle rejects invalid vintage years and expired batches.
#[cfg(test)]
mod vintage_year_validation_tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger, LedgerInfo}, Env, String, BytesN};
    use ed25519_dalek::{SigningKey, Signer};
    use rand::rngs::OsRng;
    use soroban_sdk::xdr::ToXdr;

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn set_year(env: &Env, year: u32) {
        let seconds_per_year: u64 = 31_557_600;
        let timestamp = (year as u64 - 1970) * seconds_per_year + 86_400;
        env.ledger().set(LedgerInfo {
            timestamp,
            protocol_version: 20, sequence_number: 1,
            network_id: [0; 32], base_reserve: 10,
            min_temp_entry_ttl: 1, min_persistent_entry_ttl: 1, max_entry_ttl: 518_400,
        });
    }

    fn setup_at_year(year: u32) -> (Env, CarbonOracleContractClient, Address, Address, SigningKey) {
        let env = Env::default();
        env.mock_all_auths();
        set_year(&env, year);
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let pub_bytes = signing_key.verifying_key().to_bytes();
        let pub_key = BytesN::from_array(&env, &pub_bytes);
        let admin    = Address::generate(&env);
        let oracle   = Address::generate(&env);
        let registry = Address::generate(&env);
        let id     = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(&env, &id);
        client.initialize(&admin, &oracle, &pub_key, &registry);
        (env, client, admin, oracle, signing_key)
    }

    fn sign_price(env: &Env, key: &SigningKey, methodology: &String, vintage_year: u32, price: i128, nonce: u64) -> BytesN<64> {
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
    ) -> Result<(), soroban_sdk::Error> {
        let method = s(env, "VCS");
        let price = 25_0000000_i128;
        let sig = sign_price(env, key, &method, vintage_year, price, nonce);
        client.try_update_credit_price(oracle, &method, &vintage_year, &price, &sig, &nonce)
            .map(|_| ())
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
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, 0, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    #[test]
    fn test_oracle_price_vintage_1_rejected() {
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, 1, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    #[test]
    fn test_oracle_price_vintage_1900_rejected() {
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, 1900, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    #[test]
    fn test_oracle_price_vintage_1989_rejected() {
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, 1989, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    // ── Minimum boundary (1990) ────────────────────────────────────────────────

    #[test]
    fn test_oracle_price_vintage_1990_accepted_when_not_expired() {
        // At year 2019: 1990+30=2020 >= 2019 → not expired; 1990 >= 1990 → valid
        let (env, client, _, oracle, key) = setup_at_year(2019);
        update_price_ok(&env, &client, &oracle, &key, 1990, 0);
    }

    // ── Current year boundary ─────────────────────────────────────────────────

    #[test]
    fn test_oracle_price_vintage_current_accepted() {
        let (env, client, _, oracle, key) = setup_at_year(2026);
        update_price_ok(&env, &client, &oracle, &key, 2026, 0);
    }

    #[test]
    fn test_oracle_price_vintage_current_plus_1_accepted() {
        let (env, client, _, oracle, key) = setup_at_year(2026);
        update_price_ok(&env, &client, &oracle, &key, 2027, 0);
    }

    #[test]
    fn test_oracle_price_vintage_current_plus_2_rejected() {
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, 2028, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    #[test]
    fn test_oracle_price_vintage_u32_max_rejected() {
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, u32::MAX, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    // ── Batch expiry ──────────────────────────────────────────────────────────

    #[test]
    fn test_oracle_price_expired_vintage_rejected() {
        // At year 2026: 1994+30=2024 < 2026 → expired
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, 1994, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    #[test]
    fn test_oracle_price_at_exact_expiry_boundary_rejected() {
        // At year 2026: vintage 1995+30=2025 < 2026 → expired
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, 1995, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    #[test]
    fn test_oracle_price_just_inside_expiry_boundary_accepted() {
        // At year 2026: vintage 1996+30=2026 = 2026, NOT < 2026 → valid
        let (env, client, _, oracle, key) = setup_at_year(2026);
        update_price_ok(&env, &client, &oracle, &key, 1996, 0);
    }

    #[test]
    fn test_oracle_price_far_past_expiry_rejected() {
        // At year 2026: vintage 1990+30=2020 < 2026 → expired
        let (env, client, _, oracle, key) = setup_at_year(2026);
        let res = try_update_price(&env, &client, &oracle, &key, 1990, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
    }

    // ── Century boundaries ────────────────────────────────────────────────────

    #[test]
    fn test_oracle_price_vintage_1999_accepted_in_2025() {
        // 1999+30=2029 >= 2025 → valid
        let (env, client, _, oracle, key) = setup_at_year(2025);
        update_price_ok(&env, &client, &oracle, &key, 1999, 0);
    }

    #[test]
    fn test_oracle_price_vintage_2000_accepted_in_2025() {
        let (env, client, _, oracle, key) = setup_at_year(2025);
        update_price_ok(&env, &client, &oracle, &key, 2000, 0);
    }

    #[test]
    fn test_oracle_price_vintage_2099_accepted_in_2099() {
        let (env, client, _, oracle, key) = setup_at_year(2099);
        update_price_ok(&env, &client, &oracle, &key, 2099, 0);
    }

    #[test]
    fn test_oracle_price_vintage_2100_accepted_in_2099() {
        // 2100 = 2099+1 → valid future vintage
        let (env, client, _, oracle, key) = setup_at_year(2099);
        update_price_ok(&env, &client, &oracle, &key, 2100, 0);
    }

    #[test]
    fn test_oracle_price_vintage_2101_rejected_in_2099() {
        let (env, client, _, oracle, key) = setup_at_year(2099);
        let res = try_update_price(&env, &client, &oracle, &key, 2101, 0);
        assert_eq!(res.unwrap_err(), soroban_sdk::Error::from_contract_error(9));
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
}
