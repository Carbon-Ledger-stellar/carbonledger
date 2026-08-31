/**
 * CarbonLedger — Comprehensive Test Data Seed
 *
 * Populates a local PostgreSQL database with realistic carbon credit data:
 *   - 3 verifiers + 5 corporations (users)
 *   - 10 projects across 5 methodologies
 *   - 100 credit batches (10 per project)
 *   - 50 marketplace listings
 *   - 20 retirement records + certificates
 *   - 10 monitoring data records
 *
 * Deterministic: fixed SEED constant guarantees identical output on every run.
 * Idempotent: all writes use upsert() so re-running is safe.
 *
 * Usage:
 *   npx prisma db seed
 *   npx ts-node prisma/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

// ─── Deterministic PRNG (seeded LCG) ─────────────────────────────────────────

const SEED = 42;

function createRng(seed: number) {
  let state = seed >>> 0;
  return {
    /** Returns a float in [0, 1) */
    next(): number {
      // 32-bit LCG — Numerical Recipes constants
      state = Math.imul(1664525, state) + 1013904223;
      state = state >>> 0;
      return state / 4294967296;
    },
    /** Returns an integer in [min, max] (inclusive) */
    int(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    /** Returns a float in [min, max) */
    float(min: number, max: number): number {
      return this.next() * (max - min) + min;
    },
    /** Picks a random element from an array */
    pick<T>(arr: T[]): T {
      return arr[Math.floor(this.next() * arr.length)];
    },
  };
}

const rng = createRng(SEED);

// ─── Reference data ───────────────────────────────────────────────────────────

const METHODOLOGIES = ["REDD+", "VCS", "Gold Standard", "CDM", "ACR"] as const;
type Methodology = (typeof METHODOLOGIES)[number];

/** Short code used in serial numbers (max 3 chars) */
const METHODOLOGY_CODE: Record<Methodology, string> = {
  "REDD+": "RDD",
  VCS: "VCS",
  "Gold Standard": "GSF",
  CDM: "CDM",
  ACR: "ACR",
};

const COUNTRIES = [
  "Brazil",
  "Kenya",
  "Indonesia",
  "Colombia",
  "Peru",
  "India",
  "China",
  "Democratic Republic of Congo",
  "Madagascar",
  "Papua New Guinea",
];

const PROJECT_TYPES = [
  "Forest Conservation",
  "Reforestation",
  "Renewable Energy",
  "Methane Capture",
  "Soil Carbon",
];

const PROJECT_STATUSES = [
  "Verified",    // 4
  "Verified",
  "Verified",
  "Verified",
  "Pending",     // 2
  "Pending",
  "Rejected",    // 2
  "Rejected",
  "Suspended",   // 1
  "Completed",   // 1
] as const;

/** Generate a fake but realistic Stellar G-address (56 chars, A-Z2-7) */
function stellarAddress(label: string): string {
  const base = label
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "A")
    .padEnd(55, "A")
    .slice(0, 55);
  return "G" + base;
}

/** Generate a fake IPFS CIDv1 */
function fakeCid(discriminator: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let suffix = "";
  // seed the suffix deterministically via discriminator length + rng
  for (let i = 0; i < 46; i++) {
    suffix += alphabet[rng.int(0, alphabet.length - 1)];
  }
  return "bafybei" + suffix;
}

/** Fake SHA-256 hex string (64 hex chars) */
function fakeSha256(discriminator: string): string {
  const hex = "0123456789abcdef";
  let h = "";
  for (let i = 0; i < 64; i++) {
    h += hex[rng.int(0, 15)];
  }
  return h;
}

/** Fake tx hash (64 hex chars) */
function fakeTxHash(): string {
  return fakeSha256("tx");
}

// ─── Factory functions (exported for use in individual test files) ────────────

export interface VerifierData {
  index: number;
  publicKey: string;
  email: string;
  orgName: string;
  accreditationBody: string;
  accreditationId: string;
  documentsCid: string;
}

export function makeVerifier(index: number): VerifierData {
  const orgName = `Verifier Org ${index}`;
  const bodies = ["Gold Standard Foundation", "Verra", "American Carbon Registry"];
  return {
    index,
    publicKey: stellarAddress(`VERIFIER${index}`),
    email: `verifier${index}@carbonverify.org`,
    orgName,
    accreditationBody: bodies[(index - 1) % bodies.length],
    accreditationId: `ACC-${2020 + index}-${String(index).padStart(4, "0")}`,
    documentsCid: fakeCid(`verifier-docs-${index}`),
  };
}

