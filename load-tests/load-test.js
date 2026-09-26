/**
 * CarbonLedger — Comprehensive Load Test
 *
 * Covers 10 main API endpoints across all service areas:
 *
 *   1.  GET  /health                         — health check / warm-up
 *   2.  POST /auth/login                     — authentication
 *   3.  GET  /marketplace/listings           — browse active listings (paginated)
 *   4.  GET  /marketplace/listings/:id       — listing detail
 *   5.  POST /marketplace/purchase           — purchase credits
 *   6.  POST /marketplace/bulk-purchase      — bulk corporate purchase
 *   7.  GET  /projects                       — list carbon projects
 *   8.  GET  /credits/batches/:id            — credit batch detail
 *   9.  POST /retirements/bulk               — bulk retirement (ESG)
 *   10. GET  /retirements/certificate/:id    — fetch retirement certificate
 *
 * Scenarios:
 *
 *   baseline_100        — 100 VUs, mixed read/write traffic, 3 minutes sustained
 *   stress_500          — ramp to 500 VUs over 2 min, hold 5 min, ramp down
 *   spike               — sudden spike to 1000 VUs for 60 s, then back to 0
 *   purchase_soak       — 50 VUs continuously purchasing for 10 minutes
 *   bulk_retirement     — 10 VUs submitting 10-item bulk retirements (ESG rush)
 *
 * Thresholds (acceptance criteria):
 *   • p95 < 500 ms at 100 VUs  (baseline_100 scenario)
 *   • p99 < 2000 ms overall
 *   • error_rate < 1%
 *
 * Prerequisites:
 *   1. Run scripts/seed-loadtest.sh to populate listings and credit batches.
 *   2. Set BASE_URL env var to your target server (default: http://localhost:3001).
 *   3. Optionally set JWT for authenticated endpoints.
 *
 * Run:
 *   k6 run load-tests/load-test.js
 *
 * With env overrides:
 *   k6 run \
 *     -e BASE_URL=https://staging.carbonledger.io \
 *     -e JWT=eyJ... \
 *     load-tests/load-test.js
 *
 * Save results for artifact upload:
 *   k6 run \
 *     --out json=load-tests/results/run-$(date +%Y%m%d-%H%M%S).json \
 *     load-tests/load-test.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter, Gauge } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import exec from "k6/execution";

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const API = `${BASE_URL}/api/v1`;
const JWT = __ENV.JWT || "";

// Seed data: populated by scripts/seed-loadtest.sh
let SEED = {
  listingIds: [],
  projectIds: [],
  batchIds: [],
  certificateIds: [],
};

try {
  const raw = JSON.parse(open("./seed-data.json"));
  SEED.listingIds = raw.listingIds || [];
  SEED.projectIds = raw.projectIds || [];
  SEED.batchIds = raw.batchIds || [];
  SEED.certificateIds = raw.certificateIds || [];
} catch (_) {
  // Fallback to synthetic IDs when seed file is absent
  SEED.listingIds = Array.from({ length: 20 }, (_, i) =>
    `listing-loadtest-${String(i + 1).padStart(4, "0")}`
  );
  SEED.projectIds = Array.from({ length: 10 }, (_, i) =>
    `project-loadtest-${String(i + 1).padStart(4, "0")}`
  );
  SEED.batchIds = Array.from({ length: 10 }, (_, i) =>
    `batch-loadtest-${String(i + 1).padStart(4, "0")}`
  );
  SEED.certificateIds = Array.from({ length: 5 }, (_, i) =>
    `cert-loadtest-${String(i + 1).padStart(4, "0")}`
  );
}

// ── Custom metrics ─────────────────────────────────────────────────────────────

// Per-endpoint latency trends
const latencyHealth = new Trend("latency_health", true);
const latencyLogin = new Trend("latency_login", true);
const latencyListings = new Trend("latency_listings", true);
const latencyListingDetail = new Trend("latency_listing_detail", true);
const latencyPurchase = new Trend("latency_purchase", true);
const latencyBulkPurchase = new Trend("latency_bulk_purchase", true);
const latencyProjects = new Trend("latency_projects", true);
const latencyBatchDetail = new Trend("latency_batch_detail", true);
const latencyBulkRetirement = new Trend("latency_bulk_retirement", true);
const latencyCertificate = new Trend("latency_certificate", true);

// Error rates
const errorRate = new Rate("error_rate");
const purchaseErrorRate = new Rate("purchase_error_rate");
const retirementErrorRate = new Rate("retirement_error_rate");

// Throughput counters
const purchaseCount = new Counter("purchases_completed");
const retirementCount = new Counter("retirements_completed");
const bulkPurchaseCount = new Counter("bulk_purchases_completed");

// Memory pressure gauge (approximated via response-time degradation)
const p95ResponseGauge = new Gauge("p95_response_ms");

// ── Test options ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // ── Scenario 1: Baseline — 100 VUs, 3 min ─────────────────────────────────
    // Measures p95 < 500 ms acceptance criterion.
    baseline_100: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "3m", target: 100 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "15s",
      tags: { scenario: "baseline" },
    },

    // ── Scenario 2: Stress — ramp to 500 VUs ──────────────────────────────────
    stress_500: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 500 },
        { duration: "5m", target: 500 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
      tags: { scenario: "stress" },
      startTime: "4m30s", // start after baseline completes
    },

    // ── Scenario 3: Spike — 1000 VUs for 60 s ─────────────────────────────────
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 1000 },
        { duration: "1m", target: 1000 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "30s",
      tags: { scenario: "spike" },
      startTime: "15m", // start after stress completes
    },

    // ── Scenario 4: Purchase soak — 50 VUs for 10 min ────────────────────────
    purchase_soak: {
      executor: "constant-vus",
      vus: 50,
      duration: "10m",
      tags: { scenario: "purchase_soak" },
      startTime: "4m30s", // parallel with stress
    },

    // ── Scenario 5: Bulk retirement spike — 10 VUs × 5 iterations ────────────
    bulk_retirement: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 5,
      maxDuration: "10m",
      tags: { scenario: "bulk_retirement" },
      startTime: "5m",
    },
  },

  thresholds: {
    // ── Acceptance criterion: p95 < 500ms (baseline 100 VUs) ──────────────────
    "latency_listings{scenario:baseline}": ["p(95)<500"],
    "latency_listing_detail{scenario:baseline}": ["p(95)<500"],
    "latency_projects{scenario:baseline}": ["p(95)<500"],
    "latency_certificate{scenario:baseline}": ["p(95)<500"],

    // ── p99 < 2000ms overall ──────────────────────────────────────────────────
    latency_health: ["p(99)<2000"],
    latency_login: ["p(99)<2000"],
    latency_listings: ["p(99)<2000"],
    latency_listing_detail: ["p(99)<2000"],
    latency_purchase: ["p(99)<2000"],
    latency_bulk_purchase: ["p(99)<2000"],
    latency_projects: ["p(99)<2000"],
    latency_batch_detail: ["p(99)<2000"],
    latency_bulk_retirement: ["p(99)<2000"],
    latency_certificate: ["p(99)<2000"],

    // ── Error rates < 1% ──────────────────────────────────────────────────────
    error_rate: ["rate<0.01"],
    purchase_error_rate: ["rate<0.01"],
    retirement_error_rate: ["rate<0.01"],

    // ── HTTP failure rate < 1% ────────────────────────────────────────────────
    http_req_failed: ["rate<0.01"],

    // ── Overall p99 guard ─────────────────────────────────────────────────────
    http_req_duration: ["p(99)<2000"],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function randomItem(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (JWT) h["Authorization"] = `Bearer ${JWT}`;
  return h;
}

function publicHeaders() {
  return { "Content-Type": "application/json" };
}

/** Stable buyer public key derived from VU index. */
function buyerKey(vu) {
  return `GBLOADTEST${String(vu).padStart(46, "0").slice(0, 46)}`;
}

