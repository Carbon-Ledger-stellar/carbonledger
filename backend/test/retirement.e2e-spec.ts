import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma.service';

async function login(app: INestApplication, publicKey: string, role: string): Promise<string> {
  const loginResponse = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ publicKey, role })
    .expect(201);

  return loginResponse.body.access_token;
}

async function seedBatches(app: INestApplication, batchIds: string[], amount = 1000) {
  const prisma = app.get(PrismaService);
  const project = await prisma.carbonProject.findUnique({ where: { projectId: 'PROJ001' } });

  if (!project) {
    throw new Error('Seed project PROJ001 not found');
  }

  for (const batchId of batchIds) {
    await prisma.creditBatch.create({
      data: {
        batchId,
        projectId: project.projectId,
        vintageYear: project.vintageYear,
        amount,
        serialStart: `${batchId}-0001`,
        serialEnd: `${batchId}-1000`,
        status: 'Active',
        metadataCid: `Qm${batchId.slice(0, 10).padEnd(44, '1')}`,
      },
    });
  }
}

function makeBulkItems(batchIds: string[], overrides?: Record<string, Partial<{ amount: number; beneficiary: string; reason: string }>>) {
  return batchIds.map((batchId, index) => ({
    batchId,
    amount: overrides?.[batchId]?.amount ?? (index + 1) * 10,
    beneficiary: overrides?.[batchId]?.beneficiary,
    reason: overrides?.[batchId]?.reason,
  }));
}

describe('Retirement Endpoints Integration Tests (e2e)', () => {
  let app: INestApplication;
  let corpToken: string;

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
    corpToken = await login(app, 'GCORP123', 'corporation');
  });

  describe('POST /credits/retire (Retirement Endpoint)', () => {
    it('succeeds with valid data and returns certificate details', async () => {
      const response = await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${corpToken}`)
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
      await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${corpToken}`)
        .send({
          batchId: 'BATCH001',
          amount: 900,
          beneficiary: 'Test Corporation',
          retirementReason: 'Full retirement',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${corpToken}`)
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
        .set('Authorization', `Bearer ${corpToken}`)
        .send({
          batchId: 'BATCH001',
          amount: 50,
          retirementReason: 'Offsetting Q1 emissions',
        })
        .expect(400);

      expect(response.body.message).toContain('beneficiary must be a string');
    });

    it('returns 422 when amount exceeds owned credits', async () => {
      const response = await request(app.getHttpServer())
        .post('/credits/retire')
        .set('Authorization', `Bearer ${corpToken}`)
        .send({
          batchId: 'BATCH001',
          amount: 9000,
          beneficiary: 'Test Corporation',
          retirementReason: 'Exceeding available',
        })
        .expect(422);

      expect(response.body.message).toContain('Cannot retire');
    });
  });

  describe('POST /retirements/bulk', () => {
    it('retires multiple batches atomically and returns one tx hash per bulk operation', async () => {
      await seedBatches(app, ['BULK001', 'BULK002']);

      const body = {
        items: makeBulkItems(['BULK001', 'BULK002'], {
          BULK001: { amount: 25, beneficiary: 'Corp A', reason: 'Annual report' },
          BULK002: { amount: 35 },
        }),
        beneficiary: 'Corp Default',
        retirementReason: 'Annual ESG reporting',
      };

      const response = await request(app.getHttpServer())
        .post('/retirements/bulk')
        .set('Authorization', `Bearer ${corpToken}`)
        .send(body)
        .expect(201);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toEqual(expect.objectContaining({
        batchId: 'BULK001',
        retirementId: expect.any(String),
      }));
      expect(response.body[0]).toHaveProperty('certificateUrl');
      expect(response.body[1]).toEqual(expect.objectContaining({
        batchId: 'BULK002',
        retirementId: expect.any(String),
      }));
      expect(response.body[1]).toHaveProperty('certificateUrl');

      const prisma = app.get(PrismaService);
      const records = await prisma.retirementRecord.findMany({
        where: { retirementId: { in: response.body.map((item: any) => item.retirementId) } },
      });
      expect(records).toHaveLength(2);
      expect(new Set(records.map((record) => record.txHash)).size).toBe(1);
    });

    it('rejects the entire request when one item fails validation', async () => {
      await seedBatches(app, ['BAD001', 'BAD002']);

      const prisma = app.get(PrismaService);
      const beforeCount = await prisma.retirementRecord.count();

      const response = await request(app.getHttpServer())
        .post('/retirements/bulk')
        .set('Authorization', `Bearer ${corpToken}`)
        .send({
          items: [
            { batchId: 'BAD001', amount: 10, beneficiary: 'Corp', reason: 'Valid item' },
            { batchId: 'BAD002', amount: 0, beneficiary: 'Corp', reason: 'Invalid amount' },
          ],
          beneficiary: 'Corp Default',
          retirementReason: 'Annual ESG reporting',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
      expect(await prisma.retirementRecord.count()).toBe(beforeCount);
    });

    it('returns 202 Accepted with a jobId for requests larger than 10 items and replays via idempotency key', async () => {
      const batchIds = Array.from({ length: 11 }, (_, index) => `ASYNC${String(index + 1).padStart(3, '0')}`);
      await seedBatches(app, batchIds);

      const body = {
        items: makeBulkItems(batchIds),
        beneficiary: 'Corp Default',
        retirementReason: 'Annual ESG reporting',
      };
      const idempotencyKey = uuidv4();

      const first = await request(app.getHttpServer())
        .post('/retirements/bulk')
        .set('Authorization', `Bearer ${corpToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(202);

      expect(first.body.jobId).toEqual(expect.any(String));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const second = await request(app.getHttpServer())
        .post('/retirements/bulk')
        .set('Authorization', `Bearer ${corpToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(202);

      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.jobId).toBe(first.body.jobId);
    });

    it('enforces the bulk retirement throttle bucket at five requests per hour per address', async () => {
      const adminToken = await login(app, 'GADMIN789', 'admin');
      const batchIds = Array.from({ length: 6 }, (_, index) => `RATE${String(index + 1).padStart(3, '0')}`);
      await seedBatches(app, batchIds);

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/retirements/bulk')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            items: [{ batchId: batchIds[i], amount: 10, beneficiary: 'Corp', reason: 'Quota check' }],
            beneficiary: 'Corp Default',
            retirementReason: 'Annual ESG reporting',
          })
          .expect(201);
      }

      const response = await request(app.getHttpServer())
        .post('/retirements/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ batchId: batchIds[5], amount: 10, beneficiary: 'Corp', reason: 'Quota check' }],
          beneficiary: 'Corp Default',
          retirementReason: 'Annual ESG reporting',
        })
        .expect(429);

      expect(response.body.message).toContain('Rate limit exceeded');
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
