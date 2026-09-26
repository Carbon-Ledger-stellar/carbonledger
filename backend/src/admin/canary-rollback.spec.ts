/**
 * Integration tests: canary deployment — automated rollback on error threshold.
 *
 * These tests verify the full canary traffic-split logic and the error-rate
 * computation that Grafana uses to trigger the auto-rollback webhook.
 *
 * No real Soroban network connections are required; the suite is fully
 * self-contained using NestJS TestingModule.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { StellarNetworkService } from '../common/stellar-network.service';
import { contractCallsRegistry } from '../common/metrics.registry';
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

const mockPrismaUpsert = jest.fn().mockResolvedValue({});
const mockPrismaFindMany = jest.fn().mockResolvedValue([]);
const mockPrismaFindFirst = jest.fn().mockResolvedValue(null);
const mockPrismaFindUnique = jest.fn().mockResolvedValue(null);
const mockPrismaUpdate = jest.fn().mockResolvedValue({});
const mockPrismaCount = jest.fn().mockResolvedValue(0);

const mockPrisma = {
  adminConfig:    { upsert: mockPrismaUpsert, findUnique: mockPrismaFindUnique },
  user:           { upsert: mockPrismaUpsert, update: mockPrismaUpdate, findMany: mockPrismaFindMany },
  auditLog:       { findMany: mockPrismaFindMany },
  monitoringData: { findFirst: mockPrismaFindFirst },
  syncMetadata:   { update: mockPrismaUpdate },
};

const mockIndexer = {
  sync: jest.fn().mockResolvedValue(undefined),
};

const mockOracle = {
  getPriceApprovals: jest.fn().mockResolvedValue([]),
};

// ── Test suite ───────────────────────────────────────────────────────────────

const PRIMARY_CONTRACT_ID = 'CPRIMARY000000000000000000000000000000000000000000000000';
const CANARY_CONTRACT_ID  = 'CCANARY0000000000000000000000000000000000000000000000000';

describe('Canary Deployment — automated rollback integration', () => {
  let stellarNetwork: StellarNetworkService;
  let adminService: AdminService;

  beforeEach(async () => {
    // Reset process.env canary config for each test
    delete process.env.CANARY_CONTRACT_ID;
    delete process.env.CANARY_TRAFFIC_PCT;

    // Reset the in-process Prometheus counter registry
    contractCallsRegistry.reset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarNetworkService,
        AdminService,
        { provide: PrismaService,  useValue: mockPrisma   },
        { provide: IndexerService, useValue: mockIndexer  },
        { provide: OracleService,  useValue: mockOracle   },
        { provide: RedisService,  useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
        // #964 recovery deps — not under test here, only need to satisfy DI.
        { provide: ProjectsService,    useValue: {} },
        { provide: CreditsService,     useValue: {} },
        { provide: RetirementsService, useValue: {} },
        { provide: AuditService,       useValue: { createLog: jest.fn() } },
      ],
    }).compile();

    stellarNetwork = module.get(StellarNetworkService);
    adminService   = module.get(AdminService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Contract resolution ───────────────────────────────────────────────────

  it('routes 100% to primary when canary is disabled (trafficPct=0)', () => {
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: 0 });

    for (let i = 0; i < 100; i++) {
      const { label } = stellarNetwork.resolveContract(PRIMARY_CONTRACT_ID);
      expect(label).toBe('primary');
    }
  });

  it('routes 100% to primary when canaryContractId is null', () => {
    stellarNetwork.setCanaryConfig({ canaryContractId: null, trafficPct: 50 });

    for (let i = 0; i < 100; i++) {
      const { label } = stellarNetwork.resolveContract(PRIMARY_CONTRACT_ID);
      expect(label).toBe('primary');
    }
  });

  it('returns primary contract ID when canary is disabled', () => {
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: 0 });

    const { contractId, label } = stellarNetwork.resolveContract(PRIMARY_CONTRACT_ID);
    expect(contractId).toBe(PRIMARY_CONTRACT_ID);
    expect(label).toBe('primary');
  });

  it('returns canary contract ID when canary wins the routing roll', () => {
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: 100 });

    const { contractId, label } = stellarNetwork.resolveContract(PRIMARY_CONTRACT_ID);
    expect(contractId).toBe(CANARY_CONTRACT_ID);
    expect(label).toBe('canary');
  });

  it('statistically routes ~50% of calls to canary at trafficPct=50', () => {
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: 50 });

    let canaryHits = 0;
    const trials = 2000;

    for (let i = 0; i < trials; i++) {
      const { label } = stellarNetwork.resolveContract(PRIMARY_CONTRACT_ID);
      if (label === 'canary') canaryHits++;
    }

    // Expect roughly 50% ± 5% (very loose to avoid flakiness)
    const pct = (canaryHits / trials) * 100;
    expect(pct).toBeGreaterThan(40);
    expect(pct).toBeLessThan(60);
  });

  // ── Prometheus counter recording ──────────────────────────────────────────

  it('increments primary success counter on successful primary call', () => {
    stellarNetwork.recordCall('primary', 'success');
    stellarNetwork.recordCall('primary', 'success');

    expect(contractCallsRegistry.get('primary', 'success')).toBe(2);
    expect(contractCallsRegistry.get('primary', 'error')).toBe(0);
  });

  it('increments canary error counter on failed canary call', () => {
    stellarNetwork.recordCall('canary', 'error');

    expect(contractCallsRegistry.get('canary', 'error')).toBe(1);
    expect(contractCallsRegistry.get('canary', 'success')).toBe(0);
  });

  it('renders correct Prometheus text output', () => {
    stellarNetwork.recordCall('primary', 'success');
    stellarNetwork.recordCall('primary', 'success');
    stellarNetwork.recordCall('primary', 'error');
    stellarNetwork.recordCall('canary',  'success');
    stellarNetwork.recordCall('canary',  'error');
    stellarNetwork.recordCall('canary',  'error');

    const text = contractCallsRegistry.toPrometheusText();

    expect(text).toContain('contract_calls_total{contract="primary",status="success"} 2');
    expect(text).toContain('contract_calls_total{contract="primary",status="error"} 1');
    expect(text).toContain('contract_calls_total{contract="canary",status="success"} 1');
    expect(text).toContain('contract_calls_total{contract="canary",status="error"} 2');
  });

  // ── Error rate computation ─────────────────────────────────────────────────

  it('returns zero error rates when there are no recorded calls', () => {
    const rates = stellarNetwork.getErrorRates();

    expect(rates.primary).toBe(0);
    expect(rates.canary).toBe(0);
  });

  it('computes correct error rates with mixed success/error calls', () => {
    // Primary: 90 successes, 10 errors → 10% error rate
    for (let i = 0; i < 90; i++) stellarNetwork.recordCall('primary', 'success');
    for (let i = 0; i < 10; i++) stellarNetwork.recordCall('primary', 'error');

    // Canary: 70 successes, 30 errors → 30% error rate
    for (let i = 0; i < 70; i++) stellarNetwork.recordCall('canary', 'success');
    for (let i = 0; i < 30; i++) stellarNetwork.recordCall('canary', 'error');

    const rates = stellarNetwork.getErrorRates();

    expect(rates.primary).toBeCloseTo(0.10, 2);
    expect(rates.canary).toBeCloseTo(0.30, 2);
  });

  it('detects when canary error rate exceeds 1.5× primary (rollback threshold)', () => {
    // Primary: 5% error rate
    for (let i = 0; i < 95; i++) stellarNetwork.recordCall('primary', 'success');
    for (let i = 0; i < 5;  i++) stellarNetwork.recordCall('primary', 'error');

    // Canary: 15% error rate = 3× primary → should trigger rollback
    for (let i = 0; i < 85; i++) stellarNetwork.recordCall('canary', 'success');
    for (let i = 0; i < 15; i++) stellarNetwork.recordCall('canary', 'error');

    const rates = stellarNetwork.getErrorRates();
    const exceedsThreshold = rates.canary > rates.primary * 1.5;

    expect(exceedsThreshold).toBe(true);
  });

  it('does NOT trigger rollback when canary error rate is within threshold', () => {
    // Primary: 5% error rate
    for (let i = 0; i < 95; i++) stellarNetwork.recordCall('primary', 'success');
    for (let i = 0; i < 5;  i++) stellarNetwork.recordCall('primary', 'error');

    // Canary: 6% error rate = 1.2× primary → below 1.5× threshold
    for (let i = 0; i < 94; i++) stellarNetwork.recordCall('canary', 'success');
    for (let i = 0; i < 6;  i++) stellarNetwork.recordCall('canary', 'error');

    const rates = stellarNetwork.getErrorRates();
    const exceedsThreshold = rates.canary > rates.primary * 1.5;

    expect(exceedsThreshold).toBe(false);
  });

  // ── Automatic rollback via admin service ──────────────────────────────────

  it('rolls back to 0% canary traffic when admin updateCanary is called with trafficPct=0', () => {
    // Start with canary enabled at 50%
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: 50 });
    expect(stellarNetwork.getCanaryConfig().trafficPct).toBe(50);

    // Simulate the Grafana webhook calling the admin service with trafficPct=0
    const result = adminService.updateCanary({ trafficPct: 0 });

    expect(result.config.trafficPct).toBe(0);
    // Verify AdminConfig upsert was called to persist the rollback
    expect(mockPrismaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { key: 'canary_traffic_pct' },
        update: { value: '0' },
      }),
    );
  });

  it('full rollback scenario: canary errors spike → admin zeros traffic', () => {
    // 1. Enable canary at 10%
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: 10 });

    // 2. Simulate calls: primary healthy, canary failing above threshold
    for (let i = 0; i < 90; i++) stellarNetwork.recordCall('primary', 'success');
    for (let i = 0; i < 2;  i++) stellarNetwork.recordCall('primary', 'error');   // ~2% primary
    for (let i = 0; i < 4;  i++) stellarNetwork.recordCall('canary',  'success');
    for (let i = 0; i < 6;  i++) stellarNetwork.recordCall('canary',  'error');   // 60% canary

    // 3. Check threshold
    const rates = stellarNetwork.getErrorRates();
    const shouldRollback = rates.canary > rates.primary * 1.5;
    expect(shouldRollback).toBe(true);

    // 4. Simulate the auto-rollback webhook (Grafana → admin API)
    adminService.updateCanary({ trafficPct: 0 });

    // 5. Verify all subsequent calls go to primary only
    for (let i = 0; i < 20; i++) {
      const { label } = stellarNetwork.resolveContract(PRIMARY_CONTRACT_ID);
      expect(label).toBe('primary');
    }
  });

  // ── Admin config persistence ───────────────────────────────────────────────

  it('persists trafficPct and contractId to AdminConfig on update', () => {
    adminService.updateCanary({
      canaryContractId: CANARY_CONTRACT_ID,
      trafficPct: 25,
    });

    // Wait for the non-blocking upsert calls to be registered
    expect(mockPrismaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { key: 'canary_traffic_pct' },
        update: { value: '25' },
        create: { key: 'canary_traffic_pct', value: '25' },
      }),
    );
    expect(mockPrismaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { key: 'canary_contract_id' },
        update: { value: CANARY_CONTRACT_ID },
        create: { key: 'canary_contract_id', value: CANARY_CONTRACT_ID },
      }),
    );
  });

  // ── Admin GET canary status ────────────────────────────────────────────────

  it('getCanaryStatus returns config snapshot and current error rates', () => {
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: 15 });
    stellarNetwork.recordCall('primary', 'success');
    stellarNetwork.recordCall('canary',  'error');

    const status = adminService.getCanaryStatus();

    expect(status.config.trafficPct).toBe(15);
    expect(status.config.canaryContractId).toBe(CANARY_CONTRACT_ID);
    expect(status.errorRates.primary).toBe(0);
    expect(status.errorRates.canary).toBe(1);
  });

  // ── trafficPct clamping ────────────────────────────────────────────────────

  it('clamps trafficPct to 100 when a value above 100 is supplied', () => {
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: 150 });
    expect(stellarNetwork.getCanaryConfig().trafficPct).toBe(100);
  });

  it('clamps trafficPct to 0 when a negative value is supplied', () => {
    stellarNetwork.setCanaryConfig({ canaryContractId: CANARY_CONTRACT_ID, trafficPct: -10 });
    expect(stellarNetwork.getCanaryConfig().trafficPct).toBe(0);
  });
});
