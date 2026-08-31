#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, BytesN, Env,
    String, Vec,
};

// ── Error Enum ────────────────────────────────────────────────────────────────

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
    MethodologyScoreLow = 20,
    UnauthorizedUpgrade = 21,
    PageSizeTooLarge = 22,
    Arithmetic = 23,
    ProposalNotFound = 24,
    ProposalExpired = 25,
    DuplicateApproval = 26,
    ThresholdNotMet = 27,
    StorageLimitExceeded = 28,
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Project(String),
    ProjectCount(Address),
    Verifiers,
    OracleAddress,
    RegistryAdmin,
    ContractVersion,
    UpgradeHistory,
    MultiSigConfig,
    PendingUpgrade,
    ProposalCounter,
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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CarbonProject {
    pub project_id: String,
    pub name: String,
    pub methodology: String,
    pub country: String,
    pub project_type: String,
    pub verifier_address: Address,
    pub metadata_cid: String,
    pub total_credits_issued: i128,
    pub total_credits_retired: i128,
    pub methodology_score: u32,
    pub status: ProjectStatus,
    pub vintage_year: u32,
    pub created_at: u64,
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

/// Multi-signer configuration for contract upgrades.
/// Once set, upgrade proposals require `threshold` approvals from `signers`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultiSigConfig {
    pub signers: Vec<Address>,
    pub threshold: u32,
}

/// A pending upgrade proposal waiting for approvals.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeProposal {
    pub proposal_id: u32,
    pub wasm_hash: BytesN<32>,
    /// Ledger sequence number after which this proposal expires.
    pub expiry_ledger: u32,
    pub approvals: Vec<Address>,
    pub executed: bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

const CURRENT_VERSION: u32 = 1;
/// Default maximum number of upgrade history entries retained.
pub const DEFAULT_MAX_HISTORY_ENTRIES: u32 = 50;
/// Minimum allowed value for max_history_entries.
pub const MIN_HISTORY_ENTRIES: u32 = 10;
/// Maximum allowed value for max_history_entries.
pub const MAX_HISTORY_ENTRIES_LIMIT: u32 = 200;
/// Maximum number of projects a single admin can register before storage caps kick in.
pub const MAX_PROJECTS_PER_ADMIN: u32 = 1_000;

#[contract]
pub struct CarbonRegistryContract;

