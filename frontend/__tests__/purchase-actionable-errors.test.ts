/**
 * Tests for getPurchaseActionableError — issue #1597
 *
 * Verifies that common purchase failure causes produce actionable messages
 * with a plain-language description and a recommended next step.
 */

import { getPurchaseActionableError } from "../lib/wallet-errors";

describe("getPurchaseActionableError", () => {
  it("maps signing cancellation to an actionable retry message", () => {
    const result = getPurchaseActionableError(new Error("user declined"));
    expect(result.message).toMatch(/cancelled/i);
    expect(result.nextStep).toMatch(/retry/i);
    expect(result.canRetry).toBe(true);
  });

  it("maps SIGNING_CANCELLED code to retry message", () => {
    const result = getPurchaseActionableError("SIGNING_CANCELLED");
    expect(result.canRetry).toBe(true);
    expect(result.nextStep).toMatch(/retry/i);
  });

  it("maps marketplace paused to a non-retry explanation", () => {
    const result = getPurchaseActionableError(new Error("marketplace paused"));
    expect(result.message).toMatch(/paused/i);
    expect(result.canRetry).toBe(false);
    expect(result.nextStep).toMatch(/status banner|try again/i);
  });

  it("maps MARKETPLACE_PAUSED string to paused error", () => {
    const result = getPurchaseActionableError("MARKETPLACE_PAUSED");
    expect(result.canRetry).toBe(false);
  });

  it("maps InsufficientLiquidity contract error to actionable USDC message", () => {
    const result = getPurchaseActionableError(new Error("InsufficientLiquidity"));
    expect(result.message).toMatch(/USDC|balance/i);
    expect(result.canRetry).toBe(false);
    expect(result.nextStep).toMatch(/add.*USDC|USDC.*wallet/i);
  });

  it("maps INSUFFICIENT_XLM to a fee error with add-XLM instruction", () => {
    const result = getPurchaseActionableError(new Error("INSUFFICIENT_XLM"));
    expect(result.message).toMatch(/XLM/i);
    expect(result.nextStep).toMatch(/XLM/i);
    expect(result.canRetry).toBe(false);
  });

  it("maps a network error to a retryable connection message", () => {
    const result = getPurchaseActionableError(new Error("fetch failed: network timeout"));
    expect(result.message).toMatch(/network|server/i);
    expect(result.canRetry).toBe(true);
    expect(result.nextStep).toMatch(/internet|try again/i);
  });

  it("maps transaction rejected to a retryable message", () => {
    const result = getPurchaseActionableError(new Error("TRANSACTION_REJECTED"));
    expect(result.canRetry).toBe(true);
    expect(result.nextStep).toMatch(/try again|contact support/i);
  });

  it("maps a Soroban contract error code to a plain-language message", () => {
    // CarbonError(11) = InsufficientLiquidity
    const result = getPurchaseActionableError(new Error("CarbonError(11)"));
    expect(result.message).toMatch(/liquidity/i);
  });

  it("maps Error(Contract, #4) format to a plain-language message", () => {
    // Code 4 = InsufficientCredits
    const result = getPurchaseActionableError(new Error("Error(Contract, #4)"));
    expect(result.message).toMatch(/credits/i);
  });

  it("returns a generic actionable fallback for unknown errors", () => {
    const result = getPurchaseActionableError(new Error("some unexpected error"));
    expect(result.message).toBeTruthy();
    expect(result.nextStep).toMatch(/try again|contact support/i);
  });

  it("never returns an empty message or nextStep", () => {
    const cases = [
      null,
      undefined,
      new Error(""),
      "UNKNOWN",
      new Error("random gibberish xyz"),
    ];
    for (const c of cases) {
      const result = getPurchaseActionableError(c);
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.nextStep.length).toBeGreaterThan(0);
    }
  });
});
