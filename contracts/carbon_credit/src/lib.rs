#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec,
    symbol_short, vec,
};

// ── Error Enum ────────────────────────────────────────────────────────────────

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
    Unauthorized           = 19,
}

// ── Role Enum ─────────────────────────────────────────────────────────────────

/// Multi-tiered roles for on-chain RBAC.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Role {
    Admin    = 0,
    Verifier = 1,
    Oracle   = 2,
    User     = 3,
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Batch(String),
    Retirement(String),
    ProjectBatches(String),
    SerialRegistry,
    Admin,
    RegistryContract,
    /// Maps an Address to its assigned Role.
    RoleMap(Address),
}

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

/// Compact serial range stored globally to detect overlaps.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SerialRange {
    pub start: u64,
    pub end:   u64,
}

/// Tracks how many credits in a batch have been retired so far.
#[contracttype]
#[derive(Clone)]
pub enum RetiredKey {
    BatchRetired(String),
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct CarbonCreditContract;

#[contractimpl]
impl CarbonCreditContract {

    /// Initialise with admin address. The deployer is bootstrapped with the
    /// Admin role so subsequent role-gated calls can proceed immediately.
    pub fn initialize(env: Env, admin: Address, registry_contract: Address) {
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::RegistryContract, &registry_contract);
        // Bootstrap: grant the deploying admin the Admin role on-chain.
        env.storage().persistent().set(&DataKey::RoleMap(admin.clone()), &Role::Admin);
        let ranges: Vec<SerialRange> = vec![&env];
        env.storage().persistent().set(&DataKey::SerialRegistry, &ranges);
    }

    // ── RBAC management ───────────────────────────────────────────────────────

