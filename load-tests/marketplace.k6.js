/**
 * CarbonLedger — Marketplace Load Test (#93)
 *
 * Simulates a corporate buying event: 500 concurrent users browsing listings
 * and purchasing credits for 5 minutes.
 *
 * Acceptance criteria:
 *   - 500 VUs sustained for 5 minutes
 *   - p99 response time < 500ms for GET /listings
 *   - No data corruption under concurrent purchases
 *
 * Run:
 *   k6 run load-tests/marketplace.k6.js
 *
 * With custom base URL:
 *   k6 run -e BASE_URL=http://localhost:3001 load-tests/marketplace.k6.js
 *
 * With HTML report (requires k6-reporter):
 *   k6 run --out json=load-tests/results/run.json load-tests/marketplace.k6.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const API      = `${BASE_URL}/api/v1`;

// Pre-seeded test data — must exist in the DB before running the test.
// Populate via POST /api/v1/marketplace/list or a seed script.
const LISTING_IDS = __ENV.LISTING_IDS
  ? __ENV.LISTING_IDS.split(",")
  : ["listing-load-001", "listing-load-002", "listing-load-003"];

// JWT for authenticated purchase requests.
// Obtain via POST /api/v1/auth/login and pass as env var:
//   k6 run -e JWT=eyJ... load-tests/marketplace.k6.js
const JWT = __ENV.JWT || "";

// ── Custom metrics ────────────────────────────────────────────────────────────

const purchaseErrors   = new Rate("purchase_errors");
const listingsDuration = new Trend("listings_duration", true);
const purchaseDuration = new Trend("purchase_duration", true);

// ── Test options ──────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Ramp to 500 VUs over 30s, hold for 5 min, ramp down over 30s
    marketplace_load: {
      executor:          "ramping-vus",
      startVUs:          0,
      stages: [
        { duration: "30s",  target: 500 },   // ramp up
        { duration: "5m",   target: 500 },   // sustained load
        { duration: "30s",  target: 0   },   // ramp down
      ],
      gracefulRampDown: "10s",
    },
  },

  thresholds: {
    // Acceptance criteria: p99 < 500ms for listing queries
    "listings_duration{scenario:marketplace_load}": ["p(99)<500"],

    // Purchase p99 < 1000ms (blockchain-adjacent, more lenient)
    "purchase_duration{scenario:marketplace_load}": ["p(99)<1000"],

    // Overall HTTP failure rate < 1%
    http_req_failed: ["rate<0.01"],

    // Purchase-specific error rate < 2% (some contention expected)
    purchase_errors: ["rate<0.02"],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function authHeaders() {
  return JWT
    ? { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

// ── Virtual user scenario ─────────────────────────────────────────────────────

export default function () {
  // 70% of VUs browse listings; 30% attempt a purchase
  const action = Math.random();

  if (action < 0.70) {
    // ── GET /marketplace/listings ─────────────────────────────────────────────
    const methodologies = ["VCS", "Gold Standard", "ACR", "CAR"];
    const params = new URLSearchParams({
      methodology: randomItem(methodologies),
    });

    const res = http.get(`${API}/marketplace/listings?${params}`, {
      tags: { name: "GET /listings" },
    });

    listingsDuration.add(res.timings.duration);

    check(res, {
      "listings: status 200":        (r) => r.status === 200,
      "listings: body is array":      (r) => Array.isArray(r.json()),
      "listings: response < 500ms":   (r) => r.timings.duration < 500,
    });

  } else {
    // ── POST /marketplace/purchase ────────────────────────────────────────────
    const listingId = randomItem(LISTING_IDS);
    const payload   = JSON.stringify({
      listingId,
      amount:         1,   // small amount to avoid exhausting test listings
      buyerPublicKey: `GBLOAD${__VU.toString().padStart(10, "0")}`,
    });

    const res = http.post(`${API}/marketplace/purchase`, payload, {
      headers: authHeaders(),
      tags:    { name: "POST /purchase" },
    });

    purchaseDuration.add(res.timings.duration);

    const ok = check(res, {
      "purchase: status 201 or 400":  (r) => r.status === 201 || r.status === 400,
      "purchase: has txHash or error": (r) => {
        if (r.status === 201) return r.json("txHash") !== undefined;
        // 400 is acceptable — listing may be exhausted or unavailable
        return r.json("message") !== undefined;
      },
    });

    // Only count unexpected errors (5xx) as failures
    purchaseErrors.add(res.status >= 500);
  }

  // Think time: 0.5–1.5s between requests (realistic user pacing)
  sleep(0.5 + Math.random());
}

// ── Setup: verify the API is reachable before starting ───────────────────────

export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(`API health check failed: ${res.status} — is the server running at ${BASE_URL}?`);
  }
  console.log(`✓ API reachable at ${BASE_URL}`);

  if (!JWT) {
    console.warn("⚠ No JWT provided — purchase requests will return 401. Set -e JWT=<token> for full test coverage.");
  }
}
