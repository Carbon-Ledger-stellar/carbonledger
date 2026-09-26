-- Zero-downtime migration example: Phase 2 (Contract – enforce NOT NULL)
-- Scenario A: Rename RetirementRecord.retirementReason -> RetirementRecord.reason
--
-- Run this ONLY after:
--   1. The Phase 1 expand migration has been applied.
--   2. The backfill is complete (SELECT COUNT(*) FROM "RetirementRecord" WHERE "reason" IS NULL = 0).
--   3. The cutover application code has been deployed and is stable.
--
-- This step makes the new column required, matching the constraint on the old column.

-- Verify backfill is complete before proceeding; this will fail if any NULL rows remain.
-- If it fails, re-run the backfill script and try again.
ALTER TABLE "RetirementRecord"
  ALTER COLUMN "reason" SET NOT NULL;
