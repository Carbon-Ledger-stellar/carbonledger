import { createHash } from 'crypto';
import { ExperimentDefinition, MetricDefinition } from './experiments.config';
import {
  TestResult,
  describe,
  sampleRatioMismatch,
  twoProportionZTest,
  welchTTest,
} from './experiment-stats';

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'concluded';

export interface ExperimentState {
  status: ExperimentStatus;
  /** Share of eligible subjects enrolled, 0–100. */
  rolloutPercent: number;
  /** Variant served to everyone once concluded. */
  winner?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_STATE: ExperimentState = { status: 'draft', rolloutPercent: 0 };

export interface Assignment {
  experiment: string;
  variant: string;
  /** True when the subject is part of the measured population. */
  enrolled: boolean;
  config: Record<string, unknown>;
}

const BUCKETS = 10_000;

/** Deterministic bucket in [0, 10000) for a subject. */
export function bucketFor(purpose: string, def: ExperimentDefinition, subject: string): number {
  const digest = createHash('sha256').update(`${purpose}:${def.key}:${def.salt}:${subject}`).digest('hex');
  return parseInt(digest.slice(0, 8), 16) % BUCKETS;
}

/**
 * Assign a subject to a variant.
 *
 * Enrollment and variant choice use independent hashes, so raising the
 * rollout percentage only adds subjects — nobody already enrolled switches
 * variant.
 */
export function assign(def: ExperimentDefinition, state: ExperimentState, subject: string): Assignment {
  const control = def.variants[0];
  const serve = (variantKey: string, enrolled: boolean): Assignment => {
    const v = def.variants.find((x) => x.key === variantKey) ?? control;
    return { experiment: def.key, variant: v.key, enrolled, config: v.config };
  };

  if (state.status === 'concluded') return serve(state.winner ?? control.key, false);
  if (state.status !== 'running') return serve(control.key, false);
  if (bucketFor('rollout', def, subject) >= state.rolloutPercent * (BUCKETS / 100)) {
    return serve(control.key, false);
  }

  const totalWeight = def.variants.reduce((s, v) => s + v.weight, 0);
  let point = (bucketFor('variant', def, subject) / BUCKETS) * totalWeight;
  for (const v of def.variants) {
    if (point < v.weight) return serve(v.key, true);
    point -= v.weight;
  }
  return serve(def.variants[def.variants.length - 1].key, true);
}

export function hashSubject(subject: string): string {
  return createHash('sha256').update(subject).digest('hex');
}

// ── Analysis ──────────────────────────────────────────────────────────────────

/** Raw per-variant data gathered from the database. */
export interface ExperimentData {
  exposures: Record<string, number>;
  /** metric → variant → number of distinct subjects with at least one event */
  converted: Record<string, Record<string, number>>;
  /** metric → variant → per-subject summed values */
  values: Record<string, Record<string, number[]>>;
}

export interface VariantMetricResult {
  variant: string;
  sampleSize: number;
  /** Conversion rate or mean. */
  value: number;
  /** Comparison with control; null for the control row. */
  test: TestResult | null;
  significant: boolean;
  /** Significant and in the metric's goal direction. */
  better: boolean;
  /** Significant and against the metric's goal direction. */
  worse: boolean;
}

export interface MetricResult {
  metric: string;
  type: MetricDefinition['type'];
  goal: MetricDefinition['goal'];
  role: 'primary' | 'guardrail' | 'secondary';
  variants: VariantMetricResult[];
}

export type Decision = 'insufficient_data' | 'continue' | 'ship' | 'rollback';

export interface ExperimentResults {
  experiment: string;
  description: string;
  state: ExperimentState;
  exposures: Array<{ variant: string; subjects: number; expectedShare: number }>;
  srm: { chiSquare: number; pValue: number; detected: boolean };
  metrics: MetricResult[];
  decision: Decision;
  winner: string | null;
  reasons: string[];
}

/** SRM is only flagged at a very strict threshold to avoid false alarms. */
const SRM_ALPHA = 0.001;

export function analyze(def: ExperimentDefinition, state: ExperimentState, data: ExperimentData): ExperimentResults {
  const control = def.variants[0].key;
  const totalWeight = def.variants.reduce((s, v) => s + v.weight, 0);
  const exposureCounts = def.variants.map((v) => data.exposures[v.key] ?? 0);
  const srmRaw = sampleRatioMismatch(exposureCounts, def.variants.map((v) => v.weight));
  const srm = { ...srmRaw, detected: srmRaw.pValue < SRM_ALPHA };

  const metrics: MetricResult[] = def.metrics.map((m) => {
    const variants = def.variants.map((v): VariantMetricResult => {
      if (m.type === 'conversion') {
        const n = data.exposures[v.key] ?? 0;
        const conversions = data.converted[m.key]?.[v.key] ?? 0;
        return compare(m, def.alpha, v.key, v.key === control, { n, value: n ? conversions / n : 0 }, () =>
          twoProportionZTest(
            { n: data.exposures[control] ?? 0, conversions: data.converted[m.key]?.[control] ?? 0 },
            { n, conversions },
          ),
        );
      }
      const sample = describe(data.values[m.key]?.[v.key] ?? []);
      return compare(m, def.alpha, v.key, v.key === control, { n: sample.n, value: sample.mean }, () =>
        welchTTest(describe(data.values[m.key]?.[control] ?? []), sample),
      );
    });
    return {
      metric: m.key,
      type: m.type,
      goal: m.goal,
      role: m.primary ? 'primary' : m.guardrail ? 'guardrail' : 'secondary',
      variants,
    };
  });

  const { decision, winner, reasons } = decide(def, exposureCounts, srm.detected, metrics);
  return {
    experiment: def.key,
    description: def.description,
    state,
    exposures: def.variants.map((v, i) => ({
      variant: v.key,
      subjects: exposureCounts[i],
      expectedShare: v.weight / totalWeight,
    })),
    srm,
    metrics,
    decision,
    winner,
    reasons,
  };
}

function compare(
  metric: MetricDefinition,
  alpha: number,
  variant: string,
  isControl: boolean,
  observed: { n: number; value: number },
  run: () => TestResult,
): VariantMetricResult {
  if (isControl) {
    return { variant, sampleSize: observed.n, value: observed.value, test: null, significant: false, better: false, worse: false };
  }
  const test = run();
  const significant = test.pValue < alpha;
  const up = test.difference > 0;
  const better = significant && (metric.goal === 'increase' ? up : !up);
  const worse = significant && !better && test.difference !== 0;
  return { variant, sampleSize: observed.n, value: observed.value, test, significant, better, worse };
}

function decide(
  def: ExperimentDefinition,
  exposureCounts: number[],
  srmDetected: boolean,
  metrics: MetricResult[],
): { decision: Decision; winner: string | null; reasons: string[] } {
  if (srmDetected) {
    return {
      decision: 'rollback',
      winner: null,
      reasons: ['Sample ratio mismatch: exposures do not match variant weights, so assignment or logging is broken.'],
    };
  }

  const regressions = metrics
    .filter((m) => m.role === 'guardrail')
    .flatMap((m) => m.variants.filter((v) => v.worse).map((v) => `${v.variant} regressed guardrail ${m.metric}`));
  if (regressions.length) return { decision: 'rollback', winner: null, reasons: regressions };

  const short = def.variants.filter((_, i) => exposureCounts[i] < def.minSamplePerVariant).map((v) => v.key);
  if (short.length) {
    return {
      decision: 'insufficient_data',
      winner: null,
      reasons: [`Fewer than ${def.minSamplePerVariant} exposures for: ${short.join(', ')}`],
    };
  }

  const primary = metrics.find((m) => m.role === 'primary');
  const winners = (primary?.variants ?? []).filter((v) => v.better);
  if (primary && winners.length) {
    // Largest improvement in the goal direction wins.
    const sign = primary.goal === 'increase' ? 1 : -1;
    const best = winners.reduce((a, b) => (sign * b.test!.difference > sign * a.test!.difference ? b : a));
    return {
      decision: 'ship',
      winner: best.variant,
      reasons: [`${best.variant} significantly improves ${primary.metric} (p=${best.test!.pValue.toFixed(4)})`],
    };
  }

  return {
    decision: 'continue',
    winner: null,
    reasons: [primary ? `No significant change in ${primary.metric} yet` : 'No primary metric defined'],
  };
}
