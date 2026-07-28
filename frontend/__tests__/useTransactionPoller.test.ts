/**
 * @jest-environment jsdom
 */

jest.mock("../lib/horizon-transaction-error", () => ({
  parseHorizonTransactionFailure: (tx: {
    result_codes?: { operations?: string[] };
  }) => {
    const op = tx.result_codes?.operations?.[0] ?? "";
    const match = op.match(/contract_code_(\d+)/);
    if (match) {
      return `CarbonError(${match[1]})`;
    }
    return "Transaction failed on-chain";
  },
  parseTransactionResultXdr: () => "Transaction failed on-chain",
}));

jest.mock("../lib/invalidate-transaction-caches", () => ({
  invalidateTransactionRelatedCaches: jest.fn(() => Promise.resolve()),
}));

import { renderHook, waitFor, act } from "@testing-library/react";
import {
  pollHorizonTransactionUntilTerminal,
  TRANSACTION_MAX_POLLS,
  TRANSACTION_POLL_INTERVAL_MS,
  useTransactionPoller,
} from "../hooks/useTransactionPoller";
import { getCarbonErrorMessage } from "../lib/carbon-errors";
import { invalidateTransactionRelatedCaches } from "../lib/invalidate-transaction-caches";

const mockInvalidate = invalidateTransactionRelatedCaches as jest.MockedFunction<
  typeof invalidateTransactionRelatedCaches
>;

describe("pollHorizonTransactionUntilTerminal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns SUCCESS when Horizon reports a successful transaction", async () => {
    const fetchTransaction = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ successful: true });

    const result = await pollHorizonTransactionUntilTerminal("abc123", {
      fetchTransaction,
      sleep: jest.fn(),
      maxPolls: 5,
      invalidateCaches: mockInvalidate,
    });

    expect(result.state).toBe("SUCCESS");
    expect(result.polls).toBe(2);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(fetchTransaction).toHaveBeenCalledTimes(2);
  });

  it("returns FAILED and parses contract errors for carbon-errors mapping", async () => {
    const fetchTransaction = jest.fn().mockResolvedValue({
      successful: false,
      result_codes: { operations: ["contract_code_6"] },
    });

    const result = await pollHorizonTransactionUntilTerminal("deadbeef", {
      fetchTransaction,
      sleep: jest.fn(),
      maxPolls: 3,
      invalidateCaches: mockInvalidate,
    });

    expect(result.state).toBe("FAILED");
    expect(result.errorMessage).toBe("CarbonError(6)");
    expect(getCarbonErrorMessage(result.errorMessage)).toBe("Insufficient credits.");
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("returns TIMED_OUT after max polls with no transaction record", async () => {
    const fetchTransaction = jest.fn().mockResolvedValue(null);
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await pollHorizonTransactionUntilTerminal("slow-hash", {
      fetchTransaction,
      sleep,
      maxPolls: 3,
      intervalMs: 10,
      invalidateCaches: mockInvalidate,
    });

    expect(result.state).toBe("TIMED_OUT");
    expect(result.polls).toBe(3);
    expect(fetchTransaction).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("polls every 5 seconds up to 120 times by default", () => {
    expect(TRANSACTION_POLL_INTERVAL_MS).toBe(5_000);
    expect(TRANSACTION_MAX_POLLS).toBe(120);
  });
});

describe("useTransactionPoller", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("transitions to SUCCESS and invalidates caches via Horizon polling", async () => {
    process.env.NEXT_PUBLIC_HORIZON_URL = "https://horizon.test";

    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ successful: true }),
    } as Response);

    const { result } = renderHook(() =>
      useTransactionPoller({ txHash: "success-hash" }),
    );

    await waitFor(() => expect(result.current.state).toBe("SUCCESS"));
    expect(result.current.pollCount).toBe(1);
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("transitions to FAILED when Horizon reports unsuccessful transaction", async () => {
    process.env.NEXT_PUBLIC_HORIZON_URL = "https://horizon.test";
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () =>
        Promise.resolve({
          successful: false,
          result_codes: { operations: ["contract_code_6"] },
        }),
    } as Response);

    const { result } = renderHook(() =>
      useTransactionPoller({ txHash: "failed-hash" }),
    );

    await waitFor(() => expect(result.current.state).toBe("FAILED"));
    expect(result.current.errorMessage).toBe("CarbonError(6)");
    expect(getCarbonErrorMessage(result.current.errorMessage)).toBe(
      "Insufficient credits.",
    );
  });

  it("startPolling begins polling for a submitted hash", async () => {
    process.env.NEXT_PUBLIC_HORIZON_URL = "https://horizon.test";
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ successful: true }),
    } as Response);

    const { result } = renderHook(() => useTransactionPoller());

    await act(async () => {
      result.current.startPolling("manual-hash");
    });

    await waitFor(() => expect(result.current.state).toBe("SUCCESS"));
    expect(global.fetch).toHaveBeenCalledWith(
      "https://horizon.test/transactions/manual-hash",
    );
  });
});
