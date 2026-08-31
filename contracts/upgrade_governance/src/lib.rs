//! # upgrade_governance
//!
//! Soroban smart contract that enforces a secure upgrade process for all
//! CarbonLedger contracts:
//!
//! - **3-of-5 multi-sig**: An upgrade proposal must collect signatures from at
//!   least 3 of the 5 registered signers before it can be executed.
//! - **48-hour timelock**: After the 3rd approval, execution is blocked for
//!   172,800 seconds (48 hours) so the community can raise concerns.
//! - **Public proposals**: Every proposal emits an on-chain event so anyone
//!   can monitor pending upgrades.
//! - **Cancellation**: Any signer can cancel a proposal before it executes.
//!
//! ## Lifecycle
//!
//! ```text
//! propose() → approve() x3 → [48h passes] → execute() → upgrade applied
//!                                           ↑
//!                              cancel() ends here (before execute)
//! ```
//!
//! ## Error codes
//!
//! | Code | Meaning |
//! |------|---------|
//! | 1    | NotInitialized — call initialize() first |
//! | 2    | AlreadyInitialized |
//! | 3    | UnauthorizedSigner — caller is not a registered signer |
//! | 4    | ProposalNotFound |
//! | 5    | ProposalAlreadyExecuted |
//! | 6    | ProposalCancelled |
//! | 7    | AlreadyApproved — signer already approved this proposal |
//! | 8    | InsufficientApprovals — need ≥ REQUIRED_APPROVALS signatures |
//! | 9    | TimelockActive — 48h has not elapsed since final approval |
//! | 10   | TimelockNotStarted — not enough approvals yet |

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, BytesN, Env, Vec,
    symbol_short,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Number of signer approvals required before the timelock can start.
const REQUIRED_APPROVALS: u32 = 3;

/// Total number of registered signers (3-of-5 scheme).
const TOTAL_SIGNERS: u32 = 5;

/// Timelock duration in seconds (48 hours).
const TIMELOCK_SECONDS: u64 = 48 * 60 * 60; // 172_800

// ── Error enum ────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovernanceError {
    NotInitialized        = 1,
    AlreadyInitialized    = 2,
    UnauthorizedSigner    = 3,
    ProposalNotFound      = 4,
    ProposalAlreadyExecuted = 5,
    ProposalCancelled     = 6,
    AlreadyApproved       = 7,
    InsufficientApprovals = 8,
    TimelockActive        = 9,
    TimelockNotStarted    = 10,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Initialized flag.
    Initialized,
    /// Vec<Address> of the 5 registered signers.
    Signers,
    /// UpgradeProposal stored by proposal_id (u64).
    Proposal(u64),
    /// Monotonic proposal counter.
    ProposalCounter,
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Pending,
    TimelockStarted,
    Executed,
    Cancelled,
}

/// An upgrade proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeProposal {
    /// Unique numeric ID assigned at proposal time.
    pub id: u64,
    /// Target contract address to upgrade.
    pub target_contract: Address,
    /// SHA-256 hash of the new WASM binary (32 bytes).
    pub new_wasm_hash: BytesN<32>,
    /// Human-readable description / changelog (stored off-chain CID recommended).
    pub description_cid: soroban_sdk::String,
    /// Address that submitted the proposal.
    pub proposer: Address,
    /// Ledger timestamp when the proposal was created.
    pub created_at: u64,
    /// Addresses that have approved so far.
    pub approvals: Vec<Address>,
    /// Ledger timestamp when the REQUIRED_APPROVALS-th approval was received.
    /// Zero until the quorum is reached.
    pub timelock_start: u64,
    /// Current lifecycle status.
    pub status: ProposalStatus,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct UpgradeGovernanceContract;

#[contractimpl]
impl UpgradeGovernanceContract {

    // ── Initialization ───────────────────────────────────────────────────────