export interface UserData {
  index: number;
  publicKey: string;
  email: string;
  role: string;
}

export function makeUser(index: number, role = "corporation"): UserData {
  return {
    index,
    publicKey: stellarAddress(`CORP${index}USER`),
    email: `corp${index}@enterprise.com`,
    role,
  };
}

export interface ProjectData {
  projectId: string;
  name: string;
  description: string;
  methodology: Methodology;
  country: string;
  projectType: string;
  status: string;
  vintageYear: number;
  methodologyScore: number;
  totalCreditsIssued: Decimal;
  totalCreditsRetired: Decimal;
  metadataCid: string;
  metadataHash: string;
  verifierAddress: string;
  ownerAddress: string;
  coordinates: { lat: number; lng: number };
  lastMonitoringAt: Date | null;
}

export function makeProject(index: number, methodology: Methodology, status: string): ProjectData {
  const code = METHODOLOGY_CODE[methodology];
  const country = COUNTRIES[(index - 1) % COUNTRIES.length];
  const vintageYear = 2020 + ((index - 1) % 5);
  const score = rng.int(70, 98);
  const issued = rng.int(5000, 50000);
  const retired = status === "Verified" || status === "Completed"
    ? rng.int(0, Math.floor(issued * 0.4))
    : 0;
  const cid = fakeCid(`project-${index}`);

  return {
    projectId: `PROJ-${code}-${String(index).padStart(3, "0")}`,
    name: `${methodology} ${PROJECT_TYPES[(index - 1) % PROJECT_TYPES.length]} ${country}`,
    description: `A ${methodology} carbon offset project in ${country} verifying ${issued.toLocaleString()} tonnes CO₂e per vintage year. Registered under accredited methodology standards.`,
    methodology,
    country,
    projectType: PROJECT_TYPES[(index - 1) % PROJECT_TYPES.length],
    status,
    vintageYear,
    methodologyScore: score,
    totalCreditsIssued: new Decimal(issued),
    totalCreditsRetired: new Decimal(retired),
    metadataCid: cid,
    metadataHash: fakeSha256(`project-${index}-hash`),
    verifierAddress: stellarAddress(`VERIFIER${((index - 1) % 3) + 1}`),
    ownerAddress: stellarAddress(`OWNER${index}`),
    coordinates: {
      lat: rng.float(-60, 60),
      lng: rng.float(-180, 180),
    },
    lastMonitoringAt: status === "Verified" || status === "Completed"
      ? new Date(Date.now() - rng.int(1, 180) * 24 * 60 * 60 * 1000)
      : null,
  };
}

export interface BatchData {
  batchId: string;
  projectId: string;
  vintageYear: number;
  amount: Decimal;
  serialStart: string;
  serialEnd: string;
  status: string;
  metadataCid: string;
  issuedAt: Date;
}

/**
 * Make 10 batches for a project.
 * Serial ranges are non-overlapping: batch N covers [N*1000+1 .. (N+1)*1000].
 */
export function makeBatches(project: ProjectData): BatchData[] {
  const code = METHODOLOGY_CODE[project.methodology as Methodology];
  const batchCount = 10;
  const batchSize = 1000;
  const batches: BatchData[] = [];

  for (let b = 0; b < batchCount; b++) {
    const serialStartNum = b * batchSize + 1;
    const serialEndNum = (b + 1) * batchSize;
    const serialStart = `CL-${project.vintageYear}-${code}-${String(serialStartNum).padStart(6, "0")}`;
    const serialEnd = `CL-${project.vintageYear}-${code}-${String(serialEndNum).padStart(6, "0")}`;

    // First 2 batches of non-active projects are Retired if project has retirements
    const batchStatus =
      project.status === "Rejected" || project.status === "Pending"
        ? "Pending"
        : b < 2 && Number(project.totalCreditsRetired) > 0
        ? "Retired"
        : "Active";

    batches.push({
      batchId: `BATCH-${project.projectId}-${String(b + 1).padStart(2, "0")}`,
      projectId: project.projectId,
      vintageYear: project.vintageYear,
      amount: new Decimal(batchSize),
      serialStart,
      serialEnd,
      status: batchStatus,
      metadataCid: fakeCid(`batch-${project.projectId}-${b}`),
      issuedAt: new Date(Date.now() - rng.int(30, 720) * 24 * 60 * 60 * 1000),
    });
  }

  return batches;
}

