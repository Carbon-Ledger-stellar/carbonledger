-- CreateTable
CREATE TABLE "ZkRetirementProof" (
    "id" TEXT NOT NULL,
    "retirementId" TEXT NOT NULL,
    "beneficiaryCommitment" TEXT NOT NULL,
    "nullifier" TEXT NOT NULL,
    "retiredByHash" TEXT NOT NULL,
    "proofJson" JSONB NOT NULL,
    "publicSignals" JSONB NOT NULL,
    "verifiedOnChain" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZkRetirementProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZkRetirementProof_nullifier_key" ON "ZkRetirementProof"("nullifier");

-- CreateIndex
CREATE INDEX "ZkRetirementProof_retirementId_idx" ON "ZkRetirementProof"("retirementId");

-- CreateIndex
CREATE INDEX "ZkRetirementProof_retiredByHash_idx" ON "ZkRetirementProof"("retiredByHash");

-- AddForeignKey
ALTER TABLE "ZkRetirementProof" ADD CONSTRAINT "ZkRetirementProof_retirementId_fkey" FOREIGN KEY ("retirementId") REFERENCES "RetirementRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
