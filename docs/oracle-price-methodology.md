# Oracle Price Methodology: TWAP

## Overview

The carbon oracle uses a Time-Weighted Average Price (TWAP) calculation
to derive on-chain benchmark prices from off-chain spot-price observations
(Xpansiv CBL and other configured data sources).

The TWAP is computed **off-chain** and submitted as a single value to the
on-chain `carbon_oracle` contract. This keeps on-chain logic simple while
making the price resistant to short-term manipulation and data-source outages.

## Design

### Data Flow

1. **Spot price ingestion** — Xpansiv CBL (and other providers) push spot
   prices to the off-chain TWAP module, which persists each observation in
   PostgreSQL (`price_history` table) with a UTC timestamp.

2. **TWAP calculation** — At each scheduled poll interval the module
   queries the `price_history` table for the configured look-back window
   (default: 24 hours) and computes the arithmetic mean of non-outlier
   observations.

3. **Outlier detection** — Observations whose price deviates from the running
   median by more than `TWAP_DEVIATION_THRESHOLD` (default: 15%) are flagged
   as outliers and excluded from the TWAP. The outlier count is logged.

4. **Deviation alert** — When the TWAP deviates from the median by more than
   the threshold, an automatic-submission block is triggered and an alert
   webhook (`DEVIATION_ALERT_WEBHOOK`) is fired.

5. **On-chain submission** — If the TWAP is valid (sufficient data density
   and no deviation alert), the `twap_price` is submitted to the oracle
   contract via `update_credit_price`.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `TWAP_WINDOW_HOURS` | `24` | Look-back window in hours |
| `TWAP_MIN_HOURLY_POINTS` | `1` | Minimum observations per hour of the window |
| `TWAP_DEVIATION_THRESHOLD` | `0.15` | 15% deviation from median triggers alert |
| `TWAP_DB_DSN` | `DATABASE_URL` | PostgreSQL connection string |
| `DEVIATION_ALERT_WEBHOOK` | *(none)* | URL for deviation alert POST |

### PostgreSQL Schema

```sql
CREATE TABLE price_history (
    id          BIGSERIAL PRIMARY KEY,
    methodology VARCHAR(255) NOT NULL,
    vintage_year INTEGER      NOT NULL,
    price_usdc   DOUBLE PRECISION NOT NULL,
    observed_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    source       VARCHAR(100) NOT NULL DEFAULT 'xpansiv_cbl',
    is_outlier   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

Indexes on `(methodology, vintage_year, observed_at)` and `observed_at`
support efficient time-range queries.

### Deviation Alert

A single-update deviation exceeding 15% from the median price triggers:

- A `WARNING`-level log entry with full diagnostic details
- An optional HTTP POST to `DEVIATION_ALERT_WEBHOOK` with a JSON payload
  containing `methodology`, `vintage_year`, `twap_price`, `median_price`,
  `deviation_pct`, and `action: "automatic_submission_blocked"`

The on-chain submission is **blocked** until the deviation condition is
resolved by fresh observations.

### On-Chain Integration

The on-chain oracle contract (`carbon_oracle`) stores prices as before
via `update_credit_price`. The off-chain TWAP module calls this function
with the computed TWAP value instead of the raw spot price. The
`get_benchmark_price` and `is_price_current` functions are unchanged.

See the acceptance criteria in issue #575 for details on coverage
requirements (unit tests, hourly data points, 15% threshold, audit trail).