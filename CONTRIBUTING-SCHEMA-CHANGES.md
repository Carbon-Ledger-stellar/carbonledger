# Contributing Schema Changes

This document describes how to make database schema changes safely in this
repository. All schema changes are managed with Prisma Migrate and are applied
automatically by the deploy pipeline.

## How migrations run in the deploy pipeline

Deploys no longer require anyone to run migrations by hand. The deploy
pipeline contains a dedicated **pre-deploy migration job** that runs:

```
prisma migrate deploy
```

This job runs before the application is rolled out. The deploy job depends on
the migration job, so **if `prisma migrate deploy` fails, the deployment is
aborted** and the previous version keeps serving traffic. There is no manual
step and no way to skip the migration job.

Because of this, every migration you commit must be safe to run against the
currently deployed application version. See
[zero-downtime-migrations.md](./zero-downtime-migrations.md) for the full
guidance.

## Rules for schema changes

1. **Never edit an already-applied migration.** Prisma records applied
   migrations in `_prisma_migrations`; changing them causes `migrate deploy` to
   fail and aborts the deploy.
2. **Commit the migration files.** Run `prisma migrate dev --name <change>`
   locally and commit the generated SQL under `prisma/migrations/` together with
   the schema change.
3. **Follow the expand/contract pattern** described in
   [zero-downtime-migrations.md](./zero-downtime-migrations.md):
   - *Expand*: add new nullable columns, tables, or indexes in one deploy.
   - *Migrate*: backfill data and update application code to write to both old
     and new shapes.
   - *Contract*: remove the old columns/tables in a later deploy, only after no
     running code depends on them.
4. **Keep migrations backward compatible.** During a rolling deploy, old and
   new application versions run at the same time. A migration must not break
   the old version still serving traffic.
5. **Avoid long locks.** Add indexes concurrently where supported, avoid
   rewriting large tables in a single statement, and prefer batched backfills.

## Checklist before opening a PR with a schema change

- [ ] Migration generated with `prisma migrate dev` and committed.
- [ ] Migration is backward compatible with the currently deployed version.
- [ ] Destructive changes (dropping columns/tables) are split into a later
      contract deploy.
- [ ] Backfills are batched and do not lock large tables.
- [ ] `prisma migrate deploy` succeeds against a copy of production data.

If a migration fails in the pipeline, the deploy is aborted automatically.
Fix the migration (with a new migration, never by editing the failed one) and
redeploy.