/** Record 5xx as errors; 4xx are expected when auth tokens aren't provided. */
function isError(status) {
  return status >= 500;
}

// ── Setup ──────────────────────────────────────────────────────────────────────

export function setup() {
  // ── Endpoint 1: GET /health ────────────────────────────────────────────────
  const health = http.get(`${BASE_URL}/health`, { tags: { name: "GET /health" } });
  if (health.status !== 200) {
    throw new Error(
      `Health check failed — status ${health.status}. ` +
        `Ensure the server is running at ${BASE_URL} ` +
        `and run scripts/seed-loadtest.sh before load testing.`
    );
  }

  console.log(`✓ API reachable at ${BASE_URL}`);
  console.log(`✓ ${SEED.listingIds.length} listings, ${SEED.projectIds.length} projects, ${SEED.batchIds.length} batches loaded`);

  if (!JWT) {
    console.warn(
      "⚠  No JWT — authenticated endpoints (purchase, retire) will return 401. " +
        "Set -e JWT=<token> for full scenario coverage."
    );
  }

  return { seed: SEED };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT FUNCTIONS (one per endpoint, each records its own metric)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Endpoint 1: GET /health
 * Simple health check — always succeeds or throws.
 */
function endpoint1Health() {
  const res = http.get(`${BASE_URL}/health`, {
    tags: { name: "GET /health" },
  });
  latencyHealth.add(res.timings.duration);
  const ok = check(res, {
    "health: 200": (r) => r.status === 200,
  });
  errorRate.add(!ok || isError(res.status));
  return res;
}

/**
 * Endpoint 2: POST /auth/login
 * Authenticate and obtain a JWT. Uses a loadtest credential pair.
 */
function endpoint2Login() {
  const payload = JSON.stringify({
    email: `loadtest-vu${__VU}@carbonledger.test`,
    password: "LoadTest!2024",
  });
  const res = http.post(`${API}/auth/login`, payload, {
    headers: publicHeaders(),
    tags: { name: "POST /auth/login" },
  });
  latencyLogin.add(res.timings.duration);
  const ok = check(res, {
    "login: 200 or 401": (r) => r.status === 200 || r.status === 401,
    "login: response < 2000ms": (r) => r.timings.duration < 2000,
  });
  errorRate.add(isError(res.status));
  return res;
}

/**
 * Endpoint 3: GET /marketplace/listings
 * Browse paginated active listings with optional filters.
 */
function endpoint3Listings() {
  const methodologies = ["VCS", "Gold Standard", "ACR", "CAR", "Plan Vivo"];
  const vintages = ["2020", "2021", "2022", "2023", "2024"];
  const page = Math.ceil(Math.random() * 5);

  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    methodology: randomItem(methodologies),
    vintage: randomItem(vintages),
  });

  const res = http.get(`${API}/marketplace/listings?${params}`, {
    tags: { name: "GET /marketplace/listings" },
  });
  latencyListings.add(res.timings.duration);

  const ok = check(res, {
    "listings: 200": (r) => r.status === 200,
    "listings: has body": (r) => r.body && r.body.length > 0,
    "listings: p95 < 500ms": (r) => r.timings.duration < 500,
  });
  errorRate.add(!ok || isError(res.status));
  return res;
}

