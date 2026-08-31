-- Migration: 20260831000000_add_audit_logs_table
-- Issue #1022: Add Database Migration for Audit Log Table
--
-- Creates the audit_logs table to track all sensitive operations:
-- user deletions, role changes, admin actions, and other high-sensitivity
-- mutations. This table is distinct from the general-purpose "AuditLog"
-- table: it follows snake_case conventions, enforces a mandatory
-- resource_type/resource_id pair for structured querying, and stores all
-- extra context in a single details JSONB column rather than separate
-- before/after/metadata columns.
--
-- ── Schema ────────────────────────────────────────────────────────────────
--   id            — CUID primary key
--   actor_id      — Stellar public key (G…) of the acting user; NULL for
--                   system-generated events
--   action        — Dot-namespaced verb, e.g. "user.role_change",
--                   "project.delete", "credit.mint"
--   resource_type — Entity kind, e.g. "User", "CarbonProject", "CreditBatch"
--   resource_id   — Primary-key value of the affected entity
--   details       — JSONB payload: before/after state, reason, IP, etc.
--   timestamp     — Set by the database at insert time; never client-supplied
--
-- ── Backwards compatibility ───────────────────────────────────────────────
-- This is a pure CREATE TABLE / CREATE INDEX operation. No existing table,
-- column, or index is modified or removed. Rolling back (down migration)
-- simply drops the table and all its indexes — no data in any other table
-- is affected.
--
-- ── Up ────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_logs" (
    "id"            TEXT                     NOT NULL,
    "actor_id"      TEXT,
    "action"        TEXT                     NOT NULL,
    "resource_type" TEXT                     NOT NULL,
    "resource_id"   TEXT                     NOT NULL,
    "details"       JSONB                    NOT NULL DEFAULT '{}',
    "timestamp"     TIMESTAMPTZ(6)           NOT NULL DEFAULT NOW(),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- actor_id: list all actions performed by a given user
CREATE INDEX "audit_logs_actor_id_idx"
    ON "audit_logs"("actor_id");

-- action: filter by operation type (e.g. all "user.role_change" events)
CREATE INDEX "audit_logs_action_idx"
    ON "audit_logs"("action");

-- resource_type + resource_id: fetch the full history of one entity
CREATE INDEX "audit_logs_resource_type_resource_id_idx"
    ON "audit_logs"("resource_type", "resource_id");

-- timestamp: time-range queries and pagination ordering
CREATE INDEX "audit_logs_timestamp_idx"
    ON "audit_logs"("timestamp");

-- actor_id + timestamp: user activity timeline, ordered by time
CREATE INDEX "audit_logs_actor_id_timestamp_idx"
    ON "audit_logs"("actor_id", "timestamp");

-- resource_type + resource_id + timestamp: ordered entity history
-- (covering index for the most common compliance query pattern)
CREATE INDEX "audit_logs_resource_type_resource_id_timestamp_idx"
    ON "audit_logs"("resource_type", "resource_id", "timestamp");
