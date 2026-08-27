#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, Bytes,
    BytesN, Env, String, Symbol, Vec,
};

pub(crate) const TTL_LEDGERS: u32 = 518_400;
const CURRENT_VERSION: u32 = 1;
/// Default maximum number of upgrade history entries retained.
pub const DEFAULT_MAX_HISTORY_ENTRIES: u32 = 50;
/// Minimum allowed value for max_history_entries.
pub const MIN_HISTORY_ENTRIES: u32 = 10;
/// Maximum allowed value for max_history_entries.
pub const MAX_HISTORY_ENTRIES_LIMIT: u32 = 200;

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
    BatchTooLarge = 19,
    AlreadyInitialized = 20,
    Arithmetic = 21,
    UnauthorizedUpgrade = 22,
    /// Cross-contract invariant violation: total issued credits would exceed
    /// the oracle-verified tonnes for this project.
    IssuanceExceedsVerified = 23,
    InvalidZkProofFormat = 24,
    ZkProofVerificationFailed = 25,
    PageSizeTooLarge = 26,
    StorageLimitExceeded = 27,
    InvalidPauseWindow = 28,
    EmergencyPaused = 29,
}

pub const MAX_BATCH_SIZE: i128 = 1_000_000_000;
/// Maximum number of credit batches a single project can host before storage caps kick in.
pub const MAX_BATCHES_PER_PROJECT: u32 = 10_000;
pub const MAX_VINTAGE_AGE_YEARS: u32 = 30;
pub const DEFAULT_MIN_VINTAGE_YEAR: u32 = 1990;
pub const DEFAULT_MAX_VINTAGE_YEAR: u32 = 0;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Batch(String),
    Retirement(String),
    ProjectBatches(String),
    ProjectBatchCount(String),
    /// Pre-#887 flat registry: `Map<serial_start, serial_end>` in a single
    /// ledger entry. Superseded by the skip-list index in [`serial_index`];
    /// retained so upgraded contracts can drain it via `migrate_serial_index`.
    SerialRegistry,
    Admin,
    RegistryContract,
    ContractVersion,
    UpgradeHistory,
    PauseEnabled,
    PauseUntil,
    VintageYearMin,
    VintageYearMax,
    /// Maximum number of upgrade history entries to retain.
    MaxHistoryEntries,
    /// Address of the carbon_oracle contract, used to query verified tonnes
    /// before minting.  Set by admin via set_oracle_contract().
    OracleContract,
    /// Per-project list of monitoring period strings used to sum verified tonnes.
    /// Key = project_id; Value = Vec<String> of period identifiers.
    VerifiedPeriods(String),
    UserBatches(Address),
    TotalSupply,
    Allowance(Address, Address),
}

