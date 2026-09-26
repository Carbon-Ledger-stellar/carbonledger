/**
 * smoke-frontend.spec.ts
 *
 * Frontend smoke tests using Playwright.
 * Verifies the frontend loads without JavaScript errors on key pages.
 *
 * Pages covered:
 *   - / (main / home page)
 *   - /marketplace
 *   - /audit
 *   - /projects
 *
 * Pass criteria:
 *   - Page returns HTTP 200
 *   - No uncaught JavaScript errors in the console
 *   - Page has a meaningful <title>
 *   - Core headings or landmark elements are visible
 *
 * Closes #645
 */

import { test, expect, ConsoleMessage } from '@playwright/test';

// Pages to smoke-test after every deployment
const SMOKE_PAGES = [
  {
    path: '/',
    description: 'home page',
    expectedTitle: /carbonledger/i,
    landmarkSelector: 'main, [role="main"], h1',
  },
  {
    path: '/marketplace',
    description: 'marketplace page',
    expectedTitle: /marketplace|carbonledger/i,
    landmarkSelector: 'main, [role="main"], h1',
  },
  {
    path: '/audit',
    description: 'audit explorer page',
    expectedTitle: /audit|carbonledger/i,
    landmarkSelector: 'main, [role="main"], h1',
  },
  {
    path: '/projects',
    description: 'projects page',
    expectedTitle: /project|carbonledger/i,
    landmarkSelector: 'main, [role="main"], h1',
  },
] as const;

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

for (const { path, description, expectedTitle, landmarkSelector } of SMOKE_PAGES) {
  test.describe(`Smoke — ${description} (${path})`, () => {
    test('page loads with HTTP 200', async ({ page }) => {
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(path === '/' ? '' : path) || true),
        page.goto(path, { waitUntil: 'domcontentloaded' }),
      ]);

      // The navigation response itself must be 200
      const navRes = await page.goto(path, { waitUntil: 'networkidle' });
      expect(navRes?.status()).toBe(200);
    });

    test('no uncaught JavaScript errors', async ({ page }) => {
      const errors: string[] = [];

      page.on('pageerror', (err: Error) => {
        errors.push(err.message);
      });

      page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() === 'error') {
          errors.push(`[console.error] ${msg.text()}`);
        }
      });

      await page.goto(path, { waitUntil: 'networkidle' });

      // Filter out known non-critical noise
      const criticalErrors = errors.filter(
        (e) =>
          !e.includes('favicon') &&
          !e.includes('ResizeObserver') &&
          !e.includes('Non-Error exception') &&
          !e.includes('react-remove-scroll') &&
          // Freighter extension errors in non-extension environments
          !e.includes('freighter') &&
          !e.includes('xbull'),
      );

      expect(criticalErrors).toHaveLength(0);
    });

    test('page has a meaningful title', async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const title = await page.title();
      expect(title).toMatch(expectedTitle);
    });

    test('page has a visible landmark or heading', async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });
      const landmark = page.locator(landmarkSelector).first();
      await expect(landmark).toBeVisible({ timeout: 10_000 });
    });
  });
}

// ---------------------------------------------------------------------------
// Aggregate timing test
// ---------------------------------------------------------------------------

test('all smoke pages load within the 3-minute budget', async ({ page }) => {
  const START = Date.now();

  for (const { path } of SMOKE_PAGES) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
  }

  const elapsed = Date.now() - START;
  // 3 minutes = 180 000 ms; allow some headroom for page loads
  expect(elapsed).toBeLessThan(160_000);
});
