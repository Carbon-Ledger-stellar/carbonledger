# Database Query Optimization — Issue #1068

## Overview

This document describes the database indexes added in migration
`20260828000000_add_performance_indexes` to address the query patterns
identified in issue #1068.  It also records the analysis of
`MarketplaceSearchService` and documents architectural decisions.

---

## Problem Statement

As the CarbonLedger marketplace grows, several hot query paths execute full or
near-full table scans because the database lacks targeted indexes for the most
common filter and aggregation patterns.  The affected paths are:

| Endpoint / Worker | Table | Missing Index |
|---|---|---|
| `GET /marketplace` (browse) | `MarketListing` | `status` |
| `GET /marketplace` (faceted search) | `MarketListing` | `(status, methodology)`, `(status, vintageYear)`, `(status, country)` |
| `DELETE /marketplace/:id` (delist ABAC check) | `MarketListing` | `seller` |
| `GET /marketplace` (project scope) | `MarketListing` | `(projectId, status)` |
| `GET /marketplace` (price range) | `MarketListing` | `(status, pricePerCredit)` |
| Retirement leaderboard | `RetirementRecord` | `beneficiary` |
| Certificate generation worker | `RetirementRecord` | `certificateStatus` |
| `GET /projects` (developer role) | `CarbonProject` | `ownerAddress` |

---

## Indexes Added

### MarketListing

#### `MarketListing_status_idx` — `(status)`

**Query pattern:**
```sql
WHERE status = ANY('{Active,PartiallyFilled}'::text[])
```

**Rationale:** Every public marketplace browse request filters by listing
status.  Without this index, Postgres scans the entire `MarketListing` table
to find active listings.  This is the single highest-impact index in this
migration.

---

#### `MarketListing_status_methodology_idx` — `(status, methodology)`

**Query pattern:**
```sql
WHERE ml."status" = ANY($1::text[]) AND ml."methodology" = ANY($2::text[])
```

**Rationale:** Methodology is the primary facet used to narrow marketplace
results (e.g. "show me only REDD+ credits").  The composite index on
`(status, methodology)` eliminates full-status-scan rows before applying the
methodology filter, and covers the common case where both filters are present.

---

#### `MarketListing_status_vintageYear_idx` — `(status, vintageYear)`

**Query pattern:**
```sql
WHERE ml."status" = ANY($1::text[]) AND ml."vintageYear" = ANY($2::int[])
```

**Rationale:** Vintage year filtering is the second most common facet.
Composite with `status` ensures rows inactive listings are pruned first.

---

#### `MarketListing_status_country_idx` — `(status, country)`

**Query pattern:**
```sql
WHERE ml."status" = ANY($1::text[]) AND ml."country" = ANY($2::text[])
```

**Rationale:** Country-of-origin filtering supports geographic ESG compliance
requirements (e.g. "only credits from Brazil").

---

#### `MarketListing_seller_idx` — `(seller)`

**Query pattern:**
```sql
-- ABAC ownership check before delist
WHERE seller = $1
-- My Listings page (seller-scoped browse)
WHERE seller = $1 AND status = ANY(...)
```

**Rationale:** The delist endpoint must verify the caller owns the listing
before mutating it.  An index on `seller` makes this a single-row index lookup
rather than a table scan.  The existing `(seller, status)` composite index
handles the "My Listings" use case; the single-column `seller` index handles
the standalone ownership check.

---

#### `MarketListing_projectId_status_idx` — `(projectId, status)`

**Query pattern:**
```sql
WHERE projectId = $1 AND status = $2
```

**Rationale:** Project developers view all active listings for their projects.
Admins scan for listings tied to a suspended project.  The composite index
satisfies both patterns with a single efficient lookup.

---

#### `MarketListing_status_pricePerCredit_idx` — `(status, pricePerCredit)`

