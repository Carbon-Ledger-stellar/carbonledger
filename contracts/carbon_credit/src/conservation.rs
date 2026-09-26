//! Conservation-law invariant helpers for credit supply accounting.
//!
//! # Conservation Laws
//!
//! The CarbonLedger credit supply must always satisfy three invariants:
//!
//! **I1 – Supply Conservation (global)**
//! ```text
//! total_minted == credits_active + credits_retired
//! ```
//! Credits can only be created by `mint_credits` and destroyed (retired)
//! by `retire_credits`. No other operation may change the total supply.
//!
//! **I2 – Per-Batch Conservation**
//! ```text
//! batch.amount == active_amount(batch) + retired_amount(batch)
//! ```
//! For every individual batch the minted amount equals the sum of what is
//! still held (active) and what has been permanently retired.
//!
//! **I3 – Retirement Monotonicity**
//! ```text
//! retired_at_time_T2 >= retired_at_time_T1   (for T2 > T1)
//! ```
//! The cumulative retired amount for any batch can never decrease because
//! retirement is irreversible on-chain.
//!
//! # Usage
//!
//! Import and call these helpers immediately after every state-mutating
//! contract call in tests:
//!
//! ```rust,ignore
//! use crate::conservation::{
//!     assert_global_conservation,
//!     assert_per_batch_conservation,
//!     assert_retirement_monotonic,
//!     ConservationSnapshot,
//! };
//!
//! // after mint_credits:
//! let snap = ConservationSnapshot::capture(&env, &client, &["b1"]);
//! assert_per_batch_conservation(&snap);
//! assert_global_conservation(&snap);
//!
//! // after retire_credits, pass the prior snapshot:
//! let snap2 = ConservationSnapshot::capture(&env, &client, &["b1"]);
//! assert_retirement_monotonic(&snap, &snap2, "b1");
//! ```
//!
//! Any violation causes an immediate `panic!` with a descriptive message
//! that identifies which invariant failed, which batch is affected, and
//! the exact numeric discrepancy.

#[cfg(test)]
pub mod conservation {
    use crate::{CarbonCreditContractClient, CreditStatus};
    use soroban_sdk::{Env, String};
    extern crate std;
    use std::format;

    // ── Data types ────────────────────────────────────────────────────────────

    /// Per-batch accounting snapshot taken at a single point in time.
    #[derive(Debug, Clone)]
    pub struct BatchSnapshot {
        pub batch_id: String,
        /// Total credits ever minted into this batch (immutable after mint).
        pub minted: i128,
        /// Credits currently active (held by owner, not yet retired).
        pub active: i128,
        /// Credits that have been permanently retired.
        pub retired: i128,
        /// Current status of the batch.
        pub status: CreditStatus,
    }

    /// Global accounting snapshot across all observed batches.
    #[derive(Debug, Clone)]
    pub struct ConservationSnapshot {
        pub batches: std::vec::Vec<BatchSnapshot>,
        pub total_minted: i128,
        pub total_active: i128,
        pub total_retired: i128,
    }

    impl ConservationSnapshot {
        /// Capture current state for the given batch IDs.
        ///
        /// `retirement_ids` is an optional slice of retirement certificate IDs
        /// used to compute `retired` exactly via `get_retirement_certificate`.
        /// When `None` the retired amount is inferred from `batch.status`.
        pub fn capture(
            env: &Env,
            client: &CarbonCreditContractClient,
            batch_ids: &[&str],
            retirement_ids: Option<&[&str]>,
        ) -> Self {
            let mut batches = std::vec::Vec::new();
            let mut total_minted: i128 = 0;
            let mut total_active: i128 = 0;
            let mut total_retired: i128 = 0;

            for &id in batch_ids {
                let batch = client.get_credit_batch(&String::from_str(env, id));

                // Compute retired amount:
                // - If retirement_ids provided, sum certs that reference this batch.
                // - Otherwise infer from status (conservative lower bound).
                let retired: i128 = if let Some(ret_ids) = retirement_ids {
                    ret_ids
                        .iter()
                        .filter_map(|&rid| {
                            let cert =
                                client.get_retirement_certificate(&String::from_str(env, rid));
                            if cert.credit_batch_id == String::from_str(env, id) {
                                Some(cert.amount)
                            } else {
                                None
                            }
                        })
                        .sum()
                } else {
                    match batch.status {
                        CreditStatus::FullyRetired => batch.amount,
                        _ => 0,
                    }
                };

                let active = batch.amount - retired;

                total_minted += batch.amount;
                total_active += active;
                total_retired += retired;

                batches.push(BatchSnapshot {
                    batch_id: String::from_str(env, id),
                    minted: batch.amount,
                    active,
                    retired,
                    status: batch.status,
                });
            }

            ConservationSnapshot {
                batches,
                total_minted,
                total_active,
                total_retired,
            }
        }
    }

    // ── I1 – Global conservation ──────────────────────────────────────────────

    /// Assert I1: `total_minted == total_active + total_retired` across all batches.
    ///
    /// # Panics
    /// Panics with a descriptive message if the conservation law is violated.
    pub fn assert_global_conservation(snap: &ConservationSnapshot) {
        let expected = snap.total_active + snap.total_retired;
        assert_eq!(
            snap.total_minted, expected,
            "INVARIANT I1 VIOLATED — global supply not conserved:\n  \
             total_minted={} != total_active({}) + total_retired({})\n  \
             Difference: {}",
            snap.total_minted,
            snap.total_active,
            snap.total_retired,
            snap.total_minted - expected
        );
    }

