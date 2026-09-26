/**
 * Security Headers Verification — Playwright E2E test
 *
 * Issue #626: Verifies that all six required security response headers are
 * present and correctly configured on every main route of the production
 * build.
 *
 * Headers verified:
 *   1. Content-Security-Policy       — must not contain unsafe-eval or
 *                                      unsafe-inline in script-src
 *   2. Strict-Transport-Security     — max-age ≥ 1 year; includeSubDomains
 *   3. X-Frame-Options               — DENY
 *   4. X-Content-Type-Options        — nosniff
 *   5. Referrer-Policy               — strict-origin-when-cross-origin
 *   6. Permissions-Policy            — camera, microphone, geolocation all ()
 *
 * How it works:
 *   Playwright intercepts the HTTP response for each page and reads the
 *   response headers directly — no browser parsing needed.  This guarantees
 *   the check reflects what the server actually sends, not what the DOM sees.
 *
 * Run locally:
 *   npm run test:e2e -- tests/e2e/security-headers.spec.ts
 *
 * Run in CI:
 *   Triggered automatically by the `security-headers` Playwright project
 *   defined in playwright.config.ts.
 */

import { test, expect, APIResponse } from '@playwright/test';

// Routes that must carry the full security header set.
const ROUTES_UNDER_TEST = [
  '/',
  '/marketplace',
  '/audit',
  '/projects',
  '/dashboard',
];

// ── Helper ─────────────────────────────────────────────────────────────────────

async function getHeaders(
  route: string,
  requestFetch: (url: string, options?: object) => Promise<APIResponse>
): Promise<Record<string, string>> {
  const response = await requestFetch(route);
  const headers: Record<string, string> = {};
  // Playwright APIResponse.headers() returns an object with lower-cased keys.
  for (const [key, value] of Object.entries(response.headers())) {
    headers[key.toLowerCase()] = value;
  }
  return headers;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

for (const route of ROUTES_UNDER_TEST) {
  test.describe(`Security headers on ${route}`, () => {
    let headers: Record<string, string>;

    test.beforeAll(async ({ request }) => {
      headers = await getHeaders(route, (url, opts) =>
        request.get(url, opts)
      );
    });

    // 1. Content-Security-Policy ───────────────────────────────────────────────
    test('CSP header is present', () => {
      expect(headers['content-security-policy']).toBeTruthy();
    });

    test('CSP script-src does not contain unsafe-eval', () => {
      const csp = headers['content-security-policy'] ?? '';
      expect(csp).not.toContain('unsafe-eval');
    });

    test('CSP script-src does not contain unsafe-inline', () => {
      const csp = headers['content-security-policy'] ?? '';
      // Next.js nonce injection uses 'strict-dynamic' — no broad unsafe-inline.
      // We allow 'unsafe-inline' in style-src (CSS-in-JS) but never script-src.
      const scriptSrc = csp
        .split(';')
        .find(d => d.trim().startsWith('script-src'));
      expect(scriptSrc).not.toContain('unsafe-inline');
    });

    test('CSP contains frame-ancestors none', () => {
      const csp = headers['content-security-policy'] ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
    });

    test('CSP contains report-uri /api/csp-report', () => {
      const csp = headers['content-security-policy'] ?? '';
      expect(csp).toContain('report-uri /api/csp-report');
    });

    // 2. Strict-Transport-Security ─────────────────────────────────────────────
    test('HSTS header is present', () => {
      expect(headers['strict-transport-security']).toBeTruthy();
    });

    test('HSTS max-age is at least 1 year (31536000 seconds)', () => {
      const hsts = headers['strict-transport-security'] ?? '';
      const match = hsts.match(/max-age=(\d+)/);
      expect(match).toBeTruthy();
      const maxAge = parseInt(match![1], 10);
      expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
    });

    test('HSTS includes includeSubDomains', () => {
      const hsts = headers['strict-transport-security'] ?? '';
      expect(hsts).toContain('includeSubDomains');
    });

    // 3. X-Frame-Options ───────────────────────────────────────────────────────
    test('X-Frame-Options is DENY', () => {
      expect(headers['x-frame-options']?.toUpperCase()).toBe('DENY');
    });

    // 4. X-Content-Type-Options ────────────────────────────────────────────────
    test('X-Content-Type-Options is nosniff', () => {
      expect(headers['x-content-type-options']).toBe('nosniff');
    });

    // 5. Referrer-Policy ───────────────────────────────────────────────────────
    test('Referrer-Policy is strict-origin-when-cross-origin', () => {
      expect(headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin'
      );
    });

    // 6. Permissions-Policy ────────────────────────────────────────────────────
    test('Permissions-Policy header is present', () => {
      expect(headers['permissions-policy']).toBeTruthy();
    });

    test('Permissions-Policy disables camera', () => {
      expect(headers['permissions-policy']).toContain('camera=()');
    });

    test('Permissions-Policy disables microphone', () => {
      expect(headers['permissions-policy']).toContain('microphone=()');
    });

    test('Permissions-Policy disables geolocation', () => {
      expect(headers['permissions-policy']).toContain('geolocation=()');
    });
  });
}

// ── CSP report endpoint availability ──────────────────────────────────────────
test.describe('CSP report endpoint /api/csp-report', () => {
  test('accepts POST with a valid CSP report body and returns 204', async ({
    request,
  }) => {
    const response = await request.post('/api/csp-report', {
      headers: { 'Content-Type': 'application/csp-report' },
      data: JSON.stringify({
        'csp-report': {
          'document-uri': 'https://carbonledger.io/',
          referrer: '',
          'violated-directive': 'script-src',
          'effective-directive': 'script-src',
          'original-policy': "script-src 'self'",
          'blocked-uri': 'https://evil.example',
          'status-code': 0,
        },
      }),
    });
    expect(response.status()).toBe(204);
  });

  test('returns 204 even for a malformed body (graceful degradation)', async ({
    request,
  }) => {
    const response = await request.post('/api/csp-report', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not-valid-json{{{',
    });
    expect(response.status()).toBe(204);
  });
});
