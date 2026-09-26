-- CreateTable
CREATE TABLE "ProcessedLedgerRange" (
    "id" SERIAL NOT NULL,
    "startLedger" INTEGER NOT NULL,
    "endLedger" INTEGER NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedLedgerRange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedLedgerRange_startLedger_endLedger_key" ON "ProcessedLedgerRange"("startLedger", "endLedger");

-- CreateIndex
CREATE INDEX "ProcessedLedgerRange_startLedger_idx" ON "ProcessedLedgerRange"("startLedger");

-- CreateIndex
CREATE INDEX "ProcessedLedgerRange_endLedger_idx" ON "ProcessedLedgerRange"("endLedger");
