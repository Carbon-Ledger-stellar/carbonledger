#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec, Map,
    symbol_short, vec,
};

// ── Error Enum ────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CarbonError {
    ProjectNotFound       = 1,
    ProjectNotVerified    = 2,
    ProjectSuspended      = 3,
    InsufficientCredits   = 4,
    AlreadyRetired        = 5,
    SerialNumberConflict  = 6,
    UnauthorizedVerifier  = 7,
    UnauthorizedOracle    = 8,
    InvalidVintageYear    = 9,
    ListingNotFound       = 10,
    InsufficientLiquidity = 11,
    PriceNotSet           = 12,
    MonitoringDataStale   = 13,
    DoubleCountingDetected = 14,
    RetirementIrreversible = 15,
    ZeroAmountNotAllowed  = 16,
    ProjectAlreadyExists  = 17,
    InvalidSerialRange    = 18,
    UnauthorizedUpgrade   = 19, // New error for v2
    Arithmetic            = 20,
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Project(String),
    Verifiers,
    OracleAddress,
    RegistryAdmin,
    ContractVersion,      // New for v2
    UpgradeHistory,       // New for v2
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProjectStatus {
    Pending,
    Verified,
    Rejected,
    Suspended,
    Completed,
    Certified,            // New status for v2
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CarbonProject {
    pub project_id:            String,
    pub name:                  String,
    pub methodology:           String,
    pub country:               String,
    pub project_type:          String,
    pub verifier_address:      Address,
    pub metadata_cid:          String,
    pub total_credits_issued:  i128,
    pub total_credits_retired: i128,
    pub status:                ProjectStatus,
    pub vintage_year:          u32,
    pub created_at:            u64,
    pub certification_date:    Option<u64>, // New field for v2
    pub credit_score:          u32,         // New field for v2
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeRecord {
    pub from_version: u32,
    pub to_version:   u32,
    pub timestamp:    u64,
    pub upgraded_by:  Address,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct CarbonRegistryContractV2;

#[contractimpl]
impl CarbonRegistryContractV2 {

    /// Initialise the registry with an admin, oracle address, and initial verifier set.
    /// V2: Sets version to 2
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle_address: Address,
        verifiers: Vec<Address>,
    ) {
        admin.require_auth();
        env.storage().persistent().set(&DataKey::RegistryAdmin, &admin);
        env.storage().persistent().set(&DataKey::OracleAddress, &oracle_address);
        env.storage().persistent().set(&DataKey::Verifiers, &verifiers);
        env.storage().persistent().set(&DataKey::ContractVersion, &2_u32);
    }

    /// Upgrade from v1 to v2 - only admin can call this
    pub fn upgrade_from_v1(
        env: Env,
        admin: Address,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        // Check if already upgraded
        if let Some(version) = env.storage().persistent().get::<DataKey, u32>(&DataKey::ContractVersion) {
            if version >= 2 {
                return Err(CarbonError::UnauthorizedUpgrade);
            }
        }

        // Set version to 2
        env.storage().persistent().set(&DataKey::ContractVersion, &2_u32);

        // Record upgrade
        let upgrade_record = UpgradeRecord {
            from_version: 1,
            to_version:   2,
            timestamp:    env.ledger().timestamp(),
            upgraded_by:  admin.clone(),
        };
        env.storage().persistent().set(&DataKey::UpgradeHistory, &upgrade_record);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("upgraded")),
            (1_u32, 2_u32, admin),
        );
        Ok(())
    }

    /// Register a new carbon offset project. V2: includes new fields.
    pub fn register_project(
        env: Env,
        admin: Address,
        project_id: String,
        name: String,
        metadata_cid: String,
        verifier_address: Address,
        methodology: String,
        country: String,
        project_type: String,
        vintage_year: u32,
    ) -> Result<(), CarbonError> {
        // ── checks ────────────────────────────────────────────────────────────
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        if env.storage().persistent().has(&DataKey::Project(project_id.clone())) {
            return Err(CarbonError::ProjectAlreadyExists);
        }
        
        // Enforce vintage year range: 1990 to current_year + 1
        let current_year = Self::get_current_year(&env);
        if vintage_year < 1990 || vintage_year > current_year + 1 {
            return Err(CarbonError::InvalidVintageYear);
        }

        // ── effects ───────────────────────────────────────────────────────────
        let project = CarbonProject {
            project_id:            project_id.clone(),
            name:                  name.clone(),
            methodology:           methodology.clone(),
            country:               country.clone(),
            project_type:          project_type.clone(),
            verifier_address:      verifier_address.clone(),
            metadata_cid:          metadata_cid.clone(),
            total_credits_issued:  0,
            total_credits_retired: 0,
            status:                ProjectStatus::Pending,
            vintage_year,
            created_at:            env.ledger().timestamp(),
            certification_date:    None,
            credit_score:          0,
        };
        env.storage().persistent().set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("reg_proj")),
            (project_id, methodology, country, vintage_year),
        );
        Ok(())
    }

    /// Approve a pending project for credit issuance.
    pub fn verify_project(
        env: Env,
        verifier_address: Address,
        project_id: String,
    ) -> Result<(), CarbonError> {
        // ── checks ────────────────────────────────────────────────────────────
        verifier_address.require_auth();
        Self::require_verifier(&env, &verifier_address)?;

        let mut project = Self::load_project(&env, &project_id)?;

        // ── effects ───────────────────────────────────────────────────────────
        project.status = ProjectStatus::Verified;
        env.storage().persistent().set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("verified")),
            (project_id, verifier_address),
        );
        Ok(())
    }

    /// NEW V2 FUNCTION: Certify a verified project
    pub fn certify_project(
        env: Env,
        admin: Address,
        project_id: String,
        credit_score: u32,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        if credit_score > 100 {
            return Err(CarbonError::InvalidSerialRange); // Reuse error for invalid score
        }

        let mut project = Self::load_project(&env, &project_id)?;
        
        if project.status != ProjectStatus::Verified {
            return Err(CarbonError::ProjectNotVerified);
        }

        project.status = ProjectStatus::Certified;
        project.certification_date = Some(env.ledger().timestamp());
        project.credit_score = credit_score;
        
        env.storage().persistent().set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("certified")),
            (project_id, credit_score),
        );
        Ok(())
    }

    /// Retire credits for a project (v2 implementation - same as v1)
    pub fn retire_credits(
        env: Env,
        admin: Address,
        project_id: String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let mut project = Self::load_project(&env, &project_id)?;
        
        if project.total_credits_retired + amount > project.total_credits_issued {
            return Err(CarbonError::InsufficientCredits);
        }

        project.total_credits_retired = project.total_credits_retired.checked_add(amount).ok_or(CarbonError::Arithmetic)?;
        env.storage().persistent().set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("retired")),
            (project_id, amount),
        );
        Ok(())
    }

    /// NEW V2 FUNCTION: Get contract version
    pub fn get_version(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::ContractVersion)
            .unwrap_or(1) // Default to v1 for backward compatibility
    }

    /// NEW V2 FUNCTION: Get upgrade history
    pub fn get_upgrade_history(env: Env) -> Option<UpgradeRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::UpgradeHistory)
    }

    /// Returns the full [`CarbonProject`] record.
    pub fn get_project(env: Env, project_id: String) -> Result<CarbonProject, CarbonError> {
        Self::load_project(&env, &project_id)
    }

    /// Increment the issued credit counter for a project.
    pub fn increment_issued(
        env: Env,
        oracle_address: Address,
        project_id: String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        oracle_address.require_auth();
        Self::require_oracle(&env, &oracle_address)?;
        let mut project = Self::load_project(&env, &project_id)?;
        project.total_credits_issued = project.total_credits_issued.checked_add(amount).ok_or(CarbonError::Arithmetic)?;
        env.storage().persistent().set(&DataKey::Project(project_id), &project);
        Ok(())
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn load_project(env: &Env, project_id: &String) -> Result<CarbonProject, CarbonError> {
        let project: Option<CarbonProject> = env.storage()
            .persistent()
            .get(&DataKey::Project(project_id.clone()));
        
        match project {
            Some(p) => Ok(p),
            None => {
                // Try to load as v1 project for migration
                Self::migrate_v1_project(env, project_id)
            }
        }
    }

    fn migrate_v1_project(env: &Env, project_id: &String) -> Result<CarbonProject, CarbonError> {
        // This would handle migration from v1 storage format
        // For simplicity, we'll return an error if project not found in v2 format
        Err(CarbonError::ProjectNotFound)
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), CarbonError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::RegistryAdmin)
            .ok_or(CarbonError::UnauthorizedVerifier)?;
        if &admin != caller {
            return Err(CarbonError::UnauthorizedVerifier);
        }
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

    fn require_verifier(env: &Env, caller: &Address) -> Result<(), CarbonError> {
        let verifiers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Verifiers)
            .unwrap_or_else(|| vec![env]);
        if !verifiers.contains(caller) {
            return Err(CarbonError::UnauthorizedVerifier);
        }
        Ok(())
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
}
