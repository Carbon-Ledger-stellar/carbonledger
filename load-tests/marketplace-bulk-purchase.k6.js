/**
 * CarbonLedger — Marketplace Bulk Purchase Load Tests (#630)
 *
 * Focused on concurrent corporate buyers executing purchases, distinct from
 * the general browse/purchase/retirement suite in marketplace.k6.js (#687):
 *
 *   single_purchase_baseline  — 10 VUs, single-credit purchases, clean P99 baseline
 *   concurrent_buyers_100     — ramp to 100 concurrent distinct corporate buyers
 *                               each completing single purchases (the scenario
 *                               named in issue #630)
 *   bulk_purchase_stress      — 20 VUs each submitting 10-listing bulk purchases
 *                               via POST /marketplace/bulk-purchase
 *   rate_limit_exhaustion     — 1 fixed buyer identity firing far more than the
 *                               "default" throttler limit (60 req/60s) at
 *                               POST /marketplace/purchase to force 429s and
 *                               verify the Redis-backed rate limiter recovers
 *
 * Thresholds (see "Performance baseline targets" in load-tests/RESULTS-bulk-purchase.md):
 *   p99 < 500ms @ up to 100 RPS for single/bulk purchase, error_rate < 1%
 *
 * Pre-requisites:
 *   1. Run scripts/seed-loadtest.sh to populate active listings.
 *   2. Run backend/scripts/generate-loadtest-buyer-jwts.js to provision
 *      distinct "corporation"-role buyer identities (real wallet-signature
 *      auth — see that script's header comment for why one shared JWT isn't
 *      representative of 100 concurrent buyers).
 *   3. Set BASE_URL to your target server.
 *
 * Run (single command once prerequisites are seeded):
 *   k6 run load-tests/marketplace-bulk-purchase.k6.js
 *
 * With env overrides:
 *   k6 run -e BASE_URL=https://staging.carbonledger.io \
 *           load-tests/marketplace-bulk-purchase.k6.js
 *
 * With JSON results for the results template:
 *   k6 run --out json=load-tests/results/bulk-purchase-run-$(date +%Y%m%d).json \
 *           load-tests/marketplace-bulk-purchase.k6.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import exec from "k6/execution";

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const API = `${BASE_URL}/api/v1`;

// Listing IDs seeded by scripts/seed-loadtest.sh.
let LISTING_IDS = [];
try {
  const seedData = JSON.parse(open("./seed-data.json"));
  LISTING_IDS = seedData.listingIds || [];
} catch (_) {
  LISTING_IDS = Array.from(
    { length: 200 },
    (_, i) => `listing-loadtest-${String(i + 1).padStart(4, "0")}`,
  );
}

// Distinct buyer identities provisioned by
// backend/scripts/generate-loadtest-buyer-jwts.js. Each has its own JWT so
// per-user rate limiting (CustomThrottlerGuard trackers by user public key)
// behaves realistically across concurrent buyers, instead of every VU
// sharing one throttle bucket.
let BUYERS = [];
try {
  BUYERS = JSON.parse(open("./buyer-jwts.json"));
} catch (_) {
  BUYERS = [];
}

// The rate-limit-exhaustion scenario deliberately reuses ONE identity so all
// its requests land in the same per-user throttle bucket.
const RATE_LIMIT_BUYER = BUYERS.length > 0 ? BUYERS[0] : null;

// ── Custom metrics ────────────────────────────────────────────────────────────

const purchaseErrors = new Rate("purchase_errors");
const bulkPurchaseErrors = new Rate("bulk_purchase_errors");
const poolExhaustionErrors = new Rate("pool_exhaustion_errors"); // 5xx specifically during concurrent_buyers_100
const rateLimitHits = new Counter("rate_limit_429_total");
const rateLimitRecoveries = new Counter("rate_limit_recovered_total");

const singlePurchaseDuration = new Trend("single_purchase_duration", true);
const concurrentPurchaseDuration = new Trend("concurrent_purchase_duration", true);
const bulkPurchaseDuration = new Trend("bulk_purchase_duration", true);

const purchaseCount = new Counter("purchase_total");
const bulkPurchaseCount = new Counter("bulk_purchase_total");

// ── Test options ──────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // ── Scenario 1: Single-purchase baseline ──────────────────────────────
    // Low concurrency so p99 reflects the endpoint's own latency, not queueing.
    single_purchase_baseline: {
      executor: "constant-vus",
      vus: 10,
      duration: "2m",
      tags: { scenario: "single_purchase_baseline" },
    },

    // ── Scenario 2: 100 concurrent corporate buyers ───────────────────────
    // Named scenario from issue #630: ramp-up -> steady state -> spike-down,
    // each of up to 100 VUs acting as a DISTINCT corporate buyer.
    concurrent_buyers_100: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 100 }, // ramp-up
        { duration: "3m", target: 100 },  // steady state
        { duration: "30s", target: 150 }, // spike above the named 100
        { duration: "30s", target: 0 },   // ramp-down
      ],
      gracefulRampDown: "15s",
      tags: { scenario: "concurrent_buyers_100" },
      startTime: "2m10s", // after single_purchase_baseline finishes
    },

    // ── Scenario 3: Bulk purchase stress ──────────────────────────────────
    bulk_purchase_stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 20 },
        { duration: "2m", target: 20 },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "10s",
      tags: { scenario: "bulk_purchase_stress" },
      startTime: "6m",
    },

    // ── Scenario 4: Rate limit exhaustion ─────────────────────────────────
    // One buyer identity fires well above the 60 req/60s "default" throttler
    // limit applied to POST /marketplace/purchase, to confirm 429s are
    // returned (not 5xx) and the limiter recovers once the window rolls over.
    rate_limit_exhaustion: {
      executor: "constant-arrival-rate",
      rate: 5, // 5 req/s = 300 req/min, ~5x the 60/min default limit
      timeUnit: "1s",
      duration: "90s",
      preAllocatedVUs: 10,
      maxVUs: 20,
      tags: { scenario: "rate_limit_exhaustion" },
      startTime: "8m30s",
    },
  },

  thresholds: {
    "single_purchase_duration": ["p(99)<500"],
    "concurrent_purchase_duration": ["p(99)<500"],
    "bulk_purchase_duration": ["p(99)<500"],

    "purchase_errors": ["rate<0.01"],
    "bulk_purchase_errors": ["rate<0.01"],
    "pool_exhaustion_errors": ["rate<0.01"],

    "http_req_failed": ["rate<0.01"],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Assigns each VU a stable, distinct buyer identity for the run's lifetime. */
