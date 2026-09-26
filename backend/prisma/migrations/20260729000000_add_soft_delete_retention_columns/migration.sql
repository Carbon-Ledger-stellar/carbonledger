ALTER TABLE "CarbonProject"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionReason" TEXT,
  ADD COLUMN "retentionUntil" TIMESTAMP(3);

ALTER TABLE "User"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionReason" TEXT,
  ADD COLUMN "retentionUntil" TIMESTAMP(3);

CREATE INDEX "CarbonProject_deletedAt_idx" ON "CarbonProject"("deletedAt");
CREATE INDEX "CarbonProject_retentionUntil_idx" ON "CarbonProject"("retentionUntil");
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
CREATE INDEX "User_retentionUntil_idx" ON "User"("retentionUntil");
