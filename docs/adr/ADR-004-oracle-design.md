# ADR-004: Oracle Architecture — Off-Chain Bridge Design

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2024-02-01 |
| Deciders | Core team |

## Context

CarbonLedger requires two types of off-chain data on-chain:
1. **Monitoring data** — satellite verification that a forest project is still standing
2. **Price data** — benchmark carbon credit prices by methodology and vintage year

We need to decide how to bring this data on-chain securely.

## Decision

Use a **trusted oracle model** with a dedicated keypair, rather than a decentralized oracle network (e.g. Chainlink, Band Protocol).

The oracle is a Python service that:
- Polls satellite data APIs (Google Earth Engine, Planet Labs) every 6 hours
- Polls price feeds (Xpansiv CBL, Toucan) every 12 hours
- Submits signed transactions to the `carbon_oracle` Soroban contract

## Reasons

1. **No decentralized oracle on Stellar** — Chainlink and Band do not have production Soroban integrations. Building a decentralized oracle from scratch is out of scope.

2. **Data sources are already trusted** — Xpansiv CBL is the institutional carbon price benchmark. Gold Standard and Verra are the accreditation bodies. The trust is in the data source, not the delivery mechanism.

3. **Verifier accountability** — the oracle keypair is controlled by the CarbonLedger admin. Misbehavior is attributable and the keypair can be rotated via `carbon_oracle.initialize()`.

4. **Simplicity** — a Python cron job is auditable, testable, and deployable without additional infrastructure.

## Security Controls

- Oracle keypair is separate from admin keypair (principle of least privilege)
- `carbon_oracle` contract validates: price deviation ≤ 15%, monitoring data not older than 365 days
- Oracle keypair stored in environment variable, never in source code
- Admin can rotate oracle keypair without redeploying contracts

## Consequences

**Positive:**
- Simple, auditable implementation
- No dependency on third-party oracle networks
- Fast time-to-market

**Negative:**
- Single point of trust — if oracle keypair is compromised, bad data can be submitted
- No redundancy — oracle downtime means stale monitoring data (contract flags after 365 days)
- Future decentralization requires contract upgrade

## Future Consideration

If CarbonLedger scales to mainnet with significant TVL, migrate to a multi-sig oracle model where 2-of-3 accredited verifiers must co-sign monitoring submissions.