function buyerForVU(vu) {
  if (BUYERS.length === 0) return null;
  return BUYERS[vu % BUYERS.length];
}

function authHeaders(jwt) {
  const headers = { "Content-Type": "application/json" };
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  return headers;
}

// ── Setup: verify reachability and prerequisites ──────────────────────────────

export function setup() {
  const health = http.get(`${BASE_URL}/health`);
  if (health.status !== 200) {
    throw new Error(
      `API health check failed: status=${health.status} url=${BASE_URL}/health\n` +
      `Ensure the backend is running and run scripts/seed-loadtest.sh first.`,
    );
  }
  console.log(`API reachable at ${BASE_URL}`);
  console.log(`${LISTING_IDS.length} listing IDs loaded`);
  console.log(`${BUYERS.length} distinct buyer identities loaded`);

  if (BUYERS.length === 0) {
    console.warn(
      "No buyer identities found (load-tests/buyer-jwts.json missing or empty). " +
      "Run: cd backend && BUYER_COUNT=100 node scripts/generate-loadtest-buyer-jwts.js\n" +
      "All purchase/bulk-purchase requests will receive 401 without buyer JWTs.",
    );
  } else if (BUYERS.length < 100) {
    console.warn(
      `Only ${BUYERS.length} buyer identities loaded — concurrent_buyers_100 ` +
      "will reuse identities across VUs once it exceeds this count. For a " +
      "fully-distinct 100-buyer run, provision at least 100 identities.",
    );
  }

  return { listingCount: LISTING_IDS.length, buyerCount: BUYERS.length };
}

// ── Scenario 1: Single-purchase baseline ──────────────────────────────────────

function scenarioSinglePurchaseBaseline() {
  const buyer = buyerForVU(exec.vu.idInTest);
  const listingId = randomItem(LISTING_IDS);

  group("single_purchase_baseline", () => {
    const payload = JSON.stringify({ listingId, amount: 1 });
    const res = http.post(`${API}/marketplace/purchase`, payload, {
      headers: authHeaders(buyer && buyer.jwt),
      tags: { name: "POST /purchase (baseline)" },
    });

    singlePurchaseDuration.add(res.timings.duration);

    const ok = check(res, {
      "baseline purchase: 201/400/401/404": (r) =>
        [201, 400, 401, 404].includes(r.status),
      "baseline purchase: p99 target < 500ms": (r) => r.timings.duration < 500,
    });
    purchaseErrors.add(res.status >= 500);
    if (ok && res.status === 201) purchaseCount.add(1);
  });

  sleep(1 + Math.random());
}

// ── Scenario 2: 100 concurrent corporate buyers ──────────────────────────────

