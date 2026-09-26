/**
 * Tests for the offline sync queue (lib/offline-sync.ts)
 *
 * Coverage:
 *   1. enqueue — stores entries in IndexedDB with IDs
 *   2. flushQueue — submits pending entries and removes on success
 *   3. flushQueue — retries failed entries, tracks attempts
 *   4. subscribe — receives state updates
 */

// ─── IndexedDB in-memory mock ─────────────────────────────────────────────────

const dbStores: Record<string, Map<string, unknown>> = {
  pendingReports: new Map(),
  deadLetterReports: new Map(),
};

// Track all pending IDB-request resolve functions so we can flush them
const pendingReqs: Array<() => void> = [];

function flushPending() {
  const fns = pendingReqs.splice(0);
  fns.forEach((fn) => fn());
}

// Mock IDB is synchronous — every request resolves immediately
const mockIDB: IDBFactory = {
  open: jest.fn(() => {
    const db = {
      objectStoreNames: {
        contains: (n: string) => n in dbStores,
      },
      createObjectStore: jest.fn((name: string) => {
        if (!dbStores[name]) dbStores[name] = new Map();
        return { createIndex: jest.fn() };
      }),
      objectStore: (name: string) => ({
        add: (record: any) => {
          dbStores[name].set(record.id, record);
          return { onsuccess: null, onerror: null };
        },
        put: (record: any) => {
          dbStores[name].set(record.id, record);
          return { onsuccess: null, onerror: null };
        },
        get: (key: string) => ({
          result: dbStores[name].get(key),
          onsuccess: null,
          onerror: null,
        }),
        getAll: () => ({
          result: Array.from(dbStores[name].values()),
          onsuccess: null,
          onerror: null,
        }),
        delete: (key: string) => {
          dbStores[name].delete(key);
          return { onsuccess: null, onerror: null };
        },
        clear: () => {
          dbStores[name].clear();
          return { onsuccess: null, onerror: null };
        },
        count: () => ({
          result: dbStores[name].size,
          onsuccess: null,
          onerror: null,
        }),
        index: () => ({
          getAll: () => ({
            result: Array.from(dbStores[name].values()),
            onsuccess: null,
            onerror: null,
          }),
        }),
      }),
      transaction: (_stores: string | string[], _mode: string) => ({
        objectStore: (name: string) => db.objectStore(name),
        oncomplete: null,
        onerror: null,
      }),
      close: jest.fn(),
    };
    return { result: db, onupgradeneeded: null, onsuccess: null, onerror: null };
  }),
  deleteDatabase: jest.fn(),
  cmp: jest.fn(),
} as unknown as IDBFactory;

global.indexedDB = mockIDB;

// Mock crypto.randomUUID for jsdom
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }),
  },
  writable: true,
});

// Mock fetch
global.fetch = jest.fn() as unknown as typeof fetch;

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  dbStores.pendingReports.clear();
  dbStores.deadLetterReports.clear();
  (mockIDB.open as jest.Mock).mockClear();
  (global.fetch as jest.Mock).mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

// We need to wait for microtasks to flush when using the real IDB mock
// which expects onsuccess/onerror callbacks. The real lib uses `idbRequest`
// which sets onsuccess callback then resolves from a Promise.
// Our mock's synchronous operations don't trigger those callbacks, so we
// monkey-patch the lib's module-level functions to make them testable.

// Instead, we test the lib through its public API which uses the mock.
// The `offline-sync.ts` code uses `idbRequest` which sets `req.onsuccess`.
// Our mock's `objectStore().add()` returns `{ onsuccess: null, ... }`.
// `idbRequest` sets `req.onsuccess = () => resolve(req.result)`.
// Since the mock's req.onsuccess is null initially and then set, we need
// the setter to trigger. But the mock uses plain objects, not setters.
// We'll use flushPending() approach.

// Actually, the simplest approach: rewrite the mock to use PropertyDescriptor
// setters on all request objects so they auto-resolve.

// Let's patch the mock request objects to have onsuccess setters
function makeAutoResolvingReq(result: any) {
  let _onsuccess: (() => void) | null = null;
  const req: any = {
    get result() {
      return result;
    },
    set onsuccess(fn: (() => void) | null) {
      _onsuccess = fn;
      if (fn) setTimeout(fn, 0);
    },
    get onsuccess() {
      return _onsuccess;
    },
    onerror: null,
  };
  return req;
}

