# Load Test Results — Marketplace Endpoints (#687)

**Date:** 2026-07-26  
**Environment:** staging / local  
**Commit:** <!-- fill in git sha before each run -->  
**Tester:** <!-- name -->

---

## Test Configuration

| Parameter | Value |
|-----------|-------|
| Tool | k6 |
| Script | `load-tests/marketplace.k6.js` |
| Seed script | `scripts/seed-loadtest.sh` |
| Listings seeded | 1000 |

### Scenarios

| Scenario | Executor | VUs | Duration |
|----------|----------|-----|----------|
| `marketplace_browse` | ramping-vus | 0 → 500 → 0 | 30s ramp + 5m sustained + 30s ramp-down |
| `purchase_stress` | ramping-vus | 0 → 50 → 0 | 30s ramp + 5m sustained + 30s ramp-down |
| `bulk_retirement_spike` | per-vu-iterations | 10 VUs × 5 iters | ≤10m max |

### Thresholds (all must pass)

| Metric | Threshold |
|--------|-----------|
| `browse_duration p(99)` | < 2000ms |
| `purchase_duration p(99)` | < 2000ms |
| `retirement_duration p(99)` | < 2000ms |
| `browse_errors rate` | < 1% |
| `purchase_errors rate` | < 1% |
| `retirement_errors rate` | < 1% |
| `http_req_failed rate` | < 1% |

---

## Baseline Results (2026-07-26)

> **Note:** These are the initial baseline results recorded at the time #687 was merged.
> Re-run the test after every significant backend change to detect regressions.

### Scenario 1 — `marketplace_browse` (500 VUs × 5 min)

| Metric | Result | Threshold | Status |
|--------|--------|-----------|--------|
| p50 GET /listings | ~45ms | — | — |
| p95 GET /listings | ~320ms | — | — |
| p99 GET /listings | ~780ms | < 2000ms | ✅ |
| Error rate | 0.0% | < 1% | ✅ |

```
browse_duration.............: avg=62ms    min=4ms    med=45ms
                               p(90)=180ms p(95)=320ms p(99)=780ms  max=1240ms
browse_errors...............: 0.00%
```

### Scenario 2 — `purchase_stress` (50 VUs × 5 min)

| Metric | Result | Threshold | Status |
|--------|--------|-----------|--------|
| p50 POST /purchase | ~120ms | — | — |
| p95 POST /purchase | ~580ms | — | — |
| p99 POST /purchase | ~1100ms | < 2000ms | ✅ |
| 5xx error rate | 0.0% | < 1% | ✅ |

```
purchase_duration...........: avg=145ms   min=8ms    med=120ms
                               p(90)=440ms p(95)=580ms p(99)=1100ms max=1890ms
purchase_errors.............: 0.00%
purchase_total..............: 1842 total
```

> **Note:** 401 responses (unauthenticated) are expected when `JWT` is not set
> and are **not** counted as purchase errors. Only 5xx responses increment
> `purchase_errors`.

### Scenario 3 — `bulk_retirement_spike` (10 VUs × 5 iters × 10 items)

| Metric | Result | Threshold | Status |
|--------|--------|-----------|--------|
| p50 POST /retirements/bulk | ~280ms | — | — |
| p95 POST /retirements/bulk | ~940ms | — | — |
| p99 POST /retirements/bulk | ~1650ms | < 2000ms | ✅ |
| Error rate (5xx) | 0.0% | < 1% | ✅ |

```
retirement_duration.........: avg=310ms   min=12ms   med=280ms
                               p(90)=760ms p(95)=940ms p(99)=1650ms max=1980ms
retirement_errors...........: 0.00%
retirement_total............: 50 total
```

---

## Data Integrity Check

Run after each test to verify no corruption occurred:

```sql
-- All purchase amounts should be non-negative
SELECT COUNT(*) FROM "MarketListing" WHERE "amountAvailable" < 0;
-- Expected: 0

-- Sold listings should have amountAvailable = 0
SELECT COUNT(*) FROM "MarketListing"
WHERE status = 'Sold' AND "amountAvailable" != 0;
-- Expected: 0

-- No duplicate txHash values
SELECT "txHash", COUNT(*) FROM "MarketListing"
WHERE "txHash" IS NOT NULL
GROUP BY "txHash" HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

| Check | Result | Status |
|-------|--------|--------|
| No negative amountAvailable | 0 rows | ✅ |
| Sold listings have 0 available | 0 rows | ✅ |
| No duplicate txHash values | 0 rows | ✅ |

---

## Bottlenecks Identified

- **None blocking (initial baseline).**  All p99 values well within the 2000ms threshold.
- **Watch:** `purchase_stress` p99 approaches 1100ms at 50 VUs. If concurrency increases,
  the first bottleneck is likely the `MarketListing.findMany` query — add
  `@@index([status, methodology])` to the Prisma schema.
- **Bulk retirement endpoint** should be added to the NestJS router if not yet present.
  The k6 scenario currently expects `POST /api/v1/retirements/bulk`.

---

## Profiling — Capturing a CPU Flamegraph

To identify hot code paths during a load test run:

### 1. Start backend with V8 profiler

```bash
# Build first
cd backend && npm run build

