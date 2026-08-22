/**
 * offline-sync.ts
 *
 * Offline queue for verifier reports that persist in IndexedDB and
 * auto-flush when connectivity is restored.
 *
 * Architecture:
 *   - Reports are enqueued when the network is unavailable (fetch fails
 *     with a network error).
 *   - The queue is stored in IndexedDB so it survives page reloads and
 *     tab crashes.
 *   - A `carbonledger:online` custom event listener triggers a flush of
 *     all pending reports in FIFO order.
 *   - Each report is retried up to MAX_ATTEMPTS times; on final failure
 *     it is moved to the dead-letter queue.
 *
 * Usage:
 *   import { enqueue, flushQueue, getPendingCount } from '../lib/offline-sync';
 *
 *   // In a form submit handler:
 *   try {
 *     await fetch('/api/verifiers/apply', { method: 'POST', body: JSON.stringify(data) });
 *   } catch (err) {
 *     if (err instanceof TypeError && !navigator.onLine) {
 *       await enqueue('/api/verifiers/apply', 'POST', data);
 *       showToast('Saved offline. Will sync when connected.');
 *     }
 *   }
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_NAME = 'carbonledger-offline';
const DB_VERSION = 1;
const STORE_QUEUE = 'pendingReports';
const STORE_DEAD_LETTER = 'deadLetterReports';

/** Maximum number of retry attempts before moving to dead-letter queue. */
const MAX_ATTEMPTS = 5;

/** Base delay in ms for exponential backoff between retries (1s → 2s → 4s …). */
const RETRY_BASE_DELAY_MS = 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueuedEntry {
  /** Unique ID (UUID v4). */
  id: string;
  /** Absolute URL or path to POST to (e.g. "/api/v1/verifiers/apply"). */
  endpoint: string;
  /** HTTP method (typically "POST"). */
  method: string;
  /** Request body (JSON-serializable). */
  body: unknown;
  /** When the entry was first enqueued (Unix ms). */
  createdAt: number;
  /** How many times we've tried to submit this entry. */
  attempts: number;
  /** Maximum attempts before dead-letter. */
  maxAttempts: number;
  /** Last error message from the failed attempt. */
  lastError: string | null;
}

export interface OfflineSyncState {
  /** Number of pending entries in the queue. */
  pendingCount: number;
  /** Whether a flush is currently in progress. */
  isFlushing: boolean;
  /** Timestamp of the last successful flush (Unix ms). */
  lastFlushAt: number | null;
  /** Error from the last failed flush (null if last flush succeeded). */
  lastFlushError: string | null;
}

type Listener = (state: OfflineSyncState) => void;

// ── Module-level state (singleton) ───────────────────────────────────────────

let _listeners: Set<Listener> = new Set();
let _state: OfflineSyncState = {
  pendingCount: 0,
  isFlushing: false,
  lastFlushAt: null,
  lastFlushError: null,
};
let _initialized = false;

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DEAD_LETTER)) {
        db.createObjectStore(STORE_DEAD_LETTER, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _notify() {
  const snapshot = { ..._state };
  _listeners.forEach((fn) => fn(snapshot));
}

async function _refreshPendingCount(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const count = await idbRequest(store.count());
    _state.pendingCount = count;
    _notify();
    db.close();
  } catch {
    // Silently ignore — stale counts are non-fatal
  }
}

async function _moveToDeadLetter(entry: QueuedEntry): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_QUEUE, STORE_DEAD_LETTER], 'readwrite');
  await idbRequest(tx.objectStore(STORE_QUEUE).delete(entry.id));
  await idbRequest(tx.objectStore(STORE_DEAD_LETTER).put(entry));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue a report to be submitted when connectivity is restored.
 *
 * @param endpoint  Absolute URL or path (e.g. "/api/v1/verifiers/apply").
 * @param method    HTTP method.
 * @param body      JSON-serializable request body.
 * @returns         The queued entry's ID.
 */
export async function enqueue(
  endpoint: string,
  method: string,
  body: unknown,
): Promise<string> {
  const entry: QueuedEntry = {
    id: crypto.randomUUID(),
    endpoint,
    method,
    body,
    createdAt: Date.now(),
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    lastError: null,
  };

  const db = await openDB();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  await idbRequest(tx.objectStore(STORE_QUEUE).add(entry));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  await _refreshPendingCount();
  return entry.id;
}

/**
 * Attempt to submit all pending entries in FIFO order.
 * Entries that fail are retried on the next flush (up to MAX_ATTEMPTS).
 */
export async function flushQueue(): Promise<void> {
  if (_state.isFlushing) return;
  _state.isFlushing = true;
  _state.lastFlushError = null;
  _notify();

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    const index = store.index('createdAt');
    const all = await idbRequest(index.getAll());

    for (const entry of (all as QueuedEntry[])) {
      try {
        const res = await fetch(entry.endpoint, {
          method: entry.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry.body),
        });

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}: ${await res.text().catch(() => '')}`);
        }

        // Success — remove from queue
        await idbRequest(store.delete(entry.id));
      } catch (err) {
        const errorMessage = String(err);
        entry.attempts += 1;
        entry.lastError = errorMessage;

        if (entry.attempts >= entry.maxAttempts) {
          // Exhausted retries — move to dead-letter
          await _moveToDeadLetter(entry);
        } else {
          // Update attempt count in store
          await idbRequest(store.put(entry));
        }
      }
    }

    db.close();
    _state.lastFlushAt = Date.now();
    _state.isFlushing = false;
    await _refreshPendingCount();
  } catch (err) {
    _state.lastFlushError = String(err);
    _state.isFlushing = false;
    _notify();
  }
}

/**
 * Get all pending entries (for debugging / UI display).
 */
export async function getPendingEntries(): Promise<QueuedEntry[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const store = tx.objectStore(STORE_QUEUE);
    const index = store.index('createdAt');
    const entries = await idbRequest(index.getAll());
    db.close();
    return entries as QueuedEntry[];
  } catch {
    return [];
  }
}

/**
 * Get the current pending count (fast — uses cached state).
 */
export function getPendingCount(): number {
  return _state.pendingCount;
}

/**
 * Remove a specific entry from the queue by ID.
 */
export async function dequeue(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  await idbRequest(tx.objectStore(STORE_QUEUE).delete(id));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await _refreshPendingCount();
}

/**
 * Clear all pending entries.
 */
export async function clearQueue(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  await idbRequest(tx.objectStore(STORE_QUEUE).clear());
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await _refreshPendingCount();
}

/**
 * Subscribe to state changes.
 * Returns an unsubscribe function.
 */
export function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  // Immediately call with current state
  listener({ ..._state });
  return () => {
    _listeners.delete(listener);
  };
}

// ── Auto-initialization ──────────────────────────────────────────────────────

/**
 * Initialize the offline sync service: listen for online events, refresh
 * pending count, and auto-flush on reconnection.
 *
 * Call this once from the root layout or a client component.
 */
export function initOfflineSync(): void {
  if (typeof window === 'undefined') return;
  if (_initialized) return;
  _initialized = true;

  // Refresh pending count on load
  _refreshPendingCount();

  // Listen for the carbonledger:online custom event (fired by useNetworkStatus)
  window.addEventListener('carbonledger:online', () => {
    flushQueue();
  });

  // Also listen for the native online event directly (belt-and-suspenders)
  window.addEventListener('online', () => {
    flushQueue();
  });
}