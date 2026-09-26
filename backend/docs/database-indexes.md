# Database Indexes

The migration `20260828000000_add_query_performance_indexes` adds composite indexes for recurring filter and sort patterns. Column order puts equality filters first and the ordering column last where applicable, allowing PostgreSQL to narrow the index scan before sorting or returning rows.

## Index rationale

| Index | Query pattern | Benefit |
| --- | --- | --- |
| `CarbonProject(status, createdAt)` | `WHERE status = $1 ORDER BY createdAt DESC` | Finds active or pending projects and returns the newest records without scanning all projects or performing a separate sort. |
| `CreditBatch(projectId, status)` | `WHERE projectId = $1 AND status = $2` | Narrows batch availability lookups by project and lifecycle status, which supports project detail and marketplace inventory reads. |
| `RetirementRecord(retiredBy, retiredAt)` | `WHERE retiredBy = $1 ORDER BY retiredAt DESC` | Supports wallet-scoped retirement history and newest-first pagination. |
| `MarketListing(projectId, vintageYear, status)` | `WHERE projectId = $1 AND vintageYear = $2 AND status = $3` | Speeds project/vintage inventory checks while excluding inactive listings through the status predicate. |

The migration uses `CREATE INDEX IF NOT EXISTS` so it is safe to apply when an equivalent index already exists. The companion `rollback.sql` drops these indexes without affecting table data.
