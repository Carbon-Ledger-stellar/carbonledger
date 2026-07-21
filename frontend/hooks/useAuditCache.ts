"use client";

/**
 * useAuditCache
 *
 * Provides a typed IndexedDB-backed cache for audit data (retirements,
 * projects, credit batches). Each record is stored with a `cachedAt`
 * timestamp so we can detect staleness and conflicts on re-sync.
 *
 * DB layout:
 *   carbonledger-audit  (v1)
 *     ├── retirements   { retirementId, ...record, cachedAt, serverUpdatedAt }
 *     ├── projects      { projectId,    ...record, cachedAt, serverUpdatedAt }
 *     └── creditBatches { batchId,      ...record, cachedAt, serverUpdatedAt }
 */

import { useState, useEffect, useCallback } from "react";
import type { RetirementRecord, CarbonProject, CreditBatch } from "../lib/api";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DB_NAME = "carbonledger-audit";
export const DB_VERSION = 1;

export const STORE_RETIREMENTS = "retirements";
export const STORE_PROJECTS = "projects";
export const STORE_BATCHES = "creditBatches";

/** Max total IndexedDB usage target — 50 MB. */
export const MAX_STORAGE_BYTES = 50 * 1024 * 1024;

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditStoreName =
  | typeof STORE_RETIREMENTS
  | typeof STORE_PROJECTS
  | typeof STORE_BATCHES;

export interface CachedRecord<T> {
  data: T;
  cachedAt: number;        // Unix ms — when we wrote this record locally
  serverUpdatedAt: number; // Unix ms — `updatedAt` / `retiredAt` from the server record
}

export type CachedRetirement = CachedRecord<RetirementRecord>;
export type CachedProject    = CachedRecord<CarbonProject>;
export type CachedBatch      = CachedRecord<CreditBatch>;

export interface AuditCacheState {
  retirements: RetirementRecord[];
  projects: CarbonProject[];
  batches: CreditBatch[];
  lastSyncedAt: number | null;
  storageUsedBytes: number;
  isReady: boolean;
  error: Error | null;
}

export interface UseAuditCacheReturn extends AuditCacheState {
  /** Write an array of retirement records into the cache. */
  putRetirements: (records: RetirementRecord[]) => Promise<void>;
  /** Write an array of project records into the cache. */
  putProjects: (records: CarbonProject[]) => Promise<void>;
  /** Write an array of credit batch records into the cache. */
  putBatches: (records: CreditBatch[]) => Promise<void>;
  /** Retrieve all cached retirements. */
  getRetirements: () => Promise<RetirementRecord[]>;
  /** Retrieve all cached projects. */
  getProjects: () => Promise<CarbonProject[]>;
  /** Retrieve all cached credit batches. */
  getBatches: () => Promise<CreditBatch[]>;
  /** Wipe a specific store. */
  clearStore: (store: AuditStoreName) => Promise<void>;
  /** Wipe all audit caches and reset state. */
  clearAll: () => Promise<void>;
  /** Force a re-read from IDB and refresh React state. */
  refresh: () => Promise<void>;
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_RETIREMENTS)) {
        db.createObjectStore(STORE_RETIREMENTS, { keyPath: "retirementId" });
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains(STORE_BATCHES)) {
        db.createObjectStore(STORE_BATCHES, { keyPath: "batchId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      _dbPromise = null;
      reject(request.error);
    };
  });

  return _dbPromise;
}

/** Wrap an IDB request in a Promise. */
function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Read all records from a store (returns raw stored envelopes). */
async function readAll<T>(storeName: AuditStoreName): Promise<CachedRecord<T>[]> {
  const db = await openDB();
  return idbRequest<CachedRecord<T>[]>(
    db.transaction(storeName, "readonly").objectStore(storeName).getAll()
  );
}

