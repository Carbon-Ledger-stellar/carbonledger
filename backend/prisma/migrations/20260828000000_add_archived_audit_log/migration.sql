-- Migration: 20260828000000_add_archived_audit_log
-- Issue #1074: Ledger Data Compression
--
-- Creates the archived_audit_logs table to store gzip-compressed AuditLog
-- entries older than 6 months. The full entry (including hash chain fields
-- previousHash and entryHash) is stored as gzip-compressed JSON in
-- compressed_data so the audit trail remains verifiable.
--
-- Indexes on (original_id, timestamp, user_id) deduplicate storage and
-- preserve query performance for historical lookups.

CREATE TABLE "archived_audit_logs" (
    "id"               TEXT         NOT NULL,
    "original_id"      TEXT         NOT NULL,
    "user_id"          TEXT,
    "action"           TEXT         NOT NULL,
    "resource_id"      TEXT,
    "ip_address"       TEXT,
    "result"           TEXT,
    "compressed_data"  BYTEA        NOT NULL,
    "timestamp"        TIMESTAMPTZ  NOT NULL,
    "archived_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "compression_type" TEXT         NOT NULL DEFAULT 'gzip',
    "size_original"    INTEGER      NOT NULL,
    "size_compressed"  INTEGER      NOT NULL,

    CONSTRAINT "archived_audit_logs_pkey" PRIMARY KEY ("id")
);

-- Deduplication: each original AuditLog row is archived exactly once
CREATE UNIQUE INDEX "archived_audit_logs_original_id_key"
    ON "archived_audit_logs"("original_id");

-- Support time-range queries over historical data
CREATE INDEX "archived_audit_logs_timestamp_idx"
    ON "archived_audit_logs"("timestamp");

-- Support user-scoped queries without full-table decompression
CREATE INDEX "archived_audit_logs_user_id_idx"
    ON "archived_audit_logs"("user_id");

-- Support action-scoped queries
CREATE INDEX "archived_audit_logs_action_idx"
    ON "archived_audit_logs"("action");

-- Support resource-scoped lookups
CREATE INDEX "archived_audit_logs_resource_id_idx"
    ON "archived_audit_logs"("resource_id");

-- Support archival-time queries (e.g. "what was archived today?")
CREATE INDEX "archived_audit_logs_archived_at_idx"
    ON "archived_audit_logs"("archived_at");
