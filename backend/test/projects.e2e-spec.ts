/**
 * projects.e2e-spec.ts
 *
 * Integration tests for the Projects controller.
 * Tests run against a real NestJS application connected to a real PostgreSQL
 * test database (no in-memory fakes, no mocked Prisma calls).
 *
 * Endpoints covered:
 *   GET  /projects              — list with filters, pagination
 *   GET  /projects/search       — full-text / faceted search
 *   GET  /projects/:id          — single project, 404 path
 *   POST /projects              — create project (auth required)
 *   POST /projects/register     — register with IPFS metadata
 *   PATCH /projects/:id/status  — admin status update
 *   POST /projects/:id/verify   — verifier approval
 *   POST /projects/:id/reject   — verifier rejection
 *
 * Closes #643
 */

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('Projects Controller Integration (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let verifierToken: string;
  let corporationToken: string;
  let devToken: string;

  // ── Setup / teardown ───────────────────────────────────────────────────

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

    // Obtain tokens for different roles
    const adminRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GADMIN789', role: 'admin' })
      .expect(201);
    adminToken = adminRes.body.access_token;

    const verifierRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GVERIF456', role: 'verifier' })
      .expect(201);
    verifierToken = verifierRes.body.access_token;

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
  });

  // ── GET /projects ──────────────────────────────────────────────────────

  describe('GET /projects', () => {
    it('[happy] returns paginated list of projects', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects')
        .expect(200);

      // Accept both array and { projects: [...] } shape
      const items = Array.isArray(res.body) ? res.body : res.body.projects ?? res.body.data ?? [];
      expect(items).toBeInstanceOf(Array);
      expect(items.length).toBeGreaterThan(0);
    });

    it('[happy] filters by methodology', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects?methodology=ACM0002')
        .expect(200);

      const items = Array.isArray(res.body) ? res.body : res.body.projects ?? res.body.data ?? [];
      items.forEach((p: any) => {
        expect(p.methodology).toBe('ACM0002');
      });
    });

    it('[happy] filters by country', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects?country=Kenya')
        .expect(200);

      const items = Array.isArray(res.body) ? res.body : res.body.projects ?? res.body.data ?? [];
      items.forEach((p: any) => {
        expect(p.country).toBe('Kenya');
      });
    });

    it('[happy] limits results with limit param', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects?limit=1')
        .expect(200);

      const items = Array.isArray(res.body) ? res.body : res.body.projects ?? res.body.data ?? [];
      expect(items.length).toBeLessThanOrEqual(1);
    });

    it('[public] does not require authentication', async () => {
      await request(app.getHttpServer())
        .get('/projects')
        .expect(200);
    });
  });

  // ── GET /projects/search ───────────────────────────────────────────────

  describe('GET /projects/search', () => {
    it('[happy] returns results for a text search', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/search?search=Solar')
        .expect(200);

      const items = Array.isArray(res.body) ? res.body : res.body.projects ?? res.body.data ?? [];
      expect(items).toBeInstanceOf(Array);
    });

    it('[happy] returns empty array for non-matching search', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/search?search=zzznomatch999')
        .expect(200);

      const items = Array.isArray(res.body) ? res.body : res.body.projects ?? res.body.data ?? [];
      expect(items).toBeInstanceOf(Array);
      expect(items.length).toBe(0);
    });

    it('[public] does not require authentication', async () => {
      await request(app.getHttpServer())
        .get('/projects/search')
        .expect(200);
    });
  });

  // ── GET /projects/:id ──────────────────────────────────────────────────

  describe('GET /projects/:id', () => {
    it('[happy] returns seeded project by ID', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/PROJ001')
        .expect(200);

      expect(res.body).toMatchObject({
        projectId: 'PROJ001',
        name: 'Test Solar Project',
        methodology: 'ACM0002',
      });
    });

    it('[error] returns 404 for unknown project ID', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/DOESNOTEXIST')
        .expect(404);

      expect(res.body).toHaveProperty('message');
    });

    it('[public] does not require authentication', async () => {
      await request(app.getHttpServer())
        .get('/projects/PROJ001')
        .expect(200);
    });
  });

  // ── POST /projects ─────────────────────────────────────────────────────

  describe('POST /projects', () => {
    const newProjectPayload = {
      name: 'New Wind Farm Project',
      methodology: 'AMS-I.D',
      description: 'Offshore wind farm reducing grid emissions in South Africa',
      coordinates: { lat: -33.9, lng: 18.4 },
      documents: ['QmTest123456789012345678901234567890123456789012'],
      country: 'South Africa',
      projectType: 'Wind',
      vintageYear: 2024,
      methodologyScore: 85,
    };

    it('[happy] project_developer can create a project', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${devToken}`)
        .send(newProjectPayload)
        .expect(201);

      expect(res.body).toHaveProperty('projectId');
      expect(res.body.name).toBe(newProjectPayload.name);
    });

    it('[happy] admin can create a project', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newProjectPayload)
        .expect(201);

      expect(res.body).toHaveProperty('projectId');
    });

    it('[error] returns 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/projects')
        .send(newProjectPayload)
        .expect(401);
    });

    it('[error] returns 403 for corporation role', async () => {
      await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send(newProjectPayload)
        .expect(403);
    });

    it('[error] returns 400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ methodology: 'AMS-I.D' }) // missing name, description, coordinates, documents
        .expect(400);

      expect(res.body).toHaveProperty('message');
    });

    it('[error] returns 400 when name exceeds 128 characters', async () => {
      await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...newProjectPayload, name: 'A'.repeat(129) })
        .expect(400);
    });
  });

  // ── POST /projects/register ────────────────────────────────────────────

  describe('POST /projects/register', () => {
    const registerPayload = {
      projectId: 'PROJ-REGISTER-001',
      name: 'REDD+ Forest Conservation',
      methodology: 'VM0015',
      country: 'Indonesia',
      projectType: 'REDD+',
      metadataCid: 'QmRegisterTest1234567890123456789012345678901234',
      verifierAddress: 'GVERIF456',
      ownerAddress: 'GDEV001',
      vintageYear: 2024,
      methodologyScore: 78,
    };

    it('[happy] admin can register a project', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(registerPayload)
        .expect(201);

      expect(res.body).toMatchObject({
        projectId: 'PROJ-REGISTER-001',
        name: 'REDD+ Forest Conservation',
      });
    });

    it('[error] returns 400 for invalid IPFS CID format', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...registerPayload, metadataCid: 'not-a-valid-cid' })
        .expect(400);

      expect(res.body.message).toContain('CID');
    });

    it('[error] returns 400 for vintage year in the past before 1990', async () => {
      await request(app.getHttpServer())
        .post('/projects/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...registerPayload, vintageYear: 1989 })
        .expect(400);
    });

    it('[error] returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/projects/register')
        .send(registerPayload)
        .expect(401);
    });
  });

  // ── PATCH /projects/:id/status ─────────────────────────────────────────

  describe('PATCH /projects/:id/status', () => {
    it('[happy] admin can update project status to Suspended', async () => {
      const res = await request(app.getHttpServer())
        .patch('/projects/PROJ001/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'Suspended', reason: 'Under investigation' })
        .expect(200);

      expect(res.body.status).toBe('Suspended');
    });

    it('[error] returns 403 when verifier tries to update status', async () => {
      await request(app.getHttpServer())
        .patch('/projects/PROJ001/status')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ status: 'Suspended' })
        .expect(403);
    });

    it('[error] returns 401 without token', async () => {
      await request(app.getHttpServer())
        .patch('/projects/PROJ001/status')
        .send({ status: 'Suspended' })
        .expect(401);
    });

    it('[error] returns 404 for non-existent project', async () => {
      await request(app.getHttpServer())
        .patch('/projects/NOPE/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'Suspended' })
        .expect(404);
    });
  });

  // ── POST /projects/:id/verify ──────────────────────────────────────────

  describe('POST /projects/:id/verify', () => {
    it('[happy] verifier can verify a pending project', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/PROJ001/verify')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ verifierPublicKey: 'GVERIF456' })
        .expect(201);

      expect(res.body).toBeDefined();
    });

    it('[error] returns 403 for corporation role', async () => {
      await request(app.getHttpServer())
        .post('/projects/PROJ001/verify')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ verifierPublicKey: 'GCORP123' })
        .expect(403);
    });

    it('[error] returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/projects/PROJ001/verify')
        .send({ verifierPublicKey: 'GVERIF456' })
        .expect(401);
    });

    it('[error] returns 400 when verifierPublicKey is missing', async () => {
      await request(app.getHttpServer())
        .post('/projects/PROJ001/verify')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({})
        .expect(400);
    });
  });

  // ── POST /projects/:id/reject ──────────────────────────────────────────

  describe('POST /projects/:id/reject', () => {
    it('[happy] verifier can reject a project', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/PROJ001/reject')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ verifierPublicKey: 'GVERIF456', reason: 'Insufficient documentation' })
        .expect(201);

      expect(res.body).toBeDefined();
    });

    it('[error] returns 403 for corporation role', async () => {
      await request(app.getHttpServer())
        .post('/projects/PROJ001/reject')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ verifierPublicKey: 'GCORP123', reason: 'No reason' })
        .expect(403);
    });

    it('[error] returns 400 when reason is missing', async () => {
      await request(app.getHttpServer())
        .post('/projects/PROJ001/reject')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ verifierPublicKey: 'GVERIF456' }) // missing reason
        .expect(400);
    });
  });
});
