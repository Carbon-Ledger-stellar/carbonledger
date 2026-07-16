#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec,
    symbol_short, vec, BytesN, Bytes
};
use soroban_sdk::xdr::ToXdr;

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

    pub fn initialize(env: Env, admin: Address, oracle_address: Address, oracle_pub_key: BytesN<32>) -> Result<(), CarbonError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::OracleAddress, &oracle_address);
        env.storage().persistent().set(&DataKey::OraclePublicKey, &oracle_pub_key);
        env.storage().persistent().set(&DataKey::OracleNonce, &0_u64);
        env.storage().persistent().set(&DataKey::ContractVersion, &CURRENT_VERSION);
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

        let current_year = Self::get_current_year(&env);
        if vintage_year < 1990 || vintage_year > current_year + 1 {
            return Err(CarbonError::InvalidVintageYear);
        }

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
        let id     = env.register_contract(None, CarbonOracleContract);
        let client = CarbonOracleContractClient::new(env, &id);
        
        client.initialize(&admin, &oracle, &pub_key);
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
        let admin  = Address::generate(env);
        let oracle = Address::generate(env);
        let id     = env.register_contract(None, CarbonOracleContract);
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
