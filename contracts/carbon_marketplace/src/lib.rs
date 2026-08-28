#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, String, Vec, MuxedAddress,
    symbol_short, vec,
    token,
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
    Listing(String),
    AllListings,
    Admin,
    UsdcToken,
    /// Maps an Address to its assigned Role.
    RoleMap(Address),
}

// ── Types ─────────────────────────────────────────────────────────────────────

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

    /// Initialise marketplace with admin and USDC token contract address.
    /// The deployer is bootstrapped with the Admin role.
    pub fn initialize(env: Env, admin: Address, usdc_token: Address) {
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::UsdcToken, &usdc_token);
        // Bootstrap: grant the deploying admin the Admin role on-chain.
        env.storage().persistent().set(&DataKey::RoleMap(admin.clone()), &Role::Admin);
        let listings: Vec<String> = vec![&env];
        env.storage().persistent().set(&DataKey::AllListings, &listings);
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

    // ── Marketplace operations ────────────────────────────────────────────────

    /// List carbon credits for sale at a fixed USDC price per credit (in stroops).
    ///
    /// # Errors
    /// - [`CarbonError::ZeroAmountNotAllowed`] if `amount` or `price_per_credit_usdc` is zero.
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

        let mut all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or_else(|| vec![&env]);
        all.push_back(listing_id.clone());
        env.storage().persistent().set(&DataKey::AllListings, &all);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("listed")),
            (listing_id, seller, batch_id, amount, price_per_credit_usdc),
        );
        Ok(())
    }

    /// Remove an active listing. Only the original seller may delist.
    ///
    /// # Errors
    /// - [`CarbonError::ListingNotFound`] if listing does not exist.
    /// - [`CarbonError::UnauthorizedVerifier`] if caller is not the seller.
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

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("delisted")),
            (listing_id, seller),
        );
        Ok(())
    }

    /// Admin force-delist any listing regardless of seller. Requires the Admin role.
    ///
    /// # Errors
    /// - [`CarbonError::Unauthorized`] if caller does not hold the Admin role.
    /// - [`CarbonError::ListingNotFound`] if listing does not exist.
    pub fn admin_delist(
        env: Env,
        admin: Address,
        listing_id: String,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;

        let mut listing = Self::load_listing(&env, &listing_id)?;
        listing.status = ListingStatus::Delisted;
        env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("adm_dlist")),
            (listing_id, admin),
        );
        Ok(())
    }

    /// Purchase credits from a listing. Transfers USDC from buyer to seller.
    /// Protocol fee of 1% is retained by the admin.
    ///
    /// # Errors
    /// - [`CarbonError::ListingNotFound`] if listing does not exist.
    /// - [`CarbonError::InsufficientLiquidity`] if listing has fewer credits than requested.
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
        if amount > listing.amount_available {
            return Err(CarbonError::InsufficientLiquidity);
        }

        let total_cost = listing.price_per_credit * amount;
        let protocol_fee = total_cost / 100; // 1%
        let seller_proceeds = total_cost - protocol_fee;

        listing.amount_available -= amount;
        listing.status = if listing.amount_available == 0 {
            ListingStatus::Sold
        } else {
            ListingStatus::PartiallyFilled
        };
        env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);

        let usdc: Address = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
        let usdc_client = token::TokenClient::new(&env, &usdc);
        // In soroban-sdk 28 transfer's `to` param is MuxedAddress
        let seller_muxed = MuxedAddress::from(listing.seller.clone());
        usdc_client.transfer(&buyer, &seller_muxed, &seller_proceeds);

        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        let admin_muxed = MuxedAddress::from(admin);
        usdc_client.transfer(&buyer, &admin_muxed, &protocol_fee);

        env.events().publish(
            (symbol_short!("c_ledger"), symbol_short!("purchase")),
            (listing_id, buyer, listing.seller, amount, total_cost),
        );
        Ok(())
    }

    /// Bulk purchase from multiple listings in a single transaction.
    ///
    /// # Errors
    /// - Any error from individual purchase calls propagates immediately.
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
            if amount > listing.amount_available {
                return Err(CarbonError::InsufficientLiquidity);
            }

            let total_cost = listing.price_per_credit * amount;
            let protocol_fee = total_cost / 100;
            let seller_proceeds = total_cost - protocol_fee;

            listing.amount_available -= amount;
            listing.status = if listing.amount_available == 0 {
                ListingStatus::Sold
            } else {
                ListingStatus::PartiallyFilled
            };
            env.storage().persistent().set(&DataKey::Listing(listing_id.clone()), &listing);

            let usdc: Address = env.storage().persistent().get(&DataKey::UsdcToken).unwrap();
            let usdc_client = token::TokenClient::new(&env, &usdc);
            let seller_muxed = MuxedAddress::from(listing.seller.clone());
            usdc_client.transfer(&buyer, &seller_muxed, &seller_proceeds);

            let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
            let admin_muxed = MuxedAddress::from(admin);
            usdc_client.transfer(&buyer, &admin_muxed, &protocol_fee);

            env.events().publish(
                (symbol_short!("c_ledger"), symbol_short!("bulk_buy")),
                (listing_id, buyer.clone(), amount, total_cost),
            );
        }
        Ok(())
    }

    /// Returns a single [`MarketListing`] by ID.
    pub fn get_listing(env: Env, listing_id: String) -> Result<MarketListing, CarbonError> {
        Self::load_listing(&env, &listing_id)
    }

    /// Returns all listings with `Active` or `PartiallyFilled` status.
    pub fn get_active_listings(env: Env) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| {
            l.status == ListingStatus::Active || l.status == ListingStatus::PartiallyFilled
        })
    }

    /// Returns all listings for a given project ID.
    pub fn get_listings_by_project(env: Env, project_id: String) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| l.project_id == project_id)
    }

    /// Returns all listings matching a given vintage year.
    pub fn get_listings_by_vintage(env: Env, vintage_year: u32) -> Vec<MarketListing> {
        Self::filter_listings(&env, |l| l.vintage_year == vintage_year)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn load_listing(env: &Env, listing_id: &String) -> Result<MarketListing, CarbonError> {
        env.storage()
            .persistent()
            .get(&DataKey::Listing(listing_id.clone()))
            .ok_or(CarbonError::ListingNotFound)
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
    use soroban_sdk::{testutils::Address as _, vec, Env, String};

    fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

    fn setup(env: &Env) -> (CarbonMarketplaceContractClient, Address, Address, Address) {
        env.mock_all_auths();
        let admin  = Address::generate(env);
        let seller = Address::generate(env);
        let usdc   = env.register_stellar_asset_contract(admin.clone());
        let id     = env.register_contract(None, CarbonMarketplaceContract);
        let client = CarbonMarketplaceContractClient::new(env, &id);
        client.initialize(&admin, &usdc);
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

    // ── Original functional tests (preserved) ────────────────────────────

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

    // ── RBAC tests ────────────────────────────────────────────────────────

    #[test]
    fn test_admin_has_admin_role_after_initialize() {
        let env = Env::default();
        let (client, admin, _, _) = setup(&env);
        assert_eq!(client.get_role(&admin), Role::Admin);
    }

    #[test]
    fn test_get_role_returns_user_for_unknown_address() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        let stranger = Address::generate(&env);
        assert_eq!(client.get_role(&stranger), Role::User);
    }

    #[test]
    fn test_grant_role_success() {
        let env = Env::default();
        let (client, admin, _, _) = setup(&env);
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        assert_eq!(client.get_role(&verifier), Role::Verifier);
    }

    #[test]
    fn test_grant_role_unauthorized_non_admin_cannot_grant() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        let attacker = Address::generate(&env);
        let victim   = Address::generate(&env);
        // attacker has default User role — must fail
        let result = client.try_grant_role(&attacker, &victim, &Role::Admin);
        assert!(result.is_err());
    }

    #[test]
    fn test_revoke_role_success() {
        let env = Env::default();
        let (client, admin, _, _) = setup(&env);
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        assert_eq!(client.get_role(&verifier), Role::Verifier);
        client.revoke_role(&admin, &verifier);
        assert_eq!(client.get_role(&verifier), Role::User);
    }

    #[test]
    fn test_revoke_role_unauthorized() {
        let env = Env::default();
        let (client, admin, _, _) = setup(&env);
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        let attacker = Address::generate(&env);
        let result = client.try_revoke_role(&attacker, &verifier);
        assert!(result.is_err());
    }

    #[test]
    fn test_admin_delist_any_listing() {
        let env = Env::default();
        let (client, admin, seller, _) = setup(&env);
        // Seller creates a listing
        add_listing(&env, &client, &seller);
        let l = client.get_listing(&s(&env, "list-001"));
        assert_eq!(l.status, ListingStatus::Active);
        // Admin force-delists it
        client.admin_delist(&admin, &s(&env, "list-001"));
        let after = client.get_listing(&s(&env, "list-001"));
        assert_eq!(after.status, ListingStatus::Delisted);
    }

    #[test]
    fn test_admin_delist_unauthorized_user_cannot_delist() {
        let env = Env::default();
        let (client, _, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let attacker = Address::generate(&env);
        // attacker has no role (User) — must fail
        let result = client.try_admin_delist(&attacker, &s(&env, "list-001"));
        assert!(result.is_err());
    }

    #[test]
    fn test_admin_delist_verifier_role_cannot_delist() {
        let env = Env::default();
        let (client, admin, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        let verifier = Address::generate(&env);
        client.grant_role(&admin, &verifier, &Role::Verifier);
        let result = client.try_admin_delist(&verifier, &s(&env, "list-001"));
        assert!(result.is_err());
    }

    #[test]
    fn test_grant_then_revoke_cannot_admin_delist() {
        let env = Env::default();
        let (client, admin, seller, _) = setup(&env);
        add_listing(&env, &client, &seller);
        // Promote a second admin
        let second_admin = Address::generate(&env);
        client.grant_role(&admin, &second_admin, &Role::Admin);
        // second_admin can admin_delist
        client.admin_delist(&second_admin, &s(&env, "list-001"));
        let after = client.get_listing(&s(&env, "list-001"));
        assert_eq!(after.status, ListingStatus::Delisted);

        // Re-list with a different id
        client.list_credits(
            &seller,
            &s(&env, "list-002"),
            &s(&env, "batch-002"),
            &s(&env, "proj-001"),
            &50_i128,
            &5_0000000_i128,
            &2023_u32,
            &s(&env, "VCS"),
            &s(&env, "Brazil"),
        );

        // Revoke second_admin's role
        client.revoke_role(&admin, &second_admin);
        assert_eq!(client.get_role(&second_admin), Role::User);

        // After revocation, admin_delist must fail
        let result = client.try_admin_delist(&second_admin, &s(&env, "list-002"));
        assert!(result.is_err());
    }
}
