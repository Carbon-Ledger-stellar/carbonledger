-- Add temporal columns to CarbonProject for system-versioned temporal tables
ALTER TABLE "CarbonProject" ADD COLUMN "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CarbonProject" ADD COLUMN "ended_at" TIMESTAMP(3);

-- Add temporal columns to CreditBatch for complete history tracking
ALTER TABLE "CreditBatch" ADD COLUMN "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CreditBatch" ADD COLUMN "ended_at" TIMESTAMP(3);

-- Add temporal columns to RetirementRecord for audit trail
ALTER TABLE "RetirementRecord" ADD COLUMN "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RetirementRecord" ADD COLUMN "ended_at" TIMESTAMP(3);

-- Create history table for CarbonProject
CREATE TABLE "CarbonProjectHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "methodology" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "projectType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "vintageYear" INTEGER NOT NULL,
  "methodologyScore" INTEGER NOT NULL,
  "totalCreditsIssued" DECIMAL(18,2) NOT NULL,
  "totalCreditsRetired" DECIMAL(18,2) NOT NULL,
  "verifierAddress" TEXT NOT NULL,
  "ownerAddress" TEXT NOT NULL,
  "coordinates" JSONB,
  "migrationVersion" TEXT,
  "lastMonitoringAt" TIMESTAMP(3),
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletionReason" TEXT,
  "retentionUntil" TIMESTAMP(3)
);

-- Create history table for CreditBatch
CREATE TABLE "CreditBatchHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "vintageYear" INTEGER NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "serialStart" TEXT NOT NULL,
  "serialEnd" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "metadataCid" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "issuedAt" TIMESTAMPTZ NOT NULL,
  "deletedAt" TIMESTAMP(3)
);

-- Create history table for RetirementRecord
CREATE TABLE "RetirementRecordHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "retirementId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "retiredBy" TEXT NOT NULL,
  "beneficiary" TEXT NOT NULL,
  "retirementReason" TEXT NOT NULL,
  "vintageYear" INTEGER NOT NULL,
  "serialStart" TEXT NOT NULL,
  "serialEnd" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "txHash" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3)
);

-- Create indexes for efficient temporal queries
CREATE INDEX "idx_CarbonProjectHistory_projectId_started_at" ON "CarbonProjectHistory"("projectId", "started_at");
CREATE INDEX "idx_CarbonProjectHistory_started_at_ended_at" ON "CarbonProjectHistory"("started_at", "ended_at");
CREATE INDEX "idx_CarbonProjectHistory_ended_at" ON "CarbonProjectHistory"("ended_at") WHERE "ended_at" IS NOT NULL;

CREATE INDEX "idx_CreditBatchHistory_batchId_started_at" ON "CreditBatchHistory"("batchId", "started_at");
CREATE INDEX "idx_CreditBatchHistory_projectId_started_at" ON "CreditBatchHistory"("projectId", "started_at");
CREATE INDEX "idx_CreditBatchHistory_ended_at" ON "CreditBatchHistory"("ended_at") WHERE "ended_at" IS NOT NULL;

CREATE INDEX "idx_RetirementRecordHistory_retirementId_started_at" ON "RetirementRecordHistory"("retirementId", "started_at");
CREATE INDEX "idx_RetirementRecordHistory_projectId_started_at" ON "RetirementRecordHistory"("projectId", "started_at");
CREATE INDEX "idx_RetirementRecordHistory_ended_at" ON "RetirementRecordHistory"("ended_at") WHERE "ended_at" IS NOT NULL;
