import { test, expect } from '@playwright/test';

// Test accounts (funded on testnet) - Set these environment variables
const PROJECT_DEVELOPER = process.env.E2E_PROJECT_DEVELOPER || 'G...'; // Funded testnet account
const VERIFIER = process.env.E2E_VERIFIER || 'G...'; // Verifier account with auth token
const BUYER = process.env.E2E_BUYER || 'G...'; // Funded buyer account

// Mock Freighter wallet for E2E tests
async function mockFreighter(page: any, publicKey: string) {
  await page.addInitScript(() => {
    // Mock Freighter API
    (window as any).freighter = {
      getPublicKey: () => Promise.resolve({ publicKey, error: null }),
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
  });
}

test.describe('Carbon Credit Lifecycle E2E', () => {
  test('complete lifecycle: registration → verification → minting → listing → purchase → retirement → certificate', async ({ page }) => {
    // Setup test data
    const projectId = `test-project-${Date.now()}`;
    const batchId = `test-batch-${Date.now()}`;
    const listingId = `test-listing-${Date.now()}`;
    const retirementId = `test-retirement-${Date.now()}`;

    // 1. Project Registration (Project Developer)
    await mockFreighter(page, PROJECT_DEVELOPER);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /register project/i }).click();

    // Fill project registration form
    await page.getByLabel('Project ID').fill(projectId);
    await page.getByLabel('Project Name').fill('Test Amazon Reforestation');
    await page.getByLabel('Methodology').selectOption('VCS');
    await page.getByLabel('Country').selectOption('Brazil');
    await page.getByLabel('Vintage Year').fill('2023');
    await page.getByLabel('Project Type').selectOption('Reforestation');
    await page.getByLabel('Metadata CID').fill('QmTest123');

    await page.getByRole('button', { name: /register/i }).click();
    await expect(page.getByText('Project registered successfully')).toBeVisible();

    // Verify project appears in pending projects
    await page.goto('/projects');
    await expect(page.getByText('Test Amazon Reforestation')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();

    // 2. Project Verification (Verifier)
    await mockFreighter(page, VERIFIER);

    await page.goto('/verifier/dashboard');
    await page.getByLabel('Verifier Public Key').fill(VERIFIER);
    await page.getByLabel('Auth Token').fill(process.env.VERIFIER_TOKEN!);
    await page.getByRole('button', { name: /load projects/i }).click();

    await expect(page.getByText(projectId)).toBeVisible();
    await page.getByRole('button', { name: /verify/i }).click();
    await expect(page.getByText('Project verified')).toBeVisible();

    // Verify project status changed
    await page.goto('/projects');
    await expect(page.getByText('Verified')).toBeVisible();

    // 3. Credit Minting (Project Developer)
    await mockFreighter(page, PROJECT_DEVELOPER);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /mint credits/i }).click();

    // Fill minting form
    await page.getByLabel('Batch ID').fill(batchId);
    await page.getByLabel('Project ID').fill(projectId);
    await page.getByLabel('Amount').fill('1000');
    await page.getByLabel('Vintage Year').fill('2023');
    await page.getByLabel('Serial Start').fill('CARB-001-0001');
    await page.getByLabel('Serial End').fill('CARB-001-1000');
    await page.getByLabel('Metadata CID').fill('QmBatch123');

    await page.getByRole('button', { name: /mint/i }).click();
    await expect(page.getByText('Credits minted successfully')).toBeVisible();

    // 4. Marketplace Listing (Project Developer)
    await page.getByRole('button', { name: /list credits/i }).click();

    // Fill listing form
    await page.getByLabel('Listing ID').fill(listingId);
    await page.getByLabel('Batch ID').fill(batchId);
    await page.getByLabel('Amount').fill('500');
    await page.getByLabel('Price per Credit (stroops)').fill('25000000'); // 25 USDC

    await page.getByRole('button', { name: /list/i }).click();
    await expect(page.getByText('Credits listed successfully')).toBeVisible();

    // Verify listing appears in marketplace
    await page.goto('/marketplace');
    await expect(page.getByText('Test Amazon Reforestation')).toBeVisible();
    await expect(page.getByText('$25.00')).toBeVisible();

    // 5. Purchase Credits (Buyer)
    await mockFreighter(page, BUYER);

    await page.goto(`/buy?listing=${listingId}`);
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await expect(page.getByText('Wallet connected')).toBeVisible();

    await page.getByLabel('Amount to purchase').fill('100');
    await page.getByRole('button', { name: /purchase/i }).click();

    await expect(page.getByText('Purchase confirmed')).toBeVisible();

    // 6. Retirement (Buyer)
    await page.goto('/retire');
    await page.getByLabel('Batch ID').fill(batchId);
    await page.getByLabel('Amount').fill('50');
    await page.getByLabel('Beneficiary').fill('Green Corp Inc.');
    await page.getByLabel('Retirement Reason').fill('Corporate ESG Initiative');

    await page.getByRole('button', { name: /retire/i }).click();
    await expect(page.getByText('Retirement confirmed')).toBeVisible();

    // Store retirement ID for later
    const retirementUrl = page.url();
    const url = new URL(retirementUrl);
    const actualRetirementId = url.searchParams.get('id') || retirementId;

    // 7. View Certificate
    await page.goto(`/retire/${actualRetirementId}`);
    await expect(page.getByText('Carbon Credit Retirement Certificate')).toBeVisible();
    await expect(page.getByText('Green Corp Inc.')).toBeVisible();
    await expect(page.getByText('50')).toBeVisible();

    // 8. Test Retirement Irreversibility
    await page.goto('/retire');
    await page.getByLabel('Batch ID').fill(batchId);
    await page.getByLabel('Amount').fill('10'); // Try to retire more
    await page.getByLabel('Beneficiary').fill('Test Corp');
    await page.getByLabel('Retirement Reason').fill('Test');

    await page.getByRole('button', { name: /retire/i }).click();
    await expect(page.getByText('Retirement failed')).toBeVisible();
    await expect(page.getByText(/insufficient credits/i)).toBeVisible();
  });
});