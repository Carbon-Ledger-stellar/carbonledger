'use client';

/**
 * lib/experiments.ts
 * Feature flags and A/B experiment results for the pause feature (#1326).
 *
 * - useExperiment(key, fallback)  → variant + config for the signed-in user,
 *                                   records an exposure once when enrolled
 * - trackExperimentMetric(...)     → report a metric for the user's variant
 * - admin helpers                  → list / results / update for the dashboard
 */
import { useEffect, useRef, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ─── Types (mirror backend/src/experiments) ───────────────────────────────────

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'concluded';
export type Decision = 'insufficient_data' | 'continue' | 'ship' | 'rollback';

export interface Assignment {
  experiment: string;
  variant: string;
  enrolled: boolean;
  config: Record<string, unknown>;
}

export interface ExperimentState {
  status: ExperimentStatus;
  rolloutPercent: number;
  winner?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ExperimentSummary {
  key: string;
  description: string;
  audience: 'admin' | 'user';
  variants: Array<{ key: string; weight: number; description: string }>;
  metrics: Array<{ key: string; type: 'conversion' | 'continuous'; goal: 'increase' | 'decrease'; description: string }>;
  minSamplePerVariant: number;
  state: ExperimentState;
}

export interface TestResult {
  difference: number;
  relativeLift: number | null;
  statistic: number;
  pValue: number;
  ci95: [number, number];
}

export interface VariantMetricResult {
  variant: string;
  sampleSize: number;
  value: number;
  test: TestResult | null;
  significant: boolean;
  better: boolean;
  worse: boolean;
}

export interface MetricResult {
  metric: string;
  type: 'conversion' | 'continuous';
  goal: 'increase' | 'decrease';
  role: 'primary' | 'guardrail' | 'secondary';
  variants: VariantMetricResult[];
}

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

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cl_jwt') : null;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string })?.message ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const fetchFlags = () => request<Record<string, Assignment>>('/experiments/flags');

export const trackExposure = (key: string) =>
  request<Assignment>(`/experiments/${encodeURIComponent(key)}/exposure`, { method: 'POST' });

/** Fire-and-forget: experiment tracking must never break the UI. */
export function trackExperimentMetric(key: string, metric: string, value?: number): void {
  request(`/experiments/${encodeURIComponent(key)}/events`, {
    method: 'POST',
    body: JSON.stringify(value === undefined ? { metric } : { metric, value }),
  }).catch(() => {});
}

export const fetchExperiments = () => request<ExperimentSummary[]>('/admin/experiments');

export const fetchExperimentResults = (key: string) =>
  request<ExperimentResults>(`/admin/experiments/${encodeURIComponent(key)}/results`);

export const updateExperiment = (key: string, patch: Partial<Pick<ExperimentState, 'status' | 'rolloutPercent' | 'winner'>>) =>
  request<ExperimentState>(`/admin/experiments/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// ─── Hook ─────────────────────────────────────────────────────────────────────

let flagsPromise: Promise<Record<string, Assignment>> | null = null;

/** Test hook: forget cached flags. */
export function resetExperimentCache(): void {
  flagsPromise = null;
}

/**
 * Variant for `key`. Renders `fallback` (the control config) until flags load
 * or if loading fails, so a flag outage never changes behaviour.
 */
export function useExperiment<C extends Record<string, unknown>>(
  key: string,
  fallback: C,
): { variant: string; config: C; loading: boolean } {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const exposed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    flagsPromise ??= fetchFlags().catch((err) => {
      flagsPromise = null;
      throw err;
    });
    flagsPromise
      .then((flags) => {
        if (cancelled) return;
        const a = flags[key] ?? null;
        setAssignment(a);
        if (a?.enrolled && !exposed.current) {
          exposed.current = true;
          trackExposure(key).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key]);

  return {
    variant: assignment?.variant ?? 'control',
    config: { ...fallback, ...(assignment?.config ?? {}) } as C,
    loading,
  };
}

// ─── Formatting (dashboard) ───────────────────────────────────────────────────

export function formatPValue(p: number): string {
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

export function formatMetricValue(type: 'conversion' | 'continuous', value: number): string {
  return type === 'conversion' ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
}

/** Difference vs control; conversion differences are in percentage points. */
export function formatDifference(type: 'conversion' | 'continuous', test: TestResult): string {
  const sign = test.difference > 0 ? '+' : '';
  const diff = type === 'conversion' ? `${sign}${(test.difference * 100).toFixed(1)} pp` : `${sign}${test.difference.toFixed(2)}`;
  if (test.relativeLift === null) return diff;
  const lift = test.relativeLift * 100;
  return `${diff} (${lift > 0 ? '+' : ''}${lift.toFixed(1)}%)`;
}

export function formatInterval(type: 'conversion' | 'continuous', [lo, hi]: [number, number]): string {
  const f = (v: number) => (type === 'conversion' ? `${(v * 100).toFixed(1)}` : v.toFixed(2));
  return `[${f(lo)}, ${f(hi)}]${type === 'conversion' ? ' pp' : ''}`;
}

export const DECISION_LABELS: Record<Decision, string> = {
  insufficient_data: 'Collecting data',
  continue: 'No winner yet',
  ship: 'Ready to ship',
  rollback: 'Roll back',
};
