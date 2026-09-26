-- Expand-contract migration example: add an optional legacy status field.
ALTER TABLE "RetirementRecord" ADD COLUMN IF NOT EXISTS "legacyStatus" TEXT;
CREATE INDEX IF NOT EXISTS "RetirementRecord_legacyStatus_idx" ON "RetirementRecord"("legacyStatus");
