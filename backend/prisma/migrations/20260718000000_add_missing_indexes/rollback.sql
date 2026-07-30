-- Rollback: 20260718000000_add_missing_indexes
--
-- Drops the three indexes added by add_missing_indexes/migration.sql.
-- These are non-critical performance indexes so dropping them causes no
-- data loss; queries will degrade to full table scans until they are
-- re-created.
--
-- Safety:
--   DROP INDEX CONCURRENTLY does not lock the table on PostgreSQL 9.2+.
--   Use this rollback only if you are on PostgreSQL 9.2 or later.
--   On older versions, replace DROP INDEX CONCURRENTLY with DROP INDEX.

DROP INDEX CONCURRENTLY IF EXISTS "RetirementRecord_projectId_retiredAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "CreditBatch_projectId_vintageYear_status_idx";
DROP INDEX CONCURRENTLY IF EXISTS "MarketListing_methodology_vintageYear_status_pricePerCredit_idx";
