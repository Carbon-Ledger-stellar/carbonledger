-- Zero-downtime migration example: Phase 1 (Expand)
-- Scenario A: Rename RetirementRecord.retirementReason -> RetirementRecord.reason
--
-- This is the EXPAND step. We add the new column alongside the old one.
-- Both old and new application versions are compatible with this schema.
-- The old column remains NOT NULL with all its existing data intact.
-- The new column is nullable so it can be populated during the backfill step.
--
-- Deploy order:
--   1. Run this migration  (this file)
--   2. Deploy dual-read application code  (reads new column, falls back to old)
--   3. Run backfill: UPDATE "RetirementRecord" SET "reason" = "retirementReason" WHERE "reason" IS NULL
--   4. Deploy cutover code  (reads only new column)
--   5. Run Phase 2 migration to add NOT NULL constraint
--   6. Run Phase 3 cleanup migration to drop old column (allow-destructive)

ALTER TABLE "RetirementRecord"
  ADD COLUMN IF NOT EXISTS "reason" TEXT;

COMMENT ON COLUMN "RetirementRecord"."reason"
  IS 'Canonical replacement for retirementReason (zero-downtime rename — Phase 1 expand)';

CREATE INDEX IF NOT EXISTS "RetirementRecord_reason_idx"
  ON "RetirementRecord"("reason");
