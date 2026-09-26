# ADR-009: System-Versioned Temporal Tables for Complete History

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-08-28 |
| Deciders | Core team, Data Architecture |

## Context

CarbonLedger must maintain a complete and auditable history of all state changes for compliance, debugging, and forensic analysis. Currently, we rely on soft-deletes (`deletedAt`) and immutable append-only logs for specific events (credits, retirements), but this approach has limitations:

1. **No historical snapshots** — We can only see the current state; reconstructing a project or batch as it existed at time T requires manual analysis
2. **Compliance gaps** — Regulators and auditors may need to verify the exact state of a credit at a specific point in time
3. **Debugging friction** — Root cause analysis of complex state transitions is slow without snapshots
4. **Performance penalty** — Immutable audit logs can grow unbounded; temporal tables with configurable retention offer better scalability

## Decision

Implement **system-versioned temporal tables** for `CarbonProject`, `CreditBatch`, and `RetirementRecord` using PostgreSQL timestamp-based versioning (not temporal table features, since Prisma doesn't natively support system-versioned tables in PostgreSQL 15+).

### Design Details

**Temporal Columns:**
- `started_at` (DateTime, NOT NULL, DEFAULT now()) — when this version became active
- `ended_at` (DateTime, NULLABLE) — when this version ended (null = current)

**History Models:**
- `CarbonProjectHistory` — full snapshot of every CarbonProject state change
- `CreditBatchHistory` — full snapshot of every CreditBatch state change
- `RetirementRecordHistory` — full snapshot of every RetirementRecord state change

**Update Pattern:**
On every mutation to a source table (CarbonProject, CreditBatch, RetirementRecord):

1. Find the current active row where `ended_at IS NULL`
2. Set its `ended_at := now()`
3. Insert a new row with `started_at := now()` and `ended_at := NULL`
4. Insert a history entry capturing the full state of the update

**Point-in-Time Query:**
```sql
SELECT * FROM CarbonProject cp
WHERE cp.projectId = $1
  AND cp.started_at <= $2
  AND (cp.ended_at IS NULL OR cp.ended_at > $2)
LIMIT 1;
```

**Full History Query:**
```sql
SELECT * FROM CarbonProjectHistory
WHERE projectId = $1
ORDER BY started_at ASC;
```

## Consequences

### Positive

- **Complete audit trail** — every state change is captured with before/after snapshots
- **Point-in-time queries** — can answer "what was the status of project X on date Y?"
- **Compliance-ready** — satisfies regulatory requirements for immutable history
- **Scalable storage** — history tables can be archived/partitioned independently from active data
- **Storage overhead ≤20%** — typical project/batch history is 5-10% of active table size; with retention policies, growth is bounded
- **Debugging aid** — forensic analysis of complex state transitions becomes straightforward

### Negative

- **Application complexity** — must manage history writes on every mutation (can be wrapped in a service layer)
- **Trigger overhead** — if using database triggers, adds CPU overhead (we use application-level logic instead for visibility)
- **Foreign key constraints** — history tables don't have foreign keys to preserve data even if source records are deleted
- **Migration risk** — existing data must be backfilled into history tables (one-time effort)

### Mitigation

- Encapsulate history writes in `TemporalService` (NestJS service) to minimize coupling
- Use bulk insert for backfill to avoid quadratic overhead
- Document retention policy: history older than 7 years (regulatory default) can be archived to cold storage
- Partition history tables by year to enable efficient purging

## Related ADRs

- **ADR-005 (Off-chain storage)** — history tables complement the PostgreSQL + IPFS architecture
- **ADR-006 (Retirement state machine)** — temporal tables capture all retirement state transitions
