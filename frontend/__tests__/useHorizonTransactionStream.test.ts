/**
 * Unit tests for useHorizonTransactionStream
 *
 * Covers:
 * - Optimistic update fires immediately on startTracking
 * - SSE fallback to polling when EventSource is unavailable
 * - Successful confirmation flow
 * - Failure rollback flow
 * - Reset clears state
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useHorizonTransactionStream,
  TransactionStreamStatus,
} from "../hooks/useHorizonTransactionStream";

// ── EventSource mock ──────────────────────────────────────────────────────────

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Map<string, ((e: MessageEvent) => void)[]> = new Map();
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, cb: (e: MessageEvent) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
  }

  emit(event: string, data: unknown) {
    const handlers = this.listeners.get(event) ?? [];
    handlers.forEach((h) =>
      h({ data: JSON.stringify(data) } as MessageEvent)
    );
  }

  emitError() {
    const handlers = this.listeners.get("error") ?? [];
    handlers.forEach((h) => h({} as MessageEvent));
  }

  close() {
    this.closed = true;
  }
}

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = jest.fn();

// ─────────────────────────────────────────────────────────────────────────────

describe("useHorizonTransactionStream", () => {
  const TX_HASH = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource.instances = [];
    (global as any).EventSource = MockEventSource;
    global.fetch = mockFetch;
    mockFetch.mockReset();
    process.env.NEXT_PUBLIC_HORIZON_URL = "https://horizon-testnet.stellar.org";
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (global as any).EventSource;
  });

  // ── 1. Optimistic update ────────────────────────────────────────────────────

  it("fires onOptimisticUpdate immediately and sets status to submitted", () => {
    const onOptimisticUpdate = jest.fn();
    const { result } = renderHook(() =>
      useHorizonTransactionStream({ onOptimisticUpdate })
    );

    expect(result.current.state.status).toBe("idle");

    act(() => {
      result.current.startTracking(TX_HASH, [
        { key: "balance", previousValue: 100, optimisticValue: 90 },
      ]);
    });

    expect(result.current.state.status).toBe("submitted");
    expect(result.current.state.txHash).toBe(TX_HASH);
    expect(onOptimisticUpdate).toHaveBeenCalledWith(TX_HASH);
    expect(result.current.isOptimistic).toBe(true);
    expect(result.current.state.optimisticUpdates).toHaveLength(1);
  });

  // ── 2. Successful SSE confirmation ─────────────────────────────────────────

  it("confirms transaction via SSE message and calls onConfirmed", async () => {
    const onConfirmed = jest.fn();
    const { result } = renderHook(() =>
      useHorizonTransactionStream({ onConfirmed })
    );

    act(() => {
      result.current.startTracking(TX_HASH);
    });

    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances[0];

    act(() => {
      es.emit("message", {
        id: TX_HASH,
        successful: true,
        created_at: "2026-01-15T10:30:00Z",
      });
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("confirmed");
    });

    expect(onConfirmed).toHaveBeenCalledWith(TX_HASH, "2026-01-15T10:30:00Z");
    expect(result.current.state.confirmedAt).toBe("2026-01-15T10:30:00Z");
    expect(result.current.isOptimistic).toBe(false);
    // Optimistic updates cleared after confirmation
    expect(result.current.state.optimisticUpdates).toHaveLength(0);
  });

  // ── 3. Failure rollback via SSE ─────────────────────────────────────────────

  it("triggers rollback when SSE reports failed transaction", async () => {
    const onRollback = jest.fn();
    const { result } = renderHook(() =>
      useHorizonTransactionStream({ onRollback })
    );

    act(() => {
      result.current.startTracking(TX_HASH, [
        { key: "balance", previousValue: 100, optimisticValue: 90 },
      ]);
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.emit("message", {
        id: TX_HASH,
        successful: false,
        created_at: "2026-01-15T10:30:00Z",
        result_codes: { transaction: "tx_failed" },
      });
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("failed");
    });

    expect(onRollback).toHaveBeenCalledWith("tx_failed");
    expect(result.current.state.errorMessage).toBe("tx_failed");
    expect(result.current.state.optimisticUpdates).toHaveLength(0);
  });

  // ── 4. SSE error falls back to polling ──────────────────────────────────────

  it("falls back to polling when SSE emits error, confirms via REST poll", async () => {
    const onConfirmed = jest.fn();
    const { result } = renderHook(() =>
      useHorizonTransactionStream({ onConfirmed })
    );

    // First poll: 404 (not yet ingested)
    mockFetch
      .mockResolvedValueOnce({ status: 404, ok: false })
      // Second poll: confirmed
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ successful: true, created_at: "2026-01-15T10:30:00Z" }),
      });

    act(() => {
      result.current.startTracking(TX_HASH);
    });

    // Trigger SSE error to force fallback
    const es = MockEventSource.instances[0];
    act(() => {
      es.emitError();
    });

    // Advance timer for first poll attempt (5s)
    await act(async () => {
      jest.advanceTimersByTime(5_100);
      await Promise.resolve();
    });

    // Advance for second poll
    await act(async () => {
      jest.advanceTimersByTime(5_100);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("confirmed");
    });

    expect(onConfirmed).toHaveBeenCalledWith(TX_HASH, "2026-01-15T10:30:00Z");
  });

  // ── 5. Reset clears all state ──────────────────────────────────────────────

  it("reset clears state and closes SSE connection", () => {
    const { result } = renderHook(() => useHorizonTransactionStream());

    act(() => {
      result.current.startTracking(TX_HASH);
    });

    expect(result.current.state.status).toBe("submitted");

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.txHash).toBeNull();
    expect(result.current.state.errorMessage).toBeNull();

    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(true);
  });

  // ── 6. Polling timeout ─────────────────────────────────────────────────────

  it("sets failed status when max polls exhausted", async () => {
    const onRollback = jest.fn();
    const { result } = renderHook(() =>
      useHorizonTransactionStream({ onRollback })
    );

    // All polls return 404
    mockFetch.mockResolvedValue({ status: 404, ok: false });

    act(() => {
      result.current.startTracking(TX_HASH);
    });

    // Trigger SSE error to force polling
    const es = MockEventSource.instances[0];
    act(() => { es.emitError(); });

    // Advance through enough poll intervals for timeout
    // Max polls = 120 @ 5s each. We'll run 121 iterations.
    for (let i = 0; i <= 121; i++) {
      await act(async () => {
        jest.advanceTimersByTime(5_100);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    await waitFor(() => {
      expect(result.current.state.status).toBe("failed");
    }, { timeout: 5_000 });

    expect(result.current.state.errorMessage).toBe("Transaction timed out");
    expect(onRollback).toHaveBeenCalled();
  });
});
