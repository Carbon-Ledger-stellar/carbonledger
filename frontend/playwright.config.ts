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
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 6 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    // JUnit output parsed by dorny/test-reporter for GitHub check annotations
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },

  projects: [
    // ── Chrome × Freighter ───────────────────────────────────────────────
    {
      name: 'chrome-freighter',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
    // ── Chrome × Xbull ──────────────────────────────────────────────────
    {
      name: 'chrome-xbull',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
    // ── Firefox × Freighter ─────────────────────────────────────────────
    {
      name: 'firefox-freighter',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    // ── Firefox × Xbull ─────────────────────────────────────────────────
    {
      name: 'firefox-xbull',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    // ── Brave × Freighter ───────────────────────────────────────────────
    {
      name: 'brave-freighter',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
          ],
        },
      },
    },
    // ── Brave × Xbull ───────────────────────────────────────────────────
    {
      name: 'brave-xbull',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
          ],
        },
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCI,
    timeout: 120 * 1000,
  },
});
