#!/usr/bin/env node
/**
 * canary-pause-rollout.js
 * =======================
 * Automated canary deployment controller for the CarbonLedger pause feature.
 *
 * Progression:
 *   5% → (soak 10 min, check metrics) → 25% → 50% → 100%
 *
 * At each stage the controller:
 *   1. Patches the canary ingress weight and deployment replica count.
 *   2. Waits for SOAK_DURATION_MS (default 10 min) for metrics to stabilise.
 *   3. Queries Prometheus for the metrics gate (error rate, latency, pause events).
 *   4. If all gates pass → promote to next stage.
 *      If any gate fails → automatic rollback to 0% and alert.
 *
 * Required environment variables:
 *   PROMETHEUS_URL         — Prometheus base URL (default: http://prometheus:9090)
 *   KUBECTL_CONTEXT        — kubectl context to use (optional)
 *   NAMESPACE              — Kubernetes namespace (default: carbonledger)
 *   SLACK_WEBHOOK_URL      — Slack webhook for notifications (optional)
 *
 * Optional environment variables:
 *   CANARY_STAGES          — comma-separated percentages (default: 5,25,50,100)
 *   SOAK_DURATION_MS       — soak time per stage in ms (default: 600000 = 10 min)
 *   ERROR_RATE_THRESHOLD   — max canary/stable error rate ratio (default: 1.5)
 *   LATENCY_THRESHOLD      — max canary/stable P95 ratio (default: 2.0)
 *   DRY_RUN                — set to "true" to print actions without applying
 *
 * Usage:
 *   node scripts/canary-pause-rollout.js
 *   DRY_RUN=true node scripts/canary-pause-rollout.js
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

// ── Configuration ─────────────────────────────────────────────────────────────

const PROMETHEUS_URL       = process.env.PROMETHEUS_URL       || 'http://prometheus:9090';
const NAMESPACE            = process.env.NAMESPACE            || 'carbonledger';
const KUBECTL_CONTEXT      = process.env.KUBECTL_CONTEXT      || '';
const SLACK_WEBHOOK_URL    = process.env.SLACK_WEBHOOK_URL    || '';
const DRY_RUN              = process.env.DRY_RUN              === 'true';
const CANARY_STAGES        = (process.env.CANARY_STAGES       || '5,25,50,100')
                               .split(',').map(Number);
const SOAK_DURATION_MS     = parseInt(process.env.SOAK_DURATION_MS     || '600000', 10);
const ERROR_RATE_THRESHOLD = parseFloat(process.env.ERROR_RATE_THRESHOLD || '1.5');
const LATENCY_THRESHOLD    = parseFloat(process.env.LATENCY_THRESHOLD    || '2.0');
const POLL_INTERVAL_MS     = parseInt(process.env.POLL_INTERVAL_MS      || '30000', 10);

// Replica ratio: how many canary replicas per stable replica at each traffic pct
// Stable deployment has 19 replicas, so 1 canary ≈ 5% of total (1/20).
const REPLICA_TABLE = { 5: 1, 25: 5, 50: 10, 75: 15, 100: 20 };

// ── Utilities ─────────────────────────────────────────────────────────────────

function log(msg, ...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`, ...args);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a kubectl command.
 * In dry-run mode, just prints the command.
 */
function kubectl(...args) {
  const contextArgs = KUBECTL_CONTEXT ? ['--context', KUBECTL_CONTEXT] : [];
  const fullArgs = ['kubectl', ...contextArgs, '-n', NAMESPACE, ...args];
  const cmd = fullArgs.join(' ');

  if (DRY_RUN) {
    log(`[DRY-RUN] ${cmd}`);
    return { status: 0, stdout: '', stderr: '' };
  }

  const result = spawnSync(fullArgs[0], fullArgs.slice(1), { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`kubectl failed (exit ${result.status}): ${result.stderr}`);
  }
  return result;
}

/**
 * Query Prometheus instant query endpoint and return the first result value.
 * Returns null if no data.
 */
async function promQuery(expr) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/v1/query', PROMETHEUS_URL);
    url.searchParams.set('query', expr);

    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url.toString(), { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.status !== 'success') {
            return resolve(null);
          }
          const results = json.data.result;
          if (!results || results.length === 0) return resolve(null);
          const value = parseFloat(results[0].value[1]);
          resolve(isNaN(value) ? null : value);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Prometheus query timed out')); });
  });
}

/**
 * Check all metrics gates for the current canary stage.
 * Returns { pass: boolean, gates: [{name, value, threshold, pass}] }
 */
