# CarbonLedger — Prisma Seed & Test Data Factory

`seed.ts` populates a local PostgreSQL database with a complete, realistic carbon credit
dataset suitable for development, manual testing, and CI integration tests.

---

## Quick Start

```bash
# From the backend/ directory
npx prisma db seed

# Or run directly with ts-node
npx ts-node prisma/seed.ts
```

The seed typically completes in **under 10 seconds** on a local PostgreSQL instance.

---

## Dataset Overview

| Entity                  | Count  | Notes                                                      |
|-------------------------|--------|------------------------------------------------------------|
| Users (verifiers)       | 3      | role = `"verifier"`, each with a VerifierApplication      |
| Users (corporations)    | 5      | role = `"corporation"`, used as buyers/retirees            |
| CarbonProject           | 10     | 2 per methodology, varied statuses                         |
| CreditBatch             | 100    | 10 per project, non-overlapping serial ranges              |
| RetirementRecord        | 20     | Only from Verified/Completed project batches               |
| RetirementCertificate   | 20     | One per retirement, with fake IPFS CIDs and public URLs    |
| MarketListing           | ≤ 50   | Only from Active batches of live projects                  |
| MonitoringData          | 10     | One record per project                                     |
| VerifierApplication     | 3      | Pre-approved, one per verifier user                        |

### Project Statuses (coverage of all permutations)

| Status      | Count |
|-------------|-------|
| `Verified`  | 4     |
| `Pending`   | 2     |
| `Rejected`  | 2     |
| `Suspended` | 1     |
| `Completed` | 1     |

### Batch Statuses

- `Active` — standard tradeable batch
- `Retired` — first 1–2 batches of projects that have retirements
- `Pending` — all batches of Pending/Rejected projects

### Listing Statuses

- `Active` — 4 out of 5 listings
- `Inactive` — every 5th listing (for filter/pagination coverage)

### Retirement Validity

- `isValid = true` — 19 out of 20 retirements
- `isValid = false` — 1 retirement (index 10), representing a tampered/unverified certificate

---

## Methodologies

The 10 projects are split evenly across 5 methodologies:

| Methodology    | Code | Projects |
|----------------|------|----------|
| REDD+          | RDD  | 1, 2     |
| VCS            | VCS  | 3, 4     |
| Gold Standard  | GSF  | 5, 6     |
| CDM            | CDM  | 7, 8     |
| ACR            | ACR  | 9, 10    |

---

## Serial Number Format

Credit batch serial numbers follow this scheme:

```
CL-{vintageYear}-{methodologyCode}-{serialNumber:06d}

Examples:
  CL-2020-RDD-000001   (first credit in batch 1, REDD+ 2020 vintage)
  CL-2022-VCS-010000   (last credit in batch 10, VCS 2022 vintage)
```

Within each project, batches have non-overlapping ranges:
- Batch 1: serials 000001–001000
- Batch 2: serials 001001–002000
- …
- Batch 10: serials 009001–010000

---

## Determinism

All data is generated using a **seeded linear congruential generator (LCG)** with seed `42`.
The same seed always produces the exact same dataset. To change the dataset, update the
`SEED` constant at the top of `seed.ts`.

```ts
// backend/prisma/seed.ts
const SEED = 42;  // ← change this for a different but still deterministic dataset
```

---

## Using Factory Functions in Tests

All factory functions are exported and can be used in unit/integration tests without
running the full seed:

```ts
import {
  makeProject,
  makeBatch,
  makeBatches,
  makeRetirement,
  makeListing,
  makeMonitoring,
  makeVerifier,
  makeUser,
} from '../prisma/seed';
import { Decimal } from '@prisma/client/runtime/library';

// Build a single project fixture
const project = makeProject(1, 'REDD+', 'Verified');

// Build 10 batches for it
const batches = makeBatches(project);

// Build a retirement from the first batch
const retirement = makeRetirement(1, batches[0], 'GCORPUSERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

// Build a marketplace listing
const listing = makeListing(1, project, batches[1], 'GCORPUSERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
```

### In NestJS spec files

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { makeProject, makeBatches } from '../../prisma/seed';

describe('CreditsService', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    // Create fixture project
    const projectData = makeProject(99, 'VCS', 'Verified');
    await prisma.carbonProject.create({ data: projectData });
  });
});
```

---

## Customizing the Seed

### Add more projects

```ts
// In main() after the METHODOLOGIES loop
const extraProject = makeProject(11, 'REDD+', 'Verified');
await prisma.carbonProject.upsert({ where: { projectId: extraProject.projectId }, ... });
```

### Change batch size

The `makeBatches()` function uses a fixed `batchSize = 1000`. To change it:

```ts
export function makeBatches(project: ProjectData, batchSize = 500): BatchData[] {
```

### Override specific fields

Factory functions return plain objects — override any field before calling Prisma:

```ts
const project = makeProject(1, 'VCS', 'Verified');
project.methodologyScore = 95;           // override score
project.country = 'Brazil';              // override country
await prisma.carbonProject.create({ data: project });
```

---

## Re-running the Seed

The seed is **idempotent** — all writes use `upsert()` with the entity's unique key.
You can safely re-run it at any time; existing records will be left unchanged (update
clauses only modify mutable fields like `status` and aggregate counts).

```bash
# Reset the DB and re-seed from scratch
npx prisma migrate reset --force
npx prisma db seed
```

---

## Schema Requirements

The seed expects `metadataHash String?` on `CarbonProject`. This field was added as part
of the IPFS Content Integrity feature (Issue #2). If you are running on an older schema
version, apply the migration first:

```bash
npx prisma migrate dev --name add_metadata_hash
```

Or manually:

```sql
ALTER TABLE "CarbonProject" ADD COLUMN "metadataHash" TEXT;
```
