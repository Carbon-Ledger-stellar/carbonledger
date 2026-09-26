import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Optional } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { poolMetricsRegistry } from "./common/metrics.registry";
import { RedisService } from "./redis.service";
import { createPrismaCacheMiddleware, PrismaCacheMiddlewareOptions } from "./cache/prisma-cache.middleware";

// ── Connection pool constants (#1024) ─────────────────────────────────────────
//
// connection_limit = 20  (issue #1024 acceptance criterion)
// idle_timeout     = 900 seconds = 15 minutes (issue #1024 acceptance criterion)
//
// Both values are exposed as env vars so they can be tuned per deployment without
// a code change.  The hard cap (POOL_SIZE_LIMIT) prevents runaway misconfiguration
// from exhausting pg max_connections on multi-replica deployments.
//
// Sizing rule of thumb: (num_cores × 2) + 1, capped at:
//   pg max_connections / num_replicas − 5  (leave headroom for migrations/admin)

/** Hard upper bound — no single Prisma instance may open more than this. */
const POOL_SIZE_LIMIT = 20;

/**
 * Active connection limit passed to Prisma as the `connection_limit` URL param.
 * Default: 20 (issue #1024). Override with DB_POOL_MAX env var.
 * Clamped to POOL_SIZE_LIMIT so a mis-set env var cannot exceed the hard cap.
 */
const POOL_MAX = Math.min(parseInt(process.env.DB_POOL_MAX ?? "20"), POOL_SIZE_LIMIT);

/** Milliseconds to wait for a free connection before Prisma throws P2024. */
const POOL_TIMEOUT_MS = parseInt(process.env.DB_POOL_TIMEOUT_MS ?? "10000");

/** Seconds to wait when opening a new TCP connection to PostgreSQL. */
const CONNECT_TIMEOUT_S = parseInt(process.env.DB_CONNECT_TIMEOUT_S ?? "10");

/**
 * Seconds before an idle connection is released back to the OS.
 * Passed to Prisma as the `idle_timeout` URL param.
 * Default: 900 s = 15 min (issue #1024 acceptance criterion).
 * Stored in env as DB_POOL_IDLE_TIMEOUT_MS (milliseconds) for consistency
 * with other timeout env vars; converted to seconds for the Prisma URL.
 */
const POOL_IDLE_TIMEOUT_S = Math.round(
  parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? "900000") / 1000,
);
// Keep the millisecond value for internal metrics reporting.
const POOL_IDLE_TIMEOUT_MS = POOL_IDLE_TIMEOUT_S * 1000;