#[contracttype]
#[derive(Clone)]
pub struct CarbonCredit {
    pub project_id: u32,
    pub serial_number: String,
    pub vintage_year: u32,
    pub serial_start: u64,
    pub serial_end: u64,
    pub timestamp: u64,
    pub amount: i128,
    pub owner: Address,
    pub retired: bool,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CreditRetiredEvent {
    pub retirement_id: String,
    pub batch_id: String,
    pub project_id: String,
    pub amount: i128,
    pub retired_by: Address,
    pub beneficiary: String,
    pub timestamp: u64,
    /// IPFS CID of the pinned retirement certificate (#600). Lets indexers
    /// and off-chain verifiers resolve the certificate directly from the
    /// on-chain event without a separate backend lookup.
    pub certificate_cid: String,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CreditMintedEvent {
    pub batch_id: String,
    pub project_id: String,
    pub amount: i128,
    pub retired_by: Address,
    pub beneficiary: String,
    pub timestamp: u64,
    pub retirement_id: String,
}

#[contracttype]
#[derive(Clone)]
pub enum RetiredKey {
    BatchRetired(String),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CreditStatus {
    Active,
    PartiallyRetired,
    FullyRetired,
    Suspended,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CreditBatch {
    pub batch_id: String,
    pub project_id: String,
    pub vintage_year: u32,
    pub amount: i128,
    pub serial_start: u64,
    pub serial_end: u64,
    pub issued_at: u64,
    pub status: CreditStatus,
    pub metadata_cid: String,
    pub owner: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CreditBatchWithExpiry {
    pub batch: CreditBatch,
    pub is_expired: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RetirementCertificate {
    pub retirement_id: String,
    pub credit_batch_id: String,
    pub project_id: String,
    pub amount: i128,
    pub retired_by: Address,
    pub beneficiary: String,
    pub retirement_reason: String,
    pub vintage_year: u32,
    pub serial_numbers: Vec<u64>,
    pub retired_at: u64,
    pub tx_hash: String,
    pub certificate_cid: String,
}

/// Legacy flat-list range type, kept for ABI compatibility with clients built
/// against earlier versions. The live index stores ranges as
/// [`serial_index::SerialNode`] entries instead.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SerialRange {
    pub start: u64,
    pub end: u64,
}

#[contracttype]
pub struct ProjectInfo {
    pub id: u32,
    pub name: String,
    pub methodology_score: u32,
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

/// Emitted when old upgrade history entries are pruned to stay within bounds.
#[contracttype]
#[derive(Clone, Debug)]
pub struct HistoryPrunedEvent {
    pub entries_pruned: u32,
    pub remaining:      u32,
    pub pruned_at:      u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZkProof {
    pub commitment: Bytes,
    pub salt: Bytes,
    pub proof: Bytes,
    pub to_version: u32,
    pub timestamp: u64,
    pub upgraded_by: Address,
    pub wasm_hash: BytesN<32>,
}


/// A read-only view of a `CreditBatch` with an additional computed `is_expired` field.
/// Returned by `get_credit_batch_view()`. The original `get_credit_batch()` return type
/// is unchanged for backward compatibility.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CreditBatchView {
    pub batch_id: String,
    pub project_id: String,
    pub vintage_year: u32,
    pub amount: i128,
    pub serial_start: u64,
    pub serial_end: u64,
    pub issued_at: u64,
    pub status: CreditStatus,
    pub metadata_cid: String,
    pub owner: Address,
    /// True when `current_year - vintage_year > MAX_VINTAGE_AGE_YEARS` (30).
    pub is_expired: bool,
}

#[contract]
pub struct CarbonCreditContract;

#[contractimpl]
impl CarbonCreditContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        registry_contract: Address,
    ) -> Result<(), CarbonError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::RegistryContract, &registry_contract);
        // The serial index materialises itself lazily on first use, so there is
        // nothing to seed here.
        env.storage()
            .persistent()
            .set(&DataKey::ContractVersion, &CURRENT_VERSION);
        env.storage().persistent().set(&DataKey::PauseEnabled, &false);
        env.storage().persistent().set(&DataKey::PauseUntil, &0_u64);
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

        let mut history: Vec<UpgradeRecord> = env.storage()
            .persistent()
            .get(&DataKey::UpgradeHistory)
            .unwrap_or_else(|| vec![&env]);
        history.push_back(record);

        let max: u32 = env.storage()
            .persistent()
            .get(&DataKey::MaxHistoryEntries)
            .unwrap_or(DEFAULT_MAX_HISTORY_ENTRIES);

        if history.len() > max {
            let excess = history.len() - max;
            while history.len() > max {
                history.remove(0);
            }
            env.events().publish(
                (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "hist_prune")),
                HistoryPrunedEvent {
                    entries_pruned: excess,
                    remaining:      history.len(),
                    pruned_at:      env.ledger().timestamp(),
                },
            );
        }

        env.storage().persistent().set(&DataKey::UpgradeHistory, &history);

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

    /// Returns the most recent upgrade record, or None if no upgrades have occurred.
    pub fn get_upgrade_history(env: Env) -> Option<UpgradeRecord> {
        let history: Vec<UpgradeRecord> = env.storage()
            .persistent()
            .get(&DataKey::UpgradeHistory)
            .unwrap_or_else(|| vec![&env]);
        if history.is_empty() {
            None
        } else {
            Some(history.get(history.len() - 1).unwrap())
        }
    }

    /// Returns a paginated slice of the upgrade history.
    /// `offset` is zero-based (0 = oldest record). `limit` caps at 50.
    pub fn get_upgrade_history_page(
        env: Env,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<UpgradeRecord>, CarbonError> {
        let effective_limit = if limit > 50 { 50 } else { limit };
        if effective_limit == 0 {
            return Err(CarbonError::PageSizeTooLarge);
        }

        let history: Vec<UpgradeRecord> = env.storage()
            .persistent()
            .get(&DataKey::UpgradeHistory)
            .unwrap_or_else(|| vec![&env]);
        let len = history.len();

        if offset >= len {
            return Ok(vec![&env]);
        }

        let mut result: Vec<UpgradeRecord> = vec![&env];
        let end = core::cmp::min(offset + effective_limit, len);
        for i in offset..end {
            result.push_back(history.get(i).unwrap());
        }
        Ok(result)
    }

    /// Admin: set the maximum number of upgrade history entries to retain.
    /// Values are clamped to [MIN_HISTORY_ENTRIES, MAX_HISTORY_ENTRIES_LIMIT].
    pub fn set_max_history_entries(
        env: Env,
        admin: Address,
        n: u32,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;

        let clamped = core::cmp::max(
            MIN_HISTORY_ENTRIES,
            core::cmp::min(n, MAX_HISTORY_ENTRIES_LIMIT),
        );
        env.storage().persistent().set(&DataKey::MaxHistoryEntries, &clamped);

        // If current history exceeds the new cap, prune immediately
        let mut history: Vec<UpgradeRecord> = env.storage()
            .persistent()
            .get(&DataKey::UpgradeHistory)
            .unwrap_or_else(|| vec![&env]);
        let max = clamped;

        if history.len() > max {
            let excess = history.len() - max;
            while history.len() > max {
                history.remove(0);
            }
            env.storage().persistent().set(&DataKey::UpgradeHistory, &history);
            env.events().publish(
                (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "hist_prune")),
                HistoryPrunedEvent {
                    entries_pruned: excess,
                    remaining:      history.len(),
                    pruned_at:      env.ledger().timestamp(),
                },
            );
        }

        Ok(())
    }

    pub fn set_oracle_contract(
        env: Env,
        admin: Address,
        oracle: Address,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        env.storage().persistent().set(&DataKey::OracleContract, &oracle);
        env.events().publish(
            (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "ora_set")),
            (admin, oracle),
        );
        Ok(())
    }

    pub fn set_verified_periods(
        env: Env,
        admin: Address,
        project_id: String,
        periods: Vec<String>,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        env.storage().persistent().set(&DataKey::VerifiedPeriods(project_id.clone()), &periods);
        env.events().publish(
            (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "per_set")),
            (project_id, periods.len()),
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

    pub fn get_oracle_contract(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::OracleContract)
    }

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
            Self::current_year(env) + 1
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

    /// Returns `true` when the batch's vintage year is older than
    /// `MAX_VINTAGE_AGE_YEARS` (30) relative to the current ledger year.
    /// An age of exactly 30 is still valid; only `age > 30` is expired.
    fn is_batch_expired(env: &Env, batch: &CreditBatch) -> bool {
        let year = Self::current_year(env);
        if batch.vintage_year < Self::min_vintage_year(env)
            || batch.vintage_year > Self::max_vintage_year(env)
        {
            return true;
        }
        year.saturating_sub(batch.vintage_year) > MAX_VINTAGE_AGE_YEARS
    }

    // ============================================
    // Mint Credits
    // ============================================

    pub fn mint_credits(
        env: Env,
        admin: Address,
        project_id: String,
        amount: i128,
        vintage_year: u32,
        batch_id: String,
        serial_start: u64,
        serial_end: u64,
        metadata_cid: String,
        initial_owner: Address,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;

        if project_id.is_empty() || project_id.len() > 64 {
            return Err(CarbonError::ProjectNotFound);
        }
        if batch_id.is_empty() || batch_id.len() > 64 {
            return Err(CarbonError::ProjectNotFound);
        }
        if metadata_cid.is_empty() || metadata_cid.len() > 128 {
            return Err(CarbonError::ProjectNotFound);
        }
        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }
        if amount > MAX_BATCH_SIZE {
            return Err(CarbonError::BatchTooLarge);
        }
        if serial_start == 0 || serial_end <= serial_start {
            return Err(CarbonError::InvalidSerialRange);
        }

        Self::validate_vintage_year(&env, vintage_year)?;
        if env.storage().persistent().has(&DataKey::Batch(batch_id.clone())) {
            return Err(CarbonError::SerialNumberConflict);
        }

        let batch_count_key = DataKey::ProjectBatchCount(project_id.clone());
        let batch_count: u32 = env
            .storage()
            .persistent()
            .get(&batch_count_key)
            .unwrap_or(0u32);
        if batch_count >= MAX_BATCHES_PER_PROJECT {
            return Err(CarbonError::StorageLimitExceeded);
        }
        if !Self::verify_serial_range_internal(&env, serial_start, serial_end) {
            return Err(CarbonError::DoubleCountingDetected);
        }

        serial_index::insert(&env, serial_start, serial_end);

        let batch = CreditBatch {
            batch_id: batch_id.clone(),
            project_id: project_id.clone(),
            vintage_year,
            amount,
            serial_start,
            serial_end,
            issued_at: env.ledger().timestamp(),
            status: CreditStatus::Active,
            metadata_cid: metadata_cid.clone(),
            owner: initial_owner.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id.clone()), &batch);
        Self::extend_batch_ttl(&env, &batch_id);

