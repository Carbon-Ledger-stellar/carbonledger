/**
 * marketplace-flow.spec.ts
 *
 * End-to-end coverage of the complete marketplace user journey (issue #1049):
 *
 *   browse  →  search  →  buy  →  retire  →  download certificate
 *
 * The existing e2e specs each cover a slice of this — `checkout.spec.ts`
 * (browse → purchase), `credit-retirement.spec.ts` (retire → certificate
 * fields). This spec stitches the whole path into a single journey and adds
 * the two things issue #1049 asks for on top of that:
 *
 *   • a per-transaction performance baseline (< 5s per on-chain submission),
 *     measured for both the purchase and the retirement and written to a
 *     `marketplace-flow-perf.json` artifact for trend tracking;
 *   • an explicit screenshot capture on failure (in addition to the
 *     always-on screenshot configured in `playwright.config.ts`).
 *
 * Determinism: the wallet is a headless mock (`installMockFreighter`, the
 * same postMessage shim `checkout.spec.ts` uses) and every backend / Horizon
 * route is stubbed at the network layer, so the suite never touches a live
 * Stellar network and is safe to run in CI on every PR.
 *
 * Closes #1049
 */

import { test, expect, Page, TestInfo } from '@playwright/test';
import { installMockFreighter } from '../mocks/mock-freighter';

// The audit service worker would take over fetches and bypass `page.route`
// stubs; block it so the flow runs against the stubbed backend only.
test.use({ serviceWorkers: 'block' });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BUYER_PUBLIC_KEY =
  'GBNDJY5M6ZZ4LZZXQQB7M3XZ3R2S6R2B2J5Y6K2H5D2C2A4HFREIGHTER';

/** Two listings so the search step has something to narrow down. */
const LISTINGS = [
  {
    listingId: 'listing-flow-amazon',
    projectId: 'proj-flow-amazon',
    projectName: 'Amazon Reforestation',
    batchId: 'batch-flow-amazon',
    seller: 'GSELLERAMAZON',
    country: 'Brazil',
    vintageYear: 2024,
    methodology: 'VCS',
    amountAvailable: 25,
    pricePerCredit: '12000',
    status: 'Active',
  },
  {
    listingId: 'listing-flow-borneo',
    projectId: 'proj-flow-borneo',
    projectName: 'Borneo Peatland Restoration',
    batchId: 'batch-flow-borneo',
    seller: 'GSELLERBORNEO',
    country: 'Indonesia',
    vintageYear: 2023,
    methodology: 'GS',
    amountAvailable: 40,
    pricePerCredit: '9000',
    status: 'Active',
  },
] as const;

const TARGET = LISTINGS[0];
const OTHER = LISTINGS[1];

const TX_HASH =
  'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';
const RETIREMENT_ID = 'ret-flow-000001';
const RETIRE_TX_HASH =
  'def456abc123def456abc123def456abc123def456abc123def456abc123def4';

/** Any transaction the purchase / retirement round-trip may not exceed. */
const TRANSACTION_BUDGET_MS = 5_000;

// ---------------------------------------------------------------------------
// Network stubs
// ---------------------------------------------------------------------------

