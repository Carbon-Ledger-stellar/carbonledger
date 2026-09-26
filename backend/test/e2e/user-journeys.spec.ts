/**
 * End-to-End User Journey Tests
 * 
 * Tests complete user workflows:
 * 1. Project Registration Flow
 * 2. Credit Purchase Flow
 * 3. Credit Retirement Flow
 */

import {
  setupE2ETest,
  E2ETestContext,
  createTestUser,
  makeAuthenticatedRequest,
  clearTestDatabase,
  waitForJobCompletion,
  getRowCount,
  verifyAuditLog,
} from './setup';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';

describe('E2E User Journeys', () => {
  let context: E2ETestContext;
  let app: INestApplication;

  beforeAll(async () => {
    const testModule = await setupE2ETest();
    app = testModule.getApp();
    context = {
      app,
      prisma: testModule.getPrisma(),
      baseUrl: 'http://localhost:3000',
      testUser: await createTestUser(context, 'corporation'),
      testAdmin: await createTestUser(context, 'admin'),
    } as any;
  });

  afterAll(async () => {
    await context.prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    // Clear test-specific data but keep fixtures
    await clearTestDatabase(context.prisma);
  });

  describe('Project Registration Flow', () => {
    it('should complete full project registration workflow', async () => {
      // 1. User registers project
      const projectDeveloper = await createTestUser(context, 'project_developer');
      const verifier = await createTestUser(context, 'verifier');

      const registerRes = await makeAuthenticatedRequest(context, projectDeveloper)
        .post('/projects')
        .send({
          projectId: 'SOLAR-001',
          name: 'Solar Farm Project',
          description: 'Large scale solar farm in Kenya',
          methodology: 'ACM0016',
          country: 'KE',
          projectType: 'Solar',
          vintageYear: 2024,
          methodologyScore: 85,
          coordinates: {
            latitude: -1.0,
            longitude: 36.0,
          },
        })
        .expect(201);

      const projectId = registerRes.body.id;
      expect(projectId).toBeDefined();

      // 2. Verify database record created
      const projectCount = await getRowCount(context, 'CarbonProject');
      expect(projectCount).toBeGreaterThan(0);

      // 3. Verify project is in Pending status
      const project = await context.prisma.carbonProject.findUnique({
        where: { id: projectId },
      });
      expect(project?.status).toBe('Pending');

      // 4. Verifier approves project
      const approveRes = await makeAuthenticatedRequest(context, verifier)
        .post(`/projects/${projectId}/verify`)
        .send({
          verifierPublicKey: verifier.publicKey,
        })
        .expect(200);

      expect(approveRes.body.status).toBe('Approved');

      // 5. Verify audit log
      const auditLogged = await verifyAuditLog(
        context,
        'UPDATE',
        'CarbonProject',
      );
      expect(auditLogged).toBe(true);
    });

    it('should reject invalid project registration', async () => {
      const projectDeveloper = await createTestUser(context, 'project_developer');

      // Missing required fields
      await makeAuthenticatedRequest(context, projectDeveloper)
        .post('/projects')
        .send({
          projectId: 'INVALID-001',
          name: 'Invalid Project',
          // Missing required fields
        })
        .expect(400);
    });
  });

  describe('Credit Lifecycle Flow', () => {
    it('should complete mint -> purchase -> retire workflow', async () => {
      const admin = await createTestUser(context, 'admin');
      const corporation = await createTestUser(context, 'corporation');
      const developer = await createTestUser(context, 'project_developer');

      // Setup: Create and approve project
      const projectRes = await makeAuthenticatedRequest(context, developer)
        .post('/projects')
        .send({
          projectId: 'FLOW-001',
          name: 'Test Project',
          description: 'For testing workflows',
          methodology: 'ACM0016',
          country: 'KE',
          projectType: 'Solar',
          vintageYear: 2024,
          methodologyScore: 85,
        })
        .expect(201);

      const projectId = projectRes.body.id;

      await makeAuthenticatedRequest(context, admin)
        .post(`/projects/${projectId}/verify`)
        .send({
          verifierPublicKey: admin.publicKey,
        })
        .expect(200);

      // Step 1: Mint credits (Admin only)
      const mintRes = await makeAuthenticatedRequest(context, admin)
        .post('/credits/mint')
        .send({
          projectId: 'FLOW-001',
          amount: '1000.00',
          vintageYear: 2024,
          serialStart: 'KE-2024-000001',
          serialEnd: 'KE-2024-001000',
        })
        .expect(201);

      const batchId = mintRes.body.batchId;
      expect(batchId).toBeDefined();

      // Verify batch created
      const batchCount = await getRowCount(context, 'CreditBatch');
      expect(batchCount).toBeGreaterThan(0);

      // Step 2: Get batch details (Public endpoint)
      await request(app.getHttpServer())
        .get(`/credits/batch/${batchId}`)
        .expect(200)
        .then((res) => {
          expect(res.body.projectId).toBe('FLOW-001');
          expect(res.body.amount).toBe('1000.00');
          expect(res.body.status).toBe('Active');
        });

      // Step 3: Retire credits
      const retireRes = await makeAuthenticatedRequest(context, corporation)
        .post('/retirements')
        .send({
          batchId,
          amount: '100.00',
          beneficiary: 'Test Corporation',
          retirementReason: 'Carbon offset',
        })
        .expect(201);

      const retirementId = retireRes.body.retirementId;
      expect(retirementId).toBeDefined();

      // Step 4: Verify retirement recorded
      const retirementCount = await getRowCount(context, 'RetirementRecord');
      expect(retirementCount).toBeGreaterThan(0);

      // Step 5: Get retirement record
      await makeAuthenticatedRequest(context, corporation)
        .get(`/retirements/${retirementId}`)
        .expect(200)
        .then((res) => {
          expect(res.body.batchId).toBe(batchId);
          expect(res.body.amount).toBe('100.00');
          expect(res.body.status).toBe('Active');
        });
    });

    it('should handle bulk retirement', async () => {
      const admin = await createTestUser(context, 'admin');
      const corporation = await createTestUser(context, 'corporation');

      // Setup: Create batch
      const batchRes = await makeAuthenticatedRequest(context, admin)
        .post('/credits/batch-mint')
        .send({
          batches: [
            {
              projectId: 'BULK-001',
              amount: '1000.00',
              vintageYear: 2024,
              serialStart: 'KE-2024-000001',
              serialEnd: 'KE-2024-001000',
            },
          ],
        })
        .expect(201);

      const batchId = batchRes.body[0].batchId;

      // Bulk retire
      const bulkRetireRes = await makeAuthenticatedRequest(context, corporation)
        .post('/retirements/bulk')
        .send({
          retirements: [
            {
              batchId,
              amount: '100.00',
              beneficiary: 'Corp 1',
              retirementReason: 'Offset',
            },
            {
              batchId,
              amount: '200.00',
              beneficiary: 'Corp 2',
              retirementReason: 'Offset',
            },
          ],
        })
        .expect(202); // Async job

      const jobId = bulkRetireRes.body.jobId;
      expect(jobId).toBeDefined();

      // Wait for job completion
      await waitForJobCompletion(context, jobId);

      // Verify 2 retirements created
      const retirementCount = await getRowCount(context, 'RetirementRecord');
      expect(retirementCount).toBe(2);
    });
  });

  describe('Error Scenarios', () => {
    it('should prevent unauthorized project access', async () => {
      const otherUser = await createTestUser(context, 'corporation');
      const developer = await createTestUser(context, 'project_developer');

      // Developer creates project
      const projectRes = await makeAuthenticatedRequest(context, developer)
        .post('/projects')
        .send({
          projectId: 'AUTH-001',
          name: 'Private Project',
          description: 'Should not be accessible',
          methodology: 'ACM0016',
          country: 'KE',
          projectType: 'Solar',
          vintageYear: 2024,
          methodologyScore: 85,
        })
        .expect(201);

      // Other user tries to verify (not verifier role)
      await makeAuthenticatedRequest(context, otherUser)
        .post(`/projects/${projectRes.body.id}/verify`)
        .send({
          verifierPublicKey: otherUser.publicKey,
        })
        .expect(403); // Forbidden
    });

    it('should prevent retirement without credits', async () => {
      const corporation = await createTestUser(context, 'corporation');

      // Try to retire non-existent batch
      await makeAuthenticatedRequest(context, corporation)
        .post('/retirements')
        .send({
          batchId: 'NONEXISTENT',
          amount: '100.00',
          beneficiary: 'Test',
          retirementReason: 'Test',
        })
        .expect(404); // Not found or 400 Bad Request
    });

    it('should prevent over-retirement', async () => {
      const admin = await createTestUser(context, 'admin');
      const corporation = await createTestUser(context, 'corporation');

      // Create batch with 100 credits
      const batchRes = await makeAuthenticatedRequest(context, admin)
        .post('/credits/mint')
        .send({
          projectId: 'OVER-001',
          amount: '100.00',
          vintageYear: 2024,
          serialStart: 'KE-2024-000001',
          serialEnd: 'KE-2024-000100',
        })
        .expect(201);

      const batchId = batchRes.body.batchId;

      // Try to retire more than available
      await makeAuthenticatedRequest(context, corporation)
        .post('/retirements')
        .send({
          batchId,
          amount: '150.00', // More than 100 available
          beneficiary: 'Test',
          retirementReason: 'Test',
        })
        .expect(400); // Bad request - insufficient credits
    });
  });

  describe('Performance & Constraints', () => {
    it('should complete project registration in acceptable time', async () => {
      const developer = await createTestUser(context, 'project_developer');

      const startTime = Date.now();

      await makeAuthenticatedRequest(context, developer)
        .post('/projects')
        .send({
          projectId: 'PERF-001',
          name: 'Performance Test Project',
          description: 'Testing response time',
          methodology: 'ACM0016',
          country: 'KE',
          projectType: 'Solar',
          vintageYear: 2024,
          methodologyScore: 85,
        })
        .expect(201);

      const duration = Date.now() - startTime;

      // Should respond within 2 seconds
      expect(duration).toBeLessThan(2000);
    });

    it('should handle concurrent retirement requests', async () => {
      const admin = await createTestUser(context, 'admin');
      const corporation = await createTestUser(context, 'corporation');

      // Create batch
      const batchRes = await makeAuthenticatedRequest(context, admin)
        .post('/credits/mint')
        .send({
          projectId: 'CONC-001',
          amount: '10000.00',
          vintageYear: 2024,
          serialStart: 'KE-2024-000001',
          serialEnd: 'KE-2024-010000',
        })
        .expect(201);

      const batchId = batchRes.body.batchId;

      // Send 5 concurrent retirement requests
      const requests = Array(5)
        .fill(null)
        .map((_, i) =>
          makeAuthenticatedRequest(context, corporation)
            .post('/retirements')
            .send({
              batchId,
              amount: `${100 + i}.00`,
              beneficiary: `Corp ${i}`,
              retirementReason: 'Concurrent test',
            }),
        );

      const responses = await Promise.all(requests);

      // All should succeed or fail gracefully
      responses.forEach((res) => {
        expect([201, 400, 409]).toContain(res.status);
      });
    });
  });
});