#[contractimpl]
impl CarbonRegistryContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle_address: Address,
        verifiers: Vec<Address>,
    ) -> Result<(), CarbonError> {
        if env.storage().persistent().has(&DataKey::RegistryAdmin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::RegistryAdmin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::OracleAddress, &oracle_address);
        env.storage()
            .persistent()
            .set(&DataKey::Verifiers, &verifiers);
        env.storage()
            .persistent()
            .set(&DataKey::ContractVersion, &CURRENT_VERSION);
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

        let mut history: Vec<UpgradeRecord> = env.storage()
            .persistent()
            .get(&DataKey::UpgradeHistory)
            .unwrap_or_else(|| vec![&env]);
        history.push_back(record);

        let max_entries: u32 = env.storage()
            .persistent()
            .get(&DataKey::MaxHistoryEntries)
            .unwrap_or(DEFAULT_MAX_HISTORY_ENTRIES);
        let max = max_entries as usize;

        if history.len() > max {
            let excess = (history.len() - max) as u32;
            while history.len() > max {
                history.remove(0);
            }
            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("hist_prune")),
                HistoryPrunedEvent {
                    entries_pruned: excess,
                    remaining:      history.len() as u32,
                    pruned_at:      env.ledger().timestamp(),
                },
            );
        }

        env.storage().persistent().set(&DataKey::UpgradeHistory, &history);
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
        let max = clamped as usize;

        if history.len() > max {
            let excess = (history.len() - max) as u32;
            while history.len() > max {
                history.remove(0);
            }
            env.storage().persistent().set(&DataKey::UpgradeHistory, &history);
            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("hist_prune")),
                HistoryPrunedEvent {
                    entries_pruned: excess,
                    remaining:      history.len() as u32,
                    pruned_at:      env.ledger().timestamp(),
                },
            );
        }

        Ok(())
    }

    // ── MultiSig Upgrade Functions (#648) ────────────────────────────────────

    /// Configure multi-sig upgrade policy. Admin must already be initialized.
    /// `threshold` must be >= 1 and <= signers.len().
    pub fn initialize_multisig(
        env: Env,
        admin: Address,
        signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        if threshold == 0 || threshold as usize > signers.len() as usize {
            return Err(CarbonError::UnauthorizedUpgrade);
        }

        let config = MultiSigConfig { signers, threshold };
        env.storage()
            .persistent()
            .set(&DataKey::MultiSigConfig, &config);
        Ok(())
    }

    /// Propose a new WASM upgrade. Only callable by a registered signer.
    /// Returns the proposal_id.
    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        wasm_hash: BytesN<32>,
    ) -> Result<u32, CarbonError> {
        proposer.require_auth();
        Self::require_multisig_signer(&env, &proposer)?;

        let proposal_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0u32)
            + 1;
        env.storage()
            .persistent()
            .set(&DataKey::ProposalCounter, &proposal_id);

        // Proposal expires after 518400 ledgers (~72 hours at ~5s/ledger)
        let expiry_ledger = env
            .ledger()
            .sequence()
            .saturating_add(518_400);

        let mut initial_approvals: Vec<Address> = vec![&env];
        initial_approvals.push_back(proposer.clone());

        let proposal = UpgradeProposal {
            proposal_id,
            wasm_hash: wasm_hash.clone(),
            expiry_ledger,
            approvals: initial_approvals,
            executed: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::PendingUpgrade, &proposal);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("upg_prop")),
            (proposal_id, proposer, wasm_hash),
        );
        Ok(proposal_id)
    }

    /// Approve a pending upgrade proposal. Executes when approvals reach threshold.
    pub fn approve_upgrade(
        env: Env,
        approver: Address,
        proposal_id: u32,
    ) -> Result<(), CarbonError> {
        approver.require_auth();
        Self::require_multisig_signer(&env, &approver)?;

        let mut proposal: UpgradeProposal = env
            .storage()
            .persistent()
            .get(&DataKey::PendingUpgrade)
            .ok_or(CarbonError::ProposalNotFound)?;

        if proposal.proposal_id != proposal_id {
            return Err(CarbonError::ProposalNotFound);
        }
        if proposal.executed {
            return Err(CarbonError::ProposalNotFound);
        }
        if env.ledger().sequence() > proposal.expiry_ledger {
            return Err(CarbonError::ProposalExpired);
        }
        if proposal.approvals.contains(&approver) {
            return Err(CarbonError::DuplicateApproval);
        }

        proposal.approvals.push_back(approver.clone());

        let config: MultiSigConfig = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSigConfig)
            .ok_or(CarbonError::UnauthorizedUpgrade)?;

        if proposal.approvals.len() as u32 >= config.threshold {
            // Execute the upgrade
            proposal.executed = true;
            env.storage()
                .persistent()
                .set(&DataKey::PendingUpgrade, &proposal);

            let current_version: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::ContractVersion)
                .unwrap_or(1);
            env.deployer()
                .update_current_contract_wasm(proposal.wasm_hash.clone());

            let next_version = current_version + 1;
            env.storage()
                .persistent()
                .set(&DataKey::ContractVersion, &next_version);

            let record = UpgradeRecord {
                from_version: current_version,
                to_version: next_version,
                timestamp: env.ledger().timestamp(),
                upgraded_by: approver.clone(),
                wasm_hash: proposal.wasm_hash.clone(),
            };
            env.storage()
                .persistent()
                .set(&DataKey::UpgradeHistory, &record);

            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("upgraded")),
                (current_version, next_version, approver, proposal_id),
            );
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::PendingUpgrade, &proposal);

            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("upg_appr")),
                (proposal_id, approver, proposal.approvals.len()),
            );
        }

        Ok(())
    }

    /// Cancel a pending upgrade proposal. Only callable by a registered signer.
    pub fn cancel_upgrade(
        env: Env,
        canceller: Address,
        proposal_id: u32,
    ) -> Result<(), CarbonError> {
        canceller.require_auth();
        Self::require_multisig_signer(&env, &canceller)?;

        let proposal: UpgradeProposal = env
            .storage()
            .persistent()
            .get(&DataKey::PendingUpgrade)
            .ok_or(CarbonError::ProposalNotFound)?;

        if proposal.proposal_id != proposal_id {
            return Err(CarbonError::ProposalNotFound);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::PendingUpgrade);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("upg_cncl")),
            (proposal_id, canceller),
        );
        Ok(())
    }

    pub fn get_pending_upgrade(env: Env) -> Option<UpgradeProposal> {
        env.storage().persistent().get(&DataKey::PendingUpgrade)
    }

    fn require_multisig_signer(env: &Env, caller: &Address) -> Result<(), CarbonError> {
        let config: MultiSigConfig = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSigConfig)
            .ok_or(CarbonError::UnauthorizedUpgrade)?;
        if !config.signers.contains(caller) {
            return Err(CarbonError::UnauthorizedUpgrade);
        }
        Ok(())
    }

    fn current_year(env: &Env) -> u32 {
        let seconds_per_year: u64 = 31557600;
        let timestamp = env.ledger().timestamp();
        1970 + (timestamp / seconds_per_year) as u32
    }

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
        methodology_score: u32,
        vintage_year: u32,
        methodology_score: u32,
        metadata_hash: BytesN<32>,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        if project_id.is_empty() || project_id.len() > 64 {
            return Err(CarbonError::ProjectNotFound);
        }
        if name.is_empty() || name.len() > 128 {
            return Err(CarbonError::ProjectNotFound);
        }
        if metadata_cid.is_empty() || metadata_cid.len() > 128 {
            return Err(CarbonError::ProjectNotFound);
        }
        if methodology.is_empty() || methodology.len() > 64 {
            return Err(CarbonError::ProjectNotFound);
        }
        if country.is_empty() || country.len() > 64 {
            return Err(CarbonError::ProjectNotFound);
        }
        if project_type.is_empty() || project_type.len() > 64 {
            return Err(CarbonError::ProjectNotFound);
        }

        let current_year = Self::current_year(&env);
        if vintage_year < 1990 || vintage_year > current_year + 1 {
            return Err(CarbonError::InvalidVintageYear);
        }

        if methodology_score < 70 {
            return Err(CarbonError::MethodologyScoreLow);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Project(project_id.clone()))
        {
            return Err(CarbonError::ProjectAlreadyExists);
        }

        let project_count_key = DataKey::ProjectCount(admin.clone());
        let project_count: u32 = env
            .storage()
            .persistent()
            .get(&project_count_key)
            .unwrap_or(0u32);
        if project_count >= MAX_PROJECTS_PER_ADMIN {
            return Err(CarbonError::StorageLimitExceeded);
        }

        let project = CarbonProject {
            project_id: project_id.clone(),
            name: name.clone(),
            methodology: methodology.clone(),
            country: country.clone(),
            project_type: project_type.clone(),
            verifier_address: verifier_address.clone(),
            metadata_cid: metadata_cid.clone(),
            total_credits_issued: 0,
            total_credits_retired: 0,
            methodology_score,
            status: ProjectStatus::Pending,
            vintage_year,
            created_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);
        env.storage()
            .persistent()
            .set(&project_count_key, &(project_count + 1));

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("reg_proj")),
            (
                project_id,
                methodology,
                country,
                vintage_year,
                methodology_score,
            ),
        );
        Ok(())
    }

    pub fn verify_project(
        env: Env,
        verifier_address: Address,
        project_id: String,
    ) -> Result<(), CarbonError> {
        verifier_address.require_auth();
        Self::require_verifier(&env, &verifier_address)?;

        let mut project = Self::load_project(&env, &project_id)?;
        project.status = ProjectStatus::Verified;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("verified")),
            (project_id, verifier_address),
        );
        Ok(())
    }

    pub fn reject_project(
        env: Env,
        verifier_address: Address,
        project_id: String,
        reason: String,
    ) -> Result<(), CarbonError> {
        verifier_address.require_auth();
        Self::require_verifier(&env, &verifier_address)?;

        let mut project = Self::load_project(&env, &project_id)?;
        project.status = ProjectStatus::Rejected;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("rejected")),
            (project_id, verifier_address, reason),
        );
        Ok(())
    }

    pub fn update_project_status(
        env: Env,
        oracle_address: Address,
        project_id: String,
        status: ProjectStatus,
    ) -> Result<(), CarbonError> {
        oracle_address.require_auth();
        Self::require_oracle(&env, &oracle_address)?;

        let mut project = Self::load_project(&env, &project_id)?;
        project.status = status.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("st_update")),
            (project_id, oracle_address),
        );
        Ok(())
    }

    pub fn suspend_project(
        env: Env,
        admin: Address,
        project_id: String,
        reason: String,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let mut project = Self::load_project(&env, &project_id)?;
        project.status = ProjectStatus::Suspended;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("suspended")),
            (project_id, admin, reason),
        );
        Ok(())
    }

    /// Permissionless cross-contract entry point for the oracle to suspend a
    /// project when its monitoring data goes stale (liveness SLA breach).
    ///
    /// Only callable by the registered oracle address (cross-contract).
    /// Idempotent: returns `Ok(())` if the project is already suspended.
    pub fn oracle_suspend_project(
        env: Env,
        project_id: String,
        reason: String,
    ) -> Result<(), CarbonError> {
        Self::require_oracle(&env, &env.invoker())?;

        let mut project = Self::load_project(&env, &project_id)?;
        if project.status == ProjectStatus::Suspended {
            return Ok(());
        }
        project.status = ProjectStatus::Suspended;
        env.storage().persistent().set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("suspended")),
            (project_id, env.invoker(), reason),
        );
        Ok(())
    }

    pub fn get_project(env: Env, project_id: String) -> Result<CarbonProject, CarbonError> {
        Self::load_project(&env, &project_id)
    }

    /// View function: returns true if the provided SHA-256 hash matches the
    /// `metadata_hash` stored when the project was registered. Returns false
    /// for unknown projects (avoids leaking existence information via errors).
    ///
    /// Callers (backend, oracle, frontend) should:
    ///   1. Fetch the raw IPFS content via the gateway.
    ///   2. Compute SHA-256 locally.
    ///   3. Call this function with the result.
    pub fn verify_metadata_integrity(env: Env, project_id: String, hash: BytesN<32>) -> bool {
        match Self::load_project(&env, &project_id) {
            Ok(project) => project.metadata_hash == hash,
            Err(_) => false,
        }
    }

    pub fn increment_issued(
        env: Env,
        oracle_address: Address,
        project_id: String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        oracle_address.require_auth();
        Self::require_oracle(&env, &oracle_address)?;
        let mut project = Self::load_project(&env, &project_id)?;
        project.total_credits_issued = project
            .total_credits_issued
            .checked_add(amount)
            .ok_or(CarbonError::InvalidSerialRange)?;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &project);
        Ok(())
    }

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

        project.total_credits_retired = project
            .total_credits_retired
            .checked_add(amount)
            .ok_or(CarbonError::Arithmetic)?;
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id.clone()), &project);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("retired")),
            (project_id, amount),
        );
        Ok(())
    }

    pub fn add_verifier(env: Env, admin: Address, verifier: Address) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let verifiers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Verifiers)
            .unwrap_or_else(|| vec![&env]);

        if !verifiers.contains(&verifier) {
            let mut new_verifiers = verifiers;
            new_verifiers.push_back(verifier);
            env.storage()
                .persistent()
                .set(&DataKey::Verifiers, &new_verifiers);
        }

        Ok(())
    }

    pub fn remove_verifier(env: Env, admin: Address, verifier: Address) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let verifiers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Verifiers)
            .unwrap_or_else(|| vec![&env]);

        if let Some(index) = verifiers.first_index_of(&verifier) {
            let mut new_verifiers = verifiers;
            new_verifiers.remove(index);
            env.storage()
                .persistent()
                .set(&DataKey::Verifiers, &new_verifiers);
        }

        Ok(())
    }

    pub fn get_verifiers(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Verifiers)
            .unwrap_or_else(|| vec![&env])
    }

    fn load_project(env: &Env, project_id: &String) -> Result<CarbonProject, CarbonError> {
        env.storage()
            .persistent()
            .get(&DataKey::Project(project_id.clone()))
            .ok_or(CarbonError::ProjectNotFound)
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

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        vec, Env, String,
    };

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
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
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let verifier = Address::generate(&env);
        let client = CarbonRegistryContractClient::new(
            &env,
            &env.register_contract(None, CarbonRegistryContract),
        );
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);
        (env, admin, oracle, verifier)
    }

    fn make_str(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    fn register(env: &Env, client: &CarbonRegistryContractClient, admin: &Address) {
        client.register_project(
            admin,
            &make_str(env, "proj-001"),
            &make_str(env, "Amazon Reforestation"),
            &make_str(env, "QmCID123"),
            &Address::generate(env),
            &make_str(env, "VCS"),
            &make_str(env, "Brazil"),
            &make_str(env, "forestry"),
            &2023_u32,
        );
    }

    #[test]
    fn test_register_project_valid() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        let p = client.get_project(&make_str(&env, "proj-001"));
        assert_eq!(p.status, ProjectStatus::Pending);
        assert_eq!(p.vintage_year, 2023);
    }

    #[test]
    fn test_register_duplicate_fails() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        let result = client.try_register_project(
            &admin,
            &make_str(&env, "proj-001"),
            &make_str(&env, "Dup"),
            &make_str(&env, "cid"),
            &Address::generate(&env),
            &make_str(&env, "VCS"),
            &make_str(&env, "Brazil"),
            &make_str(&env, "forestry"),
            &2023_u32,
            &75_u32,
            &BytesN::from_array(&env, &[1u8; 32]),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_verifier_approves_project() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        client.verify_project(&verifier, &make_str(&env, "proj-001"));
        let p = client.get_project(&make_str(&env, "proj-001"));
        assert_eq!(p.status, ProjectStatus::Verified);
    }

    #[test]
    fn test_unauthorized_verifier_rejected() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        let rogue = Address::generate(&env);
        let result = client.try_verify_project(&rogue, &make_str(&env, "proj-001"));
        assert!(result.is_err());
    }

    #[test]
    fn test_verifier_rejects_project() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        client.reject_project(
            &verifier,
            &make_str(&env, "proj-001"),
            &make_str(&env, "fraud"),
        );
        let p = client.get_project(&make_str(&env, "proj-001"));
        assert_eq!(p.status, ProjectStatus::Rejected);
    }

    #[test]
    fn test_oracle_updates_status() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        client.update_project_status(
            &oracle,
            &make_str(&env, "proj-001"),
            &ProjectStatus::Completed,
        );
        let p = client.get_project(&make_str(&env, "proj-001"));
        assert_eq!(p.status, ProjectStatus::Completed);
    }

    #[test]
    fn test_admin_suspends_project() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        client.suspend_project(
            &admin,
            &make_str(&env, "proj-001"),
            &make_str(&env, "investigation"),
        );
        let p = client.get_project(&make_str(&env, "proj-001"));
        assert_eq!(p.status, ProjectStatus::Suspended);
    }

    #[test]
    fn test_get_project_returns_correct_data() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        let p = client.get_project(&make_str(&env, "proj-001"));
        assert_eq!(p.project_id, make_str(&env, "proj-001"));
        assert_eq!(p.country, make_str(&env, "Brazil"));
        assert_eq!(p.total_credits_issued, 0);
    }

    #[test]
    fn test_register_score_too_low_fails() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        let result = client.try_register_project(
            &admin,
            &make_str(&env, "proj-low"),
            &make_str(&env, "Low Score"),
            &make_str(&env, "cid"),
            &Address::generate(&env),
            &make_str(&env, "VCS"),
            &make_str(&env, "Brazil"),
            &make_str(&env, "forestry"),
            &2023_u32,
            &69_u32,
            &BytesN::from_array(&env, &[1u8; 32]),
        );
        assert_eq!(result, Err(Ok(CarbonError::MethodologyScoreLow)));
    }

    #[test]
    fn test_register_score_minimum_succeeds() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        client.register_project(
            &admin,
            &make_str(&env, "proj-min"),
            &make_str(&env, "Min Score"),
            &make_str(&env, "cid"),
            &Address::generate(&env),
            &make_str(&env, "VCS"),
            &make_str(&env, "Brazil"),
            &make_str(&env, "forestry"),
            &2023_u32,
        );

        let p = client.get_project(&make_str(&env, "proj-min"));
        assert_eq!(p.methodology_score, 70);
    }

    #[test]
    fn test_registering_past_project_cap_fails() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        for index in 0..MAX_PROJECTS_PER_ADMIN {
            let project_id = format!("proj-{index}");
            client.register_project(
                &admin,
                &String::from_str(&env, &project_id),
                &make_str(&env, "Project"),
                &make_str(&env, "cid"),
                &Address::generate(&env),
                &make_str(&env, "VCS"),
                &make_str(&env, "Brazil"),
                &make_str(&env, "forestry"),
                &75_u32,
                &2023_u32,
            );
        }

        let result = client.try_register_project(
            &admin,
            &make_str(&env, "proj-cap-exceeded"),
            &make_str(&env, "Overflow"),
            &make_str(&env, "cid"),
            &Address::generate(&env),
            &make_str(&env, "VCS"),
            &make_str(&env, "Brazil"),
            &make_str(&env, "forestry"),
            &75_u32,
            &2023_u32,
        );
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::StorageLimitExceeded);
    }

    #[test]
    fn test_initialize_twice_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let verifier = Address::generate(&env);
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);
        let result = client.try_initialize(&admin, &oracle, &vec![&env, verifier.clone()]);
        assert!(result.is_err());
    }

    #[test]
    fn test_overflow_increment_issued_graceful_error() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        client.increment_issued(&oracle, &make_str(&env, "proj-001"), &10_i128);

        let result = client.try_increment_issued(&oracle, &make_str(&env, "proj-001"), &i128::MAX);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InvalidSerialRange
        );
    }

    #[test]
    fn test_retire_credits_success() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        client.verify_project(&verifier, &make_str(&env, "proj-001"));
        client.increment_issued(&oracle, &make_str(&env, "proj-001"), &1000_i128);
        client.retire_credits(&admin, &make_str(&env, "proj-001"), &300_i128);

        let p = client.get_project(&make_str(&env, "proj-001"));
        assert_eq!(p.total_credits_retired, 300);
    }

    /// Kills mutation of `total_credits_retired + amount > total_credits_issued`
    /// -> `>=` in `retire_credits` (issue #632): retiring exactly the full
    /// issued amount is the boundary case and must succeed, not be rejected.
    #[test]
    fn test_retire_exact_issued_amount_succeeds() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        client.increment_issued(&oracle, &make_str(&env, "proj-001"), &500_i128);
        client.retire_credits(&admin, &make_str(&env, "proj-001"), &500_i128);

        let p = client.get_project(&make_str(&env, "proj-001"));
        assert_eq!(p.total_credits_retired, 500);
        assert_eq!(p.total_credits_retired, p.total_credits_issued);
    }

    #[test]
    fn test_retire_credits_cannot_exceed_issued() {
        let (env, admin, oracle, verifier) = setup();
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        register(&env, &client, &admin);
        client.verify_project(&verifier, &make_str(&env, "proj-001"));
        client.increment_issued(&oracle, &make_str(&env, "proj-001"), &100_i128);

        let result = client.try_retire_credits(&admin, &make_str(&env, "proj-001"), &200_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InsufficientCredits
        );
    }

    #[test]
    fn test_upgrade_admin_only() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let verifier = Address::generate(&env);
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

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
        let oracle = Address::generate(&env);
        let verifier = Address::generate(&env);
        let contract_id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);

        assert_eq!(client.get_version(), 1);
    }
}

