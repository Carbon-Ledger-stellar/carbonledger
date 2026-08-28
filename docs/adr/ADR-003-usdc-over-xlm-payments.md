# ADR-003: USDC over XLM for Carbon Credit Payments

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2024-01-20 |
| Deciders | Core team |

## Context

Carbon credits are priced in USD per tonne of CO2. The marketplace needs a payment token. The two natural candidates on Stellar are XLM (native asset) and USDC (Circle-issued stablecoin).

## Decision

Use **USDC** as the payment token for all marketplace transactions.

## Reasons

1. **Price stability** — carbon credit prices are quoted in USD. XLM volatility would create accounting complexity for both buyers (corporations with USD budgets) and sellers (project developers with USD costs).

2. **Corporate treasury compatibility** — finance teams can approve USDC purchases without hedging XLM exposure. XLM would require an FX desk.

3. **Regulatory reporting** — ESG reports require USD-denominated retirement values. USDC makes this trivial; XLM requires a price oracle just for reporting.

4. **Circle's native issuance** — USDC on Stellar is issued directly by Circle (not bridged), eliminating bridge risk and maintaining the 1:1 USD peg guarantee.

5. **Existing corporate USDC rails** — many institutional buyers already hold USDC for on-chain settlements.

## Consequences

**Positive:**
- Stable USD pricing throughout the credit lifecycle
- No FX risk for buyers or sellers
- Simplified accounting and ESG reporting
- Trustline requirement is a one-time setup, not an ongoing friction

**Negative:**
- Buyers must hold USDC, not just XLM — adds one onboarding step
- USDC trustline required before first purchase
- Circle counterparty risk (mitigated by Circle's regulatory standing and reserve audits)