        let mut project_batches: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ProjectBatches(project_id.clone()))
            .unwrap_or_else(|| vec![&env]);
        project_batches.push_back(batch_id.clone());
        env.storage().persistent().set(
            &DataKey::ProjectBatches(project_id.clone()),
            &project_batches,
        );
        env.storage()
            .persistent()
            .set(&batch_count_key, &(batch_count + 1));

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("minted")),
            CreditMintedEvent {
                batch_id: batch_id.clone(),
                project_id: project_id.clone(),
                amount,
                retired_by: admin.clone(),
                beneficiary: String::from_str(&env, ""),
                timestamp: env.ledger().timestamp(),
                retirement_id: String::from_str(&env, ""),
            },
        );
        Ok(())
    }

    // ============================================
    // Get Project from Registry
    // ============================================

    fn get_project_from_registry(
        env: &Env,
        registry_address: &Address,
        project_id: &String,
    ) -> Result<ProjectInfo, CarbonError> {
        // Cross-contract call to registry
        // This is a placeholder - actual implementation depends on registry contract
        // In production, you would call:
        // let result = env.invoke_contract(
        //     registry_address,
        //     &Symbol::new(env, "get_project"),
        //     vec![env, project_id.clone().into_val(env)],
        // );
        // let project: ProjectInfo = result.unwrap();
        
        // For now, return a default project with score 100
        Ok(ProjectInfo {
            id: 1,
            name: String::from_str(env, "Default Project"),
            methodology_score: 100,
        })
    }

    // ============================================
    // Retirement and Transfer Functions
    // ============================================

    pub fn retire_credits(
        env: Env,
        holder: Address,
        batch_id: String,
        amount: i128,
        reason: String,
        beneficiary: String,
        retire_id: String,
        tx_hash: String,
        cert_cid: String,
    ) -> Result<RetirementCertificate, CarbonError> {
        holder.require_auth();
        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Retirement(retire_id.clone()))
        {
            return Err(CarbonError::SerialNumberConflict);
        }

        let mut batch = Self::load_batch(&env, &batch_id)?;

        if batch.status == CreditStatus::FullyRetired {
            return Err(CarbonError::AlreadyRetired);
        }
        if batch.status == CreditStatus::Suspended {
            return Err(CarbonError::ProjectSuspended);
        }
        // Enforce vintage expiry: credits older than MAX_VINTAGE_AGE_YEARS cannot be retired.
        if Self::is_batch_expired(&env, &batch) {
            return Err(CarbonError::InvalidVintageYear);
        }

        let active_amount = Self::active_amount(&env, &batch);
        if amount > active_amount {
            return Err(CarbonError::InsufficientCredits);
        }

        let already_retired: i128 = env
            .storage()
            .persistent()
            .get(&RetiredKey::BatchRetired(batch_id.clone()))
            .unwrap_or(0_i128);

        let already_retired_u64 =
            u64::try_from(already_retired).map_err(|_| CarbonError::Arithmetic)?;
        let retire_serial_start = batch
            .serial_start
            .checked_add(already_retired_u64)
            .ok_or(CarbonError::Arithmetic)?;
        let amount_u64 = u64::try_from(amount).map_err(|_| CarbonError::Arithmetic)?;
        let retire_serial_end = retire_serial_start
            .checked_add(amount_u64 - 1)
            .ok_or(CarbonError::Arithmetic)?;

        let mut serial_numbers: Vec<u64> = vec![&env];
        let mut s = retire_serial_start;
        while s <= retire_serial_end {
            serial_numbers.push_back(s);
            s += 1;
        }

        let new_retired = already_retired
            .checked_add(amount)
            .ok_or(CarbonError::Arithmetic)?;
        env.storage()
            .persistent()
            .set(&RetiredKey::BatchRetired(batch_id.clone()), &new_retired);

        let new_active = batch
            .amount
            .checked_sub(new_retired)
            .ok_or(CarbonError::Arithmetic)?;
        batch.status = if new_active == 0 {
            CreditStatus::FullyRetired
        } else {
            CreditStatus::PartiallyRetired
        };
        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id.clone()), &batch);
        Self::extend_batch_ttl(&env, &batch_id);

        let now = env.ledger().timestamp();
        let cert = RetirementCertificate {
            retirement_id: retire_id.clone(),
            credit_batch_id: batch_id.clone(),
            project_id: batch.project_id.clone(),
            amount,
            retired_by: holder.clone(),
            beneficiary: beneficiary.clone(),
            retirement_reason: reason.clone(),
            vintage_year: batch.vintage_year,
            serial_numbers: serial_numbers.clone(),
            retired_at: now,
            tx_hash: tx_hash.clone(),
            certificate_cid: cert_cid.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Retirement(retire_id.clone()), &cert);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("retired")),
            CreditRetiredEvent {
                retirement_id: retire_id.clone(),
                batch_id: batch_id.clone(),
                project_id: batch.project_id.clone(),
                amount,
                retired_by: holder.clone(),
                beneficiary: beneficiary.clone(),
                timestamp: now,
                certificate_cid: cert_cid.clone(),
            },
        );
        Ok(cert)
    }

    pub fn transfer_credits(
        env: Env,
        from: Address,
        to: Address,
        batch_id: String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        from.require_auth();
        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let mut batch = Self::load_batch(&env, &batch_id)?;

        if batch.owner != from {
            return Err(CarbonError::UnauthorizedVerifier);
        }

        if batch.status == CreditStatus::FullyRetired {
            return Err(CarbonError::AlreadyRetired);
        }
        if batch.status == CreditStatus::Suspended {
            return Err(CarbonError::ProjectSuspended);
        }

        // Enforce vintage expiry: credits older than MAX_VINTAGE_AGE_YEARS cannot be transferred.
        if Self::is_batch_expired(&env, &batch) {
            return Err(CarbonError::InvalidVintageYear);
        }

        let active = Self::active_amount(&env, &batch);
        if amount > active {
            return Err(CarbonError::InsufficientCredits);
        }

        batch.owner = to.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id.clone()), &batch);
        Self::extend_batch_ttl(&env, &batch_id);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("transfer")),
            (batch_id, from, to, amount),
        );
        Ok(())
    }

    pub fn get_credit_batch(env: Env, batch_id: String) -> Result<CreditBatch, CarbonError> {
        Self::load_batch(&env, &batch_id)
    }

    /// Returns the batch as a `CreditBatchView` with an additional `is_expired` field.
    /// This is a new read-only entry point; `get_credit_batch()` is unchanged.
    pub fn get_credit_batch_view(
        env: Env,
        batch_id: String,
    ) -> Result<CreditBatchView, CarbonError> {
        let batch = Self::load_batch(&env, &batch_id)?;
        let expired = Self::is_batch_expired(&env, &batch);
        Ok(CreditBatchView {
            batch_id: batch.batch_id,
            project_id: batch.project_id,
            vintage_year: batch.vintage_year,
            amount: batch.amount,
            serial_start: batch.serial_start,
            serial_end: batch.serial_end,
            issued_at: batch.issued_at,
            status: batch.status,
            metadata_cid: batch.metadata_cid,
            owner: batch.owner,
            is_expired: expired,
        })
    }

    pub fn get_retirement_certificate(
        env: Env,
        retirement_id: String,
    ) -> Result<RetirementCertificate, CarbonError> {
        env.storage()
            .persistent()
            .get(&DataKey::Retirement(retirement_id))
            .ok_or(CarbonError::ProjectNotFound)
    }

    /// Retirement is permanent; this entry point exists so clients can surface a clear error.
    pub fn undo_retire(env: Env, admin: Address, retire_id: String) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        if env
            .storage()
            .persistent()
            .has(&DataKey::Retirement(retire_id))
        {
            return Err(CarbonError::RetirementIrreversible);
        }
        Err(CarbonError::ProjectNotFound)
    }

    pub fn verify_serial_range(env: Env, serial_start: u64, serial_end: u64) -> bool {
        Self::verify_serial_range_internal(&env, serial_start, serial_end)
    }

    pub fn get_project_credits(env: Env, project_id: String) -> Vec<CreditBatch> {
        let batch_ids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ProjectBatches(project_id))
            .unwrap_or_else(|| vec![&env]);

        let mut result: Vec<CreditBatch> = vec![&env];
        for id in batch_ids.iter() {
            if let Some(b) = env.storage().persistent().get(&DataKey::Batch(id.clone())) {
                result.push_back(b);
            }
        }
        result
    }

    // ============================================
    // Helper Functions
    // ============================================

    fn extend_batch_ttl(env: &Env, batch_id: &String) {
        let key = DataKey::Batch(batch_id.clone());
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        }
    }

    fn load_batch(env: &Env, batch_id: &String) -> Result<CreditBatch, CarbonError> {
        let key = DataKey::Batch(batch_id.clone());
        let batch = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(CarbonError::ProjectNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        Ok(batch)
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

    fn active_amount(env: &Env, batch: &CreditBatch) -> i128 {
        if batch.status == CreditStatus::FullyRetired {
            return 0;
        }
        let retired: i128 = env
            .storage()
            .persistent()
            .get(&RetiredKey::BatchRetired(batch.batch_id.clone()))
            .unwrap_or(0i128);
        batch.amount.checked_sub(retired).unwrap_or(0)
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

    // Legacy XOR `verify_zk_proof_internal` stub was removed upstream.
    // Production Groth16 verification lives in `contracts/carbon_zk_verifier`
    // (Circom BLS12-381 / CAP-0059). See docs/zk-proof-spec.md.

    /// Whether `[start, end]` is clear of every serial range already issued.
    ///
    /// Delegates to the skip-list index in [`serial_index`], which locates the
    /// candidate's two neighbouring ranges in an expected `O(log N)` node reads
    /// — see that module's docs for the structure and why two neighbours are
    /// sufficient.
    ///
    /// Contracts upgraded from a pre-#887 version may still hold ranges in the
    /// legacy flat `SerialRegistry` map. Those are consulted as well until an
    /// admin has drained them with [`Self::migrate_serial_index`], so a legacy
    /// range cannot be re-issued while the migration is only partly done.
    fn verify_serial_range_internal(env: &Env, start: u64, end: u64) -> bool {
        serial_index::is_free(env, start, end) && serial_index::legacy_is_free(env, start, end)
    }

    // ============================================
    // Serial Index Administration (#887)
    // ============================================

    /// Move up to `limit` ranges from the legacy flat registry into the
    /// skip-list index, returning how many were moved.
    ///
    /// Only needed on contracts upgraded from a pre-#887 version. Call
    /// repeatedly until it returns `0`; each call is bounded by `limit` so the
    /// work fits inside a transaction budget no matter how large the legacy
    /// registry grew. Overlap checks stay correct throughout.
    pub fn migrate_serial_index(
        env: Env,
        admin: Address,
        limit: u32,
    ) -> Result<u32, CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;
        if limit == 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }
        Ok(serial_index::migrate(&env, limit))
    }

    /// Number of serial ranges held in the skip-list index.
    pub fn serial_index_size(env: Env) -> u32 {
        serial_index::len(&env)
    }

    /// Number of serial ranges still awaiting migration out of the legacy flat
    /// registry. `0` means overlap checks are fully sub-linear.
    pub fn serial_index_pending_migration(env: Env) -> u32 {
        serial_index::legacy_pending(&env)
    }
}

