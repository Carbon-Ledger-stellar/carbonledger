## Summary

Design PWA Offline Caching and Verification Report Synchronization (Closes #894)

### Changes

#### PWA Configuration (Acceptance Criterion 1 — offline navigability)
- **`public/manifest.json`** — New web app manifest enabling PWA installability (standalone display, theme color, icons)
- **`app/layout.tsx`** — Added `<link rel="manifest">`, `<meta name="theme-color">`, apple-touch-icon, and favicon links
- **`public/icons/icon-192.svg`**, **`public/icons/icon-512.svg`** — PWA icons (Carbon Ledger branding)
- **`public/audit-sw.js`** — Service worker v2:
  - Pre-caches all shell routes (/, /audit, /verifier/*, /dashboard, /marketplace, /projects, manifest, icons)
  - Navigation requests: **network-first with app-shell fallback** — any route works offline (client hydrates with cached SWR/IndexedDB data)
  - General API routes (`/api/v1`, `/api/v2`) now cached stale-while-revalidate alongside audit patterns
  - Custom offline fallback page when no cached shell exists

#### Offline Sync Queue (Acceptance Criterion 2 — offline report persistence)
- **`lib/offline-sync.ts`** — Standalone IndexedDB-backed queue service:
  - `enqueue(endpoint, method, body)` — Save a report to IndexedDB when offline
  - `flushQueue()` — Submit all pending entries in FIFO order
  - `dequeue(id)` / `clearQueue()` / `getPendingEntries()` / `getPendingCount()` — Queue management
  - Automatic retry (up to 5 attempts) with dead-letter queue for exhausted entries
  - `subscribe(listener)` — Reactive state notifications
  - `initOfflineSync()` — Binds to `carbonledger:online` and native `online` events for auto-flush
- **`hooks/useOfflineSync.ts`** — React hook wrapping the queue service (pendingCount, isFlushing, syncNow, enqueue, dequeue, getPending)

#### Auto-Sync on Reconnection (Acceptance Criterion 3 — background flush)
- **`app/verifier/apply/page.tsx`** — Integrated offline resilience:
  - Network errors during form submission trigger offline queue save
  - Offline banner shown when disconnected
  - "Queued" success state with pending count and "Sync Now" button
  - Auto-flush when `carbonledger:online` / native `online` event fires
  - Double-submit guard via `useRef`

#### Tests
- **`__tests__/offline-sync.test.ts`** — 8 unit tests covering enqueue, flushQueue (success + retry), subscribe, getPendingEntries, dequeue, and clearQueue