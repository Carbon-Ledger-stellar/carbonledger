import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for frontend smoke tests.
 * Runs against the deployed (or locally running) frontend only.
 * Must complete under 3 minutes.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/smoke-frontend.spec.ts',
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'smoke-playwright-report', open: 'never' }],
    ['junit', { outputFile: 'smoke-playwright-junit.xml' }],
  ],
  use: {
    baseURL: process.env.SMOKE_FRONTEND_URL ?? 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
    // Smoke tests use a lightweight headless browser
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-smoke',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
