const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCanaryStages,
  validateCanaryStages,
  shouldRollback,
  statusForStage,
} = require('./canary-rollout.js');

test('parseCanaryStages accepts comma separated percentages', () => {
  assert.deepEqual(parseCanaryStages('5,25,50,100'), [5, 25, 50, 100]);
  assert.deepEqual(parseCanaryStages('5, 25, 50, 100'), [5, 25, 50, 100]);
});

test('validateCanaryStages rejects unsupported steps', () => {
  const result = validateCanaryStages('5,10,100');
  assert.equal(result.valid, false);
  assert.match(result.reason, /Unsupported/);
});

test('shouldRollback triggers when error rate exceeds threshold', () => {
  const result = shouldRollback({
    errorRate: 3.9,
    healthy: true,
    durationSeconds: 900,
  }, { thresholdPercent: 4, maxDurationSeconds: 1800 });

  assert.equal(result.shouldRollback, false);

  const failing = shouldRollback({
    errorRate: 4.1,
    healthy: true,
    durationSeconds: 900,
  }, { thresholdPercent: 4, maxDurationSeconds: 1800 });

  assert.equal(failing.shouldRollback, true);
  assert.match(failing.reason, /error rate/i);
});

test('statusForStage returns current stage metadata', () => {
  const status = statusForStage(25, 4, 1800);
  assert.equal(status.label, '25%');
  assert.equal(status.shouldPause, false);
});
