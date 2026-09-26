import { expect, Page, test } from '@playwright/test';
import { installMockWalletProvider } from './mocks/wallet-provider';

test.use({ serviceWorkers: 'block' });

const BUYER_PUBLIC_KEY =
  'GBNDJY5M6ZZ4LZZXQQB7M3XZ3R2S6R2B2J5Y6K2H5D2C2A4HFREIGHTER';
const TRANSACTION_HASH =
  'checkout-e2e-transaction-1234567890abcdef1234567890abcdef';
const LISTING = {
  listingId: 'checkout-e2e-listing',
  projectId: 'checkout-e2e-project',
  projectName: 'Amazon Reforestation',
  batchId: 'checkout-e2e-batch',
  seller: 'GDEVCHECKOUTSELLER',
  country: 'Brazil',
  vintageYear: 2024,
  methodology: 'VCS',
  amountAvailable: 10,
  pricePerCredit: '10000',
  status: 'Active',
};

async function stubCheckoutApi(page: Page): Promise<void> {
  await page.route(/\/marketplace\/listings(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        listings: [{ ...LISTING, id: 'checkout-e2e-listing-id' }],
        total_count: 1,
        next_cursor: null,
      }),
    }),
  );

  await page.route(/\/projects(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [], nextCursor: null, hasMore: false, total: 0 }),
    }),
  );

  await page.route(/\/marketplace\/bulk-purchase$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        txHash: TRANSACTION_HASH,
        batchIds: [LISTING.batchId],
      }),
    });
  });

  await page.route(/\/transactions\/checkout-e2e-transaction-/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ successful: true }),
    }),
  );
}

test.describe('Wallet checkout flow', () => {
  test('adds a batch to the cart and confirms purchase with a mock wallet', async ({ page }) => {
    await page.addInitScript(installMockWalletProvider, {
      publicKey: BUYER_PUBLIC_KEY,
      network: 'TESTNET',
      autoApprove: true,
    });
    await stubCheckoutApi(page);

    await page.goto('/marketplace');
    await expect(
      page.getByRole('heading', { name: /carbon marketplace/i }),
    ).toBeVisible();
    await expect(page.getByText(LISTING.projectName).first()).toBeVisible();

    await page.getByRole('button', { name: /\+ cart/i }).click();
    await page.getByRole('link', { name: /cart \(1\)/i }).click();

    await expect(
      page.getByRole('heading', { name: /bulk purchase cart/i }),
    ).toBeVisible();
    await page.getByRole('button', { name: /connect wallet to purchase/i }).click();
    await page.getByRole('button', { name: /purchase .*usdc/i }).click();

    await expect(page.getByText('Purchase confirmed!')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Transaction confirmed')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Transaction failed')).not.toBeVisible();
  });

  test('auto-signs transaction payloads without hanging', async ({ page }) => {
    await page.addInitScript(installMockWalletProvider, {
      publicKey: BUYER_PUBLIC_KEY,
      network: 'TESTNET',
      autoApprove: true,
    });

    await page.goto('/marketplace');
    const signedPayload = await page.evaluate(async () => {
      const wallet = (window as unknown as { stellar: { signTransaction: (xdr: string) => Promise<{ signedTxXdr: string }> } }).stellar;
      return wallet.signTransaction('checkout-payload');
    });

    expect(signedPayload.signedTxXdr).toBe('checkout-payload.mock-signed');
  });
});