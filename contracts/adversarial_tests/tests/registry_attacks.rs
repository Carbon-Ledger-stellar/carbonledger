//! # Registry Attack Scenarios — carbon_registry contract
//!
//! Each test documents the attack narrative it represents and confirms the
//! contract returns the expected `CarbonError` variant.
//!
//! | Test | Attack narrative | Expected error |
//! |------|------------------|----------------|
//! | test_get_nonexistent_project      | Query phantom project to extract default value | ProjectNotFound (1) |
//! | test_register_duplicate           | Re-register existing project to overwrite verifier | ProjectAlreadyExists (17) |
//! | test_verify_unauthorized          | Rogue address approves fraudulent project | UnauthorizedVerifier (7) |
//! | test_double_initialize            | Replace admin/verifier list via second initialize() | AlreadyInitialized (19) |
//! | test_reject_unauthorized          | Saboteur permanently rejects a legitimate project | UnauthorizedVerifier (7) |
//! | test_suspend_unauthorized         | Competitor halts issuance without admin rights | UnauthorizedVerifier (7) |
//! | test_oracle_update_unauthorized   | Rogue oracle pushes false ProjectStatus::Verified | UnauthorizedOracle (8) |
//! | test_increment_issued_unauthorized | Attacker inflates issued-credit counter | UnauthorizedOracle (8) |
//! | test_register_low_score           | Project with score 69 bypasses quality gate | MethodologyScoreLow |
//! | test_register_future_vintage      | Phantom credits dated year 3000 | InvalidVintageYear (9) |
//! | test_register_past_vintage        | Phantom credits dated year 1889 | InvalidVintageYear (9) |

use soroban_sdk::{testutils::Address as _, Address, Env};
use carbon_registry::{CarbonError, ProjectStatus};

use crate::helpers::{make_registry, s};

// ── Attack 1: query a nonexistent project ─────────────────────────────────────
/// ATTACK: An attacker (or buggy client) queries a project ID that was never
/// registered, hoping to extract a default value or trigger undefined behaviour.
#[test]
fn test_get_nonexistent_project() {
    let env = Env::default();
    let (client, _, _, _) = make_registry(&env);
    let result = client.try_get_project(&s(&env, "ghost-project-id"));
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectNotFound);
}

// ── Attack 2: duplicate project registration ──────────────────────────────────
/// ATTACK: A developer re-submits a project that already exists, hoping to
/// overwrite the project's verifier address to one they control and capture
/// verification fees and revenue.
#[test]
fn test_register_duplicate() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);
    let verifier = Address::generate(&env);

    client.register_project(
        &admin, &s(&env, "proj-dup"), &s(&env, "Legit Project"), &s(&env, "QmCID"),
        &verifier, &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &2023_u32,
    ).unwrap();

    let result = client.try_register_project(
        &admin, &s(&env, "proj-dup"), &s(&env, "Attacker Override"), &s(&env, "QmAttacker"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &2023_u32,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ProjectAlreadyExists);
}

// ── Attack 3: unauthorized verifier ───────────────────────────────────────────
/// ATTACK: A rogue party calls verify_project() to approve a fraudulent project
/// and unlock credit minting without being in the approved verifier list.
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

    // Project must remain Pending after the rejected attack.
    let project = client.get_project(&s(&env, "proj-x")).unwrap();
    assert_eq!(project.status, ProjectStatus::Pending);
}

// ── Attack 4: double-initialize to hijack admin ───────────────────────────────
/// ATTACK: An attacker calls initialize() a second time to replace the admin,
/// verifier list, and oracle address with attacker-controlled values.
#[test]
fn test_double_initialize() {
    let env = Env::default();
    let (client, _, _, _) = make_registry(&env);
    let attacker          = Address::generate(&env);
    let attacker_oracle   = Address::generate(&env);
    let attacker_verifier = Address::generate(&env);
    let mut attackers = soroban_sdk::vec![&env];
    attackers.push_back(attacker_verifier);

    let result = client.try_initialize(&attacker, &attacker_oracle, &attackers);
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::AlreadyInitialized);
}

// ── Attack 5: unauthorized project rejection ──────────────────────────────────
/// ATTACK: A competitor calls reject_project() to permanently reject a
/// legitimate project, blocking it from ever issuing credits.
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

// ── Attack 6: unauthorized project suspension ─────────────────────────────────
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
        &69_u32, &2023_u32,
    );
    assert!(result.is_err(), "score 69 must be rejected (below 70 minimum)");
}

// ── Attack 10: vintage year far in the future ─────────────────────────────────
/// ATTACK: An attacker sets vintage_year = 3000 to register credits for CO2
/// that will supposedly be offset millennia from now, selling them today.
#[test]
fn test_register_future_vintage() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);

    let result = client.try_register_project(
        &admin, &s(&env, "proj-future"), &s(&env, "Time Traveller"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &3000_u32,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
}

// ── Attack 11: vintage year in the distant past ───────────────────────────────
/// ATTACK: An attacker sets vintage_year = 1889 (before the 1990 protocol
/// minimum) to register phantom credits for carbon sequestered pre-protocol.
#[test]
fn test_register_past_vintage() {
    let env = Env::default();
    let (client, admin, _, _) = make_registry(&env);

    let result = client.try_register_project(
        &admin, &s(&env, "proj-past"), &s(&env, "Time Traveller"), &s(&env, "QmCID"),
        &Address::generate(&env), &s(&env, "VCS"), &s(&env, "Brazil"), &s(&env, "forestry"),
        &75_u32, &1889_u32,
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::InvalidVintageYear);
}
