import { test, expect } from '@playwright/test';

/**
 * Lightweight visual smoke tests — full-page snapshots of key routes.
 * Baselines are generated on the first CI run in the same job (update then verify).
 */
const routes = [
  { name: 'home', path: '/' },
  { name: 'marketplace', path: '/marketplace' },
  { name: 'retire', path: '/retire' },
  { name: 'audit', path: '/audit' },
] as const;

test.describe('Visual Regression Tests', () => {
  for (const { name, path } of routes) {
    test(`${name} page snapshot`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      await expect(page).toHaveScreenshot(`${name}-page.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.05,
      });
    });
  }
});
