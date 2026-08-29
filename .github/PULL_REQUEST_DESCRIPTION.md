## Description

Four backend improvements landing in a single PR: connection pool observability wired into Prometheus, audit log tamper-evidence unit tests, PostgreSQL full-text search extended to retirements, and GraphQL module fixes for correct dependency injection.

## Type of Change

- [x] New feature (non-breaking change which adds functionality)
- [x] Bug fix (non-breaking change which fixes an issue)

## Related Issues

Closes #673
Closes #674
Closes #670
Closes #672

## Changes by Issue

### #673 — Connection pool Prometheus metrics

`PrismaService` now calls `poolMetricsRegistry.update()` on every query start, finish, and P2024 error, and once more at `onModuleInit` so static config gauges (`db_pool_max`, `db_pool_timeout_ms`, `db_pool_connect_timeout_s`) are non-zero before the first query lands. The `/metrics` endpoint was already wired; it was just reading stale defaults.

Files changed:
- `src/prisma.service.ts` — import `poolMetricsRegistry`, call `update()` in middleware and `onModuleInit`

### #674 — Audit log tamper-evidence unit tests

The `AuditService.createLog` + `verifyChain` implementation (hash-chaining, migration) was already complete. Added a dedicated spec covering the five key scenarios: empty log passes, valid 5-entry chain passes, legacy null-hash rows are skipped, a tampered field is detected, and a deleted middle entry (chain gap) is detected.

Files changed:
- `src/audit/audit.service.spec.ts` — new file, 6 test cases

### #670 — Full-text search extended to retirements

Projects already had `GET /projects/search` backed by the `searchVector` tsvector GIN index. Retirements now have the same: `searchRetirements()` in `RetirementsService` issues a parameterised raw query using `plainto_tsquery` over the retirement `searchVector` column (beneficiary + retirementReason), falls back to the ORM path when no `search` param is given, and scopes results to the authenticated caller. The new `GET /retirements/search` REST endpoint and `searchRetirements` GraphQL query both delegate to this method.

Files changed:
- `src/retirements/retirements.service.ts` — add `searchRetirements()`
- `src/retirements/retirements.controller.ts` — add `GET /retirements/search`
- `src/graphql/resolvers/retirements.resolver.ts` — add `searchRetirements` query

### #672 — GraphQL dependency injection fix

`RetirementsModule` had no `exports` array, so `RetirementsService` was not available to the `GraphqlModule` that imports it. Added `exports: [RetirementsService]`. All three resolvers (projects, credits, retirements) and their types were already fully implemented.

Files changed:
- `src/retirements/retirements.module.ts` — add `exports: [RetirementsService]`

## Testing Done

- [x] Unit tests pass — `audit.service.spec.ts` covers all five chain-verification scenarios
- [x] Existing `credits.invariants.spec.ts` and `prisma.pool.spec.ts` are unaffected
- [x] Pool metrics: `db_pool_max`, `db_pool_active_queries`, `db_pool_total_queries_total`, `db_pool_timeout_errors_total`, and `db_pool_utilization` are all live-updated at `/metrics` after these changes
- [x] No breaking changes to existing REST API contracts

## Notes

The `RetirementRecord.searchVector` tsvector column and its GIN index were added in migration `20260727000001_add_fulltext_search`. The pool-metrics Prometheus gauges and the audit hash-chain schema columns were added in prior migrations. No new migrations are required for this PR.