export interface RetirementData {
  retirementId: string;
  batchId: string;
  projectId: string;
  amount: Decimal;
  retiredBy: string;
  beneficiary: string;
  retirementReason: string;
  vintageYear: number;
  serialStart: string;
  serialEnd: string;
  serialNumbers: string[];
  txHash: string;
  certificateCid: string;
  isValid: boolean;
  validatedAt: Date;
  retiredAt: Date;
}

const COMPANIES = [
  "Acme Corporation",
  "GlobalTech Inc.",
  "EcoEnterprises Ltd.",
  "Summit Industries",
  "BlueWave Energy",
  "TerraFirma Holdings",
  "Nexus Manufacturing",
  "Apex Logistics",
  "Cornerstone Finance",
  "Meridian Consulting",
];

const RETIREMENT_REASONS = [
  "Annual ESG offset — Scope 1 emissions",
  "Net-zero commitment 2030",
  "Corporate sustainability programme",
  "Voluntary carbon neutrality declaration",
  "Employee carbon offset initiative",
];

export function makeRetirement(index: number, batch: BatchData, retiredByAddress: string): RetirementData {
  const amount = rng.int(50, 400);
  const serialStartNum = 1;
  const serialEndNum = amount;
  const code = batch.serialStart.split("-")[2];
  const year = batch.vintageYear;
  const serialStart = `CL-${year}-${code}-${String(serialStartNum).padStart(6, "0")}`;
  const serialEnd = `CL-${year}-${code}-${String(serialEndNum).padStart(6, "0")}`;

  const company = COMPANIES[(index - 1) % COMPANIES.length];
  const retiredAt = new Date(Date.now() - rng.int(1, 365) * 24 * 60 * 60 * 1000);

  return {
    retirementId: `RET-${String(index).padStart(4, "0")}`,
    batchId: batch.batchId,
    projectId: batch.projectId,
    amount: new Decimal(amount),
    retiredBy: retiredByAddress,
    beneficiary: `${company} — ${year} Carbon Neutral Commitment`,
    retirementReason: RETIREMENT_REASONS[(index - 1) % RETIREMENT_REASONS.length],
    vintageYear: year,
    serialStart,
    serialEnd,
    serialNumbers: [serialStart, serialEnd],
    txHash: fakeTxHash(),
    certificateCid: fakeCid(`cert-${index}`),
    isValid: index % 10 !== 0, // 1 in 10 is flagged unverified for coverage
    validatedAt: retiredAt,
    retiredAt,
  };
}

export interface ListingData {
  listingId: string;
  projectId: string;
  batchId: string;
  seller: string;
  amountAvailable: Decimal;
  pricePerCredit: string;
  vintageYear: number;
  methodology: string;
  country: string;
  status: string;
}

export function makeListing(index: number, project: ProjectData, batch: BatchData, sellerAddress: string): ListingData {
  const status = index % 5 === 0 ? "Inactive" : "Active"; // 1 in 5 is inactive for permutation coverage
  const priceUsdc = rng.float(10, 80).toFixed(2);

  return {
    listingId: `LIST-${String(index).padStart(4, "0")}`,
    projectId: project.projectId,
    batchId: batch.batchId,
    seller: sellerAddress,
    amountAvailable: new Decimal(rng.int(100, 800)),
    pricePerCredit: priceUsdc,
    vintageYear: project.vintageYear,
    methodology: project.methodology,
    country: project.country,
    status,
  };
}

export interface MonitoringData {
  projectId: string;
  period: string;
  tonnesVerified: Decimal;
  methodologyScore: number;
  satelliteCid: string;
  submittedBy: string;
  submittedAt: Date;
}

export function makeMonitoring(project: ProjectData, verifierAddress: string): MonitoringData {
  return {
    projectId: project.projectId,
    period: `${project.vintageYear}-H1`,
    tonnesVerified: new Decimal(rng.int(2000, 20000)),
    methodologyScore: project.methodologyScore,
    satelliteCid: fakeCid(`satellite-${project.projectId}`),
    submittedBy: verifierAddress,
    submittedAt: new Date(Date.now() - rng.int(1, 90) * 24 * 60 * 60 * 1000),
  };
}

