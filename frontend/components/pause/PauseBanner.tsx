"use client";

/**
 * PauseBanner – Prominent pause status banner (Issue #1174)
 *
 * ## Design Spec
 *
 * ### Layout
 * Full-width sticky banner anchored to the top of every page when the contract
 * is in a paused state. Uses `role="alert"` + `aria-live="assertive"` so
 * screen-reader users are immediately informed without needing to interact.
 *
 * ### Color & Contrast (WCAG 2.2 AA)
 * | Mode  | Background            | Foreground       | Contrast ratio |
 * |-------|-----------------------|------------------|----------------|
 * | Light | rose-700 (#be123c)    | white (#ffffff)  | 6.4:1 ✓        |
 * | Dark  | rose-950 (#4c0519)    | white (#ffffff)  | 15.2:1 ✓       |
 * | Badge | white/20 (translucent)| white (#ffffff)  | 4.6:1 ✓        |
 *
 * Focus ring: `focus-visible:ring-white` at 2px offset — visible on both
 * the rose background (light) and the dark background.
 *
 * ### Text Hierarchy
 * 1. `EMERGENCY NOTICE` – uppercase badge (xs, semibold) — highest visual priority
 * 2. Status headline – "Contract operations are temporarily paused." (base, medium)
 * 3. Reason text – optional operator-supplied message (sm, regular)
 * 4. Countdown – remaining window duration (sm, medium, muted-rose)
 * 5. Paused-by – Stellar admin address (xs, monospace, muted)
 *
 * ### Icon / Typography Balance
 * Warning icon (24×24 px, stroke) left of copy block; neither overshadows nor
 * undercuts the text. Icon is hidden from accessible tree (`aria-hidden="true"`)
 * since the `role="alert"` region already communicates urgency.
 *
 * ### Responsive
 * - Mobile  (<640 px): single-column stack; action buttons below copy.
 * - Desktop (≥640 px): single row with copy left, buttons right.
 *
 * ### Light / Dark mode
 * - Light: rose-700 background, white text, rose-50 hover.
 * - Dark:  rose-950 background, white text, rose-800 hover.
 *
 * Controlled by Tailwind `dark:` variants which key off the `dark` class on
 * `<html>` (set by `ThemeToggle`).
 *
 * ### Dismissal
 * `isDismissible` (default: true) shows a × button. After dismissal the banner
 * is hidden for the current mount but re-appears on the next page navigation
 * (intentional — the contract is still paused). Persistent dismissal can be
 * wired via the optional `onDismiss` callback.
 */

import React, { useEffect, useRef, useState } from "react";
import { PauseBannerProps } from "./types";

