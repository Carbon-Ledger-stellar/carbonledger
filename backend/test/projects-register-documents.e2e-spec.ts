/**
 * projects-register-documents.e2e-spec.ts
 *
 * Integration tests for project registration with document upload.
 * Tests the POST /projects/register-with-documents endpoint.
 *
 * Acceptance criteria coverage:
 * ✓ Multipart form parsing implemented
 * ✓ File type validation (PDF, PNG only)
 * ✓ File size limit 10 MB
 * ✓ Cloud storage link returned and saved in DB
 * ✓ Test covers valid/invalid file types and sizes
 *
 * Closes #1014
 */

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';

describe('Projects Register with Documents (e2e)', () => {
  let app: INestApplication;
  let devToken: string;
  let adminToken: string;

  // Test data
  const validProjectData = {
    projectId: 'test-project-doc-001',
    name: 'Solar Farm with Verification',
    description: 'A solar energy project with documents',
    methodology: 'ACM0002',
    country: 'Kenya',
    projectType: 'solar_energy',
    verifierAddress: 'GVERIF456',
    ownerAddress: 'GDEV001',
    vintageYear: 2024,
    methodologyScore: 85,
  };

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
    const devRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GDEV001', role: 'project_developer' })
      .expect(201);
    devToken = devRes.body.access_token;

    const adminRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ publicKey: 'GADMIN789', role: 'admin' })
      .expect(201);
    adminToken = adminRes.body.access_token;
  });

  // ── Helper functions ───────────────────────────────────────────────────

  /**
   * Creates a mock PDF buffer for testing
   */
  function createMockPdfBuffer(): Buffer {
    return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\ntrailer\n<< /Size 1 >>\nstartxref\n0\n%%EOF');
  }

  /**
   * Creates a mock PNG buffer for testing
   */
  function createMockPngBuffer(): Buffer {
    // PNG file signature
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.from([
      0, 0, 0, 13, // chunk length
      73, 72, 68, 82, // "IHDR"
      0, 0, 0, 1, // width
      0, 0, 0, 1, // height
      8, 2, 0, 0, 0, // bit depth, color type, etc.
      144, 119, 83, 222, // CRC
    ]);
    const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
    return Buffer.concat([signature, ihdr, iend]);
  }

  /**
   * Creates a buffer of specified size filled with data
   */
  function createBufferOfSize(sizeInBytes: number): Buffer {
    return Buffer.alloc(sizeInBytes, 'a');
  }

  // ── Tests ──────────────────────────────────────────────────────────────

  describe('POST /projects/register-with-documents', () => {
    // ── Happy Path ─────────────────────────────────────────────────────

    it('[happy] registers project with valid PDF document', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', validProjectData.projectId)
        .field('name', validProjectData.name)
        .field('description', validProjectData.description)
        .field('methodology', validProjectData.methodology)
        .field('country', validProjectData.country)
        .field('projectType', validProjectData.projectType)
        .field('verifierAddress', validProjectData.verifierAddress)
        .field('ownerAddress', validProjectData.ownerAddress)
        .field('vintageYear', String(validProjectData.vintageYear))
        .field('methodologyScore', String(validProjectData.methodologyScore))
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'verra-cert.pdf')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.projectId).toBe(validProjectData.projectId);
      expect(res.body.data.name).toBe(validProjectData.name);
      expect(res.body.data.status).toBe('Pending');
      expect(res.body.data.document).toBeDefined();
      expect(res.body.data.document.cid).toBeDefined();
      expect(res.body.data.document.fileName).toBe('verra-cert.pdf');
      expect(res.body.data.document.fileType).toBe('application/pdf');
      expect(res.body.data.document.ipfsGatewayUrl).toContain('gateway.pinata.cloud');
    });

    it('[happy] registers project with valid PNG document', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-doc-002')
        .field('name', 'Wind Farm with PNG Doc')
        .field('description', 'A wind energy project')
        .field('methodology', 'ACM0015')
        .field('country', 'India')
        .field('projectType', 'wind_energy')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '75')
        .attach('verification_documents', Buffer.from(createMockPngBuffer()), 'methodology.png')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.document.fileType).toBe('image/png');
      expect(res.body.data.document.fileName).toBe('methodology.png');
    });

    it('[happy] returns IPFS gateway URL in response', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-doc-003')
        .field('name', 'Biogas Project')
        .field('description', 'Biogas energy project')
        .field('methodology', 'ACM0018')
        .field('country', 'Brazil')
        .field('projectType', 'biogas')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '80')
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'doc.pdf')
        .expect(201);

      expect(res.body.data.document.ipfsGatewayUrl).toMatch(
        /^https:\/\/gateway\.pinata\.cloud\/ipfs\/Qm[\w]{44}$/,
      );
      expect(res.body.data.document.pinStatus).toBe('pending');
    });

    it('[happy] admin can also register project with documents', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('projectId', 'test-project-doc-004')
        .field('name', 'Admin Registered Project')
        .field('description', 'Project registered by admin')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GADMIN789')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'admin-doc.pdf')
        .expect(201);

      expect(res.body.data.projectId).toBe('test-project-doc-004');
    });

    // ── Missing/Invalid File ───────────────────────────────────────────

    it('[error] rejects request without file', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', validProjectData.projectId)
        .field('name', validProjectData.name)
        .field('description', validProjectData.description)
        .field('methodology', validProjectData.methodology)
        .field('country', validProjectData.country)
        .field('projectType', validProjectData.projectType)
        .field('verifierAddress', validProjectData.verifierAddress)
        .field('ownerAddress', validProjectData.ownerAddress)
        .field('vintageYear', String(validProjectData.vintageYear))
        .field('methodologyScore', String(validProjectData.methodologyScore))
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('[error] rejects invalid file type (text/plain)', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-doc-005')
        .field('name', 'Invalid File Project')
        .field('description', 'Project with invalid file')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', Buffer.from('plain text content'), 'document.txt')
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('PDF and PNG');
    });

    it('[error] rejects unsupported file type (DOCX)', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-doc-006')
        .field('name', 'DOCX Project')
        .field('description', 'Project with DOCX')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach(
          'verification_documents',
          Buffer.from('PK\x03\x04'),
          'document.docx',
        )
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('PDF and PNG');
    });

    it('[error] rejects unsupported file type (JPEG)', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-doc-007')
        .field('name', 'JPEG Project')
        .field('description', 'Project with JPEG')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach(
          'verification_documents',
          Buffer.from([0xff, 0xd8, 0xff]),
          'image.jpg',
        )
        .expect(400);

      expect(res.body.message).toContain('PDF and PNG');
    });

    // ── File Size Validation ───────────────────────────────────────────

    it('[error] rejects file exceeding 10MB limit', async () => {
      const largeBuffer = createBufferOfSize(11 * 1024 * 1024); // 11MB
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-doc-008')
        .field('name', 'Large File Project')
        .field('description', 'Project with oversized file')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', largeBuffer, 'large-file.pdf')
        .expect(413);

      expect(res.body.statusCode).toBe(413);
      expect(res.body.message).toContain('10MB');
    });

    it('[happy] accepts file at exactly 10MB limit', async () => {
      const maxBuffer = createBufferOfSize(10 * 1024 * 1024); // Exactly 10MB
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-doc-009')
        .field('name', 'Max Size Project')
        .field('description', 'Project at max file size')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', maxBuffer, 'max-file.pdf')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.document.fileSize).toBe(10 * 1024 * 1024);
    });

    it('[happy] accepts file just under 10MB limit', async () => {
      const justUnderBuffer = createBufferOfSize(10 * 1024 * 1024 - 1); // 10MB - 1 byte
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-doc-010')
        .field('name', 'Just Under Limit Project')
        .field('description', 'Project just under limit')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', justUnderBuffer, 'near-max-file.pdf')
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    // ── Project Data Validation ────────────────────────────────────────

    it('[error] rejects duplicate projectId', async () => {
      // First registration
      await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-duplicate')
        .field('name', 'First Project')
        .field('description', 'First project')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'doc1.pdf')
        .expect(201);

      // Attempt duplicate
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-duplicate')
        .field('name', 'Second Project')
        .field('description', 'Duplicate project')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'doc2.pdf')
        .expect(409);

      expect(res.body.statusCode).toBe(409);
      expect(res.body.message).toContain('already exists');
    });

    it('[error] rejects methodology score below 70', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', 'test-project-low-score')
        .field('name', 'Low Score Project')
        .field('description', 'Project with low score')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '65') // Below 70
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'doc.pdf')
        .expect(409);

      expect(res.body.statusCode).toBe(409);
      expect(res.body.message).toContain('below minimum 70');
    });

    it('[error] requires authentication', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .field('projectId', validProjectData.projectId)
        .field('name', validProjectData.name)
        .field('description', validProjectData.description)
        .field('methodology', validProjectData.methodology)
        .field('country', validProjectData.country)
        .field('projectType', validProjectData.projectType)
        .field('verifierAddress', validProjectData.verifierAddress)
        .field('ownerAddress', validProjectData.ownerAddress)
        .field('vintageYear', String(validProjectData.vintageYear))
        .field('methodologyScore', String(validProjectData.methodologyScore))
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'doc.pdf')
        .expect(401);

      expect(res.body.statusCode).toBe(401);
    });

    it('[error] restricts to project_developer and admin roles', async () => {
      // Get corporation token
      const corpRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ publicKey: 'GCORP123', role: 'corporation' })
        .expect(201);
      const corpToken = corpRes.body.access_token;

      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${corpToken}`)
        .field('projectId', validProjectData.projectId)
        .field('name', validProjectData.name)
        .field('description', validProjectData.description)
        .field('methodology', validProjectData.methodology)
        .field('country', validProjectData.country)
        .field('projectType', validProjectData.projectType)
        .field('verifierAddress', validProjectData.verifierAddress)
        .field('ownerAddress', validProjectData.ownerAddress)
        .field('vintageYear', String(validProjectData.vintageYear))
        .field('methodologyScore', String(validProjectData.methodologyScore))
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'doc.pdf')
        .expect(403);

      expect(res.body.statusCode).toBe(403);
      expect(res.body.message).toContain('Insufficient permissions');
    });

    // ── Database Integrity ─────────────────────────────────────────────

    it('[integration] saves project in database with document link', async () => {
      const projectId = 'test-project-db-001';
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', projectId)
        .field('name', 'DB Integration Project')
        .field('description', 'Test database integration')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'doc.pdf')
        .expect(201);

      // Verify project was created by fetching it
      const getRes = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);

      expect(getRes.body.projectId).toBe(projectId);
      expect(getRes.body.name).toBe('DB Integration Project');
      expect(getRes.body.status).toBe('Pending');
      expect(getRes.body.metadataCid).toBe(res.body.data.document.cid);
    });

    it('[integration] document CID matches returned value and is stored in project', async () => {
      const projectId = 'test-project-cid-001';
      const res = await request(app.getHttpServer())
        .post('/projects/register-with-documents')
        .set('Authorization', `Bearer ${devToken}`)
        .field('projectId', projectId)
        .field('name', 'CID Test Project')
        .field('description', 'Testing CID storage')
        .field('methodology', 'ACM0002')
        .field('country', 'Kenya')
        .field('projectType', 'solar')
        .field('verifierAddress', 'GVERIF456')
        .field('ownerAddress', 'GDEV001')
        .field('vintageYear', '2024')
        .field('methodologyScore', '85')
        .attach('verification_documents', Buffer.from(createMockPdfBuffer()), 'doc.pdf')
        .expect(201);

      const cid = res.body.data.document.cid;
      expect(cid).toBeTruthy();
      expect(cid).toMatch(/^Qm/); // IPFS CID format

      const getRes = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);

      expect(getRes.body.metadataCid).toBe(cid);
    });
  });
});
