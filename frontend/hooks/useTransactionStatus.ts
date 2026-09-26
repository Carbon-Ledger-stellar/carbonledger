"use client";

/**
 * useTransactionStatus — React hook for tracking credit redemption status
 * via the realtime WebSocket connection.
 *
 * This hook is the consumer-facing API referenced in issue #897. It
 * subscribes to the WebSocket client's event stream and exposes the
 * last received CREDITS_RETIRED_CONFIRMED event so that components
 * can react to it without knowing about the underlying WebSocket.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeEvent, CreditsRetiredConfirmedPayload } from "../lib/realtime/events";
import { RealtimeEventType } from "../lib/realtime/events";

export interface TransactionStatusState {
  /** The most recent confirmed event, or null if none received this session. */
  lastConfirmed: CreditsRetiredConfirmedPayload | null;
  /** Timestamp (epoch ms) of the last event, or null. */
  lastConfirmedAt: number | null;
}

/**
 * A simple synchronous event emitter for distributing realtime events
 * without requiring context or prop drilling.
 */
type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to all realtime events. Returns an unsubscribe function. */
export function subscribeToRealtimeEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Called by the WebSocket client to dispatch events to all listeners. */
export function dispatchRealtimeEvent(event: RealtimeEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // Swallow — a misbehaving listener must not break the event bus.
    }
  });
}

/**
 * Hook that gives components access to the latest CREDITS_RETIRED_CONFIRMED
 * event payload. Re-renders only when a new event arrives.
 */
export function useTransactionStatus(): TransactionStatusState {
  const [state, setState] = useState<TransactionStatusState>({
    lastConfirmed: null,
    lastConfirmedAt: null,
  });

  useEffect(() => {
    const unsub = subscribeToRealtimeEvents((event) => {
      if (event.type === RealtimeEventType.CREDITS_RETIRED_CONFIRMED) {
        setState({
          lastConfirmed: event.payload as CreditsRetiredConfirmedPayload,
          lastConfirmedAt: Date.now(),
        });
      }
    });
    return unsub;
  }, []);

  return state;
}

/**
 * useRealtimeEvent — subscribe to a specific event type and call a callback.
 * Used by the notification provider to bridge events to the toast system.
 */
export function useRealtimeEvent(
  eventType: RealtimeEventType,
  callback: (event: RealtimeEvent) => void,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return subscribeToRealtimeEvents((event) => {
      if (event.type === eventType) {
        callbackRef.current(event);
      }
    });
  }, [eventType]);
}