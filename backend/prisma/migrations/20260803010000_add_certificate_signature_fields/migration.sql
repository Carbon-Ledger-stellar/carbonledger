-- Adds Ed25519 issuer-signature fields to RetirementCertificate (#594).
-- All three columns are nullable additive columns — safe to deploy without
-- a backfill or dual-write phase; existing rows simply have NULL until the
-- next certificate is (re)generated.

ALTER TABLE "RetirementCertificate"
  ADD COLUMN IF NOT EXISTS "contentHash"     TEXT,
  ADD COLUMN IF NOT EXISTS "issuerSignature" TEXT,
  ADD COLUMN IF NOT EXISTS "issuerPublicKey" TEXT;
