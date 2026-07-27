/**
 * Security tests: IDOR — Insecure Direct Object Reference (OWASP API1)
 *
 * Covers:
 *  - Corporation A cannot delist Corporation B's marketplace listing
 *  - Retirement data is not scoped to the owning corporation
 *    (GET /retirements and GET /retirements/:id require no auth — data leak)
 *  - Export endpoints leak all retirements regardless of caller identity
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import * as jwt from "jsonwebtoken";

import { AppModule } from "../app.module";
import { PrismaService } from "../prisma.service";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function corpToken(publicKey: string) {
  return jwt.sign({ sub: publicKey, role: "corporation" }, SECRET, { expiresIn: "1h" });
}

describe("IDOR (OWASP API1)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Seed IDs — created in beforeAll, cleaned in afterAll
  const SELLER_KEY = "GSELLER_IDOR_TEST";
  const ATTACKER_KEY = "GATTACKER_IDOR_TEST";
  const LISTING_ID = "listing-idor-test-001";
  const PROJECT_ID = "proj-idor-test-001";
  const BATCH_ID = "batch-idor-test-001";
  const RETIREMENT_ID = "ret-idor-test-001";

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Seed minimal data: project → batch → listing + retirement
    await prisma.carbonProject.upsert({
      where: { projectId: PROJECT_ID },
      update: {},
      create: {
        projectId: PROJECT_ID,
        name: "IDOR Test Project",
        methodology: "VCS",
        country: "BR",
        projectType: "forestry",
        vintageYear: 2023,
        methodologyScore: 80,
        metadataCid: "QmIDOR",
        verifierAddress: "GVERIFIER",
        ownerAddress: SELLER_KEY,
      },
    });

    await prisma.creditBatch.upsert({
      where: { batchId: BATCH_ID },
      update: {},
      create: {
        batchId: BATCH_ID,
        projectId: PROJECT_ID,
        vintageYear: 2023,
        amount: 100,
        serialStart: "9000",
        serialEnd: "9099",
        metadataCid: "QmIDOR",
      },
    });

    await prisma.marketListing.upsert({
      where: { listingId: LISTING_ID },
      update: {},
      create: {
        listingId: LISTING_ID,
        projectId: PROJECT_ID,
        batchId: BATCH_ID,
        seller: SELLER_KEY,
        amountAvailable: 50,
        pricePerCredit: "10.00",
        vintageYear: 2023,
        methodology: "VCS",
        country: "BR",
        status: "Active",
      },
    });

    await prisma.retirementRecord.upsert({
      where: { retirementId: RETIREMENT_ID },
      update: {},
      create: {
        retirementId: RETIREMENT_ID,
        batchId: BATCH_ID,
        projectId: PROJECT_ID,
        amount: 10,
        retiredBy: SELLER_KEY,
        beneficiary: "Acme Corp",
        retirementReason: "ESG offset",
        vintageYear: 2023,
        serialNumbers: ["9000", "9001"],
        txHash: "deadbeef",
      },
    });
  });

  afterAll(async () => {
    await prisma.retirementRecord.deleteMany({ where: { retirementId: RETIREMENT_ID } });
    await prisma.marketListing.deleteMany({ where: { listingId: LISTING_ID } });
    await prisma.creditBatch.deleteMany({ where: { batchId: BATCH_ID } });
    await prisma.carbonProject.deleteMany({ where: { projectId: PROJECT_ID } });
    await app.close();
  });

  // ── Listing ownership ──────────────────────────────────────────────────────

  it("attacker cannot delist another seller's listing → 403", () =>
    // VULNERABILITY: delistListing() has no ownership check.
    // Any authenticated user can delist any listing.
    // Fix: compare listing.seller against req.user.publicKey.
    request(app.getHttpServer())
      .delete(`/marketplace/${LISTING_ID}`)
      .set("Authorization", `Bearer ${corpToken(ATTACKER_KEY)}`)
      .expect(403));

  it("owner can delist their own listing → 200", () =>
    request(app.getHttpServer())
      .delete(`/marketplace/${LISTING_ID}`)
      .set("Authorization", `Bearer ${corpToken(SELLER_KEY)}`)
      .expect(200));

  // ── Retirement data scoping ────────────────────────────────────────────────

  it("GET /retirements requires authentication → 401", () =>
    // VULNERABILITY: GET /retirements has no @UseGuards — all retirement data
    // is publicly accessible without any token.
    // Fix: add @UseGuards(AuthGuard('jwt')) and scope to req.user.publicKey.
    request(app.getHttpServer())
      .get("/retirements")
      .expect(401));

  it("GET /retirements/:id requires authentication → 401", () =>
    request(app.getHttpServer())
      .get(`/retirements/${RETIREMENT_ID}`)
      .expect(401));

  it("corporation cannot read another corporation's retirement → 403", () =>
    // After auth is added, attacker should get 403 for a retirement they don't own.
    request(app.getHttpServer())
      .get(`/retirements/${RETIREMENT_ID}`)
      .set("Authorization", `Bearer ${corpToken(ATTACKER_KEY)}`)
      .expect(403));

  it("owner can read their own retirement → 200", () =>
    request(app.getHttpServer())
      .get(`/retirements/${RETIREMENT_ID}`)
      .set("Authorization", `Bearer ${corpToken(SELLER_KEY)}`)
      .expect(200));

  // ── Export scoping ─────────────────────────────────────────────────────────

  it("GET /retirements/export/csv scopes to caller's retirements only", async () => {
    const res = await request(app.getHttpServer())
      .get("/retirements/export/csv")
      .set("Authorization", `Bearer ${corpToken(ATTACKER_KEY)}`)
      .expect(200);

    // The CSV must not contain the seller's retirement
    expect(res.text).not.toContain(RETIREMENT_ID);
  });
});
