"use client";

/**
 * Offline fallback page
 *
 * Displayed by the service worker when the user navigates to an app-shell
 * page but the network is unavailable and no cached copy exists yet.
 *
 * Shows a friendly message, a summary of what data is available offline,
 * and a button to retry the connection.
 */

import { useEffect, useState, useCallback } from "react";

interface CacheStats {
  /** Approximate number of projects available in the cache. */
  projects: number;
  /** Approximate number of marketplace listings available in the cache. */
  credits: number;
  /** Whether the summary has been loaded. */
  loaded: boolean;
}

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats>({
    projects: 0,
    credits: 0,
    loaded: false,
  });

  // ── Detect connectivity ──────────────────────────────────────────────────

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ── Load cache statistics ─────────────────────────────────────────────────

  useEffect(() => {
    async function loadCacheStats() {
      if (!("caches" in window)) {
        setCacheStats({ projects: 0, credits: 0, loaded: true });
        return;
      }

      try {
        const cacheNames = await caches.keys();
        let projects = 0;
        let credits = 0;

        for (const name of cacheNames) {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          for (const req of keys) {
            const url = new URL(req.url);
            if (url.pathname.includes("/projects")) projects++;
            if (
              url.pathname.includes("/marketplace") ||
              url.pathname.includes("/credits")
            )
              credits++;
          }
        }

        setCacheStats({ projects, credits, loaded: true });
      } catch {
        setCacheStats({ projects: 0, credits: 0, loaded: true });
      }
    }

    loadCacheStats();
  }, []);

  // ── Retry handler ────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    window.location.reload();
  }, []);

  // ── Navigate home when back online ───────────────────────────────────────

  useEffect(() => {
    if (isOnline) {
      const timer = setTimeout(() => {
        window.location.href = "/";
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isOnline]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main
      className="offline-page"
      role="main"
      aria-labelledby="offline-heading"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        textAlign: "center",
        gap: "1.5rem",
        maxWidth: "480px",
        margin: "0 auto",
      }}
    >
      {/* Icon */}
      <div
        aria-hidden="true"
        style={{ fontSize: "4rem", lineHeight: 1 }}
      >
        🌿
      </div>

      {/* Heading */}
      <h1
        id="offline-heading"
        style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}
      >
        {isOnline ? "Back online!" : "You're offline"}
      </h1>

      {/* Sub-message */}
      <p
        aria-live="polite"
        style={{ fontSize: "1rem", opacity: 0.75, margin: 0 }}
      >
        {isOnline
          ? "Connection restored — taking you back now…"
          : "No internet connection detected. Some cached data is still available below."}
      </p>

      {/* Cached data summary */}
      {!isOnline && cacheStats.loaded && (
        <section
          aria-label="Cached data available offline"
          style={{
            border: "1px solid rgba(5, 150, 105, 0.3)",
            borderRadius: "0.75rem",
            padding: "1rem 1.5rem",
            width: "100%",
            background: "rgba(5, 150, 105, 0.06)",
          }}
        >
          <h2
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.75rem",
              color: "#059669",
            }}
          >
            Available offline
          </h2>
          <ul
            role="list"
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <CacheStatRow
              emoji="🌍"
              label="Carbon projects"
              count={cacheStats.projects}
              unit="cached"
            />
            <CacheStatRow
              emoji="🏷️"
              label="Credit listings"
              count={cacheStats.credits}
              unit="cached"
            />
          </ul>
          {cacheStats.projects === 0 && cacheStats.credits === 0 && (
            <p
              style={{
                fontSize: "0.8rem",
                opacity: 0.6,
                marginTop: "0.5rem",
                marginBottom: 0,
              }}
            >
              Visit the app while online to cache data for offline use.
            </p>
          )}
        </section>
      )}

      {/* Retry button */}
      {!isOnline && (
        <button
          type="button"
          onClick={handleRetry}
          aria-label="Retry connection"
          style={{
            padding: "0.75rem 2rem",
            borderRadius: "0.5rem",
            border: "none",
            background: "#059669",
            color: "#fff",
            fontWeight: 600,
            fontSize: "1rem",
            cursor: "pointer",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) =>
            ((e.target as HTMLButtonElement).style.background = "#047857")
          }
          onMouseLeave={(e) =>
            ((e.target as HTMLButtonElement).style.background = "#059669")
          }
        >
          🔄 Try again
        </button>
      )}

      {/* Tip */}
      {!isOnline && (
        <p style={{ fontSize: "0.75rem", opacity: 0.5, margin: 0 }}>
          Cached audit data and read-only pages remain accessible while
          offline.
        </p>
      )}
    </main>
  );
}

// ─── Helper component ─────────────────────────────────────────────────────────

interface CacheStatRowProps {
  emoji: string;
  label: string;
  count: number;
  unit: string;
}

function CacheStatRow({ emoji, label, count, unit }: CacheStatRowProps) {
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "0.9rem",
      }}
    >
      <span>
        <span aria-hidden="true">{emoji}</span> {label}
      </span>
      <span
        style={{
          fontWeight: 600,
          color: count > 0 ? "#059669" : "inherit",
          opacity: count === 0 ? 0.5 : 1,
        }}
        aria-label={`${count} ${unit}`}
      >
        {count > 0 ? `${count} ${unit}` : "—"}
      </span>
    </li>
  );
}
