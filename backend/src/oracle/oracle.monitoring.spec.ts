import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OracleService } from './oracle.service';
import { SubmitMonitoringDataDto } from './monitoring.dto';
import { PrismaService } from '../prisma.service';
import { QUEUE_NAME } from '../queue/queue.constants';
import { getQueueToken } from '@nestjs/bullmq';
import { RedisService } from '../redis.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a valid DTO with an optional timestamp override. */
function makeDto(overrides: Partial<SubmitMonitoringDataDto> = {}): SubmitMonitoringDataDto {
  return {
    project_id:         'PROJ-001',
    satellite_provider: 'Google Earth Engine',
    url:                'https://example.com/satellite/report.json',
    co2_reduction_mmt:  1500,
    timestamp:          new Date().toISOString(),
    ...overrides,
  } as SubmitMonitoringDataDto;
}

/** ISO string for a date that is `days` days in the past. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** ISO string for a date that is `minutes` minutes in the future. */
function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
};

const mockRedis = {
  del: jest.fn().mockResolvedValue(undefined),
};

/**
 * Builds a mock PrismaService whose responses can be overridden per test.
 */
function buildPrismaMock(overrides: {
  monitoringDataFindUnique?: jest.Mock;
  monitoringDataCreate?: jest.Mock;
  carbonProjectFindFirst?: jest.Mock;
} = {}) {
  return {
    monitoringData: {
      findUnique: overrides.monitoringDataFindUnique ?? jest.fn().mockResolvedValue(null),
      create: overrides.monitoringDataCreate ?? jest.fn().mockResolvedValue({
        id:             'rec-1',
        projectId:      'PROJ-001',
        period:         '2026-08',
        tonnesVerified: 1500,
        submittedAt:    new Date(),
        submittedBy:    'GVERIFIER',
      }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    carbonProject: {
      findFirst: overrides.carbonProjectFindFirst ?? jest.fn().mockResolvedValue({ id: 'proj-db-1', projectId: 'PROJ-001' }),
    },
  } as unknown as PrismaService;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('OracleService.submitMonitoringData', () => {
  let service: OracleService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  /** Re-compile the module with fresh mocks before each test. */
  async function compileWithPrisma(prismaMock: ReturnType<typeof buildPrismaMock>) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleService,
        { provide: PrismaService,           useValue: prismaMock },
        { provide: getQueueToken(QUEUE_NAME), useValue: mockQueue },
        { provide: RedisService,             useValue: mockRedis },
      ],
    }).compile();
    service = module.get<OracleService>(OracleService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
    await compileWithPrisma(prisma);
  });

  // ── 1. Valid submission ───────────────────────────────────────────────────

  it('creates a monitoring record and returns the expected shape', async () => {
    const dto = makeDto();
    const result = await service.submitMonitoringData(dto, 'GVERIFIER');

    expect(result).toMatchObject({
      id:             'rec-1',
      projectId:      'PROJ-001',
      tonnesVerified: 1500,
      submittedBy:    'GVERIFIER',
    });
    expect(result).toHaveProperty('period');
    expect(result).toHaveProperty('submittedAt');
    expect(prisma.monitoringData.create).toHaveBeenCalledTimes(1);
  });

  it('derives period from timestamp in YYYY-MM format when period is not provided', async () => {
    const dto = makeDto({ timestamp: '2026-08-30T12:00:00.000Z' });
    await service.submitMonitoringData(dto, 'GVERIFIER');

    const createCall = (prisma.monitoringData.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.period).toBe('2026-08');
  });

  it('uses the explicitly provided period when supplied', async () => {
    const dto = makeDto({ period: '2026-Q3', timestamp: '2026-08-30T12:00:00.000Z' });
    await service.submitMonitoringData(dto, 'GVERIFIER');

    const createCall = (prisma.monitoringData.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.period).toBe('2026-Q3');
  });

  it('uses satellite_cid when provided, falling back to url', async () => {
    const dtoWithCid = makeDto({ satellite_cid: 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco' });
    await service.submitMonitoringData(dtoWithCid, 'GVERIFIER');
    let createCall = (prisma.monitoringData.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.satelliteCid).toBe('QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco');

    jest.clearAllMocks();
    prisma = buildPrismaMock();
    await compileWithPrisma(prisma);

    const dtoWithoutCid = makeDto();
    await service.submitMonitoringData(dtoWithoutCid, 'GVERIFIER');
    createCall = (prisma.monitoringData.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.satelliteCid).toBe(dtoWithoutCid.url);
  });

  it('defaults methodologyScore to 0 when not supplied', async () => {
    const dto = makeDto(); // methodology_score is undefined
    await service.submitMonitoringData(dto, 'GVERIFIER');

    const createCall = (prisma.monitoringData.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.methodologyScore).toBe(0);
  });

  it('stores the provided methodologyScore when supplied', async () => {
    const dto = makeDto({ methodology_score: 85 });
    await service.submitMonitoringData(dto, 'GVERIFIER');

    const createCall = (prisma.monitoringData.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.methodologyScore).toBe(85);
  });

  // ── 2. Missing / invalid required fields (service-level guard) ───────────
  //
  // NestJS ValidationPipe handles DTO validation before the service, but we
  // verify that the service itself gracefully handles edge cases (e.g. a
  // timestamp that passes class-validator @IsDateString but is logically bad).

  it('throws BadRequestException when project is not found', async () => {
    prisma = buildPrismaMock({
      carbonProjectFindFirst: jest.fn().mockResolvedValue(null),
    });
    await compileWithPrisma(prisma);

    const dto = makeDto();
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── 3. Duplicate submission ───────────────────────────────────────────────

  it('throws ConflictException when the same projectId+period already exists', async () => {
    prisma = buildPrismaMock({
      monitoringDataFindUnique: jest.fn().mockResolvedValue({
        id:        'existing-1',
        projectId: 'PROJ-001',
        period:    '2026-08',
      }),
    });
    await compileWithPrisma(prisma);

    const dto = makeDto({ timestamp: '2026-08-15T00:00:00.000Z' });
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.monitoringData.create).not.toHaveBeenCalled();
  });

  it('ConflictException message contains projectId and period', async () => {
    prisma = buildPrismaMock({
      monitoringDataFindUnique: jest.fn().mockResolvedValue({ id: 'x', projectId: 'PROJ-001', period: '2026-08' }),
    });
    await compileWithPrisma(prisma);

    const dto = makeDto({ timestamp: '2026-08-15T00:00:00.000Z' });
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).rejects.toMatchObject({
      message: expect.stringContaining('PROJ-001'),
    });
  });

  // ── 4. Stale timestamp ───────────────────────────────────────────────────

  it('throws BadRequestException when timestamp is older than 365 days', async () => {
    const dto = makeDto({ timestamp: daysAgo(366) });
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).rejects.toThrow(
      BadRequestException,
    );
    // DB should not be touched for an obviously stale record
    expect(prisma.monitoringData.findUnique).not.toHaveBeenCalled();
    expect(prisma.monitoringData.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException with the stale message for a 366-day-old timestamp', async () => {
    const dto = makeDto({ timestamp: daysAgo(366) });
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).rejects.toMatchObject({
      message: 'Timestamp is older than 365 days — data is stale',
    });
  });

  it('accepts a timestamp that is exactly 364 days old', async () => {
    const dto = makeDto({ timestamp: daysAgo(364) });
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).resolves.toBeDefined();
  });

  it('throws BadRequestException when timestamp is more than 5 minutes in the future', async () => {
    const dto = makeDto({ timestamp: minutesFromNow(10) });
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).rejects.toMatchObject({
      message: 'Timestamp is in the future',
    });
  });

  it('accepts a timestamp 4 minutes in the future (within tolerance)', async () => {
    const dto = makeDto({ timestamp: minutesFromNow(4) });
    await expect(service.submitMonitoringData(dto, 'GVERIFIER')).resolves.toBeDefined();
  });
});
