-- CreateTable SorobanSubmission
CREATE TABLE "SorobanSubmission" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SorobanSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable OracleUpdate
CREATE TABLE "OracleUpdate" (
    "id" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OracleUpdate_pkey" PRIMARY KEY ("id")
);

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
