import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { MockBlockchainProvider } from '../src/blockchain/mock.provider';

export async function createTestApp(): Promise<INestApplication> {
  // Use the mock provider for tests
  process.env.USE_MOCK_BLOCKCHAIN = 'true';
  process.env.NODE_ENV = 'test';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
  .overrideProvider('IBlockchainProvider')
  .useClass(MockBlockchainProvider)
  .compile();

  const app = moduleFixture.createNestApplication();
  await app.init();

  // Setup mock data for tests
  const mockProvider = app.get(MockBlockchainProvider);
  setupMockData(mockProvider);

  return app;
}

function setupMockData(mockProvider: MockBlockchainProvider) {
  // Set up default test accounts
  mockProvider.setAccountBalance('GCORP123', {
    native: '1000000',
    tokens: { USDC: '500000' },
  });
  mockProvider.setAccountBalance('GVERIF456', {
    native: '500000',
    tokens: { USDC: '250000' },
  });
  mockProvider.setAccountBalance('GADMIN789', {
    native: '2000000',
    tokens: { USDC: '1000000' },
  });

  // Set up contract data for credit operations
  const contractId = process.env.CARBON_CREDIT_CONTRACT_ID || 'test-contract-id';
  
  // Pre-create some batches
  const batchData = {
    batchId: 'BATCH001',
    projectId: 'PROJ001',
    amount: 1000,
    serialStart: 'KE-001-2024-0001',
    serialEnd: 'KE-001-2024-1000',
    status: 'Active',
    mintedAt: new Date().toISOString(),
  };
  mockProvider.setContractData(contractId, 'batch_BATCH001', batchData);
  mockProvider.setContractData(contractId, 'serial_KE-001-2024-0001_KE-001-2024-1000', {
    used: false,
    batchId: 'BATCH001',
  });

  // Pre-create a retirement
  const retirementData = {
    retirementId: 'RET001',
    serialStart: 'KE-001-2024-0001',
    serialEnd: 'KE-001-2024-0100',
    beneficiary: 'Test Corporation',
    retiredAt: new Date().toISOString(),
    status: 'Completed',
  };
  mockProvider.setContractData(contractId, 'retirement_RET001', retirementData);
}

export async function cleanDatabase(app: INestApplication) {
  const prisma = app.get(PrismaService);

  // Clean tables in correct order to respect foreign key constraints
  await prisma.monitoringData.deleteMany();
  await prisma.oracleJob.deleteMany();
  await prisma.oracleUpdate.deleteMany();
  await prisma.marketListing.deleteMany();
  await prisma.retirementRecord.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.creditBatch.deleteMany();
  await prisma.carbonProject.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();

  // Reset the mock provider state
  try {
    const mockProvider = app.get(MockBlockchainProvider);
    mockProvider.reset();
    setupMockData(mockProvider);
  } catch {
    // Ignore if mock provider not available
  }
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
      serialStart: 'KE-001-2024-0001',
      serialEnd: 'KE-001-2024-0100',
      serialNumbers: ['KE-001-2024-0001', 'KE-001-2024-0100'],
      txHash: '0xtest123',
      certificateStatus: 'pending_certificate',
    },
  });
}

export function getMockProvider(app: INestApplication): MockBlockchainProvider {
  return app.get(MockBlockchainProvider);
}
