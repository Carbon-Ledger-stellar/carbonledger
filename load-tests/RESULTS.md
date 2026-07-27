# Load Test Results — Marketplace Endpoints (#93)

**Date:** <!-- YYYY-MM-DD -->  
**Environment:** <!-- staging / local -->  
**Commit:** <!-- git sha -->  
**Tester:** <!-- name -->

---

## Test Configuration

| Parameter | Value |
|-----------|-------|
| Tool | k6 |
| Script | `load-tests/marketplace.k6.js` |
| VUs | 500 (sustained) |
| Duration | 5 minutes (+ 30s ramp-up / 30s ramp-down) |
| Target endpoints | `GET /api/v1/marketplace/listings`, `POST /api/v1/marketplace/purchase` |
| Base URL | <!-- http://... --> |
| DB | <!-- PostgreSQL version, instance type --> |
| Backend | <!-- Node version, instance type --> |

---

## Summary Results

| Metric | Result | Threshold | Pass/Fail |
|--------|--------|-----------|-----------|
| p99 GET /listings | <!-- e.g. 312ms --> | < 500ms | <!-- ✅ / ❌ --> |
| p99 POST /purchase | <!-- e.g. 780ms --> | < 1000ms | <!-- ✅ / ❌ --> |
| HTTP error rate | <!-- e.g. 0.3% --> | < 1% | <!-- ✅ / ❌ --> |
| Purchase error rate (5xx) | <!-- e.g. 0.0% --> | < 2% | <!-- ✅ / ❌ --> |
| Peak RPS | <!-- e.g. 420 req/s --> | — | — |
| Data corruption incidents | <!-- 0 --> | 0 | <!-- ✅ / ❌ --> |

---

## Detailed Metrics

### GET /marketplace/listings

```
avg:  ___ms   min: ___ms   med: ___ms
p90:  ___ms   p95: ___ms   p99: ___ms   max: ___ms
```

### POST /marketplace/purchase

```
avg:  ___ms   min: ___ms   med: ___ms
p90:  ___ms   p95: ___ms   p99: ___ms   max: ___ms
```

### Throughput

```
Total requests:    ___
Requests/sec:      ___
Data received:     ___ MB
Data sent:         ___ MB
```

### VU ramp

```
00:00  →  00:30   0 → 500 VUs (ramp-up)
00:30  →  05:30   500 VUs    (sustained)
05:30  →  06:00   500 → 0    (ramp-down)
```

---

## Data Integrity Check

After the test run, verify no corruption occurred:

```sql
-- All purchase amounts should be non-negative
SELECT COUNT(*) FROM "MarketListing" WHERE "amountAvailable" < 0;
-- Expected: 0

-- No listing should have amountAvailable > original amount
-- (run manually with known seed values)

-- Sold listings should have amountAvailable = 0
SELECT COUNT(*) FROM "MarketListing"
WHERE status = 'Sold' AND "amountAvailable" != 0;
-- Expected: 0
```

| Check | Result | Pass/Fail |
|-------|--------|-----------|
| No negative amountAvailable | <!-- 0 rows --> | <!-- ✅ / ❌ --> |
| Sold listings have 0 available | <!-- 0 rows --> | <!-- ✅ / ❌ --> |
| No duplicate txHash values | <!-- 0 rows --> | <!-- ✅ / ❌ --> |

---

## Bottlenecks Identified

<!-- List any bottlenecks found during the test run. Examples: -->

- [ ] **Database connection pool exhaustion** — observed at ___ VUs. Mitigation: increase `connection_limit` in Prisma datasource.
- [ ] **Slow query on `MarketListing.findMany`** — missing index on `(status, methodology)`. Add: `@@index([status, methodology])` in schema.
- [ ] **No bottlenecks identified** — all thresholds passed.

---

## Recommendations

<!-- Fill in after analysis -->

1. 
2. 
3. 

---

## How to Reproduce

```bash
# 1. Start the backend
cd backend && npm run start:prod

# 2. Seed test listings (adjust count as needed)
# POST /api/v1/marketplace/list  x3 with listingId: listing-load-001..003

# 3. Get a JWT
curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"GBTEST...","role":"corporation"}' | jq -r .access_token

# 4. Run the load test
k6 run \
  -e BASE_URL=http://localhost:3001 \
  -e JWT=<token_from_step_3> \
  -e LISTING_IDS=listing-load-001,listing-load-002,listing-load-003 \
  --out json=load-tests/results/run-$(date +%Y%m%d-%H%M%S).json \
  load-tests/marketplace.k6.js
```

---

## Raw Output

<details>
<summary>k6 stdout</summary>

```
<!-- paste full k6 output here -->
```

</details>
