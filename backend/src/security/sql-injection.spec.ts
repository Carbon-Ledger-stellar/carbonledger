/**
 * Security tests: SQL Injection — #424
 *
 * Prisma uses parameterized queries by default, making classic SQL injection
 * impossible through the ORM layer.  This suite:
 *
 *  1. Confirms that SQL injection payloads in string parameters are treated as
 *     literal values (not executed), returning 400 or empty results — never 500.
 *  2. Audits every endpoint that accepts string input and verifies no raw DB
 *     errors are exposed in responses.
 *  3. Covers search, filter, and ID parameters across projects, retirements,
 *     credits, and marketplace endpoints.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";

import { AppModule } from "../app.module";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ADMIN_TOKEN = jwt.sign({ sub: "GADMIN_SQL", role: "admin" }, SECRET, { expiresIn: "1h" });
const CORP_TOKEN  = jwt.sign({ sub: "GCORP_SQL",  role: "corporation" }, SECRET, { expiresIn: "1h" });

/** Classic and modern SQL injection payloads */
const SQL_PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1--",
  "'; DROP TABLE \"CarbonProject\";--",
  "' UNION SELECT * FROM \"User\"--",
  "1; SELECT pg_sleep(5)--",
  "' AND 1=CAST((SELECT version()) AS INT)--",
  "\\'; DROP TABLE retirements;--",
  "1' AND SLEEP(5)--",
  "%27 OR %271%27=%271",
  "admin'--",
];

/** Assert response does not expose raw database error messages */
function assertNoDatabaseError(res: request.Response): void {
  const body = JSON.stringify(res.body);
  // Postgres error patterns that must never reach the client
  expect(body).not.toMatch(/syntax error at or near/i);
  expect(body).not.toMatch(/unterminated quoted string/i);
  expect(body).not.toMatch(/column .* does not exist/i);
  expect(body).not.toMatch(/relation .* does not exist/i);
  expect(body).not.toMatch(/PrismaClientKnownRequestError/i);
  expect(body).not.toMatch(/PrismaClientUnknownRequestError/i);
  expect(body).not.toMatch(/\$queryRaw/i);
}

describe("SQL Injection (OWASP API1 / #424)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());

  // ── GET /projects — methodology / country filter params ───────────────────

  describe("GET /api/v1/projects — filter params", () => {
    it.each(SQL_PAYLOADS)(
      "?methodology=%s must not cause 500 or expose DB errors",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/projects?methodology=${encodeURIComponent(payload)}`)
          .expect((r) => expect(r.status).not.toBe(500));

        assertNoDatabaseError(res);
      }
    );

    it.each(SQL_PAYLOADS)(
      "?country=%s must not cause 500 or expose DB errors",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/projects?country=${encodeURIComponent(payload)}`)
          .expect((r) => expect(r.status).not.toBe(500));

        assertNoDatabaseError(res);
      }
    );
  });

  // ── GET /projects/search — full-text search param ─────────────────────────

  describe("GET /api/v1/projects/search — search param", () => {
    it.each(SQL_PAYLOADS)(
      "?search=%s must not cause 500 or expose DB errors",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/projects/search?search=${encodeURIComponent(payload)}`)
          .expect((r) => expect(r.status).not.toBe(500));

        assertNoDatabaseError(res);
        // Prisma treats the payload as a literal string — result set must be empty
        if (res.status === 200) {
          const projects = res.body.projects ?? res.body;
          expect(Array.isArray(projects) ? projects.length : 0).toBe(0);
        }
      }
    );
  });

  // ── GET /projects/:id — path parameter ───────────────────────────────────

  describe("GET /api/v1/projects/:id — path param", () => {
    it.each(SQL_PAYLOADS)(
      "projectId=%s must return 400/404, not 500",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/projects/${encodeURIComponent(payload)}`);

        expect([400, 404]).toContain(res.status);
        assertNoDatabaseError(res);
      }
    );
  });

  // ── GET /retirements — retiredBy filter ───────────────────────────────────

  describe("GET /api/v1/retirements — retiredBy filter", () => {
    it.each(SQL_PAYLOADS)(
      "?retiredBy=%s must not cause 500 or expose DB errors",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/retirements?retiredBy=${encodeURIComponent(payload)}`)
          .set("Authorization", `Bearer ${CORP_TOKEN}`)
          .expect((r) => expect(r.status).not.toBe(500));

        assertNoDatabaseError(res);
      }
    );
  });

  // ── POST /projects/register — string body fields ──────────────────────────

  describe("POST /api/v1/projects/register — body string fields", () => {
    it.each(SQL_PAYLOADS)(
      "SQL payload %s in projectId → 400 (validation) or safe 201",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post("/api/v1/projects/register")
          .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
          .send({
            projectId: payload,
            name: "SQL Injection Test",
            methodology: "VCS",
            country: "BR",
            projectType: "forestry",
            vintageYear: 2023,
            methodologyScore: 80,
            metadataCid: "QmSQLTest1234567890123456789012345678901234",
            verifierAddress: "GVERIFIER",
            ownerAddress: "GOWNER",
          });

        // Must be rejected by validation (400) or stored safely — never 500
        expect(res.status).not.toBe(500);
        assertNoDatabaseError(res);
      }
    );
  });

  // ── POST /retirements — beneficiary / reason fields ───────────────────────

  describe("POST /api/v1/retirements — beneficiary / reason fields", () => {
    it.each(SQL_PAYLOADS)(
      "SQL payload %s in beneficiary → 400 or safe 201",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post("/api/v1/retirements")
          .set("Authorization", `Bearer ${CORP_TOKEN}`)
          .send({
            batchId: "nonexistent-batch",
            amount: 1,
            beneficiary: payload,
            retirementReason: "ESG offset",
            vintageYear: 2023,
          });

        // 404 (batch not found) or 400 (validation) — never 500
        expect(res.status).not.toBe(500);
        assertNoDatabaseError(res);
      }
    );
  });

  // ── Marketplace search ────────────────────────────────────────────────────

  describe("GET /api/v1/marketplace — filter params", () => {
    it.each(SQL_PAYLOADS)(
      "?methodology=%s must not cause 500 or expose DB errors",
      async (payload) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/marketplace?methodology=${encodeURIComponent(payload)}`)
          .expect((r) => expect(r.status).not.toBe(500));

        assertNoDatabaseError(res);
      }
    );
  });

  // ── Verify no raw Prisma errors leak in any 4xx/5xx response ─────────────

  describe("Error responses — no raw DB errors exposed", () => {
    it("404 response for unknown project must not contain Prisma stack trace", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/projects/definitely-does-not-exist-12345")
        .expect(404);

      assertNoDatabaseError(res);
      // Must not expose internal stack traces
      expect(JSON.stringify(res.body)).not.toMatch(/at Object\./);
      expect(JSON.stringify(res.body)).not.toMatch(/node_modules/);
    });

    it("400 response must not contain Prisma stack trace", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/projects/register")
        .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
        .send({ invalid: "body" })
        .expect(400);

      assertNoDatabaseError(res);
    });
  });
});
