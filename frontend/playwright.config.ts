/**
 * Playwright configuration — CarbonLedger frontend
 *
 * Issue #628: Added a dedicated `lifecycle-testnet` project that runs the
 * full carbon credit lifecycle E2E suite (`tests/e2e/full-lifecycle.spec.ts`)
 * against a live Stellar testnet deployment.  Screenshots are taken at every
 * lifecycle stage; a JSON results report is produced for the CI artefact step.
 *
 * Issue #626: The `security-headers` project runs the header verification
 * spec against the production build to confirm all six required headers are
 * present on every response.
 *
 * Standard projects (chromium / firefox / webkit) run against localhost for
 * unit-level UI tests and the existing E2E suite.
 */

import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

/**
 * Playwright configuration for CarbonLedger.
 *
 * Browser / wallet matrix:
 *   - chrome   × Freighter
 *   - chrome   × Xbull
 *   - firefox  × Freighter
 *   - firefox  × Xbull
 *   - brave    × Freighter
 *   - brave    × Xbull
 *
 * JUnit output is always written to test-results/junit.xml so the
 * ci-test-annotations workflow can parse it for inline PR annotations.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 6 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    // Machine-readable list for CI summary badge.
    ['list'],
  ],
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    // Capture a screenshot at every lifecycle stage assertion (#628).
    screenshot: 'on',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },

  projects: process.env.CI
    ? [
        // ── Standard CI project: runs all non-lifecycle specs ────────────────
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
          testIgnore: [
            '**/e2e/full-lifecycle.spec.ts',
            '**/e2e/security-headers.spec.ts',
          ],
        },

        // ── Issue #628: Full lifecycle against testnet ────────────────────────
        // Only runs when STELLAR_TESTNET_URL is provided (set in CI secrets).
        {
          name: 'lifecycle-testnet',
          use: {
            ...devices['Desktop Chrome'],
            baseURL:
              process.env.STELLAR_TESTNET_APP_URL ||
              process.env.NEXT_PUBLIC_APP_URL ||
              'http://localhost:3000',
            // Every lifecycle stage screenshot is saved.
            screenshot: 'on',
          },
          testMatch: ['**/e2e/full-lifecycle.spec.ts'],
        },

        // ── Issue #626: Security header verification ─────────────────────────
        {
          name: 'security-headers',
          use: {
            ...devices['Desktop Chrome'],
            baseURL:
              process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          },
          testMatch: ['**/e2e/security-headers.spec.ts'],
        },
      ]
    : [
        // ── Local development: all browsers, all specs ───────────────────────
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'firefox',
          use: { ...devices['Desktop Firefox'] },
        },
        {
          name: 'webkit',
          use: { ...devices['Desktop Safari'] },
        },
      ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_REGISTRY_CONTRACT:
        process.env.NEXT_PUBLIC_REGISTRY_CONTRACT ||
        'C_REGISTRY_TEST_CONTRACT_ID000000000000000001',
    },
  },
});
