/**
 * CarbonLedger General Service Worker
 *
 * Complements audit-sw.js — this SW handles the full app shell, general asset
 * caching, and background sync. audit-sw.js continues to own audit-specific
 * data routes.
 *
 * Caching strategies:
 *   - Static assets (JS, CSS, images, fonts) → cache-first
 *   - API calls (/api/*)                      → network-first with cache fallback
 *   - App shell pages                         → stale-while-revalidate
 *   - Everything else                         → network-first
 *
 * Storage quota: capped at 50 MB.
 */

const SW_VERSION = 'v1';
const SHELL_CACHE   = `carbonledger-shell-${SW_VERSION}`;
const STATIC_CACHE  = `carbonledger-assets-${SW_VERSION}`;
const API_CACHE     = `carbonledger-api-${SW_VERSION}`;

/** Maximum total storage consumed by this SW (50 MB). */
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

/** App-shell pages to precache on install. */
const APP_SHELL_PAGES = [
  '/',
  '/marketplace',
  '/projects',
  '/audit',
  '/dashboard',
  '/offline',
];

/** Key API endpoints to warm-up when the connection returns. */
const BACKGROUND_SYNC_URLS = [
  '/api/v1/public/stats',
  '/api/v1/public/projects?limit=20',
  '/api/v1/marketplace/listings?limit=20',
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // Precache pages; ignore individual failures so the install never
        // aborts if a page isn't pre-rendered yet (e.g., in dev mode).
        Promise.allSettled(APP_SHELL_PAGES.map((url) => cache.add(url)))
      )
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  const validCaches = new Set([SHELL_CACHE, STATIC_CACHE, API_CACHE]);

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Delete any cache belonging to THIS service worker that is now
            // outdated (different version tag). Leave audit-sw caches alone.
            .filter(
              (k) =>
                (k.startsWith('carbonledger-shell-') ||
                  k.startsWith('carbonledger-assets-') ||
                  k.startsWith('carbonledger-api-')) &&
                !validCaches.has(k)
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

  // Only handle GET requests over http(s) on our own origin.
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;

  const { pathname } = url;

  if (isStaticAsset(pathname)) {
    // JS, CSS, fonts, images — cache-first, very long-lived
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (pathname.startsWith('/api/')) {
    // API calls — network-first so data stays fresh; fall back to cache
    event.respondWith(networkFirst(request, API_CACHE));
  } else {
    // App pages — stale-while-revalidate so navigation is instant
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

// ─── Caching strategies ───────────────────────────────────────────────────────

/**
 * Cache-first: return cached response immediately; only hit the network
 * if the asset is not cached yet.
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
    return buildOfflineFallback(request);
  }
}

/**
 * Network-first: try the network, update the cache on success, fall back to
 * the cache (or the offline page) if the network is unreachable.
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
    return buildOfflineFallback(request);
  }
}

/**
 * Stale-while-revalidate: return the cached version immediately (if any),
 * then fetch a fresh copy in the background and update the cache.
 * Falls through to the network if there is no cached version yet.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Background revalidation (fire-and-forget when we already have a cache hit)
  const revalidate = fetch(request.clone())
    .then(async (response) => {
      if (response.ok) {
        await enforceCacheQuota(cache);
        await cache.put(request, response.clone());
        broadcastMessage({ type: 'CACHE_UPDATED', url: request.url });
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Serve stale immediately; let revalidation run in background.
    revalidate.catch(() => {});
    return cached;
  }

  // Nothing in cache — must wait for the network.
  const fresh = await revalidate;
  if (fresh) return fresh;

  // Both cache and network failed — show offline page.
  const offlinePage = await caches.match('/offline');
  if (offlinePage) return offlinePage;
  return buildOfflineFallback(request);
}

// ─── Quota management ────────────────────────────────────────────────────────

/**
 * Evict the oldest 20% of entries from the given cache when the
 * StorageManager estimates total usage exceeds MAX_CACHE_BYTES.
 */
async function enforceCacheQuota(cache) {
  try {
    const estimate = await navigator.storage.estimate();
    const used = estimate.usage ?? 0;
    if (used < MAX_CACHE_BYTES) return;

    const keys = await cache.keys();
    const evictCount = Math.max(1, Math.floor(keys.length * 0.2));
    for (let i = 0; i < evictCount; i++) {
      await cache.delete(keys[i]);
    }
  } catch {
    // navigator.storage.estimate() may not be available in all browsers — skip.
  }
}

// ─── Background sync (online event) ──────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'carbonledger-sync') {
    event.waitUntil(runBackgroundSync());
  }
});

// Also trigger when the SW itself detects the connection returning.
self.addEventListener('online', () => {
  runBackgroundSync().catch(() => {});
});

async function runBackgroundSync() {
  broadcastMessage({ type: 'SYNC_START', timestamp: Date.now() });

  const apiCache = await caches.open(API_CACHE);
  const results = await Promise.allSettled(
    BACKGROUND_SYNC_URLS.map(async (path) => {
      const url = `${self.location.origin}${path}`;
      const response = await fetch(url);
      if (response.ok) {
        await apiCache.put(url, response.clone());
      }
      return path;
    })
  );

  const failed = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason);

  if (failed.length === 0) {
    broadcastMessage({ type: 'SYNC_COMPLETE', timestamp: Date.now() });
  } else {
    broadcastMessage({
      type: 'SYNC_PARTIAL',
      timestamp: Date.now(),
      failedCount: failed.length,
    });
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
      getCacheSize().then((bytes) => {
        event.source?.postMessage({ type: 'CACHE_SIZE', bytes });
      });
      break;

    case 'TRIGGER_SYNC':
      runBackgroundSync().catch(() => {});
      break;

    case 'CLEAR_CACHE':
      Promise.all([
        caches.delete(SHELL_CACHE),
        caches.delete(STATIC_CACHE),
        caches.delete(API_CACHE),
      ]).then(() => {
        event.source?.postMessage({ type: 'CACHE_CLEARED' });
      });
      break;
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isStaticAsset(pathname) {
  return /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot|ico)$/.test(
    pathname
  );
}

/**
 * Build a minimal offline fallback response.
 * For navigation requests (HTML pages) we redirect to /offline;
 * for API/data requests we return a JSON error body.
 */
function buildOfflineFallback(request) {
  const acceptsHtml =
    request.headers.get('Accept')?.includes('text/html') ?? false;

  if (acceptsHtml) {
    // Return the cached /offline page if we have it, else a bare HTML stub.
    return caches.match('/offline').then(
      (cached) =>
        cached ||
        new Response(
          `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>Offline — CarbonLedger</title></head>
  <body>
    <h1>🌿 You're offline</h1>
    <p>Please check your connection and try again.</p>
  </body>
</html>`,
          { status: 503, headers: { 'Content-Type': 'text/html' } }
        )
    );
  }

  return Promise.resolve(
    new Response(
      JSON.stringify({ offline: true, message: 'You are offline.' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'X-Offline': 'true',
        },
      }
    )
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

function broadcastMessage(message) {
  self.clients
    .matchAll({ includeUncontrolled: true, type: 'window' })
    .then((clients) => clients.forEach((client) => client.postMessage(message)));
}
