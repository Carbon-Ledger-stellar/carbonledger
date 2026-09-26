import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma.service';

/**
 * Integration tests for GET /certificates/:cid/verify (#600).
 *
 * The IPFS gateway fetch is mocked (global fetch) since these tests run
 * against a real Postgres test DB but must not depend on live IPFS pins.
 */
describe('Certificate CID Verification (e2e) — #600', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const testContent = Buffer.from(JSON.stringify({ retirement_id: 'RET001', project_id: 'PROJ001' }));
  const testContentHash = createHash('sha256').update(testContent).digest('hex');
  const testCid = 'QmTestContentCid123456789';

  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);

    await prisma.retirementRecord.update({
      where: { retirementId: 'RET001' },
      data: {
        certificateContentCid: testCid,
        certificateContentHash: testContentHash,
      },
    });

    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('normal retrieval', () => {
    it('returns valid=true when the pinned content matches the recorded hash', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => testContent.buffer.slice(
          testContent.byteOffset,
          testContent.byteOffset + testContent.byteLength,
        ),
      } as Response);

      const response = await request(app.getHttpServer())
        .get(`/certificates/${testCid}/verify`)
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({
          valid: true,
          cid: testCid,
          retirementId: 'RET001',
          contentHash: testContentHash,
        }),
      );
    });
  });

  describe('tampered content detection', () => {
    it('returns 409 when fetched content hash does not match the recorded hash', async () => {
      const tamperedContent = Buffer.from(JSON.stringify({ retirement_id: 'RET001', amount: 999999 }));
      fetchSpy.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => tamperedContent.buffer.slice(
          tamperedContent.byteOffset,
          tamperedContent.byteOffset + tamperedContent.byteLength,
        ),
      } as Response);

      const response = await request(app.getHttpServer())
        .get(`/certificates/${testCid}/verify`)
        .expect(409);

      expect(response.body).toEqual(
        expect.objectContaining({
          valid: false,
          cid: testCid,
          expectedHash: testContentHash,
        }),
      );
      expect(response.body.actualHash).not.toBe(testContentHash);
      expect(response.body.message).toMatch(/tamper/i);
    });
  });

  describe('CID not found', () => {
    it('returns 404 when no certificate was ever pinned under this CID', async () => {
      const response = await request(app.getHttpServer())
        .get('/certificates/QmDoesNotExist/verify')
        .expect(404);

      expect(response.body.message).toContain('QmDoesNotExist');
    });
  });

  describe('IPFS gateway unavailable', () => {
    it('returns 503 when the content cannot be fetched from IPFS', async () => {
      fetchSpy.mockRejectedValue(new Error('network unreachable'));

      const response = await request(app.getHttpServer())
        .get(`/certificates/${testCid}/verify`)
        .expect(503);

      expect(response.body.message).toContain(testCid);
    });
  });
});
