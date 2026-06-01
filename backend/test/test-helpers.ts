import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

export async function cleanDatabase(app: INestApplication) {
  const prisma = app.get(PrismaService);
  
  // Clean tables in correct order to respect foreign key constraints
  await prisma.monitoringData.deleteMany();
  await prisma.oracleUpdate.deleteMany();
  await prisma.marketListing.deleteMany();
  await prisma.retirementRecord.deleteMany();
  await prisma.creditBatch.deleteMany();
  await prisma.carbonProject.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();
}

export async function seedTestData(app: INestApplication) {
  const prisma = app.get(PrismaService);

  // Create test users
  await prisma.user.createMany({
    data: [
      { publicKey: 'GCORP123', role: 'corporation' },
      { publicKey: 'GVERIF456', role: 'verifier' },
      { publicKey: 'GADMIN789', role: 'admin' },
    ],
  });

  // Create test project
  const project = await prisma.carbonProject.create({
    data: {
      projectId: 'PROJ001',
      name: 'Test Solar Project',
      description: 'Test project for integration tests',
      methodology: 'ACM0002',
      country: 'Kenya',
      projectType: 'Solar',
      status: 'Active',
      vintageYear: 2024,
      totalCreditsIssued: 1000,
      totalCreditsRetired: 100,
      metadataCid: 'QmTest123',
      verifierAddress: 'GVERIF456',
      ownerAddress: 'GCORP123',
    },
  });

  // Create test batch
  const batch = await prisma.creditBatch.create({
    data: {
      batchId: 'BATCH001',
      projectId: project.projectId,
      vintageYear: 2024,
      amount: 1000,
      serialStart: 'KE-001-2024-0001',
      serialEnd: 'KE-001-2024-1000',
      status: 'Active',
      metadataCid: 'QmBatch123',
    },
  });

  // Create test retirement
  await prisma.retirementRecord.create({
    data: {
      retirementId: 'RET001',
      batchId: batch.batchId,
      projectId: project.projectId,
      amount: 100,
      retiredBy: 'GCORP123',
      beneficiary: 'Test Corporation',
      retirementReason: 'Carbon neutrality goal',
      vintageYear: 2024,
      serialNumbers: ['KE-001-2024-0001', 'KE-001-2024-0100'],
      txHash: '0xtest123',
    },
  });
}
