/**
 * Pause feature experiments (#1326).
 *
 * Each experiment is a feature flag with weighted variants. The first variant
 * is always the control and is what non-enrolled subjects receive. `config`
 * is the flag payload the frontend reads to render the variation.
 *
 * Runtime state (status, rollout %, winner) lives in AdminConfig and is
 * changed through PATCH /admin/experiments/:key or
 * scripts/experiment-rollout.js — definitions here only change by deploy.
 */

export type ExperimentAudience = 'admin' | 'user';
export type MetricType = 'conversion' | 'continuous';

export interface VariantDefinition {
  key: string;
  weight: number;
  description: string;
  config: Record<string, unknown>;
}

export interface MetricDefinition {
  key: string;
  type: MetricType;
  /** Which direction counts as an improvement. */
  goal: 'increase' | 'decrease';
  /** Decides whether a variant ships. Exactly one per experiment. */
  primary?: boolean;
  /** A significant regression rolls the experiment back. */
  guardrail?: boolean;
  description: string;
}

export interface ExperimentDefinition {
  key: string;
  description: string;
  audience: ExperimentAudience;
  /** Changing the salt reshuffles every assignment — only do it for a new run. */
  salt: string;
  variants: VariantDefinition[];
  metrics: MetricDefinition[];
  /** Per-variant exposures required before results are acted on. */
  minSamplePerVariant: number;
  /** Significance level for metric comparisons. */
  alpha: number;
}

export const PAUSE_EXPERIMENTS: ExperimentDefinition[] = [
  {
    key: 'pause_confirmation_step',
    description:
      'Does making admins type the contract name before pausing reduce accidental pauses without slowing real incident response?',
    audience: 'admin',
    salt: 'pause-confirm-v1',
    variants: [
      { key: 'control', weight: 50, description: 'Single "Confirm pause" button in a modal', config: { confirmation: 'modal' } },
      { key: 'typed_confirmation', weight: 50, description: 'Admin must type the contract name to confirm', config: { confirmation: 'typed' } },
    ],
    metrics: [
      { key: 'accidental_pause', type: 'conversion', goal: 'decrease', primary: true, description: 'Pause reverted within 5 minutes' },
      { key: 'time_to_pause_seconds', type: 'continuous', goal: 'decrease', guardrail: true, description: 'Seconds from opening the pause dialog to submitting' },
    ],
    minSamplePerVariant: 30,
    alpha: 0.05,
  },
  {
    key: 'pause_default_window',
    description:
      'Does a 4-hour default pause window (instead of 24 hours) cut downtime without forcing admins to renew pauses?',
    audience: 'admin',
    salt: 'pause-window-v1',
    variants: [
      { key: 'control', weight: 50, description: '24h window pre-selected', config: { defaultWindowHours: 24 } },
      { key: 'short_window', weight: 50, description: '4h window pre-selected', config: { defaultWindowHours: 4 } },
    ],
    metrics: [
      { key: 'paused_hours', type: 'continuous', goal: 'decrease', primary: true, description: 'Hours the contract stayed paused' },
      { key: 'pause_renewed', type: 'conversion', goal: 'decrease', guardrail: true, description: 'Pause had to be renewed before the incident was resolved' },
    ],
    minSamplePerVariant: 30,
    alpha: 0.05,
  },
  {
    key: 'paused_state_banner',
    description:
      'Does showing users when trading is expected to resume reduce support contacts while the marketplace is paused?',
    audience: 'user',
    salt: 'pause-banner-v1',
    variants: [
      { key: 'control', weight: 50, description: 'Generic "temporarily unavailable" banner', config: { banner: 'generic' } },
      { key: 'eta_countdown', weight: 50, description: 'Banner with the pause reason category and a resume countdown', config: { banner: 'eta_countdown' } },
    ],
    metrics: [
      { key: 'support_contact', type: 'conversion', goal: 'decrease', primary: true, description: 'User opened a support request while paused' },
      { key: 'returned_after_unpause', type: 'conversion', goal: 'increase', guardrail: true, description: 'User completed an action within 24h of unpause' },
    ],
    minSamplePerVariant: 500,
    alpha: 0.05,
  },
];

export function findExperiment(key: string): ExperimentDefinition | undefined {
  return PAUSE_EXPERIMENTS.find((e) => e.key === key);
}