// ── Edge-case tests (issue #91) ───────────────────────────────────────────────

#[cfg(test)]
mod edge_case_tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        vec, Env, String,
    };

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn init(env: &Env) -> (CarbonRegistryContractClient, Address, Address, Address) {
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
        let oracle = Address::generate(env);
        let verifier = Address::generate(env);
        let id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &vec![env, verifier.clone()]);
        (client, admin, oracle, verifier)
    }

    fn register_proj(env: &Env, client: &CarbonRegistryContractClient, admin: &Address, id: &str) {
        client.register_project(
            admin,
            &s(env, id),
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

    // ── ProjectNotFound ───────────────────────────────────────────────────────

    #[test]
    fn test_get_nonexistent_project_returns_not_found() {
        let env = Env::default();
        let (client, _, _, _) = init(&env);
        let result = client.try_get_project(&s(&env, "does-not-exist"));
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectNotFound);
    }

    #[test]
    fn test_verify_nonexistent_project_returns_not_found() {
        let env = Env::default();
        let (client, _, _, verifier) = init(&env);
        let result = client.try_verify_project(&verifier, &s(&env, "ghost"));
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectNotFound);
    }

    #[test]
    fn test_reject_nonexistent_project_returns_not_found() {
        let env = Env::default();
        let (client, _, _, verifier) = init(&env);
        let result = client.try_reject_project(&verifier, &s(&env, "ghost"), &s(&env, "fraud"));
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectNotFound);
    }

    #[test]
    fn test_suspend_nonexistent_project_returns_not_found() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        let result = client.try_suspend_project(&admin, &s(&env, "ghost"), &s(&env, "reason"));
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectNotFound);
    }

    // ── ProjectAlreadyExists ──────────────────────────────────────────────────

    #[test]
    fn test_register_duplicate_project_id_fails() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        register_proj(&env, &client, &admin, "dup-proj");
        let result = client.try_register_project(
            &admin,
            &s(&env, "dup-proj"),
            &s(&env, "Dup"),
            &s(&env, "cid"),
            &Address::generate(&env),
            &s(&env, "VCS"),
            &s(&env, "BR"),
            &s(&env, "forestry"),
            &75_u32,
            &2023_u32,
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::ProjectAlreadyExists
        );
    }

    // ── InvalidVintageYear ────────────────────────────────────────────────────

    #[test]
    fn test_vintage_year_1989_rejected() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        let result = client.try_register_project(
            &admin,
            &s(&env, "p1"),
            &s(&env, "N"),
            &s(&env, "cid"),
            &Address::generate(&env),
            &s(&env, "VCS"),
            &s(&env, "BR"),
            &s(&env, "forestry"),
            &75_u32,
            &1989_u32,
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::InvalidVintageYear
        );
    }

    #[test]
    fn test_vintage_year_1990_accepted() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let verifier = Address::generate(&env);
        let id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(&env, &id);
        client.initialize(&admin, &oracle, &vec![&env, verifier.clone()]);
        // Set ledger to 2026 so 1990 is within range
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1767225600,
            protocol_version: 20,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });
        client.register_project(
            &admin,
            &s(&env, "p1990"),
            &s(&env, "N"),
            &s(&env, "cid"),
            &Address::generate(&env),
            &s(&env, "VCS"),
            &s(&env, "BR"),
            &s(&env, "forestry"),
            &75_u32,
            &1990_u32,
        );
    }

    // ── MethodologyScoreLow ───────────────────────────────────────────────────

    #[test]
    fn test_methodology_score_zero_rejected() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        let result = client.try_register_project(
            &admin,
            &s(&env, "p1"),
            &s(&env, "N"),
            &s(&env, "cid"),
            &Address::generate(&env),
            &s(&env, "VCS"),
            &s(&env, "BR"),
            &s(&env, "forestry"),
            &0_u32,
            &2023_u32,
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::MethodologyScoreLow
        );
    }

    #[test]
    fn test_methodology_score_69_rejected() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        let result = client.try_register_project(
            &admin,
            &s(&env, "p1"),
            &s(&env, "N"),
            &s(&env, "cid"),
            &Address::generate(&env),
            &s(&env, "VCS"),
            &s(&env, "BR"),
            &s(&env, "forestry"),
            &69_u32,
            &2023_u32,
        );
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::MethodologyScoreLow
        );
    }

    // ── UnauthorizedVerifier ──────────────────────────────────────────────────

    #[test]
    fn test_non_verifier_cannot_verify_project() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        register_proj(&env, &client, &admin, "p1");
        let rogue = Address::generate(&env);
        let result = client.try_verify_project(&rogue, &s(&env, "p1"));
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedVerifier
        );
    }

    #[test]
    fn test_non_verifier_cannot_reject_project() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        register_proj(&env, &client, &admin, "p1");
        let rogue = Address::generate(&env);
        let result = client.try_reject_project(&rogue, &s(&env, "p1"), &s(&env, "fraud"));
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedVerifier
        );
    }

    #[test]
    fn test_non_admin_cannot_suspend_project() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        register_proj(&env, &client, &admin, "p1");
        let rogue = Address::generate(&env);
        let result = client.try_suspend_project(&rogue, &s(&env, "p1"), &s(&env, "reason"));
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedVerifier
        );
    }

    // ── UnauthorizedOracle ────────────────────────────────────────────────────

    #[test]
    fn test_non_oracle_cannot_update_project_status() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        register_proj(&env, &client, &admin, "p1");
        let rogue = Address::generate(&env);
        let result =
            client.try_update_project_status(&rogue, &s(&env, "p1"), &ProjectStatus::Completed);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedOracle
        );
    }

    #[test]
    fn test_non_oracle_cannot_increment_issued() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        register_proj(&env, &client, &admin, "p1");
        let rogue = Address::generate(&env);
        let result = client.try_increment_issued(&rogue, &s(&env, "p1"), &100_i128);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedOracle
        );
    }

    // ── AlreadyInitialized ────────────────────────────────────────────────────

    #[test]
    fn test_double_initialize_fails() {
        let env = Env::default();
        let (client, admin, oracle, verifier) = init(&env);
        let result = client.try_initialize(&admin, &oracle, &vec![&env, verifier]);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::AlreadyInitialized
        );
    }
}

