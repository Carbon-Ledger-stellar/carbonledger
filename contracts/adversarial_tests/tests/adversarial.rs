//! # Adversarial Test Suite — Entry Point
//!
//! Runs all red-team tests via `cargo test -p adversarial_tests`
//! or `cargo test --workspace` from the contracts directory.
//!
//! Organised as sub-modules, each covering one contract's fraud vectors.

mod helpers;
mod registry_attacks;
mod credit_attacks;
mod marketplace_attacks;
mod oracle_attacks;
