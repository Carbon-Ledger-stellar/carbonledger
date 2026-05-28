import { test, expect } from '@playwright/test';

/**
 * E2E tests for the public Audit Explorer — #426
 *
 * The audit explorer is used by regulators and journalists.
 * No wallet connection is required for any of these flows.
 */

test.describe('Audit Explorer — no wallet required', () => {
  test.beforeEach(async ({ page }) => {
    // Confirm no wallet is injected — audit page must work without Freighter
    await page.addInitScript(() => {
      // Explicitly remove any wallet globals to simulate a non-wallet browser
      delete (window as any).freighter;
      delete (window as any).stellar;
    });
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  test('navigates to audit explorer without wallet and page loads', async ({ page }) => {
    await page.goto('/audit');

    // Page title / heading must be visible
    await expect(page.getByRole('heading', { name: /audit/i })).toBeVisible();

    // No wallet-required prompt should block the page
    await expect(page.getByText(/connect.*wallet/i)).not.toBeVisible();

    // Search form must be present
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  });

  // ── Serial number lookup — known retired credit ───────────────────────────

  test('serial number lookup shows provenance trail for a known credit', async ({ page }) => {
    await page.goto('/audit');

    // Select serial number search type if a selector exists
    const typeSelect = page.locator('select').first();
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption({ label: /serial/i });
    }

    // Enter a serial number and submit
    const searchInput = page.getByRole('textbox').first();
    await searchInput.fill('CRB-2024-001-00001');
    await page.getByRole('button', { name: /search/i }).click();

    // Either provenance trail renders OR an empty-state message appears
    // (depends on whether testnet has seeded data)
    await expect(
      page.getByText(/provenance/i).or(page.getByText(/no.*found|not found|empty/i))
    ).toBeVisible({ timeout: 15000 });
  });

  // ── Retirement certificate link ───────────────────────────────────────────

  test('retired credit shows retirement certificate link', async ({ page }) => {
    await page.goto('/audit');

    const typeSelect = page.locator('select').first();
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption({ label: /retirement/i });
    }

    const searchInput = page.getByRole('textbox').first();
    await searchInput.fill('RET-TEST-001');
    await page.getByRole('button', { name: /search/i }).click();

    // If a result is returned it must contain a certificate link or download button
    const result = page.locator('[data-testid="search-result"], .bg-white').first();
    const hasResult = await result.isVisible({ timeout: 10000 }).catch(() => false);

    if (hasResult) {
      // Certificate link must be present for a retired credit
      await expect(
        page.getByRole('link', { name: /certificate/i })
          .or(page.getByRole('button', { name: /certificate/i }))
          .or(page.getByText(/certificate/i))
      ).toBeVisible();
    }
  });

  // ── Unknown serial number — empty state ───────────────────────────────────

  test('unknown serial number shows correct empty state', async ({ page }) => {
    await page.goto('/audit');

    const typeSelect = page.locator('select').first();
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption({ label: /serial/i });
    }

    const searchInput = page.getByRole('textbox').first();
    // Use a serial number that will never exist
    await searchInput.fill('CRB-0000-000-99999');
    await page.getByRole('button', { name: /search/i }).click();

    // Must show an empty / not-found state — not a 500 error
    await expect(
      page.getByText(/not found|no.*result|no records|empty|failed/i)
    ).toBeVisible({ timeout: 15000 });

    // Must NOT show a raw server error or stack trace
    await expect(page.getByText(/internal server error/i)).not.toBeVisible();
    await expect(page.getByText(/prisma/i)).not.toBeVisible();
  });

  // ── Project ID search ─────────────────────────────────────────────────────

  test('project ID search returns results or empty state without wallet', async ({ page }) => {
    await page.goto('/audit');

    const typeSelect = page.locator('select').first();
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption({ label: /project/i });
    }

    const searchInput = page.getByRole('textbox').first();
    await searchInput.fill('PROJ-NONEXISTENT-12345');
    await page.getByRole('button', { name: /search/i }).click();

    // Page must respond — either results or empty state
    await expect(
      page.getByText(/not found|no.*result|no records|empty|failed|credit detail/i)
    ).toBeVisible({ timeout: 15000 });

    // No wallet prompt must appear
    await expect(page.getByText(/connect.*wallet/i)).not.toBeVisible();
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  test('shows loading indicator while search is in progress', async ({ page }) => {
    await page.goto('/audit');

    const searchInput = page.getByRole('textbox').first();
    await searchInput.fill('CRB-2024-001-00001');

    // Intercept the API call to delay it so we can observe the loading state
    await page.route('**/api/audit/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });

    await page.getByRole('button', { name: /search/i }).click();

    // Loading indicator must appear
    await expect(
      page.getByText(/searching|loading/i)
        .or(page.locator('[class*="spin"], [class*="loading"], [aria-busy="true"]').first())
    ).toBeVisible({ timeout: 3000 });
  });

  // ── Page accessibility — no wallet prompt blocks content ──────────────────

  test('audit page is fully accessible without wallet connection', async ({ page }) => {
    await page.goto('/audit');

    // The main content area must be visible
    await expect(page.locator('main, [role="main"], .min-h-screen').first()).toBeVisible();

    // Search form elements must be interactive
    const searchInput = page.getByRole('textbox').first();
    await expect(searchInput).toBeEnabled();

    const searchButton = page.getByRole('button', { name: /search/i });
    await expect(searchButton).toBeEnabled();
  });
});