// ── oracle_suspend_project tests ─────────────────────────────────────────────
//
// Tests for the cross-contract suspend entry point used by the oracle when
// monitoring data goes stale (liveness SLA breach).
//
// Note: `oracle_suspend_project` authenticates via `env.invoker()`, so direct
// unit-test calls go through the registered oracle contract in cross-contract
// liveness tests in carbon_oracle.  Here we only test the failure paths where
// the invoker is NOT the registered oracle.
#[cfg(test)]
mod oracle_suspend_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env, String};

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn init(env: &Env) -> (CarbonRegistryContractClient, Address, Address, Address) {
        env.mock_all_auths();
        let admin    = Address::generate(env);
        let oracle   = Address::generate(env);
        let verifier = Address::generate(env);
        let id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &vec![env, verifier.clone()]).unwrap();
        (client, admin, oracle, verifier)
    }

    fn register_proj(env: &Env, client: &CarbonRegistryContractClient, admin: &Address, id: &str) {
        client.register_project(
            admin,
            &s(env, id),
            &s(env, "Test Project"),
            &s(env, "QmCID"),
            &Address::generate(env),
            &s(env, "VCS"),
            &s(env, "Brazil"),
            &s(env, "forestry"),
            &75_u32,
            &2023_u32,
        ).unwrap();
    }

    #[test]
    fn test_oracle_suspend_project_unauthorized_when_invoker_is_not_oracle() {
        let env = Env::default();
        let (client, admin, _, _) = init(&env);
        register_proj(&env, &client, &admin, "p1");

        let result = client.try_oracle_suspend_project(&s(&env, "p1"), &s(&env, "reason"));
        assert_eq!(result.unwrap_err(), Ok(CarbonError::UnauthorizedOracle));
    }
}

