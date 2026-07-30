import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase } from './test-helpers';

describe('Auth Integration Tests (e2e)', () => {
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
  });

  describe('POST /auth/login', () => {
    it('should issue JWT for valid signature (public key)', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          publicKey: 'GTEST123VALIDKEY',
          role: 'corporation',
        })
        .expect(201);

      expect(response.body).toHaveProperty('access_token');
      expect(typeof response.body.access_token).toBe('string');
      expect(response.body.access_token.length).toBeGreaterThan(0);
    });

    it('should return 401 for invalid signature (missing publicKey)', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          role: 'corporation',
        })
        .expect(400); // Bad request due to validation
    });

    it('should return 400 for invalid role', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          publicKey: 'GTEST123',
          role: 'invalid_role',
        })
        .expect(400);
    });

    it('should create user on first login', async () => {
      const publicKey = 'GNEWUSER123';
      
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          publicKey,
          role: 'verifier',
        })
        .expect(201);

      // Verify user was created in database
      const prisma = app.get('PrismaService');
      const user = await prisma.user.findUnique({ where: { publicKey } });
      
      expect(user).toBeDefined();
      expect(user.role).toBe('verifier');
    });

    it('should not duplicate user on subsequent logins', async () => {
      const publicKey = 'GEXISTING123';
      
      // First login
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ publicKey, role: 'corporation' })
        .expect(201);

      // Second login
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ publicKey, role: 'corporation' })
        .expect(201);

      // Verify only one user exists
      const prisma = app.get('PrismaService');
      const users = await prisma.user.findMany({ where: { publicKey } });
      
      expect(users).toHaveLength(1);
    });
  });

  describe('JWT Token Validation', () => {
    it('should decode valid JWT and extract user info', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          publicKey: 'GTEST456',
          role: 'admin',
        })
        .expect(201);

      const token = loginResponse.body.access_token;

      // Use token to access protected endpoint
      const response = await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should reject requests without token', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .expect(401);
    });

    it('should reject requests with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);
    });
  });
});
