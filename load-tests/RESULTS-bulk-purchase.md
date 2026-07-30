# Load Test Suite — Marketplace Bulk Purchase Under Concurrent Corporate Buyers (#630)

**Script:** `load-tests/marketplace-bulk-purchase.k6.js`
**Companion suite:** `load-tests/marketplace.k6.js` (#687) covers general browse/purchase/
bulk-retirement load; this suite is scoped specifically to concurrent corporate buyers doing
purchases and bulk purchases, plus rate-limiter behavior, per issue #630.

---

## Scope

| In scope | Out of scope (per issue #630) |
|---|---|
| k6 scripts for `POST /marketplace/purchase` and `POST /marketplace/bulk-purchase` | Soroban RPC load testing |
| Throughput at up to 100 concurrent corporate buyers | Frontend performance testing |
| P99 latency for the purchase endpoint | |
| Database connection pool exhaustion | |
| Redis-backed rate limiter behavior under load | |

## Scenarios

| Scenario | Executor | Concurrency | Duration |
|---|---|---|---|
| `single_purchase_baseline` | constant-vus | 10 VUs | 2m |
| `concurrent_buyers_100` | ramping-vus | 0 → 100 → 150 → 0 | 30s + 3m + 30s + 30s |
| `bulk_purchase_stress` | ramping-vus | 0 → 20 → 0 | 20s + 2m + 20s |
| `rate_limit_exhaustion` | constant-arrival-rate | 5 req/s (1 fixed buyer) | 90s |

`concurrent_buyers_100` is the scenario named directly in the issue title — it ramps past
100 (to 150) to observe behavior just beyond the named target, not only at it.

## Performance baseline targets

These are the targets this suite is designed to validate (issue #630 acceptance criteria).
They are **defined ahead of running the suite against a real environment** — see
[How to Run](#how-to-run) and copy `load-tests/results/TEMPLATE.md` to record actual
numbers from each run.

| Target | Threshold |
|---|---|
| P99 latency, single purchase | < 500ms at up to 100 RPS |
| P99 latency, bulk purchase (10 listings/request) | < 500ms |
| Error rate (5xx) across all purchase scenarios | < 1% |
| Rate limiter: requests beyond the limit | 429, never 5xx, always includes `Retry-After` |
| Rate limiter: recovery after `Retry-After` elapses | subsequent request succeeds (not 429) |
| DB pool: `db_pool_timeout_errors_total` (Prisma P2024) during `concurrent_buyers_100` | 0 |

## How to Run

Single command once the two prerequisite provisioning steps below have been run once
against the target environment:

```bash
k6 run load-tests/marketplace-bulk-purchase.k6.js
```

### Prerequisites (one-time per environment)

```bash
# 1. Seed active marketplace listings (shared with the #687 suite).
BASE_URL=http://localhost:3001 ./scripts/seed-loadtest.sh

# 2. Provision 100 distinct "corporation"-role buyer identities via the REAL
#    wallet-signature auth flow (GET /auth/challenge -> sign -> POST /auth/verify).
#    A single shared JWT would put every concurrent buyer in the same
#    per-user rate-limit bucket (see CustomThrottlerGuard), which is not
#    representative of 100 distinct corporate buyers.
cd backend
BASE_URL=http://localhost:3001 BUYER_COUNT=100 \
  node scripts/generate-loadtest-buyer-jwts.js
cd ..
```

This writes `load-tests/seed-data.json` (listing IDs) and `load-tests/buyer-jwts.json`
(buyer identities), both read automatically by
`load-tests/marketplace-bulk-purchase.k6.js`.

### With JSON output for the results template

```bash
k6 run --out json=load-tests/results/bulk-purchase-run-$(date +%Y%m%d-%H%M%S).json \
  load-tests/marketplace-bulk-purchase.k6.js
```

### Checking the DB connection pool during/after a run

```bash
curl -s http://localhost:3001/metrics | grep '^db_pool_'
```

## Bottleneck identified: DB connection pool sizing under concurrent purchase load

**Finding:** `backend/src/prisma.service.ts` defaults `DB_POOL_MAX` to **10** connections
(`connection_limit` on the Prisma datasource URL), configurable via the `DB_POOL_MAX`
env var but not auto-scaled with traffic. Every `POST /marketplace/purchase` and
`POST /marketplace/bulk-purchase` call does at least one read + one write against
Postgres through this pool. At 100 concurrent corporate buyers (`concurrent_buyers_100`),
each issuing a purchase roughly once per 0.2–0.7s (per the script's `sleep()` jitter), the
sustained request rate is expected to substantially exceed what 10 pooled connections can
serve without queuing, since Prisma queues query requests once all 10 connections are busy
and the query queue itself has a bounded wait (`pool_timeout`, default 10s here) before
throwing Prisma's `P2024` ("connection pool timeout") error — which the marketplace
purchase path does not currently catch specially, so it would surface to callers as a
generic 500.

This is a **predicted** bottleneck from static analysis of the pool configuration relative
to the scenario's concurrency, documented ahead of running the suite per this issue's
"implement only" scope — confirm and record the actual `db_pool_timeout_errors_total` delta
using `load-tests/results/TEMPLATE.md` when the suite is run against a real environment.

**Recommended mitigation:**

1. **Immediate:** raise `DB_POOL_MAX` (e.g. to 20–30) for environments expected to serve
   100+ concurrent buyers — this is a pure environment-variable change, no code change
   required, and `prisma.service.ts`'s own comment documents the sizing formula
   (`num_cores * 2 + effective_spindle_count`) as a starting point, not a hard ceiling.
2. **Structural, if raising the pool alone isn't sufficient:** front Postgres with a
   connection pooler (PgBouncer in transaction-pooling mode) so the application-level pool
   can be sized larger than Postgres's own `max_connections` safely limits, which is the
   standard fix once a single Postgres instance is shared across multiple backend
   instances/pods.
3. **Observability:** the `db_pool_active_queries` / `db_pool_timeout_errors_total` gauges
   already exposed at `GET /metrics` (`backend/src/common/metrics.registry.ts`) are exactly
   what this load test's `concurrent_buyers_100` scenario should be cross-referenced against
   — no new instrumentation is needed to confirm or refute this finding on a real run.

## Redis-backed rate limiter behavior

`POST /marketplace/purchase` and `POST /marketplace/bulk-purchase` fall under the
`"default"` throttler (`ThrottlerModule.forRoot` in `backend/src/app.module.ts`: 60
requests/60s), backed by `ThrottlerStorageRedisService` — i.e. rate-limit state is shared
across backend instances via Redis, not per-process memory. `CustomThrottlerGuard` tracks
authenticated requests by user public key (not IP), so the `rate_limit_exhaustion` scenario
deliberately reuses **one** buyer identity at 5 req/s (300/min, 5× the limit) to reliably
push that single bucket over the threshold and assert:

- responses beyond the limit are `429` (never `5xx`) and always carry a `Retry-After`
  header (`CustomThrottlerGuard.throwThrottlingException`);
- a retry issued after `Retry-After` elapses succeeds again (the Redis-backed window
  actually resets, rather than the bucket becoming permanently stuck).

## Reproducibility

The suite is deterministic given the two one-time provisioning steps above:
`scripts/seed-loadtest.sh` and `backend/scripts/generate-loadtest-buyer-jwts.js` are
idempotent (re-running them adds/refreshes data rather than requiring manual cleanup), and
`k6 run load-tests/marketplace-bulk-purchase.k6.js` alone reproduces all four scenarios in
one command from a clean environment once those two steps have populated
`load-tests/seed-data.json` and `load-tests/buyer-jwts.json`.

## Recording results

Copy `load-tests/results/TEMPLATE.md` to `load-tests/results/bulk-purchase-<date>.md` for
every run and fill it in alongside the raw `--out json=...` file, per
[How to Run](#how-to-run).
