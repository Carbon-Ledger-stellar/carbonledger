import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('Certificate Generation & Retrieval Integration Tests (e2e)', () => {
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

  describe('GET /certificates/:retirementId', () => {
    it('should retrieve certificate metadata for retired credit', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      expect(response.body).toHaveProperty('retirementId', 'RET001');
      expect(response.body).toHaveProperty('amount', '100');
      expect(response.body).toHaveProperty('retiredBy', 'GCORP123');
      expect(response.body).toHaveProperty('beneficiary', 'Test Corporation');
      expect(response.body).toHaveProperty('txHash', '0xtest123');
      expect(response.body).toHaveProperty('serialNumbers');
      expect(response.body).toHaveProperty('serialStart');
      expect(response.body).toHaveProperty('serialEnd');
      expect(response.body).toHaveProperty('certificateStatus');
      expect(response.body).toHaveProperty('certificateCid');
      expect(Array.isArray(response.body.serialNumbers)).toBe(true);
    });

    it('should return 404 for non-existent retirement', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/NONEXISTENT')
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('not found');
    });

    it('should include project information in certificate metadata', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      expect(response.body).toHaveProperty('project');
      expect(response.body.project).toHaveProperty('name');
      expect(response.body.project).toHaveProperty('country');
      expect(response.body.project).toHaveProperty('methodology');
      expect(response.body).toHaveProperty('verificationUrl');
    });
  });

  describe('GET /certificates/:retirementId/pdf', () => {
    it('should return a PDF for a valid retirement (on-demand generation)', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001/pdf')
        .expect(200);

      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['x-certificate-source']).toBe('generated');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(500); // PDF should have content
    });

    it('should return 404 for non-existent retirement PDF', async () => {
      await request(app.getHttpServer())
        .get('/certificates/NONEXISTENT/pdf')
        .expect(404);
    });

    it('should set proper caching headers on PDF response', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001/pdf')
        .expect(200);

      expect(response.headers['cache-control']).toBeDefined();
      expect(response.headers['content-disposition']).toContain('certificate-RET001.pdf');
    });
  });

  describe('GET /certificates/:retirementId/status', () => {
    it('should return certificate generation status', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001/status')
        .expect(200);

      expect(response.body).toHaveProperty('retirementId', 'RET001');
      expect(response.body).toHaveProperty('status');
      expect(['pending', 'ready', 'error']).toContain(response.body.status);
      expect(response.body).toHaveProperty('cid');
      expect(response.body).toHaveProperty('url');
      expect(response.body).toHaveProperty('retries');
      expect(response.body).toHaveProperty('generatedAt');
      expect(response.body).toHaveProperty('failedAt');
    });

    it('should return 404 for non-existent retirement status', async () => {
      await request(app.getHttpServer())
        .get('/certificates/NONEXISTENT/status')
        .expect(404);
    });

    it('should return status "pending" for newly created retirements', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001/status')
        .expect(200);

      // New retirements start as pending_certificate which maps to "pending"
      expect(response.body.status).toBe('pending');
    });
  });

  describe('Full generate → status → PDF retrieval flow', () => {
    it('should complete the full certificate generation lifecycle', async () => {
      // 1. Verify initial status is pending
      const status1 = await request(app.getHttpServer())
        .get('/certificates/RET001/status')
        .expect(200);
      expect(status1.body.status).toBe('pending');

      // 2. Generate PDF on demand
      const pdfResponse = await request(app.getHttpServer())
        .get('/certificates/RET001/pdf')
        .expect(200);
      expect(pdfResponse.headers['content-type']).toContain('application/pdf');
      expect(pdfResponse.body.length).toBeGreaterThan(500);

      // 3. Verify metadata includes all required fields
      const certResponse = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      const requiredFields = [
        'retirementId',
        'amount',
        'retiredBy',
        'beneficiary',
        'retirementReason',
        'vintageYear',
        'serialNumbers',
        'txHash',
        'retiredAt',
        'projectId',
        'batchId',
        'certificateStatus',
        'certificateCid',
      ];

      requiredFields.forEach(field => {
        expect(certResponse.body).toHaveProperty(field);
      });
    });
  });

  describe('Certificate Data Integrity', () => {
    it('should include all required fields for PDF certificate generation', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      const requiredFields = [
        'retirementId',
        'amount',
        'retiredBy',
        'beneficiary',
        'retirementReason',
        'vintageYear',
        'serialNumbers',
        'serialStart',
        'serialEnd',
        'txHash',
        'retiredAt',
        'projectId',
        'batchId',
      ];

      requiredFields.forEach(field => {
        expect(response.body).toHaveProperty(field);
      });
    });

    it('should return valid serial numbers and range', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      expect(Array.isArray(response.body.serialNumbers)).toBe(true);
      expect(response.body.serialNumbers.length).toBeGreaterThan(0);
      response.body.serialNumbers.forEach((serial: any) => {
        expect(typeof serial).toBe('string');
      });
      expect(response.body).toHaveProperty('serialStart');
      expect(response.body).toHaveProperty('serialEnd');
    });
  });

  describe('GET /retirements/:id', () => {
    it('should retrieve retirement record by ID', async () => {
      const response = await request(app.getHttpServer())
        .get('/retirements/RET001')
        .expect(200);

      expect(response.body).toHaveProperty('retirementId', 'RET001');
      expect(response.body).toHaveProperty('amount');
      expect(response.body).toHaveProperty('retiredAt');
    });
  });

  describe('GET /retirements', () => {
    it('should list all retirements', async () => {
      const response = await request(app.getHttpServer())
        .get('/retirements')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
