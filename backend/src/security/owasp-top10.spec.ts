/**
 * Security tests: OWASP API Top 10 — remaining categories
 *
 * API3  - Broken Object Property Level Authorization (Mass Assignment)
 * API4  - Unrestricted Resource Consumption
 * API6  - Unrestricted Access to Sensitive Business Flows (rate-limit bypass)
 * API7  - Server-Side Request Forgery (SSRF via metadataCid / satelliteCid)
 * API9  - Improper Inventory Management (undocumented endpoints)
 * API10 - Unsafe Consumption of APIs (certificate integrity)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";

import { AppModule } from "../app.module";
import { PrismaService } from "../prisma.service";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function tokenFor(publicKey: string, role: string) {
  return jwt.sign({ sub: publicKey, role }, SECRET, { expiresIn: "1h" });
}

const CORP_TOKEN = tokenFor("GCORP_OWASP", "corporation");
const ADMIN_TOKEN = tokenFor("GADMIN_OWASP", "admin");
const DEV_TOKEN = tokenFor("GDEV_OWASP", "project_developer");

describe("OWASP API Top 10 — Mass Assignment, Resource Consumption, Rate Limit, SSRF", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PROJECT_ID = "proj-owasp-test-001";
  const BATCH_ID = "batch-owasp-test-001";

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    prisma = app.get(PrismaService);

    await prisma.carbonProject.upsert({
      where: { projectId: PROJECT_ID },
      update: {},
      create: {
        projectId: PROJECT_ID,
        name: "OWASP Test Project",
        methodology: "VCS",
        country: "BR",
        projectType: "forestry",
        vintageYear: 2023,
        methodologyScore: 80,
        metadataCid: "QmOWASP",
        verifierAddress: "GVERIFIER",
        ownerAddress: "GCORP_OWASP",
      },
    });

    await prisma.creditBatch.upsert({
      where: { batchId: BATCH_ID },
      update: {},
      create: {
        batchId: BATCH_ID,
        projectId: PROJECT_ID,
        vintageYear: 2023,
        amount: 1000,
        serialStart: "8000",
        serialEnd: "8999",
        metadataCid: "QmOWASP",
      },
    });
  });

  afterAll(async () => {
    await prisma.retirementRecord.deleteMany({ where: { projectId: PROJECT_ID } });
    await prisma.marketListing.deleteMany({ where: { projectId: PROJECT_ID } });
    await prisma.creditBatch.deleteMany({ where: { batchId: BATCH_ID } });
    await prisma.carbonProject.deleteMany({ where: { projectId: PROJECT_ID } });
    await app.close();
  });

  // ── API3: Mass Assignment ──────────────────────────────────────────────────

  it("POST /marketplace/list must reject extra fields (status, seller override)", async () => {
    // VULNERABILITY: createListing passes dto directly to prisma.create({ data: dto }).
    // An attacker can inject status:'Sold' or override seller to another address.
    // Fix: use ValidationPipe with whitelist:true and forbidNonWhitelisted:true,
    //      and explicitly pick only allowed fields in the service.
    const res = await request(app.getHttpServer())
      .post("/marketplace/list")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({
        listingId: "listing-mass-assign-test",
        projectId: PROJECT_ID,
        batchId: BATCH_ID,
        seller: "GCORP_OWASP",
        amountAvailable: 10,
        pricePerCredit: "5.00",
        vintageYear: 2023,
        methodology: "VCS",
        country: "BR",
        // Attacker-injected fields:
        status: "Sold",           // should be ignored / rejected
        id: "attacker-chosen-id", // should be ignored / rejected
      })
      .expect((r) => {
        if (r.status === 201) {
          // If accepted, the injected fields must have been stripped
          expect(r.body.status).not.toBe("Sold");
          expect(r.body.id).not.toBe("attacker-chosen-id");
        } else {
          // 400 is also acceptable (forbidNonWhitelisted)
          expect(r.status).toBe(400);
        }
      });
  });

  it("POST /credits/retire must not allow overriding retiredBy to another user", async () => {
    // VULNERABILITY: retireCredits uses dto.holderPublicKey directly without
    // verifying it matches req.user.publicKey.
    // Fix: derive retiredBy from the JWT, not from the request body.
    const res = await request(app.getHttpServer())
      .post("/credits/retire")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({
        batchId: BATCH_ID,
        amount: 1,
        holderPublicKey: "GOTHER_CORP_VICTIM", // attacker claims to be someone else
        beneficiary: "Attacker Corp",
        retirementReason: "ESG",
      })
      .expect((r) => {
        if (r.status === 201) {
          // retiredBy must be the authenticated user, not the body value
          expect(r.body.retiredBy).toBe("GCORP_OWASP");
        } else {
          expect([400, 403]).toContain(r.status);
        }
      });
  });

  it("POST /projects/register must not allow setting status to Verified directly", async () => {
    const res = await request(app.getHttpServer())
      .post("/projects/register")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({
        projectId: "proj-mass-assign-status",
        name: "Attacker Project",
        methodology: "VCS",
        country: "BR",
        projectType: "forestry",
        vintageYear: 2023,
        methodologyScore: 80,
        metadataCid: "Qm1",
        verifierAddress: "GV",
        ownerAddress: "GDEV_OWASP",
        status: "Verified",           // should be stripped
        totalCreditsIssued: 9999999,  // should be stripped
      })
      .expect((r) => {
        if (r.status === 201) {
          expect(r.body.status).toBe("Pending");
          expect(r.body.totalCreditsIssued).toBe(0);
        } else {
          expect([400, 403]).toContain(r.status);
        }
      });

    // Cleanup
    await prisma.carbonProject.deleteMany({ where: { projectId: "proj-mass-assign-status" } });
  });

  // ── API4: Unrestricted Resource Consumption ────────────────────────────────

  it("GET /projects?limit=10000 must be capped at 100", async () => {
    const res = await request(app.getHttpServer())
      .get("/projects?limit=10000")
      .expect(200);

    // The service caps at 100; response must not return more than 100 items
    expect(res.body.projects?.length ?? 0).toBeLessThanOrEqual(100);
  });

  it("GET /retirements?limit=10000 must be capped at 100", async () => {
    const res = await request(app.getHttpServer())
      .get("/retirements?limit=10000")
      .expect((r) => {
        // Either 401 (if auth added) or 200 with capped results
        if (r.status === 200) {
          expect(r.body.retirements?.length ?? 0).toBeLessThanOrEqual(100);
        }
      });
  });

  it("POST /marketplace/bulk-purchase with 1000 listing IDs must be rejected → 400", () =>
    // Unrestricted bulk operations can exhaust DB connections.
    // Fix: cap listingIds array length (e.g. max 50).
    request(app.getHttpServer())
      .post("/marketplace/bulk-purchase")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({
        listingIds: Array.from({ length: 1000 }, (_, i) => `listing-${i}`),
        amounts: Array.from({ length: 1000 }, () => 1),
        buyerPublicKey: "GCORP_OWASP",
      })
      .expect((r) => {
        expect([400, 422]).toContain(r.status);
      }));

  // ── API6: Unrestricted Access to Sensitive Business Flows (rate-limit) ─────

  it("POST /auth/login 20 times in rapid succession must eventually be rate-limited → 429", async () => {
    // VULNERABILITY: no rate limiting on login endpoint.
    // Fix: add @nestjs/throttler with TTL=60s, limit=10 on auth routes.
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app.getHttpServer())
          .post("/auth/login")
          .send({ publicKey: `GBRUTE_${Math.random()}`, role: "corporation" })
      )
    );

    const rateLimited = responses.some((r) => r.status === 429);
    expect(rateLimited).toBe(true);
  });

  it("POST /credits/retire 20 times in rapid succession must eventually be rate-limited → 429", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app.getHttpServer())
          .post("/credits/retire")
          .set("Authorization", `Bearer ${CORP_TOKEN}`)
          .send({ batchId: BATCH_ID, amount: 1, holderPublicKey: "GCORP_OWASP", beneficiary: "x", retirementReason: "x" })
      )
    );

    const rateLimited = responses.some((r) => r.status === 429);
    expect(rateLimited).toBe(true);
  });

  // ── API7: SSRF via metadataCid / satelliteCid ─────────────────────────────

  it("POST /projects/register with metadataCid pointing to internal URL must be rejected", () =>
    // VULNERABILITY: metadataCid is stored and later fetched from IPFS.
    // If the service fetches arbitrary URLs, an attacker can point it at
    // internal services (e.g. http://169.254.169.254/latest/meta-data/).
    // Fix: validate CID format (must match /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/ or CIDv1).
    request(app.getHttpServer())
      .post("/projects/register")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({
        projectId: "proj-ssrf-test",
        name: "SSRF Test",
        methodology: "VCS",
        country: "BR",
        projectType: "forestry",
        vintageYear: 2023,
        methodologyScore: 80,
        metadataCid: "http://169.254.169.254/latest/meta-data/",
        verifierAddress: "GV",
        ownerAddress: "GDEV_OWASP",
      })
      .expect(400));

  it("POST /oracle/monitoring with satelliteCid as internal URL must be rejected", () =>
    request(app.getHttpServer())
      .post("/oracle/monitoring")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({
        projectId: PROJECT_ID,
        period: "2024-Q1",
        tonnesVerified: 100,
        methodologyScore: 80,
        satelliteCid: "http://internal-service/admin",
        submittedBy: "GADMIN_OWASP",
      })
      .expect(400));

  // ── API9: Improper Inventory Management ───────────────────────────────────

  it("GET /oracle/price-approvals without auth → 401 (not accidentally public)", () =>
    request(app.getHttpServer())
      .get("/oracle/price-approvals")
      .expect(401));

  it("GET /verifiers without auth → 401 (not accidentally public)", () =>
    request(app.getHttpServer())
      .get("/verifiers")
      .expect(401));

  // ── API10: Unsafe Consumption — certificate integrity ─────────────────────

  it("POST /retirements/verify-integrity with tampered content → valid:false", async () => {
    // Seed a retirement with a known CID
    const retirementId = "ret-integrity-test-001";
    await prisma.retirementRecord.upsert({
      where: { retirementId },
      update: {},
      create: {
        retirementId,
        batchId: BATCH_ID,
        projectId: PROJECT_ID,
        amount: 1,
        retiredBy: "GCORP_OWASP",
        beneficiary: "Test Corp",
        retirementReason: "ESG",
        vintageYear: 2023,
        serialNumbers: ["8000"],
        txHash: "cafebabe",
        certificateCid: "QmRealCIDThatWontMatchTamperedContent",
        isValid: true,
      },
    });

    const res = await request(app.getHttpServer())
      .post("/retirements/verify-integrity")
      .send({ retirementId, content: "tampered certificate content" })
      .expect(200);

    expect(res.body.valid).toBe(false);

    await prisma.retirementRecord.deleteMany({ where: { retirementId } });
  });
});
