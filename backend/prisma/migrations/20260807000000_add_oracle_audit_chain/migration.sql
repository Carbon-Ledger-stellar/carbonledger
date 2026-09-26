-- Migration: add_oracle_audit_chain (issue #577)
--
-- Tamper-evident audit log for every submission the oracle bridge makes to a
-- Soroban contract.  Each record carries the SHA-256 digest of the preceding
-- record, forming a chain an independent auditor can replay from genesis.
--
--   sequence       — contiguous chain position starting at 1.  A deleted record
--                    leaves a hole here, so removal is detectable on its own.
--   payload_hash   — SHA-256 over the canonical JSON of the submitted payload.
--   previous_hash  — entry_hash of the preceding record (NULL only for genesis).
--   entry_hash     — SHA-256 over the canonical field ordering plus previous_hash:
--                      sequence | recorded_at | service | contract_id |
--                      function_name | payload_hash | tx_hash | status | previous_hash
--
-- Written exclusively by oracle/audit_chain.py; verified by
-- oracle/verify_audit_chain.py.  Additive, new table — zero-downtime safe.
-- Table and column names are snake_case to match the other oracle-owned tables
-- the Python bridge writes to (oracle_submissions, oracle_failover_state).

CREATE TABLE IF NOT EXISTS "oracle_audit_chain" (
    "id"            BIGSERIAL    NOT NULL,
    "sequence"      BIGINT       NOT NULL,
    "recorded_at"   TIMESTAMPTZ  NOT NULL,
    "service"       VARCHAR(50)  NOT NULL,
    "contract_id"   VARCHAR(100),
    "function_name" VARCHAR(100) NOT NULL,
    "payload"       JSONB        NOT NULL,
    "payload_hash"  CHAR(64)     NOT NULL,
    "tx_hash"       VARCHAR(200),
    "status"        VARCHAR(20)  NOT NULL,
    "previous_hash" CHAR(64),
    "entry_hash"    CHAR(64)     NOT NULL,

    CONSTRAINT "oracle_audit_chain_pkey" PRIMARY KEY ("id")
);

-- Chain position and entry digest are both unique: two records can never claim
-- the same slot, and a replayed record cannot be appended twice.
CREATE UNIQUE INDEX IF NOT EXISTS "oracle_audit_chain_sequence_key"
    ON "oracle_audit_chain"("sequence");

CREATE UNIQUE INDEX IF NOT EXISTS "oracle_audit_chain_entry_hash_key"
    ON "oracle_audit_chain"("entry_hash");

CREATE INDEX IF NOT EXISTS "oracle_audit_chain_recorded_at_idx"
    ON "oracle_audit_chain"("recorded_at");

CREATE INDEX IF NOT EXISTS "oracle_audit_chain_function_name_idx"
    ON "oracle_audit_chain"("function_name");

-- Supports walking backwards from any record to its predecessor.
CREATE INDEX IF NOT EXISTS "oracle_audit_chain_previous_hash_idx"
    ON "oracle_audit_chain"("previous_hash");

COMMENT ON TABLE "oracle_audit_chain"
  IS 'Hash-chained, tamper-evident log of all oracle submissions to Soroban contracts (#577). Append-only: rows must never be updated or deleted.';
