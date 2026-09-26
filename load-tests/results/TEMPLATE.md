# Load Test Run — Marketplace Bulk Purchase (#630)

Copy this file to `load-tests/results/bulk-purchase-<YYYY-MM-DD>.md` for each run and fill
in every field below. Keep the raw k6 JSON output alongside it
(`load-tests/results/bulk-purchase-run-<YYYY-MM-DD>.json`, produced via `--out json=...`,
see [How to Run](../RESULTS-bulk-purchase.md#how-to-run)).

## Run metadata

| Field | Value |
|---|---|
| Date | |
| Environment (staging / local / other) | |
| Git commit SHA | |
| Tester | |
| `BASE_URL` used | |
| Buyer identities provisioned (`BUYERS.length`) | |
| Listings seeded | |
| Backend `DB_POOL_MAX` (from `GET /metrics` → `db_pool_max`) | |

## Scenario results

### 1. `single_purchase_baseline` (10 constant VUs, 2 min)

| Metric | Result | Target | Status |
|---|---|---|---|
| p50 latency | | — | |
| p95 latency | | — | |
| p99 latency | | < 500ms | |
| Error rate (5xx) | | < 1% | |

### 2. `concurrent_buyers_100` (ramp 0→100→150→0)

| Metric | Result | Target | Status |
|---|---|---|---|
| p50 latency | | — | |
| p95 latency | | — | |
| p99 latency | | < 500ms | |
| Error rate (5xx) | | < 1% | |
| `db_pool_timeout_errors_total` delta (before → after, from `/metrics`) | | 0 | |
| `db_pool_active_queries` peak observed during scenario | | ≤ `db_pool_max` | |

### 3. `bulk_purchase_stress` (20 VUs, 10-listing batches)

| Metric | Result | Target | Status |
|---|---|---|---|
| p50 latency | | — | |
| p95 latency | | — | |
| p99 latency | | < 500ms | |
| Error rate (5xx) | | < 1% | |

### 4. `rate_limit_exhaustion` (1 buyer, 5 req/s for 90s)

| Metric | Result | Target | Status |
|---|---|---|---|
| Total requests sent | | ~450 | |
| `rate_limit_429_total` | | > 0 (limiter must engage) | |
| Requests returning 5xx instead of 429 | | 0 | |
| `rate_limit_recovered_total` (post-`Retry-After` retry succeeded) | | == `rate_limit_429_total` sampled | |

## Data integrity check

Run after the test to confirm no corruption occurred (adjust table/column names if the
Prisma schema has changed since this template was written):

```sql
SELECT COUNT(*) FROM "MarketListing" WHERE "amountAvailable" < 0;              -- expect 0
SELECT COUNT(*) FROM "MarketListing" WHERE status = 'Sold' AND "amountAvailable" != 0; -- expect 0
```

| Check | Result |
|---|---|
| No negative `amountAvailable` | |
| Sold listings have 0 available | |

## Bottlenecks observed this run

<!-- Fill in anything beyond the DB-connection-pool bottleneck already documented as the
     baseline finding in RESULTS-bulk-purchase.md, or confirm/refute it with real numbers. -->

## Raw k6 summary output

<details>
<summary>k6 stdout</summary>

```
<paste here>
```

</details>