// ── Sub-linear serial-range index (Issue #887) ───────────────────────────────
// Skip-list over serial_start, one ledger entry per node, replacing the flat
// Map<u64, u64> whose read/write cost grew with the number of minted batches.
pub mod serial_index;

// ── Invariant tests ───────────────────────────────────────────────────────────
#[cfg(test)]
mod invariants;

// ── Conservation law invariant helpers and tests (Issue #633) ─────────────────
// Reusable assertion helpers for verifying the credit supply conservation law:
//   total_minted == credits_active + credits_retired
// Import conservation::* in any test module to use the helpers.
#[cfg(test)]
mod conservation;

// ── Conservation invariant test suite (Issue #633) ───────────────────────────
// Dedicated test suite that calls conservation assertions after every
// mint_credits, transfer_credits, and retire_credits call.
#[cfg(test)]
mod conservation_invariant_tests;

// ── Property-based fuzz tests for serial allocation invariants ───────────────
// Uses the proptest crate to generate thousands of randomized serial ranges
// and verify pairwise-disjointness, overflow safety, and supply conservation.
#[cfg(test)]
mod serial_fuzz_tests;

// ── Kani formal verification proofs ──────────────────────────────────────────
// Compiled only by the Kani model checker toolchain (cfg(kani)).
// Zero impact on production binary or regular test runs.
mod proofs;

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };
    extern crate std;
    use std::format;

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup(env: &Env) -> (CarbonCreditContractClient, Address, Address) {
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
        let registry = Address::generate(env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(env, &id);
        client.initialize(&admin, &registry);
        (client, admin, registry)
    }

    fn init(env: &Env) -> (CarbonCreditContractClient, Address) {
        let (client, admin, _) = setup(env);
        (client, admin)
    }

    fn mint(
        env: &Env,
        client: &CarbonCreditContractClient,
        admin: &Address,
        batch_id: &str,
        owner: &Address,
    ) {
        client.mint_credits(
            admin,
            &s(env, "proj-001"),
            &100_i128,
            &2023_u32,
            &s(env, batch_id),
            &1_u64,
            &100_u64,
            &s(env, "QmCID"),
            owner,
        );
    }

    fn mint_batch(
        env: &Env,
        client: &CarbonCreditContractClient,
        admin: &Address,
        owner: &Address,
    ) {
        client.mint_credits(
            admin,
            &s(env, "proj-001"),
            &1000_i128,
            &2023_u32,
            &s(env, "batch-001"),
            &1_u64,
            &1000_u64,
            &s(env, "QmCID"),
            owner,
        );
    }

    #[test]
    fn test_transfer_from_owner_succeeds() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let buyer = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        client.transfer_credits(&owner, &buyer, &s(&env, "batch-001"), &100_i128);

        let batch = client.get_credit_batch(&s(&env, "batch-001"));
        assert_eq!(batch.owner, buyer);
    }

    #[test]
    fn test_transfer_from_non_owner_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let attacker = Address::generate(&env);
        let victim = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        let result =
            client.try_transfer_credits(&attacker, &victim, &s(&env, "batch-001"), &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_admin_cannot_bypass_transfer_authorization() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let to = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        let result = client.try_transfer_credits(&admin, &to, &s(&env, "batch-001"), &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_transfer_updates_owner() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let new_owner = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        client.transfer_credits(&owner, &new_owner, &s(&env, "batch-001"), &500_i128);

        let third = Address::generate(&env);
        client.transfer_credits(&new_owner, &third, &s(&env, "batch-001"), &200_i128);
        let result = client.try_transfer_credits(&owner, &third, &s(&env, "batch-001"), &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_credits_success() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(
            &admin,
            &s(&env, "proj-002"),
            &500_i128,
            &2023_u32,
            &s(&env, "batch-A"),
            &1_u64,
            &500_u64,
            &s(&env, "QmCID"),
            &owner,
        );

        let b = client.get_credit_batch(&s(&env, "batch-A"));
        assert_eq!(b.amount, 500);
        assert_eq!(b.status, CreditStatus::Active);
        assert_eq!(b.owner, owner);
    }

    #[test]
    fn test_serial_conflict_detection() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
        let result = client.try_mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b2"),
            &50_u64,
            &150_u64,
            &s(&env, "cid"),
            &owner,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_serial_start_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        let result = client.try_mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &0_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InvalidSerialRange
        );
    }

    #[test]
    fn test_minting_past_project_batch_cap_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        // Minting MAX_BATCHES_PER_PROJECT (10,000) batches in one Env would
        // exceed the default metered CPU budget long before reaching the cap
        // this test is actually exercising; disable metering for this test.
        env.budget().reset_unlimited();

        for index in 0..MAX_BATCHES_PER_PROJECT {
            let batch_id = format!("batch-{index}");
            let serial_start = (index as u64) * 1000 + 1;
            let serial_end = serial_start + 99;
            client.mint_credits(
                &admin,
                &s(&env, "proj-001"),
                &100_i128,
                &2023_u32,
                &String::from_str(&env, &batch_id),
                &serial_start,
                &serial_end,
                &s(&env, "cid"),
                &owner,
            );
        }

        let result = client.try_mint_credits(
            &admin,
            &s(&env, "proj-001"),
            &100_i128,
            &2023_u32,
            &s(&env, "batch-over-cap"),
            &(MAX_BATCHES_PER_PROJECT as u64 * 1000 + 1),
            &(MAX_BATCHES_PER_PROJECT as u64 * 1000 + 100),
            &s(&env, "cid"),
            &owner,
        );
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::StorageLimitExceeded);
    }

    #[test]
    fn test_verify_serial_range_no_overlap() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
        assert!(client.verify_serial_range(&101_u64, &200_u64));
        assert!(!client.verify_serial_range(&50_u64, &150_u64));
    }

    #[test]
    fn test_retire_credits_permanent() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );

        let cert = client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &100_i128,
            &s(&env, "offset 2023 emissions"),
            &s(&env, "Acme Corp"),
            &s(&env, "ret-001"),
            &s(&env, "txhash123"),
            &s(&env, "QmCertificateCID"),
        );

        assert_eq!(cert.amount, 100);
        let batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(batch.status, CreditStatus::FullyRetired);
    }

    #[test]
    fn test_retired_credits_cannot_be_transferred() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
        client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &100_i128,
            &s(&env, "reason"),
            &s(&env, "Corp"),
            &s(&env, "ret-001"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );

        let to = Address::generate(&env);
        let result = client.try_transfer_credits(&owner, &to, &s(&env, "b1"), &10_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_retired_credits_cannot_be_retired_again() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
        client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &100_i128,
            &s(&env, "reason"),
            &s(&env, "Corp"),
            &s(&env, "ret-001"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );

        let result = client.try_retire_credits(
            &owner,
            &s(&env, "b1"),
            &100_i128,
            &s(&env, "reason"),
            &s(&env, "Corp"),
            &s(&env, "ret-002"),
            &s(&env, "tx2"),
            &s(&env, "QmCID2"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_partial_retirement_updates_status() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        client.retire_credits(
            &owner,
            &s(&env, "batch-001"),
            &500_i128,
            &s(&env, "partial"),
            &s(&env, "me"),
            &s(&env, "ret-001"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );
        let batch = client.get_credit_batch(&s(&env, "batch-001"));
        assert_eq!(batch.status, CreditStatus::PartiallyRetired);
    }

    #[test]
    fn test_vintage_year_boundary_1989_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        let result = client.try_mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &1989_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InvalidVintageYear
        );
    }

    #[test]
    fn test_vintage_year_boundary_1990_succeeds() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1767225600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &1990_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
    }

    #[test]
    fn test_vintage_year_boundary_current_plus_1_succeeds() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1767225600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2027_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
    }

    #[test]
    fn test_vintage_year_boundary_current_plus_2_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1767225600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });

        let result = client.try_mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2028_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InvalidVintageYear
        );
    }

    #[test]
    fn test_upgrade_admin_only() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let registry = Address::generate(&env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(&env, &id);
        client.initialize(&admin, &registry);

        let attacker = Address::generate(&env);
        let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
        let result = client.try_upgrade_contract(&attacker, &fake_hash);
        assert!(result.is_err());
    }

    #[test]
    fn test_version_tracking() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let registry = Address::generate(&env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(&env, &id);
        client.initialize(&admin, &registry);

        assert_eq!(client.get_version(), 1);
    }

    // ── Retirement Irreversibility Tests ──────────────────────────────────────

    #[test]
    fn test_retirement_reversal_always_fails() {
        let env = Env::default();
        let (client, admin) = init(&env);
        let owner = Address::generate(&env);

        // Mint and retire credits
        mint(&env, &client, &admin, "b1", &owner);
        client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &100_i128,
            &s(&env, "offset"),
            &s(&env, "Corp"),
            &s(&env, "ret-001"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );

        // Attempt to reverse the retirement - must fail
        let result = client.try_undo_retire(&admin, &s(&env, "ret-001"));
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::RetirementIrreversible
        );
    }

    #[test]
    fn test_admin_cannot_reverse_retirement() {
        let env = Env::default();
        let (client, admin) = init(&env);
        let owner = Address::generate(&env);

        // Mint and retire credits
        mint(&env, &client, &admin, "b1", &owner);
        client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &50_i128,
            &s(&env, "offset"),
            &s(&env, "Corp"),
            &s(&env, "ret-002"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );

        // Even admin cannot reverse retirement
        let result = client.try_undo_retire(&admin, &s(&env, "ret-002"));
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::RetirementIrreversible
        );

        // Verify retirement certificate still exists and is unchanged
        let cert = client.get_retirement_certificate(&s(&env, "ret-002"));
        assert_eq!(cert.amount, 50);
        assert_eq!(cert.retirement_id, s(&env, "ret-002"));
    }

    #[test]
    fn test_retired_serial_numbers_permanently_flagged() {
        let env = Env::default();
        let (client, admin) = init(&env);
        let owner = Address::generate(&env);

        // Mint batch with serials 1-100
        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
            &owner,
        );

        // Retire 50 credits (serials 1-50)
        let cert = client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &50_i128,
            &s(&env, "offset"),
            &s(&env, "Corp"),
            &s(&env, "ret-003"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );

        // Verify serial numbers are recorded in certificate
        assert_eq!(cert.serial_numbers.len(), 50);
        assert_eq!(cert.serial_numbers.get(0).unwrap(), 1);
        assert_eq!(cert.serial_numbers.get(49).unwrap(), 50);

        // Verify batch status reflects retirement
        let batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(batch.status, CreditStatus::PartiallyRetired);

        // Attempt to mint new batch with overlapping serials - should fail
        let result = client.try_mint_credits(
            &admin,
            &s(&env, "p2"),
            &50_i128,
            &2023_u32,
            &s(&env, "b2"),
            &25_u64,
            &75_u64,
            &s(&env, "cid2"),
            &owner,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_retirement_certificate_immutable() {
        let env = Env::default();
        let (client, admin) = init(&env);
        let owner = Address::generate(&env);

        // Mint and retire
        mint(&env, &client, &admin, "b1", &owner);
        let original_cert = client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &100_i128,
            &s(&env, "offset"),
            &s(&env, "Corp"),
            &s(&env, "ret-004"),
            &s(&env, "tx123"),
            &s(&env, "QmCID"),
        );

        // Attempt reversal
        let _ = client.try_undo_retire(&admin, &s(&env, "ret-004"));

        // Verify certificate is unchanged
        let cert = client.get_retirement_certificate(&s(&env, "ret-004"));
        assert_eq!(cert.retirement_id, original_cert.retirement_id);
        assert_eq!(cert.amount, original_cert.amount);
        assert_eq!(cert.retired_by, original_cert.retired_by);
        assert_eq!(cert.tx_hash, original_cert.tx_hash);
        assert_eq!(cert.serial_numbers.len(), 100);
    }

    #[test]
    fn test_no_code_path_can_undo_retirement() {
        let env = Env::default();
        let (client, admin) = init(&env);
        let owner = Address::generate(&env);

        // Mint 1000 credits
        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &1000_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &1000_u64,
            &s(&env, "cid"),
            &owner,
        );

        // Retire 600 credits
        client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &600_i128,
            &s(&env, "offset"),
            &s(&env, "Corp"),
            &s(&env, "ret-005"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );

        // Verify batch state
        let batch_after_retirement = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(
            batch_after_retirement.status,
            CreditStatus::PartiallyRetired
        );
        assert_eq!(batch_after_retirement.amount, 1000); // Total amount unchanged

        // Attempt reversal
        let _ = client.try_undo_retire(&admin, &s(&env, "ret-005"));

        // Verify batch state is still the same - no change
        let batch_after_reversal_attempt = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(
            batch_after_reversal_attempt.status,
            CreditStatus::PartiallyRetired
        );
        assert_eq!(batch_after_reversal_attempt.amount, 1000);

        // Verify only 400 credits remain active (1000 - 600)
        // Attempting to retire more than 400 should fail
        let result = client.try_retire_credits(
            &owner,
            &s(&env, "b1"),
            &500_i128,
            &s(&env, "offset2"),
            &s(&env, "Corp"),
            &s(&env, "ret-006"),
            &s(&env, "tx2"),
            &s(&env, "QmCID2"),
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InsufficientCredits
        );

        // Retiring exactly 400 should succeed
        client.retire_credits(
            &owner,
            &s(&env, "b1"),
            &400_i128,
            &s(&env, "offset3"),
            &s(&env, "Corp"),
            &s(&env, "ret-007"),
            &s(&env, "tx3"),
            &s(&env, "QmCID3"),
        );

        // Now batch should be fully retired
        let final_batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(final_batch.status, CreditStatus::FullyRetired);
    }

    // ── Mutation-testing survivor kills (issue #632) ──────────────────────────
    //
    // Targeted tests for boundary conditions and status branches identified as
    // likely mutation survivors during manual mutation analysis of
    // retire_credits, transfer_credits, verify_serial_range and mint_credits.
    // See audit/mutation-testing-report.md for the full analysis.

    /// Kills mutation of `batch.status == CreditStatus::Suspended` (condition
    /// removed / flipped) in `retire_credits`. A Suspended batch can only be
    /// reached by writing storage directly since no public entry point sets
    /// this status on carbon_credit; we simulate it to exercise the guard.
    #[test]
    fn test_retire_suspended_batch_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        env.as_contract(&client.address, || {
            let mut batch: CreditBatch = env
                .storage()
                .persistent()
                .get(&DataKey::Batch(s(&env, "batch-001")))
                .unwrap();
            batch.status = CreditStatus::Suspended;
            env.storage()
                .persistent()
                .set(&DataKey::Batch(s(&env, "batch-001")), &batch);
        });

        let result = client.try_retire_credits(
            &owner,
            &s(&env, "batch-001"),
            &100_i128,
            &s(&env, "reason"),
            &s(&env, "Corp"),
            &s(&env, "ret-susp"),
            &s(&env, "tx"),
            &s(&env, "QmCID"),
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::ProjectSuspended
        );
    }

    /// Kills mutation of the same Suspended guard in `transfer_credits`.
    #[test]
    fn test_transfer_suspended_batch_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let to = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        env.as_contract(&client.address, || {
            let mut batch: CreditBatch = env
                .storage()
                .persistent()
                .get(&DataKey::Batch(s(&env, "batch-001")))
                .unwrap();
            batch.status = CreditStatus::Suspended;
            env.storage()
                .persistent()
                .set(&DataKey::Batch(s(&env, "batch-001")), &batch);
        });

        let result = client.try_transfer_credits(&owner, &to, &s(&env, "batch-001"), &100_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::ProjectSuspended
        );
    }

    /// Kills mutation of `amount > active` -> `amount >= active` in
    /// `transfer_credits`: transferring more than active must fail, and
    /// transferring exactly the active amount must succeed.
    #[test]
    fn test_transfer_exceeds_active_amount_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let to = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        let result = client.try_transfer_credits(&owner, &to, &s(&env, "batch-001"), &1001_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InsufficientCredits
        );
    }

    #[test]
    fn test_transfer_exact_active_amount_succeeds() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let to = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        client.transfer_credits(&owner, &to, &s(&env, "batch-001"), &1000_i128);
        let batch = client.get_credit_batch(&s(&env, "batch-001"));
        assert_eq!(batch.owner, to);
    }

    /// Kills mutation of `amount > MAX_BATCH_SIZE` -> `amount >= MAX_BATCH_SIZE`
    /// in `mint_credits`: minting exactly MAX_BATCH_SIZE must succeed, and
    /// minting one more than MAX_BATCH_SIZE must fail with BatchTooLarge.
    #[test]
    fn test_mint_exact_max_batch_size_succeeds() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &MAX_BATCH_SIZE,
            &2023_u32,
            &s(&env, "b-max"),
            &1_u64,
            &(MAX_BATCH_SIZE as u64),
            &s(&env, "QmCID"),
            &owner,
        );
        let b = client.get_credit_batch(&s(&env, "b-max"));
        assert_eq!(b.amount, MAX_BATCH_SIZE);
    }

    #[test]
    fn test_mint_over_max_batch_size_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        let over = MAX_BATCH_SIZE + 1;
        let result = client.try_mint_credits(
            &admin,
            &s(&env, "p1"),
            &over,
            &2023_u32,
            &s(&env, "b-over"),
            &1_u64,
            &(over as u64),
            &s(&env, "QmCID"),
            &owner,
        );
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::BatchTooLarge);
    }

    /// Kills mutation of the overlap condition `start <= r.end && end >= r.start`
    /// in `verify_serial_range_internal`: a range that shares exactly one serial
    /// number with an existing range (touching, not merely adjacent) must be
    /// detected as an overlap.
    #[test]
    fn test_serial_range_single_serial_overlap_detected() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(
            &admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &101_u64,
            &200_u64,
            &s(&env, "cid"),
            &owner,
        );
        // [50,101] shares serial 101 with [101,200] — this IS an overlap.
        assert!(!client.verify_serial_range(&50_u64, &101_u64));
        // [201, 300] is strictly adjacent with no shared serial — not an overlap.
        assert!(client.verify_serial_range(&201_u64, &300_u64));
    }

    // ── Vintage Expiry Tests (#649) ───────────────────────────────────────────
    // seconds_per_year = 31_557_600
    // year 2024 timestamp = (2024-1970) * 31_557_600 = 1_703_983_200 (approx)
    // At year 2024: vintage 1993 → age 31 → EXPIRED, vintage 1994 → age 30 → VALID

    fn set_year(env: &Env, year: u32) {
        let ts = (year as u64 - 1970) * 31_557_600_u64;
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: ts,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0u8; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518_400,
        });
    }

    fn mint_with_vintage(
        env: &Env,
        client: &CarbonCreditContractClient,
        admin: &Address,
        owner: &Address,
        batch_id: &str,
        vintage_year: u32,
        serial_start: u64,
    ) {
        let serial_end = serial_start + 99;
        client.mint_credits(
            admin,
            &s(env, "proj-vintage"),
            &100_i128,
            &vintage_year,
            &s(env, batch_id),
            &serial_start,
            &serial_end,
            &s(env, "QmCID"),
            owner,
        );
    }

    #[test]
    fn test_transfer_expired_batch_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let buyer = Address::generate(&env);
        set_year(&env, 2024);
        mint_with_vintage(&env, &client, &admin, &owner, "b-exp-31", 1993, 1);
        let result = client.try_transfer_credits(&owner, &buyer, &s(&env, "b-exp-31"), &10_i128);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
    }

    #[test]
    fn test_retire_expired_batch_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        set_year(&env, 2024);
        mint_with_vintage(&env, &client, &admin, &owner, "b-ret-exp", 1993, 101);
        let result = client.try_retire_credits(
            &owner, &s(&env, "b-ret-exp"), &10_i128,
            &s(&env, "reason"), &s(&env, "Corp"),
            &s(&env, "ret-exp-1"), &s(&env, "tx"), &s(&env, "QmCID"),
        );
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
    }

    #[test]
    fn test_transfer_age_30_succeeds() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let buyer = Address::generate(&env);
        set_year(&env, 2024);
        mint_with_vintage(&env, &client, &admin, &owner, "b-age-30", 1994, 201);
        // age = 2024 - 1994 = 30 → valid
        client.transfer_credits(&owner, &buyer, &s(&env, "b-age-30"), &10_i128);
        let batch = client.get_credit_batch(&s(&env, "b-age-30"));
        assert_eq!(batch.owner, buyer);
    }

    #[test]
    fn test_retire_age_30_succeeds() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        set_year(&env, 2024);
        mint_with_vintage(&env, &client, &admin, &owner, "b-ret-30", 1994, 301);
        let cert = client.retire_credits(
            &owner, &s(&env, "b-ret-30"), &10_i128,
            &s(&env, "reason"), &s(&env, "Corp"),
            &s(&env, "ret-30"), &s(&env, "tx"), &s(&env, "QmCID"),
        );
        assert_eq!(cert.amount, 10);
    }

    #[test]
    fn test_current_year_credits_valid() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let buyer = Address::generate(&env);
        set_year(&env, 2024);
        mint_with_vintage(&env, &client, &admin, &owner, "b-current", 2024, 401);
        client.transfer_credits(&owner, &buyer, &s(&env, "b-current"), &5_i128);
        client.transfer_credits(&buyer, &owner, &s(&env, "b-current"), &5_i128);
        let cert = client.retire_credits(
            &owner, &s(&env, "b-current"), &5_i128,
            &s(&env, "reason"), &s(&env, "Corp"),
            &s(&env, "ret-current"), &s(&env, "tx"), &s(&env, "QmCID"),
        );
        assert_eq!(cert.amount, 5);
    }

    #[test]
    fn test_get_credit_batch_view_expired() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        set_year(&env, 2024);
        mint_with_vintage(&env, &client, &admin, &owner, "b-view-exp", 1993, 501);
        let view = client.get_credit_batch_view(&s(&env, "b-view-exp"));
        assert!(view.is_expired);
    }

    #[test]
    fn test_get_credit_batch_view_not_expired() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        set_year(&env, 2024);
        mint_with_vintage(&env, &client, &admin, &owner, "b-view-ok", 1994, 601);
        let view = client.get_credit_batch_view(&s(&env, "b-view-ok"));
        assert!(!view.is_expired);
    }
}

