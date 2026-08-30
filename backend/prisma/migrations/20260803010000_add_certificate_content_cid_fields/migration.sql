-- Adds IPFS content-CID and content-hash fields to RetirementRecord (#600),
-- so the certificate PDF can embed a self-referential link to its pinned
-- JSON content, and GET /certificates/:cid/verify can detect tampering.
-- Both columns are nullable additive columns — safe to deploy without a
-- backfill; existing rows simply have NULL until the next certificate is
-- (re)generated.

ALTER TABLE "RetirementRecord"
  ADD COLUMN IF NOT EXISTS "certificateContentCid"  TEXT,
  ADD COLUMN IF NOT EXISTS "certificateContentHash" TEXT;

CREATE INDEX IF NOT EXISTS "RetirementRecord_certificateContentCid_idx"
  ON "RetirementRecord"("certificateContentCid");