function scenarioConcurrentBuyers() {
  const buyer = buyerForVU(exec.vu.idInTest);
  const listingId = randomItem(LISTING_IDS);

  group("concurrent_buyers_100", () => {
    const payload = JSON.stringify({ listingId, amount: 1 });
    const res = http.post(`${API}/marketplace/purchase`, payload, {
      headers: authHeaders(buyer && buyer.jwt),
      tags: { name: "POST /purchase (concurrent)" },
    });

    concurrentPurchaseDuration.add(res.timings.duration);

    const ok = check(res, {
      "concurrent purchase: not 5xx": (r) => r.status < 500,
      "concurrent purchase: p99 target < 500ms": (r) => r.timings.duration < 500,
    });
    purchaseErrors.add(res.status >= 500);
    // A 5xx here (rather than a clean 400 business-rule rejection) under 100
    // concurrent buyers is the signal to check for DB connection pool
    // exhaustion — cross-reference with GET /metrics (db_pool_* gauges) and
    // backend logs for Prisma P2024 errors during this scenario's window.
    poolExhaustionErrors.add(res.status >= 500);
    if (ok && res.status === 201) purchaseCount.add(1);
  });

  sleep(0.2 + Math.random() * 0.5);
}

// ── Scenario 3: Bulk purchase stress ─────────────────────────────────────────

function scenarioBulkPurchase() {
  const buyer = buyerForVU(exec.vu.idInTest);
  const BULK_SIZE = 10; // well under BulkPurchaseDto's ArrayMaxSize(50)

  group("bulk_purchase_stress", () => {
    const listingIds = Array.from({ length: BULK_SIZE }, () => randomItem(LISTING_IDS));
    const amounts = Array.from({ length: BULK_SIZE }, () => 1);

    const payload = JSON.stringify({ listingIds, amounts });
    const res = http.post(`${API}/marketplace/bulk-purchase`, payload, {
      headers: authHeaders(buyer && buyer.jwt),
      tags: { name: "POST /bulk-purchase" },
    });

    bulkPurchaseDuration.add(res.timings.duration);

    const ok = check(res, {
      "bulk purchase: not 5xx": (r) => r.status < 500,
      "bulk purchase: p99 target < 500ms": (r) => r.timings.duration < 500,
    });
    bulkPurchaseErrors.add(res.status >= 500);
    if (ok && res.status === 201) bulkPurchaseCount.add(1);
  });

  sleep(1 + Math.random() * 2);
}

// ── Scenario 4: Rate limit exhaustion ────────────────────────────────────────

function scenarioRateLimitExhaustion() {
  const listingId = randomItem(LISTING_IDS);

  group("rate_limit_exhaustion", () => {
    const payload = JSON.stringify({ listingId, amount: 1 });
    const res = http.post(`${API}/marketplace/purchase`, payload, {
      headers: authHeaders(RATE_LIMIT_BUYER && RATE_LIMIT_BUYER.jwt),
      tags: { name: "POST /purchase (rate-limit probe)" },
    });

    const isRateLimited = res.status === 429;
    if (isRateLimited) {
      rateLimitHits.add(1);
    }

    check(res, {
      "rate-limit probe: 201/400/401/429 (never 5xx)": (r) =>
        [201, 400, 401, 429].includes(r.status),
      "rate-limit probe: 429 has Retry-After header": (r) =>
        r.status !== 429 || r.headers["Retry-After"] !== undefined,
    });

    // After being throttled, a subsequent request beyond Retry-After should
    // succeed again — spot-check recovery once per iteration that gets 429.
    if (isRateLimited) {
      const retryAfterSec = parseInt(res.headers["Retry-After"] || "60", 10);
      sleep(Math.min(retryAfterSec, 5)); // cap sleep for test runtime; full
                                          // recovery is verified in the report
                                          // via a longer manual re-probe.
      const retryRes = http.post(`${API}/marketplace/purchase`, payload, {
        headers: authHeaders(RATE_LIMIT_BUYER && RATE_LIMIT_BUYER.jwt),
        tags: { name: "POST /purchase (rate-limit retry)" },
      });
      if (retryRes.status !== 429) {
        rateLimitRecoveries.add(1);
      }
    }
  });
}

// ── Main entry point ─────────────────────────────────────────────────────────

export default function () {
  const scenario = exec.scenario.name;

  if (scenario === "single_purchase_baseline") {
    scenarioSinglePurchaseBaseline();
  } else if (scenario === "concurrent_buyers_100") {
    scenarioConcurrentBuyers();
  } else if (scenario === "bulk_purchase_stress") {
    scenarioBulkPurchase();
  } else if (scenario === "rate_limit_exhaustion") {
    scenarioRateLimitExhaustion();
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────────

export function teardown(data) {
  console.log("=== Bulk Purchase Load Test Complete ===");
  console.log(`Listings available: ${data.listingCount}, buyers used: ${data.buyerCount}`);
  console.log(
    `Check GET ${BASE_URL}/metrics for db_pool_* gauges and ` +
    "load-tests/RESULTS-bulk-purchase.md for the baseline comparison template.",
  );
}
