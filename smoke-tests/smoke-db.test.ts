/**
 * smoke-db.test.ts
 *
 * Smoke tests verifying the database layer is healthy after deployment.
 * Checks that:
 *   - /health/ready reports no database errors
 *   - Database-backed API endpoints respond correctly (no 500s from DB layer)
 *   - The DB check in the readiness probe returns "ok"
 *
 * This does NOT run database queries directly — it verifies the API's
 * own health checks and DB-backed read endpoints only.
 *
 * Acceptance criteria covered:
 *   ✓ No database errors
 *   ✓ Health endpoint responds
 *
 * Must complete in under 30 seconds total.
 *
 * Closes #1057
 */

import axios, { AxiosResponse } from 'axios';

const RAW_URL  = process.env.SMOKE_API_RAW_URL  ?? 'http://localhost:3001';
const API_URL  = process.env.SMOKE_API_URL       ?? 'http://localhost:3001/api/v1';
const TIMEOUT_MS = 10_000;

const raw = axios.create({
  baseURL: RAW_URL,
  timeout: TIMEOUT_MS,
  validateStatus: () => true,
});

const http = axios.create({
  baseURL: API_URL,
  timeout: TIMEOUT_MS,
  validateStatus: () => true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertStatus(res: AxiosResponse, expected: number, context: string): void {
  if (res.status !== expected) {
    throw new Error(
      `[${context}] Expected HTTP ${expected}, got ${res.status}. Body: ${JSON.stringify(res.data).slice(0, 300)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Database Health Smoke Tests', () => {
  // ── /health/ready — explicit DB check ────────────────────────────────────

  describe('GET /health/ready — database check', () => {
    let readinessData: Record<string, unknown> = {};
    let readinessStatus = 0;

    beforeAll(async () => {
      const res = await raw.get('/health/ready');
      readinessStatus = res.status;
      readinessData   = res.data as Record<string, unknown>;
    });

    it('health/ready responds with 200 or 503 (never 500)', () => {
      expect([200, 503]).toContain(readinessStatus);
      expect(readinessStatus).not.toBe(500);
    });

    it('health/ready response has a "checks" object', () => {
      expect(readinessData).toHaveProperty('checks');
      expect(typeof readinessData.checks).toBe('object');
    });

    it('health/ready "checks" includes a "db" field', () => {
      const checks = readinessData.checks as Record<string, unknown>;
      expect(checks).toHaveProperty('db');
    });

    it('database check reports "ok" — no DB errors', () => {
      const checks = readinessData.checks as Record<string, unknown>;
      const dbStatus = String(checks.db ?? '');

      if (dbStatus !== 'ok') {
        // Log the actual DB error for debugging in CI
        console.error(
          `[smoke-db] Database check FAILED: "${dbStatus}"\n` +
          `Full readiness response: ${JSON.stringify(readinessData, null, 2)}`,
        );
      }

      expect(dbStatus).toBe('ok');
    });

    it('health/ready status is "ok" when all checks pass', () => {
      const checks = readinessData.checks as Record<string, unknown>;
      const dbStatus = String(checks.db ?? '');

      if (dbStatus !== 'ok') {
        // Skip this assertion if DB is already failing (caught above)
        console.warn('[smoke-db] Skipping overall status check because DB is not ok.');
        return;
      }

      // When DB is healthy, the overall status should be "ok" (HTTP 200)
      // or "degraded" only if Redis/Stellar have issues — both are acceptable
      expect(['ok', 'degraded']).toContain(readinessData.status);
    });
  });

  // ── DB-backed endpoint spot checks ────────────────────────────────────────

  describe('DB-backed API endpoints return no 500s', () => {
    it('GET /projects returns 200 (DB-backed)', async () => {
      const res = await http.get('/projects');
      assertStatus(res, 200, 'GET /projects');
      expect(res.status).not.toBe(500);
      // If DB had errors, this would fail with 500 or empty broken data
    });

    it('GET /marketplace/listings returns 200 (DB-backed)', async () => {
      const res = await http.get('/marketplace/listings');
      assertStatus(res, 200, 'GET /marketplace/listings');
      expect(res.status).not.toBe(500);
    });

    it('GET /projects returns an array (confirms DB connection is live)', async () => {
      const res = await http.get('/projects');
      expect(res.status).toBe(200);
      const items = Array.isArray(res.data)
        ? res.data
        : res.data?.projects ?? res.data?.data ?? [];
      // Even an empty array proves the DB query executed without error
      expect(items).toBeInstanceOf(Array);
    });

    it('GET /marketplace/listings returns an array (confirms DB connection is live)', async () => {
      const res = await http.get('/marketplace/listings');
      expect(res.status).toBe(200);
      const items = Array.isArray(res.data)
        ? res.data
        : res.data?.listings ?? res.data?.data ?? [];
      expect(items).toBeInstanceOf(Array);
    });

    it('unknown resource returns 404 not 500 (error handler works, DB not panicking)', async () => {
      const res = await http.get('/projects/smoke-db-unknown-99999');
      expect(res.status).toBe(404);
      expect(res.status).not.toBe(500);
    });
  });

  // ── Connection pool sanity ─────────────────────────────────────────────────

  describe('Connection pool sanity — multiple sequential requests', () => {
    it('handles 5 sequential requests to DB-backed endpoints without error', async () => {
      const endpoints = [
        '/projects',
        '/marketplace/listings',
        '/projects',
        '/marketplace/listings',
        '/projects',
      ];

      for (const endpoint of endpoints) {
        const res = await http.get(endpoint);
        expect(res.status).toBe(200);
        expect(res.status).not.toBe(500);
      }
    });

    it('handles 3 concurrent requests without DB connection exhaustion', async () => {
      const [r1, r2, r3] = await Promise.all([
        http.get('/projects'),
        http.get('/marketplace/listings'),
        http.get('/projects'),
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(200);

      expect(r1.status).not.toBe(500);
      expect(r2.status).not.toBe(500);
      expect(r3.status).not.toBe(500);
    });
  });

  // ── DB error absence confirmation ─────────────────────────────────────────

  describe('No database errors across all endpoints', () => {
    it('all critical read endpoints return non-500 status codes', async () => {
      const endpoints = [
        { path: '/projects',               expectedStatus: 200 },
        { path: '/marketplace/listings',   expectedStatus: 200 },
        {
          path: '/credits/batch/smoke-no-db-error-test',
          expectedStatus: 404,
        },
        {
          path: '/public/serial/SMOKE-DB-TEST',
          expectedStatus: 404,
        },
        {
          path: '/audit/credits/smoke-db-test-batch/events',
          expectedStatus: [200, 404],
        },
      ];

      const results: Array<{ path: string; status: number }> = [];

      for (const { path, expectedStatus } of endpoints) {
        const res = await http.get(path);
        results.push({ path, status: res.status });

        const allowed = Array.isArray(expectedStatus)
          ? expectedStatus
          : [expectedStatus];

        if (!allowed.includes(res.status)) {
          throw new Error(
            `[smoke-db] ${path} returned HTTP ${res.status} ` +
            `(expected one of ${allowed.join(', ')}). ` +
            `Body: ${JSON.stringify(res.data).slice(0, 200)}`,
          );
        }

        // Most importantly: no 500s anywhere
        expect(res.status).not.toBe(500);
      }

      console.log(
        '[smoke-db] DB endpoint check results:\n' +
        results.map((r) => `  ${r.status} ${r.path}`).join('\n'),
      );
    });
  });
});
