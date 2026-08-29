import {
  buildBatchSerialSegments,
  groupSegmentsForDisplay,
  segmentWidthPercent,
  serialToIndex,
} from "../lib/serial-range-segments";

describe("serialToIndex", () => {
  it("parses trailing digits from serial strings", () => {
    expect(serialToIndex("batch-001-00042")).toBe(42n);
    expect(serialToIndex("1042")).toBe(1042n);
  });
});

describe("buildBatchSerialSegments", () => {
  const batchStart = "BATCH-0001";
  const batchEnd = "BATCH-0100";

  it("returns full active range when no retirements", () => {
    const segments = buildBatchSerialSegments(batchStart, batchEnd);
    expect(segments).toHaveLength(1);
    expect(segments[0].status).toBe("active");
    expect(segments[0].amount).toBe(100);
  });

  it("marks a single retirement consuming the full batch", () => {
    const segments = buildBatchSerialSegments(batchStart, batchEnd, [
      {
        serialStart: batchStart,
        serialEnd: batchEnd,
        amount: 100,
        retirementId: "ret-1",
        beneficiary: "Acme Corp",
      },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].status).toBe("retired");
  });

  it("splits active and retired portions for partial retirement", () => {
    const segments = buildBatchSerialSegments(batchStart, batchEnd, [
      { serialStart: "BATCH-0001", serialEnd: "BATCH-0040", amount: 40, retirementId: "ret-partial" },
    ]);
    expect(segments.map(s => s.status)).toEqual(["retired", "active"]);
  });

  it("inserts listed segments", () => {
    const segments = buildBatchSerialSegments(
      batchStart,
      batchEnd,
      [],
      [{ serialStart: "BATCH-0020", serialEnd: "BATCH-0030", amount: 11 }],
    );
    expect(segments.some(s => s.status === "listed")).toBe(true);
  });

  it("handles fragmented retirements", () => {
    const segments = buildBatchSerialSegments(batchStart, batchEnd, [
      { serialStart: "BATCH-0005", serialEnd: "BATCH-0010", amount: 6, retirementId: "r1" },
      { serialStart: "BATCH-0050", serialEnd: "BATCH-0055", amount: 6, retirementId: "r2" },
    ]);
    expect(segments.filter(s => s.status === "retired")).toHaveLength(2);
  });
});

describe("groupSegmentsForDisplay", () => {
  it("groups many small segments below the render threshold", () => {
    const tiny = Array.from({ length: 120 }, (_, i) => ({
      status: "retired" as const,
      serialStart: `S-${i}`,
      serialEnd: `S-${i}`,
      amount: 1,
      retirementId: `ret-${i}`,
    }));
    const grouped = groupSegmentsForDisplay(tiny, 80);
    expect(grouped.length).toBeLessThanOrEqual(80);
  });
});

describe("segmentWidthPercent", () => {
  it("returns proportional width with a minimum visible size", () => {
    expect(segmentWidthPercent({ status: "active", serialStart: "a", serialEnd: "b", amount: 50 }, 100)).toBe(50);
  });
});
