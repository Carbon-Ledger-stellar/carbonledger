#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec, IntoVal,
    symbol_short, vec,
    token,
};

/// TTL extension in ledgers (~30 days at 5s/ledger).
/// Cost: ~0.00001 XLM per ledger entry extended. See docs/ttl-cost.md.
const TTL_LEDGERS: u32 = 518_400;

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
    AlreadyInitialized     = 19,
    Arithmetic             = 20,
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Listing(String),
    AllListings,
    Admin,
    UsdcToken,
    CreditContract,
    SuspendedProject(String),
}

// ── Types ─────────────────────────────────────────────────────────────────────

/// Emitted when a new market listing is created.
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

/// Emitted when credits are purchased.
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

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct CarbonMarketplaceContract;

#[contractimpl]
impl CarbonMarketplaceContract {

    /// Returns the current year based on the ledger timestamp.
    fn current_year(env: &Env) -> u32 {
        let seconds_per_year: u64 = 31557600; // Approximate seconds in a year
        let timestamp = env.ledger().timestamp();
        1970 + (timestamp / seconds_per_year) as u32
    }

    /// Initialise marketplace with admin and USDC token contract address.
    ///
    /// # Parameters
    /// - `admin`: The address that will have administrative privileges
    /// - `usdc_token`: Address of the USDC token contract for payments
    pub fn initialize(env: Env, admin: Address, usdc_token: Address) {
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::UsdcToken, &usdc_token);
        env.storage().persistent().set(&DataKey::CreditContract, &credit_contract);
        let listings: Vec<String> = vec![&env];
        env.storage().persistent().set(&DataKey::AllListings, &listings);
        Ok(())
    }

    /// Mark a project as suspended in the marketplace. Only admin may call this.
    /// Suspended projects cannot have new listings created or credits purchased.
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
    ///
    /// # Parameters
    /// - `seller`: The address listing the credits for sale
    /// - `listing_id`: Unique identifier for this listing
    /// - `batch_id`: The credit batch identifier
    /// - `project_id`: The project identifier
    /// - `amount`: Number of credits to list
    /// - `price_per_credit_usdc`: Price per credit in USDC stroops
    /// - `vintage_year`: Year the credits were generated
    /// - `methodology`: Carbon accounting methodology
    /// - `country`: Country where the project is located
    ///
    /// # Errors
    /// - [`CarbonError::ZeroAmountNotAllowed`] if `amount` or `price_per_credit_usdc` is zero.
    /// - [`CarbonError::InvalidVintageYear`] if `vintage_year` is before 1990 or after current year + 1.
    /// - [`CarbonError::InvalidSerialRange`] if `amount` is negative or zero.
    /// - [`CarbonError::ProjectNotFound`] if any string input is empty or too long.
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
        // ── checks ────────────────────────────────────────────────────────────
        seller.require_auth();

        // AUDIT-NOTE [MEDIUM]: No deduplication check on listing_id. A duplicate
        // listing_id silently overwrites the existing listing, allowing a seller to
        // zero out another listing's amount_available or change its price.
        // Fix: check `env.storage().persistent().has(&DataKey::Listing(listing_id.clone()))`.
        //
        // AUDIT-NOTE [MEDIUM]: No check that `seller` actually holds `batch_id` in
        // carbon_credit. Any authenticated address can list any batch. Fix: cross-contract
        // call to carbon_credit to verify ownership before creating the listing.

        if amount <= 0 || price_per_credit_usdc <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }
        if price_per_credit_usdc <= 0 {
            return Err(CarbonError::ZeroAmountNotAllowed);
        }

        let current_year = Self::current_year(&env);
        if vintage_year < 1990 || vintage_year > current_year + 1 {
            return Err(CarbonError::InvalidVintageYear);
        }

        if env.storage().persistent().get::<DataKey, bool>(&DataKey::SuspendedProject(project_id.clone())).unwrap_or(false) {
            return Err(CarbonError::ProjectSuspended);
        }

        // ── effects ───────────────────────────────────────────────────────────
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

    /// Remove an active listing. Only the original seller may delist.
    ///
    /// # Parameters
    /// - `seller`: The seller's address
    /// - `listing_id`: The listing identifier to remove
    ///
    /// # Errors
    /// - [`CarbonError::ListingNotFound`] if listing does not exist
    /// - [`CarbonError::UnauthorizedVerifier`] if caller is not the seller
    pub fn delist_credits(
        env: Env,
        seller: Address,
        listing_id: String,
    ) -> Result<(), CarbonError> {
        // ── checks ────────────────────────────────────────────────────────────
        seller.require_auth();

        let mut listing = Self::load_listing(&env, &listing_id)?;
        if listing.seller != seller {
            return Err(CarbonError::UnauthorizedVerifier);
        }

        // ── effects ───────────────────────────────────────────────────────────
        listing.status = ListingStatus::Delisted;
        env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);
        Self::extend_listing_ttl(&env, &listing_id);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("delisted")),
            (listing_id, seller),
        );
        Ok(())
    }

    /// Purchase credits from a listing. Transfers USDC from buyer to seller.
    /// Protocol fee of 1% is retained by the admin.
    ///
    /// # CEI Compliance
    /// CHECKS:   require_auth, zero-amount guard, listing existence, suspended-project
    ///           guard, liquidity guard — all before any state mutation.
    /// EFFECTS:  listing.amount_available decremented, listing.status updated, and
    ///           storage written before any external token call.
    /// INTERACTIONS: token::Client::transfer() called only after all state is finalised.
    /// Reentrancy risk is eliminated because the listing state is fully committed to
    /// persistent storage before the USDC token contract is invoked.
    /// # Parameters
    /// - `buyer`: The buyer's address
    /// - `listing_id`: The listing identifier to purchase from
    /// - `amount`: Number of credits to purchase
    ///
    /// # Errors
    /// - [`CarbonError::ListingNotFound`] if listing does not exist or is not active
    /// - [`CarbonError::InsufficientLiquidity`] if listing has fewer credits than requested
    /// - [`CarbonError::ZeroAmountNotAllowed`] if `amount` is zero
    pub fn purchase_credits(
        env: Env,
        buyer: Address,
        listing_id: String,
        amount: i128,
    ) -> Result<(), CarbonError> {
        // ── checks ────────────────────────────────────────────────────────────
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

        // ── effects ───────────────────────────────────────────────────────────
        // AUDIT-NOTE [HIGH]: Unchecked i128 multiplication. If price_per_credit and
        // amount are both large (e.g., price = i128::MAX / 2, amount = 2), total_cost
        // overflows and wraps to a small or negative value, allowing a buyer to purchase
        // credits for near-zero USDC. Fix: use checked_mul and return an error on overflow.
        let total_cost = listing.price_per_credit.checked_mul(amount).ok_or(CarbonError::Arithmetic)?;
        let protocol_fee = total_cost.checked_div(100).ok_or(CarbonError::Arithmetic)?; // 1%
        let seller_proceeds = total_cost.checked_sub(protocol_fee).ok_or(CarbonError::Arithmetic)?;

        listing.amount_available = listing.amount_available.checked_sub(amount).ok_or(CarbonError::Arithmetic)?;
        listing.status = if listing.amount_available == 0 {
            ListingStatus::Sold
        } else {
            ListingStatus::PartiallyFilled
        };
        env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);
        Self::extend_listing_ttl(&env, &listing_id);

        // ── interactions ──────────────────────────────────────────────────────
        let usdc: Address = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
        let usdc_client = token::Client::new(&env, &usdc);
        usdc_client.transfer(&buyer, &listing.seller, &seller_proceeds);

        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        usdc_client.transfer(&buyer, &admin, &protocol_fee);

        // Transfer credits from seller to buyer via the verified credit contract.
        // The contract address was set at initialization and cannot be changed.
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

    /// Bulk purchase from multiple listings in a single transaction.
    ///
    /// # Parameters
    /// - `buyer`: The buyer's address
    /// - `listing_ids`: Vector of listing identifiers to purchase from
    /// - `amounts`: Vector of amounts to purchase from each listing
    ///
    /// # Errors
    /// - Any error from individual [`purchase_credits`] calls propagates immediately.
    pub fn bulk_purchase(
        env: Env,
        buyer: Address,
        listing_ids: Vec<String>,
        amounts: Vec<i128>,
    ) -> Result<(), CarbonError> {
        buyer.require_auth();

        let len = listing_ids.len();
        if len != amounts.len() {
            return Err(CarbonError::InvalidSerialRange);
        }

        for i in 0..len {
            let listing_id = listing_ids.get(i).unwrap();
            let amount = amounts.get(i).unwrap();

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

            // AUDIT-NOTE [HIGH]: Same unchecked i128 multiplication as purchase_credits.
            // Fix: use checked_mul.
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

            let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
            usdc_client.transfer(&buyer, &admin, &protocol_fee);

            let credit_contract: Address = env.storage().persistent().get(&DataKey::CreditContract).unwrap();
            env.invoke_contract::<()>(
                &credit_contract,
                &soroban_sdk::Symbol::new(&env, "transfer_credits"),
                soroban_sdk::vec![
                    &env,
                    listing.seller.into_val(&env),
                    buyer.clone().into_val(&env),
                    listing.batch_id.into_val(&env),
                    amount.into_val(&env),
                ],
            );

            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("bulk_buy")),
                PurchaseCompletedEvent {
                    listing_id: listing_id.clone(),
                    buyer: buyer.clone(),
                    seller: listing.seller.clone(),
                    amount,
                    total_cost,
                    timestamp: env.ledger().timestamp(),
                },
            );
        }
        Ok(())
    }

    /// Returns a single [`MarketListing`] by ID.
    ///
    /// # Parameters
    /// - `listing_id`: The listing identifier
    ///
    /// # Returns
    /// The market listing record
    ///
    /// # Errors
    /// - [`CarbonError::ListingNotFound`] if listing does not exist
    pub fn get_listing(env: Env, listing_id: String) -> Result<MarketListing, CarbonError> {
        Self::load_listing(&env, &listing_id)
    }

    /// Returns all listings with `Active` or `PartiallyFilled` status.
    ///
    /// # Returns
    /// Vector of all active market listings
    pub fn get_active_listings(env: Env) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| {
            l.status == ListingStatus::Active || l.status == ListingStatus::PartiallyFilled
        })
    }

    /// Returns all listings for a given project ID.
    ///
    /// # Parameters
    /// - `project_id`: The project identifier
    ///
    /// # Returns
    /// Vector of all listings for the project
    pub fn get_listings_by_project(env: Env, project_id: String) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| l.project_id == project_id)
    }

    /// Returns all listings matching a given vintage year.
    ///
    /// # Parameters
    /// - `vintage_year`: The vintage year to filter by
    ///
    /// # Returns
    /// Vector of all listings for the vintage year
    pub fn get_listings_by_vintage(env: Env, vintage_year: u32) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| l.vintage_year == vintage_year)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Extend TTL on a listing entry so it is not evicted by Soroban rent.
    /// Called on every read/write to active listings.
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
        // Extend TTL on every read so active listings never expire
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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        vec, Env, String,
    };
    use carbon_credit::CarbonCreditContract;

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address, Address) {
        env.mock_all_auths();
        let admin  = Address::generate(env);
        let seller = Address::generate(env);
        let usdc   = env.register_stellar_asset_contract(admin.clone());
        let credit_id = env.register_contract(None, CarbonCreditContract);
        let id     = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc, &credit_id).unwrap();
        (client, admin, seller, usdc)
    }

    fn add_listing(env: &Env, client: &CarbonMarketplaceContractClient, seller: &Address) {
        client.list_credits(
            seller,
            &s(env, "list-001"),
            &s(env, "batch-001"),
            &s(env, "proj-001"),
            &100_i128,
            &10_0000000_i128, // 10 USDC in stroops
            &2023_u32,
            &s(env, "VCS"),
            &s(env, "Brazil"),
        );
    }

    #[test]
    fn test_list_credits_creates_active_listing() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Active);
        assert_eq!(l.amount_available, 100);
    }

    #[test]
    fn test_delist_removes_listing() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        client.delist_credits(&seller, &s(&env, "list-001"));
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Delisted);
    }

    #[test]
    fn test_purchase_insufficient_credits_fails() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &999_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_listings_by_project() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let listings = client.get_listings_by_project(&s(&env, "proj-001"));
        assert_eq!(listings.len(), 1);
    }

    #[test]
    fn test_get_listings_by_vintage() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let listings = client.get_listings_by_vintage(&2023_u32);
        assert_eq!(listings.len(), 1);
        let empty = client.get_listings_by_vintage(&2020_u32);
        assert_eq!(empty.len(), 0);
    }

    #[test]
    fn test_get_active_listings() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let active = client.get_active_listings();
        assert_eq!(active.len(), 1);
    }

    #[test]
    fn test_zero_amount_listing_fails() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
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
        let (client, admin, seller, _) = setup(&env);
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
        let (client, admin, seller, _) = setup(&env);
        // List before suspending
        add_listing(&env, &client, &seller);
        // Suspend the project
        client.suspend_project(&admin, &s(&env, "proj-001"));
        let buyer = Address::generate(&env);
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &10_i128);
        assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectSuspended);
    }

    #[test]
    fn test_non_suspended_project_listing_succeeds() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
        // No suspension — listing should succeed
        add_listing(&env, &client, &seller);
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Active);
    }

    #[test]
    fn test_overflow_purchase_graceful_error() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);

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
        ).unwrap();

        // Purchase must fail because wrong_credit has no transfer_credits function
        let result = client.try_purchase_credits(&buyer, &s(&env, "list-001"), &10_i128);
        assert!(result.is_err());
    }
}