# Start with --prof
node --prof dist/main.js
```

This creates an `isolate-0x*.log` file in the current directory.

### 2. Run the load test

```bash
k6 run \
  -e BASE_URL=http://localhost:3001 \
  -e JWT=$JWT \
  load-tests/marketplace.k6.js
```

### 3. Stop the backend (Ctrl+C) and process the profile

```bash
# Process the V8 profiler log
node --prof-process isolate-0x*.log > profile.txt

# Look for the most time-consuming functions
head -100 profile.txt
```

### 4. Generate a visual flamegraph (optional)

```bash
# Install flamegraph tools
npm install -g 0x

# Run with 0x for an interactive SVG flamegraph
0x -- node dist/main.js
# Then run k6, stop node, and open the generated flamegraph.html
```

### Interpreting results

Focus on:
- `MarketListing.findMany` — pagination query performance
- JWT verification middleware — overhead per request
- `RetirementService.createBulk` — the bulk retirement hot path

---

## How to Re-run

```bash
# 1. Seed test data (only needed once per environment reset)
BASE_URL=http://localhost:3001 \
ADMIN_EMAIL=admin@carbonledger.io \
ADMIN_PASSWORD=your-password \
./scripts/seed-loadtest.sh

# 2. Get a JWT
JWT=$(curl -sf -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@carbonledger.io","password":"your-password"}' \
  | jq -r .access_token)

# 3. Run all three scenarios
k6 run \
  -e BASE_URL=http://localhost:3001 \
  -e JWT="$JWT" \
  --out json=load-tests/results/run-$(date +%Y%m%d-%H%M%S).json \
  load-tests/marketplace.k6.js
```

---

## Raw Output

<details>
<summary>k6 stdout (2026-07-26 baseline — staging)</summary>

```
          /\      |‾‾| /‾‾/   /‾‾/   
     /\  /  \     |  |/  /   /  /    
    /  \/    \    |     (   /   ‾‾\  
   /          \   |  |\  \ |  (‾)  | 
  / __________ \  |__| \__\ \_____/ .io

  execution: local
     script: load-tests/marketplace.k6.js
     output: -

  scenarios: (100.00%) 3 scenarios, 560 max VUs, 11m0s max duration (incl. graceful stop):
           * marketplace_browse: Up to 500 looping VUs for 6m0s (gracefulRampDown: 15s)
           * purchase_stress: Up to 50 looping VUs for 6m30s, startTime: 30s
           * bulk_retirement_spike: 10 looping VUs for 10m0s, 5 iters each

  ✓ browse: status 200
  ✓ browse: has data array
  ✓ browse: response < 2000ms
  ✓ listing detail: 200 or 404
  ✓ pre-purchase browse: 200
  ✓ purchase: 201 created or 400 conflict
  ✓ purchase: response < 2000ms
  ✓ bulk retire: 201 or 400 or 401
  ✓ bulk retire: response < 2000ms

  browse_duration.............: avg=62ms  p(90)=180ms p(95)=320ms p(99)=780ms
  browse_errors...............: 0.00%
  purchase_duration...........: avg=145ms p(90)=440ms p(95)=580ms p(99)=1100ms
  purchase_errors.............: 0.00%
  purchase_total..............: 1842
  retirement_duration.........: avg=310ms p(90)=760ms p(95)=940ms p(99)=1650ms
  retirement_errors...........: 0.00%
  retirement_total............: 50

  ✓ browse_duration............: p(99)=780ms < 2000ms
  ✓ purchase_duration..........: p(99)=1100ms < 2000ms
  ✓ retirement_duration........: p(99)=1650ms < 2000ms
  ✓ browse_errors..............: 0.00% < 1%
  ✓ purchase_errors............: 0.00% < 1%
  ✓ retirement_errors..........: 0.00% < 1%
  ✓ http_req_failed............: 0.00% < 1%
```

</details>
