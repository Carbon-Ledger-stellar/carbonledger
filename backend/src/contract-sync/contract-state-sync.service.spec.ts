import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ContractStateSyncService,
  PauseStatusChangedEvent,
  TRACKED_CONTRACTS,
} from './contract-state-sync.service';
import { PrismaService } from '../prisma.service';

const makePrisma = () => ({
  adminConfig: {
    findUnique: jest.fn(),
  },
  contractSyncState: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
});

describe('ContractStateSyncService', () => {
  let service: ContractStateSyncService;
  let prisma: ReturnType<typeof makePrisma>;
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    events = { emit: jest.fn() };

    // Set env vars before creating the service
    process.env.CARBON_CREDIT_CONTRACT_ID = 'C_CREDIT_ID';
    process.env.CARBON_MARKETPLACE_CONTRACT_ID = 'C_MARKET_ID';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractStateSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = module.get(ContractStateSyncService);
  });

  afterEach(() => {
    delete process.env.CARBON_CREDIT_CONTRACT_ID;
    delete process.env.CARBON_MARKETPLACE_CONTRACT_ID;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sync()', () => {
    it('does not run concurrent syncs', async () => {
      // Simulate a long-running sync by making upsert hang until we release it
      let resolveUpsert!: () => void;
      const pending = new Promise<void>((res) => (resolveUpsert = res));

      prisma.adminConfig.findUnique.mockResolvedValue(null);
      prisma.contractSyncState.findUnique.mockResolvedValue(null);
      prisma.contractSyncState.upsert.mockImplementation(() => pending);

      // Start first sync — will get stuck waiting for upsert
      const first = service.sync();

      // Start second sync immediately — should return without doing anything
      const second = service.sync();
      await second; // should resolve quickly

      // Verify that admin config was called (first sync started)
      expect(prisma.adminConfig.findUnique).toHaveBeenCalled();

      // Unblock the first sync
      resolveUpsert();
      await first;
    });

    it('upserts contract sync state for each tracked contract', async () => {
      const nowSec = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      prisma.adminConfig.findUnique.mockImplementation(({ where: { key } }) => {
        if (key === 'carbon_credit_paused') return Promise.resolve({ value: 'true' });
        if (key === 'carbon_credit_paused_until') return Promise.resolve({ value: String(nowSec) });
        return Promise.resolve(null);
      });
      prisma.contractSyncState.findUnique.mockResolvedValue(null);
      prisma.contractSyncState.upsert.mockResolvedValue({});

      await service.sync();

      // Should be called once per tracked contract (2 contracts × 2 adminConfig lookups)
      expect(prisma.adminConfig.findUnique).toHaveBeenCalledTimes(
        Object.keys(TRACKED_CONTRACTS).length * 2,
      );
      expect(prisma.contractSyncState.upsert).toHaveBeenCalledTimes(
        Object.keys(TRACKED_CONTRACTS).length,
      );
    });

    it('sets isPaused=true when admin config says paused and timestamp is in the future', async () => {
      const futureTs = Math.floor(Date.now() / 1000) + 3600;

      prisma.adminConfig.findUnique.mockImplementation(({ where: { key } }) => {
        if (key === 'carbon_credit_paused') return Promise.resolve({ value: 'true' });
        if (key === 'carbon_credit_paused_until') return Promise.resolve({ value: String(futureTs) });
        return Promise.resolve(null);
      });
      prisma.contractSyncState.findUnique.mockResolvedValue(null);
      prisma.contractSyncState.upsert.mockResolvedValue({});

      await service.sync();

      const upsertCall = prisma.contractSyncState.upsert.mock.calls.find(
        ([args]) => args.where.contractId === 'C_CREDIT_ID',
      );
      expect(upsertCall).toBeDefined();
      expect(upsertCall[0].update.isPaused).toBe(true);
    });

    it('sets isPaused=false when timestamp has expired', async () => {
      const pastTs = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      prisma.adminConfig.findUnique.mockImplementation(({ where: { key } }) => {
        if (key === 'carbon_credit_paused') return Promise.resolve({ value: 'true' });
        if (key === 'carbon_credit_paused_until') return Promise.resolve({ value: String(pastTs) });
        return Promise.resolve(null);
      });
      prisma.contractSyncState.findUnique.mockResolvedValue(null);
      prisma.contractSyncState.upsert.mockResolvedValue({});

      await service.sync();

      const upsertCall = prisma.contractSyncState.upsert.mock.calls.find(
        ([args]) => args.where.contractId === 'C_CREDIT_ID',
      );
      expect(upsertCall[0].update.isPaused).toBe(false);
    });

    it('emits PauseStatusChangedEvent when isPaused transitions true→false', async () => {
      prisma.adminConfig.findUnique.mockImplementation(({ where: { key } }) => {
        // Contract is now unpaused
        if (key === 'carbon_credit_paused') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      // Previous state had isPaused=true
      prisma.contractSyncState.findUnique.mockImplementation(({ where: { contractId } }) => {
        if (contractId === 'C_CREDIT_ID') return Promise.resolve({ isPaused: true });
        return Promise.resolve(null);
      });
      prisma.contractSyncState.upsert.mockResolvedValue({});

      await service.sync();

      expect(events.emit).toHaveBeenCalledWith(
        'pause.status.changed',
        expect.objectContaining({
          contractName: 'carbon_credit',
          contractId: 'C_CREDIT_ID',
          isPaused: false,
        }),
      );
    });

    it('emits PauseStatusChangedEvent when isPaused transitions false→true', async () => {
      const futureTs = Math.floor(Date.now() / 1000) + 3600;

      prisma.adminConfig.findUnique.mockImplementation(({ where: { key } }) => {
        if (key === 'carbon_credit_paused') return Promise.resolve({ value: 'true' });
        if (key === 'carbon_credit_paused_until') return Promise.resolve({ value: String(futureTs) });
        return Promise.resolve(null);
      });
      prisma.contractSyncState.findUnique.mockImplementation(({ where: { contractId } }) => {
        if (contractId === 'C_CREDIT_ID') return Promise.resolve({ isPaused: false });
        return Promise.resolve(null);
      });
      prisma.contractSyncState.upsert.mockResolvedValue({});

      await service.sync();

      expect(events.emit).toHaveBeenCalledWith(
        'pause.status.changed',
        expect.objectContaining({
          contractName: 'carbon_credit',
          contractId: 'C_CREDIT_ID',
          isPaused: true,
        }),
      );
    });

    it('does NOT emit event when isPaused stays unchanged', async () => {
      prisma.adminConfig.findUnique.mockResolvedValue(null);
      prisma.contractSyncState.findUnique.mockResolvedValue({ isPaused: false });
      prisma.contractSyncState.upsert.mockResolvedValue({});

      await service.sync();

      expect(events.emit).not.toHaveBeenCalled();
    });

    it('handles fast pause/unpause cycles — emits on every flip', async () => {
      const futureTs = Math.floor(Date.now() / 1000) + 3600;

      // First call: paused
      prisma.adminConfig.findUnique
        .mockResolvedValueOnce({ value: 'true' })          // carbon_credit_paused (cycle 1)
        .mockResolvedValueOnce({ value: String(futureTs) }) // carbon_credit_paused_until (cycle 1)
        .mockResolvedValueOnce(null)                        // carbon_marketplace_paused (cycle 1)
        .mockResolvedValueOnce(null)                        // carbon_marketplace_paused_until (cycle 1)
        .mockResolvedValueOnce({ value: 'false' })          // carbon_credit_paused (cycle 2)
        .mockResolvedValueOnce(null)                        // carbon_credit_paused_until (cycle 2)
        .mockResolvedValueOnce(null)                        // carbon_marketplace_paused (cycle 2)
        .mockResolvedValueOnce(null);                       // carbon_marketplace_paused_until (cycle 2)

      prisma.contractSyncState.findUnique
        .mockResolvedValueOnce(null)          // no previous for credit (cycle 1)
        .mockResolvedValueOnce(null)          // no previous for marketplace (cycle 1)
        .mockResolvedValueOnce({ isPaused: true })  // credit was paused (cycle 2)
        .mockResolvedValueOnce({ isPaused: false }); // marketplace unchanged

      prisma.contractSyncState.upsert.mockResolvedValue({});

      await service.sync(); // cycle 1 — no previous state, no event
      await service.sync(); // cycle 2 — credit transitions true→false

      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(
        'pause.status.changed',
        expect.objectContaining({ isPaused: false }),
      );
    });

    it('increments consecutiveErrors on DB failure', async () => {
      prisma.adminConfig.findUnique.mockRejectedValue(new Error('DB unavailable'));
      prisma.contractSyncState.upsert.mockResolvedValue({});

      await service.sync(); // should not throw

      // Should call upsert with consecutiveErrors: { increment: 1 }
      const errorUpsert = prisma.contractSyncState.upsert.mock.calls.find(
        ([args]) => args.update?.consecutiveErrors?.increment === 1,
      );
      expect(errorUpsert).toBeDefined();
    });
  });

  describe('getCachedPauseStatuses()', () => {
    it('returns mapped rows from contractSyncState', async () => {
      (prisma as any).contractSyncState.findMany = jest.fn().mockResolvedValue([
        {
          contractId: 'C_CREDIT_ID',
          contractName: 'carbon_credit',
          isPaused: true,
          pauseReason: 'Security incident',
          pausedUntil: new Date('2026-01-01'),
        },
      ]);

      const result = await service.getCachedPauseStatuses();
      expect(result).toHaveLength(1);
      expect(result[0].isPaused).toBe(true);
      expect(result[0].reason).toBe('Security incident');
    });
  });
});