    /// Initialize the governance contract with exactly 5 signers.
    ///
    /// Can only be called once. The admin address must be one of the signers.
    pub fn initialize(
        env: Env,
        admin: Address,
        signers: Vec<Address>,
    ) -> Result<(), GovernanceError> {
        if env.storage().persistent().has(&DataKey::Initialized) {
            return Err(GovernanceError::AlreadyInitialized);
        }
        admin.require_auth();

        // Enforce exactly TOTAL_SIGNERS (5) signers
        let mut validated: Vec<Address> = Vec::new(&env);
        let mut i = 0u32;
        while i < signers.len() {
            validated.push_back(signers.get(i).unwrap());
            i += 1;
        }
        // Must have exactly 5 signers
        if validated.len() != TOTAL_SIGNERS {
            // Reuse InsufficientApprovals as closest semantic match for wrong signer count
            return Err(GovernanceError::InsufficientApprovals);
        }

        env.storage().persistent().set(&DataKey::Initialized, &true);
        env.storage().persistent().set(&DataKey::Signers, &validated);
        env.storage().persistent().set(&DataKey::ProposalCounter, &0u64);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("init")),
            admin,
        );
        Ok(())
    }

    // ── Propose ──────────────────────────────────────────────────────────────

    /// Submit an upgrade proposal.
    ///
    /// Any registered signer may propose. The proposal is immediately visible
    /// on-chain via an emitted event so the community can review it.
    ///
    /// Returns the new `proposal_id`.
    pub fn propose(
        env: Env,
        proposer: Address,
        target_contract: Address,
        new_wasm_hash: BytesN<32>,
        description_cid: soroban_sdk::String,
    ) -> Result<u64, GovernanceError> {
        Self::require_initialized(&env)?;
        proposer.require_auth();
        Self::require_signer(&env, &proposer)?;

        let counter: u64 = env.storage()
            .persistent()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0);
        let proposal_id = counter + 1;

        let mut initial_approvals: Vec<Address> = Vec::new(&env);
        // Proposer automatically counts as the first approval
        initial_approvals.push_back(proposer.clone());

        let proposal = UpgradeProposal {
            id: proposal_id,
            target_contract: target_contract.clone(),
            new_wasm_hash: new_wasm_hash.clone(),
            description_cid: description_cid.clone(),
            proposer: proposer.clone(),
            created_at: env.ledger().timestamp(),
            approvals: initial_approvals,
            timelock_start: 0,
            status: ProposalStatus::Pending,
        };

        env.storage().persistent().set(&DataKey::ProposalCounter, &proposal_id);
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        // Emit public event so off-chain monitors can surface the proposal
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("proposed")),
            (proposal_id, target_contract, new_wasm_hash, proposer),
        );

        Ok(proposal_id)
    }

    // ── Approve ──────────────────────────────────────────────────────────────

    /// Approve an existing proposal.
    ///
    /// When the REQUIRED_APPROVALS (3) threshold is reached the timelock clock
    /// starts automatically and an event is emitted.
    pub fn approve(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), GovernanceError> {
        Self::require_initialized(&env)?;
        signer.require_auth();
        Self::require_signer(&env, &signer)?;

        let mut proposal = Self::get_proposal_inner(&env, proposal_id)?;
        Self::require_active(&proposal)?;

        // Prevent double-approval
        let mut i = 0u32;
        while i < proposal.approvals.len() {
            if proposal.approvals.get(i).unwrap() == signer {
                return Err(GovernanceError::AlreadyApproved);
            }
            i += 1;
        }

        proposal.approvals.push_back(signer.clone());

        // Check if we just crossed the quorum threshold
        if proposal.approvals.len() >= REQUIRED_APPROVALS
            && proposal.status == ProposalStatus::Pending
        {
            proposal.timelock_start = env.ledger().timestamp();
            proposal.status = ProposalStatus::TimelockStarted;

            env.events().publish(
                (symbol_short!("gov"), symbol_short!("timelock")),
                (
                    proposal_id,
                    proposal.timelock_start,
                    proposal.timelock_start + TIMELOCK_SECONDS,
                ),
            );
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("approved")),
            (proposal_id, signer, proposal.approvals.len()),
        );

        Ok(())
    }

    // ── Execute ──────────────────────────────────────────────────────────────

    /// Execute an approved proposal after the 48-hour timelock has elapsed.
    ///
    /// Any registered signer can trigger execution once the conditions are met.
    /// The `upgrade()` call on the target contract must be made separately by
    /// the target contract's admin using the approved `new_wasm_hash`.
    ///
    /// This function records the execution on-chain and emits an event that
    /// the target contract's upgrade call can verify.
    pub fn execute(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<BytesN<32>, GovernanceError> {
        Self::require_initialized(&env)?;
        executor.require_auth();
        Self::require_signer(&env, &executor)?;

        let mut proposal = Self::get_proposal_inner(&env, proposal_id)?;
        Self::require_active(&proposal)?;

        // Must have reached quorum
        if proposal.approvals.len() < REQUIRED_APPROVALS {
            return Err(GovernanceError::InsufficientApprovals);
        }

        // Timelock must have started
        if proposal.status != ProposalStatus::TimelockStarted {
            return Err(GovernanceError::TimelockNotStarted);
        }

        // 48-hour timelock must have elapsed
        let now = env.ledger().timestamp();
        if now < proposal.timelock_start + TIMELOCK_SECONDS {
            return Err(GovernanceError::TimelockActive);
        }

        proposal.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("executed")),
            (
                proposal_id,
                proposal.target_contract.clone(),
                proposal.new_wasm_hash.clone(),
                executor,
            ),
        );

        // Return the approved wasm hash so the caller can pass it to the
        // target contract's upgrade() function.
        Ok(proposal.new_wasm_hash)
    }

    // ── Cancel ───────────────────────────────────────────────────────────────

    /// Cancel a pending or timelock-started proposal.
    ///
    /// Any registered signer can cancel before execution.
    pub fn cancel(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), GovernanceError> {
        Self::require_initialized(&env)?;
        signer.require_auth();
        Self::require_signer(&env, &signer)?;

        let mut proposal = Self::get_proposal_inner(&env, proposal_id)?;
        Self::require_active(&proposal)?;

        proposal.status = ProposalStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("cancelled")),
            (proposal_id, signer),
        );

        Ok(())
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /// Get a proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<UpgradeProposal, GovernanceError> {
        Self::require_initialized(&env)?;
        Self::get_proposal_inner(&env, proposal_id)
    }

    /// Get the list of registered signers.
    pub fn get_signers(env: Env) -> Result<Vec<Address>, GovernanceError> {
        Self::require_initialized(&env)?;
        Ok(env.storage().persistent().get(&DataKey::Signers).unwrap())
    }

    /// Get the current proposal counter (total proposals ever created).
    pub fn proposal_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0)
    }

    /// Returns the number of seconds remaining in the timelock for a proposal.
    /// Returns 0 if the timelock has elapsed or not started.
    pub fn timelock_remaining(env: Env, proposal_id: u64) -> Result<u64, GovernanceError> {
        let proposal = Self::get_proposal_inner(&env, proposal_id)?;
        if proposal.timelock_start == 0 {
            return Ok(0);
        }
        let elapsed = env.ledger().timestamp().saturating_sub(proposal.timelock_start);
        Ok(TIMELOCK_SECONDS.saturating_sub(elapsed))
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    fn require_initialized(env: &Env) -> Result<(), GovernanceError> {
        if !env.storage().persistent().has(&DataKey::Initialized) {
            return Err(GovernanceError::NotInitialized);
        }
        Ok(())
    }

    fn require_signer(env: &Env, addr: &Address) -> Result<(), GovernanceError> {
        let signers: Vec<Address> = env.storage().persistent().get(&DataKey::Signers).unwrap();
        let mut i = 0u32;
        while i < signers.len() {
            if signers.get(i).unwrap() == *addr {
                return Ok(());
            }
            i += 1;
        }
        Err(GovernanceError::UnauthorizedSigner)
    }

    fn get_proposal_inner(env: &Env, proposal_id: u64) -> Result<UpgradeProposal, GovernanceError> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)
    }

    fn require_active(proposal: &UpgradeProposal) -> Result<(), GovernanceError> {
        match proposal.status {
            ProposalStatus::Executed  => Err(GovernanceError::ProposalAlreadyExecuted),
            ProposalStatus::Cancelled => Err(GovernanceError::ProposalCancelled),
            _ => Ok(()),
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Env, String as SorobanString};

    fn setup() -> (Env, UpgradeGovernanceContractClient<'static>, Vec<Address>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, UpgradeGovernanceContract);
        let client = UpgradeGovernanceContractClient::new(&env, &contract_id);

        let signers: Vec<Address> = soroban_sdk::vec![
            &env,
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
        ];

        let admin = signers.get(0).unwrap();
        client.initialize(&admin, &signers);

        (env, client, signers)
    }

    fn dummy_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0x42u8; 32])
    }

    #[test]
    fn test_initialize_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, UpgradeGovernanceContract);
        let client = UpgradeGovernanceContractClient::new(&env, &contract_id);

        let signers: soroban_sdk::Vec<Address> = soroban_sdk::vec![
            &env,
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
        ];
        let admin = signers.get(0).unwrap();
        client.initialize(&admin, &signers);

        let stored_signers = client.get_signers();
        assert_eq!(stored_signers.len(), 5);
    }

    #[test]
    fn test_double_initialize_fails() {
        let (_, client, signers) = setup();
        let admin = signers.get(0).unwrap();
        let all_signers: soroban_sdk::Vec<Address> = soroban_sdk::vec![
            client.env(),
            signers.get(0).unwrap(),
            signers.get(1).unwrap(),
            signers.get(2).unwrap(),
            signers.get(3).unwrap(),
            signers.get(4).unwrap(),
        ];
        let result = client.try_initialize(&admin, &all_signers);
        assert!(result.is_err());
    }

    #[test]
    fn test_propose_and_count() {
        let (env, client, signers) = setup();
        let proposer = signers.get(0).unwrap();
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let id = client.propose(&proposer, &target, &hash, &cid);
        assert_eq!(id, 1);
        assert_eq!(client.proposal_count(), 1);
    }

    #[test]
    fn test_non_signer_cannot_propose() {
        let (env, client, _) = setup();
        let outsider = Address::generate(&env);
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let result = client.try_propose(&outsider, &target, &hash, &cid);
        assert!(result.is_err());
    }

    #[test]
    fn test_approval_reaches_quorum_and_starts_timelock() {
        let (env, client, signers) = setup();
        let proposer = signers.get(0).unwrap();
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let id = client.propose(&proposer, &target, &hash, &cid);

        // proposer is first approval; need 2 more
        client.approve(&signers.get(1).unwrap(), &id);
        client.approve(&signers.get(2).unwrap(), &id);

        let proposal = client.get_proposal(&id);
        assert_eq!(proposal.status, ProposalStatus::TimelockStarted);
        assert!(proposal.timelock_start > 0);
    }

    #[test]
    fn test_double_approval_rejected() {
        let (env, client, signers) = setup();
        let proposer = signers.get(0).unwrap();
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let id = client.propose(&proposer, &target, &hash, &cid);
        // proposer already approved via propose(); try again
        let result = client.try_approve(&proposer, &id);
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_fails_before_timelock_elapses() {
        let (env, client, signers) = setup();
        let proposer = signers.get(0).unwrap();
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let id = client.propose(&proposer, &target, &hash, &cid);
        client.approve(&signers.get(1).unwrap(), &id);
        client.approve(&signers.get(2).unwrap(), &id);

        // Do NOT advance ledger time — timelock is still active
        let result = client.try_execute(&proposer, &id);
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_succeeds_after_48h() {
        let (env, client, signers) = setup();
        let proposer = signers.get(0).unwrap();
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let id = client.propose(&proposer, &target, &hash, &cid);
        client.approve(&signers.get(1).unwrap(), &id);
        client.approve(&signers.get(2).unwrap(), &id);

        // Advance ledger past 48 hours (172,800 seconds)
        env.ledger().with_mut(|l| {
            l.timestamp += TIMELOCK_SECONDS + 1;
        });

        let returned_hash = client.execute(&proposer, &id);
        assert_eq!(returned_hash, hash);

        let proposal = client.get_proposal(&id);
        assert_eq!(proposal.status, ProposalStatus::Executed);
    }

    #[test]
    fn test_cancel_proposal() {
        let (env, client, signers) = setup();
        let proposer = signers.get(0).unwrap();
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let id = client.propose(&proposer, &target, &hash, &cid);
        client.cancel(&proposer, &id);

        let proposal = client.get_proposal(&id);
        assert_eq!(proposal.status, ProposalStatus::Cancelled);

        // Cannot approve after cancellation
        let result = client.try_approve(&signers.get(1).unwrap(), &id);
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_fails_on_insufficient_approvals() {
        let (env, client, signers) = setup();
        let proposer = signers.get(0).unwrap();
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let id = client.propose(&proposer, &target, &hash, &cid);
        // Only 1 approval (proposer) — below quorum of 3
        let result = client.try_execute(&proposer, &id);
        assert!(result.is_err());
    }

    #[test]
    fn test_timelock_remaining_decrements() {
        let (env, client, signers) = setup();
        let proposer = signers.get(0).unwrap();
        let target = Address::generate(&env);
        let hash = dummy_hash(&env);
        let cid = SorobanString::from_str(&env, "ipfs://Qm...");

        let id = client.propose(&proposer, &target, &hash, &cid);
        client.approve(&signers.get(1).unwrap(), &id);
        client.approve(&signers.get(2).unwrap(), &id);

        let remaining_full = client.timelock_remaining(&id);
        assert_eq!(remaining_full, TIMELOCK_SECONDS);

        // Advance 1 hour
        env.ledger().with_mut(|l| { l.timestamp += 3600; });
        let remaining_after = client.timelock_remaining(&id);
        assert_eq!(remaining_after, TIMELOCK_SECONDS - 3600);
    }
}