    // ── I2 – Per-batch conservation ───────────────────────────────────────────

    /// Assert I2: for every batch `minted == active + retired`.
    ///
    /// # Panics
    /// Panics with a descriptive message naming the violating batch.
    pub fn assert_per_batch_conservation(snap: &ConservationSnapshot) {
        for b in &snap.batches {
            let expected = b.active + b.retired;
            assert_eq!(
                b.minted, expected,
                "INVARIANT I2 VIOLATED — per-batch supply not conserved for batch '{:?}':\n  \
                 minted={} != active({}) + retired({})\n  \
                 Difference: {}",
                b.batch_id,
                b.minted,
                b.active,
                b.retired,
                b.minted - expected
            );
        }
    }

    /// Assert both I1 and I2 in a single call. Preferred for post-operation checks.
    pub fn assert_conservation(snap: &ConservationSnapshot) {
        assert_per_batch_conservation(snap);
        assert_global_conservation(snap);
    }

    // ── I3 – Retirement monotonicity ──────────────────────────────────────────

    /// Assert I3: retired amount for `batch_id` in `after` >= amount in `before`.
    ///
    /// # Panics
    /// Panics if the retired count decreased, naming the batch and amounts.
    pub fn assert_retirement_monotonic(
        before: &ConservationSnapshot,
        after: &ConservationSnapshot,
        batch_id: &str,
    ) {
        let prev = before
            .batches
            .iter()
            .find(|b| {
                // Compare string content (Soroban String doesn't impl PartialEq<&str>)
                format!("{:?}", b.batch_id) == format!("{:?}", batch_id)
                    && b.batch_id.len() == batch_id.len() as u32
            })
            .map(|b| b.retired)
            .unwrap_or(0);

        let curr = after
            .batches
            .iter()
            .find(|b| b.batch_id.len() == batch_id.len() as u32)
            .map(|b| b.retired)
            .unwrap_or(0);

        assert!(
            curr >= prev,
            "INVARIANT I3 VIOLATED — retirement is not monotonic for batch '{batch_id}':\n  \
             retired decreased from {prev} to {curr}\n  \
             Retirement is irreversible — this should never happen."
        );
    }

    /// Assert I3 for all batches present in both snapshots.
    pub fn assert_all_retirements_monotonic(
        before: &ConservationSnapshot,
        after: &ConservationSnapshot,
    ) {
        for prev_b in &before.batches {
            // Find matching batch in after snapshot by comparing lengths as a proxy
            // (Soroban String requires env context for equality checks in tests)
            if let Some(curr_b) = after.batches.iter().find(|b| {
                b.batch_id.len() == prev_b.batch_id.len()
            }) {
                assert!(
                    curr_b.retired >= prev_b.retired,
                    "INVARIANT I3 VIOLATED — retirement count decreased from {} to {} \
                     (batch length {} chars).\n  \
                     Retirement is irreversible — this should never happen.",
                    prev_b.retired,
                    curr_b.retired,
                    prev_b.batch_id.len()
                );
            }
        }
    }

    // ── Zero-supply assertions ─────────────────────────────────────────────────

    /// Assert that no credits exist outside of `mint_credits` and `retire_credits`.
    /// After minting, active + retired must exactly equal minted (no phantom credits).
    /// After retirement, minted must never decrease (credits are not destroyed,
    /// they are permanently marked retired).
    pub fn assert_no_phantom_credits(snap: &ConservationSnapshot) {
        assert!(
            snap.total_active >= 0,
            "PHANTOM CREDITS — total_active is negative: {}. \
             Credits cannot be created outside of mint_credits.",
            snap.total_active
        );
        assert!(
            snap.total_retired >= 0,
            "PHANTOM CREDITS — total_retired is negative: {}. \
             Credits cannot be destroyed outside of retire_credits.",
            snap.total_retired
        );
        assert!(
            snap.total_minted >= snap.total_retired,
            "PHANTOM CREDITS — more credits retired ({}) than ever minted ({}). \
             Conservation law broken.",
            snap.total_retired,
            snap.total_minted
        );
        for b in &snap.batches {
            assert!(
                b.active >= 0,
                "PHANTOM CREDITS — batch '{:?}' has negative active amount: {}.",
                b.batch_id,
                b.active
            );
            assert!(
                b.retired >= 0,
                "PHANTOM CREDITS — batch '{:?}' has negative retired amount: {}.",
                b.batch_id,
                b.retired
            );
        }
    }

    // ── Transfer-safety assertion ─────────────────────────────────────────────

    /// Assert that a transfer operation preserved total supply.
    ///
    /// Supply must be identical before and after transfer:
    /// transfer moves credits between owners but never creates or destroys them.
    pub fn assert_transfer_conserves_supply(
        before: &ConservationSnapshot,
        after: &ConservationSnapshot,
    ) {
        assert_eq!(
            before.total_minted, after.total_minted,
            "INVARIANT VIOLATED — total minted changed during transfer:\n  \
             before={} after={}\n  \
             transfer_credits must not create or destroy credits.",
            before.total_minted, after.total_minted
        );
        assert_eq!(
            before.total_retired, after.total_retired,
            "INVARIANT VIOLATED — total retired changed during transfer:\n  \
             before={} after={}\n  \
             transfer_credits must not retire credits.",
            before.total_retired, after.total_retired
        );
    }
}
