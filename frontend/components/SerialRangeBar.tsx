"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useRetirement } from "../lib/api";
import RetirementCertificate from "./RetirementCertificate";
import {
  groupSegmentsForDisplay,
  segmentWidthPercent,
  SerialRangeSegment,
  SerialSegmentStatus,
} from "../lib/serial-range-segments";
import {
  buildAccessibleSummary,
  segmentAriaLabel,
  segmentTooltip,
  STATUS_DEFS,
} from "../lib/serial-range-bar-helpers";
import { colors } from "../styles/design-system";

// Re-export pure helpers so consumers (and tests) can import from here.
export { buildAccessibleSummary, segmentAriaLabel, segmentTooltip, STATUS_DEFS };

// ─── SVG pattern definitions (colorblind-safe hatching) ──────────────────────
//
// Each segment swatch uses both a solid color AND a pattern overlay so that
// status is conveyed by two independent channels (color + texture).

const PATTERN_DEFS_SVG = `
  <pattern id="srb-active" width="6" height="6" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="#16a34a"/>
  </pattern>
  <pattern id="srb-retired" width="6" height="6" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="#475569"/>
    <line x1="0" y1="6" x2="6" y2="0" stroke="#94a3b8" stroke-width="1.5"/>
  </pattern>
  <pattern id="srb-listed" width="6" height="6" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="#d97706"/>
    <line x1="0" y1="0" x2="0" y2="6" stroke="#fbbf24" stroke-width="1.5"/>
  </pattern>
  <pattern id="srb-escrow" width="6" height="6" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="#7c3aed"/>
    <rect x="0" y="0" width="3" height="3" fill="#a78bfa" opacity="0.5"/>
    <rect x="3" y="3" width="3" height="3" fill="#a78bfa" opacity="0.5"/>
  </pattern>
`;

// ─── Inline SVG pattern defs (rendered once per bar instance) ────────────────

function PatternDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", overflow: "hidden" }}
    >
      <defs dangerouslySetInnerHTML={{ __html: PATTERN_DEFS_SVG }} />
    </svg>
  );
}

// ─── Floating tooltip state ───────────────────────────────────────────────────

interface TooltipState {
  segment: SerialRangeSegment;
  x: number;
  y: number;
}

// ─── Retirement certificate drawer ───────────────────────────────────────────

