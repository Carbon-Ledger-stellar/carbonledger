//! # carbon_escrow
//!
//! Escrow contract for carbon credit trades on Stellar / Soroban.
//!
//! ## Lifecycle
//!
//! ```text
//! Buyer calls create_escrow()
//!   → Locks USDC from buyer into escrow account
//!   → Records expected credit batch_id and amount
//!   → Status: Active
//!
//! Seller calls confirm_escrow() (after transferring credits)
//!   → Records seller confirmation
//!   → Status: SellerConfirmed
//!
//! Buyer calls confirm_escrow() (after verifying credits arrived)
//!   → Releases locked USDC to seller
//!   → Status: Released
//!
//! If timeout elapses before mutual confirmation:
//!   Either party calls refund_escrow()
//!   → Returns USDC to buyer
//!   → Status: Refunded
//!
//! Admin may call cancel_escrow() to force-refund in dispute cases.
//! ```
//!
//! Closes #1002.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default escrow timeout: 7 days in seconds.
pub const DEFAULT_TIMEOUT_SECS: u64 = 7 * 24 * 60 * 60;

/// Storage TTL: ~30 days in ledgers (assuming ~5-second ledger close time).
const TTL_LEDGERS: u32 = 518_400;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    /// The specified escrow ID does not exist.
    EscrowNotFound = 1,
    /// The escrow has already been released or refunded.
    EscrowAlreadyClosed = 2,
    /// Caller is not a party to this escrow.
    Unauthorized = 3,
    /// The escrow timeout has not yet elapsed; cannot refund early.
    TimeoutNotElapsed = 4,
    /// The amount must be greater than zero.
    ZeroAmountNotAllowed = 5,
    /// Contract has already been initialized.
    AlreadyInitialized = 6,
    /// The escrow is still within the active window; use confirm instead.
    EscrowStillActive = 7,
    /// Integer overflow in arithmetic.
    Arithmetic = 8,
    /// Buyer has already confirmed.
    BuyerAlreadyConfirmed = 9,
    /// Seller has already confirmed.
    SellerAlreadyConfirmed = 10,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(String),
    Admin,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Status of an escrow agreement.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    /// Funds locked, waiting for both parties to confirm.
    Active,
    /// Seller has signalled that credits were transferred; waiting for buyer.
    SellerConfirmed,
    /// Buyer has signalled acceptance; waiting for seller.
    BuyerConfirmed,
    /// Both parties confirmed — funds released to seller.
    Released,
    /// Timeout elapsed or admin cancelled — funds returned to buyer.
    Refunded,
}

