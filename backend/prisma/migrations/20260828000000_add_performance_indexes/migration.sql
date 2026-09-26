-- This migration uses CREATE INDEX CONCURRENTLY which cannot run inside a transaction
-- @migration-strategy: no-transaction

-- Migration: add_performance_indexes
--
-- Adds targeted indexes to support the most common query patterns identified
-- in issue #1068 (Database Query Optimization).  All new indexes are on columns
-- that appear in WHERE, ORDER BY, or GROUP BY clauses in high-traffic paths:
--
--   MarketListing
--     - status                         Active/PartiallyFilled filter (marketplace browse)
--     - (status, methodology)          Faceted search by methodology
--     - (status, vintageYear)          Faceted search by vintage year
--     - (status, country)              Faceted search by country
--     - seller                         ABAC delist ownership check
--     - (projectId, status)            Project-scoped listing lookup
--     - (status, pricePerCredit)       Price-range scan support
--
--   RetirementRecord
--     - beneficiary                    Leaderboard GROUP BY beneficiary
--     - certificateStatus              Pending/failed certificate queue polling
--
--   CarbonProject
--     - ownerAddress                   project_developer role scoping
--
-- Every statement uses CONCURRENTLY IF NOT EXISTS so:
--   1. The migration is fully idempotent — safe to replay on an existing database.
--   2. Index builds do not take an ACCESS EXCLUSIVE lock, so reads and writes
--      continue uninterrupted during the index build on large tables.
--
-- NOTE: CONCURRENTLY cannot run inside a transaction block.  Prisma must execute
--       this file outside of a transaction (see @migration-strategy above).

-- ── MarketListing ─────────────────────────────────────────────────────────────

-- Supports Active/PartiallyFilled status filter — the most frequent predicate
-- on the public marketplace browse endpoint:
--   WHERE status = ANY('{Active,PartiallyFilled}'::text[])
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_status_idx"
    ON "MarketListing"("status");

-- Supports faceted search narrowed by both status and methodology:
--   WHERE status = $1 AND methodology = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_status_methodology_idx"
    ON "MarketListing"("status", "methodology");

-- Supports faceted search narrowed by both status and vintage year:
--   WHERE status = $1 AND vintageYear = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_status_vintageYear_idx"
    ON "MarketListing"("status", "vintageYear");

-- Supports faceted search narrowed by both status and country:
--   WHERE status = $1 AND country = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_status_country_idx"
    ON "MarketListing"("status", "country");

-- Supports the ABAC delist ownership check — verifying the caller owns the listing
-- before allowing a delist operation:
--   WHERE seller = $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_seller_idx"
    ON "MarketListing"("seller");

-- Supports project-scoped listing lookups (e.g. "all active listings for project X"):
--   WHERE projectId = $1 AND status = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_projectId_status_idx"
    ON "MarketListing"("projectId", "status");

-- Supports price-range queries combined with a status filter.
-- Note: pricePerCredit is stored as TEXT for full decimal precision; the
-- application casts to NUMERIC at query time.  The index on the raw TEXT column
-- eliminates rows by status before the expensive CAST, narrowing the scan:
--   WHERE status = $1 AND CAST(pricePerCredit AS NUMERIC) BETWEEN $2 AND $3
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_status_pricePerCredit_idx"
    ON "MarketListing"("status", "pricePerCredit");

-- ── RetirementRecord ─────────────────────────────────────────────────────────

-- Supports the retirement leaderboard query which groups retirements by
-- beneficiary and aggregates totals:
--   SELECT beneficiary, SUM(amount) … GROUP BY beneficiary
CREATE INDEX CONCURRENTLY IF NOT EXISTS "RetirementRecord_beneficiary_idx"
    ON "RetirementRecord"("beneficiary");

-- Supports the certificate generation worker that polls for retirements
-- whose certificate is pending or failed and requires processing:
--   WHERE certificateStatus = 'pending_certificate'
--   WHERE certificateStatus = 'failed'
CREATE INDEX CONCURRENTLY IF NOT EXISTS "RetirementRecord_certificateStatus_idx"
    ON "RetirementRecord"("certificateStatus");

-- ── CarbonProject ─────────────────────────────────────────────────────────────

-- Supports project_developer role scoping — fetching all projects owned by a
-- given address without a full-table scan:
--   WHERE ownerAddress = $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CarbonProject_ownerAddress_idx"
    ON "CarbonProject"("ownerAddress");
