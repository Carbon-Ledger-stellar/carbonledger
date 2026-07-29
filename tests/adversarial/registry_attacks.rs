//! # Registry Attack Scenarios
//!
//! Attack narratives covered:
//!
//! | Test | Attack | Error |
//! |------|--------|-------|
//! | test_get_nonexistent_project | Attacker queries a project ID that was never registered to confuse the UI or bypass validation | ProjectNotFound (1) |
//! | test_register_duplicate | Attacker re-registers an existing project to overwrite its metadata and steal revenue | ProjectAlreadyExists (17) |
//! | test_verify_unauthorized | Rogue address attempts to approve a project without being in the verifier list | UnauthorizedVerifier (7) |
//! | test_double_initialize | Attacker calls initialize() a second time to replace admin, verifier list, and oracle | AlreadyInitialized (19) |
//! | test_reject_unauthorized | Rogue address attempts to permanently reject a valid project | UnauthorizedVerifier (7) |
//! | test_suspend_unauthorized | Rogue address tries to halt issuance from a legitimate project | UnauthorizedVerifier (7) |
//! | test_oracle_update_unauthorized | Rogue oracle address pushes a false monitoring status | UnauthorizedOracle (8) |
//! | test_increment_issued_unauthorized | Rogue address inflates the issued credit counter to enable over-minting | UnauthorizedOracle (8) |
//! | test_register_low_score | Attacker submits a project with methodology score 69 to bypass quality gate | MethodologyScoreLow |
//! | test_register_future_vintage | Attacker registers a project with vintage year 3000 | InvalidVintageYear (9) |
//! | test_register_past_vintage | Attacker registers a project with vintage year 1889 | InvalidVintageYear (9) |

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use carbon_registry::{CarbonRegistryContract, CarbonRegistryContractClient, CarbonError, ProjectStatus};

use super::helpers::{make_registry, s};

// ── Attack 1: query a nonexistent project ──────────────────────────────────────
/// ATTACK: An attacker (or buggy client) queries a project ID that was never
/// registered, hoping to extract a default value or trigger undefined behaviour.
/// The contract must return ProjectNotFound, not a default struct.
#[test]
fn test_get_nonexistent_project() {
    let env = Env::default();
    let (client, _, _, _) = make_registry(&env);
    let result = client.try_get_project(&s(&env, "ghost-project-id"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectNotFound);
}

// ── Attack 2: duplicate project registration ──────────────────────────────────
/// ATTACK: A developer (or attacker) re-submits a project that already exists,
/// hoping to overwrite the project metadata (e.g., change the verifier address
/// to one they control) or claim credit for someone else's project.
#[test]
fn test_register_duplicate() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);
    let verifier = Address::generate(&env);

    // First registration succeeds.
    client.register_project(
        &admin,
        &s(&env, "proj-dup"),
        &s(&env, "Legit Project"),
        &s(&env, "QmCID"),
        &verifier,
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
        &s(&env, "forestry"),
        &75_u32,
        &2023_u32,
    ).unwrap();

    // Second registration with the same project_id must fail.
    let result = client.try_register_project(
        &admin,
        &s(&env, "proj-dup"),
        &s(&env, "Attacker Override"),
        &s(&env, "QmAttacker"),
        &Address::generate(&env), // attacker-controlled verifier
        &s(&env, "VCS"),
        &s(&env, "Brazil"),
        &s(&env, "forestry"),
        &75_u32,
        &2023_u32,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectAlreadyExists);
}

// ── Attack 3: unauthorized verifier ───────────────────────────────────────────
/// ATTACK: A rogue party who is NOT in the verifier list calls verify_project()
/// to approve a fraudulent carbon project and unlock credit minting.
#[test]
fn test_verify_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);
    let rogue = Address::generate(&env);

    client.register_project(
        &admin, &s(&env, "proj-x"), &s(&env, "Test"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &2023_u32,
    ).unwrap();

    let result = client.try_verify_project(&rogue, &s(&env, "proj-x"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);

    // Confirm project remains Pending.
    let project = client.get_project(&s(&env, "proj-x")).unwrap();
    assert_eq!(project.status, ProjectStatus::Pending);
}

// ── Attack 4: double-initialize to hijack admin ───────────────────────────────
/// ATTACK: An attacker calls initialize() a second time on an already-deployed
/// contract to replace the admin, verifier list, and oracle address with
/// attacker-controlled values.
#[test]
fn test_double_initialize() {
    let env = Env::default();
    let (client, _, _, _) = make_registry(&env);
    let attacker = Address::generate(&env);
    let attacker_oracle = Address::generate(&env);
    let attacker_verifier = Address::generate(&env);
    let mut attackers = soroban_sdk::vec![&env];
    attackers.push_back(attacker_verifier.clone());

    let result = client.try_initialize(&attacker, &attacker_oracle, &attackers);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::AlreadyInitialized);
}

