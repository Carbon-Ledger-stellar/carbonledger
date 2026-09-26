#!/usr/bin/env node
/**
 * Experiment rollout automation (#1326).
 *
 * Reads an experiment's results from the backend and moves it one step:
 *
 *   decision (from GET /admin/experiments/:key/results)
 *   ├─ rollback           → status=paused, rollout=0%   (guardrail regression / SRM)
 *   ├─ insufficient_data  → hold at current stage
 *   ├─ continue           → advance to next stage, or hold at 100%
 *   └─ ship               → advance to next stage, or conclude with the winner at 100%
 *
 * Stages ramp enrollment: 10% → 25% → 50% → 100% by default. A draft
 * experiment is started at the first stage.
 *
 * Usage:
 *   ADMIN_JWT=... node scripts/experiment-rollout.js --experiment pause_confirmation_step \
 *     [--api http://localhost:3001] [--stages 10,25,50,100] [--apply]
 *
 * Without --apply the script only prints the plan (dry run).
 */

const DEFAULT_STAGES = [10, 25, 50, 100];

function parseStages(value) {
  if (!value) return [...DEFAULT_STAGES];
  const stages = String(value)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (stages.length === 0) throw new Error('No valid stages were provided.');
  const invalid = stages.filter((s) => s <= 0 || s > 100);
  if (invalid.length) throw new Error(`Stages must be in (0, 100]: ${invalid.join(', ')}`);
  for (let i = 1; i < stages.length; i++) {
    if (stages[i] <= stages[i - 1]) throw new Error('Stages must be strictly increasing.');
  }
  if (stages[stages.length - 1] !== 100) throw new Error('The last stage must be 100.');
  return stages;
}

function nextStage(current, stages) {
  return stages.find((s) => s > current) ?? null;
}

/**
 * Decide the next rollout step. Pure: takes the results payload from the
 * backend and returns the action plus the PATCH body to apply (null = hold).
 */
function planRollout(results, stages = DEFAULT_STAGES) {
  const { state, decision, winner, reasons = [] } = results;
  const current = Number(state.rolloutPercent ?? 0);
  const why = reasons.join('; ');

  if (state.status === 'concluded') {
    return { action: 'none', patch: null, reason: `Already concluded with winner ${state.winner}.` };
  }
  if (state.status === 'paused') {
    return { action: 'none', patch: null, reason: 'Experiment is paused; resume it manually after investigating.' };
  }
  if (state.status === 'draft') {
    return {
      action: 'start',
      patch: { status: 'running', rolloutPercent: stages[0] },
      reason: `Starting at ${stages[0]}%.`,
    };
  }

  switch (decision) {
    case 'rollback':
      return { action: 'rollback', patch: { status: 'paused', rolloutPercent: 0 }, reason: why };
    case 'insufficient_data':
      return { action: 'hold', patch: null, reason: why || 'Waiting for more data.' };
    case 'continue':
    case 'ship': {
      const next = nextStage(current, stages);
      if (next !== null) {
        return { action: 'advance', patch: { rolloutPercent: next }, reason: `${current}% → ${next}%. ${why}`.trim() };
      }
      if (decision === 'ship' && winner) {
        return { action: 'conclude', patch: { status: 'concluded', winner }, reason: why };
      }
      return { action: 'hold', patch: null, reason: `At 100% with no significant winner yet. ${why}`.trim() };
    }
    default:
      throw new Error(`Unknown decision "${decision}"`);
  }
}

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--experiment') args.experiment = argv[++i];
    else if (a === '--api') args.api = argv[++i];
    else if (a === '--stages') args.stages = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch) {
  const args = parseArgs(argv);
  if (!args.experiment) throw new Error('--experiment is required');
  const token = env.ADMIN_JWT;
  if (!token) throw new Error('ADMIN_JWT must be set');
  const api = (args.api || env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const stages = parseStages(args.stages || env.EXPERIMENT_STAGES);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = `${api}/admin/experiments/${encodeURIComponent(args.experiment)}`;

  const res = await fetchImpl(`${url}/results`, { headers });
  if (!res.ok) throw new Error(`GET results failed: ${res.status} ${await res.text()}`);
  const results = await res.json();
  const plan = planRollout(results, stages);

  console.log(JSON.stringify({ experiment: args.experiment, decision: results.decision, ...plan, applied: false }));
  if (!plan.patch || !args.apply) return plan;

  const patch = await fetchImpl(url, { method: 'PATCH', headers, body: JSON.stringify(plan.patch) });
  if (!patch.ok) throw new Error(`PATCH failed: ${patch.status} ${await patch.text()}`);
  console.log(JSON.stringify({ experiment: args.experiment, applied: true, state: await patch.json() }));
  return plan;
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { DEFAULT_STAGES, parseStages, planRollout, parseArgs, run };