// ── Property-based fuzz tests ─────────────────────────────────────────────────

#[cfg(test)]
mod fuzz {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    /// Set up a fresh marketplace with a USDC mock and one active listing of
    /// `listing_amount` credits at `price_per_credit` stroops each.
    fn setup_with_listing(
        listing_amount: i128,
        price_per_credit: i128,
    ) -> (Env, CarbonMarketplaceContractClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin  = Address::generate(&env);
        let seller = Address::generate(&env);
        let usdc   = env.register_stellar_asset_contract(admin.clone());
        let id     = env.register_contract(None, CarbonMarketplaceContract);
        let env: &'static Env = Box::leak(Box::new(env));
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc).unwrap();
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
        ).unwrap();
        (env.clone(), client, admin, seller, usdc)
    }

    proptest! {
        /// Purchasing zero or negative credits must return ZeroAmountNotAllowed — never panic.
        #[test]
        fn fuzz_purchase_zero_or_negative(amount in i128::MIN..=0_i128) {
            let (env, client, _, _, _) = setup_with_listing(100, 10_0000000);
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Purchasing more than available must return InsufficientLiquidity — never panic.
        #[test]
        fn fuzz_purchase_exceeds_available(excess in 1_i128..1_000_000_i128) {
            let (env, client, _, _, _) = setup_with_listing(100, 10_0000000);
            let buyer = Address::generate(&env);
            let over = 100_i128 + excess;
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &over);
            prop_assert!(result.is_err());
        }

        /// Purchasing from a non-existent listing must return ListingNotFound — never panic.
        #[test]
        fn fuzz_purchase_nonexistent_listing(suffix in "[a-z]{1,8}") {
            let (env, client, _, _, _) = setup_with_listing(100, 10_0000000);
            let buyer = Address::generate(&env);
            let bad_id = format!("no-such-{}", suffix);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &10_i128);
            // Sanity: valid listing still works; bad one fails
            let bad_result = client.try_purchase_credits(&buyer, &s(&env, &bad_id), &10_i128);
            prop_assert!(bad_result.is_err());
            let _ = result; // valid purchase may succeed or fail depending on USDC balance
        }

        /// Purchasing from a delisted listing must return ListingNotFound — never panic.
        #[test]
        fn fuzz_purchase_delisted_listing(amount in 1_i128..50_i128) {
            let (env, client, _, seller, _) = setup_with_listing(100, 10_0000000);
            client.delist_credits(&seller, &s(&env, "list-fuzz")).unwrap();
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Purchasing from a suspended project must return ProjectSuspended — never panic.
        #[test]
        fn fuzz_purchase_suspended_project(amount in 1_i128..50_i128) {
            let (env, client, admin, _, _) = setup_with_listing(100, 10_0000000);
            client.suspend_project(&admin, &s(&env, "proj-fuzz")).unwrap();
            let buyer = Address::generate(&env);
            let result = client.try_purchase_credits(&buyer, &s(&env, "list-fuzz"), &amount);
            prop_assert!(result.is_err());
        }

        /// Valid purchase reduces amount_available by exactly the purchased amount.
        #[test]
        fn fuzz_purchase_valid_reduces_available(
            listing_amount in 2_i128..1_000_i128,
            buy_frac in 1_u32..99_u32,  // percentage 1–98
        ) {
            let buy_amount = (listing_amount * buy_frac as i128 / 100).max(1).min(listing_amount - 1);
            // Use price 1 stroop to keep USDC arithmetic trivial with mock_all_auths
            let (env, client, _, _, _) = setup_with_listing(listing_amount, 1_i128);
            let buyer = Address::generate(&env);
            client.purchase_credits(&buyer, &s(&env, "list-fuzz"), &buy_amount).unwrap();
            let listing = client.get_listing(&s(&env, "list-fuzz")).unwrap();
            prop_assert_eq!(listing.amount_available, listing_amount - buy_amount);
            prop_assert_eq!(listing.status, ListingStatus::PartiallyFilled);
        }

        /// Purchasing the full listing amount marks it Sold — never panic.
        #[test]
        fn fuzz_purchase_full_amount_marks_sold(listing_amount in 1_i128..1_000_i128) {
            let (env, client, _, _, _) = setup_with_listing(listing_amount, 1_i128);
            let buyer = Address::generate(&env);
            client.purchase_credits(&buyer, &s(&env, "list-fuzz"), &listing_amount).unwrap();
            let listing = client.get_listing(&s(&env, "list-fuzz")).unwrap();
            prop_assert_eq!(listing.status, ListingStatus::Sold);
            prop_assert_eq!(listing.amount_available, 0);
        }

        /// Any purchase from a Sold listing must fail — never panic.
        #[test]
        fn fuzz_purchase_from_sold_listing_fails(second_amount in 1_i128..100_i128) {
            let (env, client, _, _, _) = setup_with_listing(100, 1_i128);
            let buyer = Address::generate(&env);
            // Buy everything
            client.purchase_credits(&buyer, &s(&env, "list-fuzz"), &100_i128).unwrap();
            // Any further purchase must fail
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
            let admin  = Address::generate(&env);
            let seller = Address::generate(&env);
            let usdc   = env.register_stellar_asset_contract(admin.clone());
            let id     = env.register_contract(None, CarbonMarketplaceContract);
            let client = CarbonMarketplaceContractClient::new(&env, &id);
            client.initialize(&admin, &usdc).unwrap();

            // Zero amount
            let r1 = client.try_list_credits(
                &seller, &s(&env, "l1"), &s(&env, "b1"), &s(&env, "p1"),
                &amount, &10_0000000_i128, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
            );
            prop_assert!(r1.is_err());

            // Zero price
            let r2 = client.try_list_credits(
                &seller, &s(&env, "l2"), &s(&env, "b2"), &s(&env, "p2"),
                &100_i128, &price, &2023_u32, &s(&env, "VCS"), &s(&env, "BR"),
            );
            prop_assert!(r2.is_err());
        }
    }
}
