import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';
import { IpfsService } from '../common/ipfs.service';
import { MintCreditsDto, RetireCreditsDto } from './credits.dto';

describe('CreditsService - Batch Endpoints', () => {
  let service: CreditsService;
  let prisma: any;

  const mockPrismaService = {
    creditBatch: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
    },
    carbonProject: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    retirementRecord: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockMailService = {
    sendIfEnabled: jest.fn().mockResolvedValue(true),
  };

  const mockIpfsService = {
    uploadJson: jest.fn().mockResolvedValue('QmTestHash'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MailService, useValue: mockMailService },
        { provide: IpfsService, useValue: mockIpfsService },
      ],
    }).compile();

    service = module.get<CreditsService>(CreditsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('batchMintCredits', () => {
    it('should successfully process a batch of valid mint credits requests in a transaction', async () => {
      const items: MintCreditsDto[] = [
        {
          batchId: 'batch-001',
          projectId: 'proj-1',
          vintageYear: 2024,
          amount: 100,
          serialStart: '1000',
          serialEnd: '1099',
          metadataCid: 'bafybeigdyr3zar5abbcc',
        },
        {
          batchId: 'batch-002',
          projectId: 'proj-1',
          vintageYear: 2024,
          amount: 200,
          serialStart: '2000',
          serialEnd: '2199',
          metadataCid: 'bafybeigdyr3zar5abbcd',
        },
      ];

      mockPrismaService.creditBatch.findMany.mockImplementation(({ where }: any) => {
        if (where?.batchId?.in) {
          if (mockPrismaService.creditBatch.createMany.mock.calls.length > 0) {
            return Promise.resolve(items.map(i => ({ ...i, status: 'Active' })));
          }
          return Promise.resolve([]);
        }
        if (where?.OR) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      mockPrismaService.creditBatch.createMany.mockResolvedValue({ count: 2 });

      const result = await service.batchMintCredits(items);

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(0);
      expect(result.results.length).toBe(2);
      expect(result.results[0].status).toBe('success');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should reject batch minting if payload contains duplicate batchIds', async () => {
      const items: MintCreditsDto[] = [
        {
          batchId: 'batch-001',
          projectId: 'proj-1',
          vintageYear: 2024,
          amount: 100,
          serialStart: '1000',
          serialEnd: '1099',
          metadataCid: 'bafybeigdyr3zar5abbcc',
        },
        {
          batchId: 'batch-001',
          projectId: 'proj-1',
          vintageYear: 2024,
          amount: 200,
          serialStart: '2000',
          serialEnd: '2199',
          metadataCid: 'bafybeigdyr3zar5abbcd',
        },
      ];

      await expect(service.batchMintCredits(items)).rejects.toThrow(BadRequestException);
    });

    it('should reject batch minting if an existing batchId is found in database', async () => {
      const items: MintCreditsDto[] = [
        {
          batchId: 'batch-001',
          projectId: 'proj-1',
          vintageYear: 2024,
          amount: 100,
          serialStart: '1000',
          serialEnd: '1099',
          metadataCid: 'bafybeigdyr3zar5abbcc',
        },
      ];

      mockPrismaService.creditBatch.findMany.mockImplementation(({ where }: any) => {
        if (where?.batchId?.in) {
          return Promise.resolve([{ batchId: 'batch-001' }]);
        }
        return Promise.resolve([]);
      });

      await expect(service.batchMintCredits(items)).rejects.toThrow(BadRequestException);
    });
  });

  describe('batchRetireCredits', () => {
    it('should successfully retire multiple batches in a transaction', async () => {
      const items: RetireCreditsDto[] = [
        {
          batchId: 'batch-001',
          amount: 50,
          beneficiary: 'Acme Corp',
          retirementReason: 'Carbon Offset',
          holderPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        },
      ];

      mockPrismaService.creditBatch.findMany.mockResolvedValue([
        {
          batchId: 'batch-001',
          projectId: 'proj-1',
          vintageYear: 2024,
          amount: 100,
          serialStart: '1000',
          serialEnd: '1099',
          status: 'Active',
        },
      ]);

      mockPrismaService.retirementRecord.create.mockResolvedValue({
        retirementId: 'ret-batch-001-1234',
        batchId: 'batch-001',
        projectId: 'proj-1',
        amount: 50,
        retiredBy: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        beneficiary: 'Acme Corp',
        retirementReason: 'Carbon Offset',
        vintageYear: 2024,
        serialNumbers: [],
        txHash: 'stub-hash',
        isValid: true,
      });

      const result = await service.batchRetireCredits(items);

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(1);
      expect(result.results[0].status).toBe('success');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });
  });
});
