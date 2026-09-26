-- Migration: 20260926000000_add_pause_events
-- Issue #1324: pause feature analytics
--
-- One row per contract pause/unpause transaction. Pure CREATE TABLE /
-- CREATE INDEX — no existing table is touched; rollback is DROP TABLE.

CREATE TABLE "pause_events" (
    "id"          TEXT         NOT NULL,
    "contract"    TEXT         NOT NULL,
    "action"      TEXT         NOT NULL,
    "admin"       TEXT         NOT NULL,
    "reason"      TEXT,
    "pausedUntil" TIMESTAMP(3),
    "txHash"      TEXT         NOT NULL,
    "eventId"     TEXT,
    "occurredAt"  TIMESTAMP(3) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pause_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pause_events_eventId_key" ON "pause_events"("eventId");
CREATE UNIQUE INDEX "pause_events_txHash_action_key" ON "pause_events"("txHash", "action");
CREATE INDEX "pause_events_contract_occurredAt_idx" ON "pause_events"("contract", "occurredAt");
CREATE INDEX "pause_events_occurredAt_idx" ON "pause_events"("occurredAt");

-- ── Down ──────────────────────────────────────────────────────────────────
-- DROP TABLE "pause_events";
