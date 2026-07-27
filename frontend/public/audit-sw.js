/**
 * CarbonLedger Audit Service Worker
 *
 * Strategy:
 *   - Audit API routes → stale-while-revalidate (serve cache, update in background)
 *   - Static assets    → cache-first
 *   - Everything else  → network-first with cache fallback
 *
 * Storage quota: capped at 50 MB per the acceptance criteria.
 */

const SW_VERSION = 'audit-v1';
const AUDIT_CACHE = `carbonledger-audit-${SW_VERSION}`;
const STATIC_CACHE = `carbonledger-static-${SW_VERSION}`;

/** API path prefixes that belong to the audit data plane. */
const AUDIT_API_PATTERNS = [
  '/api/audit',
  '/retirements',
  '/projects',
  '/credits',
  '/stats',
  '/oracle',
  '/marketplace/listings',
];

/** Maximum cache size in bytes (50 MB). */
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll([
          '/',
          '/audit',
        ]).catch(() => {
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
            .filter((k) => k !== AUDIT_CACHE && k !== STATIC_CACHE)
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

  // Only intercept GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension or non-http(s) URLs
  if (!url.protocol.startsWith('http')) return;

  const isAuditApi = AUDIT_API_PATTERNS.some(
    (p) => url.pathname.startsWith(p) || url.href.includes(p)
  );

  if (isAuditApi) {
    event.respondWith(staleWhileRevalidate(request, AUDIT_CACHE));
  } else if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else {
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

function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico)$/.test(pathname);
}

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