**Query pattern:**
```sql
-- Price-range filter in MarketplaceSearchService
WHERE CAST(ml."pricePerCredit" AS NUMERIC) >= $minPrice::numeric
  AND CAST(ml."pricePerCredit" AS NUMERIC) <= $maxPrice::numeric
```

**Rationale:** `pricePerCredit` is stored as `TEXT` to preserve full decimal
precision without floating-point rounding.  The index is on the raw text
column; Postgres uses it to restrict to `status = 'Active'` rows first, then
applies the `CAST` on the reduced result set.  For workloads that filter on
price alone (without a status filter), a functional index on
`CAST(pricePerCredit AS NUMERIC)` would be more efficient, but that requires a
schema-level expression index not yet adopted.  This B-tree index on the text
column still reduces the scan significantly by combining it with the status
prefix.

---

### RetirementRecord

#### `RetirementRecord_beneficiary_idx` — `(beneficiary)`

**Query pattern:**
```sql
-- Leaderboard aggregation
SELECT beneficiary, SUM(amount) AS totalRetired, COUNT(*) AS retirementCount
FROM "RetirementRecord"
WHERE deletedAt IS NULL
GROUP BY beneficiary
ORDER BY totalRetired DESC
LIMIT 10;
```

**Rationale:** The leaderboard is a frequently-polled endpoint.  Without the
index, the `GROUP BY beneficiary` forces a sequential scan and an in-memory
hash aggregate over the entire retirements table.  The index allows an
index-based group scan.

---

#### `RetirementRecord_certificateStatus_idx` — `(certificateStatus)`

**Query pattern:**
```sql
-- Certificate generation worker poll
WHERE certificateStatus = 'pending_certificate'
  AND certificateRetries < 3
  AND deletedAt IS NULL
ORDER BY retiredAt ASC
LIMIT 50;
```

**Rationale:** The certificate worker runs on a tight poll interval and must
quickly find the next batch of retirements needing a certificate.  Without the
index, each poll is a full table scan.

---

### CarbonProject

#### `CarbonProject_ownerAddress_idx` — `(ownerAddress)`

**Query pattern:**
```sql
-- project_developer role scoping
WHERE ownerAddress = $1 AND deletedAt IS NULL
ORDER BY createdAt DESC
```

**Rationale:** Project developers can only see their own projects.  The ABAC
guard injects `ownerAddress = $caller` into every project list query.  Without
the index this forces a full scan of `CarbonProject` on every page load for
any developer.

---

## MarketplaceSearchService — Analysis

`backend/src/marketplace/marketplace-search.service.ts` was reviewed for
query patterns and optimization opportunities.

### What the service does well

1. **Parallel data + count queries** — The service issues `selectSQL` and
   `countSQL` in a `Promise.all`, so the total response time is
   `max(data_latency, count_latency)` rather than `sum(...)`.  This is the
   correct pattern.

2. **Parameterised raw SQL** — All user-supplied values are bound parameters
   (`$1`, `$2`, …).  The only interpolated values are the `ORDER BY` clause
   (validated against an enum allowlist) and `LIMIT` (a validated integer).
   No SQL injection surface.

3. **Cursor-based pagination** — Uses keyset pagination (`id > $cursor`) rather
   than `OFFSET`, which avoids the deep-offset performance cliff on large
   result sets.

4. **Facet order** — The `WHERE` clause places the most selective filters
   (full-text `searchVector`, then methodology/vintage/country enum arrays)
   before the less-selective `status` filter.  This is correct for the
   full-text search path.

### Identified issues and recommendations

#### Issue 1 — COUNT query duplicates the full join and filter

The `countSQL` query re-executes the same `LEFT JOIN "CarbonProject"` and
identical `WHERE` clause as `selectSQL`.  For large result sets, this is a
significant extra cost.

**Current pattern:**
```sql
-- selectSQL
SELECT ml.*, ... FROM "MarketListing" ml
LEFT JOIN "CarbonProject" cp ON cp."projectId" = ml."projectId"
WHERE <conditions>
ORDER BY ... LIMIT 21;

-- countSQL (runs in parallel, but same cost)
SELECT COUNT(*)::bigint AS count FROM "MarketListing" ml
LEFT JOIN "CarbonProject" cp ON cp."projectId" = ml."projectId"
WHERE <conditions>;
```

