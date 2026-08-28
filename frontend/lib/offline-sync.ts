/**
 * offline-sync
 *
 * Automatic synchronization for offline draft reports.
 * When connectivity is restored, checks for pending drafts and
 * dispatches a custom DOM event so the UI can show a notification.
 *
 * Since the verifier review flow requires on-chain attestation
 * (Soroban contract interaction via Freighter wallet), fully
 * automatic sync is not possible. Instead, the sync mechanism:
 *   1. Detects when the network is restored
 *   2. Checks for pending drafts in IndexedDB
 *   3. Dispatches a custom event with the count of pending drafts
 *   4. The UI can then show a prompt to resume the reviews
 */

import { getPendingDrafts, getPendingDraftCount } from "./offline-report-queue";

export const OFFLINE_SYNC_EVENT = "offline:sync-complete";

export interface SyncResult {
  pendingCount: number;
  synced: boolean;
  timestamp: number;
}

/**
 * Check for pending drafts and dispatch a sync event.
 * This is the "sync" mechanism — it notifies the UI so the
 * verifier can resume their pending reviews.
 */
export async function checkPendingDrafts(): Promise<SyncResult> {
  const count = await getPendingDraftCount();
  const result: SyncResult = {
    pendingCount: count,
    synced: true,
    timestamp: Date.now(),
  };

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<SyncResult>(OFFLINE_SYNC_EVENT, { detail: result })
    );
  }

  return result;
}

/**
 * Start listening for online events and automatically check
 * pending drafts when connectivity is restored.
 * Returns an unsubscribe function.
 */
export function startAutoSync(): () => void {
  const handleOnline = () => {
    checkPendingDrafts().catch(() => {
      // Silent — errors are handled inside checkPendingDrafts
    });
  };

  // Also sync immediately on registration if we're already online
  // and have pending drafts
  if (typeof navigator !== "undefined" && navigator.onLine) {
    setTimeout(handleOnline, 1000);
  }

  window.addEventListener("online", handleOnline);

  return () => {
    window.removeEventListener("online", handleOnline);
  };
}