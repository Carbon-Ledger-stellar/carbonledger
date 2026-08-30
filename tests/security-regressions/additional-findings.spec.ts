/**
 * Security Regression Tests — Additional Findings
 *
 * Category: Additional Audit Findings (Audit §4)
 * Issue: https://github.com/YOUR_ORG/carbonledger/blob/main/AUDIT_SCOPE.md#4-additional-areas-of-interest
 *
 * These tests cover the additional security concerns identified in the pre-audit
 * checklist beyond the four primary vectors:
 *
 *   REG-018: Duplicate listing_id is rejected (listing ID collision)
 *   REG-019: Oracle update requires valid oracle credentials (oracle SPOF hardening)
 *   REG-020: Retirement validates credit holder (holder check)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "../../backend/src/prisma.service";
import { AppModule } from "../../backend/src/app.module";

const JWT_SECRET     = process.env.JWT_SECRET || "dev-secret-change-in-production";
const CORP_TOKEN     = jwt.sign({ sub: "GCORP_REG018",  role: "corporation" },        JWT_SECRET, { expiresIn: "1h" });
const ADMIN_TOKEN    = jwt.sign({ sub: "GADMIN_REG018", role: "admin" },              JWT_SECRET, { expiresIn: "1h" });
const ATTACKER_TOKEN = jwt.sign({ sub: "GATTACKER",     role: "corporation" },        JWT_SECRET, { expiresIn: "1h" });

describe("Additional Audit Findings — Regression Tests", () => {
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

  // ── REG-018 ────────────────────────────────────────────────────────────────

  /**
   * REG-018: Duplicate listing_id is rejected — listing ID collision prevented.
   *
   * Audit §4: "list_credits does not check if listing_id already exists;
   * silently overwrites". This was patched to return a conflict error.
   * The regression test ensures the patch is never reverted.
   *
   * Link: AUDIT_SCOPE.md §4 (Listing ID collision)
   */
  describe("REG-018: Duplicate listing ID is rejected", () => {
    const PROJECT_ID = "proj-reg018-listing";
    const BATCH_ID   = "batch-reg018-listing";
    const LISTING_ID = "listing-reg018-collision-test";

    beforeAll(async () => {
      await prisma.carbonProject.upsert({
        where: { projectId: PROJECT_ID },
        update: {},
        create: {
          projectId: PROJECT_ID,
          name: "Reg018 Listing Collision Test",
          methodology: "GS",
          country: "GH",
          projectType: "Clean Cookstoves",
          status: "Verified",
          vintageYear: 2024,
          methodologyScore: 82,
          metadataCid: "QmReg018",
          verifierAddress: "GVERIFIER",
          ownerAddress: "GSELLER_REG018",
        },
      });

      await prisma.creditBatch.upsert({
        where: { batchId: BATCH_ID },
        update: {},
        create: {
          batchId: BATCH_ID,
          projectId: PROJECT_ID,
          vintageYear: 2024,
          amount: 200,
          serialStart: "CL-2024-GS-000001",
          serialEnd: "CL-2024-GS-000200",
          status: "Active",
          metadataCid: "QmReg018Batch",
        },
      });

      // Create the original listing
      await prisma.marketListing.upsert({
        where: { listingId: LISTING_ID },
        update: {},
        create: {
          listingId: LISTING_ID,
          projectId: PROJECT_ID,
          batchId: BATCH_ID,
          seller: "GSELLER_REG018",
          amountAvailable: 100,
          pricePerCredit: "15000000",
          vintageYear: 2024,
          methodology: "GS",
          country: "GH",
          status: "Active",
        },
      });
    });

    afterAll(async () => {
      await prisma.marketListing.deleteMany({ where: { listingId: LISTING_ID } });
      await prisma.creditBatch.deleteMany({ where: { batchId: BATCH_ID } });
      await prisma.carbonProject.deleteMany({ where: { projectId: PROJECT_ID } });
    });

    it("duplicate listingId is rejected with 409 Conflict — not silently overwritten", async () => {
      const res = await request(app.getHttpServer())
        .post("/marketplace/listings")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          listingId: LISTING_ID, // already exists
          projectId: PROJECT_ID,
          batchId: BATCH_ID,
          seller: "GSELLER_REG018",
          amountAvailable: 50, // different amount
          pricePerCredit: "20000000", // different price
          vintageYear: 2024,
          methodology: "GS",
          country: "GH",
        });

      // Must conflict — not silently overwrite the original listing
      expect([400, 409, 422]).toContain(res.status);
    });

    it("original listing price is unchanged after rejected duplicate attempt", async () => {
      const listing = await prisma.marketListing.findUnique({
        where: { listingId: LISTING_ID },
      });

      // Price must still be the original value
      expect(listing?.pricePerCredit).toBe("15000000");
      expect(Number(listing?.amountAvailable)).toBe(100);
    });
  });

  // ── REG-019 ────────────────────────────────────────────────────────────────

  /**
   * REG-019: Oracle update requires valid oracle credentials.
   *
   * Audit §4: "Oracle single point of failure — single oracle address;
   * compromise = ability to push false monitoring data and prices"
   * The oracle endpoint must reject requests without valid oracle credentials.
   * This is a defence-in-depth test — it verifies that even if the oracle key
   * is leaked, callers without that exact key cannot submit false data.
   *
   * Link: AUDIT_SCOPE.md §4 (Oracle single point of failure)
   */
  describe("REG-019: Oracle endpoint enforces oracle-key authentication", () => {
    it("request without oracle API key is rejected", async () => {
      const res = await request(app.getHttpServer())
        .post("/oracle/monitoring")
        .send({
          projectId: "SOME-PROJ",
          period: "2024-Q1",
          tonnesVerified: 5000,
          methodologyScore: 85,
          satelliteCid: "QmFakeMonitoring",
        });

      expect(res.status).toBe(401);
    });

    it("request with invalid oracle API key is rejected", async () => {
      const res = await request(app.getHttpServer())
        .post("/oracle/monitoring")
        .set("x-oracle-key", "invalid-key-that-does-not-exist")
        .send({
          projectId: "SOME-PROJ",
          period: "2024-Q1",
          tonnesVerified: 5000,
          methodologyScore: 85,
          satelliteCid: "QmFakeMonitoring",
        });

      expect(res.status).toBe(401);
    });

    it("JWT token from corporation role cannot submit oracle data", async () => {
      const res = await request(app.getHttpServer())
        .post("/oracle/monitoring")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          projectId: "SOME-PROJ",
          period: "2024-Q1",
          tonnesVerified: 5000,
          methodologyScore: 85,
          satelliteCid: "QmFakeMonitoring",
        });

      expect(res.status).toBe(403);
    });

    it("price update endpoint also requires oracle credentials", async () => {
      const res = await request(app.getHttpServer())
        .post("/oracle/price")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          methodology: "REDD+",
          vintageYear: 2024,
          priceUsdc: "15000000",
        });

      expect(res.status).toBe(403);
    });
  });

  // ── REG-020 ────────────────────────────────────────────────────────────────

  /**
   * REG-020: Retirement validates credit holder before allowing retirement.
   *
   * Audit §4: "retire_credits holder check — Any address can retire any batch —
   * no ownership model enforced". This was patched to validate that the retiring
   * address holds the credits being retired.
   *
   * The backend validates that retiredBy address is either the batch seller or
   * has previously purchased the credits. An attacker cannot retire another
   * party's credits.
   *
   * Link: AUDIT_SCOPE.md §4 (retire_credits holder check)
   */
  describe("REG-020: Retirement requires valid credit holder", () => {
    const PROJECT_ID = "proj-reg020-holder";
    const BATCH_ID   = "batch-reg020-holder";

    beforeAll(async () => {
      await prisma.carbonProject.upsert({
        where: { projectId: PROJECT_ID },
        update: {},
        create: {
          projectId: PROJECT_ID,
          name: "Reg020 Holder Check Test",
          methodology: "VCS",
          country: "IN",
          projectType: "Renewable Energy",
          status: "Verified",
          vintageYear: 2023,
          methodologyScore: 88,
          metadataCid: "QmReg020",
          verifierAddress: "GVERIFIER",
          ownerAddress: "GLEGIT_OWNER_REG020",
        },
      });

      await prisma.creditBatch.upsert({
        where: { batchId: BATCH_ID },
        update: {},
        create: {
          batchId: BATCH_ID,
          projectId: PROJECT_ID,
          vintageYear: 2023,
          amount: 50,
          serialStart: "CL-2023-VCS-000001",
          serialEnd: "CL-2023-VCS-000050",
          status: "Active",
          metadataCid: "QmReg020Batch",
        },
      });
    });

    afterAll(async () => {
      await prisma.creditBatch.deleteMany({ where: { batchId: BATCH_ID } });
      await prisma.carbonProject.deleteMany({ where: { projectId: PROJECT_ID } });
    });

    it("attacker address cannot retire credits they do not own", async () => {
      // ATTACKER_TOKEN is GATTACKER — not the owner or purchaser of this batch
      const res = await request(app.getHttpServer())
        .post("/retirements")
        .set("Authorization", `Bearer ${ATTACKER_TOKEN}`)
        .send({
          batchId: BATCH_ID,
          projectId: PROJECT_ID,
          amount: 10,
          retiredBy: "GATTACKER", // not the owner
          beneficiary: "Evil Corp — Fake ESG Report",
          retirementReason: "Fraudulent retirement attack",
          vintageYear: 2023,
          serialStart: "CL-2023-VCS-000001",
          serialEnd: "CL-2023-VCS-000010",
          txHash: "0".repeat(64),
        });

      // Must be rejected — GATTACKER does not hold these credits
      expect([400, 403, 422]).toContain(res.status);
    });

    it("batch remains unaffected after rejected fraudulent retirement attempt", async () => {
      const batch = await prisma.creditBatch.findUnique({
        where: { batchId: BATCH_ID },
      });

      // Batch amount must still be 50 — no credits retired by the attacker
      expect(Number(batch!.amount)).toBe(50);
    });
  });
});