**Recommendation:** For the status-only or status+facet query paths (which do
not use full-text `searchVector` from `CarbonProject`), the `COUNT` query can
drop the `LEFT JOIN` entirely since no `CarbonProject` column appears in the
`WHERE` clause outside of the full-text search path:

```sql
-- Optimised countSQL when search=null (no full-text filter)
SELECT COUNT(*)::bigint AS count
FROM "MarketListing" ml
WHERE <conditions>;  -- no join needed when searchVector not in WHERE
```

This halves the cost of the count query for the common faceted (non-search)
path.  Implementation requires splitting the count query into two variants
based on whether `search` is set.

#### Issue 2 — Price range cast prevents index use on pricePerCredit

The price range filter casts `pricePerCredit` to `NUMERIC` inline:

```sql
CAST(ml."pricePerCredit" AS NUMERIC) >= $N::numeric
```

A B-tree index on the `TEXT` column cannot satisfy this predicate because the
sort order of text differs from numeric order.  The new `(status, pricePerCredit)`
index added in this migration helps with equality + status prefix filtering, but
does not eliminate the cast cost for range scans.

**Recommendation (future work):** Add a generated/computed column
`pricePerCreditNumeric NUMERIC GENERATED ALWAYS AS (CAST(pricePerCredit AS NUMERIC)) STORED`
and index that column.  This moves the cast cost to write time and allows the
range predicate to use a standard B-tree range scan at read time.

#### Issue 3 — Relevance sort re-computes ts_rank twice

When `sortBy = 'relevance'`, the `ORDER BY` clause recomputes
`ts_rank(ml."searchVector", ...)` over the entire result set even though it
was already computed in the `SELECT` list as the `rank` alias.  Postgres does
not automatically deduplicate these two expressions.

**Recommendation:** Reference the computed alias in the `ORDER BY` or use a
subquery/CTE to compute rank once:

```sql
-- Wrap in a CTE to compute rank once
WITH ranked AS (
  SELECT ml.*, ts_rank(ml."searchVector", query) AS rank, ...
  FROM "MarketListing" ml, plainto_tsquery('english', $1) query
  WHERE ml."searchVector" @@ query ...
)
SELECT * FROM ranked ORDER BY rank DESC, createdAt DESC LIMIT 21;
```

---

## Migration Strategy

All indexes are created with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`:

- **CONCURRENTLY** — avoids taking an `ACCESS EXCLUSIVE` lock.  The table
  remains fully readable and writable during the index build, which is
  critical for a live production database.
- **IF NOT EXISTS** — makes the migration idempotent.  Re-running the
  migration on a database that already has these indexes is a no-op.
- **No transaction wrapper** — `CONCURRENTLY` cannot run inside a transaction
  block.  The migration file is marked with
  `@migration-strategy: no-transaction` so Prisma does not wrap it.

---

## Performance Impact Estimates

These estimates assume table sizes at moderate scale (100k listings,
500k retirements, 10k projects).  Actual numbers will vary.

| Query | Before | After (estimated) |
|---|---|---|
| Marketplace browse (status filter) | Full scan ~100k rows | Index scan ~2–5k rows |
| Faceted search (status + methodology) | Full scan ~100k rows | Index scan ~500–2k rows |
| Delist ABAC check | Full scan ~100k rows | Index scan 1 row |
| Leaderboard GROUP BY beneficiary | Full scan + hash agg ~500k rows | Index scan + stream agg |
| Certificate worker poll | Full scan ~500k rows | Index scan ~50–200 rows |
| Developer project list | Full scan ~10k rows | Index scan ~10–100 rows |

---

*Added as part of issue #1068 — Database Query Optimization.*
*Migration: `20260828000000_add_performance_indexes`*