/** Write records into a store using a single transaction. */
async function writeAll<T extends object>(
  storeName: AuditStoreName,
  records: T[],
  getKey: (r: T) => string,
  getServerTs: (r: T) => number
): Promise<void> {
  if (records.length === 0) return;
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  const now = Date.now();

  for (const record of records) {
    const envelope: CachedRecord<T> & Record<string, unknown> = {
      ...record,
      data: record,
      cachedAt: now,
      serverUpdatedAt: getServerTs(record),
    };
    // Use the keyPath from the record object itself
    store.put(envelope);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Clear a single object store. */
async function clearObjectStore(storeName: AuditStoreName): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Estimate IndexedDB storage used (bytes). Falls back to 0. */
async function estimateStorageUsed(): Promise<number> {
  try {
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? 0;
  } catch {
    return 0;
  }
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

function retirementTs(r: RetirementRecord): number {
  return r.retiredAt ? new Date(r.retiredAt).getTime() : 0;
}
function projectTs(p: CarbonProject): number {
  return p.createdAt ? new Date(p.createdAt).getTime() : 0;
}
function batchTs(b: CreditBatch): number {
  return b.issuedAt ? new Date(b.issuedAt).getTime() : 0;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuditCache(): UseAuditCacheReturn {
  const [state, setState] = useState<AuditCacheState>({
    retirements: [],
    projects: [],
    batches: [],
    lastSyncedAt: null,
    storageUsedBytes: 0,
    isReady: false,
    error: null,
  });

  // Load all cached data from IDB on mount
  const loadFromIDB = useCallback(async () => {
    try {
      const [retEnvelopes, projEnvelopes, batchEnvelopes, storageUsedBytes] =
        await Promise.all([
          readAll<RetirementRecord>(STORE_RETIREMENTS),
          readAll<CarbonProject>(STORE_PROJECTS),
          readAll<CreditBatch>(STORE_BATCHES),
          estimateStorageUsed(),
        ]);

      const retirements = retEnvelopes.map((e) => e.data);
      const projects    = projEnvelopes.map((e) => e.data);
      const batches     = batchEnvelopes.map((e) => e.data);

      const allTs = [...retEnvelopes, ...projEnvelopes, ...batchEnvelopes]
        .map((e) => e.cachedAt)
        .filter(Boolean);
      const lastSyncedAt = allTs.length > 0 ? Math.max(...allTs) : null;

      setState({
        retirements,
        projects,
        batches,
        lastSyncedAt,
        storageUsedBytes,
        isReady: true,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isReady: true,
        error: err instanceof Error ? err : new Error(String(err)),
      }));
    }
  }, []);

  useEffect(() => {
    loadFromIDB();
  }, [loadFromIDB]);

  // ── Write helpers ──────────────────────────────────────────────────────────

  const putRetirements = useCallback(async (records: RetirementRecord[]) => {
    await writeAll(STORE_RETIREMENTS, records, (r) => r.retirementId, retirementTs);
    await loadFromIDB();
  }, [loadFromIDB]);

  const putProjects = useCallback(async (records: CarbonProject[]) => {
    await writeAll(STORE_PROJECTS, records, (p) => p.projectId, projectTs);
    await loadFromIDB();
  }, [loadFromIDB]);

  const putBatches = useCallback(async (records: CreditBatch[]) => {
    await writeAll(STORE_BATCHES, records, (b) => b.batchId, batchTs);
    await loadFromIDB();
  }, [loadFromIDB]);

  // ── Read helpers ───────────────────────────────────────────────────────────

  const getRetirements = useCallback(async (): Promise<RetirementRecord[]> => {
    const envelopes = await readAll<RetirementRecord>(STORE_RETIREMENTS);
    return envelopes.map((e) => e.data);
  }, []);

  const getProjects = useCallback(async (): Promise<CarbonProject[]> => {
    const envelopes = await readAll<CarbonProject>(STORE_PROJECTS);
    return envelopes.map((e) => e.data);
  }, []);

  const getBatches = useCallback(async (): Promise<CreditBatch[]> => {
    const envelopes = await readAll<CreditBatch>(STORE_BATCHES);
    return envelopes.map((e) => e.data);
  }, []);

  // ── Clear helpers ──────────────────────────────────────────────────────────

  const clearStore = useCallback(async (store: AuditStoreName) => {
    await clearObjectStore(store);
    await loadFromIDB();
  }, [loadFromIDB]);

  const clearAll = useCallback(async () => {
    await Promise.all([
      clearObjectStore(STORE_RETIREMENTS),
      clearObjectStore(STORE_PROJECTS),
      clearObjectStore(STORE_BATCHES),
    ]);
    setState({
      retirements: [],
      projects: [],
      batches: [],
      lastSyncedAt: null,
      storageUsedBytes: 0,
      isReady: true,
      error: null,
    });
  }, []);

  return {
    ...state,
    putRetirements,
    putProjects,
    putBatches,
    getRetirements,
    getProjects,
    getBatches,
    clearStore,
    clearAll,
    refresh: loadFromIDB,
  };
}
