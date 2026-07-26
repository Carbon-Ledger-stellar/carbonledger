-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "CarbonProject" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "methodology" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "vintageYear" INTEGER NOT NULL,
    "methodologyScore" INTEGER NOT NULL,
    "totalCreditsIssued" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCreditsRetired" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "metadataCid" TEXT NOT NULL,
    "verifierAddress" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "coordinates" JSONB,
    "lastMonitoringAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarbonProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditBatch" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vintageYear" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "serialStart" TEXT NOT NULL,
    "serialEnd" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "metadataCid" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetirementRecord" (
    "id" TEXT NOT NULL,
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
    "serialNumbers" TEXT[],
    "txHash" TEXT NOT NULL,
    "certificateCid" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "validatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetirementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetirementCertificate" (
    "id" TEXT NOT NULL,
    "retirementId" TEXT NOT NULL,
    "beneficiary" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "projectName" TEXT NOT NULL,
    "vintageYear" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "ipfsCid" TEXT,
    "publicUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetirementCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketListing" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "amountAvailable" DECIMAL(18,2) NOT NULL,
    "pricePerCredit" TEXT NOT NULL,
    "vintageYear" INTEGER NOT NULL,
    "methodology" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringData" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "tonnesVerified" DECIMAL(18,2) NOT NULL,
    "methodologyScore" INTEGER NOT NULL,
    "satelliteCid" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OracleSyncState" (
    "id" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedBlock" INTEGER NOT NULL DEFAULT 0,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'idle',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OracleSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'corporation',
    "isSubscribed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectApproved" BOOLEAN NOT NULL DEFAULT true,
    "creditsMinted" BOOLEAN NOT NULL DEFAULT true,
    "purchaseConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "retirementConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "error" TEXT,
    "txHash" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "result" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncMetadata" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastIndexedLedger" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IPFSFile" (
    "id" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "pinStatus" TEXT NOT NULL DEFAULT 'pending',
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pinnedAt" TIMESTAMP(3),
    "projectId" TEXT,
    "batchId" TEXT,
    "retirementId" TEXT,

    CONSTRAINT "IPFSFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierApplication" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "accreditationBody" TEXT NOT NULL,
    "accreditationId" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "documentsCid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifierApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceApproval" (
    "id" TEXT NOT NULL,
    "methodology" TEXT NOT NULL,
    "vintageYear" INTEGER NOT NULL,
    "priceStroops" TEXT NOT NULL,
    "deviation" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditEvent" (
    "id" TEXT NOT NULL,
    "creditBatchId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "oldState" JSONB,
    "newState" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,

    CONSTRAINT "CreditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarbonProject_projectId_key" ON "CarbonProject"("projectId");

-- CreateIndex
CREATE INDEX "CarbonProject_methodology_idx" ON "CarbonProject"("methodology");

-- CreateIndex
CREATE INDEX "CarbonProject_country_idx" ON "CarbonProject"("country");

-- CreateIndex
CREATE INDEX "CarbonProject_status_idx" ON "CarbonProject"("status");

-- CreateIndex
CREATE INDEX "CarbonProject_vintageYear_idx" ON "CarbonProject"("vintageYear");

-- CreateIndex
CREATE INDEX "CarbonProject_createdAt_idx" ON "CarbonProject"("createdAt");

-- CreateIndex
CREATE INDEX "CarbonProject_methodology_country_status_idx" ON "CarbonProject"("methodology", "country", "status");

-- CreateIndex
CREATE INDEX "CarbonProject_lastMonitoringAt_idx" ON "CarbonProject"("lastMonitoringAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditBatch_batchId_key" ON "CreditBatch"("batchId");

-- CreateIndex
CREATE INDEX "CreditBatch_projectId_vintageYear_status_idx" ON "CreditBatch"("projectId", "vintageYear", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RetirementRecord_retirementId_key" ON "RetirementRecord"("retirementId");

-- CreateIndex
CREATE INDEX "RetirementRecord_projectId_retiredAt_idx" ON "RetirementRecord"("projectId", "retiredAt");

-- CreateIndex
CREATE INDEX "RetirementCertificate_retirementId_idx" ON "RetirementCertificate"("retirementId");

-- CreateIndex
CREATE INDEX "RetirementCertificate_beneficiary_idx" ON "RetirementCertificate"("beneficiary");

-- CreateIndex
CREATE INDEX "RetirementCertificate_vintageYear_idx" ON "RetirementCertificate"("vintageYear");

-- CreateIndex
CREATE UNIQUE INDEX "MarketListing_listingId_key" ON "MarketListing"("listingId");

-- CreateIndex
CREATE INDEX "MarketListing_methodology_vintageYear_status_pricePerCredit_idx" ON "MarketListing"("methodology", "vintageYear", "status", "pricePerCredit");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringData_projectId_period_key" ON "MonitoringData"("projectId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "OracleJob_idempotencyKey_key" ON "OracleJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OracleJob_status_idx" ON "OracleJob"("status");

-- CreateIndex
CREATE INDEX "OracleJob_projectId_idx" ON "OracleJob"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "OracleSyncState_id_key" ON "OracleSyncState"("id");

-- CreateIndex
CREATE UNIQUE INDEX "User_publicKey_key" ON "User"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "EmailLog_to_idx" ON "EmailLog"("to");

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_resourceId_idx" ON "AuditLog"("resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "Job_queue_status_idx" ON "Job"("queue", "status");

-- CreateIndex
CREATE INDEX "Job_type_idx" ON "Job"("type");

-- CreateIndex
CREATE INDEX "IPFSFile_cid_idx" ON "IPFSFile"("cid");

-- CreateIndex
CREATE INDEX "IPFSFile_pinStatus_idx" ON "IPFSFile"("pinStatus");

-- CreateIndex
CREATE UNIQUE INDEX "VerifierApplication_publicKey_key" ON "VerifierApplication"("publicKey");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_idempotencyKey_endpoint_key" ON "IdempotencyRecord"("idempotencyKey", "endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "ApiKey_key_idx" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "SorobanSubmission_contractId_idx" ON "SorobanSubmission"("contractId");

-- CreateIndex
CREATE INDEX "SorobanSubmission_status_idx" ON "SorobanSubmission"("status");

-- CreateIndex
CREATE INDEX "SorobanSubmission_createdAt_idx" ON "SorobanSubmission"("createdAt");

-- CreateIndex
CREATE INDEX "OracleUpdate_dataType_idx" ON "OracleUpdate"("dataType");

-- CreateIndex
CREATE INDEX "OracleUpdate_success_idx" ON "OracleUpdate"("success");

-- CreateIndex
CREATE INDEX "OracleUpdate_createdAt_idx" ON "OracleUpdate"("createdAt");

-- CreateIndex
CREATE INDEX "CreditEvent_creditBatchId_idx" ON "CreditEvent"("creditBatchId");

-- CreateIndex
CREATE INDEX "CreditEvent_timestamp_idx" ON "CreditEvent"("timestamp");

-- AddForeignKey
ALTER TABLE "CreditBatch" ADD CONSTRAINT "CreditBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CarbonProject"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementRecord" ADD CONSTRAINT "RetirementRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CreditBatch"("batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementRecord" ADD CONSTRAINT "RetirementRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CarbonProject"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementCertificate" ADD CONSTRAINT "RetirementCertificate_retirementId_fkey" FOREIGN KEY ("retirementId") REFERENCES "RetirementRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CarbonProject"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CreditBatch"("batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringData" ADD CONSTRAINT "MonitoringData_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CarbonProject"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IPFSFile" ADD CONSTRAINT "IPFSFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CarbonProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IPFSFile" ADD CONSTRAINT "IPFSFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CreditBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IPFSFile" ADD CONSTRAINT "IPFSFile_retirementId_fkey" FOREIGN KEY ("retirementId") REFERENCES "RetirementRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

