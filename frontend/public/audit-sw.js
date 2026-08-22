/**
 * CarbonLedger Service Worker
 *
 * Strategy (PWA offline support, issue #894):
 *   - Audit API routes → stale-while-revalidate (serve cache, update in background)
 *   - Other API GET routes → stale-while-revalidate (offline-friendly dashboard data)
 *   - Static assets        → cache-first
 *   - Navigation requests  → network-first with cached app-shell fallback.
 *     Any route can be opened offline: the cached "/" shell is returned,
 *     and client-side data comes from the SWR/IndexedDB caches.
 *   - Non-GET requests     → network-only (never cached; mutations must reach the server)
 *
 * Storage quota: capped at 50 MB per the acceptance criteria.
 */

const SW_VERSION = 'v2';
const AUDIT_CACHE = `carbonledger-audit-${SW_VERSION}`;
const STATIC_CACHE = `carbonledger-static-${SW_VERSION}`;
const SHELL_CACHE = `carbonledger-shell-${SW_VERSION}`;

/** API path prefixes that belong to the audit data plane. */
const AUDIT_API_PATTERNS = [
  '/api/v1/public',
  '/api/audit',
  '/retirements',
  '/projects',
  '/credits',
  '/stats',
  '/oracle',
  '/marketplace/listings',
];

/** Extra API path prefixes cached for offline dashboard/verifier browsing. */
const GENERAL_API_PATTERNS = [
  '/api/v1',
  '/api/v2',
];

/** Static assets that never change without a hash — cache-first. */
const STATIC_ASSET_PATTERN = /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|webp)$/;

/** Shell routes pre-cached at install so the app boots offline. */
const SHELL_ROUTES = [
  '/',
  '/audit',
  '/verifier',
  '/verifier/apply',
  '/verifier/dashboard',
  '/dashboard',
  '/marketplace',
  '/projects',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

/** Maximum cache size in bytes (50 MB). */
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        cache.addAll(SHELL_ROUTES).catch(() => {
          // Non-fatal: pages might not be pre-rendered yet in dev
        })
      )
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k !== AUDIT_CACHE &&
                k !== STATIC_CACHE &&
                k !== SHELL_CACHE
            )
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only same-origin requests are handled by this SW
  if (url.origin !== self.location.origin) return;

  // Non-GET: network only — mutations must reach the server
  if (request.method !== 'GET') return;

  // Skip non-http(s) URLs (chrome-extension, blob, etc.)
  if (!url.protocol.startsWith('http')) return;

  const isNavigation = request.mode === 'navigate';
  const isAuditApi = AUDIT_API_PATTERNS.some(
    (p) => url.pathname.startsWith(p) || url.href.includes(p)
  );
  const isGeneralApi = GENERAL_API_PATTERNS.some((p) =>
    url.pathname.startsWith(p)
  );
  const isStaticAsset = STATIC_ASSET_PATTERN.test(url.pathname);

  if (isNavigation) {
    // Network-first with app-shell fallback → any route works offline
    event.respondWith(networkFirstWithShellFallback(request));
  } else if (isAuditApi || isGeneralApi) {
    event.respondWith(staleWhileRevalidate(request, AUDIT_CACHE));
  } else if (isStaticAsset) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else {
    // Plain-page routes and anything else: cache sensitive, network first
    event.respondWith(networkFirst(request, AUDIT_CACHE));
  }
});

// ─── Strategies ───────────────────────────────────────────────────────────────

