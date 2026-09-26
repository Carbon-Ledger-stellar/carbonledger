DROP INDEX IF EXISTS "AuditLog_resourceId_timestamp_idx";
DROP INDEX IF EXISTS "AuditLog_userId_timestamp_idx";

ALTER TABLE "AuditLog"
  DROP COLUMN IF EXISTS "before",
  DROP COLUMN IF EXISTS "after",
  DROP COLUMN IF EXISTS "txHash";