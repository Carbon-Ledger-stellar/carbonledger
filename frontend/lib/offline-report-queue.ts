/**
 * offline-report-queue
 *
 * IndexedDB-backed offline queue for draft verification reports.
 * Field verifiers can save their decisions (approve/reject) while offline
 * and sync them automatically when connectivity is restored.
 *
 * Schema (idb):
 *   - key: auto-incremented id
 *   - projectId: string
 *   - projectName: string
 *   - decision: "verify" | "reject"
 *   - rejectReason: string
 *   - checkedItems: string[]
 *   - createdAt: number (Date.now())
 *   - synced: boolean
 *   - syncError?: string
 */

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "carbonledger-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "draft-reports";

export interface DraftReport {
  id?: number;
  projectId: string;
  projectName: string;
  decision: "verify" | "reject";
  rejectReason: string;
  checkedItems: string[];
  createdAt: number;
  synced: boolean;
  syncError?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("synced", "synced");
          store.createIndex("projectId", "projectId");
          store.createIndex("createdAt", "createdAt");
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Save a draft report to the IndexedDB queue.
 * Returns the generated id.
 */
export async function saveDraftReport(
  report: Omit<DraftReport, "id" | "createdAt" | "synced">
): Promise<number> {
  const db = await getDb();
  const id = await db.add(STORE_NAME, {
    ...report,
    createdAt: Date.now(),
    synced: false,
  });
  return id as number;
}

/**
 * Retrieve all pending (unsynced) draft reports, ordered by creation time.
 */
export async function getPendingDrafts(): Promise<DraftReport[]> {
  const db = await getDb();
  const index = db.transaction(STORE_NAME, "readonly").store.index("createdAt");
  const all = await index.getAll();
  return all.filter((d) => !d.synced);
}

/**
 * Retrieve all draft reports (including synced ones).
 */
export async function getAllDrafts(): Promise<DraftReport[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

/**
 * Mark a draft report as synced.
 */
export async function markDraftSynced(id: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const report = await tx.store.get(id);
  if (report) {
    report.synced = true;
    report.syncError = undefined;
    await tx.store.put(report);
  }
  await tx.done;
}

/**
 * Mark a draft report as failed with an error message.
 */
export async function markDraftFailed(
  id: number,
  error: string
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const report = await tx.store.get(id);
  if (report) {
    report.syncError = error;
    await tx.store.put(report);
  }
  await tx.done;
}

/**
 * Remove a single draft report from the queue.
 */
export async function removeDraft(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

/**
 * Remove all synced draft reports.
 */
export async function clearSyncedDrafts(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.synced) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

/**
 * Get the count of pending (unsynced) draft reports.
 */
export async function getPendingDraftCount(): Promise<number> {
  const drafts = await getPendingDrafts();
  return drafts.length;
}

/**
 * Check if a project already has a pending draft.
 */
export async function hasPendingDraft(
  projectId: string
): Promise<DraftReport | undefined> {
  const drafts = await getPendingDrafts();
  return drafts.find((d) => d.projectId === projectId);
}