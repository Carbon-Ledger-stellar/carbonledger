import { test, expect } from "@playwright/test";

const VERIFIER_WALLET = "GVERIFIER000000000000000000000000000000000000000000000000";
const PROJECT_DB_ID = "proj-db-001";
const PROJECT_CHAIN_ID = "proj-pending-001";
const TX_HASH = "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123";
const DOC_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

function makeVerifierJwt(publicKey: string) {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payload = btoa(
    JSON.stringify({
      sub: publicKey,
      role: "verifier",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.test-signature`;
}

async function mockFreighter(page: import("@playwright/test").Page, publicKey: string) {
  await page.addInitScript((pubKey: string) => {
    (window as unknown as { freighter?: Record<string, unknown> }).freighter = {
      getPublicKey: () => Promise.resolve({ publicKey: pubKey, error: null }),
      signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: xdr, error: null }),
      isConnected: () => Promise.resolve({ isConnected: true }),
      isAllowed: () => Promise.resolve({ isAllowed: true }),
      setAllowed: () => Promise.resolve({ isAllowed: true }),
      getNetworkDetails: () =>
        Promise.resolve({
          network: "TESTNET",
          networkPassphrase: "Test SDF Network ; September 2015",
          error: null,
        }),
    };
  }, publicKey);
}

async function mockSorobanRpc(page: import("@playwright/test").Page) {
  await page.route("**/soroban-testnet.stellar.org/**", async route => {
    const body = route.request().postDataJSON() as { method?: string };
    const method = body?.method ?? "";

    if (method === "getHealth") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "healthy" }) });
    }
    if (method === "getNetwork") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { passphrase: "Test SDF Network ; September 2015" } }),
      });
    }
    if (method === "getLatestLedger") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { id: 1000, protocolVersion: 22, sequence: 1000 } }),
      });
    }
    if (method === "getAccount" || method === "getLedgerEntries") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            entries: [],
            latestLedger: 1000,
          },
        }),
      });
    }
    if (method === "simulateTransaction") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            transactionData: "",
            minResourceFee: "100",
            results: [{ auth: [], xdr: "AAAAAA==" }],
          },
        }),
      });
    }
    if (method === "sendTransaction") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { status: "PENDING", hash: TX_HASH, latestLedger: 1000, latestLedgerCloseTime: "0" } }),
      });
    }
    if (method === "getTransaction") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { status: "SUCCESS", ledger: 1001, createdAt: new Date().toISOString(), applicationOrder: 1 },
        }),
      });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: {} }) });
  });
}

test.describe("Verifier dashboard", () => {
  test("approve flow with confirmation dialog and mocked Freighter signing", async ({ page }) => {
    const jwt = makeVerifierJwt(VERIFIER_WALLET);

    await page.addInitScript(({ token, registryContract }: { token: string; registryContract: string }) => {
      localStorage.setItem("cl_jwt", token);
      (window as unknown as { __ENV?: Record<string, string> }).__ENV = {
        NEXT_PUBLIC_REGISTRY_CONTRACT: registryContract,
      };
    }, { token: jwt, registryContract: "C_REGISTRY_TEST_CONTRACT_ID000000000000000001" });

    await mockFreighter(page, VERIFIER_WALLET);
    await mockSorobanRpc(page);

    const pending = [
      {
        id: PROJECT_DB_ID,
        projectId: PROJECT_CHAIN_ID,
        name: "Andes Reforestation",
        methodology: "VCS",
        country: "Peru",
        status: "Pending",
        methodologyScore: 82,
        createdAt: "2026-04-01T12:00:00.000Z",
        metadataCid: DOC_CID,
        projectType: "Forestry",
        vintageYear: 2025,
      },
    ];

    await page.route(`**/verifiers/${VERIFIER_WALLET}/pending-projects`, route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pending) }),
    );

    await page.route(`**/projects/${PROJECT_DB_ID}`, route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pending[0]) }),
    );

    await page.route(`**/projects/${PROJECT_DB_ID}/verify`, route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "Verified" }) }),
    );

    await page.goto("/verifier/dashboard");
    await expect(page.getByRole("heading", { name: "Verifier Dashboard" })).toBeVisible();
    await expect(page.getByText("Andes Reforestation")).toBeVisible();

    await page.getByRole("link", { name: /Review →/ }).click();
    await expect(page.getByRole("heading", { name: "Andes Reforestation" })).toBeVisible();
    await expect(page.getByText("Methodology score breakdown")).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(PROJECT_CHAIN_ID)).toBeVisible();

    await page.getByTestId("verifier-confirm-action").click();
    await expect(page.getByText("Transaction confirmed")).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(/\/verifier\/dashboard/);
  });

  test("rejects short rejection reasons in confirmation dialog", async ({ page }) => {
    const jwt = makeVerifierJwt(VERIFIER_WALLET);
    await page.addInitScript((token: string) => {
      localStorage.setItem("cl_jwt", token);
    }, jwt);
    await mockFreighter(page, VERIFIER_WALLET);

    const project = {
      id: PROJECT_DB_ID,
      projectId: PROJECT_CHAIN_ID,
      name: "Test Project",
      methodology: "VCS",
      country: "Brazil",
      status: "Pending",
      methodologyScore: 75,
      createdAt: "2026-04-01T12:00:00.000Z",
      metadataCid: DOC_CID,
      projectType: "Forestry",
      vintageYear: 2025,
    };

    await page.route(`**/projects/${PROJECT_DB_ID}`, route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(project) }),
    );

    await page.goto(`/verifier/projects/${PROJECT_DB_ID}`);
    await page.getByRole("button", { name: "Reject" }).click();
    await page.fill("#reject-reason", "Too short");
    const confirm = page.getByTestId("verifier-confirm-action");
    await expect(confirm).toBeDisabled();
  });
});
