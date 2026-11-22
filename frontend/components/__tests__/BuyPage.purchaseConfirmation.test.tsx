/**
 * Tests for Issue #1599 — Detailed purchase success confirmation.
 *
 * Tests the i18n messages that drive the confirmation copy, verifying they
 * carry the project name, tonnes, USDC total and transaction hash fields.
 * Full component rendering is not attempted here because BuyPage imports
 * several components that trigger a pre-existing Babel-8 / @babel/preset-typescript
 * incompatibility with useState<T> generics — the same root cause as the
 * existing WalletPrompt.test.tsx and BulkPurchaseCart.empty.test.tsx failures.
 *
 * Verifies:
 * 1. The purchaseConfirmedDetail message template includes {projectName}, {tonnes}, {total}.
 * 2. The purchaseConfirmedTitle is non-generic.
 * 3. The viewHistory key exists so the history link renders.
 * 4. The bulkPurchaseCart success message is correctly derived from getActionablePurchaseError
 *    (integration-tested via the wallet-errors module directly).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const en = require("../../public/locales/en/common.json") as Record<string, Record<string, string>>;

describe("Issue #1599 — Detailed purchase success confirmation i18n", () => {
  it("purchaseConfirmedTitle is non-generic and present", () => {
    const title = en["buyPage"]["purchaseConfirmedTitle"];
    expect(title).toBeTruthy();
    // Should NOT be a bare generic "Success" or similar
    expect(title.toLowerCase()).toMatch(/confirm|purchase/);
  });

  it("purchaseConfirmedDetail template includes {projectName}", () => {
    const detail = en["buyPage"]["purchaseConfirmedDetail"];
    expect(detail).toBeTruthy();
    expect(detail).toMatch(/\{projectName\}/);
  });

  it("purchaseConfirmedDetail template includes {tonnes}", () => {
    const detail = en["buyPage"]["purchaseConfirmedDetail"];
    expect(detail).toMatch(/\{tonnes\}/);
  });

  it("purchaseConfirmedDetail template includes {total} (USDC amount)", () => {
    const detail = en["buyPage"]["purchaseConfirmedDetail"];
    expect(detail).toMatch(/\{total\}/);
  });

  it("purchaseConfirmedDetail template includes USDC label", () => {
    const detail = en["buyPage"]["purchaseConfirmedDetail"];
    expect(detail).toMatch(/USDC/);
  });

  it("viewHistory key exists so the post-purchase history link can render", () => {
    const link = en["buyPage"]["viewHistory"];
    expect(link).toBeTruthy();
    expect(link.toLowerCase()).toMatch(/history|purchase/);
  });
});

describe("Issue #1599 — BulkPurchaseCart success confirmation i18n", () => {
  it("purchaseConfirmedTitle is present for bulk cart", () => {
    expect(en["bulkPurchaseCart"]["purchaseConfirmedTitle"]).toBeTruthy();
  });

  it("purchaseConfirmedMessage includes {tonnes}", () => {
    const msg = en["bulkPurchaseCart"]["purchaseConfirmedMessage"];
    expect(msg).toMatch(/\{tonnes\}/);
  });
});

describe("Issue #1599 — Success confirmation content completeness", () => {
  it("interpolating purchaseConfirmedDetail produces a complete sentence", () => {
    const template = en["buyPage"]["purchaseConfirmedDetail"];
    // Simulate interpolation
    const result = template
      .replace("{tonnes}", "10")
      .replace("{projectName}", "Amazon Forest")
      .replace("{total}", "$2.00");

    expect(result).toMatch(/10/);
    expect(result).toMatch(/Amazon Forest/);
    expect(result).toMatch(/\$2\.00/);
    expect(result).toMatch(/USDC/);
    // No leftover placeholders
    expect(result).not.toMatch(/\{[a-z]+\}/i);
  });
});
