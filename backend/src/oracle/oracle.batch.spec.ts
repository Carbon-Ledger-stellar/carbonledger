import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OracleService, UpdatePriceDto, SubmitMonitoringDto } from './oracle.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';

describe('OracleService - Batch Endpoints', () => {
  let service: OracleService;

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  const mockPrismaService = {
    oracleJob: {
      upsert: jest.fn(),
    },
    monitoringData: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockRedisService = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: 'BullQueue_carbonledger-queue', useValue: mockQueue },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<OracleService>(OracleService);
  });

  describe('submitBatchPrice', () => {
    it('should process a batch of price updates in a transaction', async () => {
      const items: UpdatePriceDto[] = [
        { methodology: 'VM0007', vintageYear: 2024, priceUsdc: '15.50' },
        { methodology: 'VM0015', vintageYear: 2024, priceUsdc: '12.00' },
      ];

      mockPrismaService.oracleJob.upsert.mockImplementation(({ create }: any) => {
        return Promise.resolve({ id: 'oj-' + create.idempotencyKey, idempotencyKey: create.idempotencyKey });
      });

      const result = await service.submitBatchPrice(items);

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(2);
      expect(result.results.length).toBe(2);
      expect(result.results[0].status).toBe('success');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });
  });

  describe('submitBatchMonitoring', () => {
    it('should process a batch of monitoring submissions in a transaction', async () => {
      const items: SubmitMonitoringDto[] = [
        {
          projectId: 'proj-1',
          period: '2024-Q1',
          tonnesVerified: 500,
          methodologyScore: 90,
          satelliteCid: 'bafybeigdyr3zar5abbccbafybeigdyr3zar5abbccbafybeigdyr3zar5',
          submittedBy: 'GSERVICENODE',
        },
      ];

      mockPrismaService.monitoringData.upsert.mockResolvedValue({
        projectId: 'proj-1',
        period: '2024-Q1',
        tonnesVerified: 500,
        methodologyScore: 90,
        satelliteCid: 'bafybeigdyr3zar5abbccbafybeigdyr3zar5abbccbafybeigdyr3zar5',
      });
      mockPrismaService.oracleJob.upsert.mockResolvedValue({
        id: 'oj-1',
        idempotencyKey: 'monitoring:proj-1:2024-Q1',
      });

      const result = await service.submitBatchMonitoring(items);

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(1);
      expect(result.results[0].status).toBe('success');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });
  });
});