/// On-chain escrow record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowRecord {
    /// Unique ID for this escrow (caller-supplied; e.g., UUID or hash).
    pub escrow_id: String,
    /// Buyer address. Deposited USDC and will receive credits.
    pub buyer: Address,
    /// Seller address. Will receive USDC upon mutual confirmation.
    pub seller: Address,
    /// USDC token contract address (SAC).
    pub usdc_token: Address,
    /// Amount of USDC locked (in stroops).
    pub usdc_amount: i128,
    /// ID of the carbon credit batch being traded.
    pub credit_batch_id: String,
    /// Number of credits expected.
    pub credit_amount: i128,
    /// Unix timestamp after which a refund may be claimed.
    pub timeout_at: u64,
    /// Whether the buyer has confirmed receipt of credits.
    pub buyer_confirmed: bool,
    /// Whether the seller has confirmed transfer of credits.
    pub seller_confirmed: bool,
    /// Current state of this escrow.
    pub status: EscrowStatus,
    /// Unix timestamp when this escrow was created.
    pub created_at: u64,
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowCreatedEvent {
    pub escrow_id: String,
    pub buyer: Address,
    pub seller: Address,
    pub usdc_amount: i128,
    pub credit_batch_id: String,
    pub credit_amount: i128,
    pub timeout_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowConfirmedEvent {
    pub escrow_id: String,
    pub confirmed_by: Address,
    pub buyer_confirmed: bool,
    pub seller_confirmed: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowReleasedEvent {
    pub escrow_id: String,
    pub buyer: Address,
    pub seller: Address,
    pub usdc_amount: i128,
    pub released_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowRefundedEvent {
    pub escrow_id: String,
    pub buyer: Address,
    pub usdc_amount: i128,
    pub refunded_at: u64,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct CarbonEscrowContract;

#[contractimpl]
impl CarbonEscrowContract {
    // ── Initialization ───────────────────────────────────────────────────────

    /// Initialize the escrow contract with an admin address.
    /// The admin can force-cancel disputed escrows.
    pub fn initialize(env: Env, admin: Address) -> Result<(), EscrowError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        Ok(())
    }

    // ── Core escrow operations ───────────────────────────────────────────────

    /// Lock USDC into escrow and record the expected credit batch.
    ///
    /// Transfers `usdc_amount` stroops from `buyer` to the escrow contract's
    /// own account. The escrow becomes active immediately and expires at
    /// `env.ledger().timestamp() + timeout_secs` (defaulting to 7 days if 0).
    pub fn create_escrow(
        env: Env,
        buyer: Address,
        escrow_id: String,
        seller: Address,
        usdc_token: Address,
        usdc_amount: i128,
        credit_batch_id: String,
        credit_amount: i128,
        timeout_secs: u64,
    ) -> Result<(), EscrowError> {
        buyer.require_auth();

        if usdc_amount <= 0 {
            return Err(EscrowError::ZeroAmountNotAllowed);
        }
        if credit_amount <= 0 {
            return Err(EscrowError::ZeroAmountNotAllowed);
        }

        // Reject duplicate escrow IDs.
        if env
            .storage()
            .persistent()
            .has(&DataKey::Escrow(escrow_id.clone()))
        {
            return Err(EscrowError::EscrowAlreadyClosed);
        }

        let effective_timeout = if timeout_secs == 0 {
            DEFAULT_TIMEOUT_SECS
        } else {
            timeout_secs
        };

        let now = env.ledger().timestamp();
        let timeout_at = now
            .checked_add(effective_timeout)
            .ok_or(EscrowError::Arithmetic)?;

        // Lock USDC from buyer into this contract.
        let token = token::Client::new(&env, &usdc_token);
        token.transfer(&buyer, &env.current_contract_address(), &usdc_amount);

        let record = EscrowRecord {
            escrow_id: escrow_id.clone(),
            buyer: buyer.clone(),
            seller: seller.clone(),
            usdc_token: usdc_token.clone(),
            usdc_amount,
            credit_batch_id: credit_batch_id.clone(),
            credit_amount,
            timeout_at,
            buyer_confirmed: false,
            seller_confirmed: false,
            status: EscrowStatus::Active,
            created_at: now,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id.clone()), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Escrow(escrow_id.clone()),
            TTL_LEDGERS,
            TTL_LEDGERS,
        );

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("created")),
            EscrowCreatedEvent {
                escrow_id,
                buyer,
                seller,
                usdc_amount,
                credit_batch_id,
                credit_amount,
                timeout_at,
            },
        );
        Ok(())
    }

    /// Register a party's confirmation.
    ///
    /// * Seller calls this after transferring credits off-chain (or via a
    ///   cross-contract call) to signal readiness.
    /// * Buyer calls this after verifying the credits arrived.
    ///
    /// When both parties have confirmed, USDC is automatically released to
    /// the seller.
    pub fn confirm_escrow(
        env: Env,
        caller: Address,
        escrow_id: String,
    ) -> Result<EscrowStatus, EscrowError> {
        caller.require_auth();

        let mut record = Self::load_escrow(&env, &escrow_id)?;

        // Only accept confirmations on active escrows.
        if record.status == EscrowStatus::Released
            || record.status == EscrowStatus::Refunded
        {
            return Err(EscrowError::EscrowAlreadyClosed);
        }

        // Identify which party is confirming.
        if caller == record.buyer {
            if record.buyer_confirmed {
                return Err(EscrowError::BuyerAlreadyConfirmed);
            }
            record.buyer_confirmed = true;
        } else if caller == record.seller {
            if record.seller_confirmed {
                return Err(EscrowError::SellerAlreadyConfirmed);
            }
            record.seller_confirmed = true;
        } else {
            return Err(EscrowError::Unauthorized);
        }

        // Update intermediate status.
        record.status = match (record.buyer_confirmed, record.seller_confirmed) {
            (true, false) => EscrowStatus::BuyerConfirmed,
            (false, true) => EscrowStatus::SellerConfirmed,
            _ => record.status.clone(),
        };

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("confirm")),
            EscrowConfirmedEvent {
                escrow_id: escrow_id.clone(),
                confirmed_by: caller.clone(),
                buyer_confirmed: record.buyer_confirmed,
                seller_confirmed: record.seller_confirmed,
            },
        );

        // Mutual agreement reached — release funds.
        if record.buyer_confirmed && record.seller_confirmed {
            Self::release_funds(&env, &mut record)?;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id.clone()), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Escrow(escrow_id.clone()),
            TTL_LEDGERS,
            TTL_LEDGERS,
        );

        Ok(record.status)
    }

    /// Refund the locked USDC to the buyer after the timeout has elapsed.
    ///
    /// Either party (or any address) may call this once the timeout is reached.
    /// This provides the on-chain safety valve when a counterparty goes silent.
    pub fn refund_escrow(
        env: Env,
        escrow_id: String,
    ) -> Result<(), EscrowError> {
        let mut record = Self::load_escrow(&env, &escrow_id)?;

        if record.status == EscrowStatus::Released
            || record.status == EscrowStatus::Refunded
        {
            return Err(EscrowError::EscrowAlreadyClosed);
        }

        let now = env.ledger().timestamp();
        if now <= record.timeout_at {
            return Err(EscrowError::TimeoutNotElapsed);
        }

        Self::return_funds(&env, &mut record)?;

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id.clone()), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Escrow(escrow_id.clone()),
            TTL_LEDGERS,
            TTL_LEDGERS,
        );
        Ok(())
    }

    /// Admin-only: force-cancel an active escrow and return funds to buyer.
    ///
    /// Intended for dispute resolution; bypasses the timeout check.
    pub fn cancel_escrow(
        env: Env,
        admin: Address,
        escrow_id: String,
    ) -> Result<(), EscrowError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let mut record = Self::load_escrow(&env, &escrow_id)?;

        if record.status == EscrowStatus::Released
            || record.status == EscrowStatus::Refunded
        {
            return Err(EscrowError::EscrowAlreadyClosed);
        }

        Self::return_funds(&env, &mut record)?;

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id.clone()), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Escrow(escrow_id.clone()),
            TTL_LEDGERS,
            TTL_LEDGERS,
        );
        Ok(())
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /// Returns the escrow record for the given ID.
    pub fn get_escrow(env: Env, escrow_id: String) -> Result<EscrowRecord, EscrowError> {
        Self::load_escrow(&env, &escrow_id)
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn load_escrow(env: &Env, escrow_id: &String) -> Result<EscrowRecord, EscrowError> {
        let key = DataKey::Escrow(escrow_id.clone());
        let record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::EscrowNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        Ok(record)
    }

    /// Transfer USDC to the seller and mark the escrow as Released.
    fn release_funds(env: &Env, record: &mut EscrowRecord) -> Result<(), EscrowError> {
        let token = token::Client::new(env, &record.usdc_token);
        token.transfer(
            &env.current_contract_address(),
            &record.seller,
            &record.usdc_amount,
        );
        let now = env.ledger().timestamp();
        record.status = EscrowStatus::Released;

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("released")),
            EscrowReleasedEvent {
                escrow_id: record.escrow_id.clone(),
                buyer: record.buyer.clone(),
                seller: record.seller.clone(),
                usdc_amount: record.usdc_amount,
                released_at: now,
            },
        );
        Ok(())
    }

    /// Transfer USDC back to the buyer and mark the escrow as Refunded.
    fn return_funds(env: &Env, record: &mut EscrowRecord) -> Result<(), EscrowError> {
        let token = token::Client::new(env, &record.usdc_token);
        token.transfer(
            &env.current_contract_address(),
            &record.buyer,
            &record.usdc_amount,
        );
        let now = env.ledger().timestamp();
        record.status = EscrowStatus::Refunded;

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refunded")),
            EscrowRefundedEvent {
                escrow_id: record.escrow_id.clone(),
                buyer: record.buyer.clone(),
                usdc_amount: record.usdc_amount,
                refunded_at: now,
            },
        );
        Ok(())
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), EscrowError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::Unauthorized)?;
        if &admin != caller {
            return Err(EscrowError::Unauthorized);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Env, String,
    };

    fn s(env: &Env, v: &str) -> String {
        String::from_str(env, v)
    }

    fn setup(env: &Env) -> (CarbonEscrowContractClient, Address, Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let usdc = env.register_stellar_asset_contract(admin.clone());

        let escrow_id = env.register_contract(None, CarbonEscrowContract);
        let client = CarbonEscrowContractClient::new(env, &escrow_id);
        client.initialize(&admin);

        // Fund buyer with USDC.
        let usdc_admin =
            soroban_sdk::token::StellarAssetClient::new(env, &usdc);
        usdc_admin.mint(&buyer, &1_000_000_000i128);

        (client, admin, buyer, seller, usdc)
    }

    #[test]
    fn test_create_and_mutual_confirm_releases_funds() {
        let env = Env::default();
        let (client, _admin, buyer, seller, usdc) = setup(&env);

        // Set ledger to a deterministic timestamp.
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 22,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        let amount: i128 = 500_000_000;
        client.create_escrow(
            &buyer,
            &s(&env, "ESC-001"),
            &seller,
            &usdc,
            &amount,
            &s(&env, "BATCH-A"),
            &100i128,
            &0u64, // use default 7-day timeout
        );

        // Check escrow is active.
        let record = client.get_escrow(&s(&env, "ESC-001"));
        assert_eq!(record.status, EscrowStatus::Active);
        assert_eq!(record.usdc_amount, amount);

        // Seller confirms first.
        let status = client.confirm_escrow(&seller, &s(&env, "ESC-001"));
        assert_eq!(status, EscrowStatus::SellerConfirmed);

        // Buyer confirms — triggers release.
        let status = client.confirm_escrow(&buyer, &s(&env, "ESC-001"));
        assert_eq!(status, EscrowStatus::Released);

        let usdc_client = soroban_sdk::token::Client::new(&env, &usdc);
        assert_eq!(usdc_client.balance(&seller), amount);
    }

    #[test]
    fn test_refund_after_timeout() {
        let env = Env::default();
        let (client, _admin, buyer, seller, usdc) = setup(&env);

        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 22,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        let amount: i128 = 500_000_000;
        client.create_escrow(
            &buyer,
            &s(&env, "ESC-002"),
            &seller,
            &usdc,
            &amount,
            &s(&env, "BATCH-B"),
            &50i128,
            &3600u64, // 1-hour timeout
        );

        // Advance time past timeout.
        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1_000_000 + 3601,
            protocol_version: 22,
            sequence_number: 200,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        client.refund_escrow(&s(&env, "ESC-002"));

        let record = client.get_escrow(&s(&env, "ESC-002"));
        assert_eq!(record.status, EscrowStatus::Refunded);

        let usdc_client = soroban_sdk::token::Client::new(&env, &usdc);
        // Buyer gets their USDC back.
        assert_eq!(usdc_client.balance(&buyer), 1_000_000_000i128);
    }

    #[test]
    fn test_refund_before_timeout_fails() {
        let env = Env::default();
        let (client, _admin, buyer, seller, usdc) = setup(&env);

        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 22,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        let amount: i128 = 500_000_000;
        client.create_escrow(
            &buyer,
            &s(&env, "ESC-003"),
            &seller,
            &usdc,
            &amount,
            &s(&env, "BATCH-C"),
            &50i128,
            &3600u64,
        );

        // Do NOT advance time — refund should fail.
        let result = client.try_refund_escrow(&s(&env, "ESC-003"));
        assert!(result.is_err());
    }

    #[test]
    fn test_cancel_escrow_by_admin() {
        let env = Env::default();
        let (client, admin, buyer, seller, usdc) = setup(&env);

        env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 22,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 6_312_000,
        });

        let amount: i128 = 500_000_000;
        client.create_escrow(
            &buyer,
            &s(&env, "ESC-004"),
            &seller,
            &usdc,
            &amount,
            &s(&env, "BATCH-D"),
            &50i128,
            &3600u64,
        );

        // Admin force-cancels.
        client.cancel_escrow(&admin, &s(&env, "ESC-004"));
        let record = client.get_escrow(&s(&env, "ESC-004"));
        assert_eq!(record.status, EscrowStatus::Refunded);
    }
}
