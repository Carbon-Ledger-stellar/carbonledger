-- Migration: add serial range check constraints to CreditBatch
-- Prevents invalid serial ranges at the database level.
-- Enforces:
--   1. serialStart >= 1                    (zero or negative start is invalid)
--   2. serialEnd   > serialStart           (range must span at least one credit)
--   3. serialEnd   <= 18446744073709551615  (u64::MAX — matches Soroban contract limit)
-- Both columns are TEXT storing non-negative integer strings, so we cast to NUMERIC
-- for correct numeric comparison (avoids lexicographic mis-ordering of different lengths).

ALTER TABLE "CreditBatch"
  ADD CONSTRAINT "CreditBatch_serial_range_valid"
  CHECK (
    "serialStart"::NUMERIC >= 1
    AND "serialEnd"::NUMERIC > "serialStart"::NUMERIC
    AND "serialEnd"::NUMERIC <= 18446744073709551615
  );
