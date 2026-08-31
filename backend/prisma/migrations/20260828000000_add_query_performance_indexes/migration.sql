-- Migration: add_query_performance_indexes
--
-- Adds composite indexes for the high-volume filtering and listing paths
-- documented in backend/docs/database-indexes.md. These indexes are additive:
-- they do not change table structure, constraints, or query behavior.
--
-- IF NOT EXISTS keeps deployment safe when an equivalent index was created
-- manually or is already present in a database restored from a newer schema.

-- Supports active project listings ordered by creation time:
--   WHERE status = $1 ORDER BY "createdAt" DESC
CREATE INDEX IF NOT EXISTS "CarbonProject_status_createdAt_idx"
    ON "CarbonProject"("status", "createdAt");

-- Supports project batch lookups scoped to an availability status:
--   WHERE "projectId" = $1 AND status = $2
CREATE INDEX IF NOT EXISTS "CreditBatch_projectId_status_idx"
    ON "CreditBatch"("projectId", "status");

-- Supports a wallet's retirement history ordered from newest to oldest:
--   WHERE "retiredBy" = $1 ORDER BY "retiredAt" DESC
CREATE INDEX IF NOT EXISTS "RetirementRecord_retiredBy_retiredAt_idx"
    ON "RetirementRecord"("retiredBy", "retiredAt");

-- Supports marketplace filters for one project and vintage/status combination:
--   WHERE "projectId" = $1 AND "vintageYear" = $2 AND status = $3
CREATE INDEX IF NOT EXISTS "MarketListing_projectId_vintageYear_status_idx"
    ON "MarketListing"("projectId", "vintageYear", "status");
