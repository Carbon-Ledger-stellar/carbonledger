-- Migration: add_missing_indexes
--
-- Adds indexes on the most-queried columns of the retirements, credit_batches,
-- and listings tables.  Without these indexes, queries perform full table scans
-- that degrade as data grows.  This must be completed before mainnet launch.
--
-- All CREATE INDEX statements use IF NOT EXISTS so the migration is idempotent
-- and can be run safely on existing data without errors or downtime.
--
-- Addresses: retirements(project_id, created_at)
--            credit_batches(project_id, vintage_year, status)
--            listings(methodology, vintage_year, status, price_per_tonne)

-- ── RetirementRecord ─────────────────────────────────────────────────────────

-- Supports queries that filter or sort retirements by project and time:
--   WHERE project_id = $1 ORDER BY retired_at DESC
CREATE INDEX IF NOT EXISTS "RetirementRecord_projectId_retiredAt_idx"
    ON "RetirementRecord"("projectId", "retiredAt");

-- ── CreditBatch ──────────────────────────────────────────────────────────────

-- Supports queries that filter batches by project, vintage year, and status —
-- the three most common filter combinations in the marketplace and admin views:
--   WHERE project_id = $1 AND vintage_year = $2 AND status = $3
CREATE INDEX IF NOT EXISTS "CreditBatch_projectId_vintageYear_status_idx"
    ON "CreditBatch"("projectId", "vintageYear", "status");

-- ── MarketListing ─────────────────────────────────────────────────────────────

-- Supports marketplace browsing queries that filter by methodology, vintage year,
-- and status, and sort by price:
--   WHERE methodology = $1 AND vintage_year = $2 AND status = $3
--   ORDER BY price_per_credit ASC
CREATE INDEX IF NOT EXISTS "MarketListing_methodology_vintageYear_status_pricePerCredit_idx"
    ON "MarketListing"("methodology", "vintageYear", "status", "pricePerCredit");
