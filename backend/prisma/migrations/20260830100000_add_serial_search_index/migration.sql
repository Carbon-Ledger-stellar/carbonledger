-- Add search indexes on CreditBatch serial range fields
CREATE INDEX IF NOT EXISTS "CreditBatch_serialStart_idx" ON "CreditBatch"("serialStart");
CREATE INDEX IF NOT EXISTS "CreditBatch_serialEnd_idx" ON "CreditBatch"("serialEnd");
CREATE INDEX IF NOT EXISTS "CreditBatch_serialStart_serialEnd_idx" ON "CreditBatch"("serialStart", "serialEnd");
-- Text search index for partial serial matching on projectId field
CREATE INDEX IF NOT EXISTS "CreditBatch_batchId_idx" ON "CreditBatch"("batchId");
