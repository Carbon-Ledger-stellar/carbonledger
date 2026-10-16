-- Migration: 20261016000000_add_market_listing_pause_state
-- Issue #1231: Add pause state columns to MarketListing
--
-- Adds four columns to track whether a marketplace listing is currently paused,
-- who paused it, when, and why.  All new columns are nullable (or have a safe
-- boolean default) so the migration is fully backward compatible with existing
-- rows — no UPDATE sweep required.
--
-- Rollback: see comment at the bottom.

-- ── Up ────────────────────────────────────────────────────────────────────────

ALTER TABLE "MarketListing"
  ADD COLUMN "is_paused"    BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN "paused_at"    TIMESTAMP(3),
  ADD COLUMN "paused_by"    TEXT,
  ADD COLUMN "pause_reason" TEXT;

-- Index for efficient lookup of all currently-paused listings.
-- Queries such as "WHERE is_paused = true ORDER BY paused_at DESC" use this.
CREATE INDEX "MarketListing_is_paused_paused_at_idx"
  ON "MarketListing"("is_paused", "paused_at");

-- ── Down (rollback) ───────────────────────────────────────────────────────────
-- DROP INDEX "MarketListing_is_paused_paused_at_idx";
-- ALTER TABLE "MarketListing"
--   DROP COLUMN "pause_reason",
--   DROP COLUMN "paused_by",
--   DROP COLUMN "paused_at",
--   DROP COLUMN "is_paused";
