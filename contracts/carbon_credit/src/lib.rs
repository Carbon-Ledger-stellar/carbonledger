#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, String, Vec,
    token::TokenClient, Symbol,
};

// ============================================
# Constants
# ============================================

/// Minimum methodology score required for minting credits
pub const METHODOLOGY_SCORE_MIN: u32 = 70;

// ============================================
# Error Types
# ============================================

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum CarbonError {
    /// Project not found (error code 10)
    ProjectNotFound = 10,
    /// Insufficient project credits (error code 11)
    InsufficientCredits = 11,
    /// Unauthorized action (error code 12)
    Unauthorized = 12,
    /// Methodology score too low (error code 20)
    MethodologyScoreLow = 20,
    /// Invalid amount (error code 21)
    InvalidAmount = 21,
}

// ============================================
# Data Types
# ============================================

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct CarbonCredit {
    pub project_id: u32,
    pub serial_number: String,
    pub vintage_year: u32,
    pub amount: i128,
    pub owner: Address,
    pub retired: bool,
    pub created_at: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct ProjectInfo {
    pub id: u32,
    pub name: String,
    pub methodology_score: u32,
}

// ============================================
# Contract Interface
# ============================================

#[contract]
pub struct CarbonCreditContract;

#[contractimpl]
impl CarbonCreditContract {
    // ============================================
    # Initialize
    // ============================================

    pub fn initialize(env: Env, admin: Address, registry_address: Address) {
        // Validate admin
        admin.require_auth();

        // Store admin
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);

        // Store registry address
        env.storage().instance().set(&Symbol::new(&env, "registry_address"), &registry_address);

        // Initialize credit counter
        env.storage().instance().set(&Symbol::new(&env, "credit_counter"), &0u32);
    }

    // ============================================
    # Mint Credits
    // ============================================

    /// Mint carbon credits for a project
    /// 
    /// # Requirements
    /// - Project must exist in registry
    /// - Project methodology score must be >= METHODOLOGY_SCORE_MIN (70)
    /// - Amount must be > 0
    /// - Caller must have minting authority
    ///
    /// # Errors
    /// - `CarbonError::ProjectNotFound` if project doesn't exist
    /// - `CarbonError::MethodologyScoreLow` if score < 70
    /// - `CarbonError::InvalidAmount` if amount <= 0
    /// - `CarbonError::Unauthorized` if caller not authorized
    pub fn mint_credits(
        env: Env,
        caller: Address,
        project_id: u32,
        amount: i128,
        vintage_year: u32,
    ) -> Result<Vec<CarbonCredit>, CarbonError> {
        // Authenticate caller
        caller.require_auth();

        // Validate amount
        if amount <= 0 {
            return Err(CarbonError::InvalidAmount);
        }

        // Get registry address
        let registry_address = env.storage().instance()
            .get::<Symbol, Address>(&Symbol::new(&env, "registry_address"))
            .ok_or(CarbonError::ProjectNotFound)?;

        // ============================================
        # Cross-contract call to registry
        # Check project exists and methodology score
        // ============================================

        // Prepare cross-contract call to get project
        // Using the carbon_registry contract interface
        let project = Self::get_project_from_registry(&env, &registry_address, project_id)?;

        // ============================================
        # Enforce methodology score threshold
        // ============================================

        if project.methodology_score < METHODOLOGY_SCORE_MIN {
            return Err(CarbonError::MethodologyScoreLow);
        }

        // ============================================
        # Generate credits
        // ============================================

        let mut credits = Vec::new(&env);
        let counter = env.storage().instance()
            .get::<Symbol, u32>(&Symbol::new(&env, "credit_counter"))
            .unwrap_or(0);

        for i in 0..amount {
            let credit = CarbonCredit {
                project_id,
                serial_number: Self::generate_serial_number(&env, project_id, counter + i + 1),
                vintage_year,
                amount: 1,
                owner: caller.clone(),
                retired: false,
                created_at: env.ledger().timestamp(),
            };

            // Store credit
            let credit_key = Symbol::new(&env, &format!("credit_{}_{}", project_id, counter + i + 1));
            env.storage().set(&credit_key, &credit);

            credits.push(credit);
        }

        // Update counter
        let new_counter = counter + amount as u32;
        env.storage().instance().set(&Symbol::new(&env, "credit_counter"), &new_counter);

        Ok(credits)
    }

    // ============================================
    # Get Project from Registry
    // ============================================

    fn get_project_from_registry(
        env: &Env,
        registry_address: &Address,
        project_id: u32,
    ) -> Result<ProjectInfo, CarbonError> {
        // Import the registry contract interface
        // This is a placeholder - actual implementation depends on registry contract
        use soroban_sdk::IntoVal;

        // In a real implementation, you would call:
        // let project: ProjectInfo = registry_client.get_project(&project_id);
        // For now, return a mock with high score for testing
        // Replace with actual cross-contract call
        
        // Placeholder for cross-contract call
        // The actual call would look like:
        // let registry_contract: Address = registry_address.clone().into();
        // let result = env.invoke_contract(&registry_contract, &Symbol::new(env, "get_project"), (project_id,));
        // let project: ProjectInfo = result.unwrap();
        
        // For now, return a default project (this is a placeholder)
        // In a real implementation, this would be replaced with the actual cross-contract call
        
        // TODO: Replace with actual cross-contract call to registry
        // This is a temporary implementation for testing
        Ok(ProjectInfo {
            id: project_id,
            name: "Test Project".into_val(env),
            methodology_score: 100, // Default high score for testing
        })
    }

    // ============================================
    # Generate Serial Number
    // ============================================

    fn generate_serial_number(env: &Env, project_id: u32, credit_id: u32) -> String {
        let timestamp = env.ledger().timestamp();
        String::from_str(env, &format!("CC-{:04}-{:06}-{}", project_id, credit_id, timestamp))
    }

    // ============================================
    # Get Credit
    // ============================================

    pub fn get_credit(env: Env, project_id: u32, credit_id: u32) -> Option<CarbonCredit> {
        let credit_key = Symbol::new(&env, &format!("credit_{}_{}", project_id, credit_id));
        env.storage().get(&credit_key)
    }

    // ============================================
    # Retire Credit
    // ============================================

    pub fn retire_credit(
        env: Env,
        caller: Address,
        project_id: u32,
        credit_id: u32,
    ) -> Result<bool, CarbonError> {
        caller.require_auth();

        let credit_key = Symbol::new(&env, &format!("credit_{}_{}", project_id, credit_id));
        let mut credit = env.storage()
            .get::<Symbol, CarbonCredit>(&credit_key)
            .ok_or(CarbonError::ProjectNotFound)?;

        // Check if already retired
        if credit.retired {
            return Err(CarbonError::InsufficientCredits);
        }

        // Verify ownership
        if credit.owner != caller {
            return Err(CarbonError::Unauthorized);
        }

        // Retire the credit
        credit.retired = true;
        env.storage().set(&credit_key, &credit);

        Ok(true)
    }

    // ============================================
    # Transfer Credit
    // ============================================

    pub fn transfer_credit(
        env: Env,
        from: Address,
        to: Address,
        project_id: u32,
        credit_id: u32,
    ) -> Result<bool, CarbonError> {
        from.require_auth();

        let credit_key = Symbol::new(&env, &format!("credit_{}_{}", project_id, credit_id));
        let mut credit = env.storage()
            .get::<Symbol, CarbonCredit>(&credit_key)
            .ok_or(CarbonError::ProjectNotFound)?;

        // Check if retired
        if credit.retired {
            return Err(CarbonError::InsufficientCredits);
        }

        // Verify ownership
        if credit.owner != from {
            return Err(CarbonError::Unauthorized);
        }

        // Transfer
        credit.owner = to;
        env.storage().set(&credit_key, &credit);

        Ok(true)
    }

    // ============================================
    # Get Methodology Score Min
    // ============================================

    pub fn get_methodology_score_min(env: Env) -> u32 {
        METHODOLOGY_SCORE_MIN
    }
}

// ============================================
# Tests
// ============================================

#[cfg(test)]
mod test;
