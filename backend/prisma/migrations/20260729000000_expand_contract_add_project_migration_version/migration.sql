-- Expand-contract migration example: add an optional migration marker.
ALTER TABLE "CarbonProject" ADD COLUMN IF NOT EXISTS "migrationVersion" TEXT;
CREATE INDEX IF NOT EXISTS "CarbonProject_migrationVersion_idx" ON "CarbonProject"("migrationVersion");
