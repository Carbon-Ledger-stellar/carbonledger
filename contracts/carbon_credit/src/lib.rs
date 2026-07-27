#![no_std]
extern crate alloc;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Symbol, symbol_short, vec, Bytes, BytesN, Vec, IntoVal,
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

const TTL_LEDGERS: u32 = 518_400;
/// Earliest valid vintage year for carbon credits.
pub const VINTAGE_YEAR_MIN: u32 = 1990;
/// Minimum methodology score required for minting credits
pub const METHODOLOGY_SCORE_MIN: u32 = 70;
/// Maximum number of years a vintage may be aged before it is considered expired
/// and credits become ineligible for transfer or retirement.
pub const MAX_VINTAGE_AGE_YEARS: u32 = 30;
const CURRENT_VERSION: u32 = 1;

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
    BatchTooLarge         = 19,
    AlreadyInitialized     = 20,
    Arithmetic             = 21,
    UnauthorizedUpgrade    = 22,
    /// Cross-contract invariant violation: total issued credits would exceed
    /// the oracle-verified tonnes for this project.
    IssuanceExceedsVerified = 23,
    InvalidZkProofFormat    = 24,
    ZkProofVerificationFailed = 25,
    /// Methodology score too low (error code 26)
    MethodologyScoreLow = 26,
}

