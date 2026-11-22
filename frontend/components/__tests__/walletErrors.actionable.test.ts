/**
 * Tests for Issue #1597 — Actionable purchase error messages.
 *
 * Verifies mapping of common failure causes to actionable messages via
 * getActionablePurchaseError().
 */
import {
  getActionablePurchaseError,
  createInsufficientBalanceError,
} from "../../lib/wallet-errors";

describe("getActionablePurchaseError (Issue #1597)", () => {
  it("maps wallet rejection / user declined to 'wallet_rejected' cause", () => {
    const result = getActionablePurchaseError(new Error("user declined"));
    expect(result.cause).toBe("wallet_rejected");
    expect(result.message).toMatch(/declined/i);
    expect(result.nextStep).toMatch(/Freighter|again/i);
  });

  it("maps SIGNING_CANCELLED to 'wallet_rejected'", () => {
    const result = getActionablePurchaseError(new Error("SIGNING_CANCELLED"));
    expect(result.cause).toBe("wallet_rejected");
  });

  it("maps TRANSACTION_REJECTED to 'wallet_rejected'", () => {
    const result = getActionablePurchaseError(new Error("TRANSACTION_REJECTED"));
    expect(result.cause).toBe("wallet_rejected");
  });

  it("maps insufficient balance error to 'insufficient_balance' cause", () => {
    const err = createInsufficientBalanceError(10, 5, "XLM");
    const result = getActionablePurchaseError(err);
    expect(result.cause).toBe("insufficient_balance");
    expect(result.message).toMatch(/XLM/);
    expect(result.nextStep).toMatch(/XLM|wallet/i);
  });

  it("maps INSUFFICIENT_XLM string error to 'insufficient_balance'", () => {
    const result = getActionablePurchaseError(new Error("INSUFFICIENT_XLM"));
    expect(result.cause).toBe("insufficient_balance");
  });

  it("maps marketplace paused error to 'marketplace_paused' cause", () => {
    const result = getActionablePurchaseError(new Error("Contract is paused"));
    expect(result.cause).toBe("marketplace_paused");
    expect(result.message).toMatch(/paused/i);
    expect(result.nextStep).toMatch(/resume|unpaused/i);
  });

  it("maps CarbonError contract codes to 'contract_error' cause", () => {
    const result = getActionablePurchaseError(new Error("CarbonError(11)"));
    expect(result.cause).toBe("contract_error");
    // CarbonError(11) = InsufficientLiquidity
    expect(result.message).toMatch(/liquidity/i);
    expect(result.nextStep).toBeTruthy();
  });

  it("maps Error(Contract, #4) to 'contract_error'", () => {
    const result = getActionablePurchaseError(new Error("Error(Contract, #4)"));
    expect(result.cause).toBe("contract_error");
    // CarbonError(4) = InsufficientCredits
    expect(result.message).toMatch(/credit/i);
  });

  it("maps network errors to 'network_error' cause", () => {
    const result = getActionablePurchaseError(new Error("failed to fetch"));
    expect(result.cause).toBe("network_error");
    expect(result.message).toMatch(/network/i);
    expect(result.nextStep).toMatch(/internet|connection|try again/i);
  });

  it("maps timeout errors to 'network_error'", () => {
    const result = getActionablePurchaseError(new Error("Request timeout"));
    expect(result.cause).toBe("network_error");
  });

  it("maps unknown errors to 'unknown' cause with next step", () => {
    const result = getActionablePurchaseError(new Error("Something totally unexpected happened"));
    expect(result.cause).toBe("unknown");
    expect(result.nextStep).toBeTruthy();
  });

  it("handles null/undefined gracefully", () => {
    const result = getActionablePurchaseError(null);
    expect(result.cause).toBe("unknown");
    expect(result.message).toBeTruthy();
    expect(result.nextStep).toBeTruthy();
  });

  it("every result has a non-empty message and nextStep", () => {
    const errors = [
      new Error("user rejected"),
      new Error("INSUFFICIENT_XLM"),
      new Error("marketplace paused"),
      new Error("CarbonError(1)"),
      new Error("network timeout"),
      new Error("bizarre unknown string"),
      null,
      undefined,
    ];
    for (const err of errors) {
      const result = getActionablePurchaseError(err);
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.nextStep.length).toBeGreaterThan(0);
    }
  });
});
