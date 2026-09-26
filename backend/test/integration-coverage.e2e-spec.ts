import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('Backend integration coverage', () => {
  let app: INestApplication;

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
  });

  it('GET /health returns healthy payload', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toHaveProperty('status');
    expect(response.body.status).toBeDefined();
  });

  it('GET /projects returns seeded projects', async () => {
    const response = await request(app.getHttpServer()).get('/projects').expect(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('GET /projects/:id returns 404 for unknown project', async () => {
    await request(app.getHttpServer()).get('/projects/does-not-exist').expect(404);
  });

  it('GET /credits/batch/:id returns 404 for unknown batch', async () => {
    await request(app.getHttpServer()).get('/credits/batch/does-not-exist').expect(404);
  });

  it('GET /marketplace/listings returns seeded listings', async () => {
    const response = await request(app.getHttpServer()).get('/marketplace/listings').expect(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('POST /auth/verify rejects invalid nonce', async () => {
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({
        publicKey: 'GTEST123',
        signature: '0'.repeat(128),
        nonce: 'bad-nonce',
        role: 'corporation',
      })
      .expect(401);
  });

  it('GET /retirements returns forbidden without auth', async () => {
    await request(app.getHttpServer()).get('/retirements').expect(401);
  });

  it('GET /verifiers returns 401 without a token', async () => {
    await request(app.getHttpServer()).get('/verifiers').expect(401);
  });
});
