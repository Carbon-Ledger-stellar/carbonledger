import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('Retirement Endpoints Integration Tests (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

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

    // Get a valid JWT for testing
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        publicKey: 'GCORP123',
        role: 'corporation',
      })
      .expect(201);
    authToken = loginResponse.body.access_token;
  });

  describe('POST /credits/retire (Retirement Endpoint)', () => {
    it('succeeds with valid data and returns certificate details', async () => {
      const response = await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          batchId: 'BATCH001',
          amount: 50,
          beneficiary: 'Test Corporation',
          retirementReason: 'Offsetting Q1 emissions',
        })
        .expect(201);

      expect(response.body).toHaveProperty('retirementId');
      expect(response.body).toHaveProperty('amount', 50);
      expect(response.body).toHaveProperty('beneficiary', 'Test Corporation');
    });

    it('returns 409 on double retirement attempt (fully retired)', async () => {
      // First, retire the entire remaining batch (BATCH001 has 1000 total, 100 already retired by seedTestData)
      await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          batchId: 'BATCH001',
          amount: 900,
          beneficiary: 'Test Corporation',
          retirementReason: 'Full retirement',
        })
        .expect(201);

      // Attempt to retire again
      const response = await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          batchId: 'BATCH001',
          amount: 10,
          beneficiary: 'Test Corporation',
          retirementReason: 'Double retirement attempt',
        })
        .expect(409);

      expect(response.body.message).toContain('irreversible');
    });

    it('returns 400 when beneficiary name is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          batchId: 'BATCH001',
          amount: 50,
          // Missing beneficiary
          retirementReason: 'Offsetting Q1 emissions',
        })
        .expect(400);

      expect(response.body.message).toContain('beneficiary must be a string');
    });

    it('returns 422 when amount exceeds owned credits', async () => {
      const response = await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          batchId: 'BATCH001',
          amount: 9000, // Exceeds available 900
          beneficiary: 'Test Corporation',
          retirementReason: 'Exceeding available',
        })
        .expect(422);

      expect(response.body.message).toContain('Cannot retire');
    });
  });

  describe('GET /certificates/:id (Certificate Retrieval)', () => {
    it('returns 404 for unknown ID', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/UNKNOWN_ID')
        .expect(404);

      expect(response.body.message).toContain('not found');
    });
  });
});
