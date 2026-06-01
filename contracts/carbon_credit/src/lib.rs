#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec,
    symbol_short, vec, BytesN,
};

const TTL_LEDGERS: u32 = 518_400;
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
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CreditMintedEvent {
    pub batch_id: String,
    pub project_id: String,
    pub admin: Address,
    pub amount: i128,
    pub vintage_year: u32,
    pub serial_start: u64,
    pub serial_end: u64,
    pub timestamp: u64,
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
#[derive(Clone)]
pub enum RetiredKey {
    BatchRetired(String),
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

#[contract]
pub struct CarbonCreditContract;

#[contractimpl]
impl CarbonCreditContract {

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

    fn current_year(env: &Env) -> u32 {
        let seconds_per_year: u64 = 31557600;
        let timestamp = env.ledger().timestamp();
        1970 + (timestamp / seconds_per_year) as u32
    }

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

        if project_id.is_empty() || project_id.chars().count() > 64 {
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

        let current_year = Self::current_year(&env);
        if vintage_year < 1990 || vintage_year > current_year + 1 {
            return Err(CarbonError::InvalidVintageYear);
        }

        if env.storage().persistent().has(&DataKey::Batch(batch_id.clone())) {
            return Err(CarbonError::SerialNumberConflict);
        }

        if !Self::verify_serial_range_internal(&env, serial_start, serial_end) {
            return Err(CarbonError::DoubleCountingDetected);
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

        let mut project_batches: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ProjectBatches(project_id.clone()))
            .unwrap_or_else(|| vec![&env]);
        project_batches.push_back(batch_id.clone());
        env.storage().persistent().set(&DataKey::ProjectBatches(project_id.clone()), &project_batches);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("minted")),
            CreditMintedEvent {
                batch_id: batch_id.clone(),
                project_id: project_id.clone(),
                admin: admin.clone(),
                amount,
                vintage_year,
                serial_start,
                serial_end,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

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

        let already_retired: i128 = env
            .storage()
            .persistent()
            .get(&RetiredKey::BatchRetired(batch_id.clone()))
            .unwrap_or(0i128);

        let already_retired_u64 = u64::try_from(already_retired).map_err(|_| CarbonError::Arithmetic)?;
        let retire_serial_start = batch.serial_start.checked_add(already_retired_u64).ok_or(CarbonError::Arithmetic)?;
        let amount_u64 = u64::try_from(amount).map_err(|_| CarbonError::Arithmetic)?;
        let retire_serial_end   = retire_serial_start.checked_add(amount_u64 - 1).ok_or(CarbonError::Arithmetic)?;

        let mut serial_numbers: Vec<u64> = vec![&env];
        let mut s = retire_serial_start;
        while s <= retire_serial_end {
            serial_numbers.push_back(s);
            s += 1;
        }

        let new_retired = already_retired.checked_add(amount).ok_or(CarbonError::Arithmetic)?;
        env.storage().persistent().set(&RetiredKey::BatchRetired(batch_id.clone()), &new_retired);

        let new_active = batch.amount.checked_sub(new_retired).ok_or(CarbonError::Arithmetic)?;
        batch.status = if new_active == 0 {
            CreditStatus::FullyRetired
        } else {
            CreditStatus::PartiallyRetired
        };
        env.storage().persistent().set(&DataKey::Batch(batch_id.clone()), &batch);
        Self::extend_batch_ttl(&env, &batch_id);

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
            (symbol_short!("c_ledger"), symbol_short!("retired")),
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

        let active = Self::active_amount(&env, &batch);
        if amount > active {
            return Err(CarbonError::InsufficientCredits);
        }

        batch.owner = to.clone();
        env.storage().persistent().set(&DataKey::Batch(batch_id.clone()), &batch);
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

    fn extend_batch_ttl(env: &Env, batch_id: &String) {
        let key = DataKey::Batch(batch_id.clone());
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        }
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
        let retired: i128 = env
            .storage()
            .persistent()
            .get(&RetiredKey::BatchRetired(batch.batch_id.clone()))
            .unwrap_or(0i128);
        batch.amount.checked_sub(retired).unwrap_or(0)
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

// ── Invariant tests ───────────────────────────────────────────────────────────
#[cfg(test)]
mod invariants;

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Env, String};

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

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
        let admin = Address::generate(&env);
        let registry = Address::generate(&env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(&env, &id);
        client.initialize(&admin, &registry);
        (client, admin, registry)
    }

    fn mint_batch(env: &Env, client: &CarbonCreditContractClient, admin: &Address, owner: &Address) {
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
        let owner    = Address::generate(&env);
        let attacker = Address::generate(&env);
        let victim   = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        let result = client.try_transfer_credits(&attacker, &victim, &s(&env, "batch-001"), &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_admin_cannot_bypass_transfer_authorization() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        let to    = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        let result = client.try_transfer_credits(&admin, &to, &s(&env, "batch-001"), &100_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_transfer_updates_owner() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner     = Address::generate(&env);
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

        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner);
        let result = client.try_mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b2"), &50_u64, &150_u64, &s(&env, "cid"), &owner);
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_serial_start_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        let result = client.try_mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &0_u64, &100_u64, &s(&env, "cid"), &owner);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::InvalidSerialRange));
    }

    #[test]
    fn test_verify_serial_range_no_overlap() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner);
        assert!(client.verify_serial_range(&101_u64, &200_u64));
        assert!(!client.verify_serial_range(&50_u64, &150_u64));
    }

    #[test]
    fn test_retire_credits_permanent() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner);

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

        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner);
        client.retire_credits(&owner, &s(&env, "b1"), &100_i128, &s(&env, "reason"), &s(&env, "Corp"), &s(&env, "ret-001"), &s(&env, "tx"), &s(&env, "QmCID"));

        let to = Address::generate(&env);
        let result = client.try_transfer_credits(&owner, &to, &s(&env, "b1"), &10_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_retired_credits_cannot_be_retired_again() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);

        client.mint_credits(&admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner);
        client.retire_credits(&owner, &s(&env, "b1"), &100_i128, &s(&env, "reason"), &s(&env, "Corp"), &s(&env, "ret-001"), &s(&env, "tx"), &s(&env, "QmCID"));

        let result = client.try_retire_credits(&owner, &s(&env, "b1"), &100_i128, &s(&env, "reason"), &s(&env, "Corp"), &s(&env, "ret-002"), &s(&env, "tx2"), &s(&env, "QmCID2"));
        assert!(result.is_err());
    }

    #[test]
    fn test_partial_retirement_updates_status() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        mint_batch(&env, &client, &admin, &owner);

        client.retire_credits(&owner, &s(&env, "batch-001"), &500_i128, &s(&env, "partial"), &s(&env, "me"), &s(&env, "ret-001"), &s(&env, "tx"), &s(&env, "QmCID"));
        let batch = client.get_credit_batch(&s(&env, "batch-001"));
        assert_eq!(batch.status, CreditStatus::PartiallyRetired);
    }

    #[test]
    fn test_vintage_year_boundary_1989_fails() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        let owner = Address::generate(&env);
        
        let result = client.try_mint_credits(
            &admin, &s(&env, "p1"), &100_i128, &1989_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner
        );
        assert_eq!(result.unwrap_err(), Ok(CarbonError::InvalidVintageYear));
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
            &admin, &s(&env, "p1"), &100_i128, &1990_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner
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
            &admin, &s(&env, "p1"), &100_i128, &2027_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner
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
            &admin, &s(&env, "p1"), &100_i128, &2028_u32, &s(&env, "b1"), &1_u64, &100_u64, &s(&env, "cid"), &owner
        );
        assert_eq!(result.unwrap_err(), Ok(CarbonError::InvalidVintageYear));
    }

    #[test]
    fn test_upgrade_admin_only() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let registry = Address::generate(&env);
        let id = env.register_contract(None, CarbonCreditContract);
        let client = CarbonCreditContractClient::new(&env, &id);
        client.initialize(&admin, &registry).unwrap();

        let attacker = Address::generate(&env);
        let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
        let result = client.try_upgrade(&attacker, &fake_hash);
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
        client.initialize(&admin, &registry).unwrap();

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
            &owner, &s(&env, "b1"), &100_i128, &s(&env, "offset"), 
            &s(&env, "Corp"), &s(&env, "ret-001"), &s(&env, "tx"), &s(&env, "QmCID")
        ).unwrap();

        // Attempt to reverse the retirement - must fail
        let result = client.try_undo_retire(&admin, &s(&env, "ret-001"));
        assert_eq!(result.unwrap_err(), Ok(CarbonError::RetirementIrreversible));
    }

    #[test]
    fn test_admin_cannot_reverse_retirement() {
        let env = Env::default();
        let (client, admin) = init(&env);
        let owner = Address::generate(&env);

        // Mint and retire credits
        mint(&env, &client, &admin, "b1", &owner);
        client.retire_credits(
            &owner, &s(&env, "b1"), &50_i128, &s(&env, "offset"), 
            &s(&env, "Corp"), &s(&env, "ret-002"), &s(&env, "tx"), &s(&env, "QmCID")
        ).unwrap();

        // Even admin cannot reverse retirement
        let result = client.try_undo_retire(&admin, &s(&env, "ret-002"));
        assert_eq!(result.unwrap_err(), Ok(CarbonError::RetirementIrreversible));

        // Verify retirement certificate still exists and is unchanged
        let cert = client.get_retirement_certificate(&s(&env, "ret-002")).unwrap();
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
            &admin, &s(&env, "p1"), &100_i128, &2023_u32, &s(&env, "b1"), 
            &1_u64, &100_u64, &s(&env, "cid"), &owner
        ).unwrap();

        // Retire 50 credits (serials 1-50)
        let cert = client.retire_credits(
            &owner, &s(&env, "b1"), &50_i128, &s(&env, "offset"), 
            &s(&env, "Corp"), &s(&env, "ret-003"), &s(&env, "tx"), &s(&env, "QmCID")
        ).unwrap();

        // Verify serial numbers are recorded in certificate
        assert_eq!(cert.serial_numbers.len(), 50);
        assert_eq!(cert.serial_numbers.get(0).unwrap(), 1);
        assert_eq!(cert.serial_numbers.get(49).unwrap(), 50);

        // Verify batch status reflects retirement
        let batch = client.get_credit_batch(&s(&env, "b1")).unwrap();
        assert_eq!(batch.status, CreditStatus::PartiallyRetired);

        // Attempt to mint new batch with overlapping serials - should fail
        let result = client.try_mint_credits(
            &admin, &s(&env, "p2"), &50_i128, &2023_u32, &s(&env, "b2"), 
            &25_u64, &75_u64, &s(&env, "cid2"), &owner
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
            &owner, &s(&env, "b1"), &100_i128, &s(&env, "offset"), 
            &s(&env, "Corp"), &s(&env, "ret-004"), &s(&env, "tx123"), &s(&env, "QmCID")
        ).unwrap();

        // Attempt reversal
        let _ = client.try_undo_retire(&admin, &s(&env, "ret-004"));

        // Verify certificate is unchanged
        let cert = client.get_retirement_certificate(&s(&env, "ret-004")).unwrap();
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
            &admin, &s(&env, "p1"), &1000_i128, &2023_u32, &s(&env, "b1"), 
            &1_u64, &1000_u64, &s(&env, "cid"), &owner
        ).unwrap();

        // Retire 600 credits
        client.retire_credits(
            &owner, &s(&env, "b1"), &600_i128, &s(&env, "offset"), 
            &s(&env, "Corp"), &s(&env, "ret-005"), &s(&env, "tx"), &s(&env, "QmCID")
        ).unwrap();

        // Verify batch state
        let batch_after_retirement = client.get_credit_batch(&s(&env, "b1")).unwrap();
        assert_eq!(batch_after_retirement.status, CreditStatus::PartiallyRetired);
        assert_eq!(batch_after_retirement.amount, 1000); // Total amount unchanged

        // Attempt reversal
        let _ = client.try_undo_retire(&admin, &s(&env, "ret-005"));

        // Verify batch state is still the same - no change
        let batch_after_reversal_attempt = client.get_credit_batch(&s(&env, "b1")).unwrap();
        assert_eq!(batch_after_reversal_attempt.status, CreditStatus::PartiallyRetired);
        assert_eq!(batch_after_reversal_attempt.amount, 1000);

        // Verify only 400 credits remain active (1000 - 600)
        // Attempting to retire more than 400 should fail
        let result = client.try_retire_credits(
            &owner, &s(&env, "b1"), &500_i128, &s(&env, "offset2"), 
            &s(&env, "Corp"), &s(&env, "ret-006"), &s(&env, "tx2"), &s(&env, "QmCID2")
        );
        assert_eq!(result.unwrap_err(), Ok(CarbonError::InsufficientCredits));

        // Retiring exactly 400 should succeed
        client.retire_credits(
            &owner, &s(&env, "b1"), &400_i128, &s(&env, "offset3"), 
            &s(&env, "Corp"), &s(&env, "ret-007"), &s(&env, "tx3"), &s(&env, "QmCID3")
        ).unwrap();

        // Now batch should be fully retired
        let final_batch = client.get_credit_batch(&s(&env, "b1")).unwrap();
        assert_eq!(final_batch.status, CreditStatus::FullyRetired);
    }
}