// ── MultiSig Upgrade Tests (#648) ─────────────────────────────────────────────

#[cfg(test)]
mod multisig_tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        vec, Env, String,
    };

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup_multisig(
        env: &Env,
    ) -> (
        CarbonRegistryContractClient,
        Address, // admin
        Address, // signer1
        Address, // signer2
        Address, // signer3
    ) {
        env.mock_all_auths();
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1735689600,
            protocol_version: 20,
            sequence_number: 100,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });
        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let signer1 = Address::generate(env);
        let signer2 = Address::generate(env);
        let signer3 = Address::generate(env);

        let id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &vec![env, signer1.clone()]);

        // Initialize 2-of-3 multisig
        let signers = vec![env, signer1.clone(), signer2.clone(), signer3.clone()];
        client.initialize_multisig(&admin, &signers, &2u32);

        (client, admin, signer1, signer2, signer3)
    }

    /// 2-of-3 multisig: exactly 2 approvals reaches threshold and executes upgrade
    #[test]
    fn test_multisig_exact_threshold() {
        let env = Env::default();
        let (client, _admin, signer1, signer2, _signer3) = setup_multisig(&env);
        let fake_hash = BytesN::from_array(&env, &[1u8; 32]);

        // signer1 proposes (counts as first approval)
        let proposal_id = client.propose_upgrade(&signer1, &fake_hash);
        assert_eq!(proposal_id, 1u32);

        // Proposal exists with 1 approval, not yet executed
        let pending = client.get_pending_upgrade().unwrap();
        assert_eq!(pending.approvals.len(), 1);
        assert!(!pending.executed);

        // signer2 approves → threshold reached → executes
        client.approve_upgrade(&signer2, &1u32);

        let pending_after = client.get_pending_upgrade().unwrap();
        assert!(pending_after.executed);
    }

    /// 1-of-3 approval does NOT execute (threshold = 2)
    #[test]
    fn test_multisig_below_threshold() {
        let env = Env::default();
        let (client, _admin, signer1, _signer2, _signer3) = setup_multisig(&env);
        let fake_hash = BytesN::from_array(&env, &[2u8; 32]);

        client.propose_upgrade(&signer1, &fake_hash);

        // Only proposer has approved — should still be pending, not executed
        let pending = client.get_pending_upgrade().unwrap();
        assert_eq!(pending.approvals.len(), 1);
        assert!(!pending.executed);
    }

    /// Approval after expiry returns ProposalExpired
    #[test]
    fn test_multisig_expired_proposal() {
        let env = Env::default();
        let (client, _admin, signer1, signer2, _signer3) = setup_multisig(&env);
        let fake_hash = BytesN::from_array(&env, &[3u8; 32]);

        client.propose_upgrade(&signer1, &fake_hash);

        // Advance ledger sequence past the expiry window (518400 ledgers)
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1735689600,
            protocol_version: 20,
            sequence_number: 100 + 518_401, // past expiry
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 518400,
        });

        let result = client.try_approve_upgrade(&signer2, &1u32);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::ProposalExpired
        );
    }

    /// Duplicate approval from the same signer is rejected
    #[test]
    fn test_multisig_duplicate_approval_rejected() {
        let env = Env::default();
        let (client, _admin, signer1, _signer2, _signer3) = setup_multisig(&env);
        let fake_hash = BytesN::from_array(&env, &[4u8; 32]);

        client.propose_upgrade(&signer1, &fake_hash);

        // signer1 tries to approve again (already approved via propose)
        let result = client.try_approve_upgrade(&signer1, &1u32);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::DuplicateApproval
        );
    }

    /// Non-signer cannot propose
    #[test]
    fn test_multisig_non_signer_cannot_propose() {
        let env = Env::default();
        let (client, _admin, _signer1, _signer2, _signer3) = setup_multisig(&env);
        let outsider = Address::generate(&env);
        let fake_hash = BytesN::from_array(&env, &[5u8; 32]);

        let result = client.try_propose_upgrade(&outsider, &fake_hash);
        assert_eq!(
            result.unwrap_err().unwrap(),
            CarbonError::UnauthorizedUpgrade
        );
    }

    /// Signer can cancel a pending proposal
    #[test]
    fn test_multisig_cancel_upgrade() {
        let env = Env::default();
        let (client, _admin, signer1, signer2, _signer3) = setup_multisig(&env);
        let fake_hash = BytesN::from_array(&env, &[6u8; 32]);

        client.propose_upgrade(&signer1, &fake_hash);
        client.cancel_upgrade(&signer2, &1u32);

        // Proposal should be gone
        let pending = client.get_pending_upgrade();
        assert!(pending.is_none());
    }
}

