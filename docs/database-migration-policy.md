# Database migration policy

## Goal

This project uses Prisma migrations with an expand-contract strategy so new backend versions can be deployed without interrupting live traffic. The policy favors additive changes that keep both the old and new application versions compatible during a rolling deployment.

## Allowed patterns

- Add nullable columns or new tables in a first migration.
- Add new indexes and backfill data in separate, low-risk steps.
- Introduce new optional fields that the application can read and write safely.
- Deploy application code that can tolerate both the old and new schema shape before enforcing stricter constraints.
- Use explicit, reviewable migration names that describe the change.

## Forbidden patterns

The following patterns are not allowed in new migrations unless the migration file includes the override marker `-- migrationlint: allow-destructive` and the change has an explicit review record:

- `DROP COLUMN`, `DROP TABLE`, `DROP INDEX`, `DROP CONSTRAINT`, or `DROP SEQUENCE`
- `TRUNCATE`
- `DELETE FROM` for large or destructive data changes
- Column type changes or `NOT NULL` enforcement without a prior backfill and compatibility window
- Renaming columns or tables in place

## Example expand-contract migrations

The repository includes examples that follow the pattern:

- [backend/prisma/migrations/20260729000000_expand_contract_add_project_migration_version/migration.sql](backend/prisma/migrations/20260729000000_expand_contract_add_project_migration_version/migration.sql)
- [backend/prisma/migrations/20260729000001_expand_contract_add_retirement_legacy_status/migration.sql](backend/prisma/migrations/20260729000001_expand_contract_add_retirement_legacy_status/migration.sql)

These migrations only add new optional fields and indexes. The application can deploy safely with the old schema still in place.

## Prisma naming conventions

Migration directories must follow this naming convention:

- `YYYYMMDDHHMMSS_description`
- Example: `20260729000000_expand_contract_add_project_migration_version`

## Rollback procedure for the last N migrations

For a rollback, treat each migration as an additive step and roll back from newest to oldest:

1. Identify the migration list to revert.
2. Resolve the newest migration first:
   `npx prisma migrate resolve --rolled-back <migration-name>`
3. Repeat for each earlier migration in reverse order.
4. If data must be reverted, add a new follow-up migration that performs the inverse change explicitly.

The rollback plan can be generated with:

- `npm run migrate:rollback:plan -- --count 3`
