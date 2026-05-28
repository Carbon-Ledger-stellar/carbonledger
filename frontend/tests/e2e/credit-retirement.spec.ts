import { test, expect } from '@playwright/test';

// Test accounts
const MOCK_WALLET = 'GBNDJY5M6ZZ4LZZXQQB7M3XZ3R2S6R2B2J5Y6K2H5D2C2A4H';
const BATCH_ID = 'test-batch-001';
const RETIREMENT_ID = 'ret-123456';
const TX_HASH = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

async function mockFreighter(page: any, publicKey: string) {
  await page.addInitScript((pubKey: string) => {
    (window as any).freighter = {
      getPublicKey: () => Promise.resolve({ publicKey: pubKey, error: null }),
      signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: xdr + '_signed', error: null }),
      isConnected: () => Promise.resolve({ isConnected: true }),
      isAllowed: () => Promise.resolve({ isAllowed: true }),
      setAllowed: () => Promise.resolve({ isAllowed: true }),
      getNetworkDetails: () => Promise.resolve({
        network: 'TESTNET',
        networkPassphrase: 'Test SDF Network ; September 2015',
        error: null
      }),
    };
  }, publicKey);
}

test.describe('Credit Retirement Flow', () => {
  test('navigates through retirement flow to certificate generation', async ({ page }) => {
    // 1. Mock API endpoints
    await page.route('**/credits/retire', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          txHash: TX_HASH,
          retirementId: RETIREMENT_ID
        })
      });
    });

    await page.route(`**/retirements/${RETIREMENT_ID}`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: RETIREMENT_ID,
          retirementId: RETIREMENT_ID,
          batchId: BATCH_ID,
          projectId: 'proj-001',
          amount: 5,
          retiredBy: MOCK_WALLET,
          beneficiary: 'Eco Corp',
          retirementReason: 'Offsetting Q1 emissions',
          vintageYear: 2023,
          serialNumbers: ['SN-001', 'SN-005'],
          retiredAt: new Date().toISOString(),
          txHash: TX_HASH,
          project: {
            name: 'Test Project',
            methodology: 'VCS',
            country: 'Brazil'
          }
        })
      });
    });

    // 2. Setup Freighter mock
    await mockFreighter(page, MOCK_WALLET);

    // 3. Navigate to the retire page with a pre-purchased credit
    await page.goto(`/retire?batch=${BATCH_ID}`);

    // Verify page loads correctly
    await expect(page.locator('h1')).toContainText('Retire Carbon Credits');

    // 4. Fill in beneficiary name and retirement reason
    await page.fill('input[type="number"]', '5'); // Amount
    await page.fill('#retire-beneficiary', 'Eco Corp');
    await page.fill('#retire-reason', 'Offsetting Q1 emissions');

    // Ensure we can see the retire button and click it
    const retireBtn = page.getByRole('button', { name: /permanently retire/i });
    await expect(retireBtn).toBeVisible();

    // The user might encounter a prompt to connect wallet, let's just make sure it's connected
    // Freighter is mocked so the button should naturally be "Permanently Retire X" once connected
    await retireBtn.click();

    // 5. Verify the success state shows the certificate link
    const certificateLink = page.getByRole('link', { name: /view & download certificate/i });
    await expect(certificateLink).toBeVisible({ timeout: 15000 });
    
    // We also expect the toast to show up
    await expect(page.getByText('Credits permanently retired')).toBeVisible();

    // 6. Navigate to the certificate URL and verify all fields are populated
    await certificateLink.click();

    // On certificate page
    await expect(page.locator('h1')).toContainText('Carbon Credit Retirement Certificate');
    await expect(page.getByText('Eco Corp')).toBeVisible();
    await expect(page.getByText('Offsetting Q1 emissions')).toBeVisible();
    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(page.getByText(TX_HASH)).toBeVisible();
  });
});
