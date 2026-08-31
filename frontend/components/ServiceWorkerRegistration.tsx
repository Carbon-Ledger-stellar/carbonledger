"use client";

/**
 * ServiceWorkerRegistration
 *
 * Registers both CarbonLedger service workers on first mount:
 *
 *   1. /sw.js          — primary SW: app shell, general asset caching,
 *                        background sync (all routes)
 *   2. /audit-sw.js    — secondary SW: audit-specific data caching and
 *                        stale-while-revalidate for audit API routes
 *
 * Renders nothing — side-effect only.
 * Placed in the root layout so both SWs are available across all pages.
 */

import { useEffect } from "react";
import { startAutoSync } from "../../lib/offline-sync";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // ── Register a single service worker ──────────────────────────────────
    const registerSw = async (path: string, label: string) => {
      try {
        const registration = await navigator.serviceWorker.register(path, {
          scope: "/",
        });

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New SW version is waiting — activate it immediately.
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        // If a SW was already waiting from a previous page load, activate it.
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      } catch (err) {
        // SW registration failure is non-fatal — the app works without it.
        console.warn(`[SW] ${label} registration failed:`, err);
      }
    };

    const registerAll = async () => {
      // Register primary SW first, then the audit-specific SW.
      await registerSw("/sw.js", "Primary SW");
      await registerSw("/audit-sw.js", "Audit SW");
    };

    // Defer registration until the page is fully loaded to avoid
    // competing with critical resource fetches.
    if (document.readyState === "complete") {
      registerAll();
    } else {
      window.addEventListener("load", registerAll, { once: true });
    }

    // Start the auto-sync mechanism for offline draft reports.
    const stopSync = startAutoSync();

    return () => {
      stopSync();
    };
  }, []);

  return null;
}
