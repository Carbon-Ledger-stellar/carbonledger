/**
 * useOfflineSync
 *
 * React hook that wraps the offline-sync service for use in client components.
 * Exposes pending count, flush status, and methods to enqueue / sync.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  enqueue,
  flushQueue,
  getPendingCount,
  subscribe,
  initOfflineSync,
  dequeue,
  type QueuedEntry,
  type OfflineSyncState,
  getPendingEntries,
} from '../lib/offline-sync';

export interface UseOfflineSyncReturn {
  /** Number of reports waiting to be synced. */
  pendingCount: number;
  /** Whether a sync is currently in progress. */
  isFlushing: boolean;
  /** Timestamp of the last successful sync (Unix ms, null if never). */
  lastFlushAt: number | null;
  /** Error from the last sync attempt (null if last sync succeeded). */
  lastFlushError: string | null;
  /** Enqueue a report for offline submission. */
  enqueue: (endpoint: string, method: string, body: unknown) => Promise<string>;
  /** Manually trigger a sync of all pending entries. */
  syncNow: () => Promise<void>;
  /** Remove a specific entry from the queue. */
  dequeue: (id: string) => Promise<void>;
  /** Get all pending entries (for UI display). */
  getPending: () => Promise<QueuedEntry[]>;
}

export function useOfflineSync(): UseOfflineSyncReturn {
  const [state, setState] = useState<OfflineSyncState>(() => ({
    pendingCount: getPendingCount(),
    isFlushing: false,
    lastFlushAt: null,
    lastFlushError: null,
  }));

  useEffect(() => {
    // Initialize the service — safe to call multiple times
    initOfflineSync();

    const unsub = subscribe((s) => {
      setState(s);
    });

    return unsub;
  }, []);

  const handleEnqueue = useCallback(
    async (endpoint: string, method: string, body: unknown): Promise<string> => {
      return enqueue(endpoint, method, body);
    },
    [],
  );

  const handleSyncNow = useCallback(async () => {
    await flushQueue();
  }, []);

  const handleDequeue = useCallback(async (id: string) => {
    await dequeue(id);
  }, []);

  const handleGetPending = useCallback(async (): Promise<QueuedEntry[]> => {
    return getPendingEntries();
  }, []);

  return {
    pendingCount: state.pendingCount,
    isFlushing: state.isFlushing,
    lastFlushAt: state.lastFlushAt,
    lastFlushError: state.lastFlushError,
    enqueue: handleEnqueue,
    syncNow: handleSyncNow,
    dequeue: handleDequeue,
    getPending: handleGetPending,
  };
}