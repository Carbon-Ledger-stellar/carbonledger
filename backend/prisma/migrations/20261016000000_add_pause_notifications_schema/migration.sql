-- Migration: 20261016000000_add_pause_notifications_schema
-- Issue #1234: Comprehensive Prisma migration for all pause-related schema changes.
--
-- Online migration strategy:
--   1. All new tables are pure CREATE TABLE — no existing table is altered.
--   2. All new columns on existing tables use DEFAULT / nullable so old rows are
--      still valid during a rolling deploy.
--   3. All indexes use CREATE INDEX CONCURRENTLY so they build without a table
--      lock on large datasets.
--   4. Rollback: DROP the two new tables; existing tables are unchanged.
--
-- Zero-downtime guarantee: every DDL statement in this file is safe to run
-- against a live production PostgreSQL database with concurrent readers and
-- writers. No LOCK is acquired beyond the minimal row-level locks taken
-- automatically by PostgreSQL on INSERT/UPDATE.

-- ── ContractSyncState ─────────────────────────────────────────────────────
-- Tracks the last time each Soroban contract was polled for pause status,
-- the cached is_paused value, and operational sync metadata.
-- One row per contract (identified by contractId / contractName).

CREATE TABLE "contract_sync_state" (
    "id"              TEXT         NOT NULL,
    "contractId"      TEXT         NOT NULL,
    "contractName"    TEXT         NOT NULL,
    "isPaused"        BOOLEAN      NOT NULL DEFAULT false,
    "pauseReason"     TEXT,
    "pausedUntil"     TIMESTAMP(3),
    "lastSyncedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError"       TEXT,
    "lastErrorAt"     TIMESTAMP(3),
    "syncStatus"      TEXT         NOT NULL DEFAULT 'idle',
    "consecutiveErrors" INTEGER    NOT NULL DEFAULT 0,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_sync_state_pkey" PRIMARY KEY ("id")
);

-- Unique per contract
CREATE UNIQUE INDEX CONCURRENTLY "contract_sync_state_contractId_key"
    ON "contract_sync_state"("contractId");

CREATE INDEX CONCURRENTLY "contract_sync_state_contractName_idx"
    ON "contract_sync_state"("contractName");

CREATE INDEX CONCURRENTLY "contract_sync_state_isPaused_idx"
    ON "contract_sync_state"("isPaused");

CREATE INDEX CONCURRENTLY "contract_sync_state_lastSyncedAt_idx"
    ON "contract_sync_state"("lastSyncedAt");

-- ── PauseAlertLog ─────────────────────────────────────────────────────────
-- Records every alert dispatched (email / Slack / webhook) for a
-- pause/unpause event. Used to enforce per-contract cooldown windows and
-- provide an audit trail of ops notifications.

CREATE TABLE "pause_alert_log" (
    "id"            TEXT         NOT NULL,
    "contractId"    TEXT         NOT NULL,
    "contractName"  TEXT         NOT NULL,
    "action"        TEXT         NOT NULL,   -- 'pause' | 'unpause'
    "channel"       TEXT         NOT NULL,   -- 'email' | 'slack' | 'webhook'
    "recipient"     TEXT,
    "reason"        TEXT,
    "pausedUntil"   TIMESTAMP(3),
    "status"        TEXT         NOT NULL DEFAULT 'sent',  -- 'sent' | 'failed' | 'skipped_cooldown'
    "error"         TEXT,
    "sentAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pause_alert_log_pkey" PRIMARY KEY ("id")
);

-- Efficiently find the most-recent alert for a contract (cooldown check)
CREATE INDEX CONCURRENTLY "pause_alert_log_contractId_sentAt_idx"
    ON "pause_alert_log"("contractId", "sentAt" DESC);

-- Efficiently query alerts by channel for reporting / replay
CREATE INDEX CONCURRENTLY "pause_alert_log_channel_sentAt_idx"
    ON "pause_alert_log"("channel", "sentAt" DESC);

-- Support soft filtering by action (pause vs unpause)
CREATE INDEX CONCURRENTLY "pause_alert_log_action_idx"
    ON "pause_alert_log"("action");

-- Support time-range queries on all recent alerts
CREATE INDEX CONCURRENTLY "pause_alert_log_sentAt_idx"
    ON "pause_alert_log"("sentAt" DESC);

-- ── Down ──────────────────────────────────────────────────────────────────
-- To roll back this migration:
--   DROP TABLE IF EXISTS "pause_alert_log";
--   DROP TABLE IF EXISTS "contract_sync_state";