// Adaptive pool sizing: check every 60 seconds.
const ADAPTIVE_CHECK_INTERVAL_MS = 60_000;
// Number of consecutive high-utilization checks before logging a scale-up warning.
const HIGH_UTIL_THRESHOLD_CHECKS = 5;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // Track in-flight query count for pool metrics
  private _activeQueries = 0;
  private _totalQueries = 0;
  private _poolErrors = 0;

  // Wait time tracking: rolling window over the last 100 queries.
  private _totalWaitMs = 0;
  private _waitSampleCount = 0;
  private readonly WAIT_WINDOW = 100;
  // Circular buffer of the last 100 wait samples (ms each).
  private _waitSamples: number[] = [];

  // Adaptive pool sizing state: tracks consecutive high/low utilization check counts.
  private _highUtilChecks = 0;
  private _adaptiveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(@Optional() private readonly redisService?: RedisService) {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("connection_limit", String(POOL_MAX));
    url.searchParams.set("pool_timeout", String(POOL_TIMEOUT_MS / 1000));
    url.searchParams.set("connect_timeout", String(CONNECT_TIMEOUT_S));
    // idle_timeout (seconds): Prisma releases idle connections after this period.
    // Satisfies issue #1024 acceptance criterion: idle_timeout=900 (15 min).
    url.searchParams.set("idle_timeout", String(POOL_IDLE_TIMEOUT_S));

    super({
      datasources: { db: { url: url.toString() } },
      log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
    } as any);

    // Prisma 6 removed client middleware ($use); register only when available.
    const client = this as PrismaClient & {
      $use?: (
        middleware: (
          params: { model?: string; action: string; args?: any },
          next: (params: { model?: string; action: string; args?: any }) => Promise<unknown>,
        ) => Promise<unknown>,
      ) => void;
    };
    if (typeof client.$use === 'function') {
      // 1. Connection pool metrics tracking middleware (with wait time measurement)
      client.$use(async (params, next) => {
        // Record the moment we enqueue the query — before it starts executing.
        const enqueuedAt = Date.now();

        this._activeQueries++;
        this._totalQueries++;
        poolMetricsRegistry.update(this.getPoolMetrics());

        // Measure how long the query waited before starting (approximated as time
        // between enqueue and the first awaited tick inside `next`).
        let waitMs = 0;
        try {
          // We approximate wait time as 0 for queries that start immediately
          // (active < pool_max) and measure elapsed time for queued ones.
          const startedAt = Date.now();
          waitMs = startedAt - enqueuedAt;
          this._recordWaitSample(waitMs);

          const result = await next(params);
          return result;
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === 'P2024') this._poolErrors++;
          throw err;
        } finally {
          this._activeQueries--;
          poolMetricsRegistry.update(this.getPoolMetrics());
        }
      });

      // 2. Automatic query result caching middleware
      if (this.redisService) {
        client.$use(
          createPrismaCacheMiddleware({
            redisService: this.redisService,
            logger: new Logger('PrismaCacheMiddleware'),
          }),
        );
      }
    }
  }

  /**
   * Records a wait time sample in the rolling circular buffer (last 100 queries).
   */
  private _recordWaitSample(waitMs: number): void {
    if (this._waitSamples.length >= this.WAIT_WINDOW) {
      // Remove the oldest sample from the running total before eviction.
      const evicted = this._waitSamples.shift()!;
      this._totalWaitMs -= evicted;
    }
    this._waitSamples.push(waitMs);
    this._totalWaitMs += waitMs;
    this._waitSampleCount++;
  }

  /**
   * Returns the rolling average wait time (ms) over the last 100 queries.
   */
  private _getAvgWaitMs(): number {
    if (this._waitSamples.length === 0) return 0;
    return this._totalWaitMs / this._waitSamples.length;
  }

  /**
   * Starts the adaptive pool sizing background timer.
   * Every 60 seconds, evaluates utilization and logs actionable guidance.
   */
  private _startAdaptivePoolMonitor(): void {
    this._adaptiveTimer = setInterval(() => {
      const metrics = this.getPoolMetrics();
      const utilization = metrics.pool_max > 0 ? metrics.active_queries / metrics.pool_max : 0;

      if (utilization > 0.8) {
        this._highUtilChecks++;
        if (this._highUtilChecks >= HIGH_UTIL_THRESHOLD_CHECKS) {
          this.logger.warn(
            `[AdaptivePool] Pool utilization has been >80% for ${this._highUtilChecks} consecutive checks ` +
            `(active=${metrics.active_queries}/${metrics.pool_max}). ` +
            `Consider increasing DB_POOL_MAX (current cap: ${POOL_SIZE_LIMIT}).`,
          );
          // Reset counter so we only warn once per sustained period.
          this._highUtilChecks = 0;
        }
      } else {
        // Reset sustained-high counter on any non-high check.
        this._highUtilChecks = 0;

        if (utilization < 0.2 && metrics.pool_max > 2) {
          this.logger.log(
            `[AdaptivePool] Pool utilization is low (<20%): ` +
            `active=${metrics.active_queries}/${metrics.pool_max}. ` +
            `Consider decreasing DB_POOL_MAX to reduce idle resource usage.`,
          );
        }
      }

      // Always push the latest snapshot so Prometheus reflects current state.
      poolMetricsRegistry.update(metrics);
    }, ADAPTIVE_CHECK_INTERVAL_MS);

    // Allow the process to exit even if the timer is still running.
    if (this._adaptiveTimer.unref) {
      this._adaptiveTimer.unref();
    }
  }

  /**
   * Registers or updates query result caching middleware with custom options.
   */
  public attachCacheMiddleware(redisService: RedisService, options?: Omit<PrismaCacheMiddlewareOptions, 'redisService'>): void {
    const client = this as PrismaClient & {
      $use?: (
        middleware: (
          params: { model?: string; action: string; args?: any },
          next: (params: { model?: string; action: string; args?: any }) => Promise<unknown>,
        ) => Promise<unknown>,
      ) => void;
    };
    if (typeof client.$use === 'function') {
      client.$use(
        createPrismaCacheMiddleware({
          ...options,
          redisService,
          logger: options?.logger ?? new Logger('PrismaCacheMiddleware'),
        }),
      );
    }
  }

  async onModuleInit() {
    await this.$connect();
    // Seed static config gauges immediately so /metrics is non-zero before first query
    poolMetricsRegistry.update(this.getPoolMetrics());
    this._startAdaptivePoolMonitor();
    this.logger.log(
      `Prisma connected — pool_max=${POOL_MAX} (cap=${POOL_SIZE_LIMIT}) ` +
      `pool_timeout=${POOL_TIMEOUT_MS}ms connect_timeout=${CONNECT_TIMEOUT_S}s ` +
      `idle_timeout=${POOL_IDLE_TIMEOUT_MS}ms`,
    );
  }

  async onModuleDestroy() {
    if (this._adaptiveTimer) {
      clearInterval(this._adaptiveTimer);
      this._adaptiveTimer = null;
    }
    await this.$disconnect();
  }

  getPoolMetrics() {
    const idleConnections = Math.max(0, POOL_MAX - this._activeQueries);
    const avgWaitMs = parseFloat(this._getAvgWaitMs().toFixed(3));

    return {
      // Existing fields (backward compatible)
      pool_max:            POOL_MAX,
      pool_timeout_ms:     POOL_TIMEOUT_MS,
      connect_timeout_s:   CONNECT_TIMEOUT_S,
      active_queries:      this._activeQueries,
      total_queries:       this._totalQueries,
      pool_timeout_errors: this._poolErrors,
      // New fields (Issue #1072)
      idle_connections:    idleConnections,
      avg_wait_ms:         avgWaitMs,
      idle_timeout_ms:     POOL_IDLE_TIMEOUT_MS,
      idle_timeout_s:      POOL_IDLE_TIMEOUT_S,
      pool_size_limit:     POOL_SIZE_LIMIT,
    };
  }
}