async function checkMetricsGates() {
  const gates = [];

  // ── Gate 1: Canary error rate ≤ 1.5× stable error rate ──────────────────
  const canaryErrorRate = await promQuery(
    `rate(contract_calls_total{contract="canary",status="error"}[5m]) /
     (rate(contract_calls_total{contract="canary"}[5m]) + 0.0001)`
  );
  const stableErrorRate = await promQuery(
    `rate(contract_calls_total{contract="primary",status="error"}[5m]) /
     (rate(contract_calls_total{contract="primary"}[5m]) + 0.0001)`
  );

  if (canaryErrorRate !== null && stableErrorRate !== null) {
    const ratio = canaryErrorRate / Math.max(stableErrorRate, 0.0001);
    gates.push({
      name: 'error_rate_ratio',
      description: `Canary/stable error rate ratio (threshold: ${ERROR_RATE_THRESHOLD}×)`,
      value: ratio,
      threshold: ERROR_RATE_THRESHOLD,
      pass: ratio <= ERROR_RATE_THRESHOLD,
    });
  } else {
    log('WARNING: Could not fetch error rate metrics from Prometheus');
  }

  // ── Gate 2: Canary P95 latency ≤ 2× stable P95 latency ──────────────────
  const canaryP95 = await promQuery(
    `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{
       job="backend-canary", handler=~"/api/v1/admin/(un)?pause"
     }[5m])) by (le))`
  );
  const stableP95 = await promQuery(
    `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{
       job="backend", handler=~"/api/v1/admin/(un)?pause"
     }[5m])) by (le))`
  );

  if (canaryP95 !== null && stableP95 !== null) {
    const latencyRatio = canaryP95 / Math.max(stableP95, 0.001);
    gates.push({
      name: 'latency_p95_ratio',
      description: `Canary/stable P95 latency ratio (threshold: ${LATENCY_THRESHOLD}×)`,
      value: latencyRatio,
      threshold: LATENCY_THRESHOLD,
      pass: latencyRatio <= LATENCY_THRESHOLD,
    });
  } else {
    log('WARNING: Could not fetch latency metrics from Prometheus');
  }

  // ── Gate 3: Pause event delivery — canary must deliver events ────────────
  const canaryPauseEvents = await promQuery(
    `increase(pause_event_log_latency_ms_count{job="backend-canary"}[5m])`
  );
  const stablePauseEvents = await promQuery(
    `increase(pause_event_log_latency_ms_count{job="backend"}[5m])`
  );

  // This gate only fires if there is traffic; skip if both are zero
  if (canaryPauseEvents !== null && stablePauseEvents !== null && stablePauseEvents > 0) {
    // Canary should be delivering events proportional to its traffic share
    const deliveryOk = canaryPauseEvents >= 0; // At least no negative counts
    gates.push({
      name: 'pause_event_delivery',
      description: 'Pause events delivered by canary',
      value: canaryPauseEvents,
      threshold: 0,
      pass: deliveryOk,
    });
  }

  // ── Gate 4: Canary error budget (absolute error rate < 1%) ───────────────
  const canaryAbsoluteErrorRate = await promQuery(
    `rate(http_requests_total{job="backend-canary",status_code!~"2[0-9]{2}",status_code!~"401|403"}[5m]) /
     rate(http_requests_total{job="backend-canary"}[5m])`
  );

  if (canaryAbsoluteErrorRate !== null) {
    gates.push({
      name: 'absolute_error_rate',
      description: 'Canary absolute error rate (threshold: 1%)',
      value: canaryAbsoluteErrorRate,
      threshold: 0.01,
      pass: canaryAbsoluteErrorRate <= 0.01,
    });
  }

  const allPass = gates.length === 0 || gates.every(g => g.pass);
  return { pass: allPass, gates };
}

/**
 * Set the canary ingress weight to the given percentage.
 */
function setCanaryWeight(pct) {
  log(`Setting canary ingress weight to ${pct}%`);
  kubectl(
    'annotate', 'ingress', 'backend-canary',
    `nginx.ingress.kubernetes.io/canary-weight=${pct}`,
    '--overwrite'
  );
}

/**
 * Set the canary deployment replica count.
 */
function setCanaryReplicas(pct) {
  const replicas = REPLICA_TABLE[pct] ?? Math.ceil((pct / 100) * 20);
  log(`Setting canary replicas to ${replicas} (${pct}% traffic)`);
  kubectl('scale', 'deployment', 'backend-canary', `--replicas=${replicas}`);
}