// ── PR #655 — Property-based fuzz tests: 4 core invariants ────────────────────
//
//   P1 – Conservation:     sum(batch.amount) >= sum(retired amounts)
//   P2 – Double-counting:  overlapping serial ranges are rejected
//   P3 – Idempotency:      retiring more than active credits always fails
//   P4 – Zero-rejection:   zero-amount mint/retire/transfer always fails
//
// Each property is tested with 10,000 proptest iterations.
#[cfg(test)]
mod proptest_invariant_tests {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Env, String};

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonCreditContractClient, Address) {
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
        let admin    = Address::generate(env);
        let registry = Address::generate(env);
        let id       = env.register_contract(None, CarbonCreditContract);
        let client   = CarbonCreditContractClient::new(env, &id);
        client.initialize(&admin, &registry);
        (client, admin)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        /// P1 – Conservation: minting `amount` credits and retiring `r` (where
        /// r <= amount) always satisfies total_issued >= total_retired.
        #[test]
        fn prop_mint_retire_conservation(
            amount in 10i128..=1_000i128,
            retire_frac in 0u32..=100u32,
        ) {
            let env = Env::default();
            let (client, admin) = setup(&env);
            let owner = Address::generate(&env);

            let retire_amount = amount * retire_frac as i128 / 100;
            prop_assume!(retire_amount >= 1, "retire amount must be >= 1");
            prop_assume!(retire_amount <= amount, "retire cannot exceed mint");

            let serial_end = amount as u64;
            let r = client.try_mint_credits(
                &admin, &s(&env, "p1"), &amount, &2023_u32,
                &s(&env, "b1"), &1_u64, &serial_end,
                &s(&env, "QmCID"), &owner,
            );
            prop_assume!(r.is_ok(), "mint must succeed");

            let batch = client.get_credit_batch(&s(&env, "b1"));
            let issued = batch.amount;

            let retire_result = client.try_retire_credits(
                &owner, &s(&env, "b1"), &retire_amount,
                &s(&env, "reason"), &s(&env, "Corp"),
                &s(&env, "ret-1"), &s(&env, "tx"), &s(&env, "QmCID"),
            );
            if retire_result.is_ok() {
                // Conservation: issued >= retired
                prop_assert!(issued >= retire_amount,
                    "P1 violated: issued={issued} < retired={retire_amount}");
            }
        }

        /// P2 – Double-counting: minting two batches with overlapping serial
        /// ranges always fails for the second batch.
        #[test]
        fn prop_overlapping_serial_rejected(
            start1 in 1u64..=500u64,
            width1 in 1u64..=200u64,
            overlap_offset in 0u64..=100u64,
            width2 in 1u64..=100u64,
        ) {
            let end1 = start1 + width1;
            let start2 = start1 + overlap_offset;
            let end2 = start2 + width2;
            prop_assume!(start2 <= end1, "must be genuine overlap");

            let env = Env::default();
            let (client, admin) = setup(&env);
            let owner = Address::generate(&env);

            let r1 = client.try_mint_credits(
                &admin, &s(&env, "p1"), &(width1 as i128 + 1), &2023_u32,
                &s(&env, "b1"), &start1, &end1,
                &s(&env, "QmCID"), &owner,
            );
            prop_assume!(r1.is_ok());

            let r2 = client.try_mint_credits(
                &admin, &s(&env, "p2"), &(width2 as i128 + 1), &2023_u32,
                &s(&env, "b2"), &start2, &end2,
                &s(&env, "QmCID"), &Address::generate(&env),
            );
            prop_assert_eq!(
                r2.unwrap_err().unwrap(),
                CarbonError::DoubleCountingDetected,
                "P2 violated: overlapping range [{},{}] over [{},{}] was not rejected",
                start2, end2, start1, end1
            );
        }

        /// P3 – Idempotency: after retiring `r` credits from a batch,
        /// attempting to retire more than the remaining active credits fails.
        #[test]
        fn prop_retire_overretire_fails(
            total in 100i128..=1_000i128,
            first_retire_frac in 10u32..=90u32,
        ) {
            let first_retire = total * first_retire_frac as i128 / 100;
            prop_assume!(first_retire >= 1 && first_retire < total);

            let env = Env::default();
            let (client, admin) = setup(&env);
            let owner = Address::generate(&env);

            let r = client.try_mint_credits(
                &admin, &s(&env, "p1"), &total, &2023_u32,
                &s(&env, "b1"), &1_u64, &(total as u64),
                &s(&env, "QmCID"), &owner,
            );
            prop_assume!(r.is_ok());

            let retire1 = client.try_retire_credits(
                &owner, &s(&env, "b1"), &first_retire,
                &s(&env, "reason"), &s(&env, "Corp"),
                &s(&env, "ret-1"), &s(&env, "tx"), &s(&env, "QmCID"),
            );
            prop_assume!(retire1.is_ok());

            let remaining = total - first_retire;
            let overretire = remaining + 1;

            let retire2 = client.try_retire_credits(
                &owner, &s(&env, "b1"), &overretire,
                &s(&env, "reason"), &s(&env, "Corp"),
                &s(&env, "ret-2"), &s(&env, "tx2"), &s(&env, "QmCID2"),
            );
            prop_assert!(retire2.is_err(),
                "P3 violated: retiring {overretire} from {remaining} remaining credits should fail");
        }

        /// P4 – Zero-rejection: zero-amount operations (mint, retire, transfer)
        /// always produce errors regardless of input parameters.
        #[test]
        fn prop_zero_amount_always_rejected(
            serial_start in 1u64..=1000u64,
            width in 1u64..=100u64,
        ) {
            let env = Env::default();
            let (client, admin) = setup(&env);
            let owner = Address::generate(&env);

            // Zero-amount mint must fail
            let mint_result = client.try_mint_credits(
                &admin, &s(&env, "p1"), &0_i128, &2023_u32,
                &s(&env, "b-zero"), &serial_start, &(serial_start + width),
                &s(&env, "QmCID"), &owner,
            );
            prop_assert!(mint_result.is_err(),
                "P4 violated: zero-amount mint must be rejected");

            // Mint a valid batch, then zero-amount retire must fail
            let r = client.try_mint_credits(
                &admin, &s(&env, "p2"), &(width as i128 + 1), &2023_u32,
                &s(&env, "b1"), &serial_start, &(serial_start + width),
                &s(&env, "QmCID"), &owner,
            );
            prop_assume!(r.is_ok());

            let retire_result = client.try_retire_credits(
                &owner, &s(&env, "b1"), &0_i128,
                &s(&env, "reason"), &s(&env, "Corp"),
                &s(&env, "ret-zero"), &s(&env, "tx"), &s(&env, "QmCID"),
            );
            prop_assert!(retire_result.is_err(),
                "P4 violated: zero-amount retire must be rejected");

            // Zero-amount transfer must fail
            let to = Address::generate(&env);
            let transfer_result = client.try_transfer_credits(
                &owner, &to, &s(&env, "b1"), &0_i128,
            );
            prop_assert!(transfer_result.is_err(),
                "P4 violated: zero-amount transfer must be rejected");
        }
    }
}