/**
 * Endpoint 4: GET /marketplace/listings/:id
 * Fetch a single listing's detail page.
 */
function endpoint4ListingDetail(data) {
  const id = randomItem(data.seed.listingIds) || "listing-fallback-0001";
  const res = http.get(`${API}/marketplace/listings/${id}`, {
    tags: { name: "GET /marketplace/listings/:id" },
  });
  latencyListingDetail.add(res.timings.duration);
  const ok = check(res, {
    "listing detail: 200 or 404": (r) => r.status === 200 || r.status === 404,
    "listing detail: response < 2000ms": (r) => r.timings.duration < 2000,
  });
  errorRate.add(isError(res.status));
  return res;
}

/**
 * Endpoint 5: POST /marketplace/purchase
 * Purchase a single credit from a listing.
 */
function endpoint5Purchase(data) {
  const listingId = randomItem(data.seed.listingIds) || "listing-fallback-0001";
  const payload = JSON.stringify({
    listingId,
    amount: 1,
    buyerPublicKey: buyerKey(__VU),
  });
  const res = http.post(`${API}/marketplace/purchase`, payload, {
    headers: authHeaders(),
    tags: { name: "POST /marketplace/purchase" },
  });
  latencyPurchase.add(res.timings.duration);
  const ok = check(res, {
    "purchase: 201 or 400 or 401": (r) =>
      r.status === 201 || r.status === 400 || r.status === 401,
    "purchase: response < 2000ms": (r) => r.timings.duration < 2000,
  });
  purchaseErrorRate.add(isError(res.status));
  errorRate.add(isError(res.status));
  if (res.status === 201) purchaseCount.add(1);
  return res;
}

