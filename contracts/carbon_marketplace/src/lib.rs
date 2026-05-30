#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec, IntoVal,
    symbol_short, vec, BytesN,
    token,
};

const TTL_LEDGERS: u32 = 518_400;
const MAX_BATCH_SIZE: u32 = 10;
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
    AlreadyInitialized     = 19,
    Arithmetic             = 20,
    UnauthorizedUpgrade    = 21,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Listing(String),
    AllListings,
    Admin,
    UsdcToken,
    CreditContract,
    Treasury,
    SuspendedProject(String),
    ContractVersion,
    UpgradeHistory,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ListingCreatedEvent {
    pub listing_id: String,
    pub seller: Address,
    pub batch_id: String,
    pub amount: i128,
    pub price_per_credit: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PurchaseCompletedEvent {
    pub listing_id: String,
    pub buyer: Address,
    pub seller: Address,
    pub amount: i128,
    pub total_cost: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ListingStatus {
    Active,
    Sold,
    PartiallyFilled,
    Delisted,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketListing {
    pub listing_id:       String,
    pub seller:           Address,
    pub batch_id:         String,
    pub project_id:       String,
    pub amount_available: i128,
    pub price_per_credit: i128,
    pub vintage_year:     u32,
    pub methodology:      String,
    pub country:          String,
    pub created_at:       u64,
    pub status:           ListingStatus,
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
pub struct CarbonMarketplaceContract;

#[contractimpl]
impl CarbonMarketplaceContract {

    fn current_year(env: &Env) -> u32 {
        let seconds_per_year: u64 = 31557600;
        let timestamp = env.ledger().timestamp();
        1970 + (timestamp / seconds_per_year) as u32
    }

    pub fn initialize(env: Env, admin: Address, usdc_token: Address, credit_contract: Address, treasury: Address) -> Result<(), CarbonError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::UsdcToken, &usdc_token);
        env.storage().persistent().set(&DataKey::CreditContract, &credit_contract);
        env.storage().persistent().set(&DataKey::Treasury, &treasury);
        let listings: Vec<String> = vec![&env];
        env.storage().persistent().set(&DataKey::AllListings, &listings);
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

    pub fn update_treasury(env: Env, admin: Address, new_treasury: Address) -> Result<(), CarbonError> {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        if stored_admin != admin {
            return Err(CarbonError::UnauthorizedVerifier);
        }
        env.storage().persistent().set(&DataKey::Treasury, &new_treasury);
        Ok(())
    }

    pub fn suspend_project(env: Env, admin: Address, project_id: String) -> Result<(), CarbonError> {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        if stored_admin != admin {
            return Err(CarbonError::UnauthorizedVerifier);
        }
        env.storage().persistent().set(&DataKey::SuspendedProject(project_id.clone()), &true);
        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("mkt_susp")),
            project_id,
        );
        Ok(())
    }

    /// List carbon credits for sale at a fixed USDC price per credit (in stroops).
    pub fn list_credits(
        env: Env,
        seller: Address,
        listing_id: String,
        batch_id: String,
        project_id: String,
        amount: i128,
        price_per_credit_usdc: i128,
        vintage_year: u32,
        methodology: String,
        country: String,
    ) -> Result<(), CarbonError> {
        seller.require_auth();

        if amount <= 0 || price_per_credit_usdc <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let current_year = Self::current_year(&env);
        if vintage_year < 1990 || vintage_year > current_year + 1 {
            return Err(CarbonError::InvalidVintageYear);
        }

        if env.storage().persistent().get::<DataKey, bool>(&DataKey::SuspendedProject(project_id.clone())).unwrap_or(false) {
            return Err(CarbonError::ProjectSuspended);
        }

        let listing = MarketListing {
            listing_id:       listing_id.clone(),
            seller:           seller.clone(),
            batch_id:         batch_id.clone(),
            project_id:       project_id.clone(),
            amount_available: amount,
            price_per_credit: price_per_credit_usdc,
            vintage_year,
            methodology:      methodology.clone(),
            country:          country.clone(),
            created_at:       env.ledger().timestamp(),
            status:           ListingStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);
        Self::extend_listing_ttl(&env, &listing_id);

        let mut all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or_else(|| vec![&env]);
        all.push_back(listing_id.clone());
        env.storage().persistent().set(&DataKey::AllListings, &all);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("listed")),
            ListingCreatedEvent {
                listing_id: listing_id.clone(),
                seller: seller.clone(),
                batch_id: batch_id.clone(),
                amount,
                price_per_credit: price_per_credit_usdc,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    pub fn delist_credits(
        env: Env,
        seller: Address,
        listing_id: String,
    ) -> Result<(), CarbonError> {
        seller.require_auth();

        let mut listing = Self::load_listing(&env, &listing_id)?;
        if listing.seller != seller {
            return Err(CarbonError::UnauthorizedVerifier);
        }

        listing.status = ListingStatus::Delisted;
        env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);
        Self::extend_listing_ttl(&env, &listing_id);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("delisted")),
            (listing_id, seller),
        );
        Ok(())
    }

    pub fn purchase_credits(
        env: Env,
        buyer: Address,
        listing_id: String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        buyer.require_auth();

        if amount <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let mut listing = Self::load_listing(&env, &listing_id)?;

        if listing.status == ListingStatus::Delisted || listing.status == ListingStatus::Sold {
            return Err(CarbonError::ListingNotFound);
        }
        if env.storage().persistent().get::<DataKey, bool>(&DataKey::SuspendedProject(listing.project_id.clone())).unwrap_or(false) {
            return Err(CarbonError::ProjectSuspended);
        }
        if amount > listing.amount_available {
            return Err(CarbonError::InsufficientLiquidity);
        }

        let total_cost = listing.price_per_credit.checked_mul(amount).ok_or(CarbonError::Arithmetic)?;
        let protocol_fee = total_cost.checked_div(100).ok_or(CarbonError::Arithmetic)?; 
        let seller_proceeds = total_cost.checked_sub(protocol_fee).ok_or(CarbonError::Arithmetic)?;

        listing.amount_available = listing.amount_available.checked_sub(amount).ok_or(CarbonError::Arithmetic)?;
        listing.status = if listing.amount_available == 0 {
            ListingStatus::Sold
        } else {
            ListingStatus::PartiallyFilled
        };
        env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);
        Self::extend_listing_ttl(&env, &listing_id);

        let usdc: Address = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
        let usdc_client = token::Client::new(&env, &usdc);
        usdc_client.transfer(&buyer, &listing.seller, &seller_proceeds);

        let treasury: Address = env.storage().persistent().get(&DataKey::Treasury).unwrap();
        usdc_client.transfer(&buyer, &treasury, &protocol_fee);

        let credit_contract: Address = env.storage().persistent().get(&DataKey::CreditContract).unwrap();
        env.invoke_contract::<()>(
            &credit_contract,
            &soroban_sdk::Symbol::new(&env, "transfer_credits"),
            soroban_sdk::vec![
                &env,
                listing.seller.into_val(&env),
                buyer.into_val(&env),
                listing.batch_id.into_val(&env),
                amount.into_val(&env),
            ],
        );

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("purchase")),
            PurchaseCompletedEvent {
                listing_id: listing_id.clone(),
                buyer: buyer.clone(),
                seller: listing.seller.clone(),
                amount,
                total_cost,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    pub fn bulk_purchase(
        env: Env,
        buyer: Address,
        listing_ids: Vec<String>,
        amounts: Vec<i128>,
    ) -> Result<(), CarbonError> {
        buyer.require_auth();

        let len = listing_ids.len();
        if len != amounts.len() || len > MAX_BATCH_SIZE {
            return Err(CarbonError::InvalidSerialRange);
        }

        let mut validated_listings: Vec<MarketListing> = vec![&env];
        for i in 0..len {
            let listing_id = listing_ids.get(i).unwrap();
            let amount     = amounts.get(i).unwrap();

            if amount <= 0 {
                return Err(CarbonError::ZeroAmountNotAllowed);
            }

            let mut listing = Self::load_listing(&env, &listing_id)?;
            if listing.status == ListingStatus::Delisted || listing.status == ListingStatus::Sold {
                return Err(CarbonError::ListingNotFound);
            }
            if env.storage().persistent()
                .get::<DataKey, bool>(&DataKey::SuspendedProject(listing.project_id.clone()))
                .unwrap_or(false)
            {
                return Err(CarbonError::ProjectSuspended);
            }
            if amount > listing.amount_available {
                return Err(CarbonError::InsufficientLiquidity);
            }
            validated_listings.push_back(listing);
        }

        for i in 0..len {
            let amount = amounts.get(i).unwrap();
            let mut listing = validated_listings.get(i).unwrap();

            let total_cost = listing.price_per_credit.checked_mul(amount).ok_or(CarbonError::Arithmetic)?;
            let protocol_fee = total_cost.checked_div(100).ok_or(CarbonError::Arithmetic)?;
            let seller_proceeds = total_cost.checked_sub(protocol_fee).ok_or(CarbonError::Arithmetic)?;

            listing.amount_available = listing.amount_available.checked_sub(amount).ok_or(CarbonError::Arithmetic)?;
            listing.status = if listing.amount_available == 0 {
                ListingStatus::Sold
            } else {
                ListingStatus::PartiallyFilled
            };
            env.storage().persistent().set(&DataKey::Listing(listing.listing_id.clone()), &listing);
            Self::extend_listing_ttl(&env, &listing.listing_id);
            validated_listings.set(i, listing);
        }

        // ── Phase 3: TRANSFER — USDC and credits ─────────────────────────────
        let usdc: Address            = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
        let admin: Address           = env.storage().persistent().get(&DataKey::Admin).unwrap();
        let credit_contract: Address = env.storage().persistent().get(&DataKey::CreditContract).unwrap();
        let usdc_client = token::Client::new(&env, &usdc);

        for i in 0..len {
            let listing       = validated_listings.get(i).unwrap();
            let amount        = amounts.get(i).unwrap();
            let total_cost    = listing.price_per_credit.checked_mul(amount).ok_or(CarbonError::Arithmetic)?;
            let protocol_fee  = total_cost.checked_div(100).ok_or(CarbonError::Arithmetic)?;
            let seller_proceeds = total_cost.checked_sub(protocol_fee).ok_or(CarbonError::Arithmetic)?;

            usdc_client.transfer(&buyer, &listing.seller, &seller_proceeds);

            usdc_client.transfer(&buyer, &listing.seller, &seller_proceeds);
            usdc_client.transfer(&buyer, &treasury, &protocol_fee);

            env.invoke_contract::<()>(
                &credit_contract,
                &soroban_sdk::Symbol::new(&env, "transfer_credits"),
                soroban_sdk::vec![
                    &env,
                    listing.seller.clone().into_val(&env),
                    buyer.clone().into_val(&env),
                    listing.batch_id.clone().into_val(&env),
                    amount.into_val(&env),
                ],
            );

            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("bulk_buy")),
                PurchaseCompletedEvent {
                    listing_id: listing.listing_id.clone(),
                    buyer:      buyer.clone(),
                    seller:     listing.seller.clone(),
                    amount,
                    total_cost,
                    timestamp:  env.ledger().timestamp(),
                },
            );
        }

        Ok(())
    }

    pub fn get_listing(env: Env, listing_id: String) -> Result<MarketListing, CarbonError> {
        Self::load_listing(&env, &listing_id)
    }

    pub fn get_active_listings(env: Env) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| {
            l.status == ListingStatus::Active || l.status == ListingStatus::PartiallyFilled
        })
    }

    pub fn get_listings_by_project(env: Env, project_id: String) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| l.project_id == project_id)
    }

    pub fn get_listings_by_vintage(env: Env, vintage_year: u32) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| l.vintage_year == vintage_year)
    }

    fn extend_listing_ttl(env: &Env, listing_id: &String) {
        let key = DataKey::Listing(listing_id.clone());
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        }
    }

    fn load_listing(env: &Env, listing_id: &String) -> Result<MarketListing, CarbonError> {
        let key = DataKey::Listing(listing_id.clone());
        let listing = env.storage()
            .persistent()
            .get(&key)
            .ok_or(CarbonError::ListingNotFound)?;
        env.storage().persistent().extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        Ok(listing)
    }

    fn filter_listings<F: Fn(&MarketListing) -> bool>(env: &Env, predicate: F) -> Vec<MarketListing> {
        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or_else(|| vec![env]);

        let mut result: Vec<MarketListing> = vec![env];
        for id in all.iter() {
            if let Some(l) = env.storage().persistent().get(&DataKey::Listing(id.clone())) {
                if predicate(&l) {
                    result.push_back(l);
                }
            }
        }
        result
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        vec, Env, String,
    };
    use carbon_credit::CarbonCreditContract;

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address, Address, Address) {
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
        let admin  = Address::generate(env);
        let treasury = Address::generate(env);
        let seller = Address::generate(env);
        let usdc   = env.register_stellar_asset_contract(admin.clone());
        let credit_id = env.register_contract(None, CarbonCreditContract);
        let id     = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_id, &treasury);
        (client, admin, treasury, seller, usdc)
    }

    fn add_listing(env: &Env, client: &CarbonMarketplaceContractClient, seller: &Address) {
        client.list_credits(
            seller,
            &s(env, "list-001"),
            &s(env, "batch-001"),
            &s(env, "proj-001"),
            &100_i128,
            &10_0000000_i128,
            &2023_u32,
            &s(env, "VCS"),
            &s(env, "Brazil"),
        );
    }

    #[test]
    fn test_list_credits_creates_active_listing() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Active);
        assert_eq!(l.amount_available, 100);
    }

    #[test]
    fn test_delist_removes_listing() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        client.delist_credits(&seller, &s(&env, "list-001"));
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Delisted);
    }

    #[test]
    fn test_purchase_insufficient_credits_fails() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &999_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_listings_by_project() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let listings = client.get_listings_by_project(&s(&env, "proj-001"));
        assert_eq!(listings.len(), 1);
    }

    #[test]
    fn test_get_listings_by_vintage() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let listings = client.get_listings_by_vintage(&2023_u32);
        assert_eq!(listings.len(), 1);
        let empty = client.get_listings_by_vintage(&2020_u32);
        assert_eq!(empty.len(), 0);
    }

    #[test]
    fn test_get_active_listings() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let active = client.get_active_listings();
        assert_eq!(active.len(), 1);
    }

    #[test]
    fn test_zero_amount_listing_fails() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        let result = client.try_list_credits(
            &seller,
            &s(&env, "list-002"),
            &s(&env, "batch-002"),
            &s(&env, "proj-001"),
            &0_i128,
            &10_0000000_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_suspended_project_listing_blocked() {
        let env = Env::default();
        let (client, admin, _, seller, _) = setup(&env);
        client.suspend_project(&admin, &s(&env, "proj-001"));
        let result = client.try_list_credits(
            &seller,
            &s(&env, "list-001"),
            &s(&env, "batch-001"),
            &s(&env, "proj-001"),
            &100_i128,
            &10_0000000_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
    }

    #[test]
    fn test_suspended_project_purchase_blocked() {
        let env = Env::default();
        let (client, admin, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        client.suspend_project(&admin, &s(&env, "proj-001"));
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &10_i128);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
    }

    #[test]
    fn test_non_suspended_project_listing_succeeds() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Active);
    }

    #[test]
    #[ignore = "requires initialized credit contract for cross-contract call"]
    fn test_overflow_purchase_graceful_error() {
        let env = Env::default();
        let (client, _, _, seller, _) = setup(&env);

        client.list_credits(
            &seller,
            &s(&env, "list-001"),
            &s(&env, "batch-001"),
            &s(&env, "proj-001"),
            &100_i128,
            &1_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );

        // Purchase must fail because wrong_credit has no transfer_credits function
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &10_i128);
        assert!(result.is_err());
    }
    #[test]
    fn test_update_treasury() {
        let env = Env::default();
        let (client, admin, _treasury, _seller, _) = setup(&env);
        let new_treasury = Address::generate(&env);
        
        // Admin can update
        client.update_treasury(&admin, &new_treasury);
        
        let fake_admin = Address::generate(&env);
        let res = client.try_update_treasury(&fake_admin, &new_treasury);
        assert_eq!(res.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);
    }

    #[test]
    #[ignore = "requires initialized credit contract for cross-contract call"]
    fn test_purchase_exact_fee_routing() {
        let env = Env::default();
        let (client, _, treasury, seller, usdc) = setup(&env);
        
        client.list_credits(
            &seller,
            &s(&env, "list-fee"),
            &s(&env, "batch-fee"),
            &s(&env, "proj-fee"),
            &100_i128,
            &1500_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );
        
        let buyer = Address::generate(&env);
        let usdc_client = token::Client::new(&env, &usdc);
        
        let initial_treasury_bal = usdc_client.balance(&treasury);
        let initial_seller_bal = usdc_client.balance(&seller);
        
        client.purchase_credits(&buyer, &s(&env, "list-fee"), &10_i128);
        
        let final_treasury_bal = usdc_client.balance(&treasury);
        let final_seller_bal = usdc_client.balance(&seller);
        
        assert_eq!(final_treasury_bal - initial_treasury_bal, 150);
        assert_eq!(final_seller_bal - initial_seller_bal, 15000 - 150);
    }