// ── PR #650 — Serial registry O(log n) Map: property-based fuzz tests ────────
#[cfg(test)]
mod serial_registry_proptest_tests {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Env, String};

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonCreditContractClient, Address) {
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
        let admin    = Address::generate(env);
        let registry = Address::generate(env);
        let id       = env.register_contract(None, CarbonCreditContract);
        let client   = CarbonCreditContractClient::new(env, &id);
        client.initialize(&admin, &registry);
        (client, admin)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(5_000))]

        /// SR1 – Non-overlapping ranges are accepted.
        #[test]
        fn sr1_non_overlapping_ranges_accepted(
            start1 in 1u64..=500_000u64,
            width1 in 1u64..=10_000u64,
            gap    in 1u64..=10_000u64,
            width2 in 1u64..=10_000u64,
        ) {
            let end1   = start1.saturating_add(width1);
            let start2 = end1.saturating_add(gap);
            let end2   = start2.saturating_add(width2);
            prop_assume!(end2 > start2 && start2 > end1);

            let env = Env::default();
            let (client, admin) = setup(&env);
            let owner = Address::generate(&env);

            let r1 = client.try_mint_credits(
                &admin, &s(&env, "p1"), &(width1 as i128 + 1), &2023_u32,
                &s(&env, "b1"), &start1, &end1, &s(&env, "QmCID"), &owner,
            );
            prop_assume!(r1.is_ok());

            prop_assert!(client.verify_serial_range(&start2, &end2),
                "SR1: non-overlapping range must be accepted");

            let r2 = client.try_mint_credits(
                &admin, &s(&env, "p2"), &(width2 as i128 + 1), &2023_u32,
                &s(&env, "b2"), &start2, &end2, &s(&env, "QmCID"), &Address::generate(&env),
            );
            prop_assert!(r2.is_ok(), "SR1: minting non-overlapping range must succeed");
        }

        /// SR2 – Overlapping ranges are rejected.
        #[test]
        fn sr2_overlapping_ranges_rejected(
            start1 in 1u64..=500_000u64,
            width1 in 10u64..=10_000u64,
            overlap_offset in 0u64..=9u64,
            width2 in 1u64..=1_000u64,
        ) {
            let end1   = start1.saturating_add(width1);
            let start2 = start1.saturating_add(overlap_offset);
            let end2   = start2.saturating_add(width2);
            prop_assume!(start2 <= end1 && start2 >= 1 && end2 > start2);

            let env = Env::default();
            let (client, admin) = setup(&env);
            let owner = Address::generate(&env);

            let r1 = client.try_mint_credits(
                &admin, &s(&env, "p1"), &(width1 as i128 + 1), &2023_u32,
                &s(&env, "b1"), &start1, &end1, &s(&env, "QmCID"), &owner,
            );
            prop_assume!(r1.is_ok());

            prop_assert!(!client.verify_serial_range(&start2, &end2),
                "SR2: overlapping range must be rejected");

            let r2 = client.try_mint_credits(
                &admin, &s(&env, "p2"), &(width2 as i128 + 1), &2023_u32,
                &s(&env, "b2"), &start2, &end2, &s(&env, "QmCID"), &Address::generate(&env),
            );
            prop_assert_eq!(r2.unwrap_err().unwrap(), CarbonError::DoubleCountingDetected,
                "SR2: overlapping mint must return DoubleCountingDetected");
        }

        /// SR3 – Multiple valid ranges build up correctly.
        #[test]
        fn sr3_random_valid_ranges_build_up(
            a_start in 1u64..=100_000u64,
            a_width in 1u64..=5_000u64,
            gap_ab  in 1u64..=1_000u64,
            b_width in 1u64..=5_000u64,
            gap_bc  in 1u64..=1_000u64,
            c_width in 1u64..=5_000u64,
        ) {
            let a_end   = a_start.saturating_add(a_width);
            let b_start = a_end.saturating_add(gap_ab);
            let b_end   = b_start.saturating_add(b_width);
            let c_start = b_end.saturating_add(gap_bc);
            let c_end   = c_start.saturating_add(c_width);
            prop_assume!(b_start > a_end && c_start > b_end);

            let env = Env::default();
            let (client, admin) = setup(&env);
            let owner = Address::generate(&env);

            let ra = client.try_mint_credits(&admin, &s(&env,"p1"), &(a_width as i128+1), &2023_u32,
                &s(&env,"bA"), &a_start, &a_end, &s(&env,"Q"), &owner);
            prop_assume!(ra.is_ok());
            let rb = client.try_mint_credits(&admin, &s(&env,"p2"), &(b_width as i128+1), &2023_u32,
                &s(&env,"bB"), &b_start, &b_end, &s(&env,"Q"), &owner);
            prop_assume!(rb.is_ok());
            let rc = client.try_mint_credits(&admin, &s(&env,"p3"), &(c_width as i128+1), &2023_u32,
                &s(&env,"bC"), &c_start, &c_end, &s(&env,"Q"), &owner);
            prop_assert!(rc.is_ok(), "SR3: third non-overlapping batch must succeed");

            prop_assert!(!client.verify_serial_range(&b_start, &b_end),
                "SR3: range identical to B must be rejected");
            prop_assert!(!client.verify_serial_range(&a_start, &c_end),
                "SR3: range spanning all batches must be rejected");

            let after = c_end.saturating_add(1);
            prop_assume!(after > c_end);
            prop_assert!(client.verify_serial_range(&after, &(after + 100)),
                "SR3: range after all batches must be accepted");
        }

        /// SR4 – Boundary conditions (adjacent ranges, exact same range).
        #[test]
        fn sr4_boundary_conditions(
            base in 2u64..=500_000u64,
            width in 1u64..=1_000u64,
        ) {
            let range_end = base.saturating_add(width);
            prop_assume!(range_end > base);

            let env = Env::default();
            let (client, admin) = setup(&env);
            let owner = Address::generate(&env);

            let r = client.try_mint_credits(&admin, &s(&env,"p1"), &(width as i128+1), &2023_u32,
                &s(&env,"b1"), &base, &range_end, &s(&env,"Q"), &owner);
            prop_assume!(r.is_ok());

            // Adjacent range immediately after must be accepted
            if range_end < u64::MAX - 1 {
                prop_assert!(client.verify_serial_range(&(range_end+1), &(range_end+2)),
                    "SR4: adjacent range after must be accepted");
            }

            // Range entirely before must be accepted
            if base > 2 {
                prop_assert!(client.verify_serial_range(&1, &(base-1)),
                    "SR4: range before must be accepted");
            }

            // Exact same range must be rejected
            prop_assert!(!client.verify_serial_range(&base, &range_end),
                "SR4: exact same range must be rejected");
        }
    }
}

