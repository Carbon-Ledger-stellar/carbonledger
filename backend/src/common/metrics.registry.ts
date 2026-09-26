/**
 * Lightweight in-process Prometheus-compatible metrics registry.
 *
 * Exposes two metric families:
 *   contract_calls_total{contract, status}   — Soroban call counters
 *   db_pool_*                                — Prisma connection-pool gauges (#673)
 *
 * The /metrics endpoint (registered in main.ts) renders these in the standard
 * Prometheus text format so Grafana can scrape them without prom-client.
 */

export type ContractLabel = 'primary' | 'canary';
export type StatusLabel   = 'success' | 'error';

/**
 * Singleton registry — one instance per process.
 */
class ContractCallsRegistry {
  private readonly counters = new Map<string, number>();

  private key(contract: ContractLabel, status: StatusLabel): string {
    return `${contract}:${status}`;
  }

  /** Increment the counter for a specific label combination. */
  increment(contract: ContractLabel, status: StatusLabel): void {
    const k = this.key(contract, status);
    this.counters.set(k, (this.counters.get(k) ?? 0) + 1);
  }

  /** Read the current value without modifying it. */
  get(contract: ContractLabel, status: StatusLabel): number {
    return this.counters.get(this.key(contract, status)) ?? 0;
  }

  /**
   * Render the registry as a Prometheus text-format string.
   *
   * Example output:
   *   # HELP contract_calls_total Total number of Soroban contract calls
   *   # TYPE contract_calls_total counter
   *   contract_calls_total{contract="primary",status="success"} 142
   */
  toPrometheusText(): string {
    const lines: string[] = [
      '# HELP contract_calls_total Total number of Soroban contract calls by routing target and outcome',
      '# TYPE contract_calls_total counter',
    ];

    const contracts: ContractLabel[] = ['primary', 'canary'];
    const statuses:  StatusLabel[]   = ['success', 'error'];

    for (const contract of contracts) {
      for (const status of statuses) {
        const value = this.get(contract, status);
        lines.push(`contract_calls_total{contract="${contract}",status="${status}"} ${value}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /** Reset all counters (used in tests). */
  reset(): void {
    this.counters.clear();
  }
}

export const contractCallsRegistry = new ContractCallsRegistry();

// ── #673 / #1072: Database connection-pool metrics ───────────────────────────

export interface PoolMetricsSnapshot {
  // Existing fields (backward compatible — do not remove or rename)
  pool_max:            number;
  pool_timeout_ms:     number;
  connect_timeout_s:   number;
  active_queries:      number;
  total_queries:       number;
  pool_timeout_errors: number;
  // New fields added in Issue #1072
  idle_connections:    number;  // Estimate: pool_max - active_queries
  avg_wait_ms:         number;  // Rolling avg wait time over last 100 queries (ms)
  idle_timeout_ms:     number;  // DB_POOL_IDLE_TIMEOUT_MS (default 900000 = 15 min)
  pool_size_limit:     number;  // Hard cap on pool_max (always 20)
}

/**
 * Gauge-based registry for Prisma connection-pool observability.
 *
 * PrismaService calls `poolMetricsRegistry.update()` on every query so the
 * /metrics endpoint always reflects the current live state.
 *
 * Exposed metrics (#673 originals):
 *   db_pool_max                    — configured pool size (gauge)
 *   db_pool_active_queries         — in-flight queries right now (gauge)
 *   db_pool_total_queries_total    — cumulative queries since start (counter)
 *   db_pool_timeout_errors_total   — cumulative P2024 pool-exhaustion errors (counter)
 *   db_pool_utilization            — active / max ratio 0-1 (gauge)
 *
 * New metrics added in Issue #1072:
 *   db_pool_idle_connections  — estimated idle connections (gauge)
 *   db_pool_avg_wait_ms       — rolling avg query wait time ms (gauge)
 *   db_pool_idle_timeout_ms   — configured idle timeout ms (gauge)
 *   db_pool_size_limit        — hard cap for pool_max (gauge)
 */
class PoolMetricsRegistry {
  private snapshot: PoolMetricsSnapshot = {
    pool_max:            10,
    pool_timeout_ms:     10_000,
    connect_timeout_s:   10,
    active_queries:      0,
    total_queries:       0,
    pool_timeout_errors: 0,
    idle_connections:    10,
    avg_wait_ms:         0,
    idle_timeout_ms:     900_000,
    pool_size_limit:     20,
  };

  update(s: PoolMetricsSnapshot): void {
    this.snapshot = s;
  }

  toPrometheusText(): string {
    const s = this.snapshot;
    const utilization = s.pool_max > 0 ? s.active_queries / s.pool_max : 0;

    return [
      '# HELP db_pool_max Configured maximum connections in the Prisma pool',
      '# TYPE db_pool_max gauge',
      `db_pool_max ${s.pool_max}`,

      '# HELP db_pool_timeout_ms Milliseconds before pool exhaustion throws P2024',
      '# TYPE db_pool_timeout_ms gauge',
      `db_pool_timeout_ms ${s.pool_timeout_ms}`,

      '# HELP db_pool_connect_timeout_s Seconds before a new TCP connection is abandoned',
      '# TYPE db_pool_connect_timeout_s gauge',
      `db_pool_connect_timeout_s ${s.connect_timeout_s}`,

      '# HELP db_pool_active_queries Current number of in-flight database queries',
      '# TYPE db_pool_active_queries gauge',
      `db_pool_active_queries ${s.active_queries}`,

      '# HELP db_pool_total_queries_total Cumulative number of database queries since process start',
      '# TYPE db_pool_total_queries_total counter',
      `db_pool_total_queries_total ${s.total_queries}`,

      '# HELP db_pool_timeout_errors_total Cumulative P2024 pool-exhaustion errors since process start',
      '# TYPE db_pool_timeout_errors_total counter',
      `db_pool_timeout_errors_total ${s.pool_timeout_errors}`,

      '# HELP db_pool_utilization Ratio of active queries to pool_max (0-1)',
      '# TYPE db_pool_utilization gauge',
      `db_pool_utilization ${utilization.toFixed(4)}`,

      // ── Issue #1072 additions ────────────────────────────────────────────────
      '# HELP db_pool_idle_connections Estimated number of idle (unused) pool connections',
      '# TYPE db_pool_idle_connections gauge',
      `db_pool_idle_connections ${s.idle_connections}`,

      '# HELP db_pool_avg_wait_ms Rolling average query wait time in milliseconds (last 100 queries)',
      '# TYPE db_pool_avg_wait_ms gauge',
      `db_pool_avg_wait_ms ${s.avg_wait_ms}`,

      '# HELP db_pool_idle_timeout_ms Configured idle connection timeout in milliseconds',
      '# TYPE db_pool_idle_timeout_ms gauge',
      `db_pool_idle_timeout_ms ${s.idle_timeout_ms}`,

      '# HELP db_pool_size_limit Hard maximum allowed value for db_pool_max',
      '# TYPE db_pool_size_limit gauge',
      `db_pool_size_limit ${s.pool_size_limit}`,
      '',
    ].join('\n');
  }
}

export const poolMetricsRegistry = new PoolMetricsRegistry();

// ── #1076: Rate-limit metrics ─────────────────────────────────────────────────

export type RateLimitTier = 'unauthenticated' | 'authenticated' | 'financial';

/**
 * Counter-based registry for rate-limiting observability.
 *
 * Tracks two metric families:
 *   rate_limit_hits_total{tier}     — total requests that passed rate limiting
 *   rate_limit_blocked_total{tier}  — total requests that were rate-limited (429)
 *
 * Incremented by RedisSlidingWindowRateLimitGuard and LoginRateLimitGuard.
 */
class RateLimitMetricsRegistry {
  private readonly hits    = new Map<string, number>();
  private readonly blocked = new Map<string, number>();

  /** Record a request that was allowed through for the given tier. */
  recordHit(tier: RateLimitTier): void {
    this.hits.set(tier, (this.hits.get(tier) ?? 0) + 1);
  }

  /** Record a request that was blocked (429) for the given tier. */
  recordBlocked(tier: RateLimitTier): void {
    this.blocked.set(tier, (this.blocked.get(tier) ?? 0) + 1);
  }

  getHits(tier: RateLimitTier): number {
    return this.hits.get(tier) ?? 0;
  }

  getBlocked(tier: RateLimitTier): number {
    return this.blocked.get(tier) ?? 0;
  }

  toPrometheusText(): string {
    const tiers: RateLimitTier[] = ['unauthenticated', 'authenticated', 'financial'];
    const lines: string[] = [
      '# HELP rate_limit_hits_total Total requests that passed rate limiting per tier',
      '# TYPE rate_limit_hits_total counter',
    ];

    for (const tier of tiers) {
      lines.push(`rate_limit_hits_total{tier="${tier}"} ${this.getHits(tier)}`);
    }

    lines.push(
      '# HELP rate_limit_blocked_total Total requests blocked by rate limiting per tier',
      '# TYPE rate_limit_blocked_total counter',
    );

    for (const tier of tiers) {
      lines.push(`rate_limit_blocked_total{tier="${tier}"} ${this.getBlocked(tier)}`);
    }

    return lines.join('\n') + '\n';
  }

  /** Reset all counters (used in tests). */
  reset(): void {
    this.hits.clear();
    this.blocked.clear();
  }
}

export const rateLimitMetricsRegistry = new RateLimitMetricsRegistry();
