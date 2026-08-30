-- Rollback: 20260505000000_add_api_keys
--
-- Drops the ApiKey table introduced by add_api_keys/migration.sql.
--
-- WARNING: This is destructive — all API keys stored in this table will be
-- permanently deleted. Revoke any issued keys before applying this rollback.

DROP TABLE IF EXISTS "ApiKey";