/**
 * Endpoint 6: POST /marketplace/bulk-purchase
 * Corporate bulk purchase of credits from multiple listings.
 */
function endpoint6BulkPurchase(data) {
  const items = Array.from({ length: 3 }, () => ({
    listingId: randomItem(data.seed.listingIds) || "listing-fallback-0001",
    amount: 1,
  }));
  const payload = JSON.stringify({
    items,
    buyerPublicKey: buyerKey(__VU),
    corporateName: `LoadTestCorp-VU${__VU}`,
  });
  const res = http.post(`${API}/marketplace/bulk-purchase`, payload, {
    headers: authHeaders(),
    tags: { name: "POST /marketplace/bulk-purchase" },
  });
  latencyBulkPurchase.add(res.timings.duration);
  const ok = check(res, {
    "bulk purchase: 201 or 400 or 401": (r) =>
      r.status === 201 || r.status === 400 || r.status === 401,
    "bulk purchase: response < 2000ms": (r) => r.timings.duration < 2000,
  });
  purchaseErrorRate.add(isError(res.status));
  errorRate.add(isError(res.status));
  if (res.status === 201) bulkPurchaseCount.add(1);
  return res;
}

/**
 * Endpoint 7: GET /projects
 * List all registered carbon projects (public).
 */
function endpoint7Projects() {
  const params = new URLSearchParams({
    page: String(Math.ceil(Math.random() * 3)),
    pageSize: "20",
    status: randomItem(["verified", "active", "pending"]),
  });
  const res = http.get(`${API}/projects?${params}`, {
    tags: { name: "GET /projects" },
  });
  latencyProjects.add(res.timings.duration);
  const ok = check(res, {
    "projects: 200": (r) => r.status === 200,
    "projects: response < 2000ms": (r) => r.timings.duration < 2000,
  });
  errorRate.add(!ok || isError(res.status));
  return res;
}

/**
 * Endpoint 8: GET /credits/batches/:id
 * Fetch a specific credit batch's full detail.
 */
function endpoint8BatchDetail(data) {
  const id = randomItem(data.seed.batchIds) || "batch-fallback-0001";
  const res = http.get(`${API}/credits/batches/${id}`, {
    tags: { name: "GET /credits/batches/:id" },
  });
  latencyBatchDetail.add(res.timings.duration);
  const ok = check(res, {
    "batch detail: 200 or 404": (r) => r.status === 200 || r.status === 404,
    "batch detail: response < 2000ms": (r) => r.timings.duration < 2000,
  });
  errorRate.add(isError(res.status));
  return res;
}

/**
 * Endpoint 9: POST /retirements/bulk
 * Bulk retire 10 credits — simulates year-end ESG reporting rush.
 */
function endpoint9BulkRetirement(data) {
  const items = Array.from({ length: 10 }, (_, i) => ({
    batchId: randomItem(data.seed.batchIds) || "batch-fallback-0001",
    amount: 1,
    beneficiary: `Corp-VU${__VU}-Item${i}`,
    reason: `Year-end ESG offset ${new Date().getFullYear()} — item ${i + 1}/10`,
  }));
  const payload = JSON.stringify({
    retirements: items,
    corporateName: `LoadTestCorp-VU${__VU}`,
    reportingPeriod: `${new Date().getFullYear()}-FY`,
  });
  const res = http.post(`${API}/retirements/bulk`, payload, {
    headers: authHeaders(),
    tags: { name: "POST /retirements/bulk" },
  });
  latencyBulkRetirement.add(res.timings.duration);
  const ok = check(res, {
    "bulk retire: 201 or 400 or 401": (r) =>
      r.status === 201 || r.status === 400 || r.status === 401,
    "bulk retire: response < 2000ms": (r) => r.timings.duration < 2000,
  });
  retirementErrorRate.add(isError(res.status));
  errorRate.add(isError(res.status));
  if (res.status === 201) retirementCount.add(1);
  return res;
}

