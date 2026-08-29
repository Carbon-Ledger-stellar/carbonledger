-- Migration: 20260727000000_add_retirement_txhash_unique
-- Feature: #568 — Replay attack protection for retirement flow
--
-- Adds a UNIQUE constraint on RetirementRecord.txHash so that each Stellar
-- transaction hash can only be associated with a single retirement record.
--
-- This prevents:
--  1. Two different wallets submitting the same txHash to generate two
--     retirement certificates from one on-chain transaction (Scenario A).
--  2. Race conditions where two concurrent requests both pass the service-
--     layer findFirst check before either commits (Scenario B).
--
-- The constraint is added with IF NOT EXISTS so it is safe to re-run.

CREATE UNIQUE INDEX IF NOT EXISTS "RetirementRecord_txHash_key"
  ON "RetirementRecord"("txHash");
