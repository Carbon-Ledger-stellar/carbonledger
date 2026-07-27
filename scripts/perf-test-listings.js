/**
 * k6 performance test — GET /marketplace/listings
 *
 * Targets:
 *   - p95 < 500ms  (warm cache)
 *   - p95 < 2000ms (cold cache)
 *   - 100 concurrent virtual users, 60-second duration
 *
 * Usage:
 *   # Warm cache (default)
 *   k6 run scripts/perf-test-listings.js
 *
 *   # Cold cache
 *   k6 run -e CACHE=cold scripts/perf-test-listings.js
 *
 *   # Custom base URL
 *   k6 run -e BASE_URL=http://localhost:3001 scripts/perf-test-listings.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const CACHE    = __ENV.CACHE   || 'warm';   // 'warm' | 'cold'

const P95_THRESHOLD = CACHE === 'cold' ? 2000 : 500;

// ── k6 options ────────────────────────────────────────────────────────────────

export const options = {
  vus:      100,
  duration: '60s',
  thresholds: {
    // Primary acceptance criteria
    'http_req_duration{scenario:listings}': [
      `p(95)<${P95_THRESHOLD}`,
    ],
    // Sanity: no more than 1% errors
    'http_req_failed': ['rate<0.01'],
  },
};

// ── Query param variants — exercises filters the endpoint supports ─────────────

const QUERY_VARIANTS = [
  '',
  '?limit=20',
  '?methodology=REDD%2B',
  '?vintage=2023',
  '?country=Brazil',
  '?methodology=VCS&vintage=2022&limit=10',
  '?minPrice=5&maxPrice=20',
  '?search=forest',
];

// ── Main VU loop ──────────────────────────────────────────────────────────────

export default function () {
  const query = QUERY_VARIANTS[Math.floor(Math.random() * QUERY_VARIANTS.length)];
  const url   = `${BASE_URL}/marketplace/listings${query}`;

  const res = http.get(url, {
    tags: { scenario: 'listings' },
    headers: { Accept: 'application/json' },
  });

  check(res, {
    'status 200':        (r) => r.status === 200,
    'has listings array': (r) => {
      try { return Array.isArray(JSON.parse(r.body).listings); }
      catch { return false; }
    },
  });

  // Minimal think-time: real browsers don't hammer with zero delay
  sleep(0.1);
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const dur  = data.metrics.http_req_duration;
  const pass = data.thresholds?.['http_req_duration{scenario:listings}']?.ok ?? false;

  console.log('\n=== Marketplace Listings — Performance Summary ===');
  console.log(`Cache mode : ${CACHE}`);
  console.log(`p50        : ${dur.values['p(50)'].toFixed(1)} ms`);
  console.log(`p95        : ${dur.values['p(95)'].toFixed(1)} ms  (threshold: <${P95_THRESHOLD} ms) ${pass ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`p99        : ${dur.values['p(99)'].toFixed(1)} ms`);
  console.log(`req/s      : ${data.metrics.http_reqs.values.rate.toFixed(1)}`);
  console.log(`errors     : ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%`);
  console.log('=================================================\n');

  return {
    stdout: '',  // already printed above
    'scripts/perf-results-listings.json': JSON.stringify(data, null, 2),
  };
}
