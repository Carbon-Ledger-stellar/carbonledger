import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  SerialReconciliationService,
  SERIAL_RECONCILIATION_QUEUE,
  ReconciliationReport,
} from './serial-reconciliation.service';
import { PrismaService } from '../prisma.service';

// Mock @nestjs/schedule so @Cron decorators don't fail in unit test context
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {
    EVERY_DAY_AT_MIDNIGHT: '0 0 * * *',
  },
  SchedulerRegistry: jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBatch(batchId: string, start: number, end: number) {
  return { batchId, serialStart: String(start), serialEnd: String(end) };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
  getJob: jest.fn(),
};

const mockPrisma = {
  creditBatch: {
    findMany: jest.fn(),
  },
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('SerialReconciliationService', () => {
  let service: SerialReconciliationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerialReconciliationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(SERIAL_RECONCILIATION_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<SerialReconciliationService>(SerialReconciliationService);
    jest.clearAllMocks();
  });

  // ── enqueueReconciliation ────────────────────────────────────────────────

  describe('enqueueReconciliation', () => {
    it('should enqueue a job and return jobId', async () => {
      const result = await service.enqueueReconciliation();
      expect(result.jobId).toBe('mock-job-id');
      expect(result.message).toContain('Reconciliation job enqueued');
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  // ── clean state ──────────────────────────────────────────────────────────

  describe('runReconciliation — clean state', () => {
    it('should return zero discrepancies when all DB batches have no overlaps', async () => {
      mockPrisma.creditBatch.findMany.mockResolvedValue([
        makeBatch('batch-1', 1000, 1999),
        makeBatch('batch-2', 2000, 2999),
        makeBatch('batch-3', 3000, 3999),
      ]);

      const report: ReconciliationReport = await service.runReconciliation();

      expect(report.discrepanciesFound).toBe(0);
      expect(report.overlappingRanges).toHaveLength(0);
      expect(report.dbOnlyBatches).toHaveLength(0);
      expect(report.onChainOnlyRanges).toHaveLength(0);
      expect(report.totalBatchesChecked).toBe(3);
    });

    it('should return zero discrepancies for empty DB', async () => {
      mockPrisma.creditBatch.findMany.mockResolvedValue([]);

      const report: ReconciliationReport = await service.runReconciliation();

      expect(report.discrepanciesFound).toBe(0);
      expect(report.totalBatchesChecked).toBe(0);
    });
  });

  // ── overlap detection ────────────────────────────────────────────────────

  describe('runReconciliation — overlapping ranges', () => {
    it('should detect two batches with overlapping serial ranges', async () => {
      // batch-1: 1000–2000, batch-2: 1500–2500 — overlap at 1500–2000
      mockPrisma.creditBatch.findMany.mockResolvedValue([
        makeBatch('batch-1', 1000, 2000),
        makeBatch('batch-2', 1500, 2500),
      ]);

      const report: ReconciliationReport = await service.runReconciliation();

      expect(report.overlappingRanges).toHaveLength(1);
      expect(report.overlappingRanges[0].batchId).toBe('batch-2');
      expect(report.overlappingRanges[0].overlappingWith).toBe('batch-1');
      expect(report.overlappingRanges[0].overlapStart).toBe('1500');
      expect(report.overlappingRanges[0].overlapEnd).toBe('2000');
      expect(report.discrepanciesFound).toBe(1);
    });

    it('should detect adjacent (non-overlapping) ranges as clean', async () => {
      // batch-1 ends at 1999, batch-2 starts at 2000 — not overlapping
      mockPrisma.creditBatch.findMany.mockResolvedValue([
        makeBatch('batch-1', 1000, 1999),
        makeBatch('batch-2', 2000, 2999),
      ]);

      const report: ReconciliationReport = await service.runReconciliation();

      expect(report.overlappingRanges).toHaveLength(0);
      expect(report.discrepanciesFound).toBe(0);
    });

    it('should detect complete containment as an overlap', async () => {
      // batch-2 is fully inside batch-1
      mockPrisma.creditBatch.findMany.mockResolvedValue([
        makeBatch('batch-1', 1000, 5000),
        makeBatch('batch-2', 2000, 3000),
      ]);

      const report: ReconciliationReport = await service.runReconciliation();

      expect(report.overlappingRanges).toHaveLength(1);
      expect(report.overlappingRanges[0].conflictType).toBe('overlap');
    });

    it('should detect multiple overlapping pairs', async () => {
      mockPrisma.creditBatch.findMany.mockResolvedValue([
        makeBatch('batch-1', 1000, 2000),
        makeBatch('batch-2', 1500, 2500), // overlaps batch-1
        makeBatch('batch-3', 3000, 4000),
        makeBatch('batch-4', 3500, 4500), // overlaps batch-3
      ]);

      const report: ReconciliationReport = await service.runReconciliation();

      expect(report.overlappingRanges).toHaveLength(2);
      expect(report.discrepanciesFound).toBe(2);
    });
  });

  // ── CSV export ───────────────────────────────────────────────────────────

  describe('exportJobAsCsv', () => {
    it('should throw when job is not found', async () => {
      mockQueue.getJob.mockResolvedValue(null);
      await expect(service.exportJobAsCsv('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw when job is not completed', async () => {
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        returnvalue: null,
      });
      await expect(service.exportJobAsCsv('job-1')).rejects.toThrow('not completed');
    });

    it('should return CSV with header and data rows for a completed job', async () => {
      const mockReport: ReconciliationReport = {
        generatedAt: '2026-08-28T00:00:00.000Z',
        totalBatchesChecked: 2,
        totalOnChainRangesChecked: 0,
        discrepanciesFound: 1,
        dbOnlyBatches: [],
        onChainOnlyRanges: [],
        overlappingRanges: [
          {
            batchId: 'batch-2',
            serialStart: '1500',
            serialEnd: '2500',
            conflictType: 'overlap',
            overlappingWith: 'batch-1',
            overlapStart: '1500',
            overlapEnd: '2000',
          },
        ],
      };

      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
        returnvalue: mockReport,
      });

      const csv = await service.exportJobAsCsv('job-1');

      expect(csv).toContain('batchId,serialStart,serialEnd,conflictType');
      expect(csv).toContain('batch-2');
      expect(csv).toContain('overlap');
      expect(csv).toContain('batch-1');
    });
  });

  // ── getJobStatus ─────────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    it('should return not_found for a missing job', async () => {
      mockQueue.getJob.mockResolvedValue(null);
      const result = await service.getJobStatus('missing');
      expect(result.status).toBe('not_found');
    });

    it('should return completed status with report for a finished job', async () => {
      const mockReport: ReconciliationReport = {
        generatedAt: '2026-08-28T00:00:00.000Z',
        totalBatchesChecked: 1,
        totalOnChainRangesChecked: 0,
        discrepanciesFound: 0,
        dbOnlyBatches: [],
        onChainOnlyRanges: [],
        overlappingRanges: [],
      };

      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
        returnvalue: mockReport,
        progress: 100,
        failedReason: null,
      });

      const result = await service.getJobStatus('job-1');
      expect(result.status).toBe('completed');
      expect(result.report).toEqual(mockReport);
    });

    it('should return error for a failed job', async () => {
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('failed'),
        returnvalue: null,
        progress: 0,
        failedReason: 'DB connection lost',
      });

      const result = await service.getJobStatus('job-2');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('DB connection lost');
    });
  });
});
