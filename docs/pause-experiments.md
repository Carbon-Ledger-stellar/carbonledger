# Pause Feature Experiments

A/B testing infrastructure for variations of the emergency pause feature
(#1326). It covers:

- feature flags with deterministic assignment
- exposure and metric tracking
- statistical analysis with a ship / continue / rollback decision
- a results dashboard
- automated staged rollout

## Experiments

Defined in `backend/src/experiments/experiments.config.ts`. The first variant
is always `control`.

| Key | Audience | Variants | Primary metric | Guardrail |
|---|---|---|---|---|
| `pause_confirmation_step` | admin | `control` (modal confirm) / `typed_confirmation` (type the contract name) | `accidental_pause`: pause reverted within 5 min (↓) | `time_to_pause_seconds` (↓) |
| `pause_default_window` | admin | `control` (24h preselected) / `short_window` (4h) | `paused_hours` (↓) | `pause_renewed` (↓) |
| `paused_state_banner` | user | `control` (generic banner) / `eta_countdown` (reason + resume countdown) | `support_contact` (↓) | `returned_after_unpause` (↑) |

Admin experiments are served only to `role=admin`. User experiments are
served to every authenticated role.

## Feature flags

```ts
import { useExperiment, trackExperimentMetric } from '@/lib/experiments';

const { config } = useExperiment('pause_confirmation_step', { confirmation: 'modal' });
// config.confirmation is 'modal' or 'typed'

trackExperimentMetric('pause_confirmation_step', 'time_to_pause_seconds', 18.4);
trackExperimentMetric('pause_confirmation_step', 'accidental_pause');
```

`useExperiment` renders the fallback (control) config until flags load, and
also if loading fails, so a flag outage never changes behaviour. It records one
exposure when the user is enrolled.

### Assignment

`bucket = sha256(purpose:key:salt:subject) mod 10000`

| Status | Served | Measured |
|---|---|---|
| `draft`, `paused` | `control` | no |
| `running`, rollout bucket < `rolloutPercent` | weighted variant (variant bucket) | yes |
| `running`, otherwise | `control` | no |
| `concluded` | `winner` | no |

Enrollment and variant choice use separate hashes. Raising the rollout only
adds new subjects; nobody already enrolled switches variant. Changing an
experiment's `salt` reshuffles everyone, so only do it when starting a new run.

## API

| Endpoint | Role | Purpose |
|---|---|---|
| `GET /experiments/flags` | any | variant + config for each eligible experiment |
| `POST /experiments/:key/exposure` | any | the user saw their variant |
| `POST /experiments/:key/events` `{ metric, value? }` | any | metric event (`value` required for continuous metrics) |
| `GET /admin/experiments` | admin | definitions + state |
| `GET /admin/experiments/:key/results` | admin | statistics and decision |
| `PATCH /admin/experiments/:key` `{ status?, rolloutPercent?, winner? }` | admin | change state |

State is stored in `AdminConfig` under `experiment:<key>`. Exposures and
metric events go in `experiment_exposures` and `experiment_metric_events`.
Subjects are stored as SHA-256 hashes of their public key. Metric events from
subjects with no exposure are ignored.

## Statistics

Implemented in `backend/src/experiments/experiment-stats.ts` with no
dependencies. The subject is the unit of analysis.

| Metric type | Per-subject value | Test |
|---|---|---|
| conversion | converted at least once | two-proportion z-test (pooled SE), 95% CI on the difference |
| continuous | sum of event values | Welch's t-test, 95% CI on the difference |

Sample ratio mismatch (SRM) is a chi-square test of exposures against the
variant weights. p < 0.001 means assignment or logging is broken.

### Decision

Checked in this order:

1. **rollback:** SRM detected, or any guardrail significantly worse than control
2. **insufficient_data:** any variant below `minSamplePerVariant`
3. **ship:** a variant significantly better on the primary metric (largest improvement wins)
4. **continue:** otherwise

To size an experiment, use `requiredSampleSize(baseline, mde)`. For example,
detecting 10% → 12% needs 3,839 subjects per variant.

## Results dashboard

`/dashboard/Admin/experiments` in the frontend shows, for each experiment:

- the decision and its reasons
- exposures vs expected share, and the SRM check
- per metric: rate or mean, difference vs control, 95% CI, p-value, and whether it is better or worse

It also has controls to run, pause, change rollout, and conclude.

## Rollout automation

`scripts/experiment-rollout.js` moves one experiment one step based on its
results:

| Current | Decision | Action |
|---|---|---|
| draft | any | start at the first stage (10%) |
| running | rollback | `status=paused`, rollout 0% |
| running | insufficient_data | hold |
| running | continue / ship | advance 10 → 25 → 50 → 100% |
| running at 100% | ship | conclude with the winner |
| running at 100% | continue | hold |
| paused / concluded | any | nothing |

```bash
ADMIN_JWT=... node scripts/experiment-rollout.js --experiment pause_default_window            # dry run
ADMIN_JWT=... node scripts/experiment-rollout.js --experiment pause_default_window --apply    # apply
```

Options: `--api` (or `API_URL`) and `--stages 10,25,50,100` (or
`EXPERIMENT_STAGES`). Tests: `node --test scripts/experiment-rollout.test.js`.

`.github/workflows/experiment-rollout.yml` runs the script for every experiment
on weekdays at 09:00 UTC, and on demand. It needs the secrets
`EXPERIMENT_API_URL` and `EXPERIMENT_ADMIN_JWT`. Scheduled runs are dry runs
unless the repository variable `EXPERIMENT_AUTO_APPLY` is `true`.
