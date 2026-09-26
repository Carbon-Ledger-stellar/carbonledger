-- Migration: add_audit_hash_chain
--
-- Adds hash-chaining fields to the AuditLog table so that any tampering
-- (deletion, insertion, or modification of an entry) is detectable.
--
-- previousHash  — SHA-256 hex digest of the preceding entry's entryHash,
--                 NULL for the very first entry in the chain.
-- entryHash     — SHA-256 hex digest over the canonical entry payload:
--                 id | userId | action | resourceId | ipAddress | result |
--                 metadata | timestamp | previousHash
--
-- Both columns are nullable to preserve backwards compatibility with rows
-- written before this migration; new rows must always have both values set.
-- The index on entryHash enables fast integrity walks.

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "previousHash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "entryHash"    TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_entryHash_idx" ON "AuditLog"("entryHash");
