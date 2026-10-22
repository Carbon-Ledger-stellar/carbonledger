/**
 * Pure helper functions for SerialRangeBar — no React, no API imports.
 * These are extracted here so they can be unit-tested in isolation without
 * triggering the api.ts import chain (which requires a working Babel config
 * for @stellar/stellar-sdk generics).
 */

import { SerialRangeSegment, SerialSegmentStatus } from "./serial-range-segments";

// ─── Status definitions ───────────────────────────────────────────────────────

export interface StatusDef {
  /** Human-readable label shown in the legend and tooltips. */
  label: string;
  /** Solid base color (hex). */
  color: string;
}

/**
 * Palette chosen to be perceptually distinct for common color-vision
 * deficiencies (deuteranopia, protanopia):
 *   active  → green  (brand color)
 *   retired → slate  (neutral / spent)
 *   listed  → amber  (marketplace activity)
 *   escrow  → violet (held / locked)
 */
export const STATUS_DEFS: Record<SerialSegmentStatus, StatusDef> = {
  active:  { label: "Active",  color: "#16a34a" },
  retired: { label: "Retired", color: "#475569" },
  listed:  { label: "Listed",  color: "#d97706" },
  escrow:  { label: "Escrow",  color: "#7c3aed" },
};

// ─── Tooltip content ──────────────────────────────────────────────────────────

/**
 * Builds the multi-line tooltip string shown on hover (and as the native
 * `title` attribute fallback).  Satisfies AC#2 — hover shows exact serial ranges.
 */
export function segmentTooltip(segment: SerialRangeSegment): string {
  const creditWord = segment.amount === 1 ? "credit" : "credits";
  const lines = [
    `Status: ${STATUS_DEFS[segment.status].label}`,
    `Serials: ${segment.serialStart} – ${segment.serialEnd}`,
    `Amount: ${segment.amount.toLocaleString()} ${creditWord}`,
  ];
  if (segment.status === "retired") {
    if (segment.retirementId)   lines.push(`Retirement ID: ${segment.retirementId}`);
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

// ─── Accessible aria-label per segment ───────────────────────────────────────

/**
 * Builds the `aria-label` string for an individual segment listitem.
 * Satisfies AC#3 — accessible text alternative (per-segment label).
 */
export function segmentAriaLabel(segment: SerialRangeSegment): string {
  const range    = `serials ${segment.serialStart} to ${segment.serialEnd}`;
  const creditWord = segment.amount === 1 ? "credit" : "credits";
  const amount   = `${segment.amount.toLocaleString()} ${creditWord}`;

  switch (segment.status) {
    case "retired":
      return [
        `Retired, ${amount}, ${range}`,
        segment.retirementId ? `retirement ID ${segment.retirementId}` : "",
        segment.beneficiary  ? `beneficiary ${segment.beneficiary}`    : "",
      ].filter(Boolean).join(", ");
    case "listed":
      return `Listed for sale, ${amount}, ${range}`;
    case "escrow":
      return `In escrow, ${amount}, ${range}`;
    default:
      return `Active, ${amount}, ${range}`;
  }
}

// ─── Prose summary for screen readers ────────────────────────────────────────

/**
 * Builds a single-sentence summary of the whole batch bar.
 * Linked via `aria-describedby` on the bar element.
 * Satisfies AC#3 — accessible text alternative (full-bar summary).
 */
export function buildAccessibleSummary(segments: SerialRangeSegment[]): string {
  const totals: Record<SerialSegmentStatus, number> = {
    active: 0, retired: 0, listed: 0, escrow: 0,
  };
  for (const s of segments) totals[s.status] += s.amount;

  const parts = (Object.entries(totals) as [SerialSegmentStatus, number][])
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n.toLocaleString()} ${STATUS_DEFS[status].label.toLowerCase()}`);

  if (parts.length === 0) return "No serial range data.";
  return `Serial range breakdown: ${parts.join(", ")}.`;
}