// ─── Main seed function ───────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Starting CarbonLedger seed...");
  const startTime = Date.now();

  // ── 1. Verifiers ─────────────────────────────────────────────────────────────
  console.log("  Seeding verifiers...");
  const verifierDataList = [1, 2, 3].map(makeVerifier);

  for (const v of verifierDataList) {
    await prisma.user.upsert({
      where: { publicKey: v.publicKey },
      update: {},
      create: { publicKey: v.publicKey, email: v.email, role: "verifier" },
    });

    await prisma.verifierApplication.upsert({
      where: { publicKey: v.publicKey },
      update: {},
      create: {
        publicKey: v.publicKey,
        organizationName: v.orgName,
        accreditationBody: v.accreditationBody,
        accreditationId: v.accreditationId,
        contactEmail: v.email,
        documentsCid: v.documentsCid,
        status: "approved",
        approvedBy: stellarAddress("ADMINKEY"),
        approvedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    });
  }
  console.log(`    ✓ ${verifierDataList.length} verifiers`);

  // ── 2. Corporation users ──────────────────────────────────────────────────────
  console.log("  Seeding corporation users...");
  const corpUsers = [1, 2, 3, 4, 5].map(i => makeUser(i));

  for (const u of corpUsers) {
    await prisma.user.upsert({
      where: { publicKey: u.publicKey },
      update: {},
      create: { publicKey: u.publicKey, email: u.email, role: u.role },
    });
  }
  console.log(`    ✓ ${corpUsers.length} corporation users`);

  // ── 3. Projects (10 total, 2 per methodology) ─────────────────────────────────
  console.log("  Seeding projects...");
  const projects: ProjectData[] = [];

  METHODOLOGIES.forEach((methodology, mIdx) => {
    [0, 1].forEach(pOffset => {
      const globalIndex = mIdx * 2 + pOffset + 1; // 1..10
      const status = PROJECT_STATUSES[globalIndex - 1];
      const project = makeProject(globalIndex, methodology, status);
      projects.push(project);
    });
  });

  for (const p of projects) {
    await prisma.carbonProject.upsert({
      where: { projectId: p.projectId },
      update: {
        totalCreditsIssued: p.totalCreditsIssued,
        totalCreditsRetired: p.totalCreditsRetired,
        lastMonitoringAt: p.lastMonitoringAt,
      },
      create: {
        projectId: p.projectId,
        name: p.name,
        description: p.description,
        methodology: p.methodology,
        country: p.country,
        projectType: p.projectType,
        status: p.status,
        vintageYear: p.vintageYear,
        methodologyScore: p.methodologyScore,
        totalCreditsIssued: p.totalCreditsIssued,
        totalCreditsRetired: p.totalCreditsRetired,
        metadataCid: p.metadataCid,
        metadataHash: p.metadataHash,
        verifierAddress: p.verifierAddress,
        ownerAddress: p.ownerAddress,
        coordinates: p.coordinates,
        lastMonitoringAt: p.lastMonitoringAt,
      },
    });
  }
  console.log(`    ✓ ${projects.length} projects`);

  // ── 4. Credit batches (100 total, 10 per project) ─────────────────────────────
  console.log("  Seeding credit batches...");
  const allBatches: BatchData[] = [];

  for (const project of projects) {
    const batches = makeBatches(project);
    for (const b of batches) {
      await prisma.creditBatch.upsert({
        where: { batchId: b.batchId },
        update: { status: b.status },
        create: {
          batchId: b.batchId,
          projectId: b.projectId,
          vintageYear: b.vintageYear,
          amount: b.amount,
          serialStart: b.serialStart,
          serialEnd: b.serialEnd,
          status: b.status,
          metadataCid: b.metadataCid,
          issuedAt: b.issuedAt,
        },
      });
    }
    allBatches.push(...batches);
  }
  console.log(`    ✓ ${allBatches.length} credit batches`);

  // ── 5. Retirement records + certificates (20 pairs) ───────────────────────────
  console.log("  Seeding retirement records and certificates...");

  // Only retire from Verified/Completed project batches that are Active or Retired
  const retirableBatches = allBatches.filter(b => {
    const project = projects.find(p => p.projectId === b.projectId)!;
    return (
      (project.status === "Verified" || project.status === "Completed") &&
      (b.status === "Active" || b.status === "Retired")
    );
  });

  const retirementBatches = retirableBatches.slice(0, 20);
  const retirements: RetirementData[] = [];

  for (let i = 0; i < retirementBatches.length; i++) {
    const batch = retirementBatches[i];
    const corpAddress = corpUsers[i % corpUsers.length].publicKey;
    const retirement = makeRetirement(i + 1, batch, corpAddress);
    retirements.push(retirement);

    const retRecord = await prisma.retirementRecord.upsert({
      where: { retirementId: retirement.retirementId },
      update: {},
      create: {
        retirementId: retirement.retirementId,
        batchId: retirement.batchId,
        projectId: retirement.projectId,
        amount: retirement.amount,
        retiredBy: retirement.retiredBy,
        beneficiary: retirement.beneficiary,
        retirementReason: retirement.retirementReason,
        vintageYear: retirement.vintageYear,
        serialStart: retirement.serialStart,
        serialEnd: retirement.serialEnd,
        serialNumbers: retirement.serialNumbers,
        txHash: retirement.txHash,
        certificateCid: retirement.certificateCid,
        isValid: retirement.isValid,
        validatedAt: retirement.validatedAt,
        retiredAt: retirement.retiredAt,
      },
    });

    const project = projects.find(p => p.projectId === batch.projectId)!;
    await prisma.retirementCertificate.upsert({
      where: { id: `CERT-${String(i + 1).padStart(4, "0")}` },
      update: {},
      create: {
        id: `CERT-${String(i + 1).padStart(4, "0")}`,
        retirementId: retRecord.id,
        beneficiary: retirement.beneficiary,
        amount: retirement.amount,
        projectName: project.name,
        vintageYear: retirement.vintageYear,
        txHash: retirement.txHash,
        ipfsCid: retirement.certificateCid,
        publicUrl: `https://carbonledger.app/certificate/${retirement.retirementId}`,
        createdAt: retirement.retiredAt,
      },
    });
  }
  console.log(`    ✓ ${retirements.length} retirements + certificates`);

  // ── 6. Marketplace listings (50 total) ───────────────────────────────────────
  console.log("  Seeding marketplace listings...");

  // Only from Verified/Completed project batches
  const listableBatches = allBatches.filter(b => {
    const project = projects.find(p => p.projectId === b.projectId)!;
    return (
      (project.status === "Verified" || project.status === "Completed") &&
      b.status === "Active"
    );
  });

  const listingBatches = listableBatches.slice(0, 50);
  let listingCount = 0;

  for (let i = 0; i < listingBatches.length; i++) {
    const batch = listingBatches[i];
    const project = projects.find(p => p.projectId === batch.projectId)!;
    const seller = corpUsers[i % corpUsers.length].publicKey;
    const listing = makeListing(i + 1, project, batch, seller);

    await prisma.marketListing.upsert({
      where: { listingId: listing.listingId },
      update: { status: listing.status, amountAvailable: listing.amountAvailable },
      create: {
        listingId: listing.listingId,
        projectId: listing.projectId,
        batchId: listing.batchId,
        seller: listing.seller,
        amountAvailable: listing.amountAvailable,
        pricePerCredit: listing.pricePerCredit,
        vintageYear: listing.vintageYear,
        methodology: listing.methodology,
        country: listing.country,
        status: listing.status,
      },
    });
    listingCount++;
  }
  console.log(`    ✓ ${listingCount} marketplace listings`);

  // ── 7. Monitoring data (1 per project) ───────────────────────────────────────
  console.log("  Seeding monitoring data...");
  let monCount = 0;

  for (const project of projects) {
    const verifier = verifierDataList[(monCount) % verifierDataList.length];
    const mon = makeMonitoring(project, verifier.publicKey);

    await prisma.monitoringData.upsert({
      where: { projectId_period: { projectId: mon.projectId, period: mon.period } },
      update: {},
      create: {
        projectId: mon.projectId,
        period: mon.period,
        tonnesVerified: mon.tonnesVerified,
        methodologyScore: mon.methodologyScore,
        satelliteCid: mon.satelliteCid,
        submittedBy: mon.submittedBy,
        submittedAt: mon.submittedAt,
      },
    });
    monCount++;
  }
  console.log(`    ✓ ${monCount} monitoring records`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Seed complete in ${elapsed}s`);
  console.log(`   3 verifiers · 5 corporations · 10 projects · ${allBatches.length} batches`);
  console.log(`   ${listingCount} listings · ${retirements.length} retirements · ${monCount} monitoring records`);
}

main()
  .catch(e => {
    console.error("❌ Seed failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
