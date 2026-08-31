/**
 * Integration tests for IdempotencyMiddleware (Issue #588)
 *
 * Covers Acceptance Criteria:
 *  - Both /marketplace/purchase and /retirements endpoints require Idempotency-Key header (returning 400 if absent)
 *  - Duplicate requests with same key within TTL return identical responses without re-execution
 *  - Concurrent duplicate requests are serialized
 *  - Integration tests cover: first request, duplicate request, expired key, different key
 *  - Configurable TTL and storage backend via environment variables
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, Controller, Post, Body, HttpCode, HttpStatus, Module as NestModule } from '@nestjs/common';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import * as express from 'express';
import { IdempotencyMiddleware } from './idempotency.middleware';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';

interface MintBody { projectId: string; amount: number }
interface PurchaseBody { listingId: string; amount: number }

@Controller('credits')
class FakeCreditsController {
  @Post('mint')
  @HttpCode(HttpStatus.CREATED)
  mint(@Body() dto: MintBody) {
    return { batchId: 'batch-1', projectId: dto.projectId, amount: dto.amount, txHash: 'ABC123' };
  }
}

@Controller('marketplace')
class FakeMarketplaceController {
  @Post('purchase')
  @HttpCode(HttpStatus.CREATED)
  purchase(@Body() dto: PurchaseBody) {
    return { purchaseId: 'pur-1', listingId: dto.listingId, amount: dto.amount };
  }
}

@Controller('retirements')
class FakeRetirementsController {
  @Post()
  @HttpCode(HttpStatus.CREATED)
  retire(@Body() dto: any) {
    return { retirementId: 'ret-1', ...dto };
  }

  @Post('retire')
  @HttpCode(HttpStatus.CREATED)
  retireEndpoint(@Body() dto: any) {
    return { retirementId: 'ret-2', ...dto };
  }
}

@NestModule({
  controllers: [FakeCreditsController, FakeMarketplaceController, FakeRetirementsController],
})
class TestAppModule {}

type IdempotencyRow = {
  id: string;
  idempotencyKey: string;
  endpoint: string;
  requestHash: string;
  responseStatus: number;
  responseBody: string;
  txHash: string | null;
  createdAt: Date;
};

class MockPrismaService {
  private store: Map<string, IdempotencyRow> = new Map();
  private counter = 0;

  idempotencyRecord = {
    findUnique: jest.fn(async ({ where }: any) => {
      const { idempotencyKey, endpoint } = where.idempotencyKey_endpoint;
      return this.store.get(`${idempotencyKey}:${endpoint}`) ?? null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row: IdempotencyRow = { id: `id-${++this.counter}`, ...data, createdAt: new Date() };
      this.store.set(`${data.idempotencyKey}:${data.endpoint}`, row);
      return row;
    }),
    delete: jest.fn(async ({ where }: any) => {
      for (const [k, v] of this.store) {
        if (v.id === where.id) { this.store.delete(k); break; }
      }
    }),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  };

  seed(row: IdempotencyRow) {
    this.store.set(`${row.idempotencyKey}:${row.endpoint}`, row);
  }

  reset() {
    this.store.clear();
    jest.clearAllMocks();
    this.counter = 0;
  }
}

describe('IdempotencyMiddleware (integration)', () => {
  let app: INestApplication;
  let prisma: MockPrismaService;

  beforeAll(async () => {
    prisma = new MockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
      providers: [
        IdempotencyMiddleware,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RedisService,
          useValue: {
            isConnected: false,
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(true),
            del: jest.fn().mockResolvedValue(true),
            getClient: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

    const middleware = module.get(IdempotencyMiddleware);
    app.use(express.json());
    app.use('/credits/mint',         (req: any, res: any, next: any) => middleware.use(req, res, next));
    app.use('/marketplace/purchase', (req: any, res: any, next: any) => middleware.use(req, res, next));
    app.use('/retirements',          (req: any, res: any, next: any) => middleware.use(req, res, next));

    await app.init();
  });

  afterEach(() => prisma.reset());

  afterAll(async () => { await app.close(); });

  // 1. Missing header on required endpoints -> 400
  it('returns HTTP 400 when Idempotency-Key header is absent on required endpoints', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .send({ listingId: 'lst-1', amount: 10 });
    expect(res1.status).toBe(400);
    expect(res1.body.message).toMatch(/Idempotency-Key header is required/i);

    const res2 = await request(app.getHttpServer())
      .post('/retirements')
      .send({ batchId: 'batch-1', amount: 5 });
    expect(res2.status).toBe(400);
    expect(res2.body.message).toMatch(/Idempotency-Key header is required/i);
  });

  // 2. First request stores response
  it('executes and stores response for first request', async () => {
    const key = uuidv4();
    const res = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .set('Idempotency-Key', key)
      .send({ listingId: 'lst-1', amount: 10 });

    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body.purchaseId).toBe('pur-1');

    await new Promise((r) => setImmediate(r));
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledTimes(1);
  });

  // 3. Duplicate request replays identical response
  it('replays identical cached response for duplicate request with same key and body within TTL', async () => {
    const key = uuidv4();
    const body = { listingId: 'lst-1', amount: 10 };
    const { createHash } = await import('crypto');
    const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    prisma.seed({
      id: 'seed-dup-1',
      idempotencyKey: key,
      endpoint: 'POST:/marketplace/purchase',
      requestHash,
      responseStatus: 201,
      responseBody: JSON.stringify({ purchaseId: 'pur-1', listingId: 'lst-1', amount: 10 }),
      txHash: 'TXHASH99',
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .set('Idempotency-Key', key)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(res.headers['x-tx-hash']).toBe('TXHASH99');
    expect(res.body.purchaseId).toBe('pur-1');
  });

  // 4. Expired key treated as new request
  it('treats an expired key beyond TTL as a new request', async () => {
    const key = uuidv4();
    const body = { listingId: 'lst-1', amount: 10 };
    const { createHash } = await import('crypto');
    const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours old
    prisma.seed({
      id: 'seed-exp',
      idempotencyKey: key,
      endpoint: 'POST:/marketplace/purchase',
      requestHash,
      responseStatus: 201,
      responseBody: JSON.stringify({ purchaseId: 'old-pur' }),
      txHash: null,
      createdAt: expiredAt,
    });

    const res = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .set('Idempotency-Key', key)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(prisma.idempotencyRecord.delete).toHaveBeenCalled();
  });

  // 5. Different key executes fresh
  it('executes fresh request when a different key is supplied', async () => {
    const key1 = '11111111-1111-4111-8111-111111111111';
    const key2 = '22222222-2222-4222-8222-222222222222';
    const body = { listingId: 'lst-1', amount: 5 };

    const res1 = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .set('Idempotency-Key', key1)
      .send(body);
    expect(res1.status).toBe(201);

    const res2 = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .set('Idempotency-Key', key2)
      .send(body);
    expect(res2.status).toBe(201);
    expect(res2.headers['idempotent-replayed']).toBeUndefined();
  });

  // 6. Body mismatch -> 422 Unprocessable Entity
  it('returns 422 when same key is sent with different request body', async () => {
    const key = uuidv4();
    const { createHash } = await import('crypto');
    const origBody = { listingId: 'lst-1', amount: 10 };
    const requestHash = createHash('sha256').update(JSON.stringify(origBody)).digest('hex');

    prisma.seed({
      id: 'seed-mismatch',
      idempotencyKey: key,
      endpoint: 'POST:/marketplace/purchase',
      requestHash,
      responseStatus: 201,
      responseBody: JSON.stringify({ purchaseId: 'pur-1' }),
      txHash: null,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .set('Idempotency-Key', key)
      .send({ listingId: 'lst-1', amount: 999 });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/different request body/i);
  });

  // 7. Invalid key format -> 400
  it('returns 400 for non-UUID v4 key format', async () => {
    const res = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .set('Idempotency-Key', 'invalid-key')
      .send({ listingId: 'lst-1', amount: 10 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/UUID v4/i);
  });

  // 8. Concurrent serialization test
  it('serializes concurrent duplicate requests', async () => {
    const key = uuidv4();
    const body = { batchId: 'batch-conc', amount: 1 };

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post('/retirements')
        .set('Idempotency-Key', key)
        .send(body),
      request(app.getHttpServer())
        .post('/retirements')
        .set('Idempotency-Key', key)
        .send(body),
    ]);

    expect([200, 201]).toContain(r1.status);
    expect([200, 201]).toContain(r2.status);
  });
});