/** Format seconds-until-expiry as "Xh Ym" or "Xm Ys", etc. */
function formatRemaining(pausedUntil: number): string | null {
  const now = Math.floor(Date.now() / 1000);
  const diff = pausedUntil - now;
  if (diff <= 0) return "Pause window expired";
  if (diff >= 3600) {
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${h}h ${m}m remaining`;
  }
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}m ${s}s remaining`;
}

/** Truncate a long Stellar address to "G...XXXXX" for compact display. */
function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-5)}`;
}

export const PauseBanner: React.FC<PauseBannerProps> = ({
  isPaused,
  reason,
  pausedUntil,
  pausedBy,
  onDismiss,
  isDismissible = true,
  onViewDetails,
  className = "",
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [remaining, setRemaining] = useState<string | null>(
    pausedUntil != null ? formatRemaining(pausedUntil) : null
  );

  // Live-update the countdown every 30 seconds.
  useEffect(() => {
    if (!isPaused || pausedUntil == null) return;
    setRemaining(formatRemaining(pausedUntil));
    const id = setInterval(() => setRemaining(formatRemaining(pausedUntil)), 30_000);
    return () => clearInterval(id);
  }, [isPaused, pausedUntil]);

  // Move focus to the banner when it first appears so keyboard users notice it.
  const bannerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (isPaused && !dismissed) {
      bannerRef.current?.focus();
    }
  }, [isPaused, dismissed]);

  if (!isPaused || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    /**
     * `role="alert"` + `aria-live="assertive"` ensures screen readers announce
     * the pause immediately. `aria-atomic="true"` prevents partial reads when
     * the countdown updates.
     */
    <aside
      ref={bannerRef}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      aria-label="Contract paused — operations temporarily halted"
      tabIndex={-1}
      data-testid="pause-banner"
      className={[
        /* ── Base ── */
        "w-full",
        /* ── Light mode ── */
        "bg-rose-700 text-white",
        /* ── Dark mode ── */
        "dark:bg-rose-950 dark:border-b dark:border-rose-800",
        /* ── Spacing / shadow ── */
        "px-4 py-3 shadow-md",
        /* ── Respect reduced motion ── */
        "motion-reduce:transition-none",
        /* ── Focus (for programmatic focus on mount) ── */
        "focus:outline-none",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* ── Left: Icon + copy ── */}
        <div className="flex items-start space-x-3">
          {/* Warning icon — hidden from AT; urgency conveyed by role="alert" */}
          <span
            className="flex-shrink-0 mt-0.5 bg-white/20 p-1.5 rounded-full"
            aria-hidden="true"
          >
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </span>

          {/* ── Text hierarchy ── */}
          <div className="leading-snug space-y-0.5">
            {/* 1. Badge */}
            <span
              className={[
                "inline-block font-semibold tracking-wider uppercase",
                "text-[10px] leading-none",
                "bg-white/20 px-2 py-1 rounded",
                "mr-2",
              ].join(" ")}
            >
              Emergency Notice
            </span>

            {/* 2. Headline */}
            <span className="font-semibold text-sm">
              CarbonLedger contract operations are temporarily paused.
            </span>

            {/* 3. Reason */}
            {reason && (
              <p className="text-sm text-white/90 mt-0.5">
                {reason}
              </p>
            )}

            {/* 4. Countdown */}
            {remaining && (
              <p className="text-xs font-medium text-rose-100 dark:text-rose-200 mt-0.5">
                <span aria-label={`Pause countdown: ${remaining}`}>
                  ⏱ {remaining}
                </span>
              </p>
            )}

            {/* 5. Paused-by */}
            {pausedBy && (
              <p className="text-[11px] text-white/60 font-mono mt-0.5">
                Paused by{" "}
                <span title={pausedBy}>{truncateAddress(pausedBy)}</span>
              </p>
            )}
          </div>
        </div>

        {/* ── Right: Action buttons ── */}
        <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
          {onViewDetails && (
            <button
              type="button"
              onClick={onViewDetails}
              className={[
                "text-xs font-semibold px-3 py-1.5 rounded shadow-sm",
                "transition-colors",
                /* Light */
                "bg-white text-rose-800 hover:bg-rose-50",
                /* Dark */
                "dark:bg-rose-900 dark:text-rose-100 dark:hover:bg-rose-800",
                /* Focus ring — WCAG 2.4.7 */
                "focus-visible:outline-none focus-visible:ring-2",
                "focus-visible:ring-offset-2 focus-visible:ring-white",
                "dark:focus-visible:ring-rose-300",
              ].join(" ")}
            >
              Details
            </button>
          )}

          {isDismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss pause notification"
              className={[
                "p-1.5 rounded-md transition-colors",
                /* Light */
                "text-white/80 hover:text-white hover:bg-white/10",
                /* Dark */
                "dark:hover:bg-white/10",
                /* Focus ring */
                "focus-visible:outline-none focus-visible:ring-2",
                "focus-visible:ring-offset-2 focus-visible:ring-white",
                "dark:focus-visible:ring-rose-300",
              ].join(" ")}
            >
              {/* Close ×  */}
              <svg
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};

export default PauseBanner;
