/**
 * Integration tests: satellite quarantine admin API (#579).
 *
 * The oracle holds statistically implausible satellite submissions for manual
 * review rather than discarding them. These tests cover the admin surface for
 * that queue: listing, depth, fetching one entry, and recording a decision.
 *
 * Fully self-contained — Prisma is mocked, no database required.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StellarNetworkService } from '../common/stellar-network.service';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma.service';
import { IndexerService } from '../indexer/indexer.service';
import { OracleService } from '../oracle/oracle.service';
import { RedisService } from '../redis.service';
import { ProjectsService } from '../projects/projects.service';
import { CreditsService } from '../credits/credits.service';
import { RetirementsService } from '../retirements/retirements.service';
import { AuditService } from '../audit/audit.service';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuarantineFindMany   = jest.fn();
const mockQuarantineFindUnique = jest.fn();
const mockQuarantineUpdate     = jest.fn();
const mockQuarantineCount      = jest.fn();

const mockPrisma = {
  adminConfig:    { upsert: jest.fn(), findUnique: jest.fn() },
  user:           { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  auditLog:       { findMany: jest.fn() },
  monitoringData: { findFirst: jest.fn() },
  syncMetadata:   { update: jest.fn() },
  satelliteQuarantine: {
    findMany:   mockQuarantineFindMany,
    findUnique: mockQuarantineFindUnique,
    update:     mockQuarantineUpdate,
    count:      mockQuarantineCount,
  },
};

/** A pending entry as Prisma would return it — note the BigInt id. */
const pendingEntry = {
  id:            BigInt(42),
  projectId:     'proj-001',
  period:        '2026-Q1',
  providerId:    'planet_labs',
  payload:       { project_id: 'proj-001', tonnes_verified: 90000 },
  reason:        'claim of 90000 t is 18.42 standard deviations from the historical mean',
  stats:         { anomalous: true, mean: 500, z_score: 18.42, threshold: 3 },
  status:        'pending',
  reviewedBy:    null,
  reviewNote:    null,
  reviewedAt:    null,
  quarantinedAt: new Date('2026-08-07T10:00:00Z'),
};

