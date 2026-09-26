/**
 * Security Regression Tests — Authorization
 *
 * Category: Authorization (Audit §3.2)
 * Issue: https://github.com/YOUR_ORG/carbonledger/blob/main/AUDIT_SCOPE.md#32-authorization
 *
 * These tests verify that all privileged backend endpoints enforce proper role-based
 * access control and that no path exists for privilege escalation. Each test
 * corresponds to a finding in the pre-audit checklist:
 *
 *   REG-004: Admin-only endpoint rejects non-admin callers
 *   REG-005: Verifier cannot self-approve projects (conflict-of-interest check)
 *   REG-006: Delist endpoint rejects non-seller callers
 *   REG-007: Re-initialisation of admin config is blocked
 *   REG-008: Oracle update endpoint rejects non-oracle callers
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "../../backend/src/prisma.service";
import { AppModule } from "../../backend/src/app.module";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function makeToken(publicKey: string, role: string, expiresIn = "1h") {
  return jwt.sign({ sub: publicKey, role }, JWT_SECRET, { expiresIn });
}

const ADMIN_TOKEN    = makeToken("GADMIN_REG004", "admin");
const CORP_TOKEN     = makeToken("GCORP_REG004", "corporation");
const VERIFIER_TOKEN = makeToken("GVERIF_REG004", "verifier");
const ORACLE_TOKEN   = makeToken("GORACLE_REG004", "oracle");
const DEV_TOKEN      = makeToken("GDEV_REG004", "project_developer");

describe("Authorization Regression Tests", () => {
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

  // ── REG-004 ────────────────────────────────────────────────────────────────

  /**
   * REG-004: Admin-only endpoint rejects non-admin callers.
   *
   * Audit §3.2: "mint_credits — admin-only; no path allows an arbitrary caller
   * to mint". The admin endpoints must reject corporation, verifier, and
   * developer roles.
   *
   * Link: AUDIT_SCOPE.md §3.2
   */
  describe("REG-004: Admin-only endpoints reject non-admin roles", () => {
    it("corporation token cannot access admin stats endpoint", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/stats")
        .set("Authorization", `Bearer ${CORP_TOKEN}`);

      expect(res.status).toBe(403);
    });

    it("project_developer token cannot access admin endpoint", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/stats")
        .set("Authorization", `Bearer ${DEV_TOKEN}`);

      expect(res.status).toBe(403);
    });

    it("unauthenticated request cannot access admin endpoint", async () => {
      const res = await request(app.getHttpServer()).get("/admin/stats");
      expect(res.status).toBe(401);
    });

    it("admin token CAN access admin endpoint", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/stats")
        .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

      // 200 or 404 are both valid — the guard passed
      expect([200, 404]).toContain(res.status);
    });
  });

  // ── REG-005 ────────────────────────────────────────────────────────────────

  /**
   * REG-005: Verifier cannot self-approve a project they submitted.
   *
   * Audit §3.2: "verifier cannot self-approve a project they submitted"
   * The /projects/:id/verify endpoint must check that the verifier calling
   * the endpoint is NOT the same address as the project owner.
   *
   * Link: AUDIT_SCOPE.md §3.2
   */
  describe("REG-005: Verifier cannot self-approve their own project", () => {
    const SELF_APPROVE_PROJECT_ID = "proj-reg005-self-approve";
    const VERIFIER_ADDRESS = "GVERIF_REG004"; // same as VERIFIER_TOKEN sub

    beforeAll(async () => {
      // Create a project where the verifier IS the owner
      await prisma.carbonProject.upsert({
        where: { projectId: SELF_APPROVE_PROJECT_ID },
        update: {},
        create: {
          projectId: SELF_APPROVE_PROJECT_ID,
          name: "Self-Approve Attack Project",
          methodology: "REDD+",
          country: "BR",
          projectType: "Forest Conservation",
          status: "Pending",
          vintageYear: 2024,
          methodologyScore: 80,
          metadataCid: "QmReg005",
          verifierAddress: VERIFIER_ADDRESS,
          ownerAddress: VERIFIER_ADDRESS, // same address — conflict of interest
        },
      });
    });

    afterAll(async () => {
      await prisma.carbonProject.deleteMany({
        where: { projectId: SELF_APPROVE_PROJECT_ID },
      });
    });

    it("verifier token is rejected when attempting to approve own project", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/projects/${SELF_APPROVE_PROJECT_ID}/verify`)
        .set("Authorization", `Bearer ${VERIFIER_TOKEN}`)
        .send({ verifierAddress: VERIFIER_ADDRESS });

      // Must not return 200/201 — the verifier cannot self-approve
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);
    });
  });

  // ── REG-006 ────────────────────────────────────────────────────────────────

  /**
   * REG-006: delist_credits rejects non-seller callers.
   *
   * Audit §3.2: "delist_credits — only the original seller; no admin override path"
   * The DELETE /marketplace/listings/:id endpoint must return 403 if the caller
   * is not the original seller of the listing.
   *
   * Link: AUDIT_SCOPE.md §3.2
   */
  describe("REG-006: delist_credits rejects calls from non-seller addresses", () => {
    const LISTING_ID = "listing-reg006-delist";
    const PROJECT_ID = "proj-reg006-delist";
    const BATCH_ID   = "batch-reg006-delist";

    beforeAll(async () => {
      await prisma.carbonProject.upsert({
        where: { projectId: PROJECT_ID },
        update: {},
        create: {
          projectId: PROJECT_ID,
          name: "Reg006 Delist Test",
          methodology: "VCS",
          country: "CO",
          projectType: "REDD+",
          status: "Verified",
          vintageYear: 2023,
          methodologyScore: 75,
          metadataCid: "QmReg006",
          verifierAddress: "GVERIFIER",
          ownerAddress: "GSELLER_REAL_0000000000000000000000000000000000000000",
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
          serialStart: "CL-2023-REG006-000001",
          serialEnd: "CL-2023-REG006-000050",
          status: "Active",
          metadataCid: "QmReg006Batch",
        },
      });

      await prisma.marketListing.upsert({
        where: { listingId: LISTING_ID },
        update: {},
        create: {
          listingId: LISTING_ID,
          projectId: PROJECT_ID,
          batchId: BATCH_ID,
          seller: "GSELLER_REAL_0000000000000000000000000000000000000000", // different from CORP
          amountAvailable: 50,
          pricePerCredit: "10000000",
          vintageYear: 2023,
          methodology: "VCS",
          country: "CO",
          status: "Active",
        },
      });
    });

    afterAll(async () => {
      await prisma.marketListing.deleteMany({ where: { listingId: LISTING_ID } });
      await prisma.creditBatch.deleteMany({ where: { batchId: BATCH_ID } });
      await prisma.carbonProject.deleteMany({ where: { projectId: PROJECT_ID } });
    });

    it("corporation (non-seller) cannot delist another address's listing", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/marketplace/listings/${LISTING_ID}`)
        .set("Authorization", `Bearer ${CORP_TOKEN}`);

      expect(res.status).toBe(403);
    });

    it("unauthenticated request cannot delist any listing", async () => {
      const res = await request(app.getHttpServer()).delete(
        `/marketplace/listings/${LISTING_ID}`
      );

      expect(res.status).toBe(401);
    });
  });

  // ── REG-007 ────────────────────────────────────────────────────────────────

  /**
   * REG-007: AdminConfig cannot be overwritten by non-admin callers.
   *
   * Audit §3.2 / §4: "initialize() has no guard against being called twice;
   * second call overwrites admin". The AdminConfig endpoint must be admin-only
   * and must reject subsequent writes from non-admin roles.
   *
   * Link: AUDIT_SCOPE.md §4 (Re-initialisation)
   */
  describe("REG-007: AdminConfig write is admin-only (re-init guard)", () => {
    it("non-admin cannot write to admin config endpoint", async () => {
      const res = await request(app.getHttpServer())
        .put("/admin/config")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({ key: "oracle_address", value: "GEVIL_ATTACKER" });

      expect(res.status).toBe(403);
    });

    it("unauthenticated request cannot write admin config", async () => {
      const res = await request(app.getHttpServer())
        .put("/admin/config")
        .send({ key: "oracle_address", value: "GEVIL_ATTACKER" });

      expect(res.status).toBe(401);
    });
  });

  // ── REG-008 ────────────────────────────────────────────────────────────────

  /**
   * REG-008: Oracle update endpoint rejects non-oracle callers.
   *
   * Audit §3.2: "update_project_status / increment_issued — oracle-only;
   * oracle key compromise blast radius"
   * The POST /oracle/monitoring endpoint must only accept requests with a
   * valid oracle API key or oracle-role JWT.
   *
   * Link: AUDIT_SCOPE.md §3.2
   */
  describe("REG-008: Oracle update endpoint enforces oracle-only access", () => {
    it("corporation token cannot submit oracle monitoring data", async () => {
      const res = await request(app.getHttpServer())
        .post("/oracle/monitoring")
        .set("Authorization", `Bearer ${CORP_TOKEN}`)
        .send({
          projectId: "SOME-PROJECT",
          period: "2024-Q1",
          tonnesVerified: 1000,
          methodologyScore: 80,
          satelliteCid: "QmSomeCid",
        });

      expect(res.status).toBe(403);
    });

    it("no Authorization header cannot submit oracle data", async () => {
      const res = await request(app.getHttpServer())
        .post("/oracle/monitoring")
        .send({
          projectId: "SOME-PROJECT",
          period: "2024-Q1",
          tonnesVerified: 1000,
          methodologyScore: 80,
          satelliteCid: "QmSomeCid",
        });

      expect(res.status).toBe(401);
    });

    it("admin token cannot submit oracle monitoring data (role mismatch)", async () => {
      const res = await request(app.getHttpServer())
        .post("/oracle/monitoring")
        .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
        .send({
          projectId: "SOME-PROJECT",
          period: "2024-Q1",
          tonnesVerified: 1000,
          methodologyScore: 80,
          satelliteCid: "QmSomeCid",
        });

      // Admin is not oracle — must be 403
      expect(res.status).toBe(403);
    });
  });
});