// ── Issue #650 — CPU instruction benchmark ─────────────────────────────────────
//
// Measures the Soroban CPU-instruction cost of `mint_credits` (which performs
// the serial-range overlap check on every call) as the registry grows, using
// the SDK's test budget meter. Run with:
//
//   cargo test -p carbon_credit --lib bench_serial_registry_growth -- --nocapture
//
// Before #887 the registry lived in a single `Map<u64, u64>` ledger entry, so
// even with a binary search over its keys every mint paid to deserialise and
// rewrite the whole entry — cost grew with the registry. The skip-list index in
// `serial_index` gives each range its own small entry, so a mint now touches an
// expected O(log N) of them.
//
// Note that the metered figures this prints overstate write cost as the
// registry grows: the test host charges a storage write in proportion to its
// entire in-memory storage map, which on-chain holds only the transaction
// footprint. `serial_index`'s own tests assert on ledger-entry counts instead,
// which are exact — see `serial_index_tests::insert_cost_stays_bounded_past_a_thousand_ranges`.
#[cfg(test)]
mod serial_benchmark {
    use super::*;
    extern crate std;
    use std::{format, println};
    use soroban_sdk::testutils::{Address as _, Ledger as _};

    fn setup(env: &Env) -> (CarbonCreditContractClient, Address) {
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
        let registry = Address::generate(env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(env, &id);
        client.initialize(&admin, &registry);
        (client, admin)
    }

    #[test]
    fn bench_serial_registry_growth() {
        let env = Env::default();
        let (client, admin) = setup(&env);

        let checkpoints: [u64; 4] = [10, 50, 100, 250];
        let mut cursor: u64 = 1;
        let mut checkpoint_idx = 0usize;

        for i in 0..*checkpoints.last().unwrap() {
            let start = cursor;
            let end = start + 5;
            cursor = end + 2;

            let is_checkpoint =
                checkpoint_idx < checkpoints.len() && i + 1 == checkpoints[checkpoint_idx];
            // Reset before every mint so each call is measured in isolation —
            // the budget otherwise accumulates cost across the whole Env and
            // would eventually hit the default CPU limit.
            env.budget().reset_default();

            client.mint_credits(
                &admin,
                &String::from_str(&env, "p"),
                &6_i128,
                &2023_u32,
                &String::from_str(&env, &format!("b{i}")),
                &start,
                &end,
                &String::from_str(&env, "QmCID"),
                &Address::generate(&env),
            );

            if is_checkpoint {
                println!(
                    "[bench] mint_credits at registry size {:>4}: {} CPU instructions",
                    i + 1,
                    env.budget().cpu_instruction_cost()
                );
                checkpoint_idx += 1;
            }
        }
    }
}
