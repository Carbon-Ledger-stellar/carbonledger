import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { OracleService } from './oracle.service';
import { PrismaService } from '../prisma.service';
import { QUEUE_NAME } from '../queue/queue.constants';

const monitoringUpsertResult = {
  id: 'mon-1',
  projectId: 'proj-001',
  period: '2024-Q1',
  tonnesVerified: 500,
  methodologyScore: 85,
  satelliteCid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
  submittedBy: 'GORACLE',
  submittedAt: new Date(),
};

const oracleUpdateResult = { id: 'ou-1', idempotencyKey: 'monitoring:proj-001:2024-Q1' };

const prismaMock = {
  monitoringData: { upsert: jest.fn().mockResolvedValue(monitoringUpsertResult) },
  oracleUpdate:   { upsert: jest.fn().mockResolvedValue(oracleUpdateResult) },
  carbonProject:  { update: jest.fn().mockResolvedValue({}) },
  priceApproval:  {
    create:   jest.fn().mockResolvedValue({ id: 'pa-1' }),
    findMany: jest.fn().mockResolvedValue([]),
    update:   jest.fn().mockResolvedValue({ id: 'pa-1' }),
  },
};

const queueMock = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

describe('OracleService', () => {
  let service: OracleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleService,
        { provide: PrismaService,              useValue: prismaMock },
        { provide: getQueueToken(QUEUE_NAME),  useValue: queueMock },
      ],
    }).compile();

    service = module.get(OracleService);
  });

  afterEach(() => jest.clearAllMocks());

  const monitoringDto = {
    projectId:        'proj-001',
    period:           '2024-Q1',
    tonnesVerified:   500,
    methodologyScore: 85,
    satelliteCid:     'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    submittedBy:      'GORACLE',
  };

  describe('submitMonitoring', () => {
    it('upserts monitoring data and enqueues a Soroban job', async () => {
      const result = await service.submitMonitoring(monitoringDto);

      expect(prismaMock.monitoringData.upsert).toHaveBeenCalledTimes(1);
      expect(prismaMock.oracleUpdate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: 'monitoring:proj-001:2024-Q1' },
        }),
      );
      expect(queueMock.add).toHaveBeenCalledWith(
        'oracle_submission',
        expect.objectContaining({ oracleUpdateId: 'ou-1', type: 'monitoring' }),
        expect.objectContaining({
          jobId:    'oracle-monitoring-monitoring:proj-001:2024-Q1',
          attempts: 5,
          backoff:  { type: 'exponential', delay: 5000 },
        }),
      );
      expect(result).toEqual(monitoringUpsertResult);
    });

    it('is idempotent — duplicate submission upserts, does not duplicate records', async () => {
      await service.submitMonitoring(monitoringDto);
      await service.submitMonitoring(monitoringDto);

      // upsert called twice but with same key — DB handles deduplication
      expect(prismaMock.monitoringData.upsert).toHaveBeenCalledTimes(2);
      // BullMQ jobId deduplication prevents duplicate jobs
      expect(queueMock.add).toHaveBeenCalledTimes(2);
      expect(queueMock.add.mock.calls[0][2].jobId).toBe(
        queueMock.add.mock.calls[1][2].jobId,
      );
    });
  });

  describe('submitPrice', () => {
    const priceDto = { methodology: 'VCS', vintageYear: 2023, priceUsdc: '12.50' };

    it('upserts oracle update and enqueues a price job', async () => {
      prismaMock.oracleUpdate.upsert.mockResolvedValueOnce({
        id: 'ou-2',
        idempotencyKey: 'price:VCS:2023',
      });

      const result = await service.submitPrice(priceDto);

      expect(prismaMock.oracleUpdate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { idempotencyKey: 'price:VCS:2023' } }),
      );
      expect(queueMock.add).toHaveBeenCalledWith(
        'oracle_submission',
        expect.objectContaining({ type: 'price' }),
        expect.objectContaining({ jobId: 'oracle-price-price:VCS:2023', attempts: 5 }),
      );
      expect(result).toMatchObject({ received: true });
    });
  });

  describe('flagProject', () => {
    it('suspends the project', async () => {
      await service.flagProject({ projectId: 'proj-001', reason: 'fraud' });
      expect(prismaMock.carbonProject.update).toHaveBeenCalledWith({
        where: { projectId: 'proj-001' },
        data:  { status: 'Suspended' },
      });
    });
  });
});
