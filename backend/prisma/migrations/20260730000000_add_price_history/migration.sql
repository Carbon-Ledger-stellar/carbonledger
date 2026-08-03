-- Migration: add_price_history
--
-- Persists price observations for TWAP calculation and auditability.
-- Each row records a single spot-price reading from Xpansiv CBL
-- (or any configured source) at the moment it was recorded.
--
-- The on-chain oracle (carbon_oracle) continues to store the latest
-- price in temporary storage with a TTL-based staleness window.
-- The off-chain TWAP module reads from this table, computes the
-- time-weighted average, detects outliers, and submits the TWAP
-- value as a single benchmark-price update.

CREATE TABLE IF NOT EXISTS price_history (
    id          BIGSERIAL PRIMARY KEY,
    methodology VARCHAR(255)    NOT NULL,
    vintage_year INTEGER        NOT NULL,
    price_usdc   DOUBLE PRECISION NOT NULL,
    observed_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    source       VARCHAR(100)    NOT NULL DEFAULT 'xpansiv_cbl',
    is_outlier   BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_methodology_vintage
    ON price_history (methodology, vintage_year, observed_at);

CREATE INDEX IF NOT EXISTS idx_price_history_observed_at
    ON price_history (observed_at);