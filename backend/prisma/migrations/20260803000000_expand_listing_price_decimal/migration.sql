-- Zero-downtime migration example: Phase 1 (Expand)
-- Scenario C: Change MarketListing.pricePerCredit from TEXT to DECIMAL(18,8)
--
-- PostgreSQL cannot safely cast an arbitrary TEXT column to DECIMAL in a single
-- ALTER COLUMN statement when the format is application-controlled.  Instead we
-- add a new typed column alongside the old one and migrate data gradually.
--
-- Deploy order:
--   1. Run this migration  (this file)
--   2. Deploy dual-read application code (writes to both columns;
--      reads prefer pricePerCreditDecimal, fall back to parsing pricePerCredit)
--   3. Run backfill:
--        UPDATE "MarketListing"
--        SET "pricePerCreditDecimal" = "pricePerCredit"::DECIMAL(18,8)
--        WHERE "pricePerCreditDecimal" IS NULL AND id > $cursor
--        LIMIT 500
--      Log rows where the cast fails — they require manual review.
--   4. Deploy cutover code (reads only pricePerCreditDecimal)
--   5. Run Phase 2 migration to set NOT NULL on the new column
--   6. Run Phase 3 cleanup migration to drop and rename (allow-destructive)

ALTER TABLE "MarketListing"
  ADD COLUMN IF NOT EXISTS "pricePerCreditDecimal" DECIMAL(18, 8);

COMMENT ON COLUMN "MarketListing"."pricePerCreditDecimal"
  IS 'Typed replacement for pricePerCredit TEXT field (zero-downtime type change — Phase 1 expand)';

-- Use CONCURRENTLY to avoid table lock on large listings table.
-- NOTE: CONCURRENTLY cannot run inside a transaction.
-- Run this statement manually outside of prisma migrate deploy if the table is large:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_pricePerCreditDecimal_idx"
--     ON "MarketListing"("pricePerCreditDecimal");
CREATE INDEX IF NOT EXISTS "MarketListing_pricePerCreditDecimal_idx"
  ON "MarketListing"("pricePerCreditDecimal");