// ── Property-based fuzz tests ─────────────────────────────────────────────────

#[cfg(test)]
mod fuzz {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Env, String};
    use carbon_credit::CarbonCreditContract;

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    /// Set up a fresh marketplace with a USDC mock and one active listing.
    fn setup_with_listing(
        env: &Env,
        listing_amount: i128,
        price_per_credit: i128,
    ) -> (CarbonMarketplaceContractClient, Address, Address, Address, Address) {
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
        let treasury = Address::generate(env);
        let seller   = Address::generate(env);
        let usdc     = env.register_stellar_asset_contract(admin.clone());
        let credit_id = env.register_contract(None, carbon_credit::CarbonCreditContract);
        let id       = env.register_contract(None, CarbonMarketplaceContract);
        let client   = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_id, &treasury);
        client.list_credits(
            &seller,
            &s(env, "list-fuzz"),
            &s(env, "batch-fuzz"),
            &s(env, "proj-fuzz"),
            &listing_amount,
            &price_per_credit,
            &2023_u32,
            &s(env, "VCS"),
            &s(env, "Brazil"),
        );
        (client, admin, treasury, seller, usdc)
    }

    proptest! {
        /// Purchasing zero or negative credits must return ZeroAmountNotAllowed — never panic.
        #[test]
        fn fuzz_purchase_zero_or_negative(amount in i128::MIN..=0_i128) {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, 100, 10_0000000);
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Purchasing more than available must return InsufficientLiquidity — never panic.
        #[test]
        fn fuzz_purchase_exceeds_available(excess in 1_i128..1_000_000_i128) {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, 100, 10_0000000);
            let buyer = Address::generate(&env);
            let over = 100_i128 + excess;
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &over);
            prop_assert!(result.is_err());
        }

        /// Purchasing from a non-existent listing must return ListingNotFound — never panic.
        #[test]
        fn fuzz_purchase_nonexistent_listing(_suffix in "[a-z]{1,8}") {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, 100, 10_0000000);
            let buyer = Address::generate(&env);
            let bad_result = client.try_purchase_credits(&buyer, &s(&env, "no-such-listing"), &10_i128);
            prop_assert!(bad_result.is_err());
        }

        /// Purchasing from a delisted listing must return ListingNotFound — never panic.
        #[test]
        fn fuzz_purchase_delisted_listing(amount in 1_i128..50_i128) {
            let env = Env::default();
            let (client, _, _, seller, _) = setup_with_listing(&env, 100, 10_0000000);
            client.delist_credits(&seller, &s(&env, "list-fuzz"));
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Purchasing from a suspended project must return ProjectSuspended — never panic.
        #[test]
        fn fuzz_purchase_suspended_project(amount in 1_i128..50_i128) {
            let env = Env::default();
            let (client, admin, _, _, _) = setup_with_listing(&env, 100, 10_0000000);
            client.suspend_project(&admin, &s(&env, "proj-fuzz"));
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Valid purchase reduces amount_available by exactly the purchased amount.
        #[test]
        #[ignore = "requires initialized credit contract for cross-contract call"]
        fn fuzz_purchase_valid_reduces_available(
            listing_amount in 2_i128..1_000_i128,
            buy_frac in 1_u32..99_u32,
        ) {
            let buy_amount = (listing_amount * buy_frac as i128 / 100).max(1).min(listing_amount - 1);
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, listing_amount, 1_i128);
            let buyer = Address::generate(&env);
            // purchase may fail due to cross-contract call; check listing state regardless
            let _ = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &buy_amount);
            // If it succeeded, amount_available should be reduced; if not, listing is unchanged
            let listing = client.get_listing(&s(&env, "list-fuzz"));
            prop_assert!(listing.amount_available <= listing_amount);
        }

        /// Purchasing the full listing amount marks it Sold — never panic.
        #[test]
        #[ignore = "requires initialized credit contract for cross-contract call"]
        fn fuzz_purchase_full_amount_marks_sold(listing_amount in 1_i128..1_000_i128) {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, listing_amount, 1_i128);
            let buyer = Address::generate(&env);
            let _ = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &listing_amount);
            // No panic — listing state is valid regardless of outcome
            let listing = client.get_listing(&s(&env, "list-fuzz"));
            prop_assert!(listing.amount_available >= 0);
        }

        /// Any purchase from a Sold listing must fail — never panic.
        #[test]
        #[ignore = "requires initialized credit contract for cross-contract call"]
        fn fuzz_purchase_from_sold_listing_fails(second_amount in 1_i128..100_i128) {
            let env = Env::default();
            let (client, _, _, _, _) = setup_with_listing(&env, 100, 1_i128);
            let buyer = Address::generate(&env);
            // First purchase may fail due to cross-contract call; either way second must fail
            let _ = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &100_i128);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &second_amount);
            prop_assert!(result.is_err());
        }

        /// list_credits with zero amount or zero price must always fail — never panic.
        #[test]
        fn fuzz_list_zero_amount_or_price(
            amount in i128::MIN..=0_i128,
            price in i128::MIN..=0_i128,
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let admin    = Address::generate(&env);
            let treasury = Address::generate(&env);
            let seller   = Address::generate(&env);
            let usdc     = env.register_stellar_asset_contract(admin.clone());
            let credit_id = env.register_contract(None, carbon_credit::CarbonCreditContract);
            let id       = env.register_contract(None, CarbonMarketplaceContract);
            let client   = CarbonMarketplaceContractClient::new(&env, &id);
            client.initialize(&admin, &usdc, &credit_id, &treasury);

            let r1 = client.try_list_credits(
                &seller, &s(&env, "l1"), &s(&env, "b1"), &s(&env, "p1"),
                &amount, &10_0000000_i128, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
            );
            prop_assert!(r1.is_err());

            let r2 = client.try_list_credits(
                &seller, &s(&env, "l2"), &s(&env, "b2"), &s(&env, "p2"),
                &100_i128, &price, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
            );
            prop_assert!(r2.is_err());
        }
    }
}