/**
 * Endpoint 10: GET /retirements/certificate/:id
 * Retrieve a permanent retirement certificate (public endpoint).
 */
function endpoint10Certificate(data) {
  const id = randomItem(data.seed.certificateIds) || "cert-fallback-0001";
  const res = http.get(`${API}/retirements/certificate/${id}`, {
    tags: { name: "GET /retirements/certificate/:id" },
  });
  latencyCertificate.add(res.timings.duration);
  const ok = check(res, {
    "certificate: 200 or 404": (r) => r.status === 200 || r.status === 404,
    "certificate: response < 2000ms": (r) => r.timings.duration < 2000,
  });
  errorRate.add(isError(res.status));
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO RUNNERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Baseline / Stress / Spike scenarios: mixed read + write traffic.
 * 70% read-heavy (browse, projects, certificates), 30% write (purchase, retire).
 */
function runMixedTraffic(data) {
  const roll = Math.random();

  group("mixed_traffic", () => {
    // Always warm the health endpoint 20% of the time
    if (Math.random() < 0.2) {
      endpoint1Health();
      sleep(0.1);
    }

    if (roll < 0.35) {
      // 35%: browse listings + listing detail
      endpoint3Listings();
      sleep(0.3);
      endpoint4ListingDetail(data);
    } else if (roll < 0.60) {
      // 25%: browse projects + batch detail
      endpoint7Projects();
      sleep(0.2);
      endpoint8BatchDetail(data);
    } else if (roll < 0.75) {
      // 15%: fetch retirement certificates
      endpoint10Certificate(data);
    } else if (roll < 0.85) {
      // 10%: login then browse
      endpoint2Login();
      sleep(0.2);
      endpoint3Listings();
    } else if (roll < 0.93) {
      // 8%: purchase flow
      endpoint4ListingDetail(data);
      sleep(0.3);
      endpoint5Purchase(data);
    } else {
      // 7%: bulk purchase
      endpoint6BulkPurchase(data);
    }
  });

  sleep(0.5 + Math.random() * 1.5);
}

/**
 * Purchase soak: sustained purchase traffic from 50 concurrent buyers.
 */
function runPurchaseSoak(data) {
  group("purchase_soak", () => {
    endpoint3Listings();
    sleep(0.2);
    endpoint4ListingDetail(data);
    sleep(0.2);
    endpoint5Purchase(data);
  });
  sleep(1 + Math.random() * 2);
}

/**
 * Bulk retirement: 10 VUs each submitting 5 bulk retirements.
 */
function runBulkRetirement(data) {
  group("bulk_retirement", () => {
    endpoint9BulkRetirement(data);
  });
  sleep(2 + Math.random() * 3);
}

// ── Main entry point ─────────────────────────────────────────────────────────

export default function (data) {
  const scenario = exec.scenario.name;

  switch (scenario) {
    case "baseline_100":
    case "stress_500":
    case "spike":
      runMixedTraffic(data);
      break;
    case "purchase_soak":
      runPurchaseSoak(data);
      break;
    case "bulk_retirement":
      runBulkRetirement(data);
      break;
    default:
      runMixedTraffic(data);
  }
}

// ── Teardown: print summary ───────────────────────────────────────────────────

export function teardown(data) {
  console.log("\n=== CarbonLedger Load Test Complete ===");
  console.log(`Seed data: ${data.seed.listingIds.length} listings, ${data.seed.projectIds.length} projects`);
  console.log("Metrics to review:");
  console.log("  • latency_listings{scenario:baseline} p95 — target: < 500ms");
  console.log("  • latency_* p99 — target: < 2000ms");
  console.log("  • error_rate — target: < 1%");
  console.log("  • purchase_error_rate — target: < 1%");
  console.log("  • retirement_error_rate — target: < 1%");
  console.log("\nFor profiling, start the backend with:");
  console.log("  node --prof dist/main.js");
  console.log("Then after the test run:");
  console.log("  node --prof-process isolate-*.log > profile.txt");
  console.log("\nResults saved to load-tests/results/ if --out json=... was used.");
}