function RetirementCertificateDrawer({
  retirementId,
  onClose,
}: {
  retirementId: string;
  onClose: () => void;
}) {
  const { data: retirement, isLoading } = useRetirement(retirementId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="retirement-cert-drawer-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end",
        background: "rgba(15, 23, 42, 0.45)",
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(960px, 100vw)",
          height: "100%",
          overflowY: "auto",
          background: colors.surface,
          boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2
            id="retirement-cert-drawer-title"
            style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}
          >
            Retirement Certificate
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: `1px solid ${colors.neutral[300]}`,
              background: colors.neutral[50],
              borderRadius: "0.375rem",
              padding: "0.35rem 0.75rem",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Close
          </button>
        </div>
        {isLoading && <p style={{ color: colors.neutral[500] }}>Loading certificate…</p>}
        {!isLoading && retirement && <RetirementCertificate retirement={retirement} />}
        {!isLoading && !retirement && (
          <p style={{ color: colors.neutral[500] }}>Certificate not found.</p>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface SerialRangeBarProps {
  batchSerialStart: string;
  batchSerialEnd: string;
  segments: SerialRangeSegment[];
  onRetirementSelect?: (retirementId: string) => void;
}

export default function SerialRangeBar({
  batchSerialStart,
  batchSerialEnd,
  segments,
  onRetirementSelect,
}: SerialRangeBarProps) {
  const labelId   = useId();
  const summaryId = useId();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const displaySegments = groupSegmentsForDisplay(segments);
  const totalAmount = displaySegments.reduce((sum, s) => sum + s.amount, 0);

  // Dynamic legend — only show statuses actually present.
  const presentStatuses = Array.from(new Set(displaySegments.map(s => s.status))) as SerialSegmentStatus[];
  const legendStatuses = (["active", "retired", "listed", "escrow"] as const).filter(s =>
    presentStatuses.includes(s),
  );

  const openRetirement = useCallback(
    (retirementId: string) => {
      if (onRetirementSelect) onRetirementSelect(retirementId);
      else setDrawerId(retirementId);
    },
    [onRetirementSelect],
  );

  const handleKeyDown = (
    e: React.KeyboardEvent,
    index: number,
    segment: SerialRangeSegment,
  ) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 1, displaySegments.length - 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFocusedIndex(i => Math.max(i - 1, 0));
    } else if (
      (e.key === "Enter" || e.key === " ") &&
      segment.status === "retired" &&
      segment.retirementId
    ) {
      e.preventDefault();
      openRetirement(segment.retirementId);
    }
  };

  const handleMouseMove = (e: React.MouseEvent, segment: SerialRangeSegment) => {
    setTooltip({ segment, x: e.clientX, y: e.clientY });
  };

  const handleMouseLeave = () => setTooltip(null);

  if (displaySegments.length === 0) {
    return (
      <p style={{ fontSize: "0.8rem", color: colors.neutral[400], margin: 0 }}>
        No serial range data for this batch.
      </p>
    );
  }

  const accessibleSummary = buildAccessibleSummary(displaySegments);

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      {/* Hidden SVG pattern defs — rendered once per instance */}
      <PatternDefs />

      {/* ── Header row ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
        <p
          id={labelId}
          style={{ fontSize: "0.75rem", fontWeight: 700, color: colors.neutral[600], margin: 0 }}
        >
          Serial range
        </p>
        <p
          style={{
            fontSize: "0.7rem",
            color: colors.neutral[400],
            margin: 0,
            fontFamily: "monospace",
          }}
        >
          {batchSerialStart} – {batchSerialEnd}
        </p>
      </div>

      {/* ── Visually hidden accessible summary (screen-reader alternative) */}
      <p
        id={summaryId}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {accessibleSummary}
      </p>

      {/* ── Bar ──────────────────────────────────────────────────────── */}
      <div
        ref={barRef}
        role="list"
        aria-labelledby={labelId}
        aria-describedby={summaryId}
        style={{
          display: "flex",
          width: "100%",
          height: "1.375rem",
          borderRadius: "0.375rem",
          overflow: "hidden",
          border: `1px solid ${colors.neutral[200]}`,
          position: "relative",
        }}
      >
        {displaySegments.map((segment, index) => {
          const width = segmentWidthPercent(segment, totalAmount);
          const def = STATUS_DEFS[segment.status];
          const isClickable = segment.status === "retired" && !!segment.retirementId;

          return (
            <div
              key={`${segment.serialStart}-${segment.serialEnd}-${index}`}
              role="listitem"
              tabIndex={index === focusedIndex ? 0 : -1}
              aria-label={segmentAriaLabel(segment)}
              title={segmentTooltip(segment)}
              onKeyDown={e => handleKeyDown(e, index, segment)}
              onFocus={() => setFocusedIndex(index)}
              onMouseMove={e => handleMouseMove(e, segment)}
              onMouseLeave={handleMouseLeave}
              onClick={() => {
                if (isClickable) openRetirement(segment.retirementId!);
              }}
              style={{
                width: `${width}%`,
                minWidth: "2px",
                background: def.color,
                cursor: isClickable ? "pointer" : "default",
                outline:
                  index === focusedIndex
                    ? `2px solid ${colors.primary[800]}`
                    : "none",
                outlineOffset: "-1px",
                transition: "filter 0.1s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.15)";
              }}
              onMouseOut={e => {
                (e.currentTarget as HTMLDivElement).style.filter = "";
              }}
            />
          );
        })}
      </div>

      {/* ── Legend ──────────────────────────────────────────────────── */}
      <div
        role="list"
        aria-label="Serial range legend"
        style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", flexWrap: "wrap" }}
      >
        {legendStatuses.map(status => {
          const def = STATUS_DEFS[status];
          return (
            <span
              key={status}
              role="listitem"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.68rem",
                color: colors.neutral[600],
              }}
            >
              {/* Swatch — solid color + inline pattern overlay */}
              <svg
                aria-hidden="true"
                focusable="false"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                style={{ borderRadius: "2px", flexShrink: 0 }}
              >
                <rect width="12" height="12" fill={def.color} rx="2" />
                {status === "retired" && (
                  <line x1="0" y1="12" x2="12" y2="0" stroke="#94a3b8" strokeWidth="2" />
                )}
                {status === "listed" && (
                  <line x1="4" y1="0" x2="4" y2="12" stroke="#fbbf24" strokeWidth="2" />
                )}
                {status === "escrow" && (
                  <>
                    <rect x="0" y="0" width="6" height="6" fill="#a78bfa" opacity="0.5" />
                    <rect x="6" y="6" width="6" height="6" fill="#a78bfa" opacity="0.5" />
                  </>
                )}
              </svg>
              <span>{def.label}</span>
            </span>
          );
        })}
      </div>

      {/* ── Styled floating tooltip ───────────────────────────────────── */}
      {tooltip && (
        <div
          aria-hidden="true"
          role="presentation"
          style={{
            position: "fixed",
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            zIndex: 9999,
            background: colors.neutral[900] ?? "#1e293b",
            color: "#f8fafc",
            fontSize: "0.72rem",
            lineHeight: 1.6,
            padding: "0.45rem 0.65rem",
            borderRadius: "0.35rem",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            whiteSpace: "pre",
            pointerEvents: "none",
            maxWidth: "260px",
          }}
        >
          {segmentTooltip(tooltip.segment)}
        </div>
      )}

      {/* ── Certificate drawer ─────────────────────────────────────────── */}
      {drawerId && (
        <RetirementCertificateDrawer retirementId={drawerId} onClose={() => setDrawerId(null)} />
      )}
    </div>
  );
}
