const test = require('node:test');
const assert = require('node:assert/strict');

const { parseStages, planRollout, parseArgs, run } = require('./experiment-rollout.js');

const running = (rolloutPercent) => ({ status: 'running', rolloutPercent });

test('parseStages defaults and validates', () => {
  assert.deepEqual(parseStages(), [10, 25, 50, 100]);
  assert.deepEqual(parseStages('5, 50, 100'), [5, 50, 100]);
  assert.throws(() => parseStages('50,25,100'), /strictly increasing/);
  assert.throws(() => parseStages('10,50'), /last stage must be 100/);
  assert.throws(() => parseStages('0,100'), /\(0, 100\]/);
});

test('starts a draft experiment at the first stage', () => {
  const plan = planRollout({ state: { status: 'draft', rolloutPercent: 0 }, decision: 'insufficient_data' });
  assert.equal(plan.action, 'start');
  assert.deepEqual(plan.patch, { status: 'running', rolloutPercent: 10 });
});

test('rolls back on a rollback decision', () => {
  const plan = planRollout({ state: running(50), decision: 'rollback', reasons: ['guardrail regressed'] });
  assert.equal(plan.action, 'rollback');
  assert.deepEqual(plan.patch, { status: 'paused', rolloutPercent: 0 });
  assert.match(plan.reason, /guardrail/);
});

test('holds while data is insufficient', () => {
  const plan = planRollout({ state: running(25), decision: 'insufficient_data' });
  assert.equal(plan.action, 'hold');
  assert.equal(plan.patch, null);
});

test('advances one stage on continue or ship', () => {
  assert.deepEqual(planRollout({ state: running(10), decision: 'continue' }).patch, { rolloutPercent: 25 });
  assert.deepEqual(planRollout({ state: running(25), decision: 'ship', winner: 'b' }).patch, { rolloutPercent: 50 });
});

test('concludes with the winner only at 100%', () => {
  const plan = planRollout({ state: running(100), decision: 'ship', winner: 'typed_confirmation' });
  assert.equal(plan.action, 'conclude');
  assert.deepEqual(plan.patch, { status: 'concluded', winner: 'typed_confirmation' });
});

test('holds at 100% without a winner', () => {
  assert.equal(planRollout({ state: running(100), decision: 'continue' }).action, 'hold');
});

test('leaves paused and concluded experiments alone', () => {
  assert.equal(planRollout({ state: { status: 'paused', rolloutPercent: 0 }, decision: 'continue' }).action, 'none');
  assert.equal(
    planRollout({ state: { status: 'concluded', rolloutPercent: 100, winner: 'b' }, decision: 'ship' }).action,
    'none',
  );
});

test('parseArgs rejects unknown flags', () => {
  assert.deepEqual(parseArgs(['--experiment', 'x', '--apply']), { experiment: 'x', apply: true });
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
});

function fakeFetch(results) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (init.method === 'PATCH') return { ok: true, json: async () => JSON.parse(init.body) };
    return { ok: true, json: async () => results };
  };
  fn.calls = calls;
  return fn;
}

test('run is a dry run unless --apply is passed', async (t) => {
  t.mock.method(console, 'log', () => {});
  const fetch = fakeFetch({ state: running(10), decision: 'continue' });
  await run(['--experiment', 'pause_default_window', '--api', 'http://api/'], { ADMIN_JWT: 'jwt' }, fetch);
  assert.deepEqual(fetch.calls.map((c) => c.method), ['GET']);
  assert.equal(fetch.calls[0].url, 'http://api/admin/experiments/pause_default_window/results');
});

test('run applies the planned PATCH with --apply', async (t) => {
  t.mock.method(console, 'log', () => {});
  const fetch = fakeFetch({ state: running(10), decision: 'continue' });
  await run(['--experiment', 'pause_default_window', '--apply'], { ADMIN_JWT: 'jwt', API_URL: 'http://api' }, fetch);
  assert.equal(fetch.calls[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(fetch.calls[1].body), { rolloutPercent: 25 });
});

test('run requires a token', async () => {
  await assert.rejects(run(['--experiment', 'x'], {}, fakeFetch({})), /ADMIN_JWT/);
});
