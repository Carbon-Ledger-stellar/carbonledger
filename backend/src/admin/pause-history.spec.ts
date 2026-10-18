/**
 * Unit tests: pause history endpoint and AuditLogEntry creation (#1227, #1228).
 *
 * Covers:
 *   - GET /admin/pause-history returns paginated results
 *   - Filters by contract, action, and date range
 *   - AuditLogEntry is created on pause and unpause (#1227)
 *   - AuditLog (hash-chained) is also created (existing behaviour preserved)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PauseService } from './pause.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';

describe('PauseService - history and audit log (#1227, #1228)', () => {
  let service: PauseService;

  const mockAuditLogEntryCreate = jest.fn().mockResolvedValue({ id: 'ale-1' });
  const mockPauseEventFindMany = jest.fn();
  const mockPauseEventCount = jest.fn();

  const mockBlockchain = { invokeContract: jest.fn() };
  const mockPrisma = {
    $transaction: jest.fn().mockResolvedValue([]),
    adminConfig: { upsert: jest.fn(), findMany: jest.fn() },
    auditLogEntry: { create: mockAuditLogEntryCreate },
    pauseEvent: {
      findMany: mockPauseEventFindMany,
      count: mockPauseEventCount,
    },
  };
  const mockAudit = { createLog: jest.fn() };
  const mockWebhooks = { dispatch: jest.fn() };

  const ADMIN = 'GADMIN';
  const CONTRACT_ID = 'CCREDIT';

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.CARBON_CREDIT_CONTRACT_ID = CONTRACT_ID;
    mockBlockchain.invokeContract.mockResolvedValue({
      txHash: 'tx123', status: 'success', ledger: 42, ledgerClosedAt: '',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PauseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: WebhookService, useValue: mockWebhooks },
        { provide: 'IBlockchainProvider', useValue: mockBlockchain },
      ],
    }).compile();

    service = module.get(PauseService);
  });

  // ── AuditLogEntry creation (#1227) ─────────────────────────────────────────

  describe('AuditLogEntry creation (#1227)', () => {
    it('creates an AuditLogEntry when pausing a contract', async () => {
      const until = Math.floor(Date.now() / 1000) + 3600;
      await service.pauseContract('carbon_credit', ADMIN, until);

      expect(mockAuditLogEntryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor_id: ADMIN,
          action: 'contract.pause',
          resource_type: 'PauseEvent',
          resource_id: CONTRACT_ID,
          details: expect.objectContaining({
            contract: 'carbon_credit',
            action: 'pause',
            admin: ADMIN,
            paused: true,
            pausedUntil: until,
            txHash: 'tx123',
          }),
        }),
      });
    });

    it('creates an AuditLogEntry when unpausing a contract', async () => {
      await service.unpauseContract('carbon_credit', ADMIN);

      expect(mockAuditLogEntryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor_id: ADMIN,
          action: 'contract.unpause',
          resource_type: 'PauseEvent',
          resource_id: CONTRACT_ID,
          details: expect.objectContaining({
            contract: 'carbon_credit',
            action: 'unpause',
            admin: ADMIN,
            paused: false,
            pausedUntil: null,
            txHash: 'tx123',
          }),
        }),
      });
    });

    it('also creates the hash-chained AuditLog entry (existing behaviour preserved)', async () => {
      const until = Math.floor(Date.now() / 1000) + 3600;
      await service.pauseContract('carbon_credit', ADMIN, until);

      expect(mockAudit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ADMIN,
          action: 'contract.pause',
          resourceId: CONTRACT_ID,
          result: 'Success',
          txHash: 'tx123',
        }),
      );
    });

    it('includes traceId in both AuditLog and AuditLogEntry details', async () => {
      const result = await service.unpauseContract('carbon_credit', ADMIN);

      // hash-chained log
      expect(mockAudit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { traceId: result.traceId } }),
      );

      // sensitive-ops entry
      expect(mockAuditLogEntryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: expect.objectContaining({ traceId: result.traceId }),
        }),
      });
    });

    it('does NOT create an AuditLogEntry when the contract call fails', async () => {
      mockBlockchain.invokeContract.mockResolvedValue({
        txHash: 'tx-fail', status: 'failed', error: 'EmergencyPaused', ledger: 1, ledgerClosedAt: '',
      });

      await expect(service.unpauseContract('carbon_credit', ADMIN)).rejects.toThrow();
      expect(mockAuditLogEntryCreate).not.toHaveBeenCalled();
    });
  });

  // ── Pause history pagination (#1228) ──────────────────────────────────────

  describe('getPauseHistory (#1228)', () => {
    const fakePauseEvents = [
      {
        id: 'pe-1',
        contract: 'carbon_credit',
        action: 'pause',
        admin: ADMIN,
        reason: 'Security incident',
        pausedUntil: new Date(Date.now() + 3600_000),
        txHash: 'txabc',
        eventId: null,
        occurredAt: new Date('2026-10-15T10:00:00Z'),
        createdAt: new Date('2026-10-15T10:00:01Z'),
      },
      {
        id: 'pe-2',
        contract: 'carbon_credit',
        action: 'unpause',
        admin: ADMIN,
        reason: null,
        pausedUntil: null,
        txHash: 'txdef',
        eventId: 'ev-1',
        occurredAt: new Date('2026-10-15T11:00:00Z'),
        createdAt: new Date('2026-10-15T11:00:01Z'),
      },
    ];

    beforeEach(() => {
      mockPauseEventFindMany.mockResolvedValue(fakePauseEvents);
      mockPauseEventCount.mockResolvedValue(2);
    });

    it('returns paginated results with total, limit and offset', async () => {
      const result = await service.getPauseHistory({ limit: 20, offset: 0 });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('passes contract filter to Prisma', async () => {
      await service.getPauseHistory({ contract: 'carbon_credit' });

      expect(mockPauseEventFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ contract: 'carbon_credit' }) }),
      );
    });

    it('passes action filter to Prisma', async () => {
      await service.getPauseHistory({ action: 'pause' });

      expect(mockPauseEventFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ action: 'pause' }) }),
      );
    });

    it('passes date range filter to Prisma', async () => {
      const startDate = '2026-10-01T00:00:00Z';
      const endDate = '2026-10-31T23:59:59Z';
      await service.getPauseHistory({ startDate, endDate });

      expect(mockPauseEventFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            occurredAt: {
              gte: new Date(startDate),
              lte: new Date(endDate),
            },
          }),
        }),
      );
    });

    it('orders results by occurredAt desc', async () => {
      await service.getPauseHistory({});

      expect(mockPauseEventFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { occurredAt: 'desc' } }),
      );
    });

    it('clamps limit to max 100', async () => {
      await service.getPauseHistory({ limit: 999 });

      expect(mockPauseEventFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('clamps limit to min 1', async () => {
      await service.getPauseHistory({ limit: 0 });

      expect(mockPauseEventFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });

    it('uses offset for pagination skip', async () => {
      await service.getPauseHistory({ offset: 40 });

      expect(mockPauseEventFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40 }),
      );
    });

    it('includes pause_reason in each returned entry', async () => {
      const result = await service.getPauseHistory({});

      const pauseEntry = result.data.find((e) => e.action === 'pause');
      expect(pauseEntry?.reason).toBe('Security incident');
    });

    it('each entry includes id, contract, action, admin, reason, pausedUntil, txHash, eventId, occurredAt, createdAt', async () => {
      const result = await service.getPauseHistory({});
      const entry = result.data[0];

      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('contract');
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('admin');
      expect(entry).toHaveProperty('reason');
      expect(entry).toHaveProperty('pausedUntil');
      expect(entry).toHaveProperty('txHash');
      expect(entry).toHaveProperty('eventId');
      expect(entry).toHaveProperty('occurredAt');
      expect(entry).toHaveProperty('createdAt');
    });
  });
});
