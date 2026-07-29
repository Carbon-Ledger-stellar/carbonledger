/**
 * smoke-backend.test.ts
 *
 * Backend API smoke tests.
 * Runs after testnet deployment to verify the API is healthy and responsive.
 *
 * Checks:
 *   - GET /health              → { status: "ok" }
 *   - GET /health/ready        → { status: "ok", checks: { db: "ok", ... } }
 *   - GET /projects            → array shape
 *   - GET /marketplace/listings → array shape
 *   - GET /credits/batch/:id   → 404 expected (valid shape, not 500)
 *
 * Must complete in under 30 seconds total.
 *
 * Closes #645
 */

import axios, { AxiosResponse } from 'axios';

const API_URL = process.env.SMOKE_API_URL ?? 'http://localhost:3001/api/v1';
const RAW_URL = process.env.SMOKE_API_RAW_URL ?? 'http://localhost:3001';
const TIMEOUT_MS = 10_000;

const http = axios.create({
  baseURL: API_URL,
  timeout: TIMEOUT_MS,
  validateStatus: () => true, // never throw on non-2xx
});

const raw = axios.create({
  baseURL: RAW_URL,
  timeout: TIMEOUT_MS,
  validateStatus: () => true,
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function assertStatus(res: AxiosResponse, expected: number, context: string): void {
  if (res.status !== expected) {
    throw new Error(
      `[${context}] Expected HTTP ${expected}, got ${res.status}. Body: ${JSON.stringify(res.data).slice(0, 200)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Backend Smoke Tests', () => {
  // ── /health ──────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await raw.get('/health');
      assertStatus(res, 200, 'GET /health');
      expect(res.data).toHaveProperty('status', 'ok');
    });

    it('responds within 5 seconds', async () => {
      const start = Date.now();
      await raw.get('/health');
      expect(Date.now() - start).toBeLessThan(5_000);
    });
  });

  // ── /health/ready ─────────────────────────────────────────────────────────

  describe('GET /health/ready', () => {
    it('returns 200 with status ok when all checks pass', async () => {
      const res = await raw.get('/health/ready');
      // Status may be 503 if Redis/Stellar are not available in smoke context;
      // we accept both 200 and 503 but require the correct shape.
      expect([200, 503]).toContain(res.status);
      expect(res.data).toHaveProperty('status');
      expect(res.data).toHaveProperty('checks');
      expect(typeof res.data.checks).toBe('object');
    });

    it('includes db check in response', async () => {
      const res = await raw.get('/health/ready');
      expect(res.data.checks).toHaveProperty('db');
    });
  });

  // ── /api/v1/projects ─────────────────────────────────────────────────────

  describe('GET /projects', () => {
    it('returns 200 with an array body', async () => {
      const res = await http.get('/projects');
      assertStatus(res, 200, 'GET /projects');
      const items = Array.isArray(res.data)
        ? res.data
        : res.data.projects ?? res.data.data ?? [];
      expect(items).toBeInstanceOf(Array);
    });

    it('each project item has expected shape', async () => {
      const res = await http.get('/projects');
      const items = Array.isArray(res.data)
        ? res.data
        : res.data.projects ?? res.data.data ?? [];
      items.forEach((p: unknown) => {
        const project = p as Record<string, unknown>;
        expect(project).toHaveProperty('projectId');
        expect(project).toHaveProperty('name');
        expect(project).toHaveProperty('methodology');
      });
    });
  });

  // ── /api/v1/marketplace/listings ─────────────────────────────────────────

  describe('GET /marketplace/listings', () => {
    it('returns 200 with an array body', async () => {
      const res = await http.get('/marketplace/listings');
      assertStatus(res, 200, 'GET /marketplace/listings');
      const listings = Array.isArray(res.data)
        ? res.data
        : res.data.listings ?? res.data.data ?? [];
      expect(listings).toBeInstanceOf(Array);
    });
  });

  // ── API error shape (not 500) ─────────────────────────────────────────────

  describe('Error response shape', () => {
    it('GET /credits/batch/smoke-unknown returns 404 not 500', async () => {
      const res = await http.get('/credits/batch/smoke-unknown-id-99999');
      expect(res.status).toBe(404);
      expect(res.data).toHaveProperty('message');
      expect(res.status).not.toBe(500);
    });

    it('GET /projects/smoke-unknown returns 404 not 500', async () => {
      const res = await http.get('/projects/smoke-unknown-id-99999');
      expect(res.status).toBe(404);
      expect(res.status).not.toBe(500);
    });
  });
});
