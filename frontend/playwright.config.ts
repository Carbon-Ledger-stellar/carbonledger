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
 * Each project name follows the pattern "<browser>-<wallet>" so CI log lines
 * and artifact names make the failing combination immediately obvious.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  /**
   * In CI, run 6 workers (one per browser/wallet combination) in parallel.
   * Locally keep Playwright's automatic worker detection.
   */
  workers: isCI ? 6 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    // JUnit output so GitHub Actions can parse test results for annotations
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
    // Brave uses the Chromium engine. In CI we run it as a Chromium-based
    // browser with the security/privacy flags that Brave enables by default.
    {
      name: 'brave-freighter',
      use: {
        ...devices['Desktop Chrome'],
        // Brave is launched as Chromium; add the flags Brave enables by default
        launchOptions: {
          args: [
            '--disable-dev-shm-usage',
            '--no-sandbox',
            // Simulate Brave's default fingerprinting-protection flag
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
