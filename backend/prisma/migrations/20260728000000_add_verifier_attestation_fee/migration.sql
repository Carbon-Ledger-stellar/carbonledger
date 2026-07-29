-- Migration: add_verifier_attestation_fee
-- Adds the VerifierAttestationFee table, a ledger of per-attestation fees
-- charged when a verifier approves/rejects a project (see ProjectsService.verify/reject).
-- Each row's txHash is the identifier the verifier fee tracker links back to.

CREATE TABLE "VerifierAttestationFee" (
    "id"                TEXT NOT NULL,
    "verifierPublicKey" TEXT NOT NULL,
    "projectId"         TEXT NOT NULL,
    "decision"          TEXT NOT NULL,
    "feeStroops"        TEXT NOT NULL,
    "txHash"            TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifierAttestationFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerifierAttestationFee_txHash_key" ON "VerifierAttestationFee"("txHash");

CREATE INDEX "VerifierAttestationFee_verifierPublicKey_createdAt_idx"
    ON "VerifierAttestationFee"("verifierPublicKey", "createdAt");

CREATE INDEX "VerifierAttestationFee_projectId_idx" ON "VerifierAttestationFee"("projectId");