pub const MAX_BATCH_SIZE: i128 = 1_000_000_000;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Batch(String),
    Retirement(String),
    ProjectBatches(String),
    SerialRegistry,
    Admin,
    RegistryContract,
    ContractVersion,
    UpgradeHistory,
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
    pub batch_id:     String,
    pub project_id:   String,
    pub vintage_year: u32,
    pub amount:       i128,
    pub serial_start: u64,
    pub serial_end:   u64,
    pub issued_at:    u64,
    pub status:       CreditStatus,
    pub metadata_cid: String,
    pub owner:        Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RetirementCertificate {
    pub retirement_id:    String,
    pub credit_batch_id:  String,
    pub project_id:       String,
    pub amount:           i128,
    pub retired_by:       Address,
    pub beneficiary:      String,
    pub retirement_reason: String,
    pub vintage_year:     u32,
    pub serial_numbers:   Vec<u64>,
    pub retired_at:       u64,
    pub tx_hash:          String,
    pub certificate_cid:  String,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SerialRange {
    pub start: u64,
    pub end:   u64,
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZkProof {
    pub commitment: Bytes,
    pub salt: Bytes,
    pub proof: Bytes,
}

#[contract]
pub struct CarbonCreditContract;

#[contractimpl]
impl CarbonCreditContract {
    // ============================================
    # Initialize
    // ============================================

    pub fn initialize(env: Env, admin: Address, registry_contract: Address) -> Result<(), CarbonError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::RegistryContract, &registry_contract);
        let ranges: Vec<SerialRange> = vec![&env];
        env.storage().persistent().set(&DataKey::SerialRegistry, &ranges);
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
            (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "upgraded")),
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

    pub fn set_oracle_contract(
        env: Env,
        admin: Address,
        oracle: Address,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
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
        env.storage().persistent().set(&DataKey::VerifiedPeriods(project_id.clone()), &periods);
        env.events().publish(
            (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "per_set")),
            (project_id, periods.len()),
        );
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

    fn validate_vintage_year(env: &Env, vintage_year: u32) -> Result<(), CarbonError> {
        let current_year = Self::current_year(env);
        if vintage_year < VINTAGE_YEAR_MIN || vintage_year > current_year + 1 {
            return Err(CarbonError::InvalidVintageYear);
        }
        Ok(())
    }

    fn validate_batch_not_expired(env: &Env, vintage_year: u32) -> Result<(), CarbonError> {
        let current_year = Self::current_year(env);
        if vintage_year + MAX_VINTAGE_AGE_YEARS < current_year {
            return Err(CarbonError::InvalidVintageYear);
        }
        Ok(())
    }

    // ============================================
    # Mint Credits
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

        // ============================================
        # Methodology Score Threshold Enforcement
        // ============================================

        // Get registry address
        let registry_address = env.storage()
            .persistent()
            .get(&DataKey::RegistryContract)
            .ok_or(CarbonError::ProjectNotFound)?;

        // Cross-contract call to registry to get project info
        // This is a placeholder - actual implementation depends on registry contract
        let project = Self::get_project_from_registry(&env, &registry_address, &project_id)?;

        // Enforce methodology score threshold
        if project.methodology_score < METHODOLOGY_SCORE_MIN {
            return Err(CarbonError::MethodologyScoreLow);
        }

        // ============================================
        # Existing mint validation
        // ============================================

        if project_id.len() == 0 || project_id.len() > 64 {
            return Err(CarbonError::ProjectNotFound);
        }
        if batch_id.len() == 0 || batch_id.len() > 64 {
            return Err(CarbonError::ProjectNotFound);
        }
        if metadata_cid.len() == 0 || metadata_cid.len() > 128 {
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

        require_valid_vintage_year!(&env, vintage_year);

        if env.storage().persistent().has(&DataKey::Batch(batch_id.clone())) {
            return Err(CarbonError::SerialNumberConflict);
        }

        if !Self::verify_serial_range_internal(&env, serial_start, serial_end) {
            return Err(CarbonError::DoubleCountingDetected);
        }

        if let Some(oracle_addr) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::OracleContract)
        {
            let periods: Vec<String> = env
                .storage()
                .persistent()
                .get(&DataKey::VerifiedPeriods(project_id.clone()))
                .unwrap_or_else(|| vec![&env]);

            let total_verified: i128 = env.invoke_contract(
                &oracle_addr,
                &Symbol::new(&env, "get_total_verified_tonnes"),
                vec![
                    &env,
                    project_id.clone().into_val(&env),
                    periods.into_val(&env),
                ],
            );

            let already_issued: i128 = {
                let batch_ids: Vec<String> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::ProjectBatches(project_id.clone()))
                    .unwrap_or_else(|| vec![&env]);
                let mut sum: i128 = 0;
                for bid in batch_ids.iter() {
                    if let Some(b) = env.storage().persistent().get::<DataKey, CreditBatch>(
                        &DataKey::Batch(bid.clone()),
                    ) {
                        sum = sum.saturating_add(b.amount);
                    }
                }
                sum
            };

            let total_after_mint = already_issued.checked_add(amount).ok_or(CarbonError::Arithmetic)?;

            if total_after_mint > total_verified {
                env.events().publish(
                    (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "overissu")),
                    (project_id.clone(), total_after_mint, total_verified),
                );
                return Err(CarbonError::IssuanceExceedsVerified);
            }
        }

        let mut ranges: Vec<SerialRange> = env
            .storage()
            .persistent()
            .get(&DataKey::SerialRegistry)
            .unwrap_or_else(|| vec![&env]);
        ranges.push_back(SerialRange { start: serial_start, end: serial_end });
        env.storage().persistent().set(&DataKey::SerialRegistry, &ranges);

        let batch = CreditBatch {
            batch_id:     batch_id.clone(),
            project_id:   project_id.clone(),
            vintage_year,
            amount,
            serial_start,
            serial_end,
            issued_at:    env.ledger().timestamp(),
            status:       CreditStatus::Active,
            metadata_cid: metadata_cid.clone(),
            owner:        initial_owner.clone(),
        };
        env.storage().persistent().set(&DataKey::Batch(batch_id.clone()), &batch);
        Self::extend_batch_ttl(&env, &batch_id);

        Self::add_user_batch(&env, &initial_owner, &batch_id);

        let mut total_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        total_supply = total_supply.checked_add(amount).ok_or(CarbonError::Arithmetic)?;
        env.storage().instance().set(&DataKey::TotalSupply, &total_supply);

        let mut project_batches: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ProjectBatches(project_id.clone()))
            .unwrap_or_else(|| vec![&env]);
        project_batches.push_back(batch_id.clone());
        env.storage().persistent().set(&DataKey::ProjectBatches(project_id.clone()), &project_batches);

        env.events().publish(
            (Symbol::new(&env, "c_ledger"), Symbol::new(&env, "minted")),
            CreditRetiredEvent {
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
    # Get Project from Registry
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
    # Retirement and Transfer Functions
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
        Self::retire_credits_internal(&env, &holder, &batch_id, amount, &reason, &beneficiary, &retire_id, &tx_hash, &cert_cid)
    }

    fn retire_credits_internal(
        env: &Env,
        holder: &Address,
        batch_id: &String,
        amount: i128,
        reason: &String,
        beneficiary: &String,
        retire_id: &String,
        tx_hash: &String,
        cert_cid: &String,
    ) -> Result<RetirementCertificate, CarbonError> {
        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let mut batch = Self::load_batch(env, batch_id)?;

        if batch.status == CreditStatus::FullyRetired {
            return Err(CarbonError::AlreadyRetired);
        }
        if batch.status == CreditStatus::Suspended {
            return Err(CarbonError::ProjectSuspended);
        }
        require_batch_not_expired!(env, batch.vintage_year);

        let active_amount = Self::active_amount(env, &batch);
        if amount > active_amount {
            return Err(CarbonError::InsufficientCredits);
        }

        let already_retired: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id.clone()))
            .map(|b: CreditBatch| b.amount - batch.amount)
            .unwrap_or(0);

        let already_retired_u64 = u64::try_from(already_retired).map_err(|_| CarbonError::Arithmetic)?;
        let retire_serial_start = batch.serial_start.checked_add(already_retired_u64).ok_or(CarbonError::Arithmetic)?;
        let amount_u64 = u64::try_from(amount).map_err(|_| CarbonError::Arithmetic)?;
        let retire_serial_end   = retire_serial_start.checked_add(amount_u64 - 1).ok_or(CarbonError::Arithmetic)?;

        let mut serial_numbers: Vec<u64> = vec![env];
        let mut s = retire_serial_start;
        while s <= retire_serial_end {
            serial_numbers.push_back(s);
            s += 1;
        }

        let new_retired = already_retired.checked_add(amount).ok_or(CarbonError::Arithmetic)?;
        batch.amount = batch.amount.checked_sub(amount).ok_or(CarbonError::Arithmetic)?;
        batch.status = if batch.amount == 0 {
            Self::remove_user_batch(env, holder, batch_id);
            CreditStatus::FullyRetired
        } else {
            CreditStatus::PartiallyRetired
        };
        env.storage().persistent().set(&DataKey::Batch(batch_id.clone()), &batch);
        Self::extend_batch_ttl(env, batch_id);

        let mut total_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        total_supply = total_supply.checked_sub(amount).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &total_supply);

        let cert = RetirementCertificate {
            retirement_id:     retire_id.clone(),
            credit_batch_id:   batch_id.clone(),
            project_id:        batch.project_id.clone(),
            amount,
            retired_by:        holder.clone(),
            beneficiary:       beneficiary.clone(),
            retirement_reason: reason.clone(),
            vintage_year:      batch.vintage_year,
            serial_numbers:    serial_numbers.clone(),
            retired_at:        env.ledger().timestamp(),
            tx_hash:           tx_hash.clone(),
            certificate_cid:   cert_cid.clone(),
        };
        env.storage().persistent().set(&DataKey::Retirement(retire_id.clone()), &cert);

        env.events().publish(
            (Symbol::new(env, "c_ledger"), Symbol::new(env, "retired")),
            CreditRetiredEvent {
                retirement_id: retire_id.clone(),
                batch_id: batch_id.clone(),
                project_id: batch.project_id.clone(),
                amount,
                retired_by: holder.clone(),
                beneficiary: beneficiary.clone(),
                timestamp: env.ledger().timestamp(),
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
        Self::transfer_credits_internal(&env, &from, &to, &batch_id, amount)
    }

    fn transfer_credits_internal(
        env: &Env,
        from: &Address,
        to: &Address,
        batch_id: &String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let mut batch = Self::load_batch(env, batch_id)?;

        if batch.owner != *from {
            return Err(CarbonError::UnauthorizedVerifier);
        }

        if batch.status == CreditStatus::FullyRetired {
            return Err(CarbonError::AlreadyRetired);
        }
        if batch.status == CreditStatus::Suspended {
            return Err(CarbonError::ProjectSuspended);
        }
        require_batch_not_expired!(env, batch.vintage_year);

        let active = Self::active_amount(env, &batch);
        if amount > active {
            return Err(CarbonError::InsufficientCredits);
        }

        if amount == active {
            batch.owner = to.clone();
            env.storage().persistent().set(&DataKey::Batch(batch_id.clone()), &batch);
            Self::extend_batch_ttl(env, batch_id);
            Self::remove_user_batch(env, from, batch_id);
            Self::add_user_batch(env, to, batch_id);
        } else {
            let split_amount_u64 = u64::try_from(amount).map_err(|_| CarbonError::Arithmetic)?;
            let new_serial_start = batch.serial_end - split_amount_u64 + 1;
            let new_serial_end = batch.serial_end;
            
            let new_batch_id = Self::generate_split_batch_id(env);

            let new_batch = CreditBatch {
                batch_id: new_batch_id.clone(),
                project_id: batch.project_id.clone(),
                vintage_year: batch.vintage_year,
                amount: amount,
                serial_start: new_serial_start,
                serial_end: new_serial_end,
                issued_at: batch.issued_at,
                status: CreditStatus::Active,
                metadata_cid: batch.metadata_cid.clone(),
                owner: to.clone(),
            };

            batch.amount = batch.amount.checked_sub(amount).ok_or(CarbonError::Arithmetic)?;
            batch.serial_end = batch.serial_end.checked_sub(split_amount_u64).ok_or(CarbonError::Arithmetic)?;
            
            env.storage().persistent().set(&DataKey::Batch(batch_id.clone()), &batch);
            env.storage().persistent().set(&DataKey::Batch(new_batch_id.clone()), &new_batch);
            Self::extend_batch_ttl(env, batch_id);
            Self::extend_batch_ttl(env, &new_batch_id);
            
            Self::add_user_batch(env, to, &new_batch_id);
            let mut project_batches: Vec<String> = env
                .storage()
                .persistent()
                .get(&DataKey::ProjectBatches(batch.project_id.clone()))
                .unwrap_or_else(|| vec![env]);
            project_batches.push_back(new_batch_id.clone());
            env.storage().persistent().set(&DataKey::ProjectBatches(batch.project_id.clone()), &project_batches);
        }

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("transfer")),
            (batch_id.clone(), from.clone(), to.clone(), amount),
        );
        Ok(())
    }

    pub fn get_credit_batch(env: Env, batch_id: String) -> Result<CreditBatch, CarbonError> {
        Self::load_batch(&env, &batch_id)
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
    # Helper Functions
    // ============================================

    fn extend_batch_ttl(env: &Env, batch_id: &String) {
        let key = DataKey::Batch(batch_id.clone());
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        }
    }

    fn add_user_batch(env: &Env, user: &Address, batch_id: &String) {
        let mut batches: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::UserBatches(user.clone()))
            .unwrap_or_else(|| vec![env]);
        batches.push_back(batch_id.clone());
        env.storage().persistent().set(&DataKey::UserBatches(user.clone()), &batches);
    }

    fn remove_user_batch(env: &Env, user: &Address, batch_id: &String) {
        let mut batches: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::UserBatches(user.clone()))
            .unwrap_or_else(|| vec![env]);
        if let Some(idx) = batches.first_index_of(batch_id.clone()) {
            batches.remove(idx);
            env.storage().persistent().set(&DataKey::UserBatches(user.clone()), &batches);
        }
    }

    fn get_and_increment_nonce(env: &Env) -> u32 {
        let key = soroban_sdk::symbol_short!("nonce");
        let mut nonce: u32 = env.storage().instance().get(&key).unwrap_or(0);
        nonce += 1;
        env.storage().instance().set(&key, &nonce);
        nonce
    }

    fn generate_split_batch_id(env: &Env) -> String {
        let ts = env.ledger().timestamp();
        let nonce = Self::get_and_increment_nonce(env);
        let mut buf = soroban_sdk::Bytes::new(env);
        for i in 0..8 {
            buf.push_back((ts >> ((7 - i) * 8)) as u8);
        }
        for i in 0..4 {
            buf.push_back((nonce >> ((3 - i) * 8)) as u8);
        }
        let hash = env.crypto().sha256(&buf);
        
        let mut hex_str = alloc::string::String::new();
        let chars = b"0123456789abcdef";
        for b in hash.to_array().iter() {
            hex_str.push(chars[(*b >> 4) as usize] as char);
            hex_str.push(chars[(*b & 0x0f) as usize] as char);
        }
        String::from_str(env, &hex_str)
    }

    fn load_batch(env: &Env, batch_id: &String) -> Result<CreditBatch, CarbonError> {
        let key = DataKey::Batch(batch_id.clone());
        let batch = env.storage()
            .persistent()
            .get(&key)
            .ok_or(CarbonError::ProjectNotFound)?;
        env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
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
        // Calculate active amount from serial registry
        let ranges: Vec<SerialRange> = env
            .storage()
            .persistent()
            .get(&DataKey::SerialRegistry)
            .unwrap_or_else(|| vec![env]);
        
        let mut active = 0;
        for range in ranges.iter() {
            if range.start >= batch.serial_start && range.end <= batch.serial_end {
                active += (range.end - range.start + 1) as i128;
            }
        }
        active
    }

    fn verify_serial_range_internal(env: &Env, start: u64, end: u64) -> bool {
        let ranges: Vec<SerialRange> = env
            .storage()
            .persistent()
            .get(&DataKey::SerialRegistry)
            .unwrap_or_else(|| vec![env]);

        for r in ranges.iter() {
            if start <= r.end && end >= r.start {
                return false;
            }
        }
        true
    }

    pub fn get_methodology_score_min(env: Env) -> u32 {
        METHODOLOGY_SCORE_MIN
    }
}

