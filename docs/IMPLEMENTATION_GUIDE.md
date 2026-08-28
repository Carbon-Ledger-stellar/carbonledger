# CarbonLedger Implementation Guide

This guide walks through integrating the new temporal tables, ADRs, database schema documentation, and testing strategy into the CarbonLedger backend.

## Table of Contents

1. [Temporal Tables Integration](#temporal-tables-integration)
2. [Database Migration](#database-migration)
3. [Service Layer Updates](#service-layer-updates)
4. [Testing Integration](#testing-integration)
5. [Performance Verification](#performance-verification)
6. [Deployment Checklist](#deployment-checklist)

---

## Temporal Tables Integration

### Overview

System-versioned temporal tables track complete history of Projects, Credit Batches, and Retirement Records. Every update creates a new version with `started_at` and `ended_at` timestamps.

### Key Concepts

**Active Version:**
- Current record in main table (CarbonProject, CreditBatch, RetirementRecord)
- Has `ended_at = NULL` (current)
- Has `started_at` = when this version became active

**Historical Version:**
- Previous version moved to history table
- Has `ended_at` = when replaced
- Complete snapshot of all fields at that time

**Point-in-Time Query:**
```sql
-- What was project status on June 1, 2026?
SELECT status FROM CarbonProjectHistory
WHERE projectId = 'proj-1'
  AND started_at <= '2026-06-01'
  AND (ended_at IS NULL OR ended_at > '2026-06-01');
```

### Implementation Steps

#### 1. Apply Database Migration

```bash
cd backend

# Review migration
cat prisma/migrations/20260828000000_add_temporal_tables/migration.sql

# Apply migration to development database
npm run prisma migrate dev --name add_temporal_tables

# Verify schema updated
npm run prisma generate
```

**Expected Output:**
```
✓ Generated Prisma Client (5.xx.x) in 342ms
✓ Prisma schema updated
```

#### 2. Backfill History for Existing Records

For existing projects, batches, and retirements, you need to bootstrap the history tables:

```typescript
// backend/src/database/seeds/backfill-temporal.seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillTemporalData() {
  console.log('Starting temporal backfill...');

  try {
    // Backfill CarbonProjectHistory
    const projects = await prisma.carbonProject.findMany();
    console.log(`Backfilling ${projects.length} projects...`);

    await prisma.carbonProjectHistory.createMany({
      data: projects.map(p => ({
        projectId: p.projectId,
        name: p.name,
        description: p.description,
        methodology: p.methodology,
        country: p.country,
        projectType: p.projectType,
        status: p.status,
        vintageYear: p.vintageYear,
        methodologyScore: p.methodologyScore,
        totalCreditsIssued: p.totalCreditsIssued,
        totalCreditsRetired: p.totalCreditsRetired,
        verifierAddress: p.verifierAddress,
        ownerAddress: p.ownerAddress,
        coordinates: p.coordinates,
        migrationVersion: p.migrationVersion,
        lastMonitoringAt: p.lastMonitoringAt,
        started_at: p.createdAt,
        ended_at: null, // Current version
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        deletedAt: p.deletedAt,
        deletionReason: p.deletionReason,
        retentionUntil: p.retentionUntil,
      })),
      skipDuplicates: true,
    });

    // Backfill CreditBatchHistory
    const batches = await prisma.creditBatch.findMany();
    console.log(`Backfilling ${batches.length} batches...`);

    await prisma.creditBatchHistory.createMany({
      data: batches.map(b => ({
        batchId: b.batchId,
        projectId: b.projectId,
        vintageYear: b.vintageYear,
        amount: b.amount,
        serialStart: b.serialStart,
        serialEnd: b.serialEnd,
        status: b.status,
        metadataCid: b.metadataCid,
        started_at: b.issuedAt,
        ended_at: null,
        issuedAt: b.issuedAt,
        deletedAt: b.deletedAt,
      })),
      skipDuplicates: true,
    });

    // Backfill RetirementRecordHistory
    const retirements = await prisma.retirementRecord.findMany();
    console.log(`Backfilling ${retirements.length} retirements...`);

    await prisma.retirementRecordHistory.createMany({
      data: retirements.map(r => ({
        retirementId: r.retirementId,
        batchId: r.batchId,
        projectId: r.projectId,
        amount: r.amount,
        retiredBy: r.retiredBy,
        beneficiary: r.beneficiary,
        retirementReason: r.retirementReason,
        vintageYear: r.vintageYear,
        serialStart: r.serialStart,
        serialEnd: r.serialEnd,
        status: r.certificateStatus, // Use certificate status as proxy
        txHash: r.txHash,
        started_at: r.retiredAt,
        ended_at: null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        deletedAt: r.deletedAt,
      })),
      skipDuplicates: true,
    });

    console.log('✓ Temporal backfill complete');
  } catch (error) {
    console.error('Temporal backfill failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

backfillTemporalData();
```

**Run backfill:**
```bash
npx ts-node src/database/seeds/backfill-temporal.seed.ts
```

---

## Database Migration

### Safety Checklist

✅ Backup production database before applying migration:
```bash
pg_dump -h $DB_HOST -U $DB_USER $DB_NAME > backup-$(date +%Y%m%d).sql
```

✅ Test migration on staging first:
```bash
# Staging only
DATABASE_URL="postgresql://user:pass@staging-db:5432/carbonledger_staging" \
npm run prisma migrate deploy
```

✅ Verify no schema conflicts:
```bash
npm run prisma db push --skip-generate
```

✅ Verify indexes were created:
```bash
psql -U postgres -d carbonledger -c "\di+" | grep "idx_.*temporal"
```

### Migration Rollback

If issues occur, rollback is manual (Prisma doesn't support auto-rollback):

```sql
-- Rollback migration: drop history tables
DROP TABLE IF EXISTS "RetirementRecordHistory" CASCADE;
DROP TABLE IF EXISTS "CreditBatchHistory" CASCADE;
DROP TABLE IF EXISTS "CarbonProjectHistory" CASCADE;

-- Drop temporal columns
ALTER TABLE "CarbonProject" DROP COLUMN "started_at" CASCADE;
ALTER TABLE "CarbonProject" DROP COLUMN "ended_at" CASCADE;

ALTER TABLE "CreditBatch" DROP COLUMN "started_at" CASCADE;
ALTER TABLE "CreditBatch" DROP COLUMN "ended_at" CASCADE;

ALTER TABLE "RetirementRecord" DROP COLUMN "started_at" CASCADE;
ALTER TABLE "RetirementRecord" DROP COLUMN "ended_at" CASCADE;

-- Remove migration record
DELETE FROM "_prisma_migrations" WHERE migration = '20260828000000_add_temporal_tables';
```

---

## Service Layer Updates

### 1. Integrate TemporalService into Core Services

Update existing services to call `TemporalService` on every mutation:

**Example: ProjectsService**

```typescript
// backend/src/projects/projects.service.ts
import { TemporalService } from '../temporal/temporal.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly temporalService: TemporalService, // Add this
    private readonly logger: Logger,
  ) {}

  async createProject(input: CreateProjectDto, ownerAddress: string) {
    // Create project
    const project = await this.prisma.carbonProject.create({
      data: {
        ...input,
        ownerAddress,
        status: 'Pending',
      },
    });

    // Record initial version in history
    await this.temporalService.recordProjectVersion(
      project.projectId,
      this.projectToHistoryModel(project),
    );

    return project;
  }

  async updateProjectStatus(
    projectId: string,
    newStatus: string,
    reason?: string,
  ) {
    // Get previous state for audit trail
    const previous = await this.prisma.carbonProject.findUnique({
      where: { projectId },
    });

    // Update
    const updated = await this.prisma.carbonProject.update({
      where: { projectId },
      data: { status: newStatus },
    });

    // Record version change
    await this.temporalService.recordProjectVersion(
      projectId,
      this.projectToHistoryModel(updated),
      this.projectToHistoryModel(previous),
    );

    // Audit log
    await this.auditLogService.log({
      action: 'project.status_updated',
      resourceId: projectId,
      metadata: { oldStatus: previous.status, newStatus, reason },
    });

    return updated;
  }

  private projectToHistoryModel(project: CarbonProject) {
    return {
      projectId: project.projectId,
      name: project.name,
      description: project.description,
      methodology: project.methodology,
      country: project.country,
      projectType: project.projectType,
      status: project.status,
      vintageYear: project.vintageYear,
      methodologyScore: project.methodologyScore,
      totalCreditsIssued: project.totalCreditsIssued,
      totalCreditsRetired: project.totalCreditsRetired,
      verifierAddress: project.verifierAddress,
      ownerAddress: project.ownerAddress,
      coordinates: project.coordinates,
      migrationVersion: project.migrationVersion,
      lastMonitoringAt: project.lastMonitoringAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      deletedAt: project.deletedAt,
      deletionReason: project.deletionReason,
      retentionUntil: project.retentionUntil,
    };
  }
}
```

**Apply same pattern to:**
- `CreditsService` — on mint, retire, transfer
- `RetirementService` — on create, status update
- `MarketplaceService` — on list, delist, purchase

### 2. Add Temporal Queries to Controllers

Expose temporal queries via API:

```typescript
// backend/src/projects/projects.controller.ts

@Get(':projectId/history')
async getProjectHistory(@Param('projectId') projectId: string) {
  const history = await this.temporalService.getFullHistory(
    'project',
    projectId,
  );
  return {
    projectId,
    versions: history.map(v => ({
      status: v.status,
      name: v.name,
      totalCreditsIssued: v.totalCreditsIssued,
      totalCreditsRetired: v.totalCreditsRetired,
      startedAt: v.started_at,
      endedAt: v.ended_at,
    })),
  };
}

@Get(':projectId/at/:timestamp')
async getProjectAtTime(
  @Param('projectId') projectId: string,
  @Param('timestamp') timestamp: string,
) {
  const state = await this.temporalService.getStateAtTime(
    'project',
    projectId,
    new Date(timestamp),
  );
  if (!state) {
    throw new NotFoundException(
      `Project did not exist at ${timestamp}`,
    );
  }
  return state;
}
```

### 3. Add Background Job for History Archival

Create a scheduled task to archive old history monthly:

```typescript
// backend/src/jobs/archive-history.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TemporalService } from '../temporal/temporal.service';

@Injectable()
export class ArchiveHistoryJob {
  private readonly logger = new Logger(ArchiveHistoryJob.name);

  constructor(private readonly temporalService: TemporalService) {}

  @Cron(CronExpression.EVERY_MONTH)
  async archiveOldHistory() {
    try {
      this.logger.log('Starting monthly history archival...');

      // Archive history older than 7 years (regulatory requirement)
      const sevenYearsAgo = new Date();
      sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

      const deletedCount = await this.temporalService.archiveHistoryBefore(
        sevenYearsAgo,
        'all',
      );

      // Compute storage overhead
      const overhead = await this.temporalService.computeStorageOverhead();

      this.logger.log(
        `✓ Archived ${deletedCount} history entries. Storage overhead: ${overhead.overheadPercentage.toFixed(2)}%`,
      );
    } catch (error) {
      this.logger.error('History archival failed:', error);
      throw error;
    }
  }

  @Cron('0 2 * * 0') // Weekly on Sunday at 2 AM
  async reportStorageOverhead() {
    try {
      const overhead = await this.temporalService.computeStorageOverhead();

      this.logger.log('Storage overhead report:');
      this.logger.log(
        `  Active size: ${(overhead.activeSize / 1024 / 1024).toFixed(2)} MB`,
      );
      this.logger.log(
        `  History size: ${(overhead.historySize / 1024 / 1024).toFixed(2)} MB`,
      );
      this.logger.log(
        `  Total size: ${(overhead.totalSize / 1024 / 1024).toFixed(2)} MB`,
      );
      this.logger.log(
        `  Overhead: ${overhead.overheadPercentage.toFixed(2)}%`,
      );

      // Alert if overhead > 25%
      if (overhead.overheadPercentage > 25) {
        this.logger.warn(
          `⚠ Storage overhead exceeds 25%! Consider archiving history.`,
        );
      }
    } catch (error) {
      this.logger.error('Storage reporting failed:', error);
    }
  }
}
```

---

## Testing Integration

### 1. Update Test Utilities

Add helpers for temporal testing:

```typescript
// test/helpers/temporal.helpers.ts
import { TemporalService } from '../../src/temporal/temporal.service';

export async function seedProjectWithHistory(
  temporalService: TemporalService,
  projectId: string,
  versions: any[],
) {
  for (const version of versions) {
    await temporalService.recordProjectVersion(projectId, {
      projectId,
      ...version,
    });

    // Wait between versions to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function verifyPointInTimeQuery(
  temporalService: TemporalService,
  entityType: 'project' | 'batch' | 'retirement',
  entityId: string,
  timestamp: Date,
  expectedState: Partial<any>,
) {
  const state = await temporalService.getStateAtTime(
    entityType,
    entityId,
    timestamp,
  );

  expect(state).toBeDefined();
  Object.entries(expectedState).forEach(([key, value]) => {
    expect(state[key]).toEqual(value);
  });

  return state;
}
```

### 2. Add Temporal Test Suite

```typescript
// test/integration/temporal.integration.spec.ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { TemporalService } from '../../src/temporal/temporal.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedProjectWithHistory, verifyPointInTimeQuery } from '../helpers/temporal.helpers';

describe('Temporal Tables Integration', () => {
  let app: INestApplication;
  let temporalService: TemporalService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    temporalService = moduleFixture.get<TemporalService>(TemporalService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.carbonProjectHistory.deleteMany();
    await prisma.carbonProject.deleteMany();
  });

  describe('Point-in-time queries', () => {
    it('should retrieve project state at a past timestamp', async () => {
      const projectId = `temporal-test-${Date.now()}`;

      // Create project
      const project = await prisma.carbonProject.create({
        data: {
          projectId,
          name: 'Initial Name',
          status: 'Pending',
          // ... other required fields
        },
      });

      const createdAt = project.createdAt;

      // Record version
      await temporalService.recordProjectVersion(projectId, {
        projectId,
        name: 'Initial Name',
        status: 'Pending',
        // ...
      });

      // Wait and update
      await new Promise(resolve => setTimeout(resolve, 100));

      const updated = await prisma.carbonProject.update({
        where: { projectId },
        data: { status: 'Active', name: 'Updated Name' },
      });

      await temporalService.recordProjectVersion(
        projectId,
        {
          projectId,
          name: 'Updated Name',
          status: 'Active',
          // ...
        },
        {
          projectId,
          name: 'Initial Name',
          status: 'Pending',
          // ...
        },
      );

      // Query past state
      const pastState = await verifyPointInTimeQuery(
        temporalService,
        'project',
        projectId,
        createdAt,
        { name: 'Initial Name', status: 'Pending' },
      );

      // Query current state
      const currentState = await temporalService.getStateAtTime(
        'project',
        projectId,
        new Date(),
      );

      expect(currentState.name).toBe('Updated Name');
      expect(currentState.status).toBe('Active');
    });

    it('should maintain history across multiple updates', async () => {
      const projectId = `multi-version-${Date.now()}`;

      const versions = [
        { status: 'Pending', name: 'Version 1' },
        { status: 'Active', name: 'Version 2' },
        { status: 'Archived', name: 'Version 3' },
      ];

      await seedProjectWithHistory(
        temporalService,
        projectId,
        versions.map(v => ({ projectId, ...v })),
      );

      const history = await temporalService.getFullHistory('project', projectId);

      expect(history.length).toBe(3);
      expect(history[0].status).toBe('Pending');
      expect(history[1].status).toBe('Active');
      expect(history[2].status).toBe('Archived');
      expect(history[2].ended_at).toBeNull(); // Current version
    });
  });

  describe('Storage overhead', () => {
    it('should compute storage overhead correctly', async () => {
      const overhead = await temporalService.computeStorageOverhead();

      expect(overhead).toHaveProperty('activeSize');
      expect(overhead).toHaveProperty('historySize');
      expect(overhead).toHaveProperty('totalSize');
      expect(overhead).toHaveProperty('overheadPercentage');

      expect(overhead.totalSize).toBe(overhead.activeSize + overhead.historySize);

      // Overhead should be < 30% in well-maintained system
      if (overhead.totalSize > 0) {
        expect(overhead.overheadPercentage).toBeLessThan(30);
      }
    });
  });

  describe('History archival', () => {
    it('should archive old history entries', async () => {
      const projectId = `archival-test-${Date.now()}`;

      // Create old history entry
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 8); // 8 years old

      await prisma.carbonProjectHistory.create({
        data: {
          projectId,
          name: 'Old Version',
          status: 'Pending',
          started_at: oldDate,
          ended_at: new Date(oldDate.getTime() + 86400000), // Next day
          // ... other required fields
        },
      });

      // Archive records older than 7 years
      const sevenYearsAgo = new Date();
      sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

      const deletedCount = await temporalService.archiveHistoryBefore(
        sevenYearsAgo,
        'project',
      );

      expect(deletedCount).toBe(1);

      // Verify it was deleted
      const remaining = await prisma.carbonProjectHistory.findMany({
        where: { projectId },
      });

      expect(remaining.length).toBe(0);
    });
  });
});
```

---

## Performance Verification

### 1. Benchmark Temporal Queries

```bash
# Run performance tests
npm run test -- --testPathPattern="temporal.perf" --coverage=false

# Expected results:
# - getStateAtTime: < 50ms (indexed query)
# - getFullHistory: < 200ms (10-20 versions)
# - Archival job: < 1000ms per 1000 records
```

### 2. Index Coverage

Verify all indexes were created:

```bash
psql -U postgres -d carbonledger << EOF
\dt+ CarbonProjectHistory
\dt+ CreditBatchHistory
\dt+ RetirementRecordHistory
\di+ idx_*
EOF
```

**Expected indexes:**
```
idx_CarbonProjectHistory_projectId_started_at
idx_CarbonProjectHistory_started_at_ended_at
idx_CarbonProjectHistory_ended_at

idx_CreditBatchHistory_batchId_started_at
idx_CreditBatchHistory_projectId_started_at
idx_CreditBatchHistory_ended_at

idx_RetirementRecordHistory_retirementId_started_at
idx_RetirementRecordHistory_projectId_started_at
idx_RetirementRecordHistory_ended_at
```

### 3. Storage Growth Monitoring

```bash
# Monitor monthly
SELECT
  schemaname || '.' || tablename AS table_name,
  (pg_total_relation_size(schemaname || '.' || tablename) / 1024 / 1024)::numeric(10, 2) AS size_mb
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'CarbonProject', 'CreditBatch', 'RetirementRecord',
    'CarbonProjectHistory', 'CreditBatchHistory', 'RetirementRecordHistory'
  )
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;
```

---

## Deployment Checklist

### Pre-Deployment (Staging)

- [ ] Run full test suite: `npm run test`
- [ ] Run E2E tests: `npm run test:e2e`
- [ ] Verify code coverage >= 80%: `npm run test:coverage`
- [ ] Apply migration to staging DB: `npm run prisma migrate deploy`
- [ ] Backfill history tables: `npx ts-node src/database/seeds/backfill-temporal.seed.ts`
- [ ] Run performance tests: Verify query times < thresholds
- [ ] Verify backup exists: `pg_dump ... > backup-$(date +%Y%m%d).sql`

### Production Deployment

**Phase 1: Database**
1. Backup production: `pg_dump > backup-$(date +%Y%m%dT%H%M%S).sql`
2. Apply migration: `npm run prisma migrate deploy`
3. Backfill history: `npx ts-node src/database/seeds/backfill-temporal.seed.ts` (run in off-peak)
4. Verify indexes: `psql -c "\di+" | grep temporal`

**Phase 2: Application Code**
1. Deploy updated services with TemporalService integrated
2. Verify services start: Check logs for errors
3. Run smoke tests: `npm run test:integration`
4. Monitor error rates for 24 hours

**Phase 3: Monitoring**
1. Set up alerts for:
   - Query latency: Temporal queries > 200ms
   - Storage overhead: > 25%
   - Backlog: History archival job failures
2. Weekly storage report cron job: Verify not exceeding 25% overhead
3. Monthly archival job: Verify running successfully

### Rollback Plan

If issues occur:

1. **Immediate (keep service running):**
   - Disable TemporalService integration (queries still work, just no new history)
   - Revert application code to previous commit

2. **Full rollback:**
   - Stop application
   - Run rollback SQL (see [Migration Rollback](#migration-rollback) above)
   - Restore from backup: `psql -d carbonledger < backup-YYYYMMDD.sql`
   - Redeploy previous application version

---

## Support and Troubleshooting

### Common Issues

**Q: History table growing too fast?**
A: Adjust archival frequency or retention window:
```typescript
// More frequent archival (weekly instead of monthly)
@Cron('0 2 * * 0')
async archiveOldHistory() {
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  await this.temporalService.archiveHistoryBefore(tenYearsAgo);
}
```

**Q: Point-in-time queries slow?**
A: Check index creation:
```bash
ANALYZE "CarbonProjectHistory";
EXPLAIN ANALYZE SELECT * FROM "CarbonProjectHistory"
WHERE projectId = 'proj-1' AND started_at <= now() AND (ended_at IS NULL OR ended_at > now());
```

**Q: Backfill timeout on large datasets?**
A: Split backfill into batches:
```typescript
const batchSize = 10000;
for (let i = 0; i < projects.length; i += batchSize) {
  await prisma.carbonProjectHistory.createMany({
    data: projects.slice(i, i + batchSize).map(...),
    skipDuplicates: true,
  });
  console.log(`Backfilled ${i + batchSize} / ${projects.length}`);
}
```

---

## Further Reading

- [Temporal Table Design Patterns](https://en.wikipedia.org/wiki/Temporal_database)
- [PostgreSQL Window Functions](https://www.postgresql.org/docs/15/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS)
- [Prisma Migrations](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [ADR-009: System-Versioned Temporal Tables](./adr/ADR-009-temporal-tables-history.md)
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md)
