"use client";

/**
 * ServiceWorkerRegistration
 *
 * Registers the CarbonLedger audit service worker on first mount.
 * Renders nothing — side-effect only.
 *
 * Placed in the root layout so the SW is available across all pages,
 * but audit caching only activates for routes matching the SW's patterns.
 */

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          "/audit-sw.js",
          { scope: "/" }
        );

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New SW is ready — ask it to activate immediately
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        // Tell a waiting SW to activate now (handles page refresh case)
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      } catch (err) {
        // SW registration failure is non-fatal — app works without it
        console.warn("[SW] Registration failed:", err);
      }
    };

    // Defer registration until after the page is interactive
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
