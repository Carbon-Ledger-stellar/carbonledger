/**
 * Issue #1597 — Actionable purchase error messages.
 *
 * Covers:
 * - getContractErrorMessage maps known failure causes to plain-language messages.
 * - Wallet-rejection errors produce an actionable, non-generic message.
 * - Insufficient-balance errors include the shortfall amount.
 * - Marketplace-paused contract error (code 20 / Arithmetic not applicable —
 *   code 11 InsufficientLiquidity is a good proxy for a marketplace error).
 * - Unknown errors fall back to a non-empty string (never an empty "").
 */

import {
  getContractErrorMessage,
  getWalletErrorMessage,
  createInsufficientBalanceError,
  formatShortfallMessage,
} from "../lib/wallet-errors";

describe("Issue #1597 — actionable error messages", () => {
  describe("getContractErrorMessage — wallet rejection", () => {
    it("maps TRANSACTION_REJECTED to an actionable message", () => {
      const msg = getContractErrorMessage(new Error("TRANSACTION_REJECTED"), "carbon_marketplace");
      expect(msg).toMatch(/rejected/i);
      expect(msg).not.toBe("");
    });

    it("maps SIGNING_CANCELLED to a message that is not generic", () => {
      const msg = getContractErrorMessage(new Error("SIGNING_CANCELLED"), "carbon_marketplace");
      expect(msg).toMatch(/cancelled|cancel/i);
    });

    it("maps INSUFFICIENT_XLM to a message mentioning balance or XLM", () => {
      const msg = getContractErrorMessage(new Error("INSUFFICIENT_XLM"), "carbon_marketplace");
      expect(msg).toMatch(/xlm|balance|fee/i);
    });
  });

  describe("getContractErrorMessage — contract error codes", () => {
    it("maps Error(Contract, #11) (InsufficientLiquidity) to an actionable message", () => {
      const msg = getContractErrorMessage(new Error("Error(Contract, #11)"), "carbon_marketplace");
      expect(msg).toMatch(/liquidity/i);
    });

    it("maps CarbonError(4) (InsufficientCredits) to an actionable message", () => {
      const msg = getContractErrorMessage(new Error("CarbonError(4)"), "carbon_marketplace");
      expect(msg).toMatch(/credits|insufficient/i);
    });

    it("returns a non-empty string for an unknown contract code", () => {
      const msg = getContractErrorMessage(new Error("Error(Contract, #999)"), "carbon_marketplace");
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    });
  });

  describe("getContractErrorMessage — unknown / generic errors", () => {
    it("never returns an empty string", () => {
      const cases: unknown[] = [null, undefined, "", new Error(), {}, 42];
      for (const c of cases) {
        const msg = getContractErrorMessage(c);
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
      }
    });

    it("does not surface raw exception stack traces (no 'at ' lines)", () => {
      const err = new Error("Something exploded");
      const msg = getContractErrorMessage(err);
      expect(msg).not.toMatch(/^\s*at /m);
    });
  });

  describe("insufficient balance shortfall", () => {
    it("formatShortfallMessage includes the missing amount and asset", () => {
      const msg = formatShortfallMessage({ required: 2.5, available: 1.0, asset: "XLM" });
      expect(msg).toMatch(/1\.5/);    // missing = 2.5 - 1.0
      expect(msg).toMatch(/xlm/i);
    });

    it("createInsufficientBalanceError produces an error that getContractErrorMessage resolves to shortfall text", () => {
      const err = createInsufficientBalanceError(10, 3, "USDC");
      const msg = getContractErrorMessage(err);
      expect(msg).toMatch(/usdc/i);
      expect(msg).toMatch(/7/); // 10 - 3
    });
  });
});
