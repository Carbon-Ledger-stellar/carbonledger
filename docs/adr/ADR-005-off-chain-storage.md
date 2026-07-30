# ADR-005: Off-Chain Storage — PostgreSQL + IPFS

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2024-02-10 |
| Deciders | Core team |

## Context

Not all data belongs on-chain. Project documentation (PDFs, methodology reports, satellite images) and queryable indexes (credit batch history, retirement certificates) need storage. We need to decide what goes on-chain vs. off-chain, and which off-chain stores to use.

## Decision

- **On-chain (Soroban ledger entries):** project status, credit serial numbers, retirement records, oracle attestations — anything that must be tamper-proof
- **PostgreSQL:** queryable indexes, user accounts, API cache, certificate metadata
- **IPFS (via Pinata):** project documents, satellite imagery, retirement certificate PDFs — content-addressed, permanent

## Reasons

### Why PostgreSQL for the index layer?

- Carbon credit queries (filter by methodology, vintage, country, price range) require relational joins that are impractical to do via Soroban RPC
- Prisma ORM provides type-safe migrations and schema validation
- PostgreSQL is battle-tested for financial data with ACID guarantees

### Why IPFS for documents?

- Content addressing (CID) means the on-chain record can store a hash that permanently identifies the document — if the document changes, the CID changes, making tampering detectable
- Retirement certificates need a permanent public URL that works without a wallet — IPFS gateways provide this
- Pinata provides reliable pinning without running our own IPFS node

### Why not store everything on-chain?

- Soroban ledger entry costs make storing large blobs prohibitively expensive
- PDFs and satellite images are megabytes; on-chain storage is designed for kilobytes of structured state

## Data Ownership Model

| Data | Store | Tamper-proof? |
|------|-------|---------------|
| Project registration | Soroban | Yes |
| Credit serial numbers | Soroban | Yes |
| Retirement record | Soroban | Yes |
| Oracle attestation | Soroban | Yes |
| Project documents | IPFS (CID on-chain) | Yes (via CID) |
| Retirement certificate PDF | IPFS (CID on-chain) | Yes (via CID) |
| Credit batch index | PostgreSQL | No (cache) |
| User accounts | PostgreSQL | No |

## Consequences

**Positive:**
- Fast API queries via PostgreSQL without hitting Soroban RPC for every request
- Permanent, verifiable document storage via IPFS content addressing
- Clear separation: Soroban is the source of truth, PostgreSQL is the query layer

**Negative:**
- PostgreSQL index can drift from on-chain state if the indexer lags — must be treated as eventually consistent
- Pinata dependency for IPFS pinning — mitigated by the fact that CIDs are portable to any IPFS node
- Two storage systems to operate and back up
