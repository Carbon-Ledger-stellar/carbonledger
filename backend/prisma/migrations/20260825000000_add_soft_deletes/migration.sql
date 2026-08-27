ALTER TABLE "CreditBatch" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "CreditBatch_deletedAt_idx" ON "CreditBatch"("deletedAt");

ALTER TABLE "MarketListing" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "MarketListing_deletedAt_idx" ON "MarketListing"("deletedAt");

ALTER TABLE "RetirementRecord" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "RetirementRecord_deletedAt_idx" ON "RetirementRecord"("deletedAt");
