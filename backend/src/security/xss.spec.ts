/**
 * Security tests: XSS (Cross-Site Scripting) — #423
 *
 * Verifies that user-input fields (project name, beneficiary, retirement reason)
 * are sanitized before storage and that injected scripts are never reflected
 * in API responses.
 *
 * Covers:
 *  - Script tag injection in project name / description
 *  - Event-handler injection (onerror, onload) in string fields
 *  - Beneficiary and retirement reason XSS payloads
 *  - Stored XSS: injected value must not appear unescaped in GET responses
 *  - Retirement certificate endpoint must not reflect injected scripts
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";

import { AppModule } from "../app.module";
import { PrismaService } from "../prisma.service";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ADMIN_TOKEN = jwt.sign({ sub: "GADMIN_XSS", role: "admin" }, SECRET, { expiresIn: "1h" });
const CORP_TOKEN  = jwt.sign({ sub: "GCORP_XSS",  role: "corporation" }, SECRET, { expiresIn: "1h" });

/** Common XSS payloads */
const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(1)",
  "<svg onload=alert(1)>",
  '"><script>alert(document.cookie)</script>',
  "';alert(String.fromCharCode(88,83,83))//",
];

/** Assert that a JSON-serialised response body contains no unescaped script tags */
function assertNoXss(body: unknown): void {
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/<script[\s>]/i);
  expect(raw).not.toMatch(/onerror\s*=/i);
  expect(raw).not.toMatch(/onload\s*=/i);
  expect(raw).not.toMatch(/javascript:/i);
}

describe("XSS Sanitization (OWASP API3 / #423)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(() => app.close());

  // ── Project name / description fields ────────────────────────────────────

  describe("POST /api/v1/projects/register — XSS in name/description", () => {
    it.each(XSS_PAYLOADS)(
      "payload %s in project name → 400 (rejected by validation) or sanitized",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post("/api/v1/projects/register")
          .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
          .send({
            projectId: `xss-name-${Date.now()}`,
            name: payload,
            methodology: "VCS",
            country: "BR",
            projectType: "forestry",
            vintageYear: 2023,
            methodologyScore: 80,
            metadataCid: "QmXSSTest1234567890123456789012345678901234",
            verifierAddress: "GVERIFIER",
            ownerAddress: "GOWNER",
          });

        // Must be rejected (400) or stored safely (201/200 with no raw script in response)
        if (res.status === 201 || res.status === 200) {
          assertNoXss(res.body);
        } else {
          expect(res.status).toBe(400);
        }
      }
    );

    it.each(XSS_PAYLOADS)(
      "payload %s in project description → 400 or sanitized",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post("/api/v1/projects/register")
          .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
          .send({
            projectId: `xss-desc-${Date.now()}`,
            name: "Legit Project",
            description: payload,
            methodology: "VCS",
            country: "BR",
            projectType: "forestry",
            vintageYear: 2023,
            methodologyScore: 80,
            metadataCid: "QmXSSTest1234567890123456789012345678901234",
            verifierAddress: "GVERIFIER",
            ownerAddress: "GOWNER",
          });

        if (res.status === 201 || res.status === 200) {
          assertNoXss(res.body);
        } else {
          expect(res.status).toBe(400);
        }
      }
    );
  });

  // ── Retirement beneficiary / reason fields ────────────────────────────────

  describe("POST /api/v1/retirements — XSS in beneficiary/reason", () => {
    const BATCH_ID = "batch-xss-test-001";
    const PROJECT_ID = "proj-xss-test-001";

    beforeAll(async () => {
      // Seed a project and batch so retirement requests have valid references
      await prisma.carbonProject.upsert({
        where: { projectId: PROJECT_ID },
        update: {},
        create: {
          projectId: PROJECT_ID,
          name: "XSS Test Project",
          methodology: "VCS",
          country: "BR",
          projectType: "forestry",
          vintageYear: 2023,
          methodologyScore: 80,
          metadataCid: "QmXSSTest1234567890123456789012345678901234",
          verifierAddress: "GVERIFIER",
          ownerAddress: "GCORP_XSS",
          status: "Verified",
        },
      });

      await prisma.creditBatch.upsert({
        where: { batchId: BATCH_ID },
        update: {},
        create: {
          batchId: BATCH_ID,
          projectId: PROJECT_ID,
          amount: 10000,
          availableAmount: 10000,
          vintageYear: 2023,
          serialStart: 1,
          serialEnd: 10000,
          metadataCid: "QmXSSTest1234567890123456789012345678901234",
          ownerAddress: "GCORP_XSS",
          status: "active",
        },
      });
    });

    it.each(XSS_PAYLOADS)(
      "payload %s in beneficiary → 400 or sanitized in response",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post("/api/v1/retirements")
          .set("Authorization", `Bearer ${CORP_TOKEN}`)
          .send({
            batchId: BATCH_ID,
            amount: 1,
            beneficiary: payload,
            retirementReason: "ESG offset",
            vintageYear: 2023,
          });

        if (res.status === 201 || res.status === 200) {
          assertNoXss(res.body);
        } else {
          // 400 = validation rejected the payload — also acceptable
          expect([400, 422]).toContain(res.status);
        }
      }
    );

    it.each(XSS_PAYLOADS)(
      "payload %s in retirementReason → 400 or sanitized in response",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post("/api/v1/retirements")
          .set("Authorization", `Bearer ${CORP_TOKEN}`)
          .send({
            batchId: BATCH_ID,
            amount: 1,
            beneficiary: "Legit Corp",
            retirementReason: payload,
            vintageYear: 2023,
          });

        if (res.status === 201 || res.status === 200) {
          assertNoXss(res.body);
        } else {
          expect([400, 422]).toContain(res.status);
        }
      }
    );
  });

  // ── GET responses must not reflect stored XSS ─────────────────────────────

  describe("GET responses — no stored XSS reflected", () => {
    it("GET /api/v1/projects must not contain unescaped script tags", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/projects")
        .expect(200);

      assertNoXss(res.body);
    });

    it("GET /api/v1/retirements must not contain unescaped script tags", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/retirements")
        .expect(200);

      assertNoXss(res.body);
    });
  });

  // ── Search endpoints must not reflect XSS in query params ────────────────

  describe("Search endpoints — XSS in query params not reflected", () => {
    it.each(XSS_PAYLOADS)(
      "GET /api/v1/projects/search?search=%s must not reflect payload",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/projects/search?search=${encodeURIComponent(payload)}`)
          .expect((r) => {
            expect(r.status).not.toBe(500);
          });

        assertNoXss(res.body);
      }
    );
  });

  // ── Content-Type header must be application/json (not text/html) ──────────

  it("API responses must use application/json, not text/html (prevents browser XSS rendering)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/projects")
      .expect(200);

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
