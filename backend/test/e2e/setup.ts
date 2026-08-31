/**
 * E2E Test Setup & Fixtures
 * 
 * Provides test database initialization, user fixtures, and cleanup utilities
 * for end-to-end integration testing.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { AppModule } from '../../app.module';
import * as request from 'supertest';
import { Keypair, Networks } from '@stellar/stellar-sdk';

export interface E2ETestContext {
  app: INestApplication;
  prisma: PrismaService;
  baseUrl: string;
  testUser: TestUserFixture;
  testAdmin: TestUserFixture;
}

export interface TestUserFixture {
  publicKey: string;
  privateKey: string;
  keypair: Keypair;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Initialize the test application and database
 */
export async function setupE2ETest(): Promise<E2ETestModule> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  await app.init();

  const prisma = app.get<PrismaService>(PrismaService);

  // Clear test database
  await clearTestDatabase(prisma);

  // Seed initial fixtures
  await seedFixtures(prisma);

  return new E2ETestModule(app, prisma);
}

/**
 * Clean up test database - removes all test data
 */
export async function clearTestDatabase(prisma: PrismaService): Promise<void> {
  // Note: Order matters due to foreign key constraints
  const tables = [
    'VerificationEmail',
    'NotificationPreference',
    'RetirementRecord',
    'CreditBatch',
    'CarbonProject',
    'MarketListing',
    'PriceApproval',
    'OracleJob',
    'WebhookDelivery',
    'VerifierApplication',
    'IdempotencyRecord',
    'AuditLog',
    'User',
  ];

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch (error) {
      // Table might not exist in test env
      console.warn(`Could not truncate ${table}:`, error);
    }
  }
}

/**
 * Seed test fixtures - creates standard test data
 */
export async function seedFixtures(prisma: PrismaService): Promise<void> {
  // Create test users
  const projectDeveloperKeyPair = Keypair.random();
  const verifierKeyPair = Keypair.random();
  const corporationKeyPair = Keypair.random();
  const adminKeyPair = Keypair.random();

  await prisma.user.createMany({
    data: [
      {
        publicKey: projectDeveloperKeyPair.publicKey(),
        email: 'dev@test.local',
        emailVerified: true,
        role: 'project_developer',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        publicKey: verifierKeyPair.publicKey(),
        email: 'verifier@test.local',
        emailVerified: true,
        role: 'verifier',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        publicKey: corporationKeyPair.publicKey(),
        email: 'corp@test.local',
        emailVerified: true,
        role: 'corporation',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        publicKey: adminKeyPair.publicKey(),
        email: 'admin@test.local',
        emailVerified: true,
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });

  // Create test project
  await prisma.carbonProject.create({
    data: {
      projectId: 'TEST-001',
      name: 'Test Renewable Project',
      description: 'Solar energy project for testing',
      methodology: 'ACM0016',
      country: 'KE',
      projectType: 'Solar',
      vintageYear: 2024,
      methodologyScore: 85,
      status: 'Approved',
      metadataCid: 'QmTest001',
      verifierAddress: verifierKeyPair.publicKey(),
      ownerAddress: projectDeveloperKeyPair.publicKey(),
      coordinates: {
        latitude: -1.0,
        longitude: 36.0,
      },
    },
  });

  // Create test credit batch
  await prisma.creditBatch.create({
    data: {
      batchId: 'BATCH-001',
      projectId: 'TEST-001',
      vintageYear: 2024,
      amount: '1000.00',
      serialStart: 'KE-2024-000001',
      serialEnd: 'KE-2024-001000',
      status: 'Active',
      metadataCid: 'QmBatch001',
    },
  });
}

/**
 * Test module wrapper for easy access to app and database
 */
export class E2ETestModule {
  constructor(
    private app: INestApplication,
    private prisma: PrismaService,
  ) {}

  getApp(): INestApplication {
    return this.app;
  }

  getPrisma(): PrismaService {
    return this.prisma;
  }

  getRequest(): request.SuperTest<request.Test> {
    return request(this.app.getHttpServer());
  }

  async cleanup(): Promise<void> {
    await clearTestDatabase(this.prisma);
    await this.app.close();
  }
}

/**
 * Create a test user with authenticated token
 */
export async function createTestUser(
  context: E2ETestContext,
  role: 'project_developer' | 'verifier' | 'corporation' | 'admin',
): Promise<TestUserFixture> {
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  // Create user in database
  await context.prisma.user.create({
    data: {
      publicKey,
      email: `test-${role}-${Date.now()}@test.local`,
      emailVerified: true,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Generate challenge
  const challengeRes = await request(context.app.getHttpServer())
    .get(`/auth/challenge?publicKey=${publicKey}`)
    .expect(200);

  const { nonce } = challengeRes.body;

  // Sign message
  const message = `carbonledger:${nonce}`;
  const signature = keypair.sign(Buffer.from(message)).toString('base64');

  // Login and get tokens
  const loginRes = await request(context.app.getHttpServer())
    .post('/auth/verify')
    .send({
      publicKey,
      signature,
      nonce,
      role,
    })
    .expect(200);

  return {
    publicKey,
    privateKey: keypair.secret(),
    keypair,
    accessToken: loginRes.body.access_token,
    refreshToken: loginRes.body.refresh_token,
  };
}

/**
 * Helper: Make authenticated request
 */
export function makeAuthenticatedRequest(
  context: E2ETestContext,
  user: TestUserFixture,
) {
  return request(context.app.getHttpServer()).set(
    'Authorization',
    `Bearer ${user.accessToken}`,
  );
}

/**
 * Helper: Wait for async job completion
 */
export async function waitForJobCompletion(
  context: E2ETestContext,
  jobId: string,
  maxWaitMs: number = 30000,
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 500;

  while (Date.now() - startTime < maxWaitMs) {
    const job = await context.prisma.bulkJob.findUnique({
      where: { id: jobId },
    });

    if (job?.status === 'completed' || job?.status === 'failed') {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Job ${jobId} did not complete within ${maxWaitMs}ms timeout`,
  );
}

/**
 * Helper: Get database row count for assertion
 */
export async function getRowCount(
  context: E2ETestContext,
  table: string,
): Promise<number> {
  const result = await context.prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM "${table}"`,
  );
  return (result as any[])[0]?.count || 0;
}

/**
 * Helper: Verify database transaction was recorded
 */
export async function verifyAuditLog(
  context: E2ETestContext,
  action: string,
  resourceType: string,
): Promise<boolean> {
  const log = await context.prisma.auditLog.findFirst({
    where: {
      action,
      resourceType,
      createdAt: {
        gte: new Date(Date.now() - 5000), // Last 5 seconds
      },
    },
  });
  return !!log;
}

