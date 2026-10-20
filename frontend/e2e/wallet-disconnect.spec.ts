import { test, expect } from '@playwright/test';

test.describe('Freighter wallet disconnect during signing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Minimal Freighter mock so the app can connect without the extension.
      (window as any).freighter = {
        isConnected: async () => ({ isConnected: true }),
        getPublicKey: async () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        signTransaction: async () => {
          throw new Error('Freighter is locked or disconnected');
        },
      };
    });
  });

  test('shows a recoverable error and preserves form input when the wallet disconnects mid-signing', async ({ page }) => {
    await page.goto('/');

    // Connect the wallet.
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await expect(page.getByText(/GAAAAA/i)).toBeVisible();

    // Fill in a retirement form so we can verify input is preserved.
    const amountInput = page.getByLabel(/amount/i).first();
    await amountInput.fill('10');

    // Trigger signing; the mocked Freighter rejects as if it were locked/disconnected.
    await page.getByRole('button', { name: /retire|purchase|submit/i }).first().click();

    // The pending UI must leave the loading state and surface a recoverable error.
    await expect(page.getByText(/wallet.*(disconnected|locked)|reconnect/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/signing|pending/i)).toBeHidden({ timeout: 15000 });

    // Form input must survive the failure so the user can retry.
    await expect(amountInput).toHaveValue('10');

    // A retry affordance should be available after reconnecting.
    await expect(page.getByRole('button', { name: /reconnect|retry/i }).first()).toBeVisible();
  });
});