describe('Satellite quarantine admin API (#579)', () => {
  let adminService: AdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarNetworkService,
        AdminService,
        { provide: PrismaService,  useValue: mockPrisma },
        { provide: IndexerService, useValue: { sync: jest.fn() } },
        { provide: OracleService,  useValue: { getPriceApprovals: jest.fn() } },
        { provide: RedisService,   useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
        // #964 recovery deps — not under test here, only need to satisfy DI.
        { provide: ProjectsService,    useValue: {} },
        { provide: CreditsService,     useValue: {} },
        { provide: RetirementsService, useValue: {} },
        { provide: AuditService,       useValue: { createLog: jest.fn() } },
      ],
    }).compile();

    adminService = module.get(AdminService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Listing ───────────────────────────────────────────────────────────────

  describe('listQuarantine', () => {
    it('defaults to pending — the queue an operator actually works through', async () => {
      mockQuarantineFindMany.mockResolvedValue([pendingEntry]);
      mockQuarantineCount.mockResolvedValue(1);

      const result = await adminService.listQuarantine({});

      expect(mockQuarantineFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'pending' } }),
      );
      expect(result.status).toBe('pending');
      expect(result.total).toBe(1);
    });

    it('serialises the BigInt id, which JSON.stringify would otherwise refuse', async () => {
      mockQuarantineFindMany.mockResolvedValue([pendingEntry]);
      mockQuarantineCount.mockResolvedValue(1);

      const result = await adminService.listQuarantine({});

      expect(result.entries[0].id).toBe('42');
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('returns the full payload so a reviewer can judge the submission', async () => {
      mockQuarantineFindMany.mockResolvedValue([pendingEntry]);
      mockQuarantineCount.mockResolvedValue(1);

      const result = await adminService.listQuarantine({});

      expect(result.entries[0].payload).toEqual(pendingEntry.payload);
      expect(result.entries[0].stats.z_score).toBe(18.42);
      expect(result.entries[0].reason).toContain('standard deviations');
    });

    it('allows auditing past decisions by status', async () => {
      mockQuarantineFindMany.mockResolvedValue([]);
      mockQuarantineCount.mockResolvedValue(0);

      await adminService.listQuarantine({ status: 'approved' });

      expect(mockQuarantineFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'approved' } }),
      );
    });

    it('status=all removes the filter entirely', async () => {
      mockQuarantineFindMany.mockResolvedValue([]);
      mockQuarantineCount.mockResolvedValue(0);

      await adminService.listQuarantine({ status: 'all' });

      expect(mockQuarantineFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('orders newest first', async () => {
      mockQuarantineFindMany.mockResolvedValue([]);
      mockQuarantineCount.mockResolvedValue(0);

      await adminService.listQuarantine({});

      expect(mockQuarantineFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { quarantinedAt: 'desc' } }),
      );
    });

    it('caps the page size so a caller cannot pull the whole table', async () => {
      mockQuarantineFindMany.mockResolvedValue([]);
      mockQuarantineCount.mockResolvedValue(0);

      await adminService.listQuarantine({ limit: 100_000 });

      expect(mockQuarantineFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });
  });

  // ── Depth ─────────────────────────────────────────────────────────────────

  describe('getQuarantineDepth', () => {
    it('counts only pending entries', async () => {
      mockQuarantineCount.mockResolvedValue(7);

      const result = await adminService.getQuarantineDepth();

      expect(result).toEqual({ pending: 7 });
      expect(mockQuarantineCount).toHaveBeenCalledWith({ where: { status: 'pending' } });
    });
  });

  // ── Single entry ──────────────────────────────────────────────────────────

  describe('getQuarantineEntry', () => {
    it('looks up by BigInt id and serialises it back', async () => {
      mockQuarantineFindUnique.mockResolvedValue(pendingEntry);

      const result = await adminService.getQuarantineEntry('42');

      expect(mockQuarantineFindUnique).toHaveBeenCalledWith({ where: { id: BigInt(42) } });
      expect(result.id).toBe('42');
    });

    it('404s on an unknown id', async () => {
      mockQuarantineFindUnique.mockResolvedValue(null);

      await expect(adminService.getQuarantineEntry('999')).rejects.toThrow(NotFoundException);
    });
  });

  // ── Review ────────────────────────────────────────────────────────────────

  describe('reviewQuarantineEntry', () => {
    it('records the decision, reviewer and note', async () => {
      mockQuarantineFindUnique.mockResolvedValue(pendingEntry);
      mockQuarantineUpdate.mockResolvedValue({
        ...pendingEntry,
        status:     'approved',
        reviewedBy: 'GADMIN',
        reviewNote: 'project expanded its area — verified with the developer',
      });

      const result = await adminService.reviewQuarantineEntry(
        '42',
        'approved',
        'GADMIN',
        'project expanded its area — verified with the developer',
      );

      expect(mockQuarantineUpdate).toHaveBeenCalledWith({
        where: { id: BigInt(42) },
        data: expect.objectContaining({
          status:     'approved',
          reviewedBy: 'GADMIN',
          reviewNote: 'project expanded its area — verified with the developer',
        }),
      });
      expect(result.status).toBe('approved');
      expect(result.id).toBe('42');
    });

    it('stamps reviewedAt', async () => {
      mockQuarantineFindUnique.mockResolvedValue(pendingEntry);
      mockQuarantineUpdate.mockResolvedValue({ ...pendingEntry, status: 'rejected' });

      await adminService.reviewQuarantineEntry('42', 'rejected', 'GADMIN');

      const data = mockQuarantineUpdate.mock.calls[0][0].data;
      expect(data.reviewedAt).toBeInstanceOf(Date);
    });

    it('normalises an omitted note to null rather than undefined', async () => {
      mockQuarantineFindUnique.mockResolvedValue(pendingEntry);
      mockQuarantineUpdate.mockResolvedValue({ ...pendingEntry, status: 'rejected' });

      await adminService.reviewQuarantineEntry('42', 'rejected', 'GADMIN');

      expect(mockQuarantineUpdate.mock.calls[0][0].data.reviewNote).toBeNull();
    });

    it('404s on an unknown id', async () => {
      mockQuarantineFindUnique.mockResolvedValue(null);

      await expect(
        adminService.reviewQuarantineEntry('999', 'approved', 'GADMIN'),
      ).rejects.toThrow(NotFoundException);
    });

    it('409s on an already-reviewed entry so two admins cannot overwrite each other', async () => {
      mockQuarantineFindUnique.mockResolvedValue({ ...pendingEntry, status: 'approved' });

      await expect(
        adminService.reviewQuarantineEntry('42', 'rejected', 'GADMIN2'),
      ).rejects.toThrow(ConflictException);

      expect(mockQuarantineUpdate).not.toHaveBeenCalled();
    });
  });
});
