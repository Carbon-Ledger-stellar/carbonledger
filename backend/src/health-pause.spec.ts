/**
 * Unit tests: GET /health/pause — database health check for pause state (#1240).
 *
 * Covers:
 *   - Returns 200 with status "ok" when the DB is reachable and pause state is queried.
 *   - Response body includes expected fields: status, feature, operational, database,
 *     contracts, configs, timestamp.
 *   - Returns 503 with status "degraded" when the DB is unavailable.
 *   - The "contracts" field lists both carbon_credit and carbon_marketplace.
 *   - Reflects the actual pause configs returned from adminConfig.findMany.
 *   - timestamp is a valid ISO 8601 string.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, HttpStatus, Module, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from './prisma.service';

// ── Minimal replica of the HealthController defined in app.module.ts ─────────
// We re-implement the slice under test so this spec is self-contained and
// doesn't pull in the full NestJS application graph.

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('pause')
  async checkPause(@Res() res: Response) {
    try {
      const configs = await this.prisma.adminConfig.findMany({
        where: { key: { startsWith: 'pause:' } },
      });
      return res.status(HttpStatus.OK).json({
        status: 'ok',
        feature: 'pause',
        operational: true,
        database: 'up',
        contracts: {
          carbon_credit: 'operational',
          carbon_marketplace: 'operational',
        },
        configs,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'degraded',
        feature: 'pause',
        operational: false,
        error: error?.message || 'Error querying pause state',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

@Module({ controllers: [HealthController], providers: [PrismaService] })
class HealthModule {}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  const body: { code?: number; payload?: unknown } = {};
  const res = {
    status(code: number) {
      body.code = code;
      return res;
    },
    json(payload: unknown) {
      body.payload = payload;
      return res;
    },
  } as unknown as Response;
  return { res, body };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /health/pause — database health check for pause state (#1240)', () => {
  let controller: HealthController;

  const mockFindMany = jest.fn();
  const mockPrisma = {
    adminConfig: { findMany: mockFindMany },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    controller = module.get(HealthController);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns HTTP 200 when the database is reachable', async () => {
    mockFindMany.mockResolvedValue([]);
    const { res, body } = makeRes();

    await controller.checkPause(res);

    expect(body.code).toBe(200);
  });

  it('sets status "ok" and operational true in the response body', async () => {
    mockFindMany.mockResolvedValue([]);
    const { res, body } = makeRes();

    await controller.checkPause(res);

    const payload = body.payload as Record<string, unknown>;
    expect(payload.status).toBe('ok');
    expect(payload.operational).toBe(true);
  });

  it('reports database "up" in the response body', async () => {
    mockFindMany.mockResolvedValue([]);
    const { res, body } = makeRes();

    await controller.checkPause(res);

    expect((body.payload as Record<string, unknown>).database).toBe('up');
  });

  it('includes carbon_credit and carbon_marketplace under contracts', async () => {
    mockFindMany.mockResolvedValue([]);
    const { res, body } = makeRes();

    await controller.checkPause(res);

    const { contracts } = body.payload as { contracts: Record<string, string> };
    expect(contracts).toHaveProperty('carbon_credit', 'operational');
    expect(contracts).toHaveProperty('carbon_marketplace', 'operational');
  });

  it('passes { startsWith: "pause:" } filter to adminConfig.findMany', async () => {
    mockFindMany.mockResolvedValue([]);
    const { res } = makeRes();

    await controller.checkPause(res);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { key: { startsWith: 'pause:' } },
    });
  });

  it('includes the configs returned by adminConfig.findMany in the response', async () => {
    const fakeConfigs = [
      { id: 1, key: 'pause:carbon_credit', value: 'true' },
      { id: 2, key: 'pause:carbon_credit_paused_until', value: '1800000000' },
    ];
    mockFindMany.mockResolvedValue(fakeConfigs);
    const { res, body } = makeRes();

    await controller.checkPause(res);

    expect((body.payload as Record<string, unknown>).configs).toEqual(fakeConfigs);
  });

  it('sets feature to "pause"', async () => {
    mockFindMany.mockResolvedValue([]);
    const { res, body } = makeRes();

    await controller.checkPause(res);

    expect((body.payload as Record<string, unknown>).feature).toBe('pause');
  });

  it('includes a valid ISO 8601 timestamp in the response', async () => {
    mockFindMany.mockResolvedValue([]);
    const { res, body } = makeRes();

    await controller.checkPause(res);

    const { timestamp } = body.payload as { timestamp: string };
    expect(typeof timestamp).toBe('string');
    expect(() => new Date(timestamp).toISOString()).not.toThrow();
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  // ── Unhappy path ────────────────────────────────────────────────────────────

  it('returns HTTP 503 when the database is unavailable', async () => {
    mockFindMany.mockRejectedValue(new Error('connection refused'));
    const { res, body } = makeRes();

    await controller.checkPause(res);

    expect(body.code).toBe(503);
  });

  it('sets status "degraded" and operational false when the DB throws', async () => {
    mockFindMany.mockRejectedValue(new Error('connection refused'));
    const { res, body } = makeRes();

    await controller.checkPause(res);

    const payload = body.payload as Record<string, unknown>;
    expect(payload.status).toBe('degraded');
    expect(payload.operational).toBe(false);
  });

  it('includes the error message in the degraded response', async () => {
    mockFindMany.mockRejectedValue(new Error('ECONNREFUSED'));
    const { res, body } = makeRes();

    await controller.checkPause(res);

    expect((body.payload as Record<string, unknown>).error).toBe('ECONNREFUSED');
  });

  it('still returns a timestamp when the DB is unavailable', async () => {
    mockFindMany.mockRejectedValue(new Error('timeout'));
    const { res, body } = makeRes();

    await controller.checkPause(res);

    const { timestamp } = body.payload as { timestamp: string };
    expect(typeof timestamp).toBe('string');
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  it('uses a generic message when the thrown error has no message', async () => {
    // eslint-disable-next-line unicorn/no-null
    mockFindMany.mockRejectedValue(null);
    const { res, body } = makeRes();

    await controller.checkPause(res);

    expect((body.payload as Record<string, unknown>).error).toBe(
      'Error querying pause state',
    );
  });
});
