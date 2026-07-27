# CarbonLedger: 150 GitHub Issues for Outside Contributors

> This document catalogs 150 well-scoped issues for experienced outside contributors. Each issue represents 1–4+ weeks of focused work and requires real domain understanding of Soroban/Rust, distributed systems, cryptography, or DeFi mechanics.

---

## Table of Contents

- [Smart Contract Security & Correctness](#smart-contract-security--correctness) (18 issues)
- [Oracle & Off-Chain Data Integrity](#oracle--off-chain-data-integrity) (14 issues)
- [Backend & API Engineering](#backend--api-engineering) (22 issues)
- [Frontend & Wallet UX](#frontend--wallet-ux) (18 issues)
- [Testing & QA Infrastructure](#testing--qa-infrastructure) (22 issues)
- [DevOps & Infrastructure](#devops--infrastructure) (20 issues)
- [Documentation & Protocol Design](#documentation--protocol-design) (16 issues)
- [Compliance & Standards](#compliance--standards) (20 issues)

---

## Smart Contract Security & Correctness

### [Security] Implement Fuzz Testing Harness for `carbon_credit` Mint/Retire Invariants
- **Work:** Build a property-based fuzz testing harness using `cargo-fuzz` or `proptest` that exhaustively tests the invariants of `mint_credits()` and `retire_credits()` — specifically that serial number ranges never overlap across batches, that retired credits can never be transferred, and that total supply accounting remains consistent under arbitrary input sequences.
- **Scope:** In scope: fuzz targets for `carbon_credit` contract, CI integration of fuzz corpus. Out of scope: fuzzing other contracts (handled in separate issues), formal proofs.
- **Acceptance Criteria:**
  - Fuzz targets compile and run under `cargo fuzz` with a seed corpus of at least 50 entries
  - At least 3 documented invariants are encoded as fuzz assertions
  - CI runs fuzz targets for a fixed time budget (e.g. 60 seconds) on every PR
  - Any panic or invariant violation produces a reproducible minimized test case
  - Results documented in `audit/fuzz-report.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `testing`, `help-wanted`
- **Relevant Files/Contracts:** `contracts/carbon_credit/src/lib.rs`, `audit/`

---

### [Security] Cross-Contract Reentrancy Analysis for Marketplace → Credit → Registry Call Chain
- **Work:** Conduct a systematic reentrancy analysis of the `carbon_marketplace` → `carbon_credit` → `carbon_registry` cross-contract call chain. Soroban's execution model differs from EVM, but re-entrancy via token callbacks and contract-to-contract invocations still requires explicit analysis. Produce a written report and, where gaps are found, implement defensive guards.
- **Scope:** In scope: all cross-contract `invoke_contract` calls in marketplace and credit contracts, token transfer callbacks, write-up of findings. Out of scope: EVM-style reentrancy guards (not applicable), oracle contract (separate issue).
- **Acceptance Criteria:**
  - A documented call graph of all cross-contract invocations exists in `audit/`
  - Every identified reentrancy vector is either proven safe with reasoning or patched
  - At least one test reproduces any found vulnerability (or confirms absence)
  - Report follows a standard format: finding, severity, recommendation, resolution
  - No unresolved High or Critical findings at merge time
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `audit`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/carbon_marketplace/src/lib.rs`, `contracts/carbon_credit/src/lib.rs`, `contracts/carbon_registry/src/lib.rs`

---

### [Security] Replay Attack and Transaction Malleability Analysis for Credit Retirement
- **Work:** Analyze the retirement flow for replay attack vectors — specifically whether a signed retirement transaction or a retirement certificate can be replayed to double-retire or spoof a retirement event. Soroban's ledger sequence and auth model provide some protection, but the off-chain certificate issuance path needs equal scrutiny.
- **Scope:** In scope: on-chain retirement path, off-chain certificate generation in backend, any JWT or signature used to authenticate certificate requests. Out of scope: wallet-level replay protection (handled by Stellar core).
- **Acceptance Criteria:**
  - All retirement-related auth paths are documented with their replay resistance mechanism
  - Any gap in replay protection is patched and tested
  - A test exists that attempts a replayed retirement and confirms it is rejected
  - Backend certificate endpoint validates on-chain retirement before issuing certificate
  - Findings documented in `audit/replay-analysis.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `backend`, `audit`
- **Relevant Files/Contracts:** `contracts/carbon_credit/src/lib.rs`, `backend/src/retirements/`, `audit/`

---

### [Security] Formal Verification of Serial Number Uniqueness Invariant Using Kani or Creusot
- **Work:** Use a Rust formal verification tool (Kani model checker or Creusot) to prove the serial number uniqueness invariant: that `verify_serial_range()` correctly prevents any overlap between any two minted batches across all possible execution histories. This is the core anti-double-counting guarantee of the protocol.
- **Scope:** In scope: `verify_serial_range()` and `mint_credits()` in `carbon_credit`, the serial storage data structure. Out of scope: other contracts, performance of verification, CI integration (nice to have but not required for initial issue).
- **Acceptance Criteria:**
  - At least one formal proof or bounded model check covers the no-overlap invariant
  - Verification toolchain setup is documented in `docs/formal-verification.md`
  - Any counterexample found is converted to a regression test and the code fixed
  - The proof or model check is reproducible from a clean environment
  - A summary of what is proven (and what assumptions are made) is included
- **Complexity:** Very High
- **Estimated Time Frame:** 4+ weeks
- **Suggested Labels:** `smart-contract`, `security`, `formal-verification`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/carbon_credit/src/lib.rs`

---

### [Security] Authorization Boundary Audit: Verifier and Oracle Role Escalation Paths
- **Work:** Systematically audit all functions gated by `UnauthorizedVerifier` and `UnauthorizedOracle` error codes to verify that role assignment, role checking, and role revocation are implemented correctly and cannot be bypassed through indirect paths.
- **Scope:** In scope: all four contracts, role storage, any admin or initialization function that sets roles. Out of scope: wallet-level key management, Stellar account authorization.
- **Acceptance Criteria:**
  - A role-function matrix document exists mapping every privileged function to its required role
  - Every role check is covered by at least one positive and one negative test
  - No privilege escalation path found, or all found paths are patched
  - Admin/initializer functions are protected against being called twice
  - Document in `audit/role-authorization.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `audit`
- **Relevant Files/Contracts:** `contracts/carbon_registry/src/lib.rs`, `contracts/carbon_oracle/src/lib.rs`, all contracts

---

### [Security] Integer Overflow and Underflow Audit Across All Soroban Contracts
- **Work:** Audit every arithmetic operation across all four contracts for integer overflow, underflow, and incorrect unit assumptions (e.g., confusing tonnes with grams, or USDC stroops with full units). Rust's debug builds panic on overflow but release builds wrap — Soroban WASM release builds must be explicitly analyzed.
- **Scope:** In scope: all arithmetic in all four contracts, USDC amount handling, credit quantity math. Out of scope: frontend display math, backend arithmetic.
- **Acceptance Criteria:**
  - Every arithmetic operation is categorized (safe / checked / potentially unsafe)
  - All unsafe operations are replaced with `checked_*` or `saturating_*` variants with justification
  - Unit tests cover boundary values (u64::MAX, zero, one) for every quantity field
  - A note in `audit/` documents the overflow analysis methodology
  - CI contract build uses `--release` flag to match production behavior
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `smart-contract`, `security`, `good-first-issue`
- **Relevant Files/Contracts:** All contracts under `contracts/`

---

### [Security] Contract Upgrade Safety Analysis and Migration Path Design
- **Work:** Soroban contracts can be upgraded via `update_current_contract_wasm`. Design and document a safe upgrade process for all four CarbonLedger contracts, including storage layout migration, version gating, and rollback procedures. Implement an upgrade test that verifies state is preserved across a contract upgrade.
- **Scope:** In scope: upgrade mechanism for all four contracts, storage migration strategy, test for state preservation. Out of scope: actual mainnet upgrade execution, frontend changes for upgrade UX.
- **Acceptance Criteria:**
  - Upgrade path documented for each contract in `docs/upgrade-playbook.md`
  - Storage version field added to each contract's persistent storage
  - Integration test demonstrates state persistence across a simulated upgrade
  - Admin-only upgrade guard is present and tested
  - Rollback procedure (or documented impossibility with mitigations) is specified
- **Complexity:** Very High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `smart-contract`, `security`, `needs-design-review`, `help-wanted`
- **Relevant Files/Contracts:** All contracts, `tests/`

---

### [Security] Denial-of-Service Vector Analysis for Storage Exhaustion in Registry and Credit Contracts
- **Work:** Analyze whether an adversary can exhaust Soroban storage ledger entries by registering unbounded numbers of projects, credit batches, or serial number entries, causing legitimate operations to fail or become prohibitively expensive. Propose and implement per-account or per-project storage caps where appropriate.
- **Scope:** In scope: storage entry analysis for `carbon_registry` and `carbon_credit`, fee/rent implications, proposed caps. Out of scope: network-level DoS, frontend rate limiting.
- **Acceptance Criteria:**
  - Maximum storage entries per account/project are calculated and documented
  - At least one test demonstrates the DoS scenario (if viable) and the fix
  - Storage caps are implemented with appropriate error codes
  - Impact on legitimate high-volume projects is analyzed (e.g., a project with 10,000 batches)
  - Findings in `audit/storage-dos-analysis.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `audit`
- **Relevant Files/Contracts:** `contracts/carbon_registry/src/lib.rs`, `contracts/carbon_credit/src/lib.rs`

---

### [Security] Implement Checks-Effects-Interactions Pattern Audit and Enforcement Linting
- **Work:** Audit all state-mutating contract functions to verify they follow the checks-effects-interactions pattern. Implement a custom Clippy lint or a pre-commit check that flags functions where external calls (cross-contract invocations, token transfers) precede state writes.
- **Scope:** In scope: all four contracts, custom lint or static analysis rule, CI integration. Out of scope: frontend or backend code.
- **Acceptance Criteria:**
  - All existing violations of checks-effects-interactions are identified and fixed
  - A lint rule or script flags future violations in CI
  - Each fix is accompanied by a comment explaining the ordering rationale
  - The lint tool is documented in `docs/development-guidelines.md`
  - At least one test per fixed function verifies the correct ordering behavior
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `smart-contract`, `security`, `tooling`
- **Relevant Files/Contracts:** All contracts, `.github/workflows/`

---

### [Security] Marketplace USDC Payment Atomicity: Failure Recovery and Partial Fill Analysis
- **Work:** Analyze and harden the atomicity of the `purchase_credits()` and `bulk_purchase()` flows — specifically what happens if the USDC transfer succeeds but the credit transfer fails (or vice versa), and whether partial fills in bulk purchases leave the system in an inconsistent state. Implement and test proper rollback behavior.
- **Scope:** In scope: `purchase_credits`, `bulk_purchase` in marketplace contract, USDC token transfer interactions. Out of scope: frontend payment UX, backend order tracking.
- **Acceptance Criteria:**
  - Every failure mode in the payment flow is enumerated and documented
  - Soroban transaction atomicity is leveraged — partial success is proven impossible at the contract level or explicitly handled
  - Tests cover: USDC transfer failure, credit transfer failure, bulk purchase with one invalid listing
  - Any inconsistent state found is fixed and regression-tested
  - Document in `audit/payment-atomicity.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `defi`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/carbon_marketplace/src/lib.rs`

---

### [Security] Soroban Storage TTL and Ledger Entry Expiration Audit
- **Work:** Audit all persistent and temporary storage entries across the four contracts to verify that TTL (time-to-live) values are set correctly. In Soroban, ledger entries that expire are permanently deleted — incorrect TTLs on credit or retirement data could cause catastrophic data loss. Propose and implement a TTL extension strategy for long-lived data.
- **Scope:** In scope: all `env.storage().persistent()`, `env.storage().temporary()`, and `env.storage().instance()` calls, TTL configuration analysis, extension strategy for permanent data (retirements, serial ranges). Out of scope: Stellar network-level TTL policy changes.
- **Acceptance Criteria:**
  - Every storage entry is categorized by expected lifetime and matched to the correct storage type
  - All retirement and serial number entries use persistent storage with explicit TTL extension
  - A TTL extension mechanism is implemented for data that must survive indefinitely
  - Tests verify that critical data survives past the default TTL without extension
  - TTL strategy documented in `docs/storage-ttl-strategy.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `soroban`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/`, `docs/`

---

### [Security] Implement Contract Pause/Circuit-Breaker Mechanism for Emergency Response
- **Work:** Design and implement an emergency pause mechanism for the marketplace and credit contracts that allows an authorized admin to halt all state-mutating operations (purchases, retirements, minting) in response to a discovered exploit, without permanently destroying contract state. The pause should be time-bounded to prevent an admin from indefinitely freezing user funds.
- **Scope:** In scope: pause flag in contract storage, admin-only pause/unpause functions, time-bound pause (max 72 hours without renewal), affected functions check pause before execution. Out of scope: multi-sig admin requirement (noted as follow-up), governance mechanism for pause.
- **Acceptance Criteria:**
  - All state-mutating functions in marketplace and credit contracts check pause flag
  - Pause can only be set by the designated admin address
  - Pause automatically expires after 72 hours without renewal
  - Tests cover: pause blocks operations, unpause restores them, expiry auto-unpauses
  - Emergency procedure documented in `docs/runbooks/emergency-pause.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `smart-contract`, `security`, `emergency-response`
- **Relevant Files/Contracts:** `contracts/carbon_marketplace/src/lib.rs`, `contracts/carbon_credit/src/lib.rs`

---

### [Security] Multi-Signature Admin for Critical Contract Operations
- **Work:** Design and implement a 2-of-3 multi-signature requirement for the most privileged contract operations: contract upgrades, verifier role assignment, oracle address changes, and emergency pause. Use Stellar's native multi-sig capabilities or implement an on-chain approval accumulator pattern.
- **Scope:** In scope: multi-sig design for the 4 critical operations listed, implementation using Stellar account multi-sig or on-chain accumulator, admin key rotation procedure. Out of scope: full DAO governance, time locks (noted as future work).
- **Acceptance Criteria:**
  - All 4 critical operations require 2-of-3 signatures before execution
  - Single-signature execution of these operations is rejected by the contract
  - Admin key rotation procedure is documented and tested
  - Tests cover: 1-of-3 rejected, 2-of-3 accepted, 3-of-3 accepted, replay of used signature rejected
  - Design document in `docs/adr/` explaining the multi-sig scheme chosen
- **Complexity:** Very High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `smart-contract`, `security`, `cryptography`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/`, `docs/adr/`

---

### [Security] Gas/Fee Optimization Audit for High-Frequency Contract Functions
- **Work:** Profile and optimize the Soroban resource consumption (instructions, read/write ledger entries, event bytes) of the most frequently called functions: `purchase_credits`, `retire_credits`, `list_credits`, and `get_active_listings`. Target a 20% reduction in resource cost for each function without changing external behavior.
- **Scope:** In scope: Soroban resource profiling for 4 functions, optimization of storage access patterns, elimination of redundant reads, benchmark before/after. Out of scope: changes to function signatures or external behavior, optimization of less-frequently called functions.
- **Acceptance Criteria:**
  - Baseline resource costs are measured and documented for all 4 functions
  - At least 20% resource reduction achieved for at least 2 of the 4 functions
  - All existing tests pass without modification after optimization
  - Optimization techniques are documented with explanations (not just code changes)
  - Benchmark results stored in `audit/gas-optimization-report.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `performance`, `optimization`
- **Relevant Files/Contracts:** `contracts/carbon_marketplace/src/lib.rs`, `contracts/carbon_credit/src/lib.rs`

---

### [Security] Vintage Year Validation and Future-Dating Attack Prevention
- **Work:** Audit and harden the `InvalidVintageYear` validation logic to prevent: backdating credits to inflate their perceived scarcity, future-dating credits for years not yet monitored, and vintage year manipulation in bulk purchases that mix vintage years. Implement strict validation with configurable acceptable ranges.
- **Scope:** In scope: vintage year validation in `carbon_credit` and `carbon_marketplace`, configurable min/max vintage year bounds, bulk purchase vintage consistency check. Out of scope: legal definition of vintage year compliance, methodology-specific vintage rules.
- **Acceptance Criteria:**
  - Vintage years outside a configurable range (e.g., 1990–current year) are rejected
  - Future vintage years (beyond current ledger year) cannot be minted
  - Bulk purchases mixing vintage years trigger appropriate validation if methodology requires consistency
  - Tests cover: valid vintage, too-old vintage, future vintage, bulk mix
  - Validation logic documented with configurable bounds in `docs/`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `smart-contract`, `security`, `validation`
- **Relevant Files/Contracts:** `contracts/carbon_credit/src/lib.rs`, `contracts/carbon_marketplace/src/lib.rs`

---

### [Security] Verifier Collusion Detection: On-Chain Attestation Diversity Check
- **Work:** Implement a mechanism to detect and prevent single-verifier monopolies on high-value projects: require that projects above a configurable credit issuance threshold have attestations from at least 2 independent verifiers, and that no single verifier has approved more than a configurable percentage of total active projects.
- **Scope:** In scope: verifier diversity tracking in `carbon_registry`, multi-verifier attestation requirement for large projects, concentration metrics query function. Out of scope: off-chain verifier vetting process, legal accreditation requirements.
- **Acceptance Criteria:**
  - Projects requesting issuance above the threshold require 2 independent verifier approvals
  - A query function returns current verifier concentration metrics
  - Single-verifier approval of a threshold-exceeding project is rejected with a descriptive error
  - Tests cover: small project (1 verifier ok), large project (2 verifiers required), concentration check
  - Thresholds are configurable without contract redeployment
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `governance`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/carbon_registry/src/lib.rs`

---

### [Security] Implement Listing Price Bounds to Prevent Wash Trading and Price Manipulation
- **Work:** Implement on-chain price bound validation in `carbon_marketplace` that rejects listings deviating more than a configurable percentage (e.g., 50%) from the current oracle benchmark price for that methodology and vintage. This prevents wash trading at artificially inflated prices and protects buyers from manipulated market prices.
- **Scope:** In scope: price bound check in `list_credits()` using oracle benchmark, configurable deviation threshold, error code for out-of-bounds listings. Out of scope: order book mechanics, off-chain price discovery, removing `PriceNotSet` as valid state.
- **Acceptance Criteria:**
  - `list_credits()` queries oracle benchmark and rejects listings outside the deviation band
  - Listings are accepted when no benchmark price exists (graceful degradation)
  - Tests cover: listing within bounds, listing above bound rejected, listing below bound rejected, no benchmark present
  - Deviation threshold is a contract-level configurable parameter set at initialization
  - Interaction with `update_credit_price()` is tested for price update propagation
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `smart-contract`, `defi`, `security`
- **Relevant Files/Contracts:** `contracts/carbon_marketplace/src/lib.rs`, `contracts/carbon_oracle/src/lib.rs`

---

### [Security] Implement Cryptographic Commitment Scheme for Pre-Oracle Project Data Integrity
- **Work:** Implement a cryptographic commitment scheme where a project developer commits to their monitoring data hash before the oracle processes it, and the oracle's on-chain submission includes a proof that the submitted data matches the prior commitment. This prevents a compromised oracle from substituting fraudulent monitoring data after the fact.
- **Scope:** In scope: commitment generation in a project developer client tool, commitment storage in PostgreSQL, proof verification in `verification_listener.py`, integration with `submit_monitoring_data()`. Out of scope: zero-knowledge proofs (hash-based commitment only), changes to Soroban contract storage structure.
- **Acceptance Criteria:**
  - Project developers generate and submit a data commitment hash before data is processed
  - Oracle verifies commitment opens correctly before submitting on-chain
  - Mismatched commitment is rejected and flagged as a potential fraud attempt
  - Integration test demonstrates commitment, data submission, and proof verification
  - Scheme documented with security properties in `docs/commitment-scheme.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `oracle`, `cryptography`, `security`, `needs-design-review`
- **Relevant Files/Contracts:** `oracle/verification_listener.py`, `oracle/`

---

## Oracle & Off-Chain Data Integrity

### [Oracle] Multi-Source Consensus Engine for Satellite Monitoring Data
- **Work:** The current `satellite_monitor.py` accepts data from a single webhook source. Design and implement a consensus engine that requires agreement from at least 2-of-3 independent satellite data providers (e.g., Google Earth Engine, Planet Labs, Sentinel Hub) before submitting monitoring data on-chain, preventing a single compromised or erroneous source from triggering fraudulent credit issuance.
- **Scope:** In scope: multi-source aggregation in `oracle/`, configurable quorum threshold, conflict resolution logic, on-chain submission only after quorum. Out of scope: acquiring actual API keys for all three providers (mock interfaces acceptable), changes to Soroban contracts.
- **Acceptance Criteria:**
  - Configurable N-of-M quorum is enforced before any `submit_monitoring_data()` call
  - Conflicting data from sources triggers an alert and blocks submission
  - Unit tests cover: all sources agree, one source disagrees, source timeout/unavailability
  - Quorum configuration is documented in `docs/oracle-configuration.md`
  - Integration test demonstrates the system using mock providers
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `oracle`, `distributed-systems`, `help-wanted`, `needs-design-review`
- **Relevant Files/Contracts:** `oracle/satellite_monitor.py`, `oracle/`

---

### [Oracle] Price Feed Manipulation Resistance: TWAP Implementation for Carbon Credit Benchmark
- **Work:** The current `price_oracle.py` pushes spot prices from Xpansiv CBL. Replace or supplement spot pricing with a Time-Weighted Average Price (TWAP) calculation that averages prices over a configurable window (default: 24 hours), making the on-chain price resistant to short-term manipulation or data source outages.
- **Scope:** In scope: TWAP calculation in Python oracle, price history storage (PostgreSQL), on-chain submission of TWAP value, deviation alert at 15% threshold. Out of scope: on-chain TWAP calculation in Soroban (off-chain only), changes to marketplace pricing logic.
- **Acceptance Criteria:**
  - TWAP is calculated over a configurable time window with at least hourly data points
  - 15% single-update deviation triggers an alert and blocks automatic submission
  - Price history is persisted in PostgreSQL with timestamps for auditability
  - Unit tests cover: normal TWAP calculation, outlier detection, sparse data handling
  - TWAP methodology documented in `docs/oracle-price-methodology.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `oracle`, `defi`, `security`
- **Relevant Files/Contracts:** `oracle/price_oracle.py`, `backend/prisma/schema.prisma`

---

### [Oracle] Oracle Bridge Liveness Monitoring and Dead-Man's Switch Implementation
- **Work:** Implement a liveness monitoring system for all three oracle services (verification_listener, price_oracle, satellite_monitor) that detects when a service has not submitted on-chain data within its expected interval (6h, 12h, 365d respectively) and triggers automated alerts. Include a dead-man's switch that flags affected data as stale in the contract if no heartbeat is received.
- **Scope:** In scope: heartbeat mechanism for all oracle services, alerting via webhook/email, integration with `is_monitoring_current()` contract function. Out of scope: auto-restart of oracle services (operational concern), changes to alert delivery infrastructure.
- **Acceptance Criteria:**
  - Each oracle service emits a heartbeat to a monitoring endpoint after each successful submission
  - Missed heartbeat beyond 2x the expected interval triggers a configurable alert
  - `is_monitoring_current()` is tested against the liveness threshold
  - Monitoring dashboard or log output shows last-seen time for each oracle service
  - Runbook for responding to liveness alerts in `docs/runbooks/oracle-liveness.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `oracle`, `devops`, `infrastructure`
- **Relevant Files/Contracts:** `oracle/`, `contracts/carbon_oracle/src/lib.rs`

---

### [Oracle] Tamper-Evident Audit Log for All Oracle Submissions Using Hash Chaining
- **Work:** Implement a hash-chained audit log for every data submission made by the oracle bridge to Soroban contracts. Each submission record should include a hash of the previous record, creating a tamper-evident chain that allows independent auditors to verify the oracle's submission history has not been retroactively altered.
- **Scope:** In scope: hash chain implementation in PostgreSQL, verification tool for chain integrity, submission logging for all three oracle services. Out of scope: on-chain storage of the hash chain (too expensive), real-time public exposure of the log.
- **Acceptance Criteria:**
  - Every oracle submission is recorded with: timestamp, contract function called, payload hash, previous record hash
  - A CLI tool verifies chain integrity from genesis to latest record
  - Any gap or hash mismatch in the chain is detected and reported
  - Unit tests cover: normal chain, tampered record, missing record
  - Schema migration for hash chain table included
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `oracle`, `security`, `audit`, `backend`
- **Relevant Files/Contracts:** `oracle/`, `backend/prisma/schema.prisma`

---

### [Oracle] Verification Listener: Idempotent Retry Logic with Exponential Backoff
- **Work:** The current `verification_listener.py` polls every 6 hours but lacks robust retry logic for failed on-chain submissions. Implement idempotent retry with exponential backoff and jitter, dead-letter queue for permanently failed submissions, and exactly-once submission guarantees using a nonce or content-addressed submission ID.
- **Scope:** In scope: retry logic in verification_listener, dead-letter queue in PostgreSQL, idempotency via submission nonce, alerting on dead-letter entries. Out of scope: changes to Soroban contracts, changes to other oracle services (though the pattern should be reusable).
- **Acceptance Criteria:**
  - Failed submissions retry with exponential backoff (base 2, max 8 retries)
  - Permanently failed submissions land in a dead-letter table with full context
  - Duplicate submissions are detected and rejected before hitting the blockchain
  - Integration test simulates RPC failure and verifies eventual success
  - Dead-letter alerting fires when queue depth exceeds configurable threshold
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `oracle`, `backend`, `distributed-systems`
- **Relevant Files/Contracts:** `oracle/verification_listener.py`, `backend/prisma/schema.prisma`

---

### [Oracle] Satellite Data Schema Validation and Fraud Detection Preprocessing Layer
- **Work:** Implement a validation and anomaly detection preprocessing layer for incoming satellite monitoring data before it is forwarded to the consensus engine or submitted on-chain. This should include schema validation, coordinate bounding box verification against registered project coordinates, and statistical anomaly detection for implausible carbon sequestration claims (e.g., a 100x increase from the previous period).
- **Scope:** In scope: validation layer in `oracle/`, anomaly thresholds configurable per methodology, quarantine queue for suspicious data. Out of scope: machine learning models for anomaly detection (rule-based only), changes to Soroban contracts.
- **Acceptance Criteria:**
  - Schema validation rejects malformed payloads with structured error messages
  - Coordinates are verified against the project's registered bounding box (within configurable tolerance)
  - Sequestration claims more than N standard deviations from historical mean are quarantined for manual review
  - Unit tests cover: valid data, schema violations, out-of-bounds coordinates, anomalous quantities
  - Quarantine queue is accessible via backend admin API
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `oracle`, `security`, `backend`, `needs-design-review`
- **Relevant Files/Contracts:** `oracle/satellite_monitor.py`, `oracle/`, `backend/src/`

---

### [Oracle] Oracle Bridge Disaster Recovery: Warm Standby with Automatic Failover
- **Work:** Design and implement a warm standby architecture for the oracle bridge (all three Python services) where a secondary instance maintains up-to-date state and can be promoted to primary within 2 minutes if the primary fails. Include an automated failover test that kills the primary and verifies the standby takes over without data loss.
- **Scope:** In scope: standby instance configuration, shared state in PostgreSQL (not in-process), leader election using Redis distributed lock, automated failover test. Out of scope: geographic redundancy across regions, primary-primary active-active architecture.
- **Acceptance Criteria:**
  - Standby instance is always warm (processing events but not submitting on-chain)
  - Failover to standby completes within 2 minutes of primary failure detection
  - No on-chain submissions are duplicated during failover (idempotency from oracle retry issue)
  - Automated failover test passes in CI (kill primary, wait, verify standby promoted)
  - Architecture documented in `docs/oracle-disaster-recovery.md`
- **Complexity:** Very High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `devops`, `infrastructure`, `oracle`, `distributed-systems`, `needs-design-review`
- **Relevant Files/Contracts:** `oracle/`, `docker-compose.yml`

---

### [Oracle] Methodology-Specific Monitoring Data Schema Versioning
- **Work:** Implement a versioned schema system for monitoring data submitted via the oracle, where each carbon methodology (REDD+, Clean Cookstoves, Improved Forest Management, etc.) has a defined schema for its monitoring parameters. Submissions must validate against the methodology's schema version, and schema upgrades are backward-compatible.
- **Scope:** In scope: schema registry in PostgreSQL, per-methodology schema definition (at least 4 methodologies), version-pinned validation in `verification_listener.py`, schema evolution rules. Out of scope: on-chain schema storage (off-chain only), UI for schema management.
- **Acceptance Criteria:**
  - At least 4 methodology schemas are defined and version-controlled in the repository
  - Submissions are validated against the pinned schema version for their methodology
  - Schema version is included in every on-chain monitoring data submission
  - Backward-incompatible schema changes require a new version (old version remains valid for existing submissions)
  - Schema registry management documented in `docs/methodology-schemas.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `oracle`, `backend`, `protocol-design`, `needs-design-review`
- **Relevant Files/Contracts:** `oracle/verification_listener.py`, `backend/prisma/schema.prisma`

---

### [Oracle] Property-Based Testing for Oracle Price Feed with `proptest` and `hypothesis`
- **Work:** Implement property-based tests for the oracle price feed logic using `proptest` (Rust) and `hypothesis` (Python), covering: TWAP calculation correctness under arbitrary price histories, deviation alert triggering under generated inputs, and price submission rejection for out-of-range values.
- **Scope:** In scope: `proptest` for `carbon_oracle` Rust contract, `hypothesis` for `oracle/price_oracle.py`, properties for TWAP math and deviation logic. Out of scope: contract fuzz testing (separate issue), satellite data properties (separate issue).
- **Acceptance Criteria:**
  - At least 5 properties are encoded for oracle price math (e.g., TWAP is always between min and max observed price)
  - Proptest and hypothesis tests run in CI without requiring special setup
  - At least one property-generated counterexample was found during development (or absence is documented)
  - Test properties are commented with the business invariant they represent
  - Run instructions documented in `docs/testing-guide.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `oracle`, `smart-contract`
- **Relevant Files/Contracts:** `contracts/carbon_oracle/src/lib.rs`, `oracle/price_oracle.py`

---

### [Oracle] On-Chain/Off-Chain State Reconciliation for Oracle Submission History
- **Work:** Build a reconciliation job that compares every oracle submission recorded in PostgreSQL against the corresponding on-chain state in `carbon_oracle`, detecting gaps where the oracle believes it submitted data but no on-chain record exists, and vice versa. Auto-resolve benign divergences and escalate ambiguous ones for manual review.
- **Scope:** In scope: reconciliation job for oracle submissions, divergence detection logic, auto-resolution for benign cases, escalation queue. Out of scope: real-time streaming reconciliation (batch acceptable), reconciliation for non-oracle backend state (separate issue).
- **Acceptance Criteria:**
  - Reconciliation job runs on a configurable schedule (default: every 30 minutes)
  - All divergence types enumerated with a defined resolution strategy per type
  - Unresolvable divergences create a flagged record for manual review
  - Integration test simulates a missed on-chain submission and verifies detection
  - Metrics emitted: submissions_checked, divergences_found, auto_resolved, escalated
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `oracle`, `backend`, `distributed-systems`
- **Relevant Files/Contracts:** `oracle/`, `backend/src/`, `contracts/carbon_oracle/src/lib.rs`

---

### [Oracle] Multi-Source Price Feed Aggregation with Source Weighting and Outlier Rejection
- **Work:** Extend the price oracle to aggregate benchmark prices from multiple sources (Xpansiv CBL, Toucan Protocol, and at least one additional feed), apply configurable per-source reliability weights, and use an outlier rejection algorithm (e.g., trimmed mean or median absolute deviation) before computing the final on-chain price.
- **Scope:** In scope: multi-source fetching in `price_oracle.py`, weighting config, outlier rejection algorithm, per-source latency and availability tracking. Out of scope: building proprietary price feeds, changes to Soroban oracle contract storage.
- **Acceptance Criteria:**
  - At least 3 price sources are aggregated per update cycle
  - Source weights are configurable without code changes
  - Outlier rejection removes sources deviating more than 2 standard deviations from the trimmed mean
  - Per-source availability metrics are logged and queryable
  - Unit tests cover: all sources healthy, one outlier source, two sources unavailable (fallback behavior)
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `oracle`, `defi`, `backend`
- **Relevant Files/Contracts:** `oracle/price_oracle.py`

---

### [Oracle] Satellite Monitoring Webhook Authentication and Request Signing
- **Work:** Implement HMAC-SHA256 request signing for all inbound satellite monitoring webhooks so that `satellite_monitor.py` rejects any request not signed by a registered data provider. Include a key registration flow, signature verification middleware, replay protection via timestamp window, and key rotation support.
- **Scope:** In scope: webhook authentication middleware in Python, provider key registry in PostgreSQL, replay protection via 5-minute timestamp window, key rotation endpoint. Out of scope: TLS mutual authentication (noted as complementary), changes to Soroban contracts.
- **Acceptance Criteria:**
  - Unsigned or incorrectly signed webhook requests are rejected with 401
  - Replayed requests (timestamp outside 5-minute window) are rejected with 400
  - Provider keys can be rotated without downtime (overlap period supported)
  - Unit tests cover: valid signature, invalid signature, expired timestamp, unknown provider
  - Authentication scheme documented in `docs/satellite-webhook-auth.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `oracle`, `security`, `backend`
- **Relevant Files/Contracts:** `oracle/satellite_monitor.py`, `oracle/`

---

### [Oracle] Implement Circuit Breaker for Oracle-to-Blockchain RPC Submission
- **Work:** Implement a circuit breaker pattern for all oracle-to-Soroban RPC calls so that repeated RPC failures trip the circuit (stop attempting submissions), wait a configurable cooldown period, and then probe with a single request before resuming normal operation. This prevents log flooding and resource exhaustion during Stellar network degradations.
- **Scope:** In scope: circuit breaker implementation (half-open/open/closed states) for all three oracle services, configurable failure threshold and cooldown, alerting when circuit opens. Out of scope: multi-region RPC fallback (separate concern), changes to Soroban contracts.
- **Acceptance Criteria:**
  - Circuit breaker transitions correctly between closed, open, and half-open states
  - Alert fires when any oracle circuit opens
  - Circuit state is observable via a `/health` endpoint in each oracle service
  - Integration test simulates RPC failures and verifies circuit state transitions
  - Circuit breaker configuration documented in `docs/oracle-configuration.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `oracle`, `distributed-systems`, `infrastructure`
- **Relevant Files/Contracts:** `oracle/`

---

### [Oracle] Benchmark Price On-Chain Freshness Enforcement in Marketplace Purchase Flow
- **Work:** Enforce that the oracle benchmark price used at listing time is no more than 24 hours old at the moment of purchase. If the benchmark price has gone stale since the listing was created, the purchase should be blocked with a `MonitoringDataStale` error until the oracle updates the price. This closes a stale-price manipulation window.
- **Scope:** In scope: price freshness check in `purchase_credits()` in marketplace contract, interaction with `carbon_oracle` price TTL. Out of scope: auto-price-refresh mechanics, frontend staleness UX (separate concern).
- **Acceptance Criteria:**
  - `purchase_credits()` queries oracle price timestamp and rejects purchases where benchmark is stale
  - Listings created before a price staleness event remain blocked until oracle updates
  - Tests cover: fresh price (purchase succeeds), stale price (purchase blocked), price refreshed (purchase succeeds again)
  - Price freshness window is a configurable contract parameter
  - Interaction with existing `is_monitoring_current()` function is documented
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `oracle`, `smart-contract`, `defi`
- **Relevant Files/Contracts:** `contracts/carbon_marketplace/src/lib.rs`, `contracts/carbon_oracle/src/lib.rs`

---

## Backend & API Engineering

### [Backend] Idempotency Layer for Credit Purchase and Retirement Endpoints
- **Work:** Implement a robust idempotency layer for the `/marketplace/purchase` and `/retirements/retire` endpoints using client-supplied idempotency keys (UUID v4). Store idempotency state in Redis with a TTL, and replay the exact same response for duplicate requests, preventing double-charges or double-retirements caused by network retries.
- **Scope:** In scope: idempotency middleware for NestJS, Redis storage schema, idempotency key validation, response replay. Out of scope: frontend retry logic, changes to Soroban contracts.
- **Acceptance Criteria:**
  - Both endpoints require an `Idempotency-Key` header (returning 400 if absent)
  - Duplicate requests with the same key within TTL return identical responses without re-execution
  - Concurrent duplicate requests are serialized (no race to double-execute)
  - Integration tests cover: first request, duplicate request, expired key, different key
  - TTL and storage backend are configurable via environment variables
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `api`, `financial`, `help-wanted`
- **Relevant Files/Contracts:** `backend/src/marketplace/`, `backend/src/retirements/`

---

### [Backend] Event-Sourcing Architecture for Credit Lifecycle Audit Trail
- **Work:** Refactor the credit lifecycle tracking in the backend to use an event-sourcing pattern — every state change (minted, listed, purchased, retired) is recorded as an immutable event, and the current state is derived by replaying events. This enables complete audit trail reconstruction, point-in-time queries, and easier debugging of inconsistencies between on-chain and off-chain state.
- **Scope:** In scope: event store schema in PostgreSQL, event types for full credit lifecycle, projection rebuild tooling. Out of scope: CQRS read model optimization (second phase), replacing existing REST API endpoints (they should be backed by projections).
- **Acceptance Criteria:**
  - Event store table schema designed and migrated (immutable append-only)
  - All six lifecycle transitions generate events with full context
  - Projection rebuild script replays events to reconstruct current state
  - API endpoints serve from projections, not direct mutable tables
  - Integration tests verify event log matches on-chain state after each lifecycle step
- **Complexity:** Very High
- **Estimated Time Frame:** 4+ weeks
- **Suggested Labels:** `backend`, `architecture`, `needs-design-review`, `help-wanted`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Backend] Zero-Downtime Database Migration Strategy with Schema Versioning
- **Work:** Design and implement a zero-downtime database migration strategy using expand-contract (also known as parallel-change) migrations. This ensures that a new backend version can be deployed while the old version is still serving traffic, critical for a financial application where downtime affects live transactions.
- **Scope:** In scope: migration tooling with Prisma, expand-contract pattern documentation, backward-compatible migration examples for 2–3 representative schema changes. Out of scope: blue-green deployment infrastructure (DevOps issue), changes to existing migrations.
- **Acceptance Criteria:**
  - A documented migration policy in `docs/database-migration-policy.md` specifies allowed and forbidden migration patterns
  - At least two example expand-contract migrations are implemented and tested
  - A CI check verifies new migrations don't contain destructive operations without an explicit override
  - Rollback procedure for the last N migrations is documented and tested
  - Prisma migration naming conventions are enforced via a lint script
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `database`, `infrastructure`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/`

---

### [Backend] Rate Limiting Architecture with Per-Route, Per-User, and Per-IP Tiers
- **Work:** Implement a multi-tier rate limiting system for the NestJS backend that applies different limits to: unauthenticated requests (IP-based), authenticated non-financial requests (user-based, loose), and financial endpoints (purchase, retire — user-based, strict). Use Redis sliding window counters for accuracy.
- **Scope:** In scope: rate limit middleware/guard in NestJS, Redis sliding window implementation, per-route configuration, 429 responses with Retry-After headers. Out of scope: CDN/WAF-level rate limiting, DDoS mitigation at infrastructure layer.
- **Acceptance Criteria:**
  - Three distinct rate limit tiers are configurable without code changes (env vars or config file)
  - Financial endpoints enforce the strictest tier and return structured 429 responses
  - Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are included in all responses
  - Integration tests cover: normal traffic, limit exhaustion, burst recovery after window reset
  - Burst allowance is configurable separately from sustained rate
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `api`, `security`, `infrastructure`
- **Relevant Files/Contracts:** `backend/src/`, `backend/src/common/`

---

### [Backend] On-Chain / Off-Chain State Reconciliation Service
- **Work:** Build a reconciliation service that periodically compares the backend's PostgreSQL state with on-chain contract state, detecting and alerting on divergences (e.g., a credit is recorded as active in the DB but retired on-chain, or vice versa). Implement automated resolution for benign divergences and escalation for unresolvable conflicts.
- **Scope:** In scope: reconciliation job (cron-based), divergence detection for all credit states, alerting, auto-resolution for benign cases (e.g., DB missed an on-chain event). Out of scope: real-time streaming reconciliation (batch is acceptable), changes to Soroban contracts.
- **Acceptance Criteria:**
  - Reconciliation job runs on a configurable schedule (default: every 15 minutes)
  - All divergence types are enumerated and each has a defined resolution strategy
  - Unresolvable divergences create a flagged record for manual review
  - Integration test simulates a missed on-chain event and verifies the reconciliation detects and resolves it
  - Metrics emitted: records_checked, divergences_found, auto_resolved, escalated
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `distributed-systems`, `infrastructure`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/`, `contracts/`

---

### [Backend] Structured Logging and Distributed Tracing with Correlation IDs for Financial Operations
- **Work:** Implement structured JSON logging with distributed trace correlation IDs across the backend API, oracle bridge, and frontend API calls. Every financial operation (purchase, retirement) should produce a log trail traceable from frontend request through backend to blockchain transaction hash.
- **Scope:** In scope: structured logging in NestJS (using Pino or Winston), correlation ID propagation via HTTP headers, trace IDs linked to blockchain transaction hashes, Loki/Grafana integration for log querying. Out of scope: full distributed tracing with Jaeger/Zipkin spans (correlation IDs only).
- **Acceptance Criteria:**
  - Every API request has a unique correlation ID propagated through all log entries
  - Financial operation logs include: correlation_id, user_id, operation, contract_function, tx_hash, duration_ms
  - Log level is configurable per-module without redeployment
  - A Grafana query template for tracing a purchase from request to tx_hash is documented
  - No secrets or PII appear in any log output (log scrubbing is tested)
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `observability`, `infrastructure`
- **Relevant Files/Contracts:** `backend/src/`, `logging/`, `oracle/`

---

### [Backend] Retirement Certificate Generation Service with Cryptographic Signatures
- **Work:** Build a backend service that generates verifiable retirement certificates as PDF and JSON-LD documents, each signed with a CarbonLedger-controlled Ed25519 key pair. The signature allows third parties (regulators, ESG auditors) to independently verify the certificate's authenticity without trusting the backend, using only the public key published in `Stellar.toml`.
- **Scope:** In scope: PDF and JSON-LD certificate generation, Ed25519 signature over certificate content hash, signature verification endpoint, public key rotation strategy. Out of scope: IPFS storage of certificates (separate issue), certificate template design.
- **Acceptance Criteria:**
  - Generated certificates include: project ID, vintage year, serial range, retirement tx hash, beneficiary, timestamp, issuer signature
  - A standalone verification CLI tool can verify a certificate using only the public key from `Stellar.toml`
  - Signature covers all substantive fields (not just metadata)
  - Key rotation procedure is documented without breaking existing certificate verification
  - Integration tests cover: certificate generation, signature verification, tampered certificate detection
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `cryptography`, `api`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/retirements/`, `Stellar.toml`

---

### [Backend] Webhook Delivery System for On-Chain Event Notifications
- **Work:** Implement a webhook delivery system that notifies registered corporate clients when their credits are confirmed retired, when monitoring data is submitted for their purchased projects, or when oracle price updates affect their portfolio. Include delivery guarantees (at-least-once), retry logic, and HMAC signature verification for webhook consumers.
- **Scope:** In scope: webhook registration API, delivery queue (PostgreSQL-backed), retry with exponential backoff, HMAC-SHA256 signatures on payloads, delivery log. Out of scope: real-time streaming (webhooks only), push notifications for end users.
- **Acceptance Criteria:**
  - Webhooks are delivered within 60 seconds of the triggering on-chain event
  - Failed deliveries retry up to 10 times with exponential backoff
  - Each webhook payload includes an HMAC signature consumers can verify
  - Delivery logs are queryable via a `/webhooks/deliveries` admin endpoint
  - Integration tests cover: successful delivery, failed delivery with retry, signature verification
- **Complexity:** Medium
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `api`, `infrastructure`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Backend] GraphQL API Layer for Complex Credit Provenance Queries
- **Work:** Implement a GraphQL API layer alongside the existing REST API that enables complex provenance queries: fetch a credit batch with its full project history, all monitoring submissions, and all transfer events in a single query. GraphQL's nested query model is significantly better suited to the tree-shaped provenance data than REST pagination.
- **Scope:** In scope: GraphQL schema covering credits, projects, retirements, and provenance, resolver implementation with DataLoader for N+1 prevention, query depth limiting for DoS prevention. Out of scope: replacing the REST API (GraphQL is additive), subscriptions/real-time updates.
- **Acceptance Criteria:**
  - GraphQL schema covers all provenance-relevant entity types
  - DataLoader prevents N+1 queries on all nested resolvers (verified with query logging)
  - Query depth limited to 10 levels with a configurable cap
  - Introspection is disabled in production (configurable)
  - Integration tests cover: provenance query, filtered marketplace query, certificate lookup
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `api`, `help-wanted`
- **Relevant Files/Contracts:** `backend/src/`

---

### [Backend] Background Job Queue for Certificate Generation and IPFS Pinning
- **Work:** Implement a robust background job queue (using BullMQ with Redis) for certificate generation and IPFS pinning tasks that currently block the retirement API response. Retirement responses should return immediately with a job ID, and clients can poll or receive a webhook when the certificate is ready.
- **Scope:** In scope: BullMQ job queue setup, certificate generation job, IPFS pinning job, polling endpoint, webhook notification on completion, job retry on failure. Out of scope: changes to the retirement contract flow, frontend polling UI (separate issue).
- **Acceptance Criteria:**
  - Retirement endpoint returns within 500ms regardless of certificate generation time
  - Certificate generation job retries up to 5 times on failure with backoff
  - IPFS pinning job retries independently from certificate generation
  - Job status is queryable via `GET /retirements/:id/certificate-status`
  - Integration tests verify: job queued, job completed, job failed with retry, webhook delivery
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `infrastructure`, `api`
- **Relevant Files/Contracts:** `backend/src/retirements/`, `backend/src/`

---

### [Backend] Pagination and Cursor-Based Navigation for Marketplace and Audit Trail Endpoints
- **Work:** Implement cursor-based pagination (as opposed to offset pagination) for all list endpoints in the marketplace, audit trail, and retirement history APIs. Cursor-based pagination is stable under concurrent inserts — critical for a marketplace where listings change while a user is browsing.
- **Scope:** In scope: cursor-based pagination for `/marketplace/listings`, `/audit-trail`, `/retirements`, and `/projects` endpoints, opaque cursor encoding, page size limits. Out of scope: infinite scroll frontend implementation, search/filtering.
- **Acceptance Criteria:**
  - All four endpoints use cursor-based pagination with opaque base64-encoded cursors
  - Page size is bounded at a configurable maximum (default: 100)
  - Cursors remain valid for at least 1 hour even under concurrent writes
  - Response includes `next_cursor`, `prev_cursor` (if applicable), and `total_count` (approximate)
  - Integration tests cover: first page, next page, last page, invalid cursor handling
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `api`, `performance`, `good-first-issue`
- **Relevant Files/Contracts:** `backend/src/marketplace/`, `backend/src/`

---

### [Backend] Bulk Retirement API Endpoint for Enterprise Carbon Offsetting Programs
- **Work:** Implement a backend API endpoint for bulk retirement operations that allows a corporate client to submit a CSV of serial number ranges with per-range beneficiaries and reasons, validate all ranges atomically, and execute the bulk retirement via `retire_credits()` calls batched into the minimum number of Stellar transactions.
- **Scope:** In scope: CSV upload endpoint, validation of all ranges before any on-chain submission, transaction batching strategy, progress reporting for large batches, idempotency. Out of scope: frontend CSV wizard (separate issue), changes to the Soroban contract.
- **Acceptance Criteria:**
  - CSV format is documented with validation rules and example file
  - All ranges are validated before any on-chain transaction is submitted (fail fast)
  - Large batches (>100 ranges) are processed with progress updates via polling endpoint
  - Failed individual ranges produce per-row error reports without failing successful rows
  - Integration tests cover: valid batch, invalid rows, partial failure, idempotent retry
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `api`, `enterprise`, `help-wanted`
- **Relevant Files/Contracts:** `backend/src/retirements/`

---

### [Backend] Implement IPFS Content Addressing for Certificate Immutability Verification
- **Work:** Store all retirement certificates on IPFS and record their CID (Content Identifier) in the Soroban retirement event. Implement a backend endpoint that retrieves a certificate by CID and verifies the content matches the on-chain hash, providing a cryptographic guarantee that the certificate displayed matches what was originally recorded.
- **Scope:** In scope: IPFS upload during retirement, CID recording in Soroban retirement event or storage, backend retrieval and verification endpoint, content-hash verification. Out of scope: multi-provider pinning redundancy (separate issue), certificate content format changes.
- **Acceptance Criteria:**
  - Every retirement generates a certificate pinned to IPFS with its CID recorded in the Soroban event
  - A public `/certificates/:cid/verify` endpoint retrieves and cryptographically verifies the certificate
  - Tampered certificate content is detected via CID mismatch and returns a 409 with explanation
  - CID is included in the retirement certificate PDF itself (self-referential link)
  - Integration tests cover: normal retrieval, tampered content detection, CID not found
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `cryptography`, `ipfs`, `infrastructure`
- **Relevant Files/Contracts:** `backend/src/retirements/`, `contracts/carbon_credit/src/lib.rs`

---

### [Backend] Database Connection Pool Tuning and Query Performance Optimization
- **Work:** Profile and optimize the PostgreSQL query performance for the 5 highest-latency backend endpoints identified in load tests. Implement proper indexes, rewrite N+1 queries, tune the Prisma connection pool, and add query execution time logging for queries exceeding a configurable threshold.
- **Scope:** In scope: query profiling with `EXPLAIN ANALYZE`, index additions, N+1 elimination, connection pool configuration, slow query logging. Out of scope: database sharding, read replicas, changes to schema structure.
- **Acceptance Criteria:**
  - Baseline P99 query latencies are documented for the top 5 endpoints before optimization
  - At least 3 of the 5 endpoints show ≥30% latency improvement after optimization
  - All added indexes are documented with the query they support
  - No N+1 queries exist in the optimized endpoints (verified with query count logging)
  - Connection pool settings documented in `.env.example` with tuning guidance
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `database`, `performance`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Backend] Role-Based Access Control Refactor with Attribute-Based Policies
- **Work:** Refactor the current NestJS RBAC implementation to use attribute-based access control (ABAC) policies that express permissions as: "a user with role X can perform action Y on resource Z if condition W is true." This enables nuanced permissions like "a project developer can update their own project but not others'" without proliferating special-case guard logic.
- **Scope:** In scope: ABAC policy engine (using CASL or equivalent), policy definitions for all existing roles and resources, migration of existing guards to ABAC, tests for all policies. Out of scope: UI for policy management, dynamic policy updates without redeployment.
- **Acceptance Criteria:**
  - All existing permission checks are expressed as ABAC policies
  - Policy definitions are co-located in a single `src/policies/` directory
  - Unit tests cover every policy with positive and negative cases
  - No permission checks remain as ad-hoc guard logic outside the policy engine
  - Policy documentation in `docs/access-control.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `security`, `architecture`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/`

---

### [Backend] Marketplace Search and Filtering API with Full-Text and Faceted Queries
- **Work:** Implement a comprehensive search and filtering API for the marketplace that supports: full-text search on project names and descriptions, faceted filtering by methodology, vintage year, country, and price range, and relevance-based sorting. Use PostgreSQL full-text search capabilities to avoid introducing an external search dependency.
- **Scope:** In scope: full-text search using PostgreSQL `tsvector`, faceted filter query builder, relevance scoring, index creation for search columns. Out of scope: Elasticsearch or Typesense integration, saved searches, frontend search UI.
- **Acceptance Criteria:**
  - Full-text search returns ranked results using PostgreSQL `ts_rank`
  - At least 5 faceted filters (methodology, vintage, country, price range, verification status) work in combination
  - Search queries complete in under 100ms at 10,000 listings (benchmarked with `EXPLAIN ANALYZE`)
  - tsvector columns are updated automatically via PostgreSQL triggers
  - Integration tests cover: text search, combined facets, empty results, invalid filter values
- **Complexity:** Medium
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `api`, `performance`
- **Relevant Files/Contracts:** `backend/src/marketplace/`, `backend/prisma/schema.prisma`

---

### [Backend] Implement SEP-0010 Stellar Web Authentication for Wallet-Native Login
- **Work:** Replace or supplement the current JWT-based authentication with SEP-0010 (Stellar Web Authentication), enabling users to authenticate by signing a challenge with their Stellar keypair via Freighter. This provides wallet-native login without passwords, and the JWT issued is tied to the user's Stellar address.
- **Scope:** In scope: SEP-0010 challenge/response flow in NestJS, JWT issuance after successful SEP-0010 verification, backward compatibility with existing auth for non-wallet users, network validation (testnet vs mainnet). Out of scope: SEP-0030 social recovery, multi-sig account authentication.
- **Acceptance Criteria:**
  - SEP-0010 challenge endpoint issues properly formatted challenges per the specification
  - Challenge signatures are verified against the Stellar network before JWT issuance
  - Challenges expire after 15 minutes (configurable)
  - Network mismatch between challenge and signing key is rejected
  - Integration tests cover: valid auth, expired challenge, wrong network, invalid signature
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `security`, `stellar`, `authentication`
- **Relevant Files/Contracts:** `backend/src/auth/`, `Stellar.toml`

---

### [Backend] Implement Portfolio Analytics Aggregation API for Corporate Dashboard
- **Work:** Build an aggregation API that computes portfolio-level carbon metrics for corporate buyers on demand: total tonnes purchased, total tonnes retired, remaining inventory, methodology distribution, vintage year spread, average price paid, and retirement coverage ratio. Use materialized views for performance on large portfolios.
- **Scope:** In scope: aggregation queries, PostgreSQL materialized views, refresh strategy, response caching in Redis. Out of scope: frontend chart rendering, comparison benchmarking against market averages.
- **Acceptance Criteria:**
  - All 7 portfolio metrics are computed correctly against test data
  - Materialized views refresh automatically on credit state changes
  - API response time is under 200ms for portfolios of up to 10,000 credits (benchmarked)
  - Metrics are broken down by time period (configurable: month, quarter, year)
  - Integration tests verify correctness for edge cases: empty portfolio, all credits retired
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `api`, `performance`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Backend] Input Sanitization and Injection Prevention Audit for All API Endpoints
- **Work:** Conduct a systematic audit of all NestJS API endpoints for injection vulnerabilities: SQL injection via raw Prisma queries, NoSQL injection in Redis key construction, XSS via unsanitized project description fields stored and returned to frontend, and header injection in webhook payloads. Remediate all findings.
- **Scope:** In scope: all NestJS controllers and services, Prisma raw query usage, Redis key construction, any field that is stored and later displayed. Out of scope: smart contract input validation (separate), Oracle Python services.
- **Acceptance Criteria:**
  - All raw SQL queries are replaced with parameterized Prisma queries or explicitly reviewed
  - Redis key construction uses allowlisted prefixes, not direct user input
  - All user-supplied string fields are sanitized before storage and escaped on output
  - A security test suite covers at least 5 injection payloads per input type
  - Findings and remediations documented in `audit/injection-audit.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `security`, `audit`
- **Relevant Files/Contracts:** `backend/src/`

---

### [Backend] Implement Soft-Delete and Data Retention Policy for Regulatory Compliance
- **Work:** Implement soft-delete for user accounts and project records (replacing hard deletes) with a configurable retention period before permanent deletion, supporting GDPR right-to-erasure for personal data while preserving on-chain audit trail references. Implement a retention policy job that enforces maximum retention periods.
- **Scope:** In scope: soft-delete for User and Project models, retention period configuration, anonymization of PII in soft-deleted records, retention enforcement job. Out of scope: on-chain data deletion (impossible by design), legal advice on retention periods.
- **Acceptance Criteria:**
  - Soft-deleted records are excluded from all normal API queries automatically
  - PII fields are anonymized in soft-deleted records (name, email replaced with hashed values)
  - Retention job permanently deletes records past the retention period on a nightly schedule
  - Retirement and credit records referencing deleted projects remain intact (referential integrity)
  - Integration tests cover: soft delete, anonymization, retention expiry, foreign key preservation
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `compliance`, `database`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Backend] API Versioning Strategy and Migration Path for Breaking Contract Changes
- **Work:** Design and implement a URL-based API versioning strategy (`/v1/`, `/v2/`) for the NestJS backend, with a defined deprecation policy (minimum 6 months notice), migration guides for breaking changes, and automated deprecation warnings in response headers when clients use deprecated endpoints.
- **Scope:** In scope: versioning middleware, `/v1/` prefix for all current endpoints, deprecation header injection, version lifecycle documentation. Out of scope: client SDK auto-migration, GraphQL versioning.
- **Acceptance Criteria:**
  - All current endpoints are accessible under `/v1/` prefix
  - Deprecated endpoints return `Deprecation` and `Sunset` headers per RFC 8594
  - Version routing is documented in `docs/api-versioning.md` with the deprecation policy
  - A CI check warns when new breaking changes are added to an existing version
  - Integration tests verify version isolation (v1 and v2 of the same endpoint can coexist)
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `api`, `architecture`
- **Relevant Files/Contracts:** `backend/src/`

---

## Frontend & Wallet UX

### [Frontend] Transaction Simulation and Preview UI Before Signing with Freighter
- **Work:** Implement a pre-signing transaction preview flow that simulates the transaction using Soroban's `simulateTransaction` RPC call and displays human-readable effects to the user before they sign with Freighter. This should show: credits that will be transferred, USDC amount leaving the wallet, gas fees, and any contract errors surfaced during simulation.
- **Scope:** In scope: simulation call integration, human-readable effects display component, error surfacing from simulation, "Confirm" / "Cancel" flow. Out of scope: fee sponsorship UX, multi-transaction batching preview.
- **Acceptance Criteria:**
  - All purchase and retirement transactions go through simulation before Freighter prompt
  - Simulation errors are displayed in plain language (not raw Soroban error codes)
  - Effects display shows: USDC debit, credit units received/retired, estimated fee in XLM
  - If simulation fails, the "Sign" button is disabled with a clear explanation
  - Component is reusable across purchase, bulk purchase, and retirement flows
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `frontend`, `wallet`, `ux`, `help-wanted`
- **Relevant Files/Contracts:** `frontend/`, `contracts/carbon_marketplace/src/lib.rs`

---

### [Frontend] Multi-Wallet Support: Xbull, Lobstr, and WalletConnect Integration
- **Work:** Extend the current Freighter-only wallet integration to support Xbull, Lobstr, and a WalletConnect-compatible mobile wallet. Implement a wallet abstraction layer so that all transaction signing, address resolution, and network switching flows through a single interface regardless of which wallet is connected.
- **Scope:** In scope: wallet abstraction interface, Xbull and Lobstr SDK integrations, WalletConnect v2 integration, wallet selection modal, active wallet indicator in header. Out of scope: hardware wallet support (Ledger), custom wallet key management.
- **Acceptance Criteria:**
  - Users can connect any of the four supported wallets from a single selection modal
  - All transaction flows (purchase, retire, list) work identically regardless of connected wallet
  - Wallet switching mid-session prompts re-authentication and clears wallet-specific state
  - Unsupported wallet versions surface a clear upgrade prompt
  - Wallet abstraction interface is documented in `docs/wallet-integration.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `frontend`, `wallet`, `ux`, `help-wanted`
- **Relevant Files/Contracts:** `frontend/`, `hooks/`

---

### [Frontend] Offline-Resilient State Management for Credit Portfolio and Retirement History
- **Work:** Implement offline-resilient state management using a service worker and IndexedDB cache so that users can browse their credit portfolio and retirement history without an active connection, and queue retirement certificate downloads for when connectivity is restored. Stale data should be clearly indicated with a last-synced timestamp.
- **Scope:** In scope: service worker setup, IndexedDB schema for portfolio and retirement history, cache invalidation strategy, offline UI indicators. Out of scope: offline transaction signing (requires live RPC), Progressive Web App manifest changes.
- **Acceptance Criteria:**
  - Portfolio and retirement history are readable offline using cached data
  - Last-synced timestamp is visible and updates on every successful fetch
  - Stale data (older than configurable threshold) renders with a visible warning banner
  - Service worker cache does not serve stale data for financial amounts without a warning
  - Unit tests cover: cache hit, cache miss, cache invalidation, offline detection
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `frontend`, `ux`, `performance`
- **Relevant Files/Contracts:** `frontend/`

---

### [Frontend] Accessibility Audit and Remediation for Financial Data Tables and Forms
- **Work:** Conduct a full WCAG 2.1 AA accessibility audit of the marketplace table, retirement certificate view, and purchase/retirement forms. Remediate all identified issues, with particular attention to screen reader compatibility for financial data tables, keyboard navigation through multi-step transaction flows, and color contrast for status indicators.
- **Scope:** In scope: marketplace listing table, retirement certificate page, purchase form, retirement form, bulk purchase wizard. Out of scope: full site audit (focus on financial-critical flows only), mobile native accessibility.
- **Acceptance Criteria:**
  - Zero WCAG 2.1 AA violations in audited components (verified with axe-core)
  - All data tables have proper `<caption>`, `scope`, and ARIA labels for screen readers
  - Full keyboard navigation works for all transaction flows without a mouse
  - Color contrast ratio ≥ 4.5:1 for all text on interactive elements
  - Accessibility test suite runs in CI using axe-core + Playwright
- **Complexity:** Medium
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `frontend`, `accessibility`, `ux`, `help-wanted`
- **Relevant Files/Contracts:** `frontend/`

---

### [Frontend] Public Audit Explorer: Serial Number Lookup and Full Provenance Trail
- **Work:** Build the public audit explorer page — a no-wallet-required interface where anyone can enter a serial number (or range) and see the complete provenance chain: project registration, verifier approval, oracle monitoring submissions, credit minting, marketplace listings, transfers, and final retirement with certificate.
- **Scope:** In scope: serial number lookup UI, provenance timeline component, retirement certificate deep-link, CSV export of provenance data. Out of scope: wallet connection requirement, bulk serial number batch queries.
- **Acceptance Criteria:**
  - Any serial number can be looked up and returns a complete provenance timeline
  - Timeline renders all lifecycle events in chronological order with on-chain transaction links
  - Retirement certificate is displayed inline with a link to the permanent certificate URL
  - Page is fully functional without a connected wallet
  - Core provenance data is server-side rendered for SEO and accessibility
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `frontend`, `ux`, `transparency`, `help-wanted`
- **Relevant Files/Contracts:** `frontend/`, `backend/src/`

---

### [Frontend] Bulk Purchase Wizard with Portfolio Impact Preview and CSV Import
- **Work:** Build a multi-step bulk purchase wizard for corporate buyers that allows selecting credits from multiple projects, previewing portfolio-level carbon impact metrics (total tonnes, methodology breakdown, vintage year spread), and optionally importing a purchase list from CSV. The final step executes via the `bulk_purchase()` contract function in a single transaction.
- **Scope:** In scope: multi-step wizard component, portfolio impact preview, CSV import with validation, single-transaction bulk execution via `bulk_purchase()`. Out of scope: saved draft purchases, enterprise procurement approval workflows.
- **Acceptance Criteria:**
  - Wizard supports adding credits from at least 5 projects in a single transaction
  - Portfolio preview shows: total tonnes, weighted average vintage year, methodology distribution chart
  - CSV import validates format and surfaces row-level errors before proceeding
  - Transaction simulation is integrated at the final confirmation step
  - E2E test covers the full wizard flow from CSV import to signed transaction
- **Complexity:** High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `frontend`, `ux`, `defi`, `needs-design-review`
- **Relevant Files/Contracts:** `frontend/`, `contracts/carbon_marketplace/src/lib.rs`

---

### [Frontend] Real-Time Transaction Status Tracking with Optimistic UI Updates
- **Work:** Implement real-time transaction status tracking for purchase and retirement flows using Stellar Horizon's event stream. After a transaction is submitted, the UI should optimistically update the user's portfolio and show a live status indicator (submitted → pending → confirmed / failed) without requiring a page refresh.
- **Scope:** In scope: Horizon event stream subscription for transaction status, optimistic state updates in React, rollback on transaction failure, status indicator component. Out of scope: WebSocket server infrastructure (use Horizon's SSE directly), push notifications.
- **Acceptance Criteria:**
  - Portfolio balance updates optimistically within 1 second of transaction submission
  - Transaction status transitions (submitted → pending → confirmed) are displayed in real time
  - Failed transactions trigger a rollback of optimistic state with a clear error message
  - Status indicator is accessible (ARIA live regions for screen readers)
  - Unit tests cover: optimistic update, successful confirmation, failure rollback
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `frontend`, `ux`, `wallet`
- **Relevant Files/Contracts:** `frontend/`, `hooks/`

---

### [Frontend] Retirement Certificate PDF Generator with Verifiable QR Code
- **Work:** Implement a client-side retirement certificate PDF generator (using pdf-lib or jsPDF) that produces a print-ready certificate with a QR code linking to the permanent on-chain verification URL. The QR code should encode the Stellar transaction hash so that scanning it leads to an independent verification path.
- **Scope:** In scope: PDF generation in the browser, QR code embedding with transaction hash, print-optimized layout, certificate download trigger. Out of scope: server-side PDF generation (backend issue), certificate template design (UX team concern).
- **Acceptance Criteria:**
  - Generated PDF includes all required fields: beneficiary, project name, vintage year, tonnes, serial range, tx hash
  - QR code encodes a URL that independently verifies the retirement without a CarbonLedger account
  - PDF is generated client-side with no certificate data sent to a third-party PDF service
  - Generated file is named deterministically using the retirement transaction hash
  - Snapshot tests verify the PDF structure does not regress across updates
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `frontend`, `ux`, `help-wanted`
- **Relevant Files/Contracts:** `frontend/`

---

### [Frontend] Freighter Connection Resilience: Auto-Reconnect and Session Persistence
- **Work:** Harden the Freighter wallet connection lifecycle to handle: browser extension not installed (with installation prompt), extension installed but locked (with unlock prompt), network mismatch (testnet vs mainnet), and session expiry mid-flow. Auto-reconnect when the extension becomes available without requiring full page reload.
- **Scope:** In scope: all Freighter connection failure modes, recovery UX for each, session persistence in sessionStorage, network validation on connect. Out of scope: other wallet providers (separate issue), mobile wallet connections.
- **Acceptance Criteria:**
  - Every connection failure mode has a specific, actionable error message (not a generic "Connection failed")
  - Extension-not-installed shows a browser-specific install link
  - Network mismatch shows the correct network name and a switch-network button
  - Session is restored without prompt if extension is still connected on page reload
  - Unit tests cover all five failure modes with their expected UX outcomes
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `frontend`, `wallet`, `ux`
- **Relevant Files/Contracts:** `frontend/`, `hooks/`

---

### [Frontend] Marketplace Listing Page with Advanced Sorting and Real-Time Price Updates
- **Work:** Build a high-performance marketplace listing page that supports server-side sorting (price, vintage year, methodology, verification date), real-time price feed updates via Horizon SSE or polling, and a sticky comparison tray allowing users to compare up to 4 credit listings side by side before purchasing.
- **Scope:** In scope: server-side sorted listing fetches, price update polling (30-second interval), comparison tray component with key metrics. Out of scope: full-text search (separate issue), user-saved watchlists.
- **Acceptance Criteria:**
  - Sort parameters are reflected in the URL (shareable sorted views)
  - Price displayed is no more than 60 seconds stale (polling interval configurable)
  - Comparison tray allows selecting/deselecting up to 4 listings with a side-by-side view
  - Table renders 100 listings without layout jank (virtualized rows for large datasets)
  - Lighthouse performance score ≥ 85 for the listing page
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `frontend`, `ux`, `performance`
- **Relevant Files/Contracts:** `frontend/`, `backend/src/marketplace/`

---

### [Frontend] Internationalization (i18n) Setup and Initial Translation for 3 Languages
- **Work:** Set up an internationalization framework (next-intl or react-i18next) for the Next.js 14 app and provide complete translations for English (baseline), Spanish, and Mandarin Chinese. Focus on all buyer-facing and retirement-facing UI, as these are the highest-value user flows for international corporate buyers.
- **Scope:** In scope: i18n framework setup, translation files for English/Spanish/Mandarin, locale routing, number/date/currency formatting per locale. Out of scope: RTL language support, translation management platform integration.
- **Acceptance Criteria:**
  - All buyer-facing and retirement-facing strings are externalized into translation files
  - Spanish and Mandarin translations are complete for all buyer flows (professional-quality translations, not machine-only)
  - Number and date formatting respects the selected locale
  - Locale preference is persisted in user settings (authenticated) or localStorage (unauthenticated)
  - CI check verifies no hardcoded English strings remain in buyer-flow components
- **Complexity:** High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `frontend`, `ux`, `i18n`, `help-wanted`
- **Relevant Files/Contracts:** `frontend/`

---

### [Frontend] Dark Mode Implementation with System Preference Detection and Manual Override
- **Work:** Implement a full dark mode theme for the CarbonLedger frontend using CSS custom properties and Next.js 14 app router conventions. Detect system color scheme preference on first visit, support manual override with persistence, and ensure all financial data tables and charts maintain WCAG AA contrast ratios in both modes.
- **Scope:** In scope: dark mode CSS theme, system preference detection, manual toggle with localStorage persistence, WCAG AA contrast verification for both modes. Out of scope: per-component theme customization, high-contrast accessibility mode.
- **Acceptance Criteria:**
  - Dark mode is visually complete across all pages (no unthemed components)
  - System preference detection works on first visit without flash of wrong theme
  - WCAG AA contrast ratios verified in dark mode with axe-core
  - Theme toggle is accessible via keyboard and screen reader
  - Snapshot tests cover both light and dark mode for all key page layouts
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `frontend`, `ux`, `accessibility`
- **Relevant Files/Contracts:** `frontend/`

---

### [Frontend] Error Boundary and Fallback UI for Contract Interaction Failures
- **Work:** Implement React error boundaries around all Soroban contract interaction components with meaningful fallback UIs that distinguish between: RPC network errors, contract execution errors (with human-readable CarbonError translations), wallet signing cancellations, and insufficient balance errors. Each failure type should have a distinct recovery path.
- **Scope:** In scope: error boundary components, `CarbonError` code-to-message translation, per-error-type recovery actions, error reporting to backend (without PII). Out of scope: global unhandled error logging to external services, contract error code changes.
- **Acceptance Criteria:**
  - All 18 `CarbonError` codes have distinct, plain-language user-facing messages
  - Signing cancellation is handled gracefully (no error shown, just returns to previous state)
  - Network errors show a retry button that re-attempts the last operation
  - Insufficient balance error shows the exact shortfall amount and a funding prompt
  - Error boundary tests cover all 5 failure categories with their expected fallback UI
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `frontend`, `ux`, `smart-contract`
- **Relevant Files/Contracts:** `frontend/`, `contracts/`

---

### [Frontend] SEO and Social Sharing Optimization for Retirement Certificate Pages
- **Work:** Implement dynamic Open Graph and Twitter Card meta tags for retirement certificate pages so that sharing a certificate URL on social media renders a rich preview card showing: project name, tonnes retired, vintage year, and beneficiary. Use Next.js 14 server-side metadata generation for crawlability.
- **Scope:** In scope: dynamic OG/Twitter meta tags, server-side metadata generation for certificate pages, structured data (JSON-LD) for certificates, canonical URL configuration. Out of scope: custom social sharing images (use data-driven text cards), social media platform integrations.
- **Acceptance Criteria:**
  - Certificate pages generate correct OG tags verified by Facebook/Twitter card validators
  - JSON-LD structured data is present and valid for certificate pages
  - Meta tags are generated server-side (not client-side) for crawler accessibility
  - Canonical URLs prevent duplicate content for certificate accessed via multiple paths
  - A sharing preview test verifies OG tag content matches certificate data
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `frontend`, `seo`, `ux`
- **Relevant Files/Contracts:** `frontend/`

---

### [Frontend] Verifier Dashboard: Project Queue, Attestation Workflow, and Earnings Tracker
- **Work:** Build the verifier-specific dashboard that shows: the queue of projects pending verification, a structured attestation form with methodology checklist, a history of verified projects with their subsequent credit issuance volumes, and an accumulated attestation fee tracker linked to on-chain payment history.
- **Scope:** In scope: verifier dashboard pages, attestation form with methodology-specific checklists, project history view, fee tracker fetching from backend. Out of scope: on-chain fee distribution mechanism (contract layer), verifier onboarding/accreditation flow.
- **Acceptance Criteria:**
  - Projects in the pending queue are sortable by methodology, submission date, and credit volume
  - Attestation form validates all required fields before enabling on-chain submission
  - Verifier cannot attest to a project they are financially connected to (conflict of interest check)
  - Fee history is paginated and exportable as CSV
  - All verifier flows are protected by role-based route guards
- **Complexity:** High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `frontend`, `ux`, `needs-design-review`
- **Relevant Files/Contracts:** `frontend/`, `backend/src/`, `contracts/carbon_registry/src/lib.rs`

---

### [Frontend] Project Developer Dashboard: Credit Issuance Tracker and Revenue Analytics
- **Work:** Build the project developer dashboard showing: cumulative credits issued vs. total project capacity, pending monitoring submissions and their status, marketplace listings and sale velocity, USDC revenue received (on-chain payment history), and satellite monitoring status with the next expected monitoring date.
- **Scope:** In scope: all dashboard data fetched from backend API, charts for issuance and revenue over time, monitoring status widget linked to oracle data. Out of scope: project registration flow (assumed existing), financial forecasting features.
- **Acceptance Criteria:**
  - Dashboard loads in under 2 seconds (backend aggregation via materialized views)
  - Charts are responsive and render correctly on mobile viewport widths
  - Monitoring status correctly reflects on-chain oracle freshness
  - Revenue breakdown is filterable by time period and marketplace listing
  - Dashboard data updates automatically when new on-chain events are detected
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `frontend`, `ux`, `analytics`
- **Relevant Files/Contracts:** `frontend/`, `backend/src/`

---

### [Frontend] Implement Content Security Policy and Security Headers Hardening
- **Work:** Configure a strict Content Security Policy (CSP) for the Next.js frontend that allows only necessary script sources (self, Freighter extension content scripts, Stellar Horizon), blocks inline scripts (with nonce-based exceptions for Next.js internals), and adds the full set of security response headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- **Scope:** In scope: CSP configuration in Next.js `next.config.js`, all 6 security headers, nonce generation for Next.js script injection, CSP violation reporting endpoint. Out of scope: Subresource Integrity for CDN assets, WAF configuration.
- **Acceptance Criteria:**
  - CSP header is present on all responses with no `unsafe-eval` or `unsafe-inline` except nonce-gated
  - All 6 security headers are present and correctly configured (verified with securityheaders.com)
  - CSP does not break Freighter extension injection or Stellar SDK usage
  - CSP violation reports are collected at `/api/csp-report` and logged
  - CI test verifies security headers are present in the production build output
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `frontend`, `security`, `infrastructure`
- **Relevant Files/Contracts:** `frontend/`

---

## Testing & QA Infrastructure

### [Testing] End-to-End Test Suite for Complete Carbon Credit Lifecycle on Testnet
- **Work:** Implement a fully automated E2E test suite using Playwright that drives the entire carbon credit lifecycle through the actual browser UI against a live Stellar testnet deployment: project registration → verifier approval → oracle monitoring → credit minting → marketplace listing → corporate purchase → retirement → certificate download. Use a test wallet funded via Friendbot.
- **Scope:** In scope: Playwright tests for all lifecycle stages, test wallet management, testnet contract interactions, CI integration. Out of scope: mainnet testing, load testing (separate issue), contract unit tests.
- **Acceptance Criteria:**
  - A single `npm run test:e2e` command runs the full lifecycle test against testnet
  - Test wallet is automatically created and funded at the start of each test run
  - Each lifecycle stage has a discrete test with clear assertions
  - Test run produces a report with screenshots of each stage
  - CI runs the E2E suite on every PR against a preview deployment
- **Complexity:** Very High
- **Estimated Time Frame:** 4+ weeks
- **Suggested Labels:** `testing`, `e2e`, `infrastructure`, `help-wanted`
- **Relevant Files/Contracts:** `frontend/`, `backend/`, `tests/`

---

### [Testing] Adversarial Test Scenarios: Red-Team Suite for Double-Counting and Fraud Vectors
- **Work:** Build a dedicated adversarial test suite that attempts every known carbon credit fraud vector: minting credits for unverified projects, attempting to list already-retired credits, submitting overlapping serial ranges, replaying a purchase transaction, and calling privileged functions from unauthorized accounts.
- **Scope:** In scope: Rust-based adversarial tests for all four contracts, negative test coverage for all `CarbonError` variants, documented attack scenario narratives. Out of scope: social engineering attacks, key compromise scenarios.
- **Acceptance Criteria:**
  - At least one test per `CarbonError` variant that triggers it adversarially
  - Each test is documented with the attack narrative it represents
  - All adversarial tests pass (meaning the contracts correctly reject the attacks)
  - Test suite is organized in a dedicated `tests/adversarial/` directory
  - CI runs adversarial tests as a required check on all contract-touching PRs
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `testing`, `security`, `smart-contract`, `help-wanted`
- **Relevant Files/Contracts:** `tests/`, `contracts/`

---

### [Testing] Load Testing Suite for Marketplace Bulk Purchase Under Concurrent Corporate Buyers
- **Work:** Design and implement a k6 load test suite for the marketplace API that simulates concurrent corporate buyers executing bulk purchases, focusing on: throughput under 100 concurrent buyers, P99 latency for the purchase endpoint, database connection pool exhaustion, and Redis rate limiter behavior under load.
- **Scope:** In scope: k6 scripts for marketplace endpoints, load test scenarios (ramp-up, steady state, spike), performance baseline documentation, bottleneck identification. Out of scope: Soroban RPC load testing, frontend performance testing.
- **Acceptance Criteria:**
  - k6 scripts cover: single purchase, bulk purchase, concurrent purchases, rate limit exhaustion
  - Baseline performance targets are defined and documented (e.g., P99 < 500ms at 100 RPS)
  - Load test identifies at least one bottleneck with a recommended mitigation
  - Results are reproducible from a clean environment with a single command
  - Results stored in `load-tests/results/` with a structured report template
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `performance`, `backend`, `infrastructure`
- **Relevant Files/Contracts:** `load-tests/`, `backend/src/marketplace/`

---

### [Testing] Cross-Contract Integration Test Suite for Oracle → Registry → Credit Issuance Flow
- **Work:** Build a Rust integration test suite that deploys all four contracts to a local Soroban environment and tests the complete oracle-triggered issuance flow: oracle submits monitoring data → registry status updates → credit contract mints new batch. This tests the contracts as a system rather than in isolation.
- **Scope:** In scope: multi-contract test harness, full oracle-to-issuance flow, all intermediate state transitions, cross-contract error propagation. Out of scope: frontend integration, backend integration (Rust contracts only).
- **Acceptance Criteria:**
  - Integration tests deploy and initialize all four contracts in a single test environment
  - Full oracle → registry → credit flow is exercised and all state is verified
  - Error propagation is tested: oracle submits invalid data, registry rejects, credit contract is not called
  - Tests run with `cargo test` in the `tests/` workspace crate
  - Documented setup guide for running integration tests locally in `docs/integration-testing.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `testing`, `smart-contract`, `integration`, `help-wanted`
- **Relevant Files/Contracts:** `tests/`, `contracts/`

---

### [Testing] Mutation Testing for Soroban Contract Unit Tests Using cargo-mutants
- **Work:** Apply mutation testing to the existing 30 Soroban contract unit tests using `cargo-mutants` to measure their fault-detection effectiveness. Introduce mutations (off-by-one, removed checks, flipped comparisons) and identify test gaps where mutations survive. Write new tests to kill all survivors in security-critical paths.
- **Scope:** In scope: mutation test runs for all four contracts, surviving mutation analysis, new tests written to kill survivors. Out of scope: backend or frontend mutation testing, CI integration of full mutation runs (too slow; document as manual process).
- **Acceptance Criteria:**
  - Mutation score is calculated and documented for each contract
  - All surviving mutants in security-critical paths (`retire_credits`, `verify_serial_range`) are killed
  - New tests written to kill survivors are merged alongside the mutation report
  - Overall mutation score improves to at least 80% across all contracts
  - Report in `audit/mutation-testing-report.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `testing`, `smart-contract`, `security`, `audit`
- **Relevant Files/Contracts:** `contracts/`, `audit/`

---

### [Testing] Contract Invariant Test Suite: Conservation Laws for Credit Supply Accounting
- **Work:** Implement a dedicated invariant test suite that verifies conservation laws hold across all contract operations: total credits minted = credits held + credits transferred + credits retired (never more, never less). Run these conservation checks after every state-mutating operation using a shared assertion helper.
- **Scope:** In scope: invariant assertion helpers, conservation law verification for credit supply, per-project and global supply checks, integration with existing test suite. Out of scope: on-chain invariant checking (would require contract changes), frontend supply display validation.
- **Acceptance Criteria:**
  - Conservation law is verified after every `mint_credits`, `transfer_credits`, and `retire_credits` call in tests
  - Zero credits are ever created or destroyed outside of `mint_credits` and `retire_credits`
  - Invariant helper is documented and reusable across all contract test files
  - Any violation of the conservation law causes a test panic with a descriptive message
  - Invariant tests are run in CI as a required check
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `smart-contract`, `security`
- **Relevant Files/Contracts:** `contracts/`, `tests/`

---

### [Testing] Chaos Engineering Test Suite for Oracle Bridge Resilience
- **Work:** Build a chaos engineering test suite for the oracle bridge services using `toxiproxy` or manual fault injection, covering: network partition between oracle and RPC node, database connection loss mid-submission, clock skew between services, and process kill during an active submission. Document the system's behavior under each failure mode.
- **Scope:** In scope: `toxiproxy` or equivalent setup, fault injection scenarios for all three oracle services, recovery time measurement, behavior documentation. Out of scope: chaos testing for Soroban contracts (network layer only), production chaos experiments.
- **Acceptance Criteria:**
  - At least 6 distinct fault injection scenarios are implemented
  - Each scenario documents: expected behavior, actual behavior, recovery time
  - No scenario causes a duplicate on-chain submission (idempotency is validated under chaos)
  - Test suite runs in CI using Docker Compose for service isolation
  - Chaos test report template in `tests/chaos/README.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `testing`, `distributed-systems`, `oracle`, `infrastructure`
- **Relevant Files/Contracts:** `oracle/`, `tests/`

---

### [Testing] Backend API Contract Testing with Pact for Consumer-Driven Contracts
- **Work:** Implement consumer-driven contract testing between the Next.js frontend (consumer) and the NestJS backend (provider) using Pact. This ensures the backend API never silently breaks the frontend's expectations, catching breaking changes before integration tests or E2E tests would.
- **Scope:** In scope: Pact consumer tests in the frontend for all API calls used in financial flows, Pact provider verification in the backend CI pipeline, Pact Broker setup for contract sharing. Out of scope: non-financial API flows (focus on purchase, retire, listings), gRPC or GraphQL contract testing.
- **Acceptance Criteria:**
  - Consumer contracts defined for all purchase, retirement, and listing API calls
  - Provider verification runs in backend CI and blocks merge on contract violations
  - Pact Broker (or Pactflow) is configured and contract history is retained
  - A new breaking API change in the backend fails the provider verification test
  - Setup documented in `docs/contract-testing.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `testing`, `backend`, `frontend`, `infrastructure`
- **Relevant Files/Contracts:** `backend/src/`, `frontend/`

---

### [Testing] Visual Regression Testing Suite for Critical UI Components
- **Work:** Set up a visual regression testing suite using Playwright or Storybook + Chromatic that captures baseline screenshots of all financial UI components (marketplace table, purchase confirmation, retirement certificate, portfolio dashboard) and fails CI when pixel-level changes are detected outside approved diffs.
- **Scope:** In scope: baseline screenshot capture for 10+ key components, CI integration, diff review workflow, component isolation via Storybook. Out of scope: cross-browser visual testing beyond Chromium (nice to have), animation testing.
- **Acceptance Criteria:**
  - Baseline screenshots are committed and versioned in the repository
  - CI fails with a diff report when unapproved visual changes are introduced
  - Approval workflow allows maintainers to accept intentional visual changes
  - At least 10 components are covered including all financial-critical views
  - Setup documented in `docs/visual-regression.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `frontend`, `ci`
- **Relevant Files/Contracts:** `frontend/`

---

### [Testing] Security Regression Test Suite for All Patched Vulnerabilities
- **Work:** Establish a security regression test suite that contains one or more tests for every vulnerability found and patched in the project (from the reentrancy audit, replay analysis, overflow audit, etc.). These tests must run in CI and prevent the same vulnerability from being reintroduced by future changes.
- **Scope:** In scope: one regression test per patched vulnerability, organized by vulnerability category, CI integration as a required gate. Out of scope: new vulnerability discovery (those go in adversarial suite), penetration testing.
- **Acceptance Criteria:**
  - At least 15 regression tests exist at initial submission (one per audited finding)
  - Each test includes a comment linking to the original issue or audit report
  - Tests are organized in `tests/security-regressions/` with a README explaining each
  - CI enforces these tests as a non-bypassable required check
  - Adding a new patch to a security finding requires a corresponding regression test (enforced by PR template)
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `security`, `smart-contract`, `backend`
- **Relevant Files/Contracts:** `tests/`, `contracts/`, `backend/src/`

---

### [Testing] Synthetic Monitoring Suite for Production Healthchecks
- **Work:** Implement a synthetic monitoring suite that continuously runs lightweight "canary" transactions against the production (and staging) deployment: a read-only credit lookup, a marketplace listing fetch, and a simulated transaction dry-run (using `simulateTransaction` without broadcasting). Alert if any canary fails for 2 consecutive checks.
- **Scope:** In scope: canary transaction scripts, scheduled execution (every 5 minutes), alerting on consecutive failures, latency tracking over time. Out of scope: real on-chain transactions in production monitoring, load-generating synthetics.
- **Acceptance Criteria:**
  - Three canary checks run every 5 minutes against production endpoints
  - Alert fires after 2 consecutive failures per check (not on first transient failure)
  - Canary latency history is graphed in the Grafana dashboard
  - Canary scripts are isolated from production data (read-only or simulate-only)
  - Runbook for canary failure in `docs/runbooks/synthetic-monitoring.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `devops`, `observability`
- **Relevant Files/Contracts:** `scripts/`, `logging/`

---

### [Testing] Test Data Factory and Seeding Framework for Development and CI
- **Work:** Build a comprehensive test data factory for the backend that can seed a local PostgreSQL database with realistic carbon credit data: 10 projects across 5 methodologies, 3 verifiers, 100 credit batches with serial ranges, 50 marketplace listings, and 20 retirement certificates. This enables consistent, repeatable local development and CI test runs.
- **Scope:** In scope: Prisma seed script, factory functions for all entity types, realistic but synthetic data (no real project coordinates or personal data), deterministic seed for reproducibility. Out of scope: on-chain testnet seeding (too slow for CI), production data anonymization.
- **Acceptance Criteria:**
  - `npx prisma db seed` populates the full dataset in under 30 seconds
  - Seed data covers all entity relationship permutations (e.g., retired credits, pending listings)
  - Seed is deterministic (same data on every run with the same seed value)
  - Factory functions are exported for use in individual test files
  - README in `backend/prisma/` documents the seed dataset and how to customize it
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `backend`, `developer-experience`, `good-first-issue`
- **Relevant Files/Contracts:** `backend/prisma/`, `backend/src/`

---

### [Testing] Soroban Contract Event Emission Verification Tests
- **Work:** Write a comprehensive test suite that verifies every state-mutating contract function emits the correct Soroban events with the correct topics and data. Events are the primary mechanism by which the backend and oracle track on-chain state changes — silent or malformed events would break all off-chain integrations.
- **Scope:** In scope: event emission tests for all state-mutating functions across all four contracts, topic and data schema verification, backward-compatibility checks for event schema. Out of scope: Horizon event streaming integration (backend concern), frontend event consumption.
- **Acceptance Criteria:**
  - Every state-mutating function has at least one test asserting the emitted event's topic and data
  - Event schema is documented in `docs/contract-events.md` for each function
  - A test verifies that no extra or missing events are emitted in the happy path
  - Event tests run as part of the standard `cargo test` suite
  - Schema documentation is kept in sync via a CI check that compares docs to test assertions
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `smart-contract`, `integration`
- **Relevant Files/Contracts:** `contracts/`, `docs/`

---

### [Testing] Fuzz Testing for Oracle Python Services Using Atheris or Hypothesis
- **Work:** Implement fuzz testing for the Python oracle services (verification_listener, price_oracle, satellite_monitor) using Atheris (libFuzzer-based) or Hypothesis, targeting the data parsing and validation layers that process untrusted external inputs before they reach the blockchain submission layer.
- **Scope:** In scope: fuzz targets for JSON parsing in all three oracle services, Hypothesis strategies for monitoring data payloads, CI integration with short fuzz budgets. Out of scope: fuzzing the Soroban contracts (separate Rust fuzz issue), fuzzing the backend API.
- **Acceptance Criteria:**
  - Fuzz targets exist for the data parsing entry point of each oracle service
  - Hypothesis tests cover at least 3 property invariants per service
  - Any crash or unhandled exception found during fuzzing is fixed before merging
  - Fuzz corpus is committed to `tests/fuzz/oracle/` for reproducibility
  - CI runs Hypothesis tests on every PR (Atheris runs are optional/manual due to time cost)
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `oracle`, `security`
- **Relevant Files/Contracts:** `oracle/`, `tests/`

---

### [Testing] Performance Regression Testing with Automated Benchmarks for Contract Functions
- **Work:** Set up automated performance benchmarks for the most resource-intensive Soroban contract functions using `criterion` (adapted for Soroban test environment) or custom benchmark scripts. Track benchmark results over time in CI and fail the build if any function regresses by more than 10% in resource consumption.
- **Scope:** In scope: benchmarks for `mint_credits`, `bulk_purchase`, `retire_credits`, `verify_serial_range`, benchmark result storage and trending in CI. Out of scope: benchmarking non-contract code, production performance monitoring (separate issue).
- **Acceptance Criteria:**
  - Benchmarks exist for at least 4 contract functions covering Soroban instruction count and ledger entry reads/writes
  - CI stores benchmark results as artifacts and compares against the baseline on main
  - A >10% regression in any benchmarked function blocks PR merge with a clear report
  - Benchmark setup is documented in `docs/benchmarking.md`
  - Historical benchmark data is plotted in a dashboard or committed as a trend file
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `testing`, `smart-contract`, `performance`, `ci`
- **Relevant Files/Contracts:** `contracts/`, `.github/workflows/`

---

### [Testing] API Integration Test Suite with Supertest for All Backend Endpoints
- **Work:** Write a comprehensive integration test suite using Supertest and a real (test) PostgreSQL database that covers every backend API endpoint with both happy-path and error-path scenarios. These tests should run against the actual NestJS application without mocking database calls, catching real integration bugs.
- **Scope:** In scope: Supertest integration tests for all controllers, test database setup/teardown per suite, seeded test data using the factory (from data factory issue), authentication flows. Out of scope: Soroban contract interactions (mocked at service layer), load testing.
- **Acceptance Criteria:**
  - Every controller endpoint has at least one happy-path and one error-path integration test
  - Tests run against a real PostgreSQL test database (not in-memory)
  - Test database is reset between test suites for isolation
  - Authentication is tested end-to-end including JWT validation
  - Code coverage for controller and service layers is reported and exceeds 80%
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `testing`, `backend`, `integration`, `help-wanted`
- **Relevant Files/Contracts:** `backend/src/`

---

### [Testing] Cross-Browser and Wallet Extension Compatibility Test Matrix
- **Work:** Build and document a cross-browser and wallet extension compatibility test matrix for the CarbonLedger frontend, covering Chrome, Firefox, and Brave with Freighter and Xbull extensions. Automate the Playwright tests to run against all browser/wallet combinations in CI using browser-specific Playwright configurations.
- **Scope:** In scope: Playwright multi-browser configuration, wallet extension injection in test environment, compatibility matrix documentation, CI parallelization across browsers. Out of scope: Safari (no extension support), mobile browsers, Ledger hardware wallet.
- **Acceptance Criteria:**
  - Critical flows (connect wallet, purchase, retire) are tested on Chrome, Firefox, and Brave
  - Any browser-specific failure is reported with the browser/extension version that fails
  - CI runs tests in parallel across all 3 browsers using Playwright's browser matrix
  - Compatibility matrix is documented in `docs/browser-compatibility.md`
  - Known incompatibilities are listed with workarounds or tracked as separate issues
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `testing`, `frontend`, `compatibility`, `ci`
- **Relevant Files/Contracts:** `frontend/`, `.github/workflows/`

---

## DevOps & Infrastructure

### [DevOps] Mainnet Deployment Pipeline with Blue-Green Cutover and Automated Rollback
- **Work:** Design and implement a GitHub Actions deployment pipeline for mainnet that uses a blue-green strategy: the new contract version is deployed alongside the old one, health checks are run, and traffic is cut over only when checks pass. If post-cutover health checks fail, the pipeline automatically reverts the frontend contract ID configuration to the previous contract.
- **Scope:** In scope: GitHub Actions workflow for mainnet deploy, health check suite post-deploy, automated rollback trigger, deployment state stored in SSM Parameter Store or equivalent. Out of scope: contract state migration (separate issue), DNS cutover.
- **Acceptance Criteria:**
  - Pipeline deploys new contracts, runs health checks, then updates frontend config atomically
  - Rollback is triggered automatically if health checks fail within 5 minutes of cutover
  - Deployment history is logged with: deployer, timestamp, contract IDs before and after
  - Manual approval gate is required before cutover to mainnet (no auto-deploy on merge)
  - Runbook in `docs/runbooks/mainnet-deployment.md`
- **Complexity:** Very High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `devops`, `infrastructure`, `mainnet`, `needs-design-review`
- **Relevant Files/Contracts:** `.github/workflows/`, `scripts/`

---

### [DevOps] On-Chain Anomaly Detection and Alerting for Contract Event Streams
- **Work:** Build a monitoring service that subscribes to Stellar Horizon event streams for all four CarbonLedger contracts and triggers alerts on anomalous patterns: unusually large single-batch mints, retirement of credits purchased in the same ledger, oracle price updates outside expected ranges, or contract function calls from unexpected addresses.
- **Scope:** In scope: Horizon event stream subscription, rule-based anomaly detection, PagerDuty/Slack webhook alerting, alert rule configuration file. Out of scope: ML-based anomaly detection, frontend alerting dashboard.
- **Acceptance Criteria:**
  - Service subscribes to all four contract event streams and processes events in real time
  - At least 5 anomaly rules are implemented and configurable without code changes
  - Alerts include: contract address, function called, transaction hash, anomaly description
  - Alert deduplication prevents duplicate pages for the same anomaly within a configurable window
  - Runbook for each alert type in `docs/runbooks/anomaly-alerts.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `devops`, `infrastructure`, `security`, `observability`
- **Relevant Files/Contracts:** `oracle/`, `.github/workflows/`, `logging/`

---

### [DevOps] CI Gate Design for Contract Changes: Mandatory Audit Checklist Before Merge
- **Work:** Implement a CI gate that runs on every pull request touching contract code (`contracts/`) and enforces a mandatory audit checklist: all new public functions have unit tests, no new `unwrap()` calls without justification comments, no arithmetic without checked operations, and the pre-audit checklist in `audit/` is updated.
- **Scope:** In scope: GitHub Actions workflow checks, custom Clippy lints, checklist update verification, PR template additions for contract changes. Out of scope: formal verification gates (too slow for CI), full audit automation.
- **Acceptance Criteria:**
  - CI blocks merge on any contract PR that introduces `unwrap()` without a `// SAFETY:` comment
  - CI blocks merge if new public functions have no corresponding test function
  - Unchecked arithmetic on integer types triggers a warning in CI
  - Audit checklist file must be touched on every contract-modifying PR (enforced via required file check)
  - CI check results are summarized in a PR comment with specific line-level findings
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `ci`, `smart-contract`, `security`
- **Relevant Files/Contracts:** `.github/workflows/`, `audit/`, `contracts/`

---

### [DevOps] Terraform Infrastructure-as-Code for Full Production Stack
- **Work:** Complete the Terraform configuration in `infra/` to provision the full production stack: PostgreSQL (RDS), Redis (ElastiCache), NestJS backend (ECS or equivalent), oracle services, Loki/Grafana observability, and all associated networking, security groups, and IAM roles. All secrets should be managed via AWS Secrets Manager.
- **Scope:** In scope: all production services, networking, IAM, secrets management, Terraform state backend (S3 + DynamoDB locking). Out of scope: CI/CD pipeline configuration (separate issue), DNS and TLS termination details.
- **Acceptance Criteria:**
  - `terraform apply` provisions a fully functional production environment from scratch
  - All secrets are sourced from Secrets Manager — no secrets in Terraform state or variables
  - Least-privilege IAM roles are defined for each service
  - A staging workspace mirrors production with reduced resource sizing
  - Terraform plan output is posted as a PR comment in CI before apply
- **Complexity:** Very High
- **Estimated Time Frame:** 4+ weeks
- **Suggested Labels:** `devops`, `infrastructure`, `terraform`, `needs-design-review`
- **Relevant Files/Contracts:** `infra/`

---

### [DevOps] Grafana Dashboard Suite for Carbon Credit Market Observability
- **Work:** Build a comprehensive Grafana dashboard suite connected to Loki and the PostgreSQL metrics exporter covering: credit issuance rate, marketplace transaction throughput, oracle submission latency, retirement volume over time, and on-chain/off-chain state divergence count. Dashboards should be exported as code (JSON/Jsonnet) and stored in `logging/`.
- **Scope:** In scope: 5 Grafana dashboards, all metrics derivable from existing logs and PostgreSQL, dashboard-as-code in `logging/`, alert rules for key thresholds. Out of scope: custom Prometheus metrics exporter, business intelligence dashboards.
- **Acceptance Criteria:**
  - Five dashboards are importable from `logging/dashboards/` with a single provisioning step
  - Each dashboard has at least 4 panels with appropriate visualization types
  - Alert rules are defined for: oracle staleness, error rate spike, zero-issuance streak >24h
  - Dashboards display meaningful data when populated with test data from the dev stack
  - Setup instructions in `logging/README.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `observability`, `infrastructure`
- **Relevant Files/Contracts:** `logging/`, `backend/src/`

---

### [DevOps] IPFS Pinning Reliability: Multi-Provider Redundancy for Retirement Certificates
- **Work:** Implement multi-provider IPFS pinning for all retirement certificates using at least two pinning services (Pinata + Web3.Storage or equivalent). If one provider fails, the certificate should be retrievable from the other, and the backend should verify pin health periodically and re-pin to failed providers automatically.
- **Scope:** In scope: dual-provider pinning logic, pin health monitoring, automatic re-pinning, CID stored per provider in PostgreSQL. Out of scope: running a self-hosted IPFS node, changes to certificate content format.
- **Acceptance Criteria:**
  - Every certificate is pinned to at least 2 providers before the job is marked complete
  - Pin health check runs hourly and re-pins to any provider where the CID is no longer pinned
  - Certificate retrieval endpoint tries providers in order and returns on first success
  - Integration tests simulate one provider failing and verify retrieval from the other
  - Provider configuration is injectable via environment variables
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `infrastructure`, `backend`
- **Relevant Files/Contracts:** `backend/src/retirements/`, `backend/src/`

---

### [DevOps] Docker Compose Production-Parity Local Development Environment
- **Work:** Audit and fix the existing `docker-compose.yml` to achieve production-parity: same PostgreSQL version as RDS target, same Redis version and configuration as ElastiCache, health check definitions matching production probe configuration, and environment variable names matching Terraform-provisioned secret names exactly.
- **Scope:** In scope: `docker-compose.yml` audit and update, service version pinning, health check alignment, environment variable naming standardization, developer onboarding documentation update. Out of scope: Kubernetes/ECS local simulation, production secret values in docker-compose.
- **Acceptance Criteria:**
  - PostgreSQL and Redis service versions in docker-compose match production target versions exactly
  - Health check configurations mirror production probe settings (interval, timeout, retries)
  - All environment variable names in docker-compose match the names used in Terraform/Secrets Manager
  - `docker-compose up` from a clean checkout reaches healthy state in under 3 minutes
  - `docs/DOCKER_COMPOSE_GUIDE.md` is updated to reflect all changes
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `developer-experience`, `infrastructure`
- **Relevant Files/Contracts:** `docker-compose.yml`, `infra/`, `docs/DOCKER_COMPOSE_GUIDE.md`

---

### [DevOps] Automated Dependency Vulnerability Scanning and Update Policy
- **Work:** Set up automated dependency vulnerability scanning using Dependabot (or Renovate) for npm, Cargo, and pip dependencies, combined with a defined update policy: security patches merged within 48 hours, minor updates weekly, major updates monthly with a compatibility review. Include a policy document and SLA.
- **Scope:** In scope: Dependabot/Renovate configuration for all three package managers, auto-merge policy for patch-level security fixes, PR labeling and review assignment for non-security updates. Out of scope: manual vendor assessments, license compliance scanning (separate concern).
- **Acceptance Criteria:**
  - Dependabot/Renovate is configured for npm (`frontend/`, `backend/`), Cargo (`contracts/`, `tests/`), and pip (`oracle/`)
  - Security vulnerability PRs are automatically labeled `security` and assigned to maintainers
  - Patch-level security updates auto-merge if CI passes
  - Dependency update policy document exists in `docs/dependency-policy.md`
  - CI blocks merge if any dependency has a known Critical or High CVE (using `npm audit`, `cargo audit`, `pip-audit`)
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `security`, `ci`, `good-first-issue`
- **Relevant Files/Contracts:** `.github/`, `frontend/package.json`, `backend/package.json`, `contracts/Cargo.toml`, `oracle/requirements.txt`

---

### [DevOps] Database Backup, Point-in-Time Recovery, and Restore Testing Pipeline
- **Work:** Implement and verify a database backup strategy for PostgreSQL with: automated daily full backups, continuous WAL archiving for point-in-time recovery (PITR), automated restore testing every 7 days against a staging environment, and alerting when any backup or restore test fails.
- **Scope:** In scope: backup configuration (pg_dump or WAL-G), PITR configuration, automated restore test pipeline, alerting. Out of scope: cross-region backup replication (noted as enhancement), database sharding backup.
- **Acceptance Criteria:**
  - Daily full backups complete and are verified (restore test, not just file existence)
  - WAL archiving enables PITR to any point within the last 7 days
  - Weekly automated restore test runs against staging and posts a pass/fail status
  - Alert fires within 1 hour of any backup or restore test failure
  - Recovery time objective (RTO) and recovery point objective (RPO) are documented and tested
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `devops`, `infrastructure`, `database`, `disaster-recovery`
- **Relevant Files/Contracts:** `infra/`, `scripts/`

---

### [DevOps] Secret Rotation Automation for Oracle Keys and Backend JWT Secrets
- **Work:** Implement automated secret rotation for the oracle signing keys and backend JWT secrets using AWS Secrets Manager rotation lambdas (or equivalent). Rotation should be zero-downtime — old and new secrets are both valid during a configurable overlap window, and all services pick up new secrets without restart.
- **Scope:** In scope: rotation lambda/script for oracle keys and JWT secrets, dual-secret validation during overlap window, rotation scheduling and audit logging. Out of scope: Stellar account key rotation (manual process, documented separately), database password rotation (separate concern).
- **Acceptance Criteria:**
  - Secret rotation completes without any service restart or request failures
  - Both old and new secrets are valid during the overlap window (configurable, default: 24h)
  - Rotation events are audit-logged with timestamp and rotated secret identifier (not value)
  - A manual rotation can be triggered and verified end-to-end in staging
  - Rotation runbook in `docs/runbooks/secret-rotation.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `devops`, `security`, `infrastructure`, `needs-design-review`
- **Relevant Files/Contracts:** `infra/`, `oracle/`, `backend/src/`

---

### [DevOps] Implement OpenTelemetry Tracing Across Backend, Oracle, and Frontend
- **Work:** Instrument the NestJS backend, Python oracle services, and Next.js frontend with OpenTelemetry SDK, exporting traces to a self-hosted Jaeger or Tempo instance. This enables end-to-end distributed tracing for purchase and retirement flows across all service boundaries.
- **Scope:** In scope: OTel SDK integration for all three service layers, span creation for all financial operations, trace context propagation via HTTP headers, Jaeger/Tempo deployment in docker-compose. Out of scope: smart contract tracing (not possible), replacing existing Loki logging (OTel is additive).
- **Acceptance Criteria:**
  - A single purchase transaction produces a complete trace spanning frontend → backend → oracle
  - All financial operation spans include: user_id, operation type, contract function, tx_hash
  - Trace sampling rate is configurable without redeployment
  - Jaeger/Tempo UI is accessible in the local docker-compose stack
  - OTel instrumentation documented in `docs/observability.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `devops`, `observability`, `infrastructure`
- **Relevant Files/Contracts:** `backend/src/`, `oracle/`, `frontend/`, `logging/`

---

### [DevOps] GitHub Actions Workflow Consolidation and CI Pipeline Optimization
- **Work:** Audit the existing `.github/workflows/` directory, eliminate redundant jobs, implement job-level caching for Rust build artifacts, npm node_modules, and pip packages, and reduce the end-to-end CI time on a typical PR from whatever the current baseline is to under 10 minutes.
- **Scope:** In scope: workflow audit and consolidation, Cargo/npm/pip caching, parallelization of independent test suites, CI time measurement before and after. Out of scope: self-hosted runners, paid GitHub Actions features.
- **Acceptance Criteria:**
  - Total CI time on a typical non-contract PR is under 10 minutes (measured on 3 consecutive runs)
  - Rust build cache achieves a hit rate of >80% on non-Cargo.lock-changing PRs
  - No duplicate job definitions exist across workflows
  - CI time benchmark is documented in `.github/README.md`
  - Cache invalidation strategy is documented so contributors understand when full rebuilds occur
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `ci`, `developer-experience`
- **Relevant Files/Contracts:** `.github/workflows/`

---

### [DevOps] Container Image Hardening: Non-Root Users, Read-Only Filesystems, and SBOM Generation
- **Work:** Harden all Docker container images (backend, frontend, oracle services) by: running processes as non-root users, mounting filesystems as read-only where possible, generating Software Bill of Materials (SBOM) for each image, and scanning images for known CVEs in CI using Trivy or Grype.
- **Scope:** In scope: Dockerfile updates for all services, non-root user setup, read-only filesystem configuration with explicit writable mounts, SBOM generation, Trivy/Grype CI scan. Out of scope: distroless base images (optional enhancement), runtime security monitoring.
- **Acceptance Criteria:**
  - All container processes run as non-root users (verified by `docker inspect`)
  - Filesystems are mounted read-only with explicit tmpfs mounts for writable directories
  - SBOM is generated and attached as a CI artifact for every image build
  - CI fails on any Critical CVE in container images (configurable severity threshold)
  - Hardening changes are documented in `docs/container-security.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `security`, `infrastructure`
- **Relevant Files/Contracts:** `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `oracle/Dockerfile`

---

### [DevOps] Log Retention Policy and PII Scrubbing for Production Logs
- **Work:** Implement a log retention policy for production Loki logs (default: 90 days for financial operation logs, 30 days for debug logs), automated PII scrubbing via Promtail pipeline stages that redact email addresses, Stellar public keys, and IP addresses before logs are indexed, and a verified purge test.
- **Scope:** In scope: Loki retention configuration, Promtail pipeline stage PII scrubbing rules, retention policy document, purge verification test. Out of scope: GDPR right-to-erasure for individual log records (document as limitation), log archival to cold storage.
- **Acceptance Criteria:**
  - Log retention periods are configured per log stream label with documented rationale
  - Promtail scrubbing correctly redacts email addresses, Stellar addresses, and IP addresses before indexing
  - Scrubbing is verified: inject a log with test PII, confirm it does not appear in Loki query results
  - Retention policy is documented in `docs/log-retention-policy.md`
  - CI test verifies scrubbing rules against a set of known PII patterns
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `compliance`, `observability`, `privacy`
- **Relevant Files/Contracts:** `logging/`, `docker-compose.yml`

---

### [DevOps] Stellar Network Failure Failover: Multi-RPC Endpoint Configuration
- **Work:** Implement multi-RPC endpoint configuration for all Stellar network interactions (backend SDK calls, oracle submissions, frontend Horizon calls) so that if the primary Stellar Horizon RPC endpoint is unavailable, requests automatically fail over to a secondary endpoint. Include health checking and automatic primary recovery.
- **Scope:** In scope: multi-endpoint configuration for NestJS backend, Python oracle, and Next.js frontend, failover logic with health checks, configurable endpoint priority. Out of scope: running a self-hosted Stellar node, load balancing across RPC endpoints.
- **Acceptance Criteria:**
  - All three service layers support configuring at least 2 RPC endpoints
  - Failover to secondary occurs within 5 seconds of primary failure detection
  - Automatic recovery to primary occurs when primary becomes healthy again
  - Integration test simulates primary failure and verifies successful failover
  - RPC endpoint configuration documented in `docs/configuration.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `infrastructure`, `distributed-systems`
- **Relevant Files/Contracts:** `backend/src/`, `oracle/`, `frontend/`

---

## Documentation & Protocol Design

### [Docs] Formal Protocol Specification Document (v1.0)
- **Work:** Write a formal protocol specification document for CarbonLedger that defines — with mathematical precision where appropriate — the state machine for a carbon credit's lifecycle, the invariants the system must maintain at all times, the trust assumptions for each actor role, and the security properties the contracts are designed to achieve. This document should be suitable for use by a security auditor.
- **Scope:** In scope: state machine definition, invariant catalog, actor trust model, security property claims, known limitations. Out of scope: marketing copy, implementation tutorials, API reference.
- **Acceptance Criteria:**
  - State machine covers all 6 lifecycle stages with formal transition conditions
  - At least 10 system invariants are stated precisely (e.g., "for all credits c, retired(c) ∧ transferred(c) = ⊥")
  - Trust assumptions for verifier, oracle, and admin roles are explicitly bounded
  - Security properties are stated as attackability claims (e.g., "no adversary without verifier key can mint credits")
  - Document reviewed by at least one contributor with protocol security background
- **Complexity:** Very High
- **Estimated Time Frame:** 4+ weeks
- **Suggested Labels:** `documentation`, `protocol-design`, `security`, `needs-design-review`
- **Relevant Files/Contracts:** `docs/`, `audit/`

---

### [Docs] Gold Standard and Verra VCS Methodology Mapping Documentation
- **Work:** Produce a detailed mapping document that aligns the CarbonLedger on-chain data model (project fields, methodology score, monitoring data schema) with the actual field requirements of Gold Standard and Verra VCS methodologies. Identify gaps where the current contract schema cannot represent required methodology data, and propose schema extensions.
- **Scope:** In scope: field-by-field mapping for at least 3 Gold Standard and 3 Verra VCS methodologies, gap analysis, proposed Soroban storage extensions. Out of scope: legal compliance review, actual methodology certification.
- **Acceptance Criteria:**
  - Mapping tables exist for at least 6 methodologies (3 GS + 3 VCS)
  - Every mandatory methodology field is either mapped to an existing contract field or flagged as a gap
  - Gap analysis proposes concrete contract changes with backwards-compatibility notes
  - Document is reviewed by someone with carbon market domain expertise
  - Placed in `docs/methodology-mapping.md` with a summary in the main README
- **Complexity:** High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `documentation`, `protocol-design`, `domain-expertise`, `needs-design-review`
- **Relevant Files/Contracts:** `docs/`, `contracts/carbon_registry/src/lib.rs`

---

### [Docs] Architecture Decision Records for All Major Technical Choices
- **Work:** Write Architecture Decision Records (ADRs) for the major technical decisions already made in the project: choice of Soroban over other smart contract platforms, serial number scheme design, off-chain oracle architecture, PostgreSQL over event store databases, USDC as settlement currency, and the certificate signature scheme. Each ADR must document the decision, alternatives considered, and consequences.
- **Scope:** In scope: at least 8 ADRs covering all major architectural choices, using the standard ADR template in `docs/adr/`. Out of scope: ADRs for future decisions (those should be created at decision time), retrospective changes to architecture.
- **Acceptance Criteria:**
  - At least 8 ADRs are written and placed in `docs/adr/` following the existing template
  - Each ADR has: status, context, decision, alternatives considered, consequences
  - ADR index in `docs/adr/README.md` is updated with all new records
  - No ADR is purely descriptive — each must document at least 2 alternatives considered
  - ADRs are linked from relevant sections of the main README
- **Complexity:** Medium
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `documentation`, `architecture`, `good-first-issue`
- **Relevant Files/Contracts:** `docs/adr/`

---

### [Docs] Threat Model Documentation: STRIDE Analysis for CarbonLedger
- **Work:** Produce a comprehensive threat model for CarbonLedger using the STRIDE methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege), covering all system components: contracts, oracle bridge, backend API, frontend, and the off-chain certificate store.
- **Scope:** In scope: STRIDE analysis for all 5 system components, threat catalog with severity ratings, mitigation inventory, data flow diagram used as the threat modeling surface. Out of scope: penetration testing, automated threat modeling tooling.
- **Acceptance Criteria:**
  - Data flow diagram covers all components and trust boundaries
  - At least 30 threats are identified and documented
  - Every High and Critical threat has a documented mitigation
  - Accepted risks are explicitly stated with rationale
  - Document reviewed and signed off by at least one security-focused contributor
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `documentation`, `security`, `audit`, `needs-design-review`
- **Relevant Files/Contracts:** `docs/`, `audit/`, `SECURITY.md`

---

### [Docs] Operator Runbook Collection: All Critical On-Call Scenarios
- **Work:** Write a comprehensive runbook collection covering all critical operational scenarios an on-call engineer would face: oracle liveness failure, on-chain/off-chain state divergence detected, marketplace contract paused, database failover, Redis cache invalidation, and suspicious large-batch retirement. Each runbook should be executable by an engineer unfamiliar with the codebase.
- **Scope:** In scope: at least 8 runbooks in `docs/runbooks/`, decision trees for triage, step-by-step resolution procedures, escalation paths. Out of scope: automated remediation scripts (referenced but not required), incident postmortem templates.
- **Acceptance Criteria:**
  - At least 8 runbooks covering all critical alert types
  - Each runbook has: trigger condition, immediate triage steps, resolution procedure, escalation criteria
  - Runbooks reference specific commands with expected output examples
  - Each runbook is validated by a contributor who did not write it (peer review)
  - `docs/runbooks/README.md` indexes all runbooks with estimated resolution times
- **Complexity:** Medium
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `documentation`, `devops`, `operations`
- **Relevant Files/Contracts:** `docs/runbooks/`

---

### [Docs] API Reference Documentation with OpenAPI 3.1 Specification and Interactive Explorer
- **Work:** Generate a complete OpenAPI 3.1 specification for the NestJS backend API, covering all endpoints with request/response schemas, authentication requirements, error codes, and example payloads. Host an interactive Swagger UI explorer alongside the backend and publish the spec to `docs/api/`.
- **Scope:** In scope: full OpenAPI 3.1 spec for all backend endpoints, NestJS decorator-driven spec generation, Swagger UI deployment, example payloads for every endpoint. Out of scope: SDK generation, GraphQL schema documentation.
- **Acceptance Criteria:**
  - Every endpoint is documented with request schema, response schema, and at least one example
  - All error response codes are documented with machine-readable error codes (not just HTTP status)
  - Swagger UI is accessible at `/api/docs` in development and staging (disabled in production by default)
  - OpenAPI spec is exported to `docs/api/openapi.yaml` and committed to the repository
  - CI check verifies the spec is up to date with the implementation (no drift)
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `documentation`, `backend`, `api`, `good-first-issue`
- **Relevant Files/Contracts:** `backend/src/`, `docs/api/`

---

### [Docs] Smart Contract NatSpec-Style Documentation for All Public Functions
- **Work:** Write comprehensive inline documentation for every public function across all four Soroban contracts using Rust doc comments (`///`). Documentation must cover: purpose, parameters with types and constraints, return values, error conditions, and side effects (storage written, events emitted). Generate and publish HTML docs via `cargo doc`.
- **Scope:** In scope: all public functions in all four contracts, error condition documentation, event documentation, `cargo doc` HTML generation in CI. Out of scope: private function documentation (nice to have), external-facing documentation website.
- **Acceptance Criteria:**
  - Every public function has a doc comment with: description, `# Parameters`, `# Returns`, `# Errors`, `# Events`
  - `cargo doc --no-deps` generates valid HTML without warnings
  - Generated docs are published as a CI artifact on every merge to main
  - Doc comments are reviewed for accuracy against the implementation (not just copy of function signature)
  - CI check fails if any public function is missing a doc comment
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `documentation`, `smart-contract`, `good-first-issue`
- **Relevant Files/Contracts:** `contracts/`

---

### [Docs] Contributor Guide: Domain Knowledge Primer for Carbon Markets and Soroban
- **Work:** Write a domain knowledge primer for new contributors who have software engineering skills but lack carbon market or Soroban-specific background. Cover: how voluntary carbon markets work, what makes a credit legitimate, Soroban's execution model differences from EVM, and CarbonLedger-specific conventions (error handling patterns, storage patterns, naming conventions).
- **Scope:** In scope: carbon market primer (1,500–2,000 words), Soroban primer (1,000–1,500 words), CarbonLedger conventions guide, links to further reading. Out of scope: full Soroban SDK tutorial (link to official docs), legal/regulatory deep-dives.
- **Acceptance Criteria:**
  - Carbon market section explains: credit lifecycle, methodology scoring, registry vs. exchange distinction
  - Soroban section covers: auth model, storage types, cross-contract calls, fee model
  - CarbonLedger conventions cover: all naming patterns used in contracts, error handling style, test organization
  - Document is reviewed by a carbon market professional and a Soroban developer
  - Linked from `CONTRIBUTING.md` and the New Contributor Guide
- **Complexity:** Medium
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `documentation`, `good-first-issue`, `onboarding`
- **Relevant Files/Contracts:** `docs/`, `CONTRIBUTING.md`

---

### [Docs] Contract Event Schema Reference and Backward-Compatibility Policy
- **Work:** Document the complete event schema for all Soroban contract events (topics, data fields, encoding) and establish a backward-compatibility policy: which event fields are stable (consumers may depend on them), which are informational (may change), and the notice period required before a breaking event schema change.
- **Scope:** In scope: event schema tables for all emitted events across all four contracts, stability classifications per field, compatibility policy document, versioning strategy. Out of scope: on-chain event versioning mechanism (document as future work if needed).
- **Acceptance Criteria:**
  - All emitted events are documented with: function that emits them, topic encoding, data fields and types
  - Each field is classified as Stable, Informational, or Internal
  - Compatibility policy specifies: minimum notice period, deprecation process, migration guide requirements
  - Document is placed in `docs/contract-events.md`
  - CI check cross-references the event docs against the actual contract code for completeness
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `documentation`, `smart-contract`, `protocol-design`
- **Relevant Files/Contracts:** `contracts/`, `docs/`

---

### [Docs] Developer Environment Reproducibility with Nix or Dev Containers
- **Work:** Create a fully reproducible developer environment specification using either Nix flakes or a VS Code Dev Container (`.devcontainer/`) that installs the exact pinned versions of all required tools: Rust toolchain, Stellar CLI, Node.js, Python, PostgreSQL client, and Stellar SDK. A new contributor should be able to run a single command and have a working environment.
- **Scope:** In scope: Nix flake or Dev Container spec, pinned tool versions matching `docs/SETUP_CHECKLIST.md`, one-command setup verification, documentation update. Out of scope: cloud-hosted dev environments (Codespaces configuration is a bonus), Windows support (Linux/macOS only).
- **Acceptance Criteria:**
  - `nix develop` or opening the repo in VS Code Dev Container produces a working environment
  - All tool versions match those required in `docs/SETUP_CHECKLIST.md`
  - Environment passes `./scripts/verify-setup.sh` without manual intervention
  - Setup time from scratch is under 15 minutes on a standard developer machine
  - `docs/QUICK_START.md` is updated with the new one-command setup path
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `documentation`, `developer-experience`, `devops`
- **Relevant Files/Contracts:** `docs/QUICK_START.md`, `docs/SETUP_CHECKLIST.md`

---

### [Docs] Carbon Credit Lifecycle Sequence Diagrams for All Actor Interactions
- **Work:** Produce detailed sequence diagrams for each major carbon credit lifecycle flow, showing all actor interactions including: on-chain transactions, off-chain API calls, oracle bridge submissions, and event-triggered backend processing. Diagrams must be maintained as code (Mermaid or PlantUML) so they can be updated alongside code changes.
- **Scope:** In scope: sequence diagrams for project registration, credit issuance, marketplace purchase, bulk purchase, retirement, and certificate generation. Out of scope: infrastructure-level diagrams (deployment topology), UI wireframes.
- **Acceptance Criteria:**
  - Six sequence diagrams exist in Mermaid or PlantUML format in `docs/diagrams/`
  - Each diagram shows all actors: project developer, verifier, oracle, contract, backend, buyer
  - Diagrams render correctly in GitHub's native Mermaid preview
  - Diagrams are linked from `docs/carbon-credit-lifecycle.md`
  - A CI check verifies diagram syntax is valid on every PR that modifies them
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `documentation`, `architecture`, `good-first-issue`
- **Relevant Files/Contracts:** `docs/`, `docs/carbon-credit-lifecycle.md`

---

### [Docs] Security Incident Response Playbook
- **Work:** Write a comprehensive security incident response playbook covering the most likely incident scenarios for CarbonLedger: smart contract exploit discovered, oracle key compromise, backend database breach, and fraudulent credit issuance detected. Each scenario should have a defined severity rating, communication plan, and technical response checklist.
- **Scope:** In scope: 4 detailed incident scenarios, severity classification rubric, communication templates (internal and public), technical response checklists, post-incident review template. Out of scope: legal response procedures, cyber insurance claims process.
- **Acceptance Criteria:**
  - All 4 incident scenarios are documented with 5-step response checklists
  - Severity rubric distinguishes P0/P1/P2/P3 with concrete examples from the CarbonLedger context
  - Communication templates exist for: internal team, affected users, and public disclosure
  - Emergency pause procedure is referenced and linked from the smart contract exploit scenario
  - Playbook is reviewed by a contributor with security incident response experience
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `documentation`, `security`, `operations`
- **Relevant Files/Contracts:** `docs/`, `SECURITY.md`

---

### [Docs] Data Dictionary: All On-Chain and Off-Chain Data Fields with Canonical Definitions
- **Work:** Create a comprehensive data dictionary that provides canonical definitions for every data field used across the Soroban contracts, PostgreSQL schema, and API responses: field name, type, constraints, description, example values, and which layer(s) it appears in. This prevents naming inconsistencies and ambiguity across the codebase.
- **Scope:** In scope: all contract storage fields, all Prisma model fields, all API request/response fields, cross-reference between layers. Out of scope: frontend component prop names, internal variable names.
- **Acceptance Criteria:**
  - Every contract storage key is defined with type, constraints, and description
  - Every Prisma model field is defined with constraints and business meaning
  - Field names that appear in multiple layers are cross-referenced
  - Dictionary is placed in `docs/data-dictionary.md` and kept in sync via PR checklist
  - At least 5 naming inconsistencies between layers are identified and resolved as part of the work
- **Complexity:** Medium
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `documentation`, `architecture`, `good-first-issue`
- **Relevant Files/Contracts:** `docs/`, `contracts/`, `backend/prisma/schema.prisma`

---

### [Docs] Local Testnet Setup Guide with Pre-Deployed Contracts and Seed Data
- **Work:** Create a step-by-step guide (and supporting scripts) for setting up a fully functional local CarbonLedger testnet environment with pre-deployed contracts, seeded test accounts (project developer, verifier, corporation), pre-minted credits, and an active marketplace listing — allowing contributors to test without deploying contracts themselves.
- **Scope:** In scope: setup script for local Stellar testnet (using `stellar network start`), pre-deployment script, seed data script, verification script, documentation. Out of scope: cloud-hosted testnet environments, mainnet guidance.
- **Acceptance Criteria:**
  - A single `./scripts/setup-local-testnet.sh` command produces a working environment in under 10 minutes
  - All four contracts are deployed and initialized with seeded data
  - Three test wallets are created (developer, verifier, corporation) with appropriate balances
  - At least one credit batch is minted and listed on the marketplace
  - Guide in `docs/LOCAL_TESTNET_GUIDE.md` explains what was set up and how to interact with it
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `documentation`, `developer-experience`, `devops`, `good-first-issue`
- **Relevant Files/Contracts:** `scripts/`, `docs/`

---

### [Docs] Protocol Upgrade Governance Process and Community Voting Design
- **Work:** Design and document a community governance process for CarbonLedger protocol upgrades: how changes are proposed (CLP — CarbonLedger Proposals), how they are discussed, what constitutes sufficient review, and how the final upgrade decision is made. This should balance decentralization goals with the practical need for rapid security response.
- **Scope:** In scope: CLP proposal template, governance stages (draft → review → accepted/rejected → deployed), voting mechanism design (even if initially off-chain), emergency exception process. Out of scope: on-chain voting implementation (document as future work), legal entity structure.
- **Acceptance Criteria:**
  - CLP template is defined with required sections (motivation, specification, security considerations, migration path)
  - Governance stages are defined with minimum time in each stage (except emergency track)
  - Emergency track (e.g., critical security fixes) is defined with accelerated but accountable process
  - At least 2 example CLPs are drafted to validate the process (one routine, one breaking change)
  - Document placed in `docs/governance.md` and linked from `CONTRIBUTING.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `documentation`, `governance`, `protocol-design`, `needs-design-review`
- **Relevant Files/Contracts:** `docs/`

---

## Compliance & Standards

### [Compliance] SEP-41 Token Standard Compliance Audit for Carbon Credit Token
- **Work:** Conduct a full compliance audit of the `carbon_credit` contract against the Stellar SEP-41 token standard. Identify any deviations (intentional or accidental), document the rationale for intentional deviations, and implement fixes for unintentional gaps. Special attention should be paid to the retirement-as-burn semantics and whether they conform or require a documented extension.
- **Scope:** In scope: all SEP-41 interface functions, retirement-as-burn analysis, event emission compliance, allowance mechanism (if applicable). Out of scope: SEP-41 compliance for marketplace or registry contracts, legal compliance.
- **Acceptance Criteria:**
  - A compliance matrix maps every SEP-41 requirement to its implementation status
  - Every deviation is documented as either intentional (with rationale) or fixed
  - Retirement-as-burn semantics are explicitly addressed in the compliance document
  - At least one test per SEP-41 interface function verifies standard-compliant behavior
  - Compliance document placed in `audit/sep41-compliance.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `compliance`, `smart-contract`, `standards`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/carbon_credit/src/lib.rs`, `audit/`

---

### [Compliance] Regulatory Disclosure Data Export Tooling (GHG Protocol and TCFD Formats)
- **Work:** Build a data export service that generates regulatory-ready disclosure reports for corporate buyers in GHG Protocol and TCFD-aligned formats. The tool should pull a company's complete retirement history from the backend and generate structured CSV, JSON-LD, and PDF reports suitable for submission to regulators or inclusion in sustainability reports.
- **Scope:** In scope: GHG Protocol Scope 3 Category 15 offset export format, TCFD climate disclosure format, PDF and CSV/JSON-LD outputs, batch export for a configurable date range. Out of scope: direct regulatory submission API integrations, legal review of report content.
- **Acceptance Criteria:**
  - Exports cover all required GHG Protocol Scope 3 Category 15 fields
  - TCFD format includes: reporting period, total tonnes retired, methodology breakdown, verification status
  - PDF output is print-ready with CarbonLedger branding and digital signature
  - Export endpoint requires authentication and audit-logs every export request
  - Integration tests verify correct field mapping for both export formats
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `compliance`, `backend`, `api`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/retirements/`, `backend/src/`

---

### [Compliance] KYC/AML Integration Research and Design Document for Corporate Onboarding
- **Work:** Research and produce a design document for integrating KYC (Know Your Customer) and AML (Anti-Money Laundering) verification into the CarbonLedger corporate onboarding flow. The design must balance compliance requirements with the permissionless nature of the Stellar blockchain, and propose where verification gates sit (backend only, or also on-chain via allowlist).
- **Scope:** In scope: survey of KYC/AML provider APIs (Jumio, Onfido, Persona), design for backend-gated vs on-chain allowlist approaches, privacy implications, legal jurisdiction analysis for at least 3 major markets (US, EU, Singapore). Out of scope: actual KYC provider integration (implementation follows this design), smart contract changes.
- **Acceptance Criteria:**
  - At least 3 KYC/AML provider APIs are evaluated with a comparison matrix
  - Two architectural approaches are fully designed (backend-gated and on-chain allowlist)
  - Privacy analysis covers GDPR and CCPA implications for each approach
  - Legal jurisdiction requirements are documented for US, EU, and Singapore
  - Recommendation section with clear rationale for the preferred approach
- **Complexity:** High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `compliance`, `research`, `needs-design-review`, `domain-expertise`
- **Relevant Files/Contracts:** `docs/`, `backend/src/`

---

### [Compliance] On-Chain Audit Trail Export for Regulatory Inspection (ISO 14064 Alignment)
- **Work:** Design and implement a comprehensive audit trail export that produces a machine-readable, cryptographically verifiable record of all on-chain events for a given project or credit batch, aligned with ISO 14064-2 greenhouse gas project quantification requirements. The export should be self-contained — a regulator with no CarbonLedger account should be able to independently verify the trail.
- **Scope:** In scope: export format design, Stellar transaction hash inclusion for every event, Ed25519 signature over the export package, ISO 14064-2 field alignment. Out of scope: automated submission to ISO certification bodies, legal certification.
- **Acceptance Criteria:**
  - Export includes all on-chain events with their Stellar transaction hashes
  - ISO 14064-2 required fields are mapped and included (or flagged as not applicable)
  - Export package is signed and a standalone verification script is provided
  - A regulator can verify the export against Stellar Horizon without a CarbonLedger account
  - Export format specification documented in `docs/audit-trail-export-spec.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `compliance`, `backend`, `audit`, `standards`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/`, `docs/`

---

### [Compliance] GDPR Data Subject Rights Implementation: Access, Erasure, and Portability
- **Work:** Implement GDPR data subject rights endpoints for EU-based users: right of access (export all personal data), right to erasure (anonymize personal data, preserving audit trail integrity), and right to data portability (structured machine-readable export). Include a request tracking workflow with legally mandated response deadlines.
- **Scope:** In scope: data access export, erasure/anonymization (preserving on-chain references), portability export in JSON format, request tracking with 30-day deadline enforcement. Out of scope: legal advice on GDPR compliance scope, handling requests from non-EU users differently.
- **Acceptance Criteria:**
  - Data access export includes all PII fields held about the user across all backend tables
  - Erasure anonymizes PII without deleting on-chain audit trail references
  - Portability export is in machine-readable JSON with a documented schema
  - Request tracking enforces the 30-day response deadline with automated reminders
  - Integration tests cover: access export completeness, erasure with referential integrity, portability format validation
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `compliance`, `backend`, `privacy`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Compliance] SEP-0001 Stellar.toml Completeness Audit and Validation
- **Work:** Audit the existing `Stellar.toml` for completeness and accuracy against the SEP-0001 specification. Ensure all required fields are present, all contract addresses are current, CORS headers are correctly configured, and a CI check validates the file on every PR that modifies it.
- **Scope:** In scope: full SEP-0001 field audit, CORS configuration, contract address accuracy, CI validation script. Out of scope: SEP-0010 or other SEP implementations (separate issues), marketing/descriptive content changes.
- **Acceptance Criteria:**
  - Every required SEP-0001 field is present and correctly formatted
  - All four contract addresses in `Stellar.toml` match the deployed testnet contract IDs
  - CORS headers allow the frontend origin and the public Horizon endpoints
  - CI runs a SEP-0001 validation script on every PR touching `Stellar.toml`
  - A one-line summary in `docs/` explains how to update `Stellar.toml` after contract redeployment
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `compliance`, `standards`, `stellar`, `good-first-issue`
- **Relevant Files/Contracts:** `Stellar.toml`, `.github/workflows/`

---

### [Compliance] Terms of Service and Privacy Policy Implementation with Acceptance Tracking
- **Work:** Implement a terms of service and privacy policy acceptance flow in the backend and frontend: users must accept the current version of both documents before transacting, acceptance is recorded with timestamp and document version hash, and a new version triggers a re-acceptance prompt on next login.
- **Scope:** In scope: TOS/PP acceptance recording (PostgreSQL), version hash verification, re-acceptance trigger on version change, frontend acceptance modal on first login. Out of scope: legal drafting of the documents themselves (legal team responsibility), accessibility of document content (separate concern).
- **Acceptance Criteria:**
  - Acceptance is recorded with: user_id, document_type, version_hash, accepted_at, IP address
  - Transactional endpoints return 403 if the current document version has not been accepted
  - New document version triggers re-acceptance check on next authenticated request
  - Acceptance can be exported as part of GDPR data access response
  - Integration tests cover: first acceptance, re-acceptance on version change, transaction blocked before acceptance
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `compliance`, `backend`, `frontend`
- **Relevant Files/Contracts:** `backend/src/`, `frontend/`

---

### [Compliance] Implement Sanctions Screening Integration for High-Value Transactions
- **Work:** Design and implement a sanctions screening integration that checks the Stellar address of counterparties in high-value transactions (above a configurable threshold) against OFAC SDN and EU consolidated sanctions lists before allowing the transaction to proceed. Include a clear block/flag/allow decision workflow and an audit log of all screening results.
- **Scope:** In scope: sanctions API integration (e.g., OpenSanctions or equivalent), screening for purchase and retirement transactions above threshold, block/flag/allow workflow, audit log. Out of scope: real-time screening of all read operations, legal liability determination.
- **Acceptance Criteria:**
  - Transactions above the configurable threshold are screened before backend processing
  - Blocked addresses are logged with the sanctions list entry that matched
  - False positive review workflow allows a compliance officer to override with documented justification
  - Screening results are retained for a configurable period for regulatory examination
  - Integration tests cover: clean address passes, sanctioned address blocked, threshold below screen
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `compliance`, `backend`, `security`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Compliance] Immutable Audit Log for All Administrative Actions
- **Work:** Implement an immutable, append-only audit log for all administrative actions in the backend: user role changes, KYC status updates, manual state overrides, sanctions screening overrides, and any direct database modifications made outside the normal API flow. The log must be tamper-resistant (hash-chained) and exportable for regulatory inspection.
- **Scope:** In scope: append-only audit table in PostgreSQL, hash-chaining of audit records, admin action logging middleware in NestJS, export endpoint for regulatory inspection. Out of scope: real-time streaming of audit events to external SIEM (noted as enhancement), automated anomaly detection on admin actions.
- **Acceptance Criteria:**
  - Every admin action is recorded with: actor, action type, affected resource, before/after state, timestamp
  - Hash chain ensures no record can be deleted or modified without detection
  - Export endpoint produces a cryptographically verifiable audit log file
  - A CI test verifies that direct database inserts bypass the hash chain and are detectable
  - Audit log access is restricted to admin role (role-based access enforced)
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `compliance`, `backend`, `security`, `audit`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Compliance] Carbon Credit Serialization Format: ISO 14721-Aligned Long-Term Preservation
- **Work:** Define and implement a long-term preservation serialization format for carbon credit records aligned with ISO 14721 (OAIS reference model) requirements, ensuring that credit provenance records remain readable and verifiable decades from now without dependency on CarbonLedger's proprietary systems. Include a reader implementation and migration guide.
- **Scope:** In scope: preservation format specification (JSON-LD with linked data contexts), reader implementation in at least one language, migration guide from current format, test for format stability across versions. Out of scope: physical media archival, third-party archival service integration.
- **Acceptance Criteria:**
  - Preservation format specification is published in `docs/preservation-format.md`
  - Format uses only open standards (JSON-LD, W3C Verifiable Credentials, or equivalent)
  - A standalone reader script parses and validates a preservation record without any CarbonLedger dependency
  - Format versioning strategy ensures future readability when fields are added or removed
  - At least 3 sample preservation records are committed to `docs/examples/` for reference
- **Complexity:** Very High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `compliance`, `standards`, `protocol-design`, `needs-design-review`
- **Relevant Files/Contracts:** `docs/`, `backend/src/retirements/`

---

### [Compliance] Energy Consumption and Carbon Footprint Reporting for On-Chain Operations
- **Work:** Implement a tooling layer that estimates and reports the energy consumption and carbon footprint of CarbonLedger's own on-chain operations (Stellar transactions, IPFS pinning, backend infrastructure). Produce a periodic self-reporting document demonstrating the platform's net carbon impact (credits retired - operations footprint).
- **Scope:** In scope: Stellar transaction carbon cost estimation (using Stellar Energy Efficiency data), infrastructure carbon estimation (using cloud provider emissions APIs), monthly self-report generation. Out of scope: real-time per-transaction carbon accounting, third-party audit of estimates.
- **Acceptance Criteria:**
  - Monthly carbon footprint report is generated automatically and stored in the repository
  - Stellar transaction cost estimation uses a documented and cited methodology
  - Infrastructure emissions are estimated using the cloud provider's official carbon API
  - Report compares platform operational emissions against credits retired in the same period
  - Estimation methodology is documented with uncertainty ranges in `docs/operational-carbon.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `compliance`, `sustainability`, `backend`, `documentation`
- **Relevant Files/Contracts:** `scripts/`, `docs/`

---

### [Compliance] Implement Verifiable Credentials (W3C VC) for Retirement Certificates
- **Work:** Implement W3C Verifiable Credentials (VC) as the canonical format for retirement certificates, enabling corporate buyers to present their retirement certificates to any VC-aware verifier (auditor, regulator, ESG rating agency) using standard DID and VC tooling without depending on CarbonLedger's backend being online.
- **Scope:** In scope: W3C VC Data Model 2.0 compliance, DID method selection (did:web or did:stellar), Ed25519 proof suite, VC issuance in the retirement flow, verification endpoint. Out of scope: DID resolver infrastructure, selective disclosure (ZKP-based), mobile wallet VC presentation.
- **Acceptance Criteria:**
  - Retirement certificates are issued as W3C VC 2.0 compliant documents
  - Credentials are verifiable using any standards-compliant VC verifier library
  - DID document for CarbonLedger is hosted at a well-known URL and linked in `Stellar.toml`
  - Credential revocation is addressed (document as not applicable or implement a revocation registry)
  - Integration test verifies credential issuance, presentation, and verification using a reference VC library
- **Complexity:** Very High
- **Estimated Time Frame:** 4+ weeks
- **Suggested Labels:** `compliance`, `cryptography`, `standards`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/retirements/`, `Stellar.toml`, `docs/`

---

### [Compliance] Methodology Scoring Algorithm Transparency and Auditability
- **Work:** The methodology score (minimum 70/100 required for project approval) is referenced throughout the contracts but the scoring algorithm is not publicly documented. Design, document, and implement a transparent, auditable scoring algorithm with per-criterion weights, evidence requirements, and an appeal process for projects that score below the threshold.
- **Scope:** In scope: scoring algorithm specification (weighted criteria matrix), implementation in the backend project registration flow, appeal workflow, public documentation of criteria and weights. Out of scope: changes to the Soroban contract's 70/100 minimum threshold (contract change requires governance), third-party auditor accreditation.
- **Acceptance Criteria:**
  - Scoring criteria, weights, and evidence requirements are publicly documented in `docs/methodology-scoring.md`
  - Backend computes and stores the per-criterion score breakdown alongside the aggregate score
  - Appeal workflow allows a project to submit additional evidence for manual review
  - The scoring algorithm produces consistent results (deterministic for the same inputs)
  - At least 5 example projects across methodologies are scored and their results documented
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `compliance`, `backend`, `protocol-design`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/`, `contracts/carbon_registry/src/lib.rs`, `docs/`

---

### [Compliance] Implement Rate Limiting and Abuse Prevention for Public Audit Explorer
- **Work:** The public audit explorer (no wallet required) is particularly vulnerable to data scraping and DoS attacks. Implement tiered rate limiting for the public audit API: anonymous users (IP-based, strict), authenticated users (loose), and registered API consumers (configurable via API key). Include abuse detection for systematic serial number enumeration.
- **Scope:** In scope: tiered rate limiting for all public audit endpoints, API key registration flow for bulk consumers, serial number enumeration detection (sequential range queries). Out of scope: CAPTCHA integration (noted as enhancement), CDN-level rate limiting.
- **Acceptance Criteria:**
  - Anonymous IP-based rate limit is enforced (default: 60 requests/minute)
  - Authenticated users receive a higher limit (default: 300 requests/minute)
  - API key consumers can be granted custom limits via admin configuration
  - Sequential serial number enumeration triggers a temporary IP block after configurable threshold
  - Rate limit behavior is documented in `docs/api-usage-policy.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `compliance`, `backend`, `security`, `api`
- **Relevant Files/Contracts:** `backend/src/`, `frontend/`

---

### [Compliance] Carbon Credit Provenance Hashing: Merkle Tree for Batch Integrity
- **Work:** Implement a Merkle tree commitment scheme for each credit batch where each leaf is the hash of a single credit's provenance data (serial number, project ID, vintage year, issuance date). The Merkle root is stored on-chain at mint time, allowing any credit in the batch to be independently verified against the on-chain commitment without revealing all other credits.
- **Scope:** In scope: Merkle tree construction in the backend/oracle, Merkle root storage in `mint_credits()` call data or event, proof generation endpoint, proof verification script. Out of scope: zero-knowledge proofs (Merkle proofs only), on-chain proof verification in Soroban (off-chain verification only).
- **Acceptance Criteria:**
  - Merkle root is computed and included in every credit minting transaction
  - Proof generation endpoint returns the Merkle proof for any serial number in a batch
  - Standalone verification script confirms a credit's inclusion in the on-chain Merkle root
  - Batch size limits are defined to keep proof depths reasonable (max 2^20 credits per batch)
  - Scheme documented with security properties in `docs/batch-integrity.md`
- **Complexity:** Very High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `compliance`, `cryptography`, `smart-contract`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/carbon_credit/src/lib.rs`, `backend/src/`, `oracle/`

---

### [Compliance] Automated Compliance Report Generation for Annual ESG Disclosures
- **Work:** Build an automated compliance report generator that produces a complete annual ESG disclosure package for corporate buyers: total Scope 1/2/3 offsets, methodology and geography breakdown, vintage year distribution, verification body summary, and a signed attestation letter. The report should be usable directly in CDP, GRI, and SASB disclosure frameworks.
- **Scope:** In scope: data aggregation for annual reports, CDP/GRI/SASB field mapping, signed PDF generation, automated scheduling for year-end reporting. Out of scope: direct submission to CDP/GRI/SASB portals, legal review of disclosure adequacy, real-time reporting.
- **Acceptance Criteria:**
  - Annual report covers all required fields for at least CDP and GRI Standards
  - Report is generated automatically at configurable intervals (default: annually, on-demand available)
  - All data in the report is traceable to on-chain retirement transactions via footnotes
  - Report is digitally signed using the same certificate key as retirement certificates
  - Integration tests verify correct field population for a synthetic portfolio covering all edge cases
- **Complexity:** High
- **Estimated Time Frame:** 3–4 weeks
- **Suggested Labels:** `compliance`, `backend`, `api`, `enterprise`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/retirements/`, `backend/src/`

---

### [Compliance] Smart Contract License Audit and Open Source Dependency Compliance Review
- **Work:** Conduct a comprehensive license audit of all dependencies across the four package managers (Cargo, npm ×2, pip) to identify any licenses incompatible with CarbonLedger's MIT license (e.g., AGPL, SSPL, Commons Clause). Produce a dependency license report and resolve any incompatibilities through substitution or explicit license exception requests.
- **Scope:** In scope: license audit for all four dependency trees, incompatibility resolution, NOTICE file generation, license compliance CI check. Out of scope: legal advice on license interpretation, negotiating commercial licenses.
- **Acceptance Criteria:**
  - Complete SPDX license inventory exists for all dependencies in all four package managers
  - All GPL/AGPL/SSPL dependencies are either removed, isolated, or have documented exceptions
  - A `NOTICE` file lists all third-party dependencies and their licenses
  - CI check fails if any new dependency with an incompatible license is added
  - License compliance policy documented in `docs/license-compliance.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `compliance`, `legal`, `good-first-issue`
- **Relevant Files/Contracts:** `contracts/Cargo.toml`, `frontend/package.json`, `backend/package.json`, `oracle/requirements.txt`

---

### [Compliance] Build Regulatory Sandbox Mode for Pilot Programs with Synthetic Credits
- **Work:** Implement a "sandbox mode" configuration that allows regulatory bodies and enterprise pilots to run complete CarbonLedger workflows with clearly marked synthetic credits that cannot be confused with real credits, cannot be transferred outside the sandbox, and are automatically expired after a configurable period.
- **Scope:** In scope: sandbox mode flag in contracts and backend, synthetic credit marking (non-transferable outside sandbox context), expiry mechanism, sandbox vs. production visual differentiation in frontend. Out of scope: separate blockchain network for sandbox (use testnet with mode flag), billing/commercial features for sandbox.
- **Acceptance Criteria:**
  - Sandbox credits are clearly marked on-chain and cannot be listed on the production marketplace
  - Sandbox mode can be enabled per-organization without affecting other users
  - Credits in sandbox mode automatically expire after a configurable period (default: 90 days)
  - Frontend displays a prominent "SANDBOX — Synthetic Credits" banner in sandbox mode
  - Integration tests verify sandbox credits cannot leak into production flows
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `compliance`, `smart-contract`, `backend`, `frontend`, `needs-design-review`
- **Relevant Files/Contracts:** `contracts/`, `backend/src/`, `frontend/`

---

---

## Additional Issues (Cross-Cutting)

### [Security] Implement Ed25519 Signature Verification for Off-Chain Oracle Data Payloads
- **Work:** Require that all off-chain data submitted to the oracle bridge (satellite data, price feeds, verification attestations) is signed with the submitter's Ed25519 key, and that the oracle verifies the signature before forwarding data on-chain. This closes the gap between the satellite provider's webhook and the oracle's on-chain submission.
- **Scope:** In scope: signature verification in all three oracle services, key registry for authorized data providers, signature failure alerting. Out of scope: hardware security module (HSM) key storage, changes to Soroban contracts.
- **Acceptance Criteria:**
  - All three oracle services reject unsigned or incorrectly signed payloads
  - Authorized provider keys are managed in a registry with add/revoke capability
  - Signature verification failures are logged with the provider identity and payload hash
  - Integration test covers: valid signature, invalid signature, revoked key, unknown key
  - Key management procedures documented in `docs/KEY_ROTATION_PROCEDURES.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `oracle`, `security`, `cryptography`
- **Relevant Files/Contracts:** `oracle/`, `docs/KEY_ROTATION_PROCEDURES.md`

---

### [Backend] Implement Stellar Horizon Event Streaming Consumer for Real-Time State Sync
- **Work:** Build a persistent Stellar Horizon event streaming consumer in the NestJS backend that subscribes to all four contract event streams and updates the PostgreSQL read model in real time. This replaces the current polling-based approach, reducing state sync latency from minutes to seconds and eliminating the need for reconciliation in most cases.
- **Scope:** In scope: Horizon SSE consumer, event-to-database projection logic for all contract events, reconnection with cursor resumption (no events missed on restart), consumer health endpoint. Out of scope: WebSocket push to frontend (separate concern), changes to Soroban contracts.
- **Acceptance Criteria:**
  - Consumer subscribes to all four contract event streams and processes events within 5 seconds of ledger close
  - Consumer resumes from the last processed cursor on restart with no missed events
  - All 6 credit lifecycle event types update the correct database projections
  - Consumer health is exposed at `/health/horizon-consumer` with last-processed ledger sequence
  - Integration tests cover: normal processing, reconnect after disconnect, duplicate event handling (idempotent)
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `infrastructure`, `distributed-systems`
- **Relevant Files/Contracts:** `backend/src/`, `backend/prisma/schema.prisma`

---

### [Frontend] Implement Progressive Loading and Skeleton Screens for Data-Heavy Pages
- **Work:** Implement progressive loading with skeleton screens for the marketplace listing page, portfolio dashboard, and project detail pages. Data should load in priority order (above-the-fold content first, charts and secondary data second), with skeleton placeholders preventing layout shift and maintaining perceived performance.
- **Scope:** In scope: skeleton screen components for all three pages, React Suspense boundaries, priority-ordered data fetching with Next.js 14 `loading.tsx`, Core Web Vitals improvement. Out of scope: SSR streaming (document as future enhancement), service worker prefetching.
- **Acceptance Criteria:**
  - All three pages show meaningful skeleton content within 200ms of navigation
  - Cumulative Layout Shift (CLS) score is < 0.1 for all three pages
  - Above-the-fold content is interactive before below-the-fold data loads
  - Skeleton components are reusable and accept size/shape props
  - Lighthouse performance scores improve by at least 10 points vs. baseline for all three pages
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `frontend`, `performance`, `ux`
- **Relevant Files/Contracts:** `frontend/`

---

### [Testing] Implement Testnet Deployment Smoke Test Suite as Post-Deploy Gate
- **Work:** Build a smoke test suite that runs automatically after every testnet deployment, verifying that all four contracts are reachable, all read functions return expected data shapes, the backend API is healthy, and the frontend loads without JavaScript errors. This gates the "deployment successful" signal used by the CI pipeline.
- **Scope:** In scope: smoke tests for contract read functions, backend health endpoints, frontend load verification, CI post-deploy gate integration. Out of scope: full E2E lifecycle test (that's a separate suite), performance benchmarking.
- **Acceptance Criteria:**
  - Smoke test suite runs in under 3 minutes
  - All four contract addresses are verified as deployed and callable
  - Backend `/health` and `/health/db` endpoints return healthy status
  - Frontend loads without console errors on the main page and marketplace page
  - Deployment pipeline marks the deploy as failed if any smoke test fails
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `testing`, `devops`, `ci`
- **Relevant Files/Contracts:** `scripts/`, `.github/workflows/`, `tests/`

---

### [DevOps] Implement Cost Allocation Tagging and Budget Alerts for Cloud Infrastructure
- **Work:** Add resource cost allocation tags to all Terraform-provisioned infrastructure (per-service, per-environment, per-team), configure AWS Budget alerts for monthly spend thresholds, and produce a cost optimization report identifying over-provisioned resources. This is critical before mainnet launch to prevent unexpected infrastructure bills.
- **Scope:** In scope: Terraform tagging module, AWS Budgets configuration, cost optimization report for staging environment, rightsizing recommendations. Out of scope: reserved instance purchasing, spot instance migration.
- **Acceptance Criteria:**
  - All Terraform resources have mandatory tags: `service`, `environment`, `owner`, `cost-center`
  - Budget alerts are configured for 80% and 100% of monthly budget per environment
  - Cost optimization report identifies at least 3 rightsizing opportunities in staging
  - Tag compliance is enforced via `terraform plan` check (missing tags fail validation)
  - Cost allocation dashboard is accessible in AWS Cost Explorer with per-service breakdown
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `infrastructure`, `cost-optimization`
- **Relevant Files/Contracts:** `infra/`

---

### [Docs] Write Integration Guide for Third-Party Carbon Registry API Connections
- **Work:** Write a technical integration guide for connecting CarbonLedger to third-party carbon registries (Verra, Gold Standard, American Carbon Registry). Document the API authentication, data field mapping, synchronization strategy, and conflict resolution approach for each registry. This guide should enable an experienced contributor to build a registry connector without additional context.
- **Scope:** In scope: API documentation review for all three registries, data field mapping tables, authentication flow documentation, conflict resolution design. Out of scope: actually building the connectors (this is the design guide), legal agreements with registries.
- **Acceptance Criteria:**
  - Integration guide exists for Verra, Gold Standard, and American Carbon Registry
  - Each guide covers: API authentication, rate limits, data field mapping, webhook/polling strategy
  - A common connector interface is defined that all three connectors should implement
  - Data conflict resolution (registry says project is active, CarbonLedger says suspended) is addressed
  - Guide placed in `docs/registry-integration-guide.md`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `documentation`, `protocol-design`, `domain-expertise`
- **Relevant Files/Contracts:** `docs/`, `backend/src/`

---

### [Security] Time-Lock Mechanism for Large Credit Batch Minting Above Threshold
- **Work:** Implement a time-lock mechanism in `carbon_credit` that delays the execution of very large credit mints (above a configurable threshold, e.g., 1 million tonnes) by 48 hours after an admin approves the mint. This provides a window for fraud detection and human review before a potentially fraudulent large-batch mint becomes irreversible.
- **Scope:** In scope: time-lock storage in `carbon_credit`, admin approval queue, 48-hour delay enforcement, cancellation within the delay window. Out of scope: multi-sig admin approval (tracked in separate issue), on-chain governance of the threshold.
- **Acceptance Criteria:**
  - Mint requests above threshold are queued with a timestamp instead of executed immediately
  - Queued mints are executable only after the configured delay has elapsed
  - Admin can cancel a queued mint within the delay window
  - Tests cover: small mint (immediate), large mint queued, queued mint executed after delay, queued mint cancelled
  - Time-lock threshold and delay period are configurable contract parameters
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `security`, `governance`
- **Relevant Files/Contracts:** `contracts/carbon_credit/src/lib.rs`

---

### [Backend] Implement Project Registration Validation Against Known Project Coordinate Databases
- **Work:** When a new carbon project is registered, validate the submitted coordinates against known project exclusion zones (urban areas, water bodies, existing registered projects in other registries) using open geospatial datasets. Flag registrations with coordinates in suspicious locations for verifier attention rather than auto-rejecting.
- **Scope:** In scope: coordinate validation against at least 2 open geospatial datasets, overlap detection with existing CarbonLedger projects, flagging suspicious registrations, geospatial query performance optimization. Out of scope: real-time satellite imagery validation (oracle concern), legal land ownership verification.
- **Acceptance Criteria:**
  - Submitted project coordinates are validated against urban boundary and water body datasets
  - Overlap with any existing CarbonLedger project boundary raises a conflict flag
  - Suspicious registrations are flagged (not rejected) with specific reason codes for verifier review
  - Geospatial queries complete within 500ms for projects with up to 1000 active registrations
  - Geospatial datasets used are documented with their update frequency and licensing in `docs/`
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `oracle`, `fraud-detection`, `needs-design-review`
- **Relevant Files/Contracts:** `backend/src/`, `oracle/`

---

### [Frontend] Implement Token-Gated Content for Corporate-Only Research Reports
- **Work:** Implement a token-gating mechanism in the frontend that restricts access to detailed market research reports (benchmark prices, methodology trend analysis, project pipeline data) to users who hold at least a configurable minimum balance of retired carbon credits. Token verification is done against on-chain state without a separate NFT contract.
- **Scope:** In scope: token gate check using Soroban `get_credit_batch` queries, gated content wrapper component, wallet connection requirement, graceful degradation for non-qualifying users. Out of scope: NFT-based access control, paid subscription tiers.
- **Acceptance Criteria:**
  - Gated content is inaccessible without a connected wallet and qualifying credit balance
  - Balance check reads from on-chain state (not backend cache) to prevent gaming
  - Non-qualifying users see a clear explanation of the requirement and their current balance
  - Token gate configuration (minimum balance, content to gate) is in the backend config
  - E2E test covers: qualifying wallet (access granted), non-qualifying wallet (access denied), no wallet (access denied)
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `frontend`, `smart-contract`, `ux`
- **Relevant Files/Contracts:** `frontend/`, `contracts/carbon_credit/src/lib.rs`

---

### [Testing] Implement GitHub Actions Test Reporting with Annotations and PR Comments
- **Work:** Enhance CI to post structured test result summaries as PR comments and inline GitHub annotations: failed Rust tests annotated at the failing line, backend test failures shown per-module, and E2E test failures shown with screenshot links. This reduces the time to diagnose a CI failure from minutes to seconds.
- **Scope:** In scope: GitHub Actions annotations for Rust, Jest, and Playwright test failures, PR comment summarizing pass/fail/skip counts per suite, screenshot upload for E2E failures. Out of scope: Slack/email notifications (separate issue), test flakiness tracking.
- **Acceptance Criteria:**
  - Rust test failures produce GitHub check annotations pointing to the failing line
  - PR comment shows: total pass/fail/skip per suite, link to full logs, links to failure screenshots for E2E
  - Annotations appear within 1 minute of test completion
  - PR comment is updated (not duplicated) on subsequent pushes to the same PR
  - Setup documented in `.github/README.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `ci`, `developer-experience`
- **Relevant Files/Contracts:** `.github/workflows/`

---

### [Backend] Implement Stellar Account Merge Detection to Prevent Balance Disappearance
- **Work:** Implement detection and handling for Stellar account merge operations that could cause a corporate buyer's credit-holding account to be merged into another account, transferring all remaining XLM but potentially orphaning credits still held in the contract. Alert the account owner and the CarbonLedger admin when a merge is detected.
- **Scope:** In scope: Horizon event monitoring for `account_merge` operations affecting registered users, alert generation, backend account status update, documentation of edge cases. Out of scope: preventing account merges at the Stellar protocol level, automatic credit recovery.
- **Acceptance Criteria:**
  - Horizon streaming consumer detects `account_merge` events for all registered user accounts
  - Detected merges trigger an immediate alert to the account owner and admin
  - Account is marked as `merged` in the backend with the merge transaction hash
  - Credits still held on-chain for a merged account are flagged for manual review
  - Recovery procedure documented in `docs/runbooks/account-merge.md`
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `backend`, `stellar`, `infrastructure`
- **Relevant Files/Contracts:** `backend/src/`, `docs/runbooks/`

---

### [Oracle] Implement Automated Verifier Credential Expiry Monitoring
- **Work:** Build a monitoring service that tracks the expiry dates of accredited verifier credentials (stored in the backend when verifiers onboard) and automatically: sends renewal reminders at 90/30/7 days before expiry, suspends the verifier's on-chain role if credentials expire without renewal, and alerts the admin team. This prevents expired-credential verifiers from approving new projects.
- **Scope:** In scope: credential expiry tracking in PostgreSQL, reminder notification service, automated suspension trigger calling `suspend_project()` (or equivalent role revocation), admin alerting. Out of scope: credential renewal processing (manual admin task), verifier accreditation body API integrations.
- **Acceptance Criteria:**
  - Reminder notifications are sent at 90, 30, and 7 days before expiry
  - Verifier on-chain role is suspended within 1 hour of credential expiry without renewal
  - Admin receives an alert when any verifier is auto-suspended
  - Suspended verifier's pending project queue is reassigned to active verifiers
  - Integration tests cover: reminder schedule, auto-suspension trigger, reinstatement after renewal
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `oracle`, `backend`, `compliance`
- **Relevant Files/Contracts:** `oracle/`, `backend/src/`, `contracts/carbon_registry/src/lib.rs`

---

### [Security] Implement Transaction Fee Sponsorship for Onboarding New Project Developers
- **Work:** Implement Stellar's fee sponsorship (fee bump transactions) mechanism to allow CarbonLedger to cover the XLM transaction fees for new project developers during their first N project registrations, reducing the onboarding barrier of needing XLM before a project generates any revenue. Include a per-account sponsorship budget to prevent abuse.
- **Scope:** In scope: fee bump transaction construction in the backend for project registration calls, per-account sponsorship budget enforcement, sponsorship expiry after N transactions or T days, abuse detection. Out of scope: sponsoring all transaction types (project registration only), frontend for requesting sponsorship.
- **Acceptance Criteria:**
  - Fee bump transactions are constructed and submitted for eligible project developer registrations
  - Per-account sponsorship budget is enforced (default: first 3 registrations per account)
  - Sponsorship budget is stored in PostgreSQL and decremented atomically
  - Abuse detection flags accounts that attempt to create multiple identities to reset the budget
  - Integration tests cover: sponsored registration, budget exhausted (falls back to user paying), abuse flag
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `smart-contract`, `backend`, `stellar`, `onboarding`
- **Relevant Files/Contracts:** `backend/src/`, `contracts/carbon_registry/src/lib.rs`

---

### [DevOps] Implement Pre-Commit Hook Suite for All Development Environments
- **Work:** Set up a comprehensive pre-commit hook suite using `pre-commit` (Python) that enforces: Rust formatting (`rustfmt`), Rust linting (`clippy`), TypeScript/JavaScript linting (`eslint`), Python formatting (`black`) and linting (`ruff`), secret detection (`detect-secrets`), and commit message format (Conventional Commits). Hooks should run in under 30 seconds.
- **Scope:** In scope: `.pre-commit-config.yaml` covering all five languages, CI check that pre-commit passes, developer onboarding update, secret baseline for `detect-secrets`. Out of scope: custom lint rules (covered in CI gate issue), automated code fixes (flag only, don't auto-fix).
- **Acceptance Criteria:**
  - Pre-commit hooks run in under 30 seconds on a typical changed file set
  - Secret detection baseline is committed and updated when intentional secrets are added to config files
  - Conventional Commits format is enforced for all commit messages
  - CI runs `pre-commit run --all-files` on every PR and fails on any violation
  - Setup documented in `docs/development-guidelines.md` with one-command installation
- **Complexity:** Medium
- **Estimated Time Frame:** 1–2 weeks
- **Suggested Labels:** `devops`, `developer-experience`, `ci`, `good-first-issue`
- **Relevant Files/Contracts:** `.pre-commit-config.yaml`, `.github/workflows/`

---

### [Backend] Design and Implement Project Suspension Appeal Workflow
- **Work:** When a project is suspended via `suspend_project()` (triggered by oracle flag or admin), implement a structured backend appeal workflow that allows the project developer to submit evidence, tracks the review process with defined SLAs, and records the final decision (reinstatement or permanent rejection) with full audit trail.
- **Scope:** In scope: appeal submission API, evidence attachment (file upload to IPFS), review assignment to verifier, SLA tracking and escalation, final decision recording and on-chain action trigger. Out of scope: automated fraud scoring of appeals, legal appeal rights documentation.
- **Acceptance Criteria:**
  - Appeal submission API accepts: written explanation, supporting evidence files, contact information
  - Evidence files are stored on IPFS with CIDs recorded in the appeal record
  - Assigned verifier receives notification with SLA deadline (default: 10 business days)
  - SLA breach triggers escalation to admin with automated alert
  - Final decision (reinstate/reject) triggers corresponding on-chain contract call
  - Integration tests cover: appeal submission, evidence upload, SLA escalation, reinstatement trigger
- **Complexity:** High
- **Estimated Time Frame:** 2–3 weeks
- **Suggested Labels:** `backend`, `api`, `compliance`, `workflow`
- **Relevant Files/Contracts:** `backend/src/`, `contracts/carbon_registry/src/lib.rs`

---

*End of CarbonLedger Issue Catalog — 150 issues across 8 categories.*
