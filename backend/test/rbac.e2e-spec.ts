import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma.service';

describe('RBAC Integration Tests (e2e)', () => {
  let app: INestApplication;
  let corporationToken: string;
  let verifierToken: string;
  let adminToken: string;

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

    const corpResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GCORP123', role: 'corporation' });
    corporationToken = corpResponse.body.access_token;

    const verifierResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GVERIF456', role: 'verifier' });
    verifierToken = verifierResponse.body.access_token;

    const adminResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GADMIN789', role: 'admin' });
    adminToken = adminResponse.body.access_token;
  });

  describe('Verifier Endpoints Access Control', () => {
    it('should return 403 when corporation tries to access verifier endpoints', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${corporationToken}`)
        .expect(403);
    });

    it('should return 403 when corporation tries to review verifier application', async () => {
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });

    it('should allow admin to access verifier endpoints', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('should allow verifier to access their own pending projects', async () => {
      await request(app.getHttpServer())
        .get('/verifiers/GVERIF456/pending-projects')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);
    });

    it('should allow verifier to list verifier applications', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);
    });

    it('should prevent verifier from reviewing applications (admin only)', async () => {
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });
  });

  describe('Role-Based Endpoint Protection', () => {
    it('should deny access without authentication', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .expect(401);
    });

    it('should allow authenticated users to access public endpoints', async () => {
      await request(app.getHttpServer())
        .get('/retirements')
        .expect(200); // Public endpoint, no auth required
    });

    it('should enforce role requirements on protected endpoints', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${corporationToken}`)
        .expect(403);
    });

    it('should allow only admin to review verifier applications', async () => {
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved' });

      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ status: 'approved' })
        .expect(403);

      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });
  });

  describe('Cross-Role Access Attempts', () => {
    it('should prevent corporation from accessing admin functions', async () => {
      await request(app.getHttpServer())
        .patch('/verifiers/test-id/review')
        .set('Authorization', `Bearer ${corporationToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });

    it('should prevent verifier from accessing corporation-specific data', async () => {
      await request(app.getHttpServer())
        .get('/projects')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200); // Authenticated, full visibility for verifier
    });

    it('should prevent corporation from listing verifier applications', async () => {
      await request(app.getHttpServer())
        .get('/verifiers')
        .set('Authorization', `Bearer ${corporationToken}`)
        .expect(403);
    });

    it('should prevent corporation from viewing verifier details', async () => {
      await request(app.getHttpServer())
        .get('/verifiers/test-id')
        .set('Authorization', `Bearer ${corporationToken}`)
        .expect(403);
    });
  });

  // ── Project visibility scoping ─────────────────────────────────────────
  // Covers: PROJECT_DEVELOPER sees only their own projects; admin/verifier/
  // corporation retain full visibility; unauthenticated callers can only
  // reach the separate public/verified-only endpoint.
  //
  // Extra fixtures are seeded LOCALLY here rather than in test-helpers.ts —
  // seedTestData() is shared by other spec files, and PROJ001/GCORP123 stay
  // exactly as those other specs expect. We only add what this block needs.
  describe('Project Visibility Scoping', () => {
    let devAToken: string;
    let devBToken: string;

    beforeEach(async () => {
      const prisma = app.get(PrismaService);

      await prisma.user.createMany({
        data: [
          { publicKey: 'GDEV111', role: 'project_developer' },
          { publicKey: 'GDEV222', role: 'project_developer' },
        ],
      });

      // Owned by GDEV111, still Pending — this is the "draft" a competitor
      // must not be able to see.
      await prisma.carbonProject.create({
        data: {
          projectId: 'PROJ-DEV-A-DRAFT',
          name: 'Dev A Draft Project',
          methodology: 'VCS',
          country: 'KE',
          projectType: 'forestry',
          status: 'Pending',
          vintageYear: 2024,
          methodologyScore: 75,
          metadataCid: 'QmDevADraft',
          verifierAddress: 'GVERIF456',
          ownerAddress: 'GDEV111',
        },
      });

      // Owned by GDEV222, Verified — used to confirm public endpoint
      // surfaces verified projects regardless of owner.
      await prisma.carbonProject.create({
        data: {
          projectId: 'PROJ-DEV-B-VERIFIED',
          name: 'Dev B Verified Project',
          methodology: 'GS',
          country: 'US',
          projectType: 'renewable',
          status: 'Verified',
          vintageYear: 2024,
          methodologyScore: 90,
          metadataCid: 'QmDevBVerified',
          verifierAddress: 'GVERIF456',
          ownerAddress: 'GDEV222',
        },
      });

      const devAResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ publicKey: 'GDEV111', role: 'project_developer' });
      devAToken = devAResponse.body.access_token;

      const devBResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ publicKey: 'GDEV222', role: 'project_developer' });
      devBToken = devBResponse.body.access_token;
    });

    describe('GET /projects (authenticated)', () => {
      it('rejects requests with no token', async () => {
        await request(app.getHttpServer())
          .get('/projects')
          .expect(401);
      });

      it('project_developer sees only their own projects', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects')
          .set('Authorization', `Bearer ${devAToken}`)
          .expect(200);

        const ids = res.body.projects.map((p: any) => p.projectId);
        expect(ids).toContain('PROJ-DEV-A-DRAFT');
        expect(ids).not.toContain('PROJ-DEV-B-VERIFIED');
        expect(ids).not.toContain('PROJ001'); // owned by GCORP123, not GDEV111
      });

      it('a different project_developer does not see Dev A\'s draft', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects')
          .set('Authorization', `Bearer ${devBToken}`)
          .expect(200);

        const ids = res.body.projects.map((p: any) => p.projectId);
        expect(ids).not.toContain('PROJ-DEV-A-DRAFT');
      });

      it('verifier sees all projects across all owners', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects')
          .set('Authorization', `Bearer ${verifierToken}`)
          .expect(200);

        const ids = res.body.projects.map((p: any) => p.projectId);
        expect(ids).toContain('PROJ-DEV-A-DRAFT');
        expect(ids).toContain('PROJ-DEV-B-VERIFIED');
      });

      it('admin sees all projects across all owners', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        const ids = res.body.projects.map((p: any) => p.projectId);
        expect(ids).toContain('PROJ-DEV-A-DRAFT');
        expect(ids).toContain('PROJ-DEV-B-VERIFIED');
      });

      it('corporation sees all projects across all owners', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects')
          .set('Authorization', `Bearer ${corporationToken}`)
          .expect(200);

        const ids = res.body.projects.map((p: any) => p.projectId);
        expect(ids).toContain('PROJ-DEV-A-DRAFT');
        expect(ids).toContain('PROJ-DEV-B-VERIFIED');
      });
    });

    describe('GET /projects/:id (authenticated, ownership enforced)', () => {
      it('owner can fetch their own project', async () => {
        await request(app.getHttpServer())
          .get('/projects/PROJ-DEV-A-DRAFT')
          .set('Authorization', `Bearer ${devAToken}`)
          .expect(200);
      });

      it('a different developer gets 404, not 403, for a project they do not own', async () => {
        // 404 rather than 403 deliberately — must not confirm the project's
        // existence to a caller who isn't allowed to see it.
        await request(app.getHttpServer())
          .get('/projects/PROJ-DEV-A-DRAFT')
          .set('Authorization', `Bearer ${devBToken}`)
          .expect(404);
      });

      it('verifier can fetch any project regardless of owner', async () => {
        await request(app.getHttpServer())
          .get('/projects/PROJ-DEV-A-DRAFT')
          .set('Authorization', `Bearer ${verifierToken}`)
          .expect(200);
      });
    });

    describe('GET /public/projects (unauthenticated)', () => {
      it('is reachable with no token', async () => {
        await request(app.getHttpServer())
          .get('/public/projects')
          .expect(200);
      });

      it('returns only Verified-status projects', async () => {
        const res = await request(app.getHttpServer())
          .get('/public/projects')
          .expect(200);

        const ids = res.body.projects.map((p: any) => p.projectId);
        expect(ids).toContain('PROJ-DEV-B-VERIFIED');
        expect(ids).not.toContain('PROJ-DEV-A-DRAFT'); // Pending — must be excluded
      });

      it('does not expose ownerAddress on public results', async () => {
        const res = await request(app.getHttpServer())
          .get('/public/projects')
          .expect(200);

        const verified = res.body.projects.find((p: any) => p.projectId === 'PROJ-DEV-B-VERIFIED');
        expect(verified.ownerAddress).toBeUndefined();
      });
    });
  });
});