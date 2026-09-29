import { ExperimentData, ExperimentState, analyze, assign } from './experiment-engine';
import { ExperimentDefinition, PAUSE_EXPERIMENTS, findExperiment } from './experiments.config';

const def = findExperiment('pause_confirmation_step')!;
const running = (rolloutPercent: number): ExperimentState => ({ status: 'running', rolloutPercent });
const subjects = Array.from({ length: 4000 }, (_, i) => `G${i.toString().padStart(55, 'A')}`);

describe('experiments config (#1326)', () => {
  it.each(PAUSE_EXPERIMENTS.map((e) => [e.key, e]))('%s is well-formed', (_key, e: ExperimentDefinition) => {
    expect(e.variants[0].key).toBe('control');
    expect(new Set(e.variants.map((v) => v.key)).size).toBe(e.variants.length);
    expect(e.metrics.filter((m) => m.primary)).toHaveLength(1);
    expect(e.variants.every((v) => v.weight > 0)).toBe(true);
  });
});

describe('assign', () => {
  it('is deterministic per subject', () => {
    const a = assign(def, running(100), subjects[0]);
    expect(assign(def, running(100), subjects[0])).toEqual(a);
  });

  it('serves control and does not enroll when not running', () => {
    for (const status of ['draft', 'paused'] as const) {
      const a = assign(def, { status, rolloutPercent: 100 }, subjects[0]);
      expect(a).toMatchObject({ variant: 'control', enrolled: false, config: { confirmation: 'modal' } });
    }
  });

  it('serves the winner to everyone once concluded', () => {
    const state: ExperimentState = { status: 'concluded', rolloutPercent: 100, winner: 'typed_confirmation' };
    expect(subjects.slice(0, 50).every((s) => assign(def, state, s).variant === 'typed_confirmation')).toBe(true);
    expect(assign(def, state, subjects[0]).enrolled).toBe(false);
  });

  it('enrolls roughly the rollout percentage', () => {
    const enrolled = subjects.filter((s) => assign(def, running(25), s).enrolled).length;
    expect(enrolled / subjects.length).toBeGreaterThan(0.22);
    expect(enrolled / subjects.length).toBeLessThan(0.28);
  });

  it('splits enrolled subjects by weight', () => {
    const treated = subjects.filter((s) => assign(def, running(100), s).variant === 'typed_confirmation').length;
    expect(treated / subjects.length).toBeGreaterThan(0.46);
    expect(treated / subjects.length).toBeLessThan(0.54);
  });

  it('never moves an enrolled subject to another variant when rollout grows', () => {
    for (const s of subjects.slice(0, 1000)) {
      const at10 = assign(def, running(10), s);
      if (!at10.enrolled) continue;
      const at50 = assign(def, running(50), s);
      expect(at50.enrolled).toBe(true);
      expect(at50.variant).toBe(at10.variant);
    }
  });
});

describe('analyze', () => {
  const state = running(100);
  const data = (overrides: Partial<ExperimentData> = {}): ExperimentData => ({
    exposures: { control: 1000, typed_confirmation: 1000 },
    converted: { accidental_pause: { control: 100, typed_confirmation: 100 } },
    values: {
      time_to_pause_seconds: {
        control: Array.from({ length: 50 }, (_, i) => 20 + (i % 5)),
        typed_confirmation: Array.from({ length: 50 }, (_, i) => 20 + (i % 5)),
      },
    },
    ...overrides,
  });

  it('continues when nothing is significant', () => {
    const r = analyze(def, state, data());
    expect(r.decision).toBe('continue');
    expect(r.winner).toBeNull();
    expect(r.srm.detected).toBe(false);
    expect(r.metrics[0].variants.map((v) => v.variant)).toEqual(['control', 'typed_confirmation']);
  });

  it('ships a variant that significantly improves the primary metric', () => {
    const r = analyze(def, state, data({ converted: { accidental_pause: { control: 100, typed_confirmation: 60 } } }));
    expect(r.decision).toBe('ship');
    expect(r.winner).toBe('typed_confirmation');
    const treated = r.metrics[0].variants[1];
    expect(treated).toMatchObject({ significant: true, better: true, worse: false });
  });

  it('does not ship a significant change in the wrong direction', () => {
    const r = analyze(def, state, data({ converted: { accidental_pause: { control: 60, typed_confirmation: 100 } } }));
    expect(r.decision).toBe('continue');
    expect(r.metrics[0].variants[1]).toMatchObject({ significant: true, better: false, worse: true });
  });

  it('rolls back when a guardrail regresses, even with a primary win', () => {
    const r = analyze(
      def,
      state,
      data({
        converted: { accidental_pause: { control: 100, typed_confirmation: 60 } },
        values: {
          time_to_pause_seconds: {
            control: Array.from({ length: 50 }, (_, i) => 20 + (i % 5)),
            typed_confirmation: Array.from({ length: 50 }, (_, i) => 40 + (i % 5)),
          },
        },
      }),
    );
    expect(r.decision).toBe('rollback');
    expect(r.reasons[0]).toMatch(/guardrail time_to_pause_seconds/);
  });

  it('rolls back on sample ratio mismatch', () => {
    const r = analyze(def, state, data({ exposures: { control: 1500, typed_confirmation: 1000 } }));
    expect(r.srm.detected).toBe(true);
    expect(r.decision).toBe('rollback');
  });

  it('waits for the minimum sample', () => {
    const r = analyze(def, state, data({ exposures: { control: 10, typed_confirmation: 12 } }));
    expect(r.decision).toBe('insufficient_data');
  });

  it('reports exposures with expected shares', () => {
    expect(analyze(def, state, data()).exposures).toEqual([
      { variant: 'control', subjects: 1000, expectedShare: 0.5 },
      { variant: 'typed_confirmation', subjects: 1000, expectedShare: 0.5 },
    ]);
  });
});
