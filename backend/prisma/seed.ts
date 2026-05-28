import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Seed a test project
  const project = await prisma.carbonProject.upsert({
    where: { projectId: "PROJ-TESTNET-001" },
    update: {},
    create: {
      projectId: "PROJ-TESTNET-001",
      name: "Amazon Rainforest Conservation",
      description: "REDD+ project protecting 50,000 hectares in the Brazilian Amazon.",
      methodology: "REDD+",
      country: "Brazil",
      projectType: "Forest Conservation",
      status: "Verified",
      vintageYear: 2024,
      totalCreditsIssued: 10000,
      totalCreditsRetired: 500,
      metadataCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      verifierAddress: "GVERIFIER000000000000000000000000000000000000000000000000",
      ownerAddress: "GOWNER0000000000000000000000000000000000000000000000000000",
      coordinates: { lat: -3.4653, lng: -62.2159 },
    },
  });

  // Seed a credit batch
  const batch = await prisma.creditBatch.upsert({
    where: { batchId: "BATCH-TESTNET-001" },
    update: {},
    create: {
      batchId: "BATCH-TESTNET-001",
      projectId: project.projectId,
      vintageYear: 2024,
      amount: 10000,
      serialStart: "CL-2024-REDD-000001",
      serialEnd: "CL-2024-REDD-010000",
      status: "Active",
      metadataCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    },
  });

  // Seed a retirement record
  const retirement = await prisma.retirementRecord.upsert({
    where: { retirementId: "RET-TESTNET-001" },
    update: {},
    create: {
      retirementId: "RET-TESTNET-001",
      batchId: batch.batchId,
      projectId: project.projectId,
      amount: 500,
      retiredBy: "GCORP00000000000000000000000000000000000000000000000000000",
      beneficiary: "Acme Corp — 2024 Carbon Neutral Commitment",
      retirementReason: "Annual ESG offset — Scope 1 emissions 2024",
      vintageYear: 2024,
      serialStart: "CL-2024-REDD-000001",
      serialEnd: "CL-2024-REDD-000500",
      serialNumbers: ["CL-2024-REDD-000001", "CL-2024-REDD-000500"],
      txHash: "0000000000000000000000000000000000000000000000000000000000000000",
      retiredAt: new Date("2024-12-31T23:59:59.000Z"),
    },
  });

  // Seed a certificate
  await prisma.certificate.upsert({
    where: { retirementId: retirement.retirementId },
    update: {},
    create: {
      retirementId: retirement.retirementId,
      publicUrl: `https://carbonledger.app/certificate/${retirement.retirementId}`,
      ipfsCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      issuedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });

  // Seed a user
  await prisma.user.upsert({
    where: { publicKey: "GCORP00000000000000000000000000000000000000000000000000000" },
    update: {},
    create: {
      publicKey: "GCORP00000000000000000000000000000000000000000000000000000",
      role: "corporation",
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
