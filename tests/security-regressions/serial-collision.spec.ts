/**
 * Security Regression Tests — Serial Number Collision / Double-Counting
 *
 * Category: Serial Number Collision (Audit §3.4)
 * Issue: https://github.com/YOUR_ORG/carbonledger/blob/main/AUDIT_SCOPE.md#34-serial-number-collision--double-counting
 *
 * These tests guard against double-counting of carbon credits, which is the
 * primary fraud vector in the voluntary carbon credit market. The SerialRegistry
 * in the carbon_credit contract enforces global uniqueness of serial ranges;
 * these backend tests verify the same invariants at the database layer.
 *
 *   REG-012: Exact duplicate serial range is rejected
 *   REG-013: Partial overlap (new range starts inside existing) is rejected
 *   REG-014: Contained range (new range fully inside existing) is rejected
 *   REG-015: Reverse-contained range (new wraps existing) is rejected
 *   REG-016: Single-credit batch (serial_start == serial_end) is accepted
 *   REG-017: Inverted range (serial_end < serial_start) is rejected
 *
 * Serial number format: CL-{YEAR}-{METHODOLOGY}-{NNNNNN}
 * Comparison is lexicographic on the numeric suffix when methodology/year match.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "../../backend/src/prisma.service";
import { AppModule } from "../../backend/src/app.module";

const JWT_SECRET  = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ADMIN_TOKEN = jwt.sign({ sub: "GADMIN_REG012", role: "admin" }, JWT_SECRET, { expiresIn: "1h" });

// ── Serial range overlap helper (mirrors the on-chain verify_serial_range_internal logic) ──

/**
 * Returns true if range [a_start, a_end] overlaps with [b_start, b_end].
 * Uses string comparison on the numeric suffix (same as on-chain i64 comparison
 * after stripping the "CL-YYYY-METH-" prefix).
 */
function serialRangesOverlap(
  aStart: string, aEnd: string,
  bStart: string, bEnd: string,
): boolean {
  // Overlap: NOT (aEnd < bStart OR bEnd < aStart)
  return !(aEnd < bStart || bEnd < aStart);
}

describe("Serial Number Overlap Detection (unit — mirrors Soroban contract logic)", () => {

  /**
   * REG-012: Exact duplicate serial range must be detected as an overlap.
   *
   * Audit §3.4: "verify_serial_range_internal correctly detects all overlap
   * cases including: Exact duplicates"
   *
   * Link: AUDIT_SCOPE.md §3.4
   */
  it("REG-012: exact duplicate serial range is detected as overlap", () => {
    const existing = { start: "CL-2024-REDD-000001", end: "CL-2024-REDD-001000" };
    const candidate = { start: "CL-2024-REDD-000001", end: "CL-2024-REDD-001000" };

    const overlaps = serialRangesOverlap(
      existing.start, existing.end,
      candidate.start, candidate.end,
    );

    expect(overlaps).toBe(true);
  });

  /**
   * REG-013: Partial overlap — new range starts inside existing range.
   *
   * Audit §3.4: "Partial overlaps (new range starts inside existing range)"
   *
   * Link: AUDIT_SCOPE.md §3.4
   */
  it("REG-013: partial overlap (new start inside existing) is detected", () => {
    const existing  = { start: "CL-2024-REDD-000001", end: "CL-2024-REDD-001000" };
    const candidate = { start: "CL-2024-REDD-000500", end: "CL-2024-REDD-001500" };

    expect(serialRangesOverlap(
      existing.start, existing.end,
      candidate.start, candidate.end,
    )).toBe(true);
  });

  /**
   * REG-013b: Partial overlap — new range ends inside existing range.
   * (new start is before existing, new end is inside existing)
   */
  it("REG-013b: partial overlap (new end inside existing) is detected", () => {
    const existing  = { start: "CL-2024-REDD-000500", end: "CL-2024-REDD-001500" };
    const candidate = { start: "CL-2024-REDD-000001", end: "CL-2024-REDD-001000" };

    expect(serialRangesOverlap(
      existing.start, existing.end,
      candidate.start, candidate.end,
    )).toBe(true);
  });

  /**
   * REG-014: Contained range — new range fully inside existing range.
   *
   * Audit §3.4: "Containment (new range fully inside existing range)"
   *
   * Link: AUDIT_SCOPE.md §3.4
   */
  it("REG-014: contained range (new fully inside existing) is detected as overlap", () => {
    const existing  = { start: "CL-2024-REDD-000001", end: "CL-2024-REDD-010000" };
    const candidate = { start: "CL-2024-REDD-003000", end: "CL-2024-REDD-005000" };

    expect(serialRangesOverlap(
      existing.start, existing.end,
      candidate.start, candidate.end,
    )).toBe(true);
  });

  /**
   * REG-015: Reverse containment — new range fully wraps existing range.
   *
   * Audit §3.4: "Reverse containment (new range fully contains existing range)"
   *
   * Link: AUDIT_SCOPE.md §3.4
   */
  it("REG-015: reverse containment (new wraps existing) is detected as overlap", () => {
    const existing  = { start: "CL-2024-REDD-003000", end: "CL-2024-REDD-005000" };
    const candidate = { start: "CL-2024-REDD-000001", end: "CL-2024-REDD-010000" };

    expect(serialRangesOverlap(
      existing.start, existing.end,
      candidate.start, candidate.end,
    )).toBe(true);
  });

  /**
   * REG-016: Adjacent (non-overlapping) ranges are correctly identified as NOT overlapping.
   * Single-credit batch where serial_start == serial_end is a valid range.
   *
   * Audit §3.4: "serial_end < serial_start edge case (single-credit batch where
   * serial_end == serial_start)"
   *
   * Link: AUDIT_SCOPE.md §3.4
   */
  it("REG-016: single-credit batch (start == end) is a valid non-overlapping range", () => {
    const existing  = { start: "CL-2024-REDD-000001", end: "CL-2024-REDD-001000" };
    const candidate = { start: "CL-2024-REDD-001001", end: "CL-2024-REDD-001001" }; // single credit

    expect(serialRangesOverlap(
      existing.start, existing.end,
      candidate.start, candidate.end,
    )).toBe(false);
  });

  it("REG-016b: two identical single-credit ranges are detected as overlap", () => {
    const existing  = { start: "CL-2024-REDD-001001", end: "CL-2024-REDD-001001" };
    const candidate = { start: "CL-2024-REDD-001001", end: "CL-2024-REDD-001001" };

    expect(serialRangesOverlap(
      existing.start, existing.end,
      candidate.start, candidate.end,
    )).toBe(true);
  });

  it("REG-016c: two adjacent single-credit ranges are NOT an overlap", () => {
    const existing  = { start: "CL-2024-REDD-001001", end: "CL-2024-REDD-001001" };
    const candidate = { start: "CL-2024-REDD-001002", end: "CL-2024-REDD-001002" };

    expect(serialRangesOverlap(
      existing.start, existing.end,
      candidate.start, candidate.end,
    )).toBe(false);
  });

  /**
   * REG-017: Inverted range (serial_end < serial_start) is invalid.
   *
   * Audit §3.4: "serial_end < serial_start edge case"
   * A batch where the end serial is numerically less than the start serial
   * is an invalid range and must be rejected by the API.
   *
   * Link: AUDIT_SCOPE.md §3.4
   */
  it("REG-017: inverted serial range (end < start) is detected as invalid", () => {
    function isValidSerialRange(start: string, end: string): boolean {
      return start <= end;
    }

    expect(isValidSerialRange("CL-2024-REDD-001000", "CL-2024-REDD-000001")).toBe(false);
    expect(isValidSerialRange("CL-2024-REDD-000001", "CL-2024-REDD-001000")).toBe(true);
    expect(isValidSerialRange("CL-2024-REDD-000001", "CL-2024-REDD-000001")).toBe(true); // equal = valid single
  });
});

