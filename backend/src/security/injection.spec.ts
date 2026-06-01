/**
 * Security tests: Injection (OWASP API8 - Security Misconfiguration / Injection)
 *
 * Covers:
 *  - Prisma/NoSQL operator injection via query params (e.g. ?methodology[$ne]=x)
 *  - Oversized payload (body > 1 MB) → 413
 *  - Prototype pollution via __proto__ in JSON body
 *  - Path traversal in :id params
 *  - SQL-like injection strings in search params
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";

import { AppModule } from "../app.module";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ADMIN_TOKEN = jwt.sign({ sub: "GADMIN", role: "admin" }, SECRET, { expiresIn: "1h" });
const CORP_TOKEN = jwt.sign({ sub: "GCORP", role: "corporation" }, SECRET, { expiresIn: "1h" });

describe("Injection (OWASP API8)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(() => app.close());

  // ── Prisma operator injection via query params ─────────────────────────────

  it("GET /projects?methodology[$ne]=VCS must not leak all projects", async () => {
    // Attacker tries to inject a Prisma operator via query string.
    // NestJS query parsing turns ?methodology[$ne]=VCS into { methodology: { $ne: 'VCS' } }.
    // Prisma ignores unknown operators, but the string should be treated as a literal.
    const res = await request(app.getHttpServer())
      .get("/projects?methodology[$ne]=VCS")
      .expect(200);

    // Should return 0 results (no project with methodology literally equal to '{"$ne":"VCS"}')
    // OR the server should reject the malformed param with 400.
    const isRejectedOrEmpty =
      res.status === 400 ||
      (res.status === 200 && res.body.projects?.length === 0);
    expect(isRejectedOrEmpty).toBe(true);
  });

  it("GET /projects/search?search='; DROP TABLE-- must not cause 500", () =>
    request(app.getHttpServer())
      .get('/projects/search?search=%27%3B+DROP+TABLE+%22CarbonProject%22+--')
      .expect((res) => {
        expect(res.status).not.toBe(500);
      }));

  it("GET /projects/search?search=<script>alert(1)</script> must not reflect XSS", async () => {
    const res = await request(app.getHttpServer())
      .get("/projects/search?search=%3Cscript%3Ealert%281%29%3C%2Fscript%3E")
      .expect(200);

    // Response body must not contain unescaped script tags
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("<script>");
  });

  // ── Oversized payload ─────────────────────────────────────────────────────

  it("POST /projects/register with 2 MB body → 413", () => {
    const oversized = { projectId: "p-inject", name: "x".repeat(2 * 1024 * 1024), methodology: "VCS", country: "BR", projectType: "forestry", vintageYear: 2023, methodologyScore: 80, metadataCid: "Qm1", verifierAddress: "GV", ownerAddress: "GO" };
    return request(app.getHttpServer())
      .post("/projects/register")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send(oversized)
      .expect(413);
  });

  it("POST /oracle/monitoring with 2 MB satelliteCid → 413", () => {
    const oversized = { projectId: "p1", period: "2024-Q1", tonnesVerified: 100, methodologyScore: 80, satelliteCid: "x".repeat(2 * 1024 * 1024), submittedBy: "GV" };
    return request(app.getHttpServer())
      .post("/oracle/monitoring")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send(oversized)
      .expect(413);
  });

  // ── Prototype pollution ───────────────────────────────────────────────────

  it("POST /auth/login with __proto__ in body must not pollute Object prototype", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send('{"publicKey":"GPOLLUTE","role":"corporation","__proto__":{"isAdmin":true}}')
      .expect((res) => {
        // Must not 500, and must not grant admin
        expect(res.status).not.toBe(500);
        if (res.status === 201) {
          const decoded = jwt.decode(res.body.access_token) as any;
          expect(decoded?.role).not.toBe("admin");
        }
      });

    // Prototype must not be polluted
    expect((({} as any).isAdmin)).toBeUndefined();
  });

  it("POST /projects/register with constructor.prototype injection must not 500", () =>
    request(app.getHttpServer())
      .post("/projects/register")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .set("Content-Type", "application/json")
      .send('{"projectId":"p-proto","name":"x","methodology":"VCS","country":"BR","projectType":"forestry","vintageYear":2023,"methodologyScore":80,"metadataCid":"Qm1","verifierAddress":"GV","ownerAddress":"GO","constructor":{"prototype":{"isAdmin":true}}}')
      .expect((res) => {
        expect(res.status).not.toBe(500);
        expect((({} as any).isAdmin)).toBeUndefined();
      }));

  // ── Path traversal ────────────────────────────────────────────────────────

  it("GET /projects/../auth/login must not bypass routing → 404 or 400", () =>
    request(app.getHttpServer())
      .get("/projects/..%2Fauth%2Flogin")
      .expect((res) => {
        expect([400, 404]).toContain(res.status);
      }));

  it("GET /retirements/../../oracle/price-approvals must not bypass auth → 401 or 404", () =>
    request(app.getHttpServer())
      .get("/retirements/..%2F..%2Foracle%2Fprice-approvals")
      .expect((res) => {
        expect([401, 404]).toContain(res.status);
      }));
});
