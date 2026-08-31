# Cross-Contract Integration Testing

This guide covers the cross-contract integration test suite added for issue #631, which
deploys all four CarbonLedger Soroban contracts (`carbon_registry`, `carbon_credit`,
`carbon_marketplace`, `carbon_oracle`) together in a single Soroban test environment and
exercises the full oracle-triggered issuance flow as a system, rather than testing each
contract in isolation (which the per-contract unit test suites already do).

## What this suite covers

The flow under test:

```
oracle submits signed monitoring data
  -> registry verifies the project and records issued credits
  -> carbon_credit mints a batch backed by that issuance
```

- **`test_full_oracle_to_credit_issuance_flow`** — the full happy path: two monitoring
  periods are submitted to the oracle, the registry verifies the project and records the
  summed verified tonnes as issued credits, and the credit contract mints a batch backed by
  that amount. Every intermediate state transition is asserted (oracle's summed tonnes,
  registry status `Pending` → `Verified`, `total_credits_issued`, minted batch amount/owner/
  status).
- **`test_minted_batch_can_be_listed_on_marketplace`** — confirms the fourth contract,
  `carbon_marketplace`, is wired correctly against a batch produced by the flow above (full
  four-contract system wiring, not just the three named in the flow).
- **`test_oracle_rejects_invalid_data_registry_and_credit_untouched`** — a zero-tonnes
  submission is rejected by the oracle itself; asserts the registry's project status/issued
  total and the credit contract's batch list are both untouched.
- **`test_unauthorized_oracle_call_to_registry_blocks_downstream_mint`** — a legitimate
  oracle submission is accepted, but an impostor address cannot record it as issued credits
  against the registry; asserts the rejection doesn't leak into registry state and no credit
  batch exists downstream.
- **`test_nonce_replay_rejected_downstream_state_unaffected`** — replaying a previously-used
  oracle signature nonce is rejected; asserts the oracle's own accounting reflects exactly
  one accepted submission and no registry/credit state changed as a side effect.

## Running the suite locally

The suite lives in its own workspace crate, `carbonledger-integration-tests`, rooted at
`/tests` (a sibling of `/contracts`) and added as a member of the `contracts` Cargo
workspace so it resolves against the exact same dependency versions as the contracts
themselves.

```bash
# From the repository root:
cd contracts
cargo test -p carbonledger-integration-tests
```

Or, to run just this suite's single test binary directly:

```bash
cd contracts
cargo test -p carbonledger-integration-tests --test oracle_registry_credit_issuance_flow
```

No external services, local Soroban RPC node, or network access are required — like the
per-contract unit tests, this suite runs entirely against the in-memory Soroban test `Env`
(`soroban_sdk::testutils`), which simulates ledger state, authorization, and cross-contract
invocation without a running network.

### Prerequisites

- Rust toolchain matching `rust-toolchain.toml` at the repo root.
- No `cargo-mutants` or other tooling is required for this suite (see
  `audit/mutation-testing-report.md` for that separate effort).

## Adding new cross-contract scenarios

1. Add a new `#[test]` function to
   `tests/oracle_registry_credit_issuance_flow_test.rs`, or create a new
   `<scenario>_test.rs` file in `tests/` and register it as an explicit `[[test]]` entry in
   `tests/Cargo.toml` (this crate uses `autotests = false` with explicit `[[test]]` entries
   rather than Cargo's directory-based auto-discovery, so every test file must be listed
   there to be picked up by `cargo test`).
2. Reuse `deploy_all(&env)` to get all four contracts deployed and wired together; it
   returns clients for all four plus the admin/verifier/oracle-signer addresses and the
   oracle's Ed25519 signing key (needed to sign monitoring-data and price submissions).
3. For error-propagation scenarios, prefer the `try_*` client methods (e.g.
   `try_submit_monitoring_data`, `try_increment_issued`) over methods that panic, so the
   test can assert on downstream contract state afterward instead of aborting at the first
   rejected call.

## Known pre-existing files not part of this suite

`tests/lifecycle_integration_test.rs` and `tests/upgrade_path_test.rs` predate this suite
and reference contract signatures (e.g. `carbon_oracle`'s `initialize` before Ed25519 oracle
signatures and the cross-contract registry wiring were added, and `carbon_credit`'s now
nonexistent `set_oracle_contract`) that no longer match the current contracts. They were
never wired into any Cargo workspace and are not compiled by `cargo test`. They are left
untouched by this change; updating or removing them is tracked separately from issue #631.
