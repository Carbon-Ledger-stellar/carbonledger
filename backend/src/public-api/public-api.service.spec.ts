import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicApiService } from './public-api.service';
import { PrismaService } from '../prisma.service';

const mockPrisma = {
  carbonProject: { findMany: jest.fn() },
  creditBatch: { findUnique: jest.fn() },
  retirementRecord: { findUnique: jest.fn() },
  apiKey: { create: jest.fn() },
};

describe('PublicApiService', () => {
  let service: PublicApiService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PublicApiService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(PublicApiService);
    jest.clearAllMocks();
  });

  describe('listProjects', () => {
    it('returns paginated projects', async () => {
      const projects = [{ projectId: 'p1', name: 'Test' }];
      mockPrisma.carbonProject.findMany.mockResolvedValue(projects);
      const result = await service.listProjects({ limit: 20 });
      expect(result.data).toEqual(projects);
      expect(result.meta.count).toBe(1);
      expect(result.meta.nextCursor).toBeNull();
    });

    it('sets nextCursor when page is full', async () => {
      const projects = Array.from({ length: 20 }, (_, i) => ({ projectId: `p${i}` }));
      mockPrisma.carbonProject.findMany.mockResolvedValue(projects);
      const result = await service.listProjects({ limit: 20 });
      expect(result.meta.nextCursor).toBe('p19');
    });
  });

  describe('getCreditBatch', () => {
    it('returns batch when found', async () => {
      const batch = { batchId: 'b1', projectId: 'p1' };
      mockPrisma.creditBatch.findUnique.mockResolvedValue(batch);
      await expect(service.getCreditBatch('b1')).resolves.toEqual(batch);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.creditBatch.findUnique.mockResolvedValue(null);
      await expect(service.getCreditBatch('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('verifyCertificate', () => {
    it('returns certificate with ipfsUrl when cid present', async () => {
      mockPrisma.retirementRecord.findUnique.mockResolvedValue({
        retirementId: 'ret-1',
        certificateCid: 'Qm123',
        project: { name: 'P', methodology: 'VCS', country: 'BR' },
      });
      const result = await service.verifyCertificate('ret-1');
      expect(result.ipfsUrl).toBe('https://gateway.pinata.cloud/ipfs/Qm123');
    });

    it('returns null ipfsUrl when no cid', async () => {
      mockPrisma.retirementRecord.findUnique.mockResolvedValue({
        retirementId: 'ret-2',
        certificateCid: null,
        project: { name: 'P', methodology: 'VCS', country: 'BR' },
      });
      const result = await service.verifyCertificate('ret-2');
      expect(result.ipfsUrl).toBeNull();
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.retirementRecord.findUnique.mockResolvedValue(null);
      await expect(service.verifyCertificate('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createApiKey', () => {
    it('creates key with cl_ prefix', async () => {
      mockPrisma.apiKey.create.mockResolvedValue({
        id: '1',
        key: 'cl_abc',
        organizationName: 'Acme',
        contactEmail: 'a@acme.com',
        createdAt: new Date(),
      });
      const result = await service.createApiKey({
        organizationName: 'Acme',
        contactEmail: 'a@acme.com',
      });
      expect(result.key).toMatch(/^cl_/);
    });
  });
});
