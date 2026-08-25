/**
 * credit-lifecycle.e2e-spec.ts
 *
 * End-to-end coverage of the full credit lifecycle — Mint -> Buy -> Retire —
 * run entirely against the in-memory mock blockchain provider
 * (src/blockchain/mock.provider.ts, wired via test-helpers#createTestApp)
 * and the in-memory Soroban/Horizon SDK mock (src/__mocks__/stellar.provider.ts,
 * wired globally in src/jest.setup.ts). No step in this suite makes a network
 * call to a Soroban RPC endpoint, Horizon, or any live Stellar network — the
 * whole flow runs against the test Postgres database and in-memory state only.
 *
 * Flow covered per test:
 *   1. Admin mints a fresh credit batch          (POST /credits/mint)
 *   2. Project developer lists it for sale        (POST /marketplace/listings)
 *   3. Corporation buys a slice of the batch       (POST /marketplace/purchase)
 *   4. Corporation retires the credits it holds    (POST /credits/retire)
 *   5. Retirement certificate is fetchable         (GET /credits/retirement/:id)
 *
 * Closes #909
 */

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('Credit Lifecycle (Mint -> Buy -> Retire) Integration Tests (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let devToken: string;
  let corporationToken: string;

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

    const adminRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GADMIN789', role: 'admin' })
      .expect(201);
    adminToken = adminRes.body.access_token;

    const devRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GDEV001', role: 'project_developer' })
      .expect(201);
    devToken = devRes.body.access_token;

    const corpRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GCORP123', role: 'corporation' })
      .expect(201);
    corporationToken = corpRes.body.access_token;
  });

  it('mints, lists, purchases, and retires credits in a single unbroken flow', async () => {
    // 1. Mint a fresh batch (admin) — hits the mock blockchain provider's
    //    mint_credits handler, never a real Soroban RPC endpoint.
    const mintPayload = {
      batchId: 'BATCH-LIFECYCLE-001',
      projectId: 'PROJ001',
      vintageYear: 2024,
      amount: 300,
      serialStart: '9001',
      serialEnd: '9300',
      metadataCid: 'QmLifecycleTest12345678901234567890123456789012',
    };

    const mintRes = await request(app.getHttpServer())
      .post('/credits/mint')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mintPayload)
      .expect(201);
    expect(mintRes.body).toBeDefined();

    const batchRes = await request(app.getHttpServer())
      .get(`/credits/batch/${mintPayload.batchId}`)
      .expect(200);
    expect(batchRes.body.amount).toBe(mintPayload.amount);

    // 2. List the batch for sale (project developer).
    const listingId = 'LIST-LIFECYCLE-001';
    await request(app.getHttpServer())
      .post('/marketplace/listings')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        listingId,
        projectId: mintPayload.projectId,
        credit_batch_id: mintPayload.batchId,
        amount: 300,
        price_per_tonne: '5000',
        vintageYear: mintPayload.vintageYear,
        methodology: 'ACM0002',
        country: 'Kenya',
      })
      .expect(201);

    // 3. Buy a slice of the batch (corporation) — a real marketplace purchase
    //    against the mock provider's transfer_credits path.
    const purchaseRes = await request(app.getHttpServer())
      .post('/marketplace/purchase')
      .set('Authorization', `Bearer ${corporationToken}`)
      .send({ listingId, amount: 120 })
      .expect(201);
    expect(purchaseRes.body).toBeDefined();

    // 4. Retire the purchased credits (corporation) — mock provider's
    //    retire_credits path returns a mock tx hash + certificate data.
    const retireRes = await request(app.getHttpServer())
      .post('/credits/retire')
      .set('Authorization', `Bearer ${corporationToken}`)
      .send({
        batchId: mintPayload.batchId,
        amount: 100,
        beneficiary: 'Lifecycle Test Corp',
        retirementReason: 'End-to-end lifecycle test',
        holderPublicKey: 'GCORP123',
      })
      .expect(201);

    expect(retireRes.body).toHaveProperty('retirementId');
    expect(retireRes.body.amount).toBe(100);
    expect(retireRes.body.beneficiary).toBe('Lifecycle Test Corp');

    // 5. The retirement certificate is retrievable and reflects the same data.
    const certRes = await request(app.getHttpServer())
      .get(`/credits/retirement/${retireRes.body.retirementId}`)
      .expect(200);
    expect(certRes.body.retirementId).toBe(retireRes.body.retirementId);
    expect(certRes.body.batchId).toBe(mintPayload.batchId);
  });

  it('rejects retiring more credits than were purchased (insufficient balance)', async () => {
    const mintPayload = {
      batchId: 'BATCH-LIFECYCLE-002',
      projectId: 'PROJ001',
      vintageYear: 2024,
      amount: 50,
      serialStart: '9301',
      serialEnd: '9350',
      metadataCid: 'QmLifecycleTest22345678901234567890123456789012',
    };

    await request(app.getHttpServer())
      .post('/credits/mint')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mintPayload)
      .expect(201);

    await request(app.getHttpServer())
      .post('/credits/retire')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        batchId: mintPayload.batchId,
        amount: 999999,
        beneficiary: 'Over-retirement attempt',
        retirementReason: 'Should fail — exceeds available credits',
        holderPublicKey: 'GADMIN789',
      })
      .expect(422);
  });
});
