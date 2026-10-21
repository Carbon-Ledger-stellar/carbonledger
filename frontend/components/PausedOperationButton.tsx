"use client";

/**
 * PausedOperationButton — Issue #1254
 *
 * A wrapper around any operation button (mint / transfer / retire / buy) that:
 *  - Renders the button visually disabled (reduced opacity, not-allowed cursor)
 *    when the contract is paused.
 *  - Shows a tooltip on hover/focus explaining why the button is disabled.
 *  - Includes the specific `pause_reason` in the tooltip when available.
 *  - Links to the /status page in the tooltip for more information.
 *  - Passes through all normal button behaviour when not paused.
 *
 * Works across all operation buttons by accepting `children` — just wrap any
 * existing button or anchor element.
 *
 * Usage:
 *   <PausedOperationButton isPaused={isPaused} pauseReason={reason}>
 *     <button onClick={handleMint}>Mint Credits</button>
 *   </PausedOperationButton>
 */

import React, { useId, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PausedOperationButtonProps {
  /** Whether the contract / marketplace is currently paused. */
  isPaused: boolean;
  /**
   * The reason the pause was initiated, surfaced from the database.
   * Included in the tooltip text when present.
   */
  pauseReason?: string;
  /**
   * URL for the status / incident page.
   * @default "/status"
   */
  statusPageUrl?: string;
  /**
   * The button (or any interactive element) to render.  When paused the child
   * element receives `disabled`, `aria-disabled`, and pointer-events: none.
   */
  children: React.ReactElement;
  /** Optional extra class names for the outer wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Styles (inline — no Tailwind dependency required)
// ---------------------------------------------------------------------------

const WRAPPER_STYLE: React.CSSProperties = {
  display: "inline-block",
  position: "relative",
};

const PAUSED_OVERLAY_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 1,
  cursor: "not-allowed",
};

const TOOLTIP_BASE_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 8px)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 100,
  minWidth: "220px",
  maxWidth: "320px",
  backgroundColor: "#1f2937", // neutral-800
  color: "#f9fafb",            // neutral-50
  borderRadius: "6px",
  padding: "8px 12px",
  fontSize: "0.8125rem",       // 13px
  lineHeight: "1.4",
  boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
  pointerEvents: "auto",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PausedOperationButton({
  isPaused,
  pauseReason,
  statusPageUrl = "/status",
  children,
  className = "",
}: PausedOperationButtonProps): React.ReactElement {
  const tooltipId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // When not paused, render children unchanged.
  if (!isPaused) {
    return children;
  }

  const baseMessage = "Contract is paused — operations blocked.";
  const reasonMessage = pauseReason
    ? ` Reason: ${pauseReason}.`
    : "";

  const show = () => setTooltipVisible(true);
  const hide = () => setTooltipVisible(false);

  // Clone the child element to inject disabled state.
  const disabledChild = React.cloneElement(children, {
    disabled: true,
    "aria-disabled": true,
    "aria-describedby": tooltipId,
    tabIndex: -1,
    style: {
      ...(children.props.style ?? {}),
      opacity: 0.45,
      cursor: "not-allowed",
      pointerEvents: "none" as const,
    },
  });

  return (
    <span
      ref={wrapperRef}
      className={className}
      style={WRAPPER_STYLE}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      // Allow keyboard focus on the wrapper so the tooltip is reachable.
      tabIndex={0}
      aria-label={`${baseMessage}${reasonMessage}`}
    >
      {/* Invisible overlay that blocks pointer events on the child */}
      <span style={PAUSED_OVERLAY_STYLE} aria-hidden="true" />

      {disabledChild}

      {/* Tooltip */}
      <span
        id={tooltipId}
        role="tooltip"
        style={{
          ...TOOLTIP_BASE_STYLE,
          visibility: tooltipVisible ? "visible" : "hidden",
          opacity: tooltipVisible ? 1 : 0,
          transition: "opacity 0.15s ease",
        }}
      >
        <span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>
          ⏸ Contract is paused
        </span>
        <span>Operations are temporarily blocked.</span>
        {pauseReason && (
          <span style={{ display: "block", marginTop: "4px", color: "#d1d5db" }}>
            Reason: {pauseReason}
          </span>
        )}
        <a
          href={statusPageUrl}
          style={{
            display: "inline-block",
            marginTop: "6px",
            color: "#93c5fd", // blue-300
            textDecoration: "underline",
            fontSize: "0.75rem",
          }}
          tabIndex={0}
        >
          View status page →
        </a>
      </span>
    </span>
  );
}

export default PausedOperationButton;