// Rebuild the objectStore with auto-resolving requests
function makeAutoStore(name: string) {
  const backing = dbStores[name];
  return {
    add: jest.fn((record: any) => {
      backing.set(record.id, record);
      return makeAutoResolvingReq(undefined);
    }),
    put: jest.fn((record: any) => {
      backing.set(record.id, record);
      return makeAutoResolvingReq(undefined);
    }),
    get: jest.fn((key: string) => makeAutoResolvingReq(backing.get(key))),
    getAll: jest.fn(() => makeAutoResolvingReq(Array.from(backing.values()))),
    delete: jest.fn((key: string) => {
      backing.delete(key);
      return makeAutoResolvingReq(undefined);
    }),
    clear: jest.fn(() => {
      backing.clear();
      return makeAutoResolvingReq(undefined);
    }),
    count: jest.fn(() => makeAutoResolvingReq(backing.size)),
    index: jest.fn(() => ({
      getAll: jest.fn(() => makeAutoResolvingReq(Array.from(backing.values()))),
    })),
  };
}

const autoStores: Record<string, ReturnType<typeof makeAutoStore>> = {};

// Build the full mock IDB with auto-resolving requests
const autoIDB: IDBFactory = {
  open: jest.fn(() => {
    const db = {
      objectStoreNames: { contains: (n: string) => n in dbStores },
      createObjectStore: jest.fn((name: string) => {
        if (!dbStores[name]) dbStores[name] = new Map();
        autoStores[name] = makeAutoStore(name);
        return { createIndex: jest.fn() };
      }),
      objectStore: (name: string) => {
        // Auto-create store if it doesn't exist (handles onupgradeneeded not fired)
        if (!autoStores[name]) {
          if (!dbStores[name]) dbStores[name] = new Map();
          autoStores[name] = makeAutoStore(name);
        }
        return autoStores[name];
      },
      transaction: (_s: string | string[], _m: string) => ({
        objectStore: (name: string) => db.objectStore(name),
        get oncomplete() {
          return null;
        },
        set oncomplete(fn) {
          if (fn) setTimeout(fn, 0);
        },
        onerror: null,
      }),
      close: jest.fn(),
    };
    return makeAutoResolvingReq(db);
  }),
  deleteDatabase: jest.fn(),
  cmp: jest.fn(),
} as unknown as IDBFactory;

// Override the global indexedDB with auto-resolving version
global.indexedDB = autoIDB;

// Also need to handle the DB open request's `onupgradeneeded` and `onsuccess`
// The open() returns a request with auto-resolving result.
// The lib does:
//   req.onupgradeneeded = (event) => { ... db = (event.target as ...).result ... };
//   req.onsuccess = () => resolve(req.result);
// With auto-resolving, onsuccess fires after setTimeout, which resolves openDB.

// ─── Tests ────────────────────────────────────────────────────────────────────

import {
  enqueue,
  flushQueue,
  getPendingCount,
  subscribe,
  getPendingEntries,
  dequeue,
  clearQueue,
} from '../lib/offline-sync';

describe('offline-sync enqueue', () => {
  it('stores an entry and returns its id', async () => {
    const id = await enqueue('/api/v1/verifiers/apply', 'POST', { foo: 'bar' });
    expect(id).toBeTruthy();
    expect(dbStores.pendingReports.size).toBe(1);
    expect(await getPendingCount()).toBe(1);
  });

  it('stores multiple entries in order', async () => {
    await enqueue('/a', 'POST', { n: 1 });
    await enqueue('/b', 'POST', { n: 2 });
    expect(dbStores.pendingReports.size).toBe(2);
    expect(await getPendingCount()).toBe(2);
  });
});

describe('offline-sync flushQueue', () => {
  it('submits pending entries and removes them on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const id1 = await enqueue('/api/v1/verifiers/apply', 'POST', { a: 1 });
    const id2 = await enqueue('/api/v1/verifiers/apply', 'POST', { a: 2 });

    await flushQueue();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(dbStores.pendingReports.size).toBe(0);
    expect(await getPendingCount()).toBe(0);
  });

  it('leaves failed entries in the queue for retry', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Failed to fetch'));
    await enqueue('/api/v1/verifiers/apply', 'POST', { a: 1 });

    await flushQueue();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(dbStores.pendingReports.size).toBe(1);
    const entries = Array.from(dbStores.pendingReports.values()) as any[];
    expect(entries[0].attempts).toBe(1);
  });
});

describe('offline-sync subscribe', () => {
  it('notifies listeners of state changes', async () => {
    const listener = jest.fn();
    const unsub = subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    await enqueue('/x', 'POST', {});
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    unsub();
  });
});

describe('offline-sync getPendingEntries/dequeue/clearQueue', () => {
  it('returns pending entries', async () => {
    await enqueue('/x', 'POST', { v: 1 });
    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toEqual({ v: 1 });
  });

  it('dequeues a specific entry', async () => {
    const id = await enqueue('/x', 'POST', { v: 1 });
    await dequeue(id);
    expect(dbStores.pendingReports.size).toBe(0);
  });

  it('clears the whole queue', async () => {
    await enqueue('/x', 'POST', { v: 1 });
    await enqueue('/y', 'POST', { v: 2 });
    await clearQueue();
    expect(dbStores.pendingReports.size).toBe(0);
  });
});