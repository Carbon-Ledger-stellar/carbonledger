"use client";

/**
 * useAuditSync
 *
 * Sync engine that:
 *   1. Listens for the "carbonledger:online" event (fired by useNetworkStatus)
 *   2. Fetches fresh audit data from the API
 *   3. Detects conflicts (server record newer than locally cached version)
 *   4. Merges by choosing the server record (last-write-wins) and reports conflicts
 *
 * Conflict definition:
 *   A record is "in conflict" when:
 *     - It exists in the local IDB cache AND
 *     - The server version's serverUpdatedAt > the locally cached serverUpdatedAt
 *       (meaning a newer version arrived since we last synced)
 *
 * The hook never silently discards data — conflicts are surfaced to the caller
 * so the UI can show a banner / toast.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { RetirementRecord, CarbonProject } from "../lib/api";
import {
  DB_NAME,
  DB_VERSION,
  STORE_RETIREMENTS,
  STORE_PROJECTS,
  openDB as _openDB,
  readAll,
} from "./useAuditCache";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConflictRecord {
  store: string;
  id: string;
  localUpdatedAt: number;
  serverUpdatedAt: number;
  /** The resolved (server) version that was written to the cache. */
  resolved: RetirementRecord | CarbonProject;
}

export type SyncStatus = "idle" | "syncing" | "success" | "error";

export interface AuditSyncState {
  syncStatus: SyncStatus;
  lastSyncAt: number | null;
  conflicts: ConflictRecord[];
  syncError: string | null;
  /** How many records were updated in the last sync. */
  updatedCount: number;
}

export interface UseAuditSyncReturn extends AuditSyncState {
  /** Manually trigger a sync (e.g. from a "Refresh" button). */
  triggerSync: () => Promise<void>;
  /** Clear the conflict list after the user has acknowledged them. */
  dismissConflicts: () => void;
}

// ── IDB helpers (re-exported from useAuditCache) ──────────────────────────────

// We import `readAll` and `openDB` directly to avoid circular hook deps.
// The functions are the same implementation used in useAuditCache.

export { readAll };

async function openDB(): Promise<IDBDatabase> {
  // Re-use the same DB that useAuditCache opens
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_RETIREMENTS))
        db.createObjectStore(STORE_RETIREMENTS, { keyPath: "retirementId" });
      if (!db.objectStoreNames.contains(STORE_PROJECTS))
        db.createObjectStore(STORE_PROJECTS, { keyPath: "projectId" });
    };
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Conflict detection ────────────────────────────────────────────────────────

interface Envelope {
  serverUpdatedAt: number;
  cachedAt: number;
  [key: string]: unknown;
}

async function detectAndMerge<T extends object>(
  store: typeof STORE_RETIREMENTS | typeof STORE_PROJECTS,
  serverRecords: T[],
  keyField: keyof T,
  getServerTs: (r: T) => number
): Promise<{ conflicts: ConflictRecord[]; written: number }> {
  const db = await openDB();
  const tx = db.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  const conflicts: ConflictRecord[] = [];
  let written = 0;
  const now = Date.now();

  for (const record of serverRecords) {
    const id = String(record[keyField]);
    const existingRaw = await idbRequest<Envelope | undefined>(
      objectStore.get(id)
    );
    const serverTs = getServerTs(record);

    if (existingRaw && existingRaw.serverUpdatedAt > 0) {
      const localTs = existingRaw.serverUpdatedAt;
      if (serverTs > localTs) {
        // Conflict: server has a newer version
        conflicts.push({
          store,
          id,
          localUpdatedAt: localTs,
          serverUpdatedAt: serverTs,
          resolved: record as unknown as RetirementRecord | CarbonProject,
        });
      }
    }

    // Always write the server record (last-write-wins strategy)
    const envelope = {
      ...record,
      data: record,
      cachedAt: now,
      serverUpdatedAt: serverTs,
    };
    objectStore.put(envelope);
    written++;
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { conflicts, written };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuditSync(): UseAuditSyncReturn {
  const [state, setState] = useState<AuditSyncState>({
    syncStatus: "idle",
    lastSyncAt: null,
    conflicts: [],
    syncError: null,
    updatedCount: 0,
  });

  // Prevent overlapping syncs
  const isSyncing = useRef(false);

  const triggerSync = useCallback(async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;

    setState((prev) => ({
      ...prev,
      syncStatus: "syncing",
      syncError: null,
    }));

    try {
      // Fetch fresh data in parallel
      const [retirementsRes, projectsRes] = await Promise.all([
        fetch(`${API_URL}/retirements?limit=100`),
        fetch(`${API_URL}/projects`),
      ]);

      let allConflicts: ConflictRecord[] = [];
      let totalWritten = 0;

      if (retirementsRes.ok) {
        const retirements: RetirementRecord[] = await retirementsRes.json();
        const { conflicts, written } = await detectAndMerge(
          STORE_RETIREMENTS,
          retirements,
          "retirementId",
          (r) => (r.retiredAt ? new Date(r.retiredAt).getTime() : 0)
        );
        allConflicts = [...allConflicts, ...conflicts];
        totalWritten += written;
      }

      if (projectsRes.ok) {
        const projects: CarbonProject[] = await projectsRes.json();
        const { conflicts, written } = await detectAndMerge(
          STORE_PROJECTS,
          projects,
          "projectId",
          (p) => (p.createdAt ? new Date(p.createdAt).getTime() : 0)
        );
        allConflicts = [...allConflicts, ...conflicts];
        totalWritten += written;
      }

      setState((prev) => ({
        ...prev,
        syncStatus: "success",
        lastSyncAt: Date.now(),
        conflicts: allConflicts,
        updatedCount: totalWritten,
      }));

      // Trigger service worker background sync if available
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        const reg = await navigator.serviceWorker.ready;
        try {
          await (reg as ServiceWorkerRegistration & { sync: SyncManager }).sync.register("audit-sync");
        } catch {
          // Background sync not supported — already synced manually above
        }
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        syncStatus: "error",
        syncError: err instanceof Error ? err.message : "Sync failed",
      }));
    } finally {
      isSyncing.current = false;
    }
  }, []);

  const dismissConflicts = useCallback(() => {
    setState((prev) => ({ ...prev, conflicts: [] }));
  }, []);

  // Listen for reconnect events fired by useNetworkStatus
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleReconnect = () => {
      triggerSync();
    };

    window.addEventListener("carbonledger:online", handleReconnect);

    // Also listen for service worker messages
    if ("serviceWorker" in navigator) {
      const handleSwMessage = (event: MessageEvent) => {
        const { type } = event.data ?? {};
        if (type === "SYNC_COMPLETE" || type === "CACHE_UPDATED") {
          // SW has fresh data — mark as success without re-fetching
          setState((prev) => ({
            ...prev,
            syncStatus: "success",
            lastSyncAt: event.data.timestamp ?? Date.now(),
          }));
        }
      };
      navigator.serviceWorker.addEventListener("message", handleSwMessage);
      return () => {
        window.removeEventListener("carbonledger:online", handleReconnect);
        navigator.serviceWorker.removeEventListener("message", handleSwMessage);
      };
    }

    return () => {
      window.removeEventListener("carbonledger:online", handleReconnect);
    };
  }, [triggerSync]);

  return {
    ...state,
    triggerSync,
    dismissConflicts,
  };
}

// Re-export types needed by SyncManager interface
interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}
