-- Zero-downtime migration example: Phase 1 (Expand)
-- Scenario B: Split CarbonProject.projectType (comma-separated TEXT) into a
--             normalized ProjectType join table.
--
-- This is the EXPAND step. We create the new table while leaving the old
-- CarbonProject.projectType TEXT column completely untouched.
--
-- Deploy order:
--   1. Run this migration  (this file)
--   2. Deploy dual-read application code (writes to both old field and new table;
--      reads from new table with fallback to splitting the old field)
--   3. Run backfill: parse each project's projectType string and insert ProjectType rows
--   4. Deploy cutover code  (reads only from ProjectType table)
--   5. Run Phase 2 cleanup migration to drop projectType column (allow-destructive)

CREATE TABLE IF NOT EXISTS "ProjectType" (
  "id"        TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "typeCode"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectType_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "CarbonProject"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProjectType_projectId_idx"
  ON "ProjectType"("projectId");

-- Unique constraint prevents duplicate type codes per project during backfill re-runs
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectType_projectId_typeCode_key"
  ON "ProjectType"("projectId", "typeCode");

COMMENT ON TABLE "ProjectType"
  IS 'Normalized project type codes. Replaces CarbonProject.projectType (zero-downtime split — Phase 1 expand)';