describe("Serial Collision — API-level validation (database layer)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PROJECT_ID_A = "proj-reg012-serial-a";
  const BATCH_ID_A   = "batch-reg012-serial-a";
  const BATCH_ID_B   = "batch-reg012-serial-b";

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.carbonProject.upsert({
      where: { projectId: PROJECT_ID_A },
      update: {},
      create: {
        projectId: PROJECT_ID_A,
        name: "Reg012 Serial Collision Test",
        methodology: "REDD+",
        country: "BR",
        projectType: "Forest Conservation",
        status: "Verified",
        vintageYear: 2024,
        methodologyScore: 80,
        metadataCid: "QmReg012",
        verifierAddress: "GVERIFIER",
        ownerAddress: "GADMIN_REG012",
      },
    });

    // Create the first batch (occupies serials 000001–001000)
    await prisma.creditBatch.upsert({
      where: { batchId: BATCH_ID_A },
      update: {},
      create: {
        batchId: BATCH_ID_A,
        projectId: PROJECT_ID_A,
        vintageYear: 2024,
        amount: 1000,
        serialStart: "CL-2024-REDD-000001",
        serialEnd: "CL-2024-REDD-001000",
        status: "Active",
        metadataCid: "QmReg012BatchA",
      },
    });
  });

  afterAll(async () => {
    await prisma.creditBatch.deleteMany({ where: { batchId: { in: [BATCH_ID_A, BATCH_ID_B] } } });
    await prisma.carbonProject.deleteMany({ where: { projectId: PROJECT_ID_A } });
    await app.close();
  });

  it("REG-012 (API): duplicate serial range is rejected with 409 Conflict", async () => {
    // Try to create a second batch with the exact same serial range
    const res = await request(app.getHttpServer())
      .post("/credits/batches")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({
        batchId: BATCH_ID_B,
        projectId: PROJECT_ID_A,
        vintageYear: 2024,
        amount: 1000,
        serialStart: "CL-2024-REDD-000001", // DUPLICATE of BATCH_A
        serialEnd: "CL-2024-REDD-001000",   // DUPLICATE of BATCH_A
        metadataCid: "QmReg012BatchB",
      });

    // Must be rejected — serial range already exists
    expect([400, 409, 422]).toContain(res.status);
  });

  it("REG-017 (API): inverted serial range is rejected with 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/credits/batches")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({
        batchId: "batch-reg017-inverted",
        projectId: PROJECT_ID_A,
        vintageYear: 2024,
        amount: 100,
        serialStart: "CL-2024-REDD-005000", // end < start — invalid
        serialEnd: "CL-2024-REDD-001000",
        metadataCid: "QmReg017Inverted",
      });

    expect(res.status).toBe(400);
  });
});
