/**
 * @jest-environment jsdom
 */

import { renderHook, act } from "@testing-library/react";
import { usePauseStatusToast } from "../hooks/usePauseStatusToast";
import { RealtimeEventType } from "../lib/realtime/events";
import type {
  RealtimeEvent,
  ContractPausedPayload,
  ContractUnpausedPayload,
} from "../lib/realtime/events";

// ── Helpers ────────────────────────────────────────────────────────────────

function makePauseEvent(
  overrides: Partial<ContractPausedPayload> = {},
): RealtimeEvent {
  return {
    type: RealtimeEventType.CONTRACT_PAUSED,
    payload: {
      contract: "carbon_credit",
      contractId: "C_CREDIT_ID",
      reason: "Security incident",
      pausedUntil: null,
      changedAt: new Date().toISOString(),
      ...overrides,
    } as ContractPausedPayload,
  };
}

function makeUnpauseEvent(
  overrides: Partial<ContractUnpausedPayload> = {},
): RealtimeEvent {
  return {
    type: RealtimeEventType.CONTRACT_UNPAUSED,
    payload: {
      contract: "carbon_credit",
      contractId: "C_CREDIT_ID",
      changedAt: new Date().toISOString(),
      ...overrides,
    } as ContractUnpausedPayload,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("usePauseStatusToast", () => {
  let addToast: jest.Mock;

  beforeEach(() => {
    addToast = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("returns handlePauseEvent", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );
    expect(typeof result.current.handlePauseEvent).toBe("function");
  });

  // ── CONTRACT_PAUSED ───────────────────────────────────────────────────────

  it("shows a warning toast on CONTRACT_PAUSED event", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );

    act(() => {
      result.current.handlePauseEvent(makePauseEvent());
    });

    expect(addToast).toHaveBeenCalledTimes(1);
    const [toast] = addToast.mock.calls[0];
    expect(toast.type).toBe("warning");
    expect(toast.title).toMatch(/Paused/);
    expect(toast.title).toMatch(/Carbon Credit Contract/);
  });

  it("includes reason in warning toast message", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );

    act(() => {
      result.current.handlePauseEvent(
        makePauseEvent({ reason: "Exploit detected" }),
      );
    });

    const [toast] = addToast.mock.calls[0];
    expect(toast.message).toContain("Exploit detected");
  });

  it("includes pause expiry time when pausedUntil is set", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );
    const future = new Date(Date.now() + 3_600_000).toISOString();

    act(() => {
      result.current.handlePauseEvent(
        makePauseEvent({ pausedUntil: future }),
      );
    });

    const [toast] = addToast.mock.calls[0];
    expect(toast.message).toContain("Expires:");
  });

  it("does not include expiry when pausedUntil is null", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );

    act(() => {
      result.current.handlePauseEvent(makePauseEvent({ pausedUntil: null }));
    });

    const [toast] = addToast.mock.calls[0];
    expect(toast.message).not.toContain("Expires:");
  });

  // ── CONTRACT_UNPAUSED ─────────────────────────────────────────────────────

  it("shows an info toast on CONTRACT_UNPAUSED event", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );

    act(() => {
      result.current.handlePauseEvent(makeUnpauseEvent());
    });

    expect(addToast).toHaveBeenCalledTimes(1);
    const [toast] = addToast.mock.calls[0];
    expect(toast.type).toBe("info");
    expect(toast.title).toMatch(/Resumed/);
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  it("does not fire a second pause toast for the same contract without an unpause in between", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );

    act(() => {
      result.current.handlePauseEvent(makePauseEvent()); // first pause
      result.current.handlePauseEvent(makePauseEvent()); // duplicate — should be ignored
    });

    expect(addToast).toHaveBeenCalledTimes(1);
  });

  it("fires a new pause toast after an intervening unpause", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );

    act(() => {
      result.current.handlePauseEvent(makePauseEvent());   // pause
      result.current.handlePauseEvent(makeUnpauseEvent()); // unpause
      result.current.handlePauseEvent(makePauseEvent());   // pause again
    });

    // pause + unpause + pause = 3 toasts
    expect(addToast).toHaveBeenCalledTimes(3);
  });

  it("ignores unknown event types", () => {
    const { result } = renderHook(() =>
      usePauseStatusToast({ addToast }),
    );

    act(() => {
      result.current.handlePauseEvent({
        type: "CREDITS_RETIRED_CONFIRMED" as any,
        payload: {} as any,
      });
    });

    expect(addToast).not.toHaveBeenCalled();
  });

  // ── Polling fallback ──────────────────────────────────────────────────────

  it("fires pause toast on polling fallback when status changes to paused", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          statuses: [
            {
              contractName: "carbon_credit",
              contractId: "C_CREDIT_ID",
              isPaused: false,
              reason: null,
              pausedUntil: null,
            },
          ],
        }),
      } as Response);

    const { result } = renderHook(() =>
      usePauseStatusToast({
        addToast,
        enablePolling: true,
        pollIntervalMs: 5_000,
        statusEndpoint: "/api/pause-status",
      }),
    );

    // First poll — seeds cache, no toast
    await act(async () => {
      jest.advanceTimersByTime(0); // trigger immediate poll
      await Promise.resolve(); // flush microtasks
    });

    expect(addToast).not.toHaveBeenCalled();

    // Now the contract becomes paused on the next poll
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        statuses: [
          {
            contractName: "carbon_credit",
            contractId: "C_CREDIT_ID",
            isPaused: true,
            reason: "Scheduled maintenance",
            pausedUntil: null,
          },
        ],
      }),
    } as Response);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(addToast).toHaveBeenCalledTimes(1);
    const [toast] = addToast.mock.calls[0];
    expect(toast.type).toBe("warning");
    expect(toast.message).toContain("Scheduled maintenance");

    fetchMock.mockRestore();
  });

  it("does not throw when polling endpoint is unreachable", async () => {
    jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      usePauseStatusToast({
        addToast,
        enablePolling: true,
        pollIntervalMs: 5_000,
        statusEndpoint: "/api/pause-status",
      }),
    );

    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    // No toast, no uncaught error
    expect(addToast).not.toHaveBeenCalled();
  });
});
