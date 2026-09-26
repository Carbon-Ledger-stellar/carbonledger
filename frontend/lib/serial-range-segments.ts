/** Visual segment status for serial range bar. */
export type SerialSegmentStatus = "active" | "retired" | "listed" | "escrow";

export interface SerialRangeRetirementInput {
  serialStart: string;
  serialEnd: string;
  amount: number;
  retirementId?: string;
  retirementDate?: string;
  beneficiary?: string;
}

export interface SerialRangeListingInput {
  serialStart: string;
  serialEnd: string;
  amount: number;
}

export interface SerialRangeSegment {
  status: SerialSegmentStatus;
  serialStart: string;
  serialEnd: string;
  amount: number;
  retirementId?: string;
  retirementDate?: string;
  beneficiary?: string;
  grouped?: boolean;
}

export const MAX_RENDER_SEGMENTS = 80;

const STATUS_RANK: Record<SerialSegmentStatus, number> = {
  retired: 3,
  listed: 2,
  escrow: 2,
  active: 1,
};

export function serialToIndex(serial: string): bigint {
  const match = serial.match(/(\d+)\s*$/);
  if (!match) return 0n;
  try {
    return BigInt(match[1]);
  } catch {
    return 0n;
  }
}

function formatSerialFromIndex(batchSerialStart: string, index: bigint): string {
  const match = batchSerialStart.match(/^(.*?)(\d+)$/);
  if (!match) return String(index);
  const [, prefix, digits] = match;
  const width = digits.length;
  const num = index.toString().padStart(width, "0");
  return `${prefix}${num}`;
}

function inclusiveCount(start: bigint, end: bigint): number {
  if (end < start) return 0;
  const diff = end - start;
  if (diff > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(diff) + 1;
}

interface Interval {
  start: bigint;
  end: bigint;
  status: SerialSegmentStatus;
  amount: number;
  retirementId?: string;
  retirementDate?: string;
  beneficiary?: string;
}

function sortIntervals(intervals: Interval[]): Interval[] {
  return [...intervals].sort((a, b) => {
    if (a.start < b.start) return -1;
    if (a.start > b.start) return 1;
    return STATUS_RANK[b.status] - STATUS_RANK[a.status];
  });
}

export function buildBatchSerialSegments(
  batchSerialStart: string,
  batchSerialEnd: string,
  retirements: SerialRangeRetirementInput[] = [],
  listings: SerialRangeListingInput[] = [],
  escrow: SerialRangeListingInput[] = [],
): SerialRangeSegment[] {
  const batchStart = serialToIndex(batchSerialStart);
  const batchEnd = serialToIndex(batchSerialEnd);
  if (batchEnd < batchStart) return [];

  const total = inclusiveCount(batchStart, batchEnd);
  if (total === 0) return [];

  const overrides: Interval[] = [];
  for (const r of retirements) {
    const s = serialToIndex(r.serialStart);
    const e = serialToIndex(r.serialEnd);
    overrides.push({
      start: s < batchStart ? batchStart : s,
      end: e > batchEnd ? batchEnd : e,
      status: "retired",
      amount: r.amount,
      retirementId: r.retirementId,
      retirementDate: r.retirementDate,
      beneficiary: r.beneficiary,
    });
  }
  for (const l of listings) {
    const s = serialToIndex(l.serialStart);
    const e = serialToIndex(l.serialEnd);
    overrides.push({
      start: s < batchStart ? batchStart : s,
      end: e > batchEnd ? batchEnd : e,
      status: "listed",
      amount: l.amount,
    });
  }
  for (const e of escrow) {
    const s = serialToIndex(e.serialStart);
    const end = serialToIndex(e.serialEnd);
    overrides.push({
      start: s < batchStart ? batchStart : s,
      end: end > batchEnd ? batchEnd : end,
      status: "escrow",
      amount: e.amount,
    });
  }

  const sorted = sortIntervals(overrides);
  const segments: SerialRangeSegment[] = [];
  let cursor = batchStart;

  const pushActiveGap = (from: bigint, to: bigint) => {
    if (to < from) return;
    const amount = inclusiveCount(from, to);
    if (amount <= 0) return;
    segments.push({
      status: "active",
      serialStart: formatSerialFromIndex(batchSerialStart, from),
      serialEnd: formatSerialFromIndex(batchSerialStart, to),
      amount,
    });
  };

  for (const interval of sorted) {
    if (interval.end < batchStart || interval.start > batchEnd) continue;
    const start = interval.start < batchStart ? batchStart : interval.start;
    const end = interval.end > batchEnd ? batchEnd : interval.end;
    if (end < cursor) continue;
    if (start > cursor) pushActiveGap(cursor, start - 1n);
    const amount = inclusiveCount(start, end);
    if (amount > 0) {
      segments.push({
        status: interval.status,
        serialStart: formatSerialFromIndex(batchSerialStart, start),
        serialEnd: formatSerialFromIndex(batchSerialStart, end),
        amount: interval.amount > 0 ? interval.amount : amount,
        retirementId: interval.retirementId,
        retirementDate: interval.retirementDate,
        beneficiary: interval.beneficiary,
      });
    }
    cursor = end + 1n;
  }

  if (cursor <= batchEnd) pushActiveGap(cursor, batchEnd);

  if (segments.length === 0 && total > 0) {
    segments.push({
      status: "active",
      serialStart: batchSerialStart,
      serialEnd: batchSerialEnd,
      amount: total,
    });
  }

  return segments;
}

export function groupSegmentsForDisplay(
  segments: SerialRangeSegment[],
  maxSegments: number = MAX_RENDER_SEGMENTS,
): SerialRangeSegment[] {
  if (segments.length <= maxSegments) return segments;

  const merged: SerialRangeSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.status === seg.status &&
      last.retirementId === seg.retirementId &&
      !last.grouped &&
      !seg.grouped
    ) {
      last.serialEnd = seg.serialEnd;
      last.amount += seg.amount;
      last.grouped = true;
      continue;
    }
    merged.push({ ...seg });
  }

  if (merged.length <= maxSegments) {
    return merged.map(s => ({ ...s, grouped: s.grouped ?? merged.length < segments.length }));
  }

  const bucketSize = Math.ceil(merged.length / maxSegments);
  const grouped: SerialRangeSegment[] = [];
  for (let i = 0; i < merged.length; i += bucketSize) {
    const chunk = merged.slice(i, i + bucketSize);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    grouped.push({
      status: first.status,
      serialStart: first.serialStart,
      serialEnd: last.serialEnd,
      amount: chunk.reduce((sum, c) => sum + c.amount, 0),
      retirementId: first.retirementId,
      retirementDate: first.retirementDate,
      beneficiary: first.beneficiary,
      grouped: true,
    });
  }
  return grouped;
}

export function segmentWidthPercent(segment: SerialRangeSegment, totalAmount: number): number {
  if (totalAmount <= 0) return 0;
  return Math.max((segment.amount / totalAmount) * 100, 0.15);
}
