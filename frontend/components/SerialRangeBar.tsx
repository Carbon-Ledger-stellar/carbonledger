"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useRetirement } from "../lib/api";
import RetirementCertificate from "./RetirementCertificate";
import {
  groupSegmentsForDisplay,
  segmentWidthPercent,
  SerialRangeSegment,
} from "../lib/serial-range-segments";
import { colors } from "../styles/design-system";

const SEGMENT_COLORS: Record<SerialRangeSegment["status"], string> = {
  retired: "#9ca3af",
  active: colors.primary[600],
  listed: "#f59e0b",
  escrow: "#f59e0b",
};

export interface SerialRangeBarProps {
  batchSerialStart: string;
  batchSerialEnd: string;
  segments: SerialRangeSegment[];
  onRetirementSelect?: (retirementId: string) => void;
}

function segmentAriaLabel(segment: SerialRangeSegment): string {
  const range = `${segment.serialStart} to ${segment.serialEnd}`;
  const amount = `${segment.amount} credit${segment.amount !== 1 ? "s" : ""}`;
  switch (segment.status) {
    case "retired":
      return `Retired segment, ${amount}, serials ${range}${
        segment.retirementId ? `, retirement ${segment.retirementId}` : ""
      }${segment.beneficiary ? `, beneficiary ${segment.beneficiary}` : ""}`;
    case "listed":
      return `Listed segment, ${amount}, serials ${range}`;
    case "escrow":
      return `In escrow segment, ${amount}, serials ${range}`;
    default:
      return `Active segment, ${amount}, serials ${range}`;
  }
}

function segmentTooltip(segment: SerialRangeSegment): string {
  const lines = [
    `Amount: ${segment.amount}`,
    `Serials: ${segment.serialStart} – ${segment.serialEnd}`,
  ];
  if (segment.status === "retired") {
    if (segment.retirementId) lines.push(`Retirement ID: ${segment.retirementId}`);
    if (segment.retirementDate) {
      lines.push(
        `Retired: ${new Date(segment.retirementDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}`,
      );
    }
    if (segment.beneficiary) lines.push(`Beneficiary: ${segment.beneficiary}`);
  }
  if (segment.grouped) lines.push("(Grouped range)");
  return lines.join("\n");
}

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 id="retirement-cert-drawer-title" style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
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
        {!isLoading && !retirement && <p style={{ color: colors.neutral[500] }}>Certificate not found.</p>}
      </div>
    </div>
  );
}

export default function SerialRangeBar({
  batchSerialStart,
  batchSerialEnd,
  segments,
  onRetirementSelect,
}: SerialRangeBarProps) {
  const labelId = useId();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const displaySegments = groupSegmentsForDisplay(segments);
  const totalAmount = displaySegments.reduce((sum, s) => sum + s.amount, 0);

  const openRetirement = useCallback(
    (retirementId: string) => {
      if (onRetirementSelect) onRetirementSelect(retirementId);
      else setDrawerId(retirementId);
    },
    [onRetirementSelect],
  );

  const handleKeyDown = (e: React.KeyboardEvent, index: number, segment: SerialRangeSegment) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 1, displaySegments.length - 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFocusedIndex(i => Math.max(i - 1, 0));
    } else if ((e.key === "Enter" || e.key === " ") && segment.status === "retired" && segment.retirementId) {
      e.preventDefault();
      openRetirement(segment.retirementId);
    }
  };

  if (displaySegments.length === 0) {
    return (
      <p style={{ fontSize: "0.8rem", color: colors.neutral[400], margin: 0 }}>
        No serial range data for this batch.
      </p>
    );
  }

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
        <p id={labelId} style={{ fontSize: "0.75rem", fontWeight: 700, color: colors.neutral[600], margin: 0 }}>
          Serial range
        </p>
        <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: 0, fontFamily: "monospace" }}>
          {batchSerialStart} – {batchSerialEnd}
        </p>
      </div>

      <div
        role="list"
        aria-labelledby={labelId}
        style={{
          display: "flex",
          width: "100%",
          height: "1.25rem",
          borderRadius: "0.375rem",
          overflow: "hidden",
          border: `1px solid ${colors.neutral[200]}`,
        }}
      >
        {displaySegments.map((segment, index) => {
          const width = segmentWidthPercent(segment, totalAmount);
          const isRetired = segment.status === "retired";
          return (
            <div
              key={`${segment.serialStart}-${segment.serialEnd}-${index}`}
              role="listitem"
              tabIndex={index === focusedIndex ? 0 : -1}
              aria-label={segmentAriaLabel(segment)}
              title={segmentTooltip(segment)}
              onKeyDown={e => handleKeyDown(e, index, segment)}
              onFocus={() => setFocusedIndex(index)}
              onClick={() => {
                if (isRetired && segment.retirementId) openRetirement(segment.retirementId);
              }}
              style={{
                width: `${width}%`,
                minWidth: "2px",
                background: SEGMENT_COLORS[segment.status],
                cursor: isRetired && segment.retirementId ? "pointer" : "default",
                outline: index === focusedIndex ? `2px solid ${colors.primary[800]}` : "none",
                outlineOffset: "-1px",
              }}
            />
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        {(["active", "retired", "listed"] as const).map(status => (
          <span
            key={status}
            style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.68rem", color: colors.neutral[500] }}
          >
            <span
              aria-hidden
              style={{
                width: "0.65rem",
                height: "0.65rem",
                borderRadius: "2px",
                background: SEGMENT_COLORS[status === "listed" ? "listed" : status],
              }}
            />
            {status === "active" ? "Active" : status === "retired" ? "Retired" : "Listed / Escrow"}
          </span>
        ))}
      </div>

      {drawerId && <RetirementCertificateDrawer retirementId={drawerId} onClose={() => setDrawerId(null)} />}
    </div>
  );
}
