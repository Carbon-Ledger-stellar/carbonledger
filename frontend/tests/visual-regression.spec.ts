import { test, expect } from '@playwright/test';

test.describe('Visual Regression Tests', () => {
  test('marketplace page snapshot', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');
    
    // Wait for marketplace content to load
    await page.waitForSelector('[data-testid="marketplace-container"]', { timeout: 5000 });
    
    // Take snapshot
    await expect(page).toHaveScreenshot('marketplace-page.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    });
  });

  test('credit card component snapshot', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');
    
    // Wait for credit cards to load
    await page.waitForSelector('[data-testid="credit-card"]', { timeout: 5000 });
    
    // Take snapshot of first credit card
    const creditCard = page.locator('[data-testid="credit-card"]').first();
    await expect(creditCard).toHaveScreenshot('credit-card.png', {
      maxDiffPixels: 50,
      threshold: 0.15,
    });
  });

  test('retirement certificate snapshot', async ({ page }) => {
    await page.goto('/retire');
    await page.waitForLoadState('networkidle');
    
    // Wait for certificate component
    await page.waitForSelector('[data-testid="retirement-certificate"]', { timeout: 5000 });
    
    // Take snapshot
    const certificate = page.locator('[data-testid="retirement-certificate"]');
    await expect(certificate).toHaveScreenshot('retirement-certificate.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    });
  });

  test('provenance trail snapshot', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    
    // Wait for provenance trail
    await page.waitForSelector('[data-testid="provenance-trail"]', { timeout: 5000 });
    
    // Take snapshot
    const trail = page.locator('[data-testid="provenance-trail"]');
    await expect(trail).toHaveScreenshot('provenance-trail.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    });
  });

  test('marketplace filter snapshot', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');
    
    // Wait for filter component
    await page.waitForSelector('[data-testid="marketplace-filter"]', { timeout: 5000 });
    
    // Take snapshot
    const filter = page.locator('[data-testid="marketplace-filter"]');
    await expect(filter).toHaveScreenshot('marketplace-filter.png', {
      maxDiffPixels: 50,
      threshold: 0.15,
    });
  });

  test('responsive design - mobile marketplace', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="marketplace-container"]', { timeout: 5000 });
    
    // Take mobile snapshot
    await expect(page).toHaveScreenshot('marketplace-mobile.png', {
      maxDiffPixels: 150,
      threshold: 0.25,
    });
  });

  test('responsive design - tablet marketplace', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="marketplace-container"]', { timeout: 5000 });
    
    // Take tablet snapshot
    await expect(page).toHaveScreenshot('marketplace-tablet.png', {
      maxDiffPixels: 150,
      threshold: 0.25,
    });
  });

  test('dark mode marketplace', async ({ page }) => {
    // Enable dark mode
    await page.emulateMedia({ colorScheme: 'dark' });
    
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="marketplace-container"]', { timeout: 5000 });
    
    // Take dark mode snapshot
    await expect(page).toHaveScreenshot('marketplace-dark-mode.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    });
  });

  test('loading state snapshot', async ({ page }) => {
    // Intercept network to simulate slow loading
    await page.route('**/api/**', route => {
      setTimeout(() => route.continue(), 2000);
    });
    
    await page.goto('/marketplace');
    
    // Take snapshot during loading
    await page.waitForSelector('[data-testid="loading-skeleton"]', { timeout: 1000 });
    await expect(page).toHaveScreenshot('marketplace-loading.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    });
  });

  test('error state snapshot', async ({ page }) => {
    // Simulate API error
    await page.route('**/api/marketplace**', route => {
      route.abort('failed');
    });
    
    await page.goto('/marketplace');
    
    // Wait for error message
    await page.waitForSelector('[data-testid="error-message"]', { timeout: 5000 });
    
    // Take error state snapshot
    await expect(page).toHaveScreenshot('marketplace-error.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    });
  });
});