// ── Metadata integrity tests (Issue #2) ──────────────────────────────────────

#[cfg(test)]
mod metadata_integrity_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, BytesN, Env, String};

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup_with_project(env: &Env, hash: BytesN<32>) -> CarbonRegistryContractClient {
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
        let admin    = Address::generate(env);
        let oracle   = Address::generate(env);
        let verifier = Address::generate(env);
        let id = env.register_contract(None, CarbonRegistryContract);
        let client = CarbonRegistryContractClient::new(env, &id);
        client.initialize(&admin, &oracle, &vec![env, verifier.clone()]).unwrap();

        client.register_project(
            &admin,
            &s(env, "proj-hash-test"),
            &s(env, "Hash Test Project"),
            &s(env, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"),
            &Address::generate(env),
            &s(env, "VCS"),
            &s(env, "Brazil"),
            &s(env, "forestry"),
            &2024_u32,
            &85_u32,
            &hash,
        ).unwrap();

        client
    }

    /// verify_metadata_integrity returns true when the correct hash is supplied.
    #[test]
    fn test_verify_metadata_integrity_match() {
        let env = Env::default();
        let correct_hash = BytesN::from_array(&env, &[0xabu8; 32]);
        let client = setup_with_project(&env, correct_hash.clone());

        let result = client.verify_metadata_integrity(
            &s(&env, "proj-hash-test"),
            &correct_hash,
        );
        assert!(result, "Expected integrity check to return true for matching hash");
    }

    /// verify_metadata_integrity returns false when the wrong hash is supplied.
    #[test]
    fn test_verify_metadata_integrity_mismatch() {
        let env = Env::default();
        let correct_hash = BytesN::from_array(&env, &[0xabu8; 32]);
        let wrong_hash   = BytesN::from_array(&env, &[0xcdu8; 32]);
        let client = setup_with_project(&env, correct_hash);

        let result = client.verify_metadata_integrity(
            &s(&env, "proj-hash-test"),
            &wrong_hash,
        );
        assert!(!result, "Expected integrity check to return false for mismatched hash");
    }

    /// verify_metadata_integrity returns false (not an error) for unknown projects.
    /// This prevents leaking project existence information via error variants.
    #[test]
    fn test_verify_metadata_integrity_missing_project() {
        let env = Env::default();
        let any_hash = BytesN::from_array(&env, &[0x00u8; 32]);
        let correct_hash = BytesN::from_array(&env, &[0xabu8; 32]);
        let client = setup_with_project(&env, correct_hash);

        let result = client.verify_metadata_integrity(
            &s(&env, "project-does-not-exist"),
            &any_hash,
        );
        assert!(!result, "Expected integrity check to return false for non-existent project");
    }
}
