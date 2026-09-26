# Zero-Downtime Migration Playbook

> **Audience:** Backend engineers, SREs, and anyone executing a Prisma schema change against a live CarbonLedger database.

---

## Table of Contents

1. [Why Zero-Downtime Matters](#1-why-zero-downtime-matters)
2. [The Expand-Contract Pattern](#2-the-expand-contract-pattern)
3. [Step-by-Step Procedure](#3-step-by-step-procedure)
4. [Example Scenarios](#4-example-scenarios)
   - [Scenario A – Rename a Column](#scenario-a--rename-a-column)
   - [Scenario B – Split a Denormalized Field](#scenario-b--split-a-denormalized-field)
   - [Scenario C – Change a Column's Data Type](#scenario-c--change-a-columns-data-type)
5. [Rollback Strategy](#5-rollback-strategy)
6. [Edge Cases and Gotchas](#6-edge-cases-and-gotchas)
7. [Monitoring During Migration](#7-monitoring-during-migration)
8. [Tooling Reference](#8-tooling-reference)

---

## 1. Why Zero-Downtime Matters

CarbonLedger processes carbon credit retirements and marketplace transactions in real time. A hard schema swap (drop a column, rename a table) that requires application downtime would:

- Block in-flight Soroban transactions from settling.
- Break the idempotency middleware that guards critical endpoints.
- Violate the audit-log append-only guarantee if rows cannot be written mid-migration.

The expand-contract pattern decouples schema changes from code changes so both can roll forward and roll back independently.

---

## 2. The Expand-Contract Pattern

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1 – EXPAND                                           │
│  Add new column / table alongside existing schema.          │
│  Old app version: ignores the new column.                   │
│  New app version: writes to both old and new column.        │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2 – BACKFILL                                         │
│  Populate new column for all pre-existing rows.             │
│  Runs as a background job; does not block live traffic.     │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3 – CONTRACT (CUTOVER)                               │
│  Deploy code that reads only the new column.                │
│  Old column is now dead weight; safe to drop later.         │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4 – CLEANUP                                          │
│  Drop old column / table in a separate, post-cutover        │
│  migration (annotated with allow-destructive override).     │
└─────────────────────────────────────────────────────────────┘
```

Each phase maps to its own Prisma migration and its own application deployment.

---

## 3. Step-by-Step Procedure

### Before you start

```bash
# 1. Back up the database (production)
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d%H%M%S).sql

# 2. Verify migration lint is green
cd backend
node scripts/lint-migrations.js

# 3. Check current migration status
npx prisma migrate status
```

### Phase 1 – Expand (add new column)

1. Edit `prisma/schema.prisma` to add the new column as **nullable** with a sensible default.
2. Create the migration:
   ```bash
   npx prisma migrate dev --name expand_<description>
   ```
3. Inspect the generated `migration.sql` – it must contain only `ADD COLUMN IF NOT EXISTS` or `CREATE INDEX IF NOT EXISTS` statements.
4. Run lint:
   ```bash
   node scripts/lint-migrations.js
   ```
5. **Deploy the new schema** to the database (production):
   ```bash
   npx prisma migrate deploy
   ```
   This is safe to run while the current application version is live because only an additive change is applied.

### Phase 2 – Deploy dual-read code

1. Update the service layer to write to **both** the old and new columns.
2. Use `DualReadService.readField()` to return the new value when available, falling back to the old value.
3. Open a PR, pass CI, deploy the new app version (rolling restart is fine – no downtime).

### Phase 3 – Backfill existing rows

```bash
# Run the backfill script (example for a single column migration)
npx ts-node --transpile-only backend/scripts/backfill-<migration-name>.ts
```

The backfill script **must**:
- Operate in batches (default: 500 rows).
- Use a cursor, not `OFFSET`, so it stays efficient as rows are added concurrently.
- Be idempotent (safe to re-run on failure).

Verify with:
```sql
SELECT COUNT(*) FROM "<Table>" WHERE "<newColumn>" IS NULL;
-- Should be 0 when backfill is complete.
```

### Phase 4 – Contract (cutover)

1. Remove the dual-read fallback; the service now reads **only** the new column.
2. Deploy this version.
3. Monitor for 30 minutes (see [Monitoring](#7-monitoring-during-migration)).

### Phase 5 – Cleanup (optional, scheduled)

Once you are confident the old column is no longer accessed:

1. Add the `-- migrationlint: allow-destructive` override comment to the migration SQL.
2. Create a cleanup migration:
   ```bash
   npx prisma migrate dev --name contract_drop_<description>
   ```
3. The migration will contain a `DROP COLUMN` protected by the override marker.
4. Deploy after the next quiet maintenance window.

---

## 4. Example Scenarios

### Scenario A – Rename a Column

**Goal:** Rename `RetirementRecord.retirementReason` → `RetirementRecord.reason` without downtime.

#### Phase 1 – Expand: add `reason` column

```sql
-- migration: 20260801000000_expand_retirement_add_reason_column
ALTER TABLE "RetirementRecord"
  ADD COLUMN IF NOT EXISTS "reason" TEXT;
```

Prisma schema addition:
```prisma
model RetirementRecord {
  // existing fields...
  retirementReason String      // kept during transition
  reason           String?     // new canonical field (nullable during backfill)
}
```

#### Phase 2 – Dual-read code (deployed alongside migration)

```typescript
// retirements.service.ts
const record = await this.prisma.retirementRecord.findUnique({ where: { id } });
const retirementReason = this.dualRead.readField(record, 'reason', 'retirementReason');
```

Write path:
```typescript
await this.prisma.retirementRecord.create({
  data: {
    retirementReason: dto.reason,  // keep writing old field
    reason: dto.reason,            // also write new field
  },
});
```

#### Phase 3 – Backfill

```sql
-- Batched backfill (run via backfill script)
UPDATE "RetirementRecord"
SET "reason" = "retirementReason"
WHERE "reason" IS NULL
  AND id > $cursor
LIMIT 500;
```

#### Phase 4 – Cutover

Remove `retirementReason` from all reads. Write only to `reason`. Make `reason` `NOT NULL` via a new migration (safe after backfill):

```sql
-- migration: 20260801000002_contract_retirement_reason_not_null
ALTER TABLE "RetirementRecord" ALTER COLUMN "reason" SET NOT NULL;
```

#### Phase 5 – Cleanup

```sql
-- migration: 20260801000003_cleanup_drop_retirement_reason
-- migrationlint: allow-destructive
ALTER TABLE "RetirementRecord" DROP COLUMN "retirementReason";
```

---

### Scenario B – Split a Denormalized Field

**Goal:** Split `CarbonProject.projectType` (a comma-separated string like `"REDD+,ARR"`) into a normalized `ProjectType` join table.

#### Phase 1 – Expand: add `ProjectType` table

```sql
-- migration: 20260802000000_expand_add_project_type_table
CREATE TABLE IF NOT EXISTS "ProjectType" (
  "id"        TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "typeCode"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectType_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectType_projectId_idx" ON "ProjectType"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectType_projectId_typeCode_key"
  ON "ProjectType"("projectId", "typeCode");
```

#### Phase 2 – Dual-read code

The service writes new records to both `CarbonProject.projectType` (old) and the new `ProjectType` rows.
Reads check the `ProjectType` rows first; if empty, fall back to splitting the string field.

#### Phase 3 – Backfill

```typescript
// backfill-project-types.ts
for (const project of await prisma.carbonProject.findMany()) {
  const codes = project.projectType.split(',').map(c => c.trim()).filter(Boolean);
  await prisma.projectType.createMany({
    data: codes.map(typeCode => ({ id: cuid(), projectId: project.id, typeCode })),
    skipDuplicates: true,
  });
}
```

#### Phase 4 – Cutover

Reads use only `ProjectType` rows. Writes no longer update `CarbonProject.projectType`.

#### Phase 5 – Cleanup

```sql
-- migrationlint: allow-destructive
ALTER TABLE "CarbonProject" DROP COLUMN "projectType";
```

---

### Scenario C – Change a Column's Data Type

**Goal:** Change `MarketListing.pricePerCredit` from `TEXT` (storing a string representation of a Decimal) to a proper `Decimal(18,8)`.

This is the most complex scenario because PostgreSQL cannot cast arbitrarily formatted strings to `Decimal` in a single `ALTER COLUMN`.

#### Phase 1 – Expand: add `pricePerCreditDecimal` column

```sql
-- migration: 20260803000000_expand_listing_price_decimal
ALTER TABLE "MarketListing"
  ADD COLUMN IF NOT EXISTS "pricePerCreditDecimal" DECIMAL(18, 8);

CREATE INDEX IF NOT EXISTS "MarketListing_pricePerCreditDecimal_idx"
  ON "MarketListing"("pricePerCreditDecimal");
```

#### Phase 2 – Dual-read code

```typescript
// marketplace.service.ts
const price = this.dualRead.readField(listing, 'pricePerCreditDecimal', 'pricePerCredit');
```

Write path casts the string:
```typescript
await this.prisma.marketListing.create({
  data: {
    pricePerCredit: dto.price.toString(),           // legacy TEXT
    pricePerCreditDecimal: new Decimal(dto.price),  // new DECIMAL
  },
});
```

#### Phase 3 – Backfill

```sql
UPDATE "MarketListing"
SET "pricePerCreditDecimal" = "pricePerCredit"::DECIMAL(18,8)
WHERE "pricePerCreditDecimal" IS NULL
  AND id > $cursor
LIMIT 500;
```

Rows with invalid strings should be logged and reviewed before cutover.

#### Phase 4 – Cutover

Add `NOT NULL` constraint to the new column; remove legacy string from queries.

```sql
-- migration: 20260803000002_contract_listing_price_not_null
ALTER TABLE "MarketListing"
  ALTER COLUMN "pricePerCreditDecimal" SET NOT NULL;
```

#### Phase 5 – Cleanup

```sql
-- migrationlint: allow-destructive
ALTER TABLE "MarketListing" DROP COLUMN "pricePerCredit";
ALTER TABLE "MarketListing" RENAME COLUMN "pricePerCreditDecimal" TO "pricePerCredit";
```

---

## 5. Rollback Strategy

### Rollback at Phase 1 (before any code change)

The new column is empty and nullable. Mark the migration as rolled back:

```bash
node scripts/rollback-migrations.js --count 1
# Copy the printed command and run it:
npx prisma migrate resolve --rolled-back <migration-name>
```

Then drop the column manually if needed (wrapped in `allow-destructive`).

### Rollback at Phase 2 (dual-read code deployed)

Roll back the code deployment to the previous image (your CD pipeline handles this). The old column is still populated, so the previous code continues working.

### Rollback at Phase 3 (backfill in progress)

Stop the backfill script. The new column has partial data. Roll back the code to the dual-read version (Phase 2). Backfill data is harmless but incomplete; you can resume it later.

### Rollback at Phase 4 (new code deployed, old column reads removed)

This is the riskiest rollback point. Because the old column has been written to continuously via the dual-read path in Phase 2, its data is still current. Roll back to the Phase-2 code image. The app re-enables dual-read and the service continues serving traffic.

### Rollback at Phase 5 (old column dropped)

There is no automated rollback once the column is physically dropped. You must:

1. Restore from backup (`pg_restore`).
2. Re-apply all subsequent migrations.
3. Post a P1 incident report.

**This is why Phase 5 should only execute after a 7-day monitoring period.**

### Rollback decision matrix

| Phase at failure | Code rollback | Schema rollback | Data loss? |
|---|---|---|---|
| 1 – Schema expand | Not needed | Mark rolled-back, drop new col | No |
| 2 – Dual-read deploy | Deploy previous image | Not needed | No |
| 3 – Backfill | Stop backfill script | Not needed | No (partial backfill, harmless) |
| 4 – Cutover deploy | Deploy Phase-2 image | Not needed | No |
| 5 – Cleanup (drop) | Deploy Phase-2 image | Restore from backup | **Yes** – requires DB restore |

---

## 6. Edge Cases and Gotchas

### 1. Long-running backfills with high write throughput

If the table receives thousands of inserts per second, a cursor-based `UPDATE ... WHERE id > $cursor LIMIT 500` can fall behind. Solutions:

- Pause the backfill during peak hours.
- Use `pg_partman` or a Postgres background worker.
- Ensure the new column is written by the dual-read code path for new rows so only historical rows require backfilling.

### 2. NOT NULL constraints before backfill completes

Never add `NOT NULL` without a `DEFAULT` or completed backfill. Postgres will rewrite the entire table, creating an exclusive lock and blocking all reads/writes.

Postgres 11+ supports `NOT NULL` with a `DEFAULT` without a table rewrite for constants, but Prisma-generated migrations must be verified manually.

### 3. Adding indexes concurrently

Standard `CREATE INDEX` takes a `ShareLock`. On large tables this blocks writes for the duration. Always use:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_name" ON "Table"("column");
```

Note: `CREATE INDEX CONCURRENTLY` **cannot** run inside a transaction. Prisma migrations run in a transaction by default. To use it, mark the migration as a multi-statement non-transactional migration or run it out-of-band.

### 4. Prisma Client type errors during transition

During Phase 2, Prisma's generated types will include both old and new fields. The dual-read helper accepts `unknown` field values so type-safety is preserved while the transition is in flight.

### 5. Foreign key constraints on new columns

Do not add `NOT NULL FOREIGN KEY` columns in the expand step. Add the column as nullable first, backfill, then add the constraint in the contract step.

### 6. Prisma `migrate deploy` in CI vs production

`migrate deploy` is idempotent but does **not** prompt for confirmation – always safe to run in CI. `migrate dev` is for local development only and can reset the database.

---

## 7. Monitoring During Migration

### Metrics to watch

| Metric | Source | Alert threshold |
|---|---|---|
| Query latency (p99) | `migration_query_duration_seconds` | > 2× baseline for > 5 min |
| DB connection pool saturation | `db_pool_active / db_pool_max` | > 80% |
| HTTP 5xx error rate | Nginx / ALB access logs | > 0.5% sustained |
| Prisma `P2024` (pool timeout) errors | Application logs | Any occurrence |
| Backfill progress | Custom gauge `migration_backfill_rows_processed` | Stalled for > 10 min |
| Dead tuples (table bloat) | `pg_stat_user_tables.n_dead_tup` | > 10% of live tuples |
| Replication lag | `pg_stat_replication.replay_lag` | > 30 s |

### Recommended dashboard

The `MigrationMonitorService` (see `backend/src/database/migration-monitor.service.ts`) exposes these as Prometheus gauges. Import the pre-built Grafana dashboard from `infra/grafana/dashboards/migration-monitor.json` (create if absent).

### Runbook during live migration

1. Open the Grafana migration dashboard before running `migrate deploy`.
2. Execute the migration.
3. Watch query latency for 5 minutes. If p99 spikes > 2× baseline, run:
   ```bash
   node scripts/rollback-migrations.js --count 1
   npx prisma migrate resolve --rolled-back <name>
   ```
4. For backfill jobs, tail the application log:
   ```bash
   docker-compose logs -f backend | grep "backfill"
   ```
5. After cutover (Phase 4), watch error rate for 30 minutes before declaring success.

---

## 8. Tooling Reference

| Script / file | Purpose |
|---|---|
| `backend/scripts/lint-migrations.js` | Reject destructive SQL without the override marker |
| `backend/scripts/rollback-migrations.js` | Generate `prisma migrate resolve --rolled-back` commands |
| `backend/src/database/dual-read.service.ts` | Typed helper for old-column / new-column fallback reads |
| `backend/src/database/migration-monitor.service.ts` | Prometheus gauges + backfill progress tracking |
| `backend/src/database/migration.spec.ts` | Unit + integration tests for migration tooling |
| `docs/database-migration-policy.md` | Allowed / forbidden SQL patterns |

### Running the full migration test suite

```bash
cd backend
npx jest src/database/migration.spec.ts --verbose
npx jest src/migrations/migration-policy.spec.ts --verbose
```

### Generating a rollback plan before every deploy

```bash
cd backend
npm run migrate:rollback:plan -- --count 3
```

This prints the exact `prisma migrate resolve` commands needed to roll back the three most recent migrations, in reverse order.