// ============================================
# SEP-0041 Token Interface
// ============================================

#[cfg(feature = "sep-0041")]
#[contractimpl]
impl CarbonCreditContract {
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Allowance(from, spender)).unwrap_or(0)
    }

    pub fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("Negative amount not allowed");
        }
        env.storage().persistent().set(&DataKey::Allowance(from.clone(), spender.clone()), &amount);
        let key = DataKey::Allowance(from, spender);
        let current_ledger = env.ledger().sequence();
        if expiration_ledger > current_ledger {
            env.storage().persistent().extend_ttl(&key, expiration_ledger - current_ledger, expiration_ledger - current_ledger);
        }
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        let batches: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::UserBatches(id))
            .unwrap_or_else(|| vec![&env]);
        
        let mut total: i128 = 0;
        for batch_id in batches.iter() {
            if let Ok(b) = Self::load_batch(&env, &batch_id) {
                if b.status == CreditStatus::Active || b.status == CreditStatus::PartiallyRetired {
                    if Self::validate_batch_not_expired(&env, b.vintage_year).is_ok() {
                        total += Self::active_amount(&env, &b);
                    }
                }
            }
        }
        total
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::do_transfer(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        let mut allowance: i128 = env.storage().persistent().get(&DataKey::Allowance(from.clone(), spender.clone())).unwrap_or(0);
        if allowance < amount {
            panic!("Insufficient allowance");
        }
        allowance -= amount;
        env.storage().persistent().set(&DataKey::Allowance(from.clone(), spender.clone()), &allowance);
        
        Self::do_transfer(&env, &from, &to, amount);
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::do_burn(&env, &from, amount);
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        let mut allowance: i128 = env.storage().persistent().get(&DataKey::Allowance(from.clone(), spender.clone())).unwrap_or(0);
        if allowance < amount {
            panic!("Insufficient allowance");
        }
        allowance -= amount;
        env.storage().persistent().set(&DataKey::Allowance(from.clone(), spender.clone()), &