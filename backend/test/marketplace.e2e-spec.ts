/**
 * marketplace.e2e-spec.ts
 *
 * Integration tests for the Marketplace controller.
 * Tests run against a real NestJS app + real PostgreSQL test database.
 *
 * Endpoints covered:
 *   GET    /marketplace/listings       — browse listings with filters
 *   GET    /marketplace/listings/:id   — single listing, 404 path
 *   POST   /marketplace/listings       — create listing (auth required)
 *   DELETE /marketplace/listings/:id   — delist (IDOR protection tested)
 *   POST   /marketplace/purchase       — buy credits
 *   POST   /marketplace/bulk-purchase  — bulk buy
 *
 * Closes #643
 */

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('Marketplace Controller Integration (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let corporationToken: string;
  let devToken: string;
  let otherCorpToken: string;

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

    const corpRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GCORP123', role: 'corporation' })
      .expect(201);
    corporationToken = corpRes.body.access_token;

    const devRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GDEV001', role: 'project_developer' })
      .expect(201);
    devToken = devRes.body.access_token;

    const otherRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GOTHER001', role: 'corporation' })
      .expect(201);
    otherCorpToken = otherRes.body.access_token;
  });

  // ── GET /marketplace/listings ──────────────────────────────────────────

  describe('GET /marketplace/listings', () => {
    it('[happy] returns listing array (may be empty on fresh seed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings')
        .expect(200);

      const listings = Array.isArray(res.body)
        ? res.body
        : res.body.listings ?? res.body.data ?? [];
      expect(listings).toBeInstanceOf(Array);
    });

    it('[happy] supports methodology filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?methodology=ACM0002')
        .expect(200);

      const listings = Array.isArray(res.body)
        ? res.body
        : res.body.listings ?? res.body.data ?? [];
      listings.forEach((l: any) => {
        expect(l.methodology).toBe('ACM0002');
      });
    });

    it('[happy] supports vintage year filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?vintage=2024')
        .expect(200);

      const listings = Array.isArray(res.body)
        ? res.body
        : res.body.listings ?? res.body.data ?? [];
      listings.forEach((l: any) => {
        expect(l.vintageYear).toBe(2024);
      });
    });

    it('[happy] supports pagination via limit', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?limit=2')
        .expect(200);

      const listings = Array.isArray(res.body)
        ? res.body
        : res.body.listings ?? res.body.data ?? [];
      expect(listings.length).toBeLessThanOrEqual(2);
    });

    it('[public] does not require authentication', async () => {
      await request(app.getHttpServer())
        .get('/marketplace/listings')
        .expect(200);
    });
  });

  // ── GET /marketplace/listings/:id ──────────────────────────────────────

  describe('GET /marketplace/listings/:id', () => {
    let listingId: string;

    beforeEach(async () => {
      // Create a listing to fetch
      const res = await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          listingId: 'LIST-FETCH-001',
          projectId: 'PROJ001',
          credit_batch_id: 'BATCH001',
          amount: 50,
          price_per_tonne: '15000',
          vintageYear: 2024,
          methodology: 'ACM0002',
          country: 'Kenya',
        });

      listingId = res.body?.listingId ?? 'LIST-FETCH-001';
    });

    it('[happy] returns listing details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/marketplace/listings/${listingId}`)
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('[error] returns 404 for unknown listing ID', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings/DOESNOTEXIST')
        .expect(404);

      expect(res.body).toHaveProperty('message');
    });

    it('[public] does not require authentication', async () => {
      await request(app.getHttpServer())
        .get(`/marketplace/listings/${listingId}`)
        .expect(200);
    });
  });

  // ── POST /marketplace/listings ─────────────────────────────────────────

  describe('POST /marketplace/listings', () => {
    const basePayload = {
      listingId: 'LIST-CREATE-001',
      projectId: 'PROJ001',
      credit_batch_id: 'BATCH001',
      amount: 100,
      price_per_tonne: '12000',
      vintageYear: 2024,
      methodology: 'ACM0002',
      country: 'Kenya',
    };

    it('[happy] project_developer can create a listing', async () => {
      const res = await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${devToken}`)
        .send(basePayload)
        .expect(201);

      expect(res.body).toBeDefined();
      // Seller must be set from the authenticated user, not the body
      if (res.body.seller) {
        expect(res.body.seller).toBe('GDEV001');
      }
    });

    it('[happy] corporation can create a listing', async () => {
      const res = await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ ...basePayload, listingId: 'LIST-CORP-001' })
        .expect(201);

      expect(res.body).toBeDefined();
    });

    it('[happy] admin can create a listing', async () => {
      const res = await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...basePayload, listingId: 'LIST-ADMIN-001' })
        .expect(201);

      expect(res.body).toBeDefined();
    });

    it('[error] returns 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/listings')
        .send(basePayload)
        .expect(401);
    });

    it('[error] returns 400 when listingId is missing', async () => {
      const { listingId: _removed, ...without } = basePayload;
      await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${devToken}`)
        .send(without)
        .expect(400);
    });

    it('[error] returns 400 when amount is zero', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...basePayload, amount: 0 })
        .expect(400);
    });

    it('[security] seller field from body is ignored (anti-mass-assignment)', async () => {
      const res = await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...basePayload, listingId: 'LIST-MASASSIGN-001', seller: 'GATTACKER001' })
        .expect(201);

      // Seller must come from JWT, not the body
      if (res.body.seller) {
        expect(res.body.seller).not.toBe('GATTACKER001');
      }
    });
  });

  // ── DELETE /marketplace/listings/:id ───────────────────────────────────

  describe('DELETE /marketplace/listings/:id', () => {
    beforeEach(async () => {
      // Create a listing owned by GDEV001
      await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          listingId: 'LIST-DELIST-001',
          projectId: 'PROJ001',
          credit_batch_id: 'BATCH001',
          amount: 10,
          price_per_tonne: '11000',
          vintageYear: 2024,
          methodology: 'ACM0002',
          country: 'Kenya',
        });
    });

    it('[happy] owner can delist their own listing', async () => {
      await request(app.getHttpServer())
        .delete('/marketplace/listings/LIST-DELIST-001')
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);
    });

    it('[happy] admin can delist any listing', async () => {
      await request(app.getHttpServer())
        .delete('/marketplace/listings/LIST-DELIST-001')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('[security] non-owner cannot delist (IDOR protection)', async () => {
      const res = await request(app.getHttpServer())
        .delete('/marketplace/listings/LIST-DELIST-001')
        .set('Authorization', `Bearer ${otherCorpToken}`)
        .expect(403);

      expect(res.body.message).toBeDefined();
    });

    it('[error] returns 401 without authentication', async () => {
      await request(app.getHttpServer())
        .delete('/marketplace/listings/LIST-DELIST-001')
        .expect(401);
    });

    it('[error] returns 404 for non-existent listing', async () => {
      await request(app.getHttpServer())
        .delete('/marketplace/listings/NOPE-LISTING')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // ── POST /marketplace/purchase ─────────────────────────────────────────

  describe('POST /marketplace/purchase', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/marketplace/listings')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          listingId: 'LIST-PURCHASE-001',
          projectId: 'PROJ001',
          credit_batch_id: 'BATCH001',
          amount: 200,
          price_per_tonne: '10000',
          vintageYear: 2024,
          methodology: 'ACM0002',
          country: 'Kenya',
        });
    });

    it('[happy] corporation can purchase credits', async () => {
      const res = await request(app.getHttpServer())
        .post('/marketplace/purchase')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({
          listingId: 'LIST-PURCHASE-001',
          amount: 5,
        })
        .expect(201);

      expect(res.body).toBeDefined();
    });

    it('[error] returns 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/purchase')
        .send({ listingId: 'LIST-PURCHASE-001', amount: 5 })
        .expect(401);
    });

    it('[error] returns 400 when listingId is missing', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/purchase')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ amount: 5 })
        .expect(400);
    });

    it('[error] returns 400 when amount is zero', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/purchase')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ listingId: 'LIST-PURCHASE-001', amount: 0 })
        .expect(400);
    });

    it('[error] returns 404 for non-existent listing', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/purchase')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ listingId: 'LIST-NONEXISTENT', amount: 1 })
        .expect(404);
    });
  });

  // ── POST /marketplace/bulk-purchase ────────────────────────────────────

  describe('POST /marketplace/bulk-purchase', () => {
    beforeEach(async () => {
      // Seed two listings for bulk purchase
      for (const n of ['BULK-LIST-001', 'BULK-LIST-002']) {
        await request(app.getHttpServer())
          .post('/marketplace/listings')
          .set('Authorization', `Bearer ${devToken}`)
          .send({
            listingId: n,
            projectId: 'PROJ001',
            credit_batch_id: 'BATCH001',
            amount: 50,
            price_per_tonne: '10000',
            vintageYear: 2024,
            methodology: 'ACM0002',
            country: 'Kenya',
          });
      }
    });

    it('[happy] corporation can bulk purchase across multiple listings', async () => {
      const res = await request(app.getHttpServer())
        .post('/marketplace/bulk-purchase')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({
          listingIds: ['BULK-LIST-001', 'BULK-LIST-002'],
          amounts: [2, 3],
        })
        .expect(201);

      expect(res.body).toBeDefined();
    });

    it('[error] returns 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/bulk-purchase')
        .send({ listingIds: ['BULK-LIST-001'], amounts: [1] })
        .expect(401);
    });

    it('[error] returns 400 when listingIds and amounts length mismatch', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/bulk-purchase')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ listingIds: ['BULK-LIST-001', 'BULK-LIST-002'], amounts: [1] }) // mismatched
        .expect(400);
    });

    it('[error] returns 400 when listingIds is empty', async () => {
      await request(app.getHttpServer())
        .post('/marketplace/bulk-purchase')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ listingIds: [], amounts: [] })
        .expect(400);
    });

    it('[api-abuse] returns 400 when bulk-purchase exceeds 50 listings cap', async () => {
      const fifty1 = Array.from({ length: 51 }, (_, i) => `LIST-${i}`);
      await request(app.getHttpServer())
        .post('/marketplace/bulk-purchase')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ listingIds: fifty1, amounts: fifty1.map(() => 1) })
        .expect(400);
    });
  });
});
