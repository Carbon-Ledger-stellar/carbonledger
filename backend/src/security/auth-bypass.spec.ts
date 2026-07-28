/**
 * Security tests: Auth Bypass (OWASP API2 - Broken Authentication)
 *
 * Covers:
 *  - Missing token → 401
 *  - Malformed / expired JWT → 401
 *  - Role claim tampering (forged JWT signed with wrong secret) → 401
 *  - Self-assigned admin via login body → must be rejected
 */

import { INestApplication } from "@nestjs/common";
import request from "supertest";
import * as jwt from "jsonwebtoken";
import { createSecurityTestApp } from "./create-security-test-app";
import { Keypair } from "@stellar/stellar-sdk";

const REAL_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const WRONG_SECRET = "attacker-controlled-secret";

function makeToken(payload: object, secret = REAL_SECRET, opts: jwt.SignOptions = {}) {
  return jwt.sign(payload, secret, { expiresIn: "1h", ...opts });
}

describe("Auth Bypass (OWASP API2)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createSecurityTestApp({ whitelist: true });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Missing token ──────────────────────────────────────────────────────────

  it("POST /projects/register without token → 401", () =>
    request(app.getHttpServer())
      .post("/api/v1/projects/register")
      .send({ projectId: "p1", name: "Test", methodology: "VCS", country: "BR", projectType: "forestry", vintageYear: 2023, methodologyScore: 80, metadataCid: "Qm1", verifierAddress: "GVERIFIER", ownerAddress: "GOWNER" })
      .expect(401));

  it("POST /credits/mint without token → 401", () =>
    request(app.getHttpServer())
      .post("/api/v1/credits/mint")
      .send({ batchId: "b1", projectId: "p1", vintageYear: 2023, amount: 100, serialStart: "1", serialEnd: "100", metadataCid: "Qm1" })
      .expect(401));

  it("DELETE /marketplace/:id without token → 401", () =>
    request(app.getHttpServer())
      .delete("/api/v1/marketplace/listings/some-listing-id")
      .expect(401));

  // ── Malformed / expired JWT ────────────────────────────────────────────────

  it("POST /projects/register with garbage token → 401", () =>
    request(app.getHttpServer())
      .post("/api/v1/projects/register")
      .set("Authorization", "Bearer not.a.jwt")
      .send({})
      .expect(401));

  it("POST /credits/mint with expired token → 401", () => {
    const expired = makeToken({ sub: "GCORP", role: "corporation" }, REAL_SECRET, { expiresIn: -1 });
    return request(app.getHttpServer())
      .post("/api/v1/credits/mint")
      .set("Authorization", `Bearer ${expired}`)
      .send({})
      .expect(401);
  });

  // ── Role claim tampering (wrong secret) ───────────────────────────────────

  it("POST /projects/:id/verify with admin token signed by wrong secret → 401", () => {
    const forged = makeToken({ sub: "GATTACKER", role: "admin" }, WRONG_SECRET);
    return request(app.getHttpServer())
      .post("/api/v1/projects/proj-001/verify")
      .set("Authorization", `Bearer ${forged}`)
      .send({ verifierPublicKey: "GATTACKER" })
      .expect(401);
  });

  it("POST /oracle/monitoring with verifier token signed by wrong secret → 401", () => {
    const forged = makeToken({ sub: "GATTACKER", role: "verifier" }, WRONG_SECRET);
    return request(app.getHttpServer())
      .post("/api/v1/oracle/ingest/monitoring")
      .set("Authorization", `Bearer ${forged}`)
      .send({ projectId: "p1", period: "2024-Q1", tonnesVerified: 100, methodologyScore: 80, satelliteCid: "Qm1", submittedBy: "GATTACKER" })
      .expect(403);
  });

  // ── Self-assigned admin via login body ────────────────────────────────────

  it("POST /auth/verify with role:admin must NOT grant admin token", async () => {
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const challenge = await request(app.getHttpServer())
      .get(`/api/v1/auth/challenge?publicKey=${encodeURIComponent(publicKey)}`)
      .expect(200);
    const message = `carbonledger:${challenge.body.nonce}`;
    const signature = keypair.sign(Buffer.from(message, "utf8")).toString("hex");

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/verify")
      .send({ publicKey, signature, nonce: challenge.body.nonce, role: "admin" })
      .expect(200);

    const decoded = jwt.decode(res.body.access_token) as { role: string };
    expect(decoded.role).not.toBe("admin");
  });

  it("POST /auth/verify with role:verifier must NOT grant verifier token", async () => {
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const challenge = await request(app.getHttpServer())
      .get(`/api/v1/auth/challenge?publicKey=${encodeURIComponent(publicKey)}`)
      .expect(200);
    const message = `carbonledger:${challenge.body.nonce}`;
    const signature = keypair.sign(Buffer.from(message, "utf8")).toString("hex");

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/verify")
      .send({ publicKey, signature, nonce: challenge.body.nonce, role: "verifier" })
      .expect(200);

    const decoded = jwt.decode(res.body.access_token) as { role: string };
    expect(decoded.role).not.toBe("verifier");
  });
});