// ── Attack 5: unauthorized rejection ──────────────────────────────────────────
/// ATTACK: A competitor or saboteur attempts to permanently reject a legitimate
/// project by calling reject_project() without being an accredited verifier.
#[test]
fn test_reject_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);
    let rogue = Address::generate(&env);

    client.register_project(
        &admin, &s(&env, "proj-y"), &s(&env, "Legit"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &2023_u32,
    ).unwrap();

    let result = client.try_reject_project(&rogue, &s(&env, "proj-y"), &s(&env, "sabotage"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);
}

// ── Attack 6: unauthorized suspension ─────────────────────────────────────────
/// ATTACK: A malicious actor calls suspend_project() to halt credit issuance
/// from a competitor's project, causing financial damage without admin rights.
#[test]
fn test_suspend_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);
    let rogue = Address::generate(&env);

    client.register_project(
        &admin, &s(&env, "proj-z"), &s(&env, "Legit"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &2023_u32,
    ).unwrap();

    let result = client.try_suspend_project(&rogue, &s(&env, "proj-z"), &s(&env, "fake reason"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedVerifier);
}

// ── Attack 7: rogue oracle status update ──────────────────────────────────────
/// ATTACK: A rogue address impersonates the oracle to push a false
/// ProjectStatus::Verified update, bypassing the verifier approval step.
#[test]
fn test_oracle_update_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);
    let rogue_oracle = Address::generate(&env);

    client.register_project(
        &admin, &s(&env, "proj-w"), &s(&env, "Legit"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &2023_u32,
    ).unwrap();

    let result = client.try_update_project_status(
        &rogue_oracle, &s(&env, "proj-w"), &ProjectStatus::Verified,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedOracle);
}

// ── Attack 8: rogue increment_issued ──────────────────────────────────────────
/// ATTACK: An attacker calls increment_issued() with a massive amount to inflate
/// total_credits_issued so they can mint more credits than were ever verified.
#[test]
fn test_increment_issued_unauthorized() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);
    let rogue = Address::generate(&env);

    client.register_project(
        &admin, &s(&env, "proj-v"), &s(&env, "Legit"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &2023_u32,
    ).unwrap();

    let result = client.try_increment_issued(&rogue, &s(&env, "proj-v"), &1_000_000_i128);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::UnauthorizedOracle);
}

// ── Attack 9: methodology score below minimum ─────────────────────────────────
/// ATTACK: An attacker registers a low-quality project with score 69 (below the
/// 70-point threshold) to list cheap, unverified credits on the marketplace.
#[test]
fn test_register_low_score() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);

    let result = client.try_register_project(
        &admin, &s(&env, "proj-score"), &s(&env, "Fake Proj"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &69_u32, // one point below minimum
        &2023_u32,
    );
    // Expect MethodologyScoreLow (error code 20 in registry)
    assert!(result.is_err(), "score 69 must be rejected");
}

// ── Attack 10: far-future vintage year ────────────────────────────────────────
/// ATTACK: An attacker sets vintage_year = 3000 to register credits for
/// CO2 that will notionally be offset millennia from now, committing fraud
/// against buyers who believe they are purchasing contemporary offsets.
#[test]
fn test_register_future_vintage() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);

    let result = client.try_register_project(
        &admin, &s(&env, "proj-future"), &s(&env, "Time Traveller"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32,
        &3000_u32, // far future
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
}

// ── Attack 11: prehistoric vintage year ───────────────────────────────────────
/// ATTACK: An attacker sets vintage_year = 1889 (before the protocol minimum
/// of 1990) to register phantom credits for carbon that was supposedly
/// sequestered over a century ago.
#[test]
fn test_register_past_vintage() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);

    let result = client.try_register_project(
        &admin, &s(&env, "proj-past"), &s(&env, "Time Traveller"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32,
        &1889_u32, // pre-1990
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
}