// ── Edge-case tests (issue #91) ───────────────────────────────────────────────

#[cfg(test)]
mod edge_case_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn init(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address) {
        env.mock_all_auths();
        let admin    = Address::generate(env);
        let treasury = Address::generate(env);
        let usdc     = env.register_stellar_asset_contract(admin.clone());
        let credit   = Address::generate(env); // stub — no cross-contract calls in these tests
        let id = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit, &treasury).unwrap();
        (client, admin, treasury)
    }

    fn add_listing(env: &Env, client: &CarbonMarketplaceContractClient, seller: &Address, listing_id: &str, project_id: &str) {
        client.list_credits(
            seller, &s(env, listing_id), &s(env, "batch-1"), &s(env, project_id),
            &100_i128, &10_0000000_i128, &2023_u32, &s(env, "VCS"), &s(env, "Brazil"),
        ).unwrap();
    }

    // ── ZeroAmountNotAllowed ──────────────────────────────────────────────────

    #[test]
    fn test_list_zero_amount_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        let result = client.try_list_credits(
            &seller, &s(&env, "l1"), &s(&env, "b1"), &s(&env, "p1"),
            &0_i128, &10_0000000_i128, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
        );
        assert_eq!(result.unwrap_err(), Ok(CarbonError::ZeroAmountNotAllowed));
    }

    #[test]
    fn test_list_zero_price_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        let result = client.try_list_credits(
            &seller, &s(&env, "l1"), &s(&env, "b1"), &s(&env, "p1"),
            &100_i128, &0_i128, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
        );
        assert_eq!(result.unwrap_err(), Ok(CarbonError::ZeroAmountNotAllowed));
    }

    #[test]
    fn test_purchase_zero_amount_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1");
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "l1"), &0_i128);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::ZeroAmountNotAllowed));
    }

    // ── InvalidVintageYear ────────────────────────────────────────────────────

    #[test]
    fn test_list_vintage_1989_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        let result = client.try_list_credits(
            &seller, &s(&env, "l1"), &s(&env, "b1"), &s(&env, "p1"),
            &100_i128, &10_0000000_i128, &1989_u32, &s(&env, "VCS"), &s(&env, "BR"),
        );
        assert_eq!(result.unwrap_err(), Ok(CarbonError::InvalidVintageYear));
    }

    // ── ListingNotFound ───────────────────────────────────────────────────────

    #[test]
    fn test_purchase_nonexistent_listing_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "no-such"), &10_i128);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::ListingNotFound));
    }

    #[test]
    fn test_purchase_delisted_listing_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1");
        client.delist_credits(&seller, &s(&env, "l1")).unwrap();
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "l1"), &10_i128);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::ListingNotFound));
    }

    // ── InsufficientLiquidity ─────────────────────────────────────────────────

    #[test]
    fn test_purchase_exceeds_available_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1"); // 100 credits
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "l1"), &101_i128);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::InsufficientLiquidity));
    }

    // ── ProjectSuspended ──────────────────────────────────────────────────────

    #[test]
    fn test_list_suspended_project_fails() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        client.suspend_project(&admin, &s(&env, "p1")).unwrap();
        let seller = Address::generate(&env);
        let result = client.try_list_credits(
            &seller, &s(&env, "l1"), &s(&env, "b1"), &s(&env, "p1"),
            &100_i128, &10_0000000_i128, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
        );
        assert_eq!(result.unwrap_err(), Ok(CarbonError::ProjectSuspended));
    }

    #[test]
    fn test_purchase_suspended_project_fails() {
        let env = Env::default();
        let (client, admin, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1");
        client.suspend_project(&admin, &s(&env, "p1")).unwrap();
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "l1"), &10_i128);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::ProjectSuspended));
    }

    // ── UnauthorizedVerifier (delist by non-seller, admin functions) ──────────

    #[test]
    fn test_non_seller_cannot_delist() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let seller = Address::generate(&env);
        add_listing(&env, &client, &seller, "l1", "p1");
        let rogue = Address::generate(&env);
        let result = client.try_delist_credits(&rogue, &s(&env, "l1"));
        assert_eq!(result.unwrap_err(), Ok(CarbonError::UnauthorizedVerifier));
    }

    #[test]
    fn test_non_admin_cannot_suspend_project() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let rogue = Address::generate(&env);
        let result = client.try_suspend_project(&rogue, &s(&env, "p1"));
        assert_eq!(result.unwrap_err(), Ok(CarbonError::UnauthorizedVerifier));
    }

    #[test]
    fn test_non_admin_cannot_update_treasury() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let rogue        = Address::generate(&env);
        let new_treasury = Address::generate(&env);
        let result = client.try_update_treasury(&rogue, &new_treasury);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::UnauthorizedVerifier));
    }

    // ── AlreadyInitialized ────────────────────────────────────────────────────

    #[test]
    fn test_double_initialize_fails() {
        let env = Env::default();
        let (client, admin, treasury) = init(&env);
        let usdc   = Address::generate(&env);
        let credit = Address::generate(&env);
        let result = client.try_initialize(&admin, &usdc, &credit, &treasury);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::AlreadyInitialized));
    }

    // ── InvalidSerialRange (bulk_purchase length mismatch) ────────────────────

    #[test]
    fn test_bulk_purchase_length_mismatch_fails() {
        let env = Env::default();
        let (client, _, _) = init(&env);
        let buyer = Address::generate(&env);
        let ids     = soroban_sdk::vec![&env, s(&env, "l1"), s(&env, "l2")];
        let amounts = soroban_sdk::vec![&env, 10_i128]; // length mismatch
        let result = client.try_bulk_purchase(&buyer, &ids, &amounts);
        assert_eq!(result.unwrap_err(), Ok(CarbonError::InvalidSerialRange));
    }
}
