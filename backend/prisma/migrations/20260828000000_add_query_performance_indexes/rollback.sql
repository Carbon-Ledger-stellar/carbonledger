-- Rollback: 20260828000000_add_query_performance_indexes
--
-- Removes only the non-data indexes introduced by this migration.
-- Use the PostgreSQL client outside a transaction when running CONCURRENTLY.

DROP INDEX CONCURRENTLY IF EXISTS "CarbonProject_status_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "CreditBatch_projectId_status_idx";
DROP INDEX CONCURRENTLY IF EXISTS "RetirementRecord_retiredBy_retiredAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "MarketListing_projectId_vintageYear_status_idx";