    /// Grant a role to any address. Only the Admin role may call this.
    ///
    /// # Errors
    /// - [`CarbonError::Unauthorized`] if caller does not hold the Admin role.
    pub fn grant_role(
        env: Env,
        admin: Address,
        grantee: Address,
        role: Role,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;
        env.storage().persistent().set(&DataKey::RoleMap(grantee.clone()), &role);
        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("role_set")),
            (admin, grantee, role as u32),
        );
        Ok(())
    }

    /// Revoke (remove) a role from an address, resetting it to `User`.
    /// Only the Admin role may call this.
    ///
    /// # Errors
    /// - [`CarbonError::Unauthorized`] if caller does not hold the Admin role.
    pub fn revoke_role(
        env: Env,
        admin: Address,
        grantee: Address,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;
        env.storage().persistent().set(&DataKey::RoleMap(grantee.clone()), &Role::User);
        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("role_rev")),
            (admin, grantee),
        );
        Ok(())
    }

    /// Query the role of an address. Returns `Role::User` if no role has been assigned.
    pub fn get_role(env: Env, addr: Address) -> Role {
        env.storage()
            .persistent()
            .get(&DataKey::RoleMap(addr))
            .unwrap_or(Role::User)
    }

    // ── Credit operations ─────────────────────────────────────────────────────

    /// Mint verified carbon credits for a verified project. Assigns unique serial
    /// numbers to each credit, preventing double-counting globally.
    ///
    /// Requires the caller to hold the `Admin` role.
    ///
    /// # Errors
    /// - [`CarbonError::Unauthorized`] if caller does not hold the Admin role.
    /// - [`CarbonError::ZeroAmountNotAllowed`] if `amount` is zero.
    /// - [`CarbonError::InvalidSerialRange`] if `serial_end < serial_start`.
    /// - [`CarbonError::SerialNumberConflict`] if serial range overlaps an existing batch.
    /// - [`CarbonError::InvalidVintageYear`] if vintage year is out of range.
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
    ) -> Result<(), CarbonError> {
        // ── checks ────────────────────────────────────────────────────────────
        admin.require_auth();
        // Role-based check: caller must hold Admin role
        Self::require_role(&env, &admin, Role::Admin)?;

        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }
        if serial_end < serial_start {
            return Err(CarbonError::InvalidSerialRange);
        }
        if vintage_year < 2000 || vintage_year > 2100 {
            return Err(CarbonError::InvalidVintageYear);
        }
        if env.storage().persistent().has(&DataKey::Batch(batch_id.clone())) {
            return Err(CarbonError::SerialNumberConflict);
        }

        // Enforce global serial uniqueness
        if !Self::verify_serial_range_internal(&env, serial_start, serial_end) {
            return Err(CarbonError::DoubleCountingDetected);
        }

        // ── effects ───────────────────────────────────────────────────────────
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
        };
        env.storage().persistent().set(&DataKey::Batch(batch_id.clone()), &batch);

        let mut project_batches: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ProjectBatches(project_id.clone()))
            .unwrap_or_else(|| vec![&env]);
        project_batches.push_back(batch_id.clone());
        env.storage().persistent().set(&DataKey::ProjectBatches(project_id.clone()), &project_batches);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("minted")),
            (batch_id, project_id, amount, vintage_year, serial_start, serial_end),
        );
        Ok(())
    }

    /// Permanently and irreversibly retire carbon credits on-chain. Retired credits
    /// are burned and can never be transferred or retired again under any circumstance.
    /// A permanent [`RetirementCertificate`] is recorded on-chain.
    ///
    /// # Errors
    /// - [`CarbonError::ZeroAmountNotAllowed`] if `amount` is zero.
    /// - [`CarbonError::InsufficientCredits`] if batch has fewer active credits than requested.
    /// - [`CarbonError::AlreadyRetired`] if batch is fully retired.
    pub fn retire_credits(
        env: Env,
        holder: Address,
        batch_id: String,
        amount: i128,
        retirement_reason: String,
        beneficiary: String,
        retirement_id: String,
        tx_hash: String,
    ) -> Result<RetirementCertificate, CarbonError> {
        // ── checks ────────────────────────────────────────────────────────────
        holder.require_auth();

        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let mut batch = Self::load_batch(&env, &batch_id)?;

        if batch.status == CreditStatus::FullyRetired {
            return Err(CarbonError::AlreadyRetired);
        }
        if batch.status == CreditStatus::Suspended {
            return Err(CarbonError::ProjectSuspended);
        }

        let active_amount = Self::active_amount(&env, &batch);
        if amount > active_amount {
            return Err(CarbonError::InsufficientCredits);
        }

        // ── effects ───────────────────────────────────────────────────────────
        let already_retired: i128 = env
            .storage()
            .persistent()
            .get(&RetiredKey::BatchRetired(batch_id.clone()))
            .unwrap_or(0i128);

        let retire_serial_start = batch.serial_start + already_retired as u64;
        let retire_serial_end   = retire_serial_start + amount as u64 - 1;

        let mut serial_numbers: Vec<u64> = vec![&env];
        let mut s = retire_serial_start;
        while s <= retire_serial_end {
            serial_numbers.push_back(s);
            s += 1;
        }

        let new_retired = already_retired + amount;
        env.storage().persistent().set(&RetiredKey::BatchRetired(batch_id.clone()), &new_retired);

        let new_active = batch.amount - new_retired;
        batch.status = if new_active == 0 {
            CreditStatus::FullyRetired
        } else {
            CreditStatus::PartiallyRetired
        };
        env.storage().persistent().set(&DataKey::Batch(batch_id.clone()), &batch);

        let cert = RetirementCertificate {
            retirement_id:     retirement_id.clone(),
            credit_batch_id:   batch_id.clone(),
            project_id:        batch.project_id.clone(),
            amount,
            retired_by:        holder.clone(),
            beneficiary:       beneficiary.clone(),
            retirement_reason: retirement_reason.clone(),
            vintage_year:      batch.vintage_year,
            serial_numbers:    serial_numbers.clone(),
            retired_at:        env.ledger().timestamp(),
            tx_hash:           tx_hash.clone(),
        };
        env.storage().persistent().set(&DataKey::Retirement(retirement_id.clone()), &cert);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("retired")),
            (retirement_id, batch_id, batch.project_id, amount, holder, beneficiary),
        );
        Ok(cert)
    }

    /// Transfer credits between accounts. Retired batches cannot be transferred.
    ///
    /// # Errors
    /// - [`CarbonError::AlreadyRetired`] if batch is fully retired.
    /// - [`CarbonError::InsufficientCredits`] if insufficient active credits.
    pub fn transfer_credits(
        env: Env,
        from: Address,
        to: Address,
        batch_id: String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        from.require_auth();

        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let batch = Self::load_batch(&env, &batch_id)?;

        if batch.status == CreditStatus::FullyRetired {
            return Err(CarbonError::AlreadyRetired);
        }
        if batch.status == CreditStatus::Suspended {
            return Err(CarbonError::ProjectSuspended);
        }

        let active = Self::active_amount(&env, &batch);
        if amount > active {
            return Err(CarbonError::InsufficientCredits);
        }

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("transfer")),
            (batch_id, from, to, amount),
        );
        Ok(())
    }

    /// Returns a [`CreditBatch`] by ID.
    pub fn get_credit_batch(env: Env, batch_id: String) -> Result<CreditBatch, CarbonError> {
        Self::load_batch(&env, &batch_id)
    }

    /// Returns a permanent [`RetirementCertificate`] by retirement ID.
    pub fn get_retirement_certificate(
        env: Env,
        retirement_id: String,
    ) -> Result<RetirementCertificate, CarbonError> {
        env.storage()
            .persistent()
            .get(&DataKey::Retirement(retirement_id))
            .ok_or(CarbonError::ProjectNotFound)
    }

    /// Returns `true` if the serial range `[serial_start, serial_end]` does NOT
    /// overlap any existing batch — i.e., safe to mint.
    pub fn verify_serial_range(env: Env, serial_start: u64, serial_end: u64) -> bool {
        Self::verify_serial_range_internal(&env, serial_start, serial_end)
    }

    /// Returns all [`CreditBatch`] records for a given project.
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

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn load_batch(env: &Env, batch_id: &String) -> Result<CreditBatch, CarbonError> {
        env.storage()
            .persistent()
            .get(&DataKey::Batch(batch_id.clone()))
            .ok_or(CarbonError::ProjectNotFound)
    }

    /// Enforce that `caller` holds exactly `required` role.
    fn require_role(env: &Env, caller: &Address, required: Role) -> Result<(), CarbonError> {
        let role: Role = env
            .storage()
            .persistent()
            .get(&DataKey::RoleMap(caller.clone()))
            .unwrap_or(Role::User);
        if role != required {
            return Err(CarbonError::Unauthorized);
        }
        Ok(())
    }

    /// Returns the number of credits in a batch that have not yet been retired.
    fn active_amount(env: &Env, batch: &CreditBatch) -> i128 {
        if batch.status == CreditStatus::FullyRetired {
            return 0;
        }
        let retired: i128 = env
            .storage()
            .persistent()
            .get(&RetiredKey::BatchRetired(batch.batch_id.clone()))
            .unwrap_or(0i128);
        batch.amount - retired
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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    /// Create a fresh env + contract with a designated admin (Admin role bootstrapped).
    fn setup() -> (Env, CarbonCreditContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin    = Address::generate(&env);
        let registry = Address::generate(&env);
        let id       = env.register_contract(None, CarbonCreditContract);
        let client   = CarbonCreditContractClient::new(&env, &id);
        client.initialize(&admin, &registry);
        (env, client, admin)
    }

    // ── Original functional tests (preserved) ─────────────────────────────

    #[test]
    fn test_mint_credits_success() {
        let (env, client, admin) = setup();
        client.mint_credits(
            &admin,
            &s(&env, "proj-001"),
            &500_i128,
            &2023_u32,
            &s(&env, "batch-A"),
            &1_u64,
            &500_u64,
            &s(&env, "QmCID"),
        );
        let b = client.get_credit_batch(&s(&env, "batch-A"));
        assert_eq!(b.amount, 500);
        assert_eq!(b.status, CreditStatus::Active);
    }

    #[test]
    fn test_serial_conflict_detection() {
        let (env, client, admin) = setup();
        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"));
        let result = client.try_mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b2"), &50_u64, &150_u64, &s(&env, "cid"));
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_serial_range_no_overlap() {
        let (env, client, admin) = setup();
        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"));
        assert!(client.verify_serial_range(&101_u64, &200_u64));
        assert!(!client.verify_serial_range(&50_u64, &150_u64));
    }

    #[test]
    fn test_retire_credits_permanent() {
        let (env, client, admin) = setup();
        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"));
        let holder = Address::generate(&env);
        let cert = client.retire_credits(
            &holder,
            &s(&env, "b1"),
            &100_i128,
            &s(&env, "offset 2023 emissions"),
            &s(&env, "Acme Corp"),
            &s(&env, "ret-001"),
            &s(&env, "txhash123"),
        );
        assert_eq!(cert.amount, 100);
        assert_eq!(cert.beneficiary, s(&env, "Acme Corp"));
        let batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(batch.status, CreditStatus::FullyRetired);
    }

    #[test]
    fn test_retired_credits_cannot_be_transferred() {
        let (env, client, admin) = setup();
        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"));
        let holder = Address::generate(&env);
        client.retire_credits(&holder, &s(&env, "b1"), &100_i128, &s(&env, "reason"), &s(&env, "Corp"), &s(&env, "ret-001"), &s(&env, "tx"));
        let to = Address::generate(&env);
        let result = client.try_transfer_credits(&holder, &to, &s(&env, "b1"), &10_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_retired_credits_cannot_be_retired_again() {
        let (env, client, admin) = setup();
        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"));
        let holder = Address::generate(&env);
        client.retire_credits(&holder, &s(&env, "b1"), &100_i128, &s(&env, "reason"), &s(&env, "Corp"), &s(&env, "ret-001"), &s(&env, "tx"));
        let result = client.try_retire_credits(&holder, &s(&env, "b1"), &100_i128, &s(&env, "reason"), &s(&env, "Corp"), &s(&env, "ret-002"), &s(&env, "tx2"));
        assert!(result.is_err());
    }

    #[test]
    fn test_partial_retirement_updates_status() {
        let (env, client, admin) = setup();
        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"));
        let holder = Address::generate(&env);
        client.retire_credits(&holder, &s(&env, "b1"), &40_i128, &s(&env, "reason"), &s(&env, "Corp"), &s(&env, "ret-001"), &s(&env, "tx"));
        let batch = client.get_credit_batch(&s(&env, "b1"));
        assert_eq!(batch.status, CreditStatus::PartiallyRetired);
    }

    #[test]
    fn test_get_retirement_certificate() {
        let (env, client, admin) = setup();
        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"));
        let holder = Address::generate(&env);
        client.retire_credits(&holder, &s(&env, "b1"), &100_i128, &s(&env, "reason"), &s(&env, "Corp"), &s(&env, "ret-001"), &s(&env, "tx"));
        let cert = client.get_retirement_certificate(&s(&env, "ret-001"));
        assert_eq!(cert.amount, 100);
        assert_eq!(cert.retirement_id, s(&env, "ret-001"));
    }

    #[test]
    fn test_zero_amount_rejected() {
        let (env, client, admin) = setup();
        let result = client.try_mint_credits(&admin, &s(&env, "p1"), &0_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"));
        assert!(result.is_err());
    }

    // ── RBAC tests ────────────────────────────────────────────────────────

    #[test]
    fn test_admin_has_admin_role_after_initialize() {
        let (env, client, admin) = setup();
        assert_eq!(client.get_role(&admin), Role::Admin);
    }

    #[test]
    fn test_get_role_returns_user_for_unknown_address() {
        let (env, client, _admin) = setup();
        let stranger = Address::generate(&env);
        assert_eq!(client.get_role(&stranger), Role::User);
    }

    #[test]
    fn test_grant_role_success() {
        let (env, client, admin) = setup();
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        assert_eq!(client.get_role(&verifier), Role::Verifier);
    }

    #[test]
    fn test_grant_oracle_role_success() {
        let (env, client, admin) = setup();
        let oracle = Address::generate(&env);
        client.grant_role(&admin, &oracle, &Role::Oracle);
        assert_eq!(client.get_role(&oracle), Role::Oracle);
    }

    #[test]
    fn test_grant_role_unauthorized_non_admin_cannot_grant() {
        let (env, client, _admin) = setup();
        let attacker = Address::generate(&env);
        let victim   = Address::generate(&env);
        // attacker has no role (defaults to User) — must fail
        let result = client.try_grant_role(&attacker, &victim, &Role::Admin);
        assert!(result.is_err());
    }

    #[test]
    fn test_grant_role_verifier_cannot_grant() {
        let (env, client, admin) = setup();
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        let victim = Address::generate(&env);
        // Verifier role cannot grant roles
        let result = client.try_grant_role(&verifier, &victim, &Role::Admin);
        assert!(result.is_err());
    }

    #[test]
    fn test_revoke_role_success() {
        let (env, client, admin) = setup();
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        assert_eq!(client.get_role(&verifier), Role::Verifier);
        client.revoke_role(&admin, &verifier);
        // After revocation the address is reset to User
        assert_eq!(client.get_role(&verifier), Role::User);
    }

    #[test]
    fn test_revoke_role_unauthorized_non_admin_cannot_revoke() {
        let (env, client, admin) = setup();
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        let attacker = Address::generate(&env);
        let result = client.try_revoke_role(&attacker, &verifier);
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_credits_unauthorized_user_role_fails() {
        let (env, client, _admin) = setup();
        let non_admin = Address::generate(&env);
        // non_admin has default User role — mint must fail
        let result = client.try_mint_credits(
            &non_admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_credits_with_verifier_role_fails() {
        let (env, client, admin) = setup();
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        // Verifier role is not sufficient to mint — only Admin can
        let result = client.try_mint_credits(
            &verifier,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_credits_with_oracle_role_fails() {
        let (env, client, admin) = setup();
        let oracle = Address::generate(&env);
        client.grant_role(&admin, &oracle, &Role::Oracle);
        let result = client.try_mint_credits(
            &oracle,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_grant_then_revoke_cannot_mint() {
        let (env, client, admin) = setup();
        // Promote a second admin, then revoke their Admin role
        let second_admin = Address::generate(&env);
        client.grant_role(&admin, &second_admin, &Role::Admin);

        // second_admin can mint while holding Admin role
        client.mint_credits(
            &second_admin,
            &s(&env, "p1"),
            &50_i128,
            &2023_u32,
            &s(&env, "b-before"),
            &1_u64,
            &50_u64,
            &s(&env, "cid"),
        );

        // Now revoke second_admin's role
        client.revoke_role(&admin, &second_admin);
        assert_eq!(client.get_role(&second_admin), Role::User);

        // After revocation, minting must fail
        let result = client.try_mint_credits(
            &second_admin,
            &s(&env, "p1"),
            &50_i128,
            &2023_u32,
            &s(&env, "b-after"),
            &51_u64,
            &100_u64,
            &s(&env, "cid"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_grant_admin_role_allows_mint() {
        let (env, client, admin) = setup();
        let second_admin = Address::generate(&env);
        client.grant_role(&admin, &second_admin, &Role::Admin);
        // second_admin now holds Admin role and must be able to mint
        client.mint_credits(
            &second_admin,
            &s(&env, "p1"),
            &100_i128,
            &2023_u32,
            &s(&env, "b1"),
            &1_u64,
            &100_u64,
            &s(&env, "cid"),
        );
        assert_eq!(client.get_credit_batch(&s(&env, "b1")).amount, 100);
    }
}
