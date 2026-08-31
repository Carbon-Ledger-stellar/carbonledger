import { PrismaClient } from '@prisma/client';
import { StructuredLogger } from '../src/logger/structured-logger';

const prisma = new PrismaClient();
const logger = new StructuredLogger('carbonledger-seed-staging');

async function main() {
  logger.info('Seeding staging database');

  // Create staging admin user
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@staging.carbonledger.com' },
    update: {},
    create: {
      email: 'admin@staging.carbonledger.com',
      name: 'Staging Admin',
      role: 'ADMIN',
      stellarPublicKey: process.env.ADMIN_PUBLIC_KEY || '',
      isVerified: true,
      createdAt: new Date(),
    },
  });

  // Create staging test users
  const testUser1 = await prisma.user.upsert({
    where: { email: 'test1@staging.carbonledger.com' },
    update: {},
    create: {
      email: 'test1@staging.carbonledger.com',
      name: 'Test User 1',
      role: 'USER',
      stellarPublicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      isVerified: true,
      createdAt: new Date(),
    },
  });

  const testUser2 = await prisma.user.upsert({
    where: { email: 'test2@staging.carbonledger.com' },
    update: {},
    create: {
      email: 'test2@staging.carbonledger.com',
      name: 'Test User 2',
      role: 'VERIFIER',
      stellarPublicKey: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
      isVerified: true,
      createdAt: new Date(),
    },
  });

  // Create staging test projects
  const testProject1 = await prisma.project.upsert({
    where: { id: 'staging-project-1' },
    update: {},
    create: {
      id: 'staging-project-1',
      name: 'Staging Forest Conservation Project',
      description: 'A test forest conservation project for staging environment validation',
      location: 'Test Forest, Staging Country',
      methodology: 'REDD+',
      status: 'APPROVED',
      totalCredits: 10000,
      availableCredits: 8500,
      pricePerCredit: 25.50,
      verificationStandard: 'GOLD_STANDARD',
      projectDeveloper: testUser1.id,
      verifier: testUser2.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const testProject2 = await prisma.project.upsert({
    where: { id: 'staging-project-2' },
    update: {},
    create: {
      id: 'staging-project-2',
      name: 'Staging Renewable Energy Project',
      description: 'A test solar energy project for staging environment validation',
      location: 'Test Solar Farm, Staging Region',
      methodology: 'CDM',
      status: 'PENDING_VERIFICATION',
      totalCredits: 5000,
      availableCredits: 5000,
      pricePerCredit: 30.00,
      verificationStandard: 'VERRA_VCS',
      projectDeveloper: testUser1.id,
      verifier: testUser2.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create staging admin configuration
  await prisma.adminConfig.upsert({
    where: { key: 'staging_environment' },
    update: { value: 'true' },
    create: {
      key: 'staging_environment',
      value: 'true',
      description: 'Indicates this is a staging environment',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.adminConfig.upsert({
    where: { key: 'contract_addresses' },
    update: {
      value: JSON.stringify({
        registry: process.env.STAGING_REGISTRY_CONTRACT_ID || '',
        credit: process.env.STAGING_CREDIT_CONTRACT_ID || '',
        marketplace: process.env.STAGING_MARKETPLACE_CONTRACT_ID || '',
        oracle: process.env.STAGING_ORACLE_CONTRACT_ID || '',
        usdc: process.env.STAGING_USDC_CONTRACT_ID || '',
      }),
    },
    create: {
      key: 'contract_addresses',
      value: JSON.stringify({
        registry: process.env.STAGING_REGISTRY_CONTRACT_ID || '',
        credit: process.env.STAGING_CREDIT_CONTRACT_ID || '',
        marketplace: process.env.STAGING_MARKETPLACE_CONTRACT_ID || '',
        oracle: process.env.STAGING_ORACLE_CONTRACT_ID || '',
        usdc: process.env.STAGING_USDC_CONTRACT_ID || '',
      }),
      description: 'Staging contract addresses on Stellar testnet',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create staging API keys for testing
  await prisma.apiKey.upsert({
    where: { name: 'staging-test-key' },
    update: {},
    create: {
      name: 'staging-test-key',
      keyHash: 'staging_test_key_hash_placeholder',
      userId: adminUser.id,
      permissions: ['READ', 'WRITE'],
      isActive: true,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      createdAt: new Date(),
    },
  });

  logger.info('Staging database seeded successfully', {
    adminUser: adminUser.email,
    testUsers: [testUser1.email, testUser2.email],
    testProjects: [testProject1.name, testProject2.name],
  });
}

main()
  .catch((e) => {
    logger.error('Error seeding staging database', e instanceof Error ? e : new Error(String(e)), {
      error: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });