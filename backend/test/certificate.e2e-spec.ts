import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('Certificate Retrieval Integration Tests (e2e)', () => {
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

  describe('GET /certificates/:id', () => {
    it('should retrieve certificate for retired credit', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      expect(response.body).toHaveProperty('retirementId', 'RET001');
      expect(response.body).toHaveProperty('amount', 100);
      expect(response.body).toHaveProperty('retiredBy', 'GCORP123');
      expect(response.body).toHaveProperty('beneficiary', 'Test Corporation');
      expect(response.body).toHaveProperty('txHash', '0xtest123');
      expect(response.body).toHaveProperty('serialNumbers');
      expect(Array.isArray(response.body.serialNumbers)).toBe(true);
    });

    it('should return 404 for non-existent retirement', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/NONEXISTENT')
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('not found');
    });

    it('should return complete retirement data including project info', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      expect(response.body).toHaveProperty('projectId', 'PROJ001');
      expect(response.body).toHaveProperty('batchId', 'BATCH001');
      expect(response.body).toHaveProperty('vintageYear', 2024);
      expect(response.body).toHaveProperty('retirementReason');
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

    it('should return 404 for invalid retirement ID', async () => {
      await request(app.getHttpServer())
        .get('/retirements/INVALID123')
        .expect(404);
    });
  });

  describe('GET /retirements', () => {
    it('should list all retirements', async () => {
      const response = await request(app.getHttpServer())
        .get('/retirements')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('retirementId');
    });

    it('should respect limit parameter', async () => {
      // Create additional retirements
      const prisma = app.get('PrismaService');
      
      for (let i = 2; i <= 5; i++) {
        await prisma.retirementRecord.create({
          data: {
            retirementId: `RET00${i}`,
            batchId: 'BATCH001',
            projectId: 'PROJ001',
            amount: 10 * i,
            retiredBy: 'GCORP123',
            beneficiary: `Test Corp ${i}`,
            retirementReason: 'Testing',
            vintageYear: 2024,
            serialNumbers: [`KE-001-2024-${i}000`],
            txHash: `0xtest${i}`,
          },
        });
      }

      const response = await request(app.getHttpServer())
        .get('/retirements?limit=3')
        .expect(200);

      expect(response.body.length).toBeLessThanOrEqual(3);
    });

    it('should return retirements ordered by date (most recent first)', async () => {
      const response = await request(app.getHttpServer())
        .get('/retirements')
        .expect(200);

      if (response.body.length > 1) {
        const dates = response.body.map((r: any) => new Date(r.retiredAt).getTime());
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
        }
      }
    });
  });

  describe('POST /retirements/generate-pdf', () => {
    it('should generate PDF data for valid retirement', async () => {
      const response = await request(app.getHttpServer())
        .post('/retirements/generate-pdf')
        .send({ retirementId: 'RET001' })
        .expect(201);

      expect(response.body).toHaveProperty('retirementId', 'RET001');
    });

    it('should return 404 when generating PDF for non-existent retirement', async () => {
      await request(app.getHttpServer())
        .post('/retirements/generate-pdf')
        .send({ retirementId: 'NONEXISTENT' })
        .expect(404);
    });

    it('should validate retirementId parameter', async () => {
      await request(app.getHttpServer())
        .post('/retirements/generate-pdf')
        .send({})
        .expect(400);
    });
  });

  describe('Certificate Data Integrity', () => {
    it('should include all required fields for certificate generation', async () => {
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
        'txHash',
        'retiredAt',
        'projectId',
        'batchId',
      ];

      requiredFields.forEach(field => {
        expect(response.body).toHaveProperty(field);
      });
    });

    it('should return valid serial numbers array', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/RET001')
        .expect(200);

      expect(Array.isArray(response.body.serialNumbers)).toBe(true);
      expect(response.body.serialNumbers.length).toBeGreaterThan(0);
      response.body.serialNumbers.forEach((serial: any) => {
        expect(typeof serial).toBe('string');
      });
    });
  });
});