/**
 * Stale-while-revalidate: immediately return cached response (if any),
 * then fetch fresh data and update the cache in the background.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request.clone())
    .then(async (response) => {
      if (response.ok) {
        await enforceCacheQuota(cache);
        await cache.put(request, response.clone());
        // Notify all clients that fresh data is available
        broadcastSync({ type: 'CACHE_UPDATED', url: request.url });
      }
      return response;
    })
    .catch(() => null);

  // If we have a cached copy, return it immediately and revalidate behind the scenes
  if (cached) {
    // Don't await the network fetch — let it run in background
    networkFetch.catch(() => {});
    return cached;
  }

  // No cache: wait for network
  const response = await networkFetch;
  if (response) return response;

  return offlineFallback();
}

/**
 * Cache-first: return from cache if available, otherwise fetch and cache.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      await enforceCacheQuota(cache);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback();
  }
}

/**
 * Network-first: try the network, fall back to cache on failure.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await enforceCacheQuota(cache);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return offlineFallback();
  }
}

/**
 * Network-first for navigation; if the network is down, serve the cached
 * app shell ("/") so the PWA remains fully navigable offline. The client
 * rehydrates with cached SWR/IndexedDB data.
 */
async function networkFirstWithShellFallback(request) {
  try {
    const response = await fetch(request);
    // Cache every successfully-navigated route for later offline use
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await enforceCacheQuota(cache);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline — first check a cached copy of this exact route
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fall back to the cached app shell
    const shell = await caches.match('/');
    if (shell) return shell;

    // Last resort: a minimal offline page
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head>' +
        '<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAF5FF">' +
        '<div style="text-align:center"><h1 style="color:#7C3AED">You are offline</h1>' +
        '<p style="color:#6b7280">Reconnect to browse the Carbon Ledger.</p></div></body></html>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Offline': 'true' },
      }
    );
  }
}

// ─── Quota management ────────────────────────────────────────────────────────

/**
 * Ensure the cache stays under MAX_CACHE_BYTES by evicting the oldest
 * entries (FIFO) when the quota is exceeded.
 */
async function enforceCacheQuota(cache) {
  try {
    const estimate = await navigator.storage.estimate();
    const used = estimate.usage ?? 0;
    if (used < MAX_CACHE_BYTES) return;

    // Evict the oldest 20% of entries
    const keys = await cache.keys();
    const evictCount = Math.max(1, Math.floor(keys.length * 0.2));
    for (let i = 0; i < evictCount; i++) {
      await cache.delete(keys[i]);
    }
  } catch {
    // storage.estimate() not supported — skip quota check
  }
}

// ─── Background sync ─────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'audit-sync') {
    event.waitUntil(handleBackgroundSync());
  }
});

async function handleBackgroundSync() {
  broadcastSync({ type: 'SYNC_START' });

  try {
    // Re-fetch the most recent retirements and broadcast to clients
    const response = await fetch(
      `${self.location.origin}/retirements?limit=100`
    );
    if (response.ok) {
      const cache = await caches.open(AUDIT_CACHE);
      await cache.put(
        `${self.location.origin}/retirements?limit=100`,
        response.clone()
      );
      broadcastSync({ type: 'SYNC_COMPLETE', timestamp: Date.now() });
    } else {
      broadcastSync({ type: 'SYNC_ERROR', error: 'Network response not ok' });
    }
  } catch (err) {
    broadcastSync({ type: 'SYNC_ERROR', error: String(err) });
  }
}

// ─── Message handling ────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  const { type } = event.data ?? {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'GET_CACHE_SIZE':
      getCacheSize().then((size) => {
        event.source?.postMessage({ type: 'CACHE_SIZE', bytes: size });
      });
      break;

    case 'CLEAR_AUDIT_CACHE':
      caches.delete(AUDIT_CACHE).then(() => {
        event.source?.postMessage({ type: 'AUDIT_CACHE_CLEARED' });
      });
      break;

    case 'TRIGGER_SYNC':
      handleBackgroundSync();
      break;
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function offlineFallback() {
  return new Response(
    JSON.stringify({ offline: true, message: 'You are offline. Showing cached data.' }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'X-Offline': 'true' },
    }
  );
}

async function getCacheSize() {
  try {
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? 0;
  } catch {
    return 0;
  }
}

function broadcastSync(message) {
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => client.postMessage(message));
  });
}