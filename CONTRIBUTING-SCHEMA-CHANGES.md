# Contributing Schema Changes

> **Every schema migration must be zero-downtime compatible.**  
> Migrations that lock tables cause production outages. This document defines the
> conventions you must follow and the tooling available to verify them.

---

## Table of Contents

1. [Guiding Principle](#guiding-principle)  
2. [Migration Safety Rules](#migration-safety-rules)  
3. [Three-Phase Non-Nullable Column Addition](#three-phase-non-nullable-column-addition)  
4. [Creating a Migration](#creating-a-migration)  
5. [Adding a Rollback File](#adding-a-rollback-file)  
6. [Running the Safety Linter](#running-the-safety-linter)  
7. [Running Rollbacks](#running-rollbacks)  
8. [Existing Migrations Audit](#existing-migrations-audit)  
9. [CI Enforcement](#ci-enforcement)  

---

## Guiding Principle

PostgreSQL acquires heavy table locks for certain DDL statements.  Under load,
waiting for a lock can cascade into a full service outage as connection slots
fill up.  CarbonLedger targets zero-downtime schema changes at all times.

---

## Migration Safety Rules

### ✅ Always do

| Operation | Safe pattern |
|-----------|-------------|
| Create an index | `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` |
| Add a nullable column | `ALTER TABLE "X" ADD COLUMN "col" TEXT;` |
| Add a column with a default | `ALTER TABLE "X" ADD COLUMN "col" INTEGER NOT NULL DEFAULT 0;` |
| Drop an index | `DROP INDEX CONCURRENTLY IF EXISTS "idx";` |
| Add a new table | `CREATE TABLE "X" ( ... );` |
| Rename a column (safe in PG 10+) | `ALTER TABLE "X" RENAME COLUMN "old" TO "new";` |

### ❌ Never do without a mitigation

| Operation | Problem | Mitigation |
|-----------|---------|------------|
| `CREATE INDEX` without `CONCURRENTLY` | Holds `ShareLock` for the full build | Add `CONCURRENTLY` |
| `ALTER TABLE ADD COLUMN ... NOT NULL` without `DEFAULT` | Rewrites every row (PG < 11) or validates all rows immediately (PG 11+) | Use the [three-phase approach](#three-phase-non-nullable-column-addition) |
| `DROP TABLE` | Destructive and irreversible without a backup | Write rollback SQL first, create data backup if needed |
| `TRUNCATE` | Acquires `ACCESS EXCLUSIVE` lock, destructive | Use `DELETE FROM "X" WHERE ...` with batching |
| `ALTER TABLE SET NOT NULL` on an existing nullable column | Full table scan to verify constraint | Use `ADD CONSTRAINT ... CHECK (...) NOT VALID` then `VALIDATE CONSTRAINT` in a separate step |

---

## Three-Phase Non-Nullable Column Addition

Adding a `NOT NULL` column without a default to an existing table with data is
the most common source of production migration downtime.  Use this three-phase
approach instead:

### Phase 1 — Add nullable column (deploy)

```sql
-- Migration N: add nullable column
ALTER TABLE "Order" ADD COLUMN "currency" TEXT;
```

Deploy the application code that writes the new column.

### Phase 2 — Backfill existing rows (deploy)

```sql
-- Migration N+1: backfill with appropriate default
UPDATE "Order" SET "currency" = 'USD' WHERE "currency" IS NULL;
```

If the table is large, batch the update to avoid long transactions:

```sql
DO $$
DECLARE batch_size INT := 10000;
BEGIN
  LOOP
    UPDATE "Order" SET "currency" = 'USD'
    WHERE "currency" IS NULL
    LIMIT batch_size;
    EXIT WHEN NOT FOUND;
    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;
```

### Phase 3 — Add NOT NULL constraint (deploy)

```sql
-- Migration N+2: add NOT NULL constraint — now safe because all rows have a value
ALTER TABLE "Order" ALTER COLUMN "currency" SET NOT NULL;
```

> **Note for large tables:** use `ADD CONSTRAINT ... CHECK (currency IS NOT NULL) NOT VALID`
> followed by `VALIDATE CONSTRAINT` in a separate transaction to avoid long lock.

---

## Creating a Migration

```bash
# 1. Edit the Prisma schema
vim backend/prisma/schema.prisma

# 2. Generate a migration (use a descriptive name)
cd backend
npx prisma migrate dev --name add_currency_to_order

# 3. Review the generated SQL — ensure it follows the rules above
cat prisma/migrations/<timestamp>_add_currency_to_order/migration.sql

# 4. Create the rollback SQL (see below)
```

---

## Adding a Rollback File

Every migration directory **must** contain a `rollback.sql` file next to
`migration.sql`.  This file must undo exactly what `migration.sql` does.

```
backend/prisma/migrations/
└── 20260901000000_add_currency_to_order/
    ├── migration.sql    ← forward migration
    └── rollback.sql     ← ← ← required
```

### Rollback conventions

- **Index rollback:** `DROP INDEX CONCURRENTLY IF EXISTS "idx_name";`
- **Table rollback:** `DROP TABLE IF EXISTS "TableName";` (add a data backup warning comment)
- **Column rollback:** `ALTER TABLE "X" DROP COLUMN IF EXISTS "col";`
- **Constraint rollback:** `ALTER TABLE "X" DROP CONSTRAINT IF EXISTS "c_name";`

Always add a warning comment if the rollback is destructive (data loss).

### Example

```sql
-- Rollback: 20260901000000_add_currency_to_order
--
-- WARNING: This drops the currency column and all its data.
-- Export the column with:
--   COPY (SELECT id, currency FROM "Order") TO '/tmp/order_currency_backup.csv' CSV HEADER;

ALTER TABLE "Order" DROP COLUMN IF EXISTS "currency";
```

---

## Running the Safety Linter

The safety linter (`migrate:check`) scans all `migration.sql` files under
`backend/prisma/migrations/` and fails if any table-locking patterns are found.

```bash
cd indexer
npm run migrate:check
```

Exit code `0` means all migrations are safe.  
Exit code `1` means at least one violation was found — fix it before merging.

### What it checks

| Rule | Pattern | Why it fails |
|------|---------|-------------|
| `CREATE_INDEX_WITHOUT_CONCURRENTLY` | `CREATE INDEX` not followed by `CONCURRENTLY` | Table-level share lock |
| `ADD_COLUMN_NOT_NULL_NO_DEFAULT` | `ADD COLUMN ... NOT NULL` without `DEFAULT` | Full table rewrite or long validation |
| `DROP_TABLE` | `DROP TABLE` | Destructive, must have rollback SQL first |
| `TRUNCATE` | `TRUNCATE` at start of a statement | Exclusive lock, destructive |

---

## Running Rollbacks

To apply the rollback for the most recently applied migration:

```bash
cd indexer
DATABASE_URL="postgresql://user:pass@localhost/carbonledger" npm run migrate:rollback
```

This finds the last migration directory (alphabetically) that contains a
`rollback.sql` and executes it via `psql`.

> **Warning:** Rollbacks may be destructive. Always take a database backup
> (`pg_dump`) before rolling back in production.

---

## Existing Migrations Audit

| Migration | Tables affected | Locking risk | Status |
|-----------|----------------|-------------|--------|
| `20260427000000_add_admin_config` | Creates `AdminConfig` | None (new table) | ✅ Safe |
| `20260428100000_add_observability_tables` | Creates `SorobanSubmission`, `OracleUpdate` | None (new tables + `CREATE INDEX`) | ✅ Safe |
| `20260505000000_add_api_keys` | Creates `ApiKey` | None (new table) | ✅ Safe |
| `20260716000000_add_idempotency_record` | Creates `IdempotencyRecord` | None (new table) | ✅ Safe |
| `20260718000000_add_missing_indexes` | Indexes on `RetirementRecord`, `CreditBatch`, `MarketListing` | **Uses `CREATE INDEX` without `CONCURRENTLY`** | ⚠️ Retroactively safe on an empty DB; requires `CONCURRENTLY` for live migrations |

### Safe equivalent for `20260718000000_add_missing_indexes`

The three `CREATE INDEX IF NOT EXISTS` statements in this migration are safe on
an empty database but will briefly lock each table on a live system.  If you need
to apply this migration to a running database, use the following safe equivalent:

```sql
-- Safe equivalent: add_missing_indexes with CONCURRENTLY
-- Run each statement separately (CONCURRENTLY cannot run inside a transaction block)

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RetirementRecord_projectId_retiredAt_idx"
    ON "RetirementRecord"("projectId", "retiredAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CreditBatch_projectId_vintageYear_status_idx"
    ON "CreditBatch"("projectId", "vintageYear", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketListing_methodology_vintageYear_status_pricePerCredit_idx"
    ON "MarketListing"("methodology", "vintageYear", "status", "pricePerCredit");
```

> **Note:** `CREATE INDEX CONCURRENTLY` cannot be run inside a transaction block.
> Execute each statement separately at the `psql` prompt or via a script, not
> via `prisma migrate deploy` (which wraps migrations in a transaction).
> For this reason, the migration file retains the non-CONCURRENTLY form and is
> documented as safe to apply on an empty or near-empty database only.

---

## CI Enforcement

The migration safety linter runs automatically in CI on every PR that modifies
`backend/prisma/migrations/**`.  A failing linter check blocks the merge.

See `.github/workflows/ci.yml` for the `migrate-check` job definition.
