-- Rollback: 20261016000000_add_pause_notifications_schema
-- Drops the two new tables introduced by this migration.
-- Safe to run while the application is live; both tables are exclusively
-- written by the new pause notification services, so dropping them only
-- affects those services.

DROP TABLE IF EXISTS "pause_alert_log";
DROP TABLE IF EXISTS "contract_sync_state";
