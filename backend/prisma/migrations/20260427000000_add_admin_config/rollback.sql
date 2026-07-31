-- Rollback: 20260427000000_add_admin_config
--
-- Drops the AdminConfig table introduced by add_admin_config/migration.sql.
--
-- WARNING: This is destructive — all admin configuration values will be lost.
-- Export current values (SELECT * FROM "AdminConfig") before applying.

DROP TABLE IF EXISTS "AdminConfig";
