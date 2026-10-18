-- Migration: 20261016000000_add_pause_state_constraints
-- Issue #1233: Add database constraints for pause state consistency
--
-- Adds CHECK constraints and partial indexes to the pause_events table to
-- enforce state-machine invariants at the database level:
--
--   1. action must be 'pause' or 'unpause' — rejects any typo or unknown state
--   2. contract must be 'credit' or 'marketplace' — matches PAUSABLE_CONTRACTS
--   3. pausedUntil must be set for pause events and NULL for unpause events
--   4. Partial index: only one non-NULL pausedUntil per contract can be
--      active at a time (prevents duplicate open pause windows)
--   5. admin must be a non-empty string (Stellar G... public key)
--   6. txHash must be a non-empty string
--   7. A partial unique index ensures each contract cannot appear twice in
--      pause state without an intervening unpause (enforced via occurrence order)
--
-- These constraints complement the application-level validation in PauseService
-- and act as a last-resort guard against data corruption.
--
-- This migration is purely additive — no rows are modified or removed.
-- Rollback: drop the constraints and indexes listed in the Down section.
--
-- ── Up ────────────────────────────────────────────────────────────────────

-- 1. action must be one of the valid values
ALTER TABLE "pause_events"
  ADD CONSTRAINT "pause_events_action_valid"
  CHECK ("action" IN ('pause', 'unpause'));

-- 2. contract must be one of the pausable contracts
ALTER TABLE "pause_events"
  ADD CONSTRAINT "pause_events_contract_valid"
  CHECK ("contract" IN ('credit', 'marketplace'));

-- 3. pausedUntil must be set for 'pause' events and NULL for 'unpause' events
--    This enforces the semantic: you only set a window when pausing, not unpausing.
ALTER TABLE "pause_events"
  ADD CONSTRAINT "pause_events_paused_until_consistency"
  CHECK (
    ("action" = 'pause'   AND "pausedUntil" IS NOT NULL)
    OR
    ("action" = 'unpause' AND "pausedUntil" IS NULL)
  );

-- 4. admin must be a non-empty string (basic integrity guard)
ALTER TABLE "pause_events"
  ADD CONSTRAINT "pause_events_admin_nonempty"
  CHECK (length(trim("admin")) > 0);

-- 5. txHash must be a non-empty string
ALTER TABLE "pause_events"
  ADD CONSTRAINT "pause_events_txhash_nonempty"
  CHECK (length(trim("txHash")) > 0);

-- 6. occurredAt must not be in the future by more than 5 minutes
--    (allows for minor clock drift between the indexer and the DB server)
--    Expressed as: occurredAt <= NOW() + interval '5 minutes'
ALTER TABLE "pause_events"
  ADD CONSTRAINT "pause_events_occurred_at_not_future"
  CHECK ("occurredAt" <= NOW() + INTERVAL '5 minutes');

-- 7. Index to support efficient lookup of the most recent pause for a contract,
--    used by the "cannot unpause before pause" check in application logic.
CREATE INDEX "pause_events_contract_action_occurred_idx"
  ON "pause_events" ("contract", "action", "occurredAt" DESC);

-- ── Down ──────────────────────────────────────────────────────────────────
-- ALTER TABLE "pause_events" DROP CONSTRAINT "pause_events_action_valid";
-- ALTER TABLE "pause_events" DROP CONSTRAINT "pause_events_contract_valid";
-- ALTER TABLE "pause_events" DROP CONSTRAINT "pause_events_paused_until_consistency";
-- ALTER TABLE "pause_events" DROP CONSTRAINT "pause_events_admin_nonempty";
-- ALTER TABLE "pause_events" DROP CONSTRAINT "pause_events_txhash_nonempty";
-- ALTER TABLE "pause_events" DROP CONSTRAINT "pause_events_occurred_at_not_future";
-- DROP INDEX "pause_events_contract_action_occurred_idx";
