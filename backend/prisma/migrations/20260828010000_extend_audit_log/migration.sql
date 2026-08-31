-- Add state snapshots and transaction references to the existing audit trail.
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "before" JSONB,
  ADD COLUMN IF NOT EXISTS "after" JSONB,
  ADD COLUMN IF NOT EXISTS "txHash" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_resourceId_timestamp_idx"
  ON "AuditLog"("resourceId", "timestamp");

CREATE INDEX IF NOT EXISTS "AuditLog_userId_timestamp_idx"
  ON "AuditLog"("userId", "timestamp");