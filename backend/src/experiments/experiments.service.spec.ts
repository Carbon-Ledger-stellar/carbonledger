import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExperimentsService } from './experiments.service';
import { assign, hashSubject } from './experiment-engine';
import { findExperiment } from './experiments.config';

jest.mock('../prisma.service', () => ({ PrismaService: class PrismaService {} }));

const ADMIN = 'GADMINKEY';

function makePrisma() {
  const config = new Map<string, string>();
  const exposures: Array<{ experimentKey: string; variant: string; subjectHash: string }> = [];
  const events: Array<{ experimentKey: string; variant: string; subjectHash: string; metric: string; value: number }> = [];
  return {
    config,
    exposures,
    events,
    adminConfig: {
      findUnique: jest.fn(async ({ where }: any) =>
        config.has(where.key) ? { key: where.key, value: config.get(where.key) } : null,
      ),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        config.set(where.key, config.has(where.key) ? update.value : create.value);
      }),
    },
    experimentExposure: {
      findUnique: jest.fn(async ({ where }: any) => {
        const w = where.experimentKey_subjectHash;
        return exposures.find((e) => e.experimentKey === w.experimentKey && e.subjectHash === w.subjectHash) ?? null;
      }),
      upsert: jest.fn(async ({ where, create }: any) => {
        const w = where.experimentKey_subjectHash;
        if (!exposures.some((e) => e.experimentKey === w.experimentKey && e.subjectHash === w.subjectHash)) {
          exposures.push(create);
        }
      }),
      groupBy: jest.fn(async ({ where }: any) => {
        const counts = new Map<string, number>();
        for (const e of exposures.filter((x) => x.experimentKey === where.experimentKey)) {
          counts.set(e.variant, (counts.get(e.variant) ?? 0) + 1);
        }
        return [...counts].map(([variant, n]) => ({ variant, _count: { _all: n } }));
      }),
    },
    experimentMetricEvent: {
      create: jest.fn(async ({ data }: any) => events.push({ value: 1, ...data })),
      groupBy: jest.fn(async ({ where }: any) => {
        const sums = new Map<string, { variant: string; subjectHash: string; sum: number }>();
        for (const e of events.filter((x) => x.experimentKey === where.experimentKey && x.metric === where.metric)) {
          const k = `${e.variant}|${e.subjectHash}`;
          const cur = sums.get(k) ?? { variant: e.variant, subjectHash: e.subjectHash, sum: 0 };
          cur.sum += e.value;
          sums.set(k, cur);
        }
        return [...sums.values()].map((s) => ({ variant: s.variant, subjectHash: s.subjectHash, _sum: { value: s.sum } }));
      }),
    },
  };
}

describe('ExperimentsService (#1326)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ExperimentsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ExperimentsService(prisma as never);
  });

  describe('state', () => {
    it('defaults to draft with 0% rollout', async () => {
      expect(await service.getState('pause_confirmation_step')).toEqual({ status: 'draft', rolloutPercent: 0 });
    });

    it('persists updates and records who made them', async () => {
      await service.updateState('pause_confirmation_step', { status: 'running', rolloutPercent: 25 }, ADMIN);
      expect(await service.getState('pause_confirmation_step')).toMatchObject({
        status: 'running',
        rolloutPercent: 25,
        updatedBy: ADMIN,
      });
    });

    it('validates rollout, winner and conclusion', async () => {
      await expect(service.updateState('pause_confirmation_step', { rolloutPercent: 101 }, ADMIN)).rejects.toThrow(BadRequestException);
      await expect(service.updateState('pause_confirmation_step', { winner: 'nope' }, ADMIN)).rejects.toThrow(/Unknown variant/);
      await expect(service.updateState('pause_confirmation_step', { status: 'concluded' }, ADMIN)).rejects.toThrow(/winner is required/);
      await expect(service.updateState('missing', {}, ADMIN)).rejects.toThrow(NotFoundException);
    });

    it('drops the winner when an experiment is re-opened', async () => {
      await service.updateState('pause_confirmation_step', { status: 'concluded', winner: 'typed_confirmation' }, ADMIN);
      const next = await service.updateState('pause_confirmation_step', { status: 'running' }, ADMIN);
      expect(next.winner).toBeUndefined();
    });

    it('falls back to the default when stored state is corrupt', async () => {
      prisma.config.set('experiment:pause_confirmation_step', '{not json');
      expect((await service.getState('pause_confirmation_step')).status).toBe('draft');
    });
  });

  describe('flags', () => {
    it('only returns admin experiments to admins', async () => {
      expect(Object.keys(await service.getAssignments('GUSER', 'corporation'))).toEqual(['paused_state_banner']);
      expect(Object.keys(await service.getAssignments(ADMIN, 'admin')).sort()).toEqual([
        'pause_confirmation_step',
        'pause_default_window',
        'paused_state_banner',
      ]);
    });

    it('refuses exposure to an experiment outside the audience', async () => {
      await expect(service.recordExposure('pause_confirmation_step', 'GUSER', 'corporation')).rejects.toThrow(BadRequestException);
    });
  });

  describe('tracking', () => {
    beforeEach(async () => {
      await service.updateState('pause_confirmation_step', { status: 'running', rolloutPercent: 100 }, ADMIN);
    });

    it('records one exposure per subject with the assigned variant', async () => {
      const a = await service.recordExposure('pause_confirmation_step', ADMIN, 'admin');
      await service.recordExposure('pause_confirmation_step', ADMIN, 'admin');

      expect(a.enrolled).toBe(true);
      expect(prisma.exposures).toEqual([
        { experimentKey: 'pause_confirmation_step', variant: a.variant, subjectHash: hashSubject(ADMIN) },
      ]);
    });

    it('does not record exposures for non-enrolled subjects', async () => {
      await service.updateState('pause_confirmation_step', { rolloutPercent: 0 }, ADMIN);
      const a = await service.recordExposure('pause_confirmation_step', ADMIN, 'admin');
      expect(a.enrolled).toBe(false);
      expect(prisma.exposures).toHaveLength(0);
    });

    it('ignores metrics from subjects that were never exposed', async () => {
      expect(await service.recordMetric('pause_confirmation_step', ADMIN, 'accidental_pause')).toEqual({ recorded: false });
    });

    it('attributes metrics to the exposed variant', async () => {
      const a = await service.recordExposure('pause_confirmation_step', ADMIN, 'admin');
      await service.recordMetric('pause_confirmation_step', ADMIN, 'time_to_pause_seconds', 12.5);
      expect(prisma.events[0]).toMatchObject({ variant: a.variant, metric: 'time_to_pause_seconds', value: 12.5 });
    });

    it('validates metric names and continuous values', async () => {
      await expect(service.recordMetric('pause_confirmation_step', ADMIN, 'bogus')).rejects.toThrow(/Unknown metric/);
      await expect(service.recordMetric('pause_confirmation_step', ADMIN, 'time_to_pause_seconds')).rejects.toThrow(/numeric value/);
      await expect(service.recordMetric('pause_confirmation_step', ADMIN, 'time_to_pause_seconds', -1)).rejects.toThrow(/numeric value/);
    });
  });

  describe('getResults', () => {
    it('aggregates exposures and per-subject metrics into results', async () => {
      await service.updateState('paused_state_banner', { status: 'running', rolloutPercent: 100 }, ADMIN);
      const def = findExperiment('paused_state_banner')!;
      const state = await service.getState('paused_state_banner');

      for (let i = 0; i < 40; i++) {
        const subject = `GUSER${i}`;
        await service.recordExposure('paused_state_banner', subject, 'corporation');
        const variant = assign(def, state, subject).variant;
        // Two events for the same subject still count as one conversion.
        if (variant === 'control' && i % 2 === 0) {
          await service.recordMetric('paused_state_banner', subject, 'support_contact');
          await service.recordMetric('paused_state_banner', subject, 'support_contact');
        }
      }

      const r = await service.getResults('paused_state_banner');
      const control = r.exposures.find((e) => e.variant === 'control')!.subjects;
      const treated = r.exposures.find((e) => e.variant === 'eta_countdown')!.subjects;
      const primary = r.metrics.find((m) => m.metric === 'support_contact')!;

      expect(control + treated).toBe(40);
      expect(primary.variants[1].value).toBe(0);
      expect(primary.variants[0].value).toBeGreaterThan(0);
      expect(primary.variants[0].value).toBeLessThanOrEqual(1);
      // 500 per variant are required for this experiment.
      expect(r.decision).toBe('insufficient_data');
    });
  });
});
