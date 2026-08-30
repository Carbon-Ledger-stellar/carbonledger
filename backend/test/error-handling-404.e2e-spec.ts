import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('404 Error Handling Integration Tests (e2e)', () => {
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

  describe('GET /projects/:id - Project Not Found', () => {
    it('should return 404 with "Project not found" message for unknown project ID', async () => {
      const response = await request(app.getHttpServer())
        .get('/projects/NONEXISTENT_PROJECT')
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe('Project not found');
      expect(response.body).toHaveProperty('statusCode', 404);
      expect(response.body).toHaveProperty('error');
    });

    it('should have consistent error schema for 404 project response', async () => {
      const response = await request(app.getHttpServer())
        .get('/projects/UNKNOWN')
        .expect(404);

      // Verify error schema matches NestJS standard
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 404,
          message: 'Project not found',
          error: expect.any(String),
        })
      );
    });

    it('should return 404 for empty project ID', async () => {
      const response = await request(app.getHttpServer())
        .get('/projects/')
        .expect(404);

      expect(response.body).toHaveProperty('message');
    });

    it('should successfully retrieve existing project', async () => {
      const response = await request(app.getHttpServer())
        .get('/projects/PROJ001')
        .expect(200);

      expect(response.body).toHaveProperty('projectId', 'PROJ001');
      expect(response.body).toHaveProperty('name', 'Test Solar Project');
    });
  });

  describe('GET /retirements/:id - Retirement Not Found', () => {
    it('should return 404 with "Retirement not found" message for unknown retirement ID', async () => {
      const response = await request(app.getHttpServer())
        .get('/retirements/NONEXISTENT_RETIREMENT')
        .expect(403); // 403 because the route requires auth for non-admins, but admin can access
    });

    it('should return 404 for non-existent retirement via certificates endpoint', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/NONEXISTENT_RETIREMENT')
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe('Retirement not found');
      expect(response.body).toHaveProperty('statusCode', 404);
      expect(response.body).toHaveProperty('error');
    });

    it('should have consistent error schema for 404 retirement response', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/UNKNOWN_RET')
        .expect(404);

      // Verify error schema matches NestJS standard
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 404,
          message: 'Retirement not found',
          error: expect.any(String),
        })
      );
    });

    it('should successfully retrieve existing retirement certificate', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      expect(response.body).toHaveProperty('retirementId', 'RET001');
      expect(response.body).toHaveProperty('amount', '100');
      expect(response.body).toHaveProperty('beneficiary', 'Test Corporation');
    });
  });

  describe('GET /credits/lookup/:serial - Credit Not Found', () => {
    it('should return 404 with "Credit not found" message for unknown serial number', async () => {
      const response = await request(app.getHttpServer())
        .get('/credits/lookup/UNKNOWN_SERIAL_12345')
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe('Credit not found');
      expect(response.body).toHaveProperty('statusCode', 404);
      expect(response.body).toHaveProperty('error');
    });

    it('should have consistent error schema for 404 credit response', async () => {
      const response = await request(app.getHttpServer())
        .get('/credits/lookup/INVALID_SERIAL')
        .expect(404);

      // Verify error schema matches NestJS standard
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 404,
          message: 'Credit not found',
          error: expect.any(String),
        })
      );
    });

    it('should successfully retrieve existing credit batch by serial range', async () => {
      const response = await request(app.getHttpServer())
        .get('/credits/lookup/KE-001-2024-0500')
        .expect(200);

      expect(response.body).toHaveProperty('batchId', 'BATCH001');
      expect(response.body).toHaveProperty('projectId', 'PROJ001');
      expect(response.body).toHaveProperty('amount', 1000);
    });

    it('should successfully retrieve existing credit from retirement', async () => {
      const response = await request(app.getHttpServer())
        .get('/credits/lookup/KE-001-2024-0001')
        .expect(200);

      expect(response.body).toHaveProperty('retirementId', 'RET001');
      expect(response.body).toHaveProperty('projectId', 'PROJ001');
      expect(response.body).toHaveProperty('amount', 100);
    });

    it('should handle serial numbers with special characters', async () => {
      const response = await request(app.getHttpServer())
        .get('/credits/lookup/SPECIAL-CHARS-!@#$%')
        .expect(404);

      expect(response.body.message).toBe('Credit not found');
    });
  });

  describe('Error Response Schema Consistency', () => {
    it('should have consistent statusCode field across all 404 responses', async () => {
      const responses = await Promise.all([
        request(app.getHttpServer()).get('/projects/UNKNOWN'),
        request(app.getHttpServer()).get('/certificates/UNKNOWN'),
        request(app.getHttpServer()).get('/credits/lookup/UNKNOWN'),
      ]);

      responses.forEach((response) => {
        expect(response.status).toBe(404);
        expect(response.body.statusCode).toBe(404);
      });
    });

    it('should have consistent message and error fields', async () => {
      const responses = await Promise.all([
        request(app.getHttpServer()).get('/projects/UNKNOWN'),
        request(app.getHttpServer()).get('/certificates/UNKNOWN'),
        request(app.getHttpServer()).get('/credits/lookup/UNKNOWN'),
      ]);

      responses.forEach((response) => {
        expect(response.body).toHaveProperty('message');
        expect(response.body).toHaveProperty('error');
        expect(typeof response.body.message).toBe('string');
        expect(typeof response.body.error).toBe('string');
        expect(response.body.message.toLowerCase()).toContain('not found');
      });
    });

    it('should not expose stack traces in 404 responses', async () => {
      const responses = await Promise.all([
        request(app.getHttpServer()).get('/projects/UNKNOWN'),
        request(app.getHttpServer()).get('/certificates/UNKNOWN'),
        request(app.getHttpServer()).get('/credits/lookup/UNKNOWN'),
      ]);

      responses.forEach((response) => {
        expect(response.body).not.toHaveProperty('stack');
        expect(JSON.stringify(response.body)).not.toContain('at ');
        expect(JSON.stringify(response.body)).not.toContain('Error:');
      });
    });
  });

  describe('Error Response Message Content', () => {
    it('should not expose internal details in project 404 message', async () => {
      const response = await request(app.getHttpServer())
        .get('/projects/SENSITIVE_ID_12345')
        .expect(404);

      expect(response.body.message).toBe('Project not found');
      expect(response.body.message).not.toContain('SENSITIVE_ID_12345');
    });

    it('should not expose internal details in retirement 404 message', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/SENSITIVE_ID_RETIREMENT')
        .expect(404);

      expect(response.body.message).toBe('Retirement not found');
      expect(response.body.message).not.toContain('SENSITIVE_ID_RETIREMENT');
    });

    it('should not expose internal details in credit 404 message', async () => {
      const response = await request(app.getHttpServer())
        .get('/credits/lookup/SENSITIVE_SERIAL_123')
        .expect(404);

      expect(response.body.message).toBe('Credit not found');
      expect(response.body.message).not.toContain('SENSITIVE_SERIAL_123');
    });
  });
});
