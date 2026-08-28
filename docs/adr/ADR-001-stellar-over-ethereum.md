# ADR-001: Stellar over Ethereum

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2024-01-15 |
| Deciders | Core team |

## Context

CarbonLedger needs a blockchain that can handle high-frequency, low-value carbon credit transactions at a cost that doesn't price out small project developers. The voluntary carbon market operates on thin margins — a $2 credit cannot absorb a $15 gas fee.

## Decision

Use **Stellar** as the base layer instead of Ethereum or an EVM-compatible L2.

## Reasons

| Criterion | Stellar | Ethereum L1 | EVM L2 (e.g. Polygon) |
|-----------|---------|-------------|----------------------|
| Transaction fee | ~$0.00001 | $2–$50 | $0.01–$0.10 |
| Finality | 3–5 seconds | 12 seconds + confirmations | 2–30 seconds |
| Native USDC | Yes (Circle-issued) | Yes (bridged) | Yes (bridged) |
| Built-in DEX | Yes (SDEX) | No | No |
| Carbon RWA focus | SDF actively supports | No specific focus | No specific focus |
| Regulatory clarity | Higher (US MSB framework) | Lower | Lower |

## Consequences

**Positive:**
- Near-zero fees make micro-transactions viable for small project developers
- Native USDC eliminates bridge risk for payments
- SDEX provides built-in liquidity without deploying a custom AMM
- 3–5 second finality gives corporations instant retirement confirmation

**Negative:**
- Smaller developer ecosystem than Ethereum
- Fewer auditing firms with Soroban/Rust expertise
- Less tooling maturity (explorers, indexers) compared to EVM
