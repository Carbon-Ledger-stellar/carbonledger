# ADR-002: Soroban Smart Contracts over Stellar Classic

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2024-01-15 |
| Deciders | Core team |

## Context

Stellar Classic offers built-in primitives (custom assets, claimable balances, offers) that could model carbon credits without smart contracts. We evaluated whether those primitives are sufficient or whether Soroban is needed.

## Decision

Use **Soroban** (Stellar's smart contract platform) rather than Stellar Classic primitives.

## Reasons

Stellar Classic cannot express:
- **Serial number uniqueness enforcement** — we need to guarantee no two batches share a serial range; this requires contract-level state and logic
- **Retirement irreversibility** — a custom asset can always be burned and re-issued; a Soroban contract can enforce that retired credits are permanently tombstoned
- **Verifier whitelist** — access control on who can approve projects requires programmable logic
- **Oracle data validation** — price deviation checks, staleness guards, and methodology scoring require computation that Classic primitives cannot perform
- **Provenance trail** — linking a credit batch to a specific project, verifier attestation, and monitoring period requires structured on-chain state

## Consequences

**Positive:**
- Full programmability for all business rules
- Rust type system catches entire classes of bugs at compile time
- WASM execution is deterministic and auditable
- Soroban state model (ledger entries) is cheaper than EVM storage

**Negative:**
- Soroban is newer — fewer production references than EVM
- Rust learning curve for contributors unfamiliar with the language
- Contract upgrades require careful migration planning
