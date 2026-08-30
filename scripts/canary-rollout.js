#!/usr/bin/env node

const DEFAULT_STAGES = [5, 25, 50, 100];
const DEFAULT_THRESHOLD = 4; // percent
const DEFAULT_MAX_DURATION_SECONDS = 1800; // 30 minutes

function parseCanaryStages(value) {
  if (!value) return [...DEFAULT_STAGES];

  const parsed = String(value)
    .split(',')
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n));

  if (parsed.length === 0) {
    throw new Error('No valid canary percentages were provided.');
  }

  return parsed;
}

function validateCanaryStages(value) {
  const stages = parseCanaryStages(value);
  const unsupported = stages.filter((stage) => !DEFAULT_STAGES.includes(stage));

  if (unsupported.length > 0) {
    return {
      valid: false,
      reason: `Unsupported canary percentage(s): ${unsupported.join(', ')}. Allowed values: ${DEFAULT_STAGES.join(', ')}`,
      stages,
    };
  }

  return { valid: true, stages };
}

function shouldRollback(metrics, config = {}) {
  const thresholdPercent = Number(config.thresholdPercent ?? DEFAULT_THRESHOLD);
  const maxDurationSeconds = Number(config.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS);

  const errorRate = Number(metrics.errorRate ?? 0);
  const healthy = metrics.healthy !== false;
  const durationSeconds = Number(metrics.durationSeconds ?? 0);

  if (!healthy) {
    return {
      shouldRollback: true,
      reason: 'Service health check failed during canary rollout.',
    };
  }

  if (durationSeconds > maxDurationSeconds) {
    return {
      shouldRollback: true,
      reason: `Canary rollout exceeded the maximum allowed rollout duration of ${maxDurationSeconds} seconds.`,
    };
  }

  if (errorRate > thresholdPercent) {
    return {
      shouldRollback: true,
      reason: `Error rate ${errorRate}% exceeded the rollback threshold of ${thresholdPercent}%.`,
    };
  }

  return {
    shouldRollback: false,
    reason: 'No rollback triggered',
  };
}

function statusForStage(stage, thresholdPercent = DEFAULT_THRESHOLD, maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS) {
  return {
    stage,
    label: `${stage}%`,
    thresholdPercent,
    maxDurationSeconds,
    shouldPause: false,
  };
}

function runRolloutSequence({
  stages = DEFAULT_STAGES,
  thresholdPercent = DEFAULT_THRESHOLD,
  maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS,
  metricsProvider,
} = {}) {
  if (!metricsProvider || typeof metricsProvider !== 'function') {
    throw new Error('metricsProvider must be a function that returns rollout metrics.');
  }

  const stageResults = [];
  for (const stage of stages) {
    const metrics = metricsProvider(stage);
    const decision = shouldRollback(metrics, { thresholdPercent, maxDurationSeconds });
    stageResults.push({
      stage,
      metrics,
      decision,
      status: statusForStage(stage, thresholdPercent, maxDurationSeconds),
    });

    if (decision.shouldRollback) {
      return { ok: false, currentStage: stage, stageResults };
    }

    if (stage !== stages[stages.length - 1]) {
      const nextStage = stages[stages.indexOf(stage) + 1];
      stageResults[stageResults.length - 1].nextStage = nextStage;
    }
  }

  return { ok: true, currentStage: stages[stages.length - 1], stageResults };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const value = args[0] || process.env.CANARY_STAGES || DEFAULT_STAGES.join(',');
  const validation = validateCanaryStages(value);

  if (!validation.valid) {
    console.error(validation.reason);
    process.exit(1);
  }

  const threshold = Number(process.env.CANARY_ERROR_THRESHOLD ?? DEFAULT_THRESHOLD);
  const maxDuration = Number(process.env.CANARY_MAX_DURATION_SECONDS ?? DEFAULT_MAX_DURATION_SECONDS);

  console.log(JSON.stringify({
    stages: validation.stages,
    threshold,
    maxDuration,
  }, null, 2));
}

module.exports = {
  DEFAULT_STAGES,
  DEFAULT_THRESHOLD,
  DEFAULT_MAX_DURATION_SECONDS,
  parseCanaryStages,
  validateCanaryStages,
  shouldRollback,
  statusForStage,
  runRolloutSequence,
};
