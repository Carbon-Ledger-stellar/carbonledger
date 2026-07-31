//! # Adversarial Test Suite — CarbonLedger
//!
//! This module exercises every known carbon credit fraud vector against the four
//! Soroban contracts.  Each test is documented with the attack narrative it
//! represents and verifies that the contract correctly **rejects** the attempt.
//!
//! ## Directory layout
//!
//! ```
//! tests/adversarial/
//! ├── mod.rs               ← this file (module declarations + CarbonError coverage table)
//! ├── helpers.rs           ← shared setup helpers
//! ├── registry_attacks.rs  ← carbon_registry fraud vectors
//! ├── credit_attacks.rs    ← carbon_credit fraud vectors
//! ├── marketplace_attacks.rs ← carbon_marketplace fraud vectors
//! └── oracle_attacks.rs    ← carbon_oracle fraud vectors
//! ```
//!
//! ## CarbonError Coverage
//!
//! | Code | Variant               | Test file / test name |
//! |------|-----------------------|-----------------------|
//! | 1    | ProjectNotFound       | registry_attacks::test_get_nonexistent_project |
//! | 2    | ProjectNotVerified    | credit_attacks::test_mint_unverified_project |
//! | 3    | ProjectSuspended      | marketplace_attacks::test_list_suspended_project, test_purchase_suspended_project |
//! | 4    | InsufficientCredits   | credit_attacks::test_retire_more_than_owned, test_retire_after_partial_retirement_over_limit |
//! | 5    | AlreadyRetired        | credit_attacks::test_retire_fully_retired_batch, test_transfer_retired_batch |
//! | 6    | SerialNumberConflict  | credit_attacks::test_duplicate_batch_id |
//! | 7    | UnauthorizedVerifier  | registry_attacks::test_verify_unauthorized, marketplace_attacks::test_delist_by_non_seller, oracle_attacks::test_rotate_oracle_unauthorized |
//! | 8    | UnauthorizedOracle    | registry_attacks::test_oracle_update_unauthorized, oracle_attacks::test_submit_monitoring_unauthorized |
//! | 9    | InvalidVintageYear    | registry_attacks::test_register_future_vintage, credit_attacks::test_mint_future_vintage, marketplace_attacks::test_vintage_year_invalid_listing |
//! | 10   | ListingNotFound       | marketplace_attacks::test_purchase_nonexistent, test_purchase_delisted |
//! | 11   | InsufficientLiquidity | marketplace_attacks::test_purchase_more_than_listed |
//! | 12   | PriceNotSet           | oracle_attacks::test_get_price_not_set |
//! | 13   | MonitoringDataStale   | oracle_attacks::test_monitoring_stale_after_365_days |
//! | 14   | DoubleCountingDetected| credit_attacks::test_overlapping_serial_ranges |
//! | 15   | RetirementIrreversible| credit_attacks::test_retire_already_retired_id |
//! | 16   | ZeroAmountNotAllowed  | credit_attacks::test_mint_zero_amount, test_mint_negative_amount, marketplace_attacks::test_zero_amount_purchase, test_zero_price_listing |
//! | 17   | ProjectAlreadyExists  | registry_attacks::test_register_duplicate |
//! | 18   | InvalidSerialRange    | credit_attacks::test_invalid_serial_range, test_serial_start_zero, marketplace_attacks::test_bulk_purchase_length_mismatch |
//! | 19   | AlreadyInitialized    | registry_attacks::test_double_initialize, marketplace_attacks::test_double_initialize, oracle_attacks::test_double_initialize_oracle |
//! | 22   | InvalidNonce          | oracle_attacks::test_replay_monitoring_nonce |

#![cfg(test)]
#![allow(unused_imports)]

mod helpers;
mod registry_attacks;
mod credit_attacks;
mod marketplace_attacks;
mod oracle_attacks;
