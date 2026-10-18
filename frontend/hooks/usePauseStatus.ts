"use client";

import { useEffect } from "react";
import { useContractState } from "../lib/contract-context";
import {
  selectIsPaused,
  selectPauseLastUpdated,
  selectPauseReason,
  selectPauseStatus,
  selectPauseStatusError,
  selectPauseStatusKnown,
  selectPauseStatusLoading,
  type ContractPauseStatus,
} from "../lib/contract-state";

export type { ContractPauseStatus as PauseStatus } from "../lib/contract-state";

export interface UsePauseStatusResult {
  status: ContractPauseStatus;
  isPaused: boolean;
  isKnown: boolean;
  reason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  /** Unix milliseconds of the last successful sync; null before one is available. */
  lastUpdated: number | null;
  loading: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Read the shared contract pause status and request polling every `interval` ms.
 * The fastest active subscriber determines the shared polling interval. Failures
 * retain the last known status/time and are exposed as `error`, then retried.
 * Requires the ContractProvider mounted by AppProviders.
 */
export function usePauseStatus(interval = 5000): UsePauseStatusResult {
  const { state, syncService } = useContractState();

  useEffect(() => {
    const intervalMs = Number.isFinite(interval) && interval > 0 ? interval : 5000;
    const unsubscribe = syncService.subscribe(intervalMs);
    // Get a fresh snapshot on mount/interval changes, deduplicating any app-load request.
    void syncService.refresh();
    // Release only this consumer; other mounted consumers keep their shared sync alive.
    return unsubscribe;
  }, [syncService, interval]);

  const status = selectPauseStatus(state);
  const loading = selectPauseStatusLoading(state);
  return {
    status,
    isPaused: selectIsPaused(state),
    isKnown: selectPauseStatusKnown(state),
    reason: selectPauseReason(state),
    pausedAt: status.pausedAt,
    pausedBy: status.pausedBy,
    lastUpdated: selectPauseLastUpdated(state),
    loading,
    isLoading: loading,
    error: selectPauseStatusError(state),
    refresh: syncService.refresh,
  };
}

export default usePauseStatus;
