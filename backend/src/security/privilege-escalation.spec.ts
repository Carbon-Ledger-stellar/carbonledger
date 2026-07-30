/**
 * Security tests: Privilege Escalation (OWASP API5 - Broken Function Level Authorization)
 *
 * Covers:
 *  - Corporation calling verifier-only endpoints → 403
 *  - Corporation calling admin-only endpoints → 403
 *  - Project developer calling oracle endpoints → 403
 *  - Verifier calling admin-only endpoints → 403
 */

import { INestApplication } from "@nestjs/common";
import request from "supertest";
import * as jwt from "jsonwebtoken";

import { createSecurityTestApp } from "./create-security-test-app";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

import { signSecurityToken } from "./security-test-auth";

function tokenFor(publicKey: string, role: string) {
  return signSecurityToken(publicKey, role);
}

const CORP_TOKEN = tokenFor("GCORP_PRIV_TEST", "corporation");
const DEV_TOKEN = tokenFor("GDEV_PRIV_TEST", "project_developer");
const VERIFIER_TOKEN = tokenFor("GVERIFIER_PRIV_TEST", "verifier");

describe("Privilege Escalation (OWASP API5)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createSecurityTestApp({ whitelist: true });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Verifier-only endpoints ────────────────────────────────────────────────

  it("corporation cannot verify a project → 403", () =>
    // VULNERABILITY: POST /projects/:id/verify has AuthGuard but no RolesGuard.
    // Any authenticated user can approve projects.
    // Fix: add @Roles('verifier', 'admin') + RolesGuard.
    request(app.getHttpServer())
      .post("/api/v1/projects/proj-001/verify")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({ verifierPublicKey: "GCORP_PRIV_TEST" })
      .expect(403));

  it("corporation cannot reject a project → 403", () =>
    request(app.getHttpServer())
      .post("/api/v1/projects/proj-001/reject")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({ verifierPublicKey: "GCORP_PRIV_TEST", reason: "fraud" })
      .expect(403));

  it("corporation cannot submit oracle monitoring data → 403", () =>
    // VULNERABILITY: POST /oracle/monitoring has AuthGuard but no RolesGuard.
    // Any authenticated user can push fake monitoring data.
    // Fix: add @Roles('verifier', 'admin') + RolesGuard.
    request(app.getHttpServer())
      .post("/api/v1/oracle/ingest/monitoring")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({ projectId: "p1", period: "2024-Q1", tonnesVerified: 9999, methodologyScore: 99, satelliteCid: "Qm1", submittedBy: "GCORP_PRIV_TEST" })
      .expect(403));

  it("corporation cannot flag a project via oracle → 403", () =>
    request(app.getHttpServer())
      .post("/api/v1/oracle/ingest/flag")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({ projectId: "p1", reason: "fraud" })
      .expect(403));

  // ── Admin-only endpoints ───────────────────────────────────────────────────

  it("corporation cannot mint credits → 403", () =>
    // VULNERABILITY: POST /credits/mint has AuthGuard but no RolesGuard.
    // Any authenticated user can mint credits for any project.
    // Fix: add @Roles('admin') + RolesGuard.
    request(app.getHttpServer())
      .post("/api/v1/credits/mint")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({ batchId: "b-priv-test", projectId: "p1", vintageYear: 2023, amount: 1000000, serialStart: "1", serialEnd: "1000000", metadataCid: "Qm1" })
      .expect(403));

  it("corporation cannot update project status → 403", () =>
    request(app.getHttpServer())
      .patch("/api/v1/projects/proj-001/status")
      .set("Authorization", `Bearer ${CORP_TOKEN}`)
      .send({ status: "Verified" })
      .expect(403));

  it("verifier cannot approve oracle price updates → 403", () =>
    // Price approvals should be admin-only
    request(app.getHttpServer())
      .post("/api/v1/oracle/price-approvals/some-id/approve")
      .set("Authorization", `Bearer ${VERIFIER_TOKEN}`)
      .expect(403));

  it("verifier cannot review verifier applications → 403", () =>
    // PATCH /verifiers/:id/review should be admin-only
    request(app.getHttpServer())
      .patch("/api/v1/verifiers/some-id/review")
      .set("Authorization", `Bearer ${VERIFIER_TOKEN}`)
      .send({ status: "Approved" })
      .expect(403));

  // ── Project developer cannot call corporation-or-higher endpoints ──────────

  it("project developer cannot purchase credits → 403", () =>
    request(app.getHttpServer())
      .post("/api/v1/marketplace/purchase")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ listingId: "l1", amount: 10, buyerPublicKey: "GDEV_PRIV_TEST" })
      .expect(403));
});