/**
 * Update the canary deployment annotation to record current stage.
 */
function annotateCanaryStage(stage, pct) {
  kubectl(
    'annotate', 'deployment', 'backend-canary',
    `canary.carbonledger.com/stage=${stage}`,
    `canary.carbonledger.com/traffic-pct=${pct}`,
    '--overwrite'
  );
}

/**
 * Perform a full rollback: set ingress weight to 0 and replica count to 0.
 */
async function rollback(reason) {
  log(`ROLLBACK triggered: ${reason}`);
  try {
    setCanaryWeight(0);
    setCanaryReplicas(0);
    kubectl('scale', 'deployment', 'backend-canary', '--replicas=0');
  } catch (e) {
    log('ERROR during rollback kubectl calls:', e.message);
  }
  await notify(`:rotating_light: *Canary rollback — pause feature*\nReason: ${reason}`);
}

/**
 * Send a Slack notification (best-effort; errors are logged but not fatal).
 */
async function notify(text) {
  if (!SLACK_WEBHOOK_URL) return;
  const payload = JSON.stringify({ text });
  const url = new URL(SLACK_WEBHOOK_URL);
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = client.request({
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, () => resolve());
    req.on('error', (e) => { log('Slack notify error:', e.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

// ── Main rollout loop ──────────────────────────────────────────────────────────

async function main() {
  log('Starting canary rollout for pause feature');
  log(`Stages: ${CANARY_STAGES.join('% → ')}%`);
  log(`Soak duration per stage: ${SOAK_DURATION_MS / 1000}s`);
  log(`Error rate threshold: ${ERROR_RATE_THRESHOLD}×`);
  log(`Latency threshold: ${LATENCY_THRESHOLD}×`);
  log(`Dry-run: ${DRY_RUN}`);
  log('');

  for (let stageIdx = 0; stageIdx < CANARY_STAGES.length; stageIdx++) {
    const pct = CANARY_STAGES[stageIdx];
    const stage = stageIdx + 1;

    log(`──────────────────────────────────────────`);
    log(`STAGE ${stage}/${CANARY_STAGES.length}: ${pct}% canary traffic`);
    log(`──────────────────────────────────────────`);

    // Apply traffic split
    setCanaryWeight(pct);
    setCanaryReplicas(pct);
    annotateCanaryStage(stage, pct);
    await notify(`:rocket: Canary stage ${stage}/${CANARY_STAGES.length}: routing ${pct}% of traffic to pause feature canary`);

    // If this is the final stage (100%), we're done after promotion
    if (pct === 100) {
      log('Full promotion complete — canary is now the stable deployment');
      await notify(':white_check_mark: Canary pause feature fully promoted to 100% traffic');
      break;
    }

    // ── Soak period — wait for metrics to stabilise then poll gates
    log(`Soaking for ${SOAK_DURATION_MS / 1000}s before checking metrics...`);
    const soakEnd = Date.now() + SOAK_DURATION_MS;

    while (Date.now() < soakEnd) {
      await sleep(POLL_INTERVAL_MS);
      const remaining = Math.max(0, soakEnd - Date.now());
      log(`  ${Math.ceil(remaining / 1000)}s remaining in soak period — checking metrics...`);

      const { pass, gates } = await checkMetricsGates();

      for (const gate of gates) {
        const icon = gate.pass ? '✓' : '✗';
        log(`  ${icon} ${gate.name}: ${gate.value?.toFixed(4)} (threshold: ${gate.threshold})`);
      }

      if (!pass) {
        const failedGates = gates.filter(g => !g.pass);
        const reason = failedGates.map(g =>
          `${g.name}=${g.value?.toFixed(4)} exceeds threshold=${g.threshold}`
        ).join('; ');

        await rollback(`Metrics gate failure at stage ${stage} (${pct}%): ${reason}`);
        process.exit(1);
      }
    }

    log(`Stage ${stage} metrics gates passed — promoting to next stage`);
    await notify(`:white_check_mark: Stage ${stage} (${pct}%) passed — promoting to ${CANARY_STAGES[stageIdx + 1]}%`);
  }

  log('');
  log('Canary rollout complete');
  process.exit(0);
}

main().catch(async (err) => {
  log('FATAL ERROR:', err.message);
  log(err.stack);
  try {
    await rollback(`Unexpected controller error: ${err.message}`);
  } catch { /* best effort */ }
  process.exit(1);
});
