-- Rollback: 20260428100000_add_observability_tables
--
-- Drops the SorobanSubmission and OracleUpdate tables introduced by
-- add_observability_tables/migration.sql.
--
-- WARNING: This is destructive — all rows in these tables will be lost.
-- Take a backup before applying if the data is needed.

DROP TABLE IF EXISTS "OracleUpdate";
DROP TABLE IF EXISTS "SorobanSubmission";
