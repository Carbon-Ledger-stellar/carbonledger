-- CreateTable OracleJob (idempotent oracle submission queue)
CREATE TABLE "OracleJob" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "projectId" TEXT,
    "period" TEXT,
    "tonnesVerified" DECIMAL(18,2),
    "methodologyScore" INTEGER,
    "methodology" TEXT,
    "vintageYear" INTEGER,
    "priceUsdc" TEXT,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OracleJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OracleJob_idempotencyKey_key" ON "OracleJob"("idempotencyKey");
CREATE INDEX "OracleJob_status_idx" ON "OracleJob"("status");
CREATE INDEX "OracleJob_projectId_idx" ON "OracleJob"("projectId");
