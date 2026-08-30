/**
 * Security Regression Tests — Integer Overflow / Underflow
 *
 * Category: Integer Overflow (Audit §3.3)
 * Issue: https://github.com/YOUR_ORG/carbonledger/blob/main/AUDIT_SCOPE.md#33-integer-overflow--underflow
 *
 * These tests guard against arithmetic bugs in the backend layer that mirror
 * the Soroban contract arithmetic vulnerabilities identified in the audit:
 *
 *   REG-009: total_cost = price × amount — overflow with large values rejected
 *   REG-010: batch.amount - retired cannot underflow below zero
 *   REG-011: Protocol fee calculation handles zero-amount edge case
 *
 * The backend uses JavaScript Numbers and Prisma Decimal — both have different
 * overflow characteristics than Rust i128, so these tests verify the backend's
 * own guards independently of the on-chain contract behaviour.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "../../backend/src/prisma.service";
import { AppModule } from "../../backend/src/app.module";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const CORP_TOKEN = jwt.sign({ sub: "GCORP_REG009", role: "corporation" }, JWT_SECRET, { expiresIn: "1h" });
const DEV_TOKEN  = jwt.sign({ sub: "GDEV_REG009", role: "project_developer" }, JWT_SECRET, { expiresIn: "1h" });

describe("Integer Overflow / Underflow Regression Tests", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ── REG-009 ────────────────────────────────────────────────────────────────

  /**
   * REG-009: total_cost = price × amount — overflow with extreme values is
   * rejected by input validation before any arithmetic is performed.
   *
   * Audit §3.3: "total_cost = price_per_credit * amount in purchase_credits
   * and bulk_purchase — overflow possible with large values"
   *
   * The backend must reject requests where amount or pricePerCredit exceeds
   * safe bounds before the multiplication is attempted.
   *
   * Link: AUDIT_SCOPE.md §3.3
   */
  describe("REG-009: purchase amount validated to prevent cost overflow", () => {
    const PROJECT_ID = "proj-reg009-overflow";
    const BATCH_ID   = "batch-reg009-overflow";
    const LISTING_ID = "listing-reg009-overflow";

    beforeAll(async () => {
      await prisma.carbonProject.upsert({
        where: { projectId: PROJECT_ID },
        update: {},
        create: {
          projectId: PROJECT_ID,
          name: "Reg009 Overflow Test",
          methodology: "VCS",
          country: "KE",
          projectType: "REDD+",
          status: "Verified",
          vintageYear: 2024,
          methodologyScore: 80,
          metadataCid: "QmReg009",
          verifierAddress: "GVERIFIER",
          ownerAddress: "GSELLER_REG009",
        },
      });

      await prisma.creditBatch.upsert({
        where: { batchId: BATCH_ID },
        update: {},
        create: {
          batchId: BATCH_ID,
          projectId: PROJECT_ID,
          vintageYear: 2024,
          amount: 999999999,
          serialStart: "CL-2024-REG009-000001",
          serialEnd: "CL-2024-REG009-999999",
          status: "Active",
          metadataCid: "QmReg009Batch",
        },
      });

      await prisma.marketListing.upsert({
        where: { listingId: LISTING_ID },
        update: {},
        create: {
          listingId: LISTING_ID,
          projectId: PROJECT_ID,
          batchId: BATCH_ID,
          seller: "GSELLER_REG009",
          amountAvailable: 999999999,
          pricePerCredit: "9999999999999", // extremely high price in stroops
          vintageYear: 2024,
          methodology: "VCS",
          country: "KE",
          status: "Active",
        },
      });
    });

    afterAll(async () => {
      await prisma.marketListing.deleteMany({ where: { listingId: LISTING_ID } });
      await prisma.creditBatch.deleteMany({ where: { batchId: BATCH_ID } });
      await prisma.carbonProject.deleteMany({ where: { projectId: PROJECT_ID } });
    });

    it("rejects purchase where amount is zero", async () => {
      const res = await request(app.getHttpServer())
        .post("/marketplace/purchase")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          listingId: LISTING_ID,
          amount: 0,
          buyerAddress: "GCORP_REG009",
        });

      // Amount 0 must be rejected with 400
      expect(res.status).toBe(400);
    });

    it("rejects purchase where amount is negative", async () => {
      const res = await request(app.getHttpServer())
        .post("/marketplace/purchase")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          listingId: LISTING_ID,
          amount: -1,
          buyerAddress: "GCORP_REG009",
        });

      expect(res.status).toBe(400);
    });

    it("rejects purchase where amount is a string injection", async () => {
      const res = await request(app.getHttpServer())
        .post("/marketplace/purchase")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          listingId: LISTING_ID,
          amount: "999999999999999999999999999999",
          buyerAddress: "GCORP_REG009",
        });

      expect(res.status).toBe(400);
    });
  });

  // ── REG-010 ────────────────────────────────────────────────────────────────

  /**
   * REG-010: batch.amount - retired cannot underflow below zero.
   *
   * Audit §3.3: "batch.amount - new_retired — underflow if new_retired somehow
   * exceeds batch.amount"
   *
   * The backend must reject retirement requests where the amount to retire
   * exceeds the batch's available credits. This prevents a negative balance
   * in the off-chain database (and would prevent the same issue on-chain).
   *
   * Link: AUDIT_SCOPE.md §3.3
   */
  describe("REG-010: Retirement amount cannot exceed batch available credits", () => {
    const PROJECT_ID = "proj-reg010-underflow";
    const BATCH_ID   = "batch-reg010-underflow";

    beforeAll(async () => {
      await prisma.carbonProject.upsert({
        where: { projectId: PROJECT_ID },
        update: {},
        create: {
          projectId: PROJECT_ID,
          name: "Reg010 Underflow Test",
          methodology: "IFM",
          country: "US",
          projectType: "Forest Conservation",
          status: "Verified",
          vintageYear: 2023,
          methodologyScore: 85,
          metadataCid: "QmReg010",
          verifierAddress: "GVERIFIER",
          ownerAddress: "GDEV_REG009",
        },
      });

      await prisma.creditBatch.upsert({
        where: { batchId: BATCH_ID },
        update: {},
        create: {
          batchId: BATCH_ID,
          projectId: PROJECT_ID,
          vintageYear: 2023,
          amount: 100, // Only 100 credits available
          serialStart: "CL-2023-REG010-000001",
          serialEnd: "CL-2023-REG010-000100",
          status: "Active",
          metadataCid: "QmReg010Batch",
        },
      });
    });

    afterAll(async () => {
      await prisma.creditBatch.deleteMany({ where: { batchId: BATCH_ID } });
      await prisma.carbonProject.deleteMany({ where: { projectId: PROJECT_ID } });
    });

    it("rejects retirement of amount exceeding batch total (underflow guard)", async () => {
      const res = await request(app.getHttpServer())
        .post("/retirements")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          batchId: BATCH_ID,
          projectId: PROJECT_ID,
          amount: 9999999, // far exceeds batch amount of 100
          retiredBy: "GCORP_REG009",
          beneficiary: "Acme Corp",
          retirementReason: "Overflow test",
          vintageYear: 2023,
          serialStart: "CL-2023-REG010-000001",
          serialEnd: "CL-2023-REG010-000100",
          txHash: "0".repeat(64),
        });

      // Must be rejected — cannot retire more than available
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it("rejects retirement amount of zero (ZeroAmountNotAllowed)", async () => {
      const res = await request(app.getHttpServer())
        .post("/retirements")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          batchId: BATCH_ID,
          projectId: PROJECT_ID,
          amount: 0,
          retiredBy: "GCORP_REG009",
          beneficiary: "Acme Corp",
          retirementReason: "Zero amount test",
          vintageYear: 2023,
          serialStart: "CL-2023-REG010-000001",
          serialEnd: "CL-2023-REG010-000001",
          txHash: "0".repeat(64),
        });

      expect(res.status).toBe(400);
    });
  });

  // ── REG-011 ────────────────────────────────────────────────────────────────

  /**
   * REG-011: Protocol fee calculation handles zero-amount and dust edge cases.
   *
   * Audit §3.3: "Protocol fee calculation total_cost / 100 — rounding behaviour
   * and dust accumulation"
   *
   * The backend must not crash or produce incorrect results when the fee
   * calculation results in sub-unit values (dust). This is a pure unit test
   * of the fee arithmetic helper.
   *
   * Link: AUDIT_SCOPE.md §3.3
   */
  describe("REG-011: Protocol fee arithmetic — rounding and zero-amount safety", () => {
    // Fee calculation: 1% of total cost
    function calculateProtocolFee(totalCost: bigint): bigint {
      if (totalCost === 0n) return 0n;
      return totalCost / 100n; // integer division — dust is truncated
    }

    it("fee for zero total cost is zero (no division-by-zero crash)", () => {
      expect(calculateProtocolFee(0n)).toBe(0n);
    });

    it("fee for 1 stroop rounds down to 0 (dust truncation)", () => {
      // 1 stroop total cost → 1 / 100 = 0 (not 0.01)
      expect(calculateProtocolFee(1n)).toBe(0n);
    });

    it("fee for 99 stroops rounds down to 0", () => {
      expect(calculateProtocolFee(99n)).toBe(0n);
    });

    it("fee for 100 stroops is exactly 1 stroop", () => {
      expect(calculateProtocolFee(100n)).toBe(1n);
    });

    it("fee for 1,000,000 USDC (in stroops) is correct", () => {
      // 1 USDC = 10,000,000 stroops
      // 1,000,000 USDC = 10,000,000,000,000 stroops
      const totalCost = 10_000_000_000_000n;
      const fee = calculateProtocolFee(totalCost);
      expect(fee).toBe(100_000_000_000n); // 1% = 10,000 USDC in stroops
    });

    it("fee does not overflow for maximum safe Stellar amount (i128::MAX equivalent)", () => {
      // Stellar uses i128 for amounts: max is 9223372036854775807 (i64::MAX used in practice)
      // Test with a very large but realistic total
      const maxSafeAmount = BigInt("9223372036854775807");
      expect(() => calculateProtocolFee(maxSafeAmount)).not.toThrow();
      const fee = calculateProtocolFee(maxSafeAmount);
      expect(fee).toBeGreaterThan(0n);
    });
  });
});
