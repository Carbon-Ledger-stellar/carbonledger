-- Rollback: 20260716000000_add_idempotency_record
--
-- Drops the IdempotencyRecord table introduced by add_idempotency_record/migration.sql.
--
-- WARNING: This is destructive — in-flight idempotency records will be lost,
-- meaning duplicate requests that arrived during/after the rollback may be
-- processed more than once. Ensure no retried requests are in flight before
-- applying this rollback.

DROP TABLE IF EXISTS "IdempotencyRecord";
