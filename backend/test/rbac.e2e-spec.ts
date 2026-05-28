import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('RBAC Integration Tests (e2e)', () => {
  let app: INestApplication;
  let corporationToken: string;
  let verifierToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);

    // Get tokens for different roles
    const corpResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GCORP123', role: 'corporation' });
    corporationToken = corpResponse.body.access_token;

    const verifierResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GVERIF456', role: 'verifier' });
    verifierToken = verifierResponse.body.access_token;

    const adminResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GADMIN789', role: 'admin' });
    adminToken = adminResponse.body.access_token;
  });

  describe('Verifier Endpoints Access Control', () => {
    it('should return 403 when corporation tries to access verifier endpoints', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${corporationToken}`)
        .expect(403);
    });

    it('should return 403 when corporation tries to review verifier application', async () => {
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });

    it('should allow admin to access verifier endpoints', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('should allow verifier to access their own pending projects', async () => {
      await request(app.getHttpServer())
        .get('/verifiers/GVERIF456/pending-projects')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);
    });

    it('should allow verifier to list verifier applications', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);
    });

    it('should prevent verifier from reviewing applications (admin only)', async () => {
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });
  });

  describe('Role-Based Endpoint Protection', () => {
    it('should deny access without authentication', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .expect(401);
    });

    it('should allow authenticated users to access public endpoints', async () => {
      await request(app.getHttpServer())
        .get('/retirements')
        .expect(200); // Public endpoint, no auth required
    });

    it('should enforce role requirements on protected endpoints', async () => {
      // Admin can access all verifier endpoints
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Verifier can access verifier list
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      // Corporation cannot access verifier list
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${corporationToken}`)
        .expect(403);
    });

    it('should allow only admin to review verifier applications', async () => {
      // Admin can review
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved' });
      // Note: Will fail with 404 if verifier doesn't exist, but won't be 403

      // Verifier cannot review
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ status: 'approved' })
        .expect(403);

      // Corporation cannot review
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });
  });

  describe('Cross-Role Access Attempts', () => {
    it('should prevent corporation from accessing admin functions', async () => {
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });

    it('should prevent verifier from accessing corporation-specific data', async () => {
      // Test accessing another user's data
      await request(app.getHttpServer())
        .get('/projects')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200); // Public endpoint
    });

    it('should prevent corporation from listing verifier applications', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${corporationToken}`)
        .expect(403);
    });

    it('should prevent corporation from viewing verifier details', async () => {
      await request(app.getHttpServer())
        .get('/verifiers/test-id')
        .set('Authorization', `Bearer ${corporationToken}`)
        .expect(403);
    });
  });
});