async function stubBackend(
  page: Page,
  captured: {
    purchaseBodies: Array<Record<string, unknown>>;
    retireBodies: Array<Record<string, unknown>>;
  },
): Promise<void> {
  // Marketplace listing index — honours the `search` query param so the
  // search step genuinely narrows the result set.
  await page.route(/\/marketplace\/listings(\?|$)/, (route) => {
    // `useListings` serialises every param, so an unset filter arrives as the
    // literal string "undefined" — treat that (and "") as "no search".
    const raw = new URL(route.request().url()).searchParams.get('search');
    const search =
      raw && raw !== 'undefined' ? raw.toLowerCase() : '';
    const rows = LISTINGS.filter(
      (l) =>
        !search ||
        l.projectName.toLowerCase().includes(search) ||
        l.country.toLowerCase().includes(search),
    ).map((l, i) => ({ ...l, id: String(i + 1) }));

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        listings: rows,
        total_count: rows.length,
        next_cursor: null,
      }),
    });
  });

  // Single listing (buy page).
  await page.route(
    new RegExp(`/marketplace/listings/${TARGET.listingId}`),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...TARGET,
          id: '1',
          createdAt: new Date().toISOString(),
        }),
      }),
  );

  // Purchase submission.
  await page.route(/\/marketplace\/purchase/, async (route) => {
    captured.purchaseBodies.push(
      JSON.parse(route.request().postData() ?? '{}'),
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        txHash: TX_HASH,
        batchId: TARGET.batchId,
      }),
    });
  });

  // Retirement submission.
  await page.route(/\/credits\/retire/, async (route) => {
    captured.retireBodies.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        txHash: RETIRE_TX_HASH,
        retirementId: RETIREMENT_ID,
      }),
    });
  });

  // Retirement record (certificate page).
  await page.route(new RegExp(`/retirements/${RETIREMENT_ID}`), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: RETIREMENT_ID,
        retirementId: RETIREMENT_ID,
        batchId: TARGET.batchId,
        projectId: TARGET.projectId,
        amount: 3,
        retiredBy: BUYER_PUBLIC_KEY,
        beneficiary: 'Northwind ESG Ltd',
        retirementReason: 'Offsetting 2024 Scope 1 emissions',
        vintageYear: TARGET.vintageYear,
        serialNumbers: ['AMZ-2024-0001', 'AMZ-2024-0003'],
        retiredAt: new Date().toISOString(),
        txHash: RETIRE_TX_HASH,
        certificateCid: 'QmFlowCert',
        project: {
          name: TARGET.projectName,
          methodology: TARGET.methodology,
          country: TARGET.country,
        },
      }),
    }),
  );

  // Horizon transaction lookup — the transaction poller resolves on the
  // first attempt, so no 5s poll interval is incurred.
  await page.route(/\/transactions\/[0-9a-f]{6,}/i, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ successful: true, hash: TX_HASH }),
    }),
  );

  // Project map lookup on the marketplace page.
  await page.route(/\/projects(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projects: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
      }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function installWallet(page: Page): Promise<void> {
  await page.addInitScript(installMockFreighter, {
    publicKey: BUYER_PUBLIC_KEY,
    network: 'TESTNET',
    isAllowed: true,
    autoApprove: true,
  });
}

/** Screenshot capture on failure, on top of the always-on config setting. */
test.afterEach(async ({ page }, testInfo: TestInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const shot = await page.screenshot({ fullPage: true }).catch(() => null);
    if (shot) {
      await testInfo.attach(`failure-${testInfo.title}`, {
        body: shot,
        contentType: 'image/png',
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Marketplace full journey', () => {
  test('browse → search → buy → retire → certificate, within the perf budget', async ({
    page,
  }, testInfo) => {
    const captured = { purchaseBodies: [], retireBodies: [] } as {
      purchaseBodies: Array<Record<string, unknown>>;
      retireBodies: Array<Record<string, unknown>>;
    };
    const perf: Record<string, number> = {};

    await installWallet(page);
    await stubBackend(page, captured);

    // ── 1. Browse ──────────────────────────────────────────────────────────
    await page.goto('/marketplace');
    await expect(
      page.getByRole('heading', { name: /carbon marketplace/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(TARGET.projectName).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(OTHER.projectName).first()).toBeVisible();

    // ── 2. Search — narrows the list to the target project ─────────────────
    const searchBox = page.locator('#filter-search');
    await expect(searchBox).toBeVisible();
    await searchBox.fill('Amazon');
    await expect(page.getByText(OTHER.projectName)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByText(TARGET.projectName).first()).toBeVisible();

    // ── 3. Buy ────────────────────────────────────────────────────────────
    await page.getByRole('link', { name: /buy now/i }).first().click();
    await expect(
      page.getByRole('heading', { name: /purchase carbon credits/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /preview purchase/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page.locator('#buy-amount').fill('3');
    await page.getByRole('button', { name: /preview purchase/i }).click();

    await expect(
      page.getByRole('region', { name: /transaction preview/i }),
    ).toBeVisible({ timeout: 15_000 });

    const purchaseStart = Date.now();
    await page.getByRole('button', { name: /buy credits/i }).click();
    const purchaseResponse = await page.waitForResponse(
      (r) => r.url().includes('/marketplace/purchase') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    perf.purchaseTransactionMs = Date.now() - purchaseStart;

    expect(purchaseResponse.ok()).toBeTruthy();
    await expect(page.getByText(/purchase confirmed/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/transaction confirmed/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/transaction failed/i)).not.toBeVisible();
    await expect(
      page.getByRole('link', { name: /view transaction/i }),
    ).toBeVisible();

    expect(captured.purchaseBodies).toHaveLength(1);
    expect(captured.purchaseBodies[0]).toMatchObject({
      listingId: TARGET.listingId,
      amount: 3,
      buyerPublicKey: BUYER_PUBLIC_KEY,
    });

    // ── 4. Retire ─────────────────────────────────────────────────────────
    await page.goto(`/retire?batch=${TARGET.batchId}`);
    await expect(page.locator('h1')).toContainText(/retire carbon credits/i);

    await page.locator('input[type="number"]').first().fill('3');
    await page.fill('#retire-beneficiary', 'Northwind ESG Ltd');
    await page.fill('#retire-reason', 'Offsetting 2024 Scope 1 emissions');

    const retireButton = page.getByRole('button', {
      name: /permanently retire/i,
    });
    await expect(retireButton).toBeVisible();

    const retireStart = Date.now();
    await retireButton.click();
    const retireResponse = await page.waitForResponse(
      (r) => r.url().includes('/credits/retire') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    perf.retireTransactionMs = Date.now() - retireStart;

    expect(retireResponse.ok()).toBeTruthy();

    const certificateLink = page.getByRole('link', {
      name: /view & download certificate/i,
    });
    await expect(certificateLink).toBeVisible({ timeout: 20_000 });
    expect(captured.retireBodies).toHaveLength(1);

    // ── 5. Certificate ────────────────────────────────────────────────────
    await certificateLink.click();
    await expect(page.locator('h1')).toContainText(
      /carbon credit retirement certificate/i,
      { timeout: 15_000 },
    );
    await expect(page.getByText('Northwind ESG Ltd')).toBeVisible();
    await expect(
      page.getByText('Offsetting 2024 Scope 1 emissions'),
    ).toBeVisible();
    await expect(page.getByText(TARGET.projectName).first()).toBeVisible();

    // ── Performance baseline ──────────────────────────────────────────────
    await testInfo.attach('marketplace-flow-perf.json', {
      body: JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          budgetMs: TRANSACTION_BUDGET_MS,
          measurements: perf,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    expect(
      perf.purchaseTransactionMs,
      'purchase transaction round-trip must stay under the 5s baseline',
    ).toBeLessThan(TRANSACTION_BUDGET_MS);
    expect(
      perf.retireTransactionMs,
      'retirement transaction round-trip must stay under the 5s baseline',
    ).toBeLessThan(TRANSACTION_BUDGET_MS);
  });

  test('certificate page offers a downloadable PDF', async ({ page }) => {
    await installWallet(page);
    await stubBackend(page, { purchaseBodies: [], retireBodies: [] });

    // `?new=1` renders the post-retirement success state, which exposes the
    // "Download Certificate (PDF)" action.
    await page.goto(`/retire/${RETIREMENT_ID}?new=1`);
    await expect(page.locator('h1')).toContainText(
      /carbon credit retirement certificate/i,
      { timeout: 15_000 },
    );

    const downloadButton = page.getByRole('button', {
      name: /download certificate \(pdf\)/i,
    });
    await expect(downloadButton).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await downloadButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /CarbonLedger-Certificate-.*\.pdf/i,
    );
  });
});
