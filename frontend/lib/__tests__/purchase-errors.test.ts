import {
  getPurchaseFailure,
  formatPurchaseFailure,
} from "../purchase-errors";
import { createInsufficientBalanceError } from "../wallet-errors";

describe("purchase-errors", () => {
  describe("getPurchaseFailure", () => {
    it("maps a signing cancellation to a retry guidance message", () => {
      const f = getPurchaseFailure(new Error("user declined access"));
      expect(f.cause).toMatch(/cancelled signing/i);
      expect(f.nextStep).toMatch(/retry/i);
      expect(f.nextStep).toMatch(/freighter/i);
    });

    it("maps an insufficient-balance shortfall to the missing amount", () => {
      const err = createInsufficientBalanceError(5, 1, "XLM");
      const f = getPurchaseFailure(err);
      expect(f.cause).toMatch(/you need .* more XLM/i);
      expect(f.nextStep).toMatch(/add the required balance/i);
    });

    it("surfaces a paused marketplace before falling back to the error text", () => {
      const f = getPurchaseFailure(new Error("anything"), { isPaused: true });
      expect(f.cause).toMatch(/marketplace is currently paused/i);
      expect(f.nextStep).toMatch(/wait for it to resume/i);
    });

    it("maps known wallet error codes to an actionable next step", () => {
      const rejected = getPurchaseFailure(new Error("TRANSACTION_REJECTED"));
      expect(rejected.cause).toMatch(/rejected/i);
      expect(rejected.nextStep).toMatch(/review the transaction in freighter/i);

      const locked = getPurchaseFailure(new Error("WALLET_LOCKED"));
      expect(locked.cause).toMatch(/locked/i);
      expect(locked.nextStep).toMatch(/unlock your freighter wallet/i);

      const wrongNet = getPurchaseFailure(new Error("WRONG_NETWORK"));
      expect(wrongNet.nextStep).toMatch(/switch freighter/i);
    });

    it("maps a Soroban contract error code to the contract message", () => {
      // CarbonError(11) / marketplace code 11 is InsufficientLiquidity
      const f = getPurchaseFailure(new Error("Error(Contract, #11)"));
      expect(f.cause).toMatch(/insufficient liquidity/i);
      expect(f.nextStep).toMatch(/adjust the amount/i);
    });

    it("maps network/timeout errors to a connectivity next step", () => {
      const f = getPurchaseFailure(new Error("Request timed out"));
      expect(f.cause).toMatch(/couldn't reach the stellar network/i);
      expect(f.nextStep).toMatch(/check your connection/i);
    });

    it("falls back to a generic cause + retry when the error is unknown but short", () => {
      const f = getPurchaseFailure(new Error("Unexpected boom"));
      expect(f.cause).toContain("Unexpected boom");
      expect(f.nextStep).toMatch(/retry/i);
    });

    it("returns a generic cause + retry when there is no error", () => {
      const f = getPurchaseFailure(null);
      expect(f.cause).toMatch(/something went wrong/i);
      expect(f.nextStep).toMatch(/retry/i);
    });

    it("prioritises cancellation over a generic message", () => {
      const f = getPurchaseFailure(new Error("popup closed by user"));
      expect(f.cause).toMatch(/cancelled signing/i);
    });
  });

  describe("formatPurchaseFailure", () => {
    it("returns a single string joining cause and next step", () => {
      const msg = formatPurchaseFailure(new Error("TRANSACTION_REJECTED"));
      expect(msg).toMatch(/rejected/i);
      expect(msg).toMatch(/review the transaction in freighter/i);
    });

    it("includes the pause cause when paused", () => {
      const msg = formatPurchaseFailure(new Error("x"), { isPaused: true });
      expect(msg).toMatch(/paused/i);
    });
  });
});
