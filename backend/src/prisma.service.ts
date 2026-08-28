import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Optional } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { poolMetricsRegistry } from "./common/metrics.registry";
import { RedisService } from "./redis.service";
import { createPrismaCacheMiddleware, PrismaCacheMiddlewareOptions } from "./cache/prisma-cache.middleware";

// Pool sizing: allow override via env, default to 10 for production safety.
// Formula: (num_cores * 2) + effective_spindle_count — start conservative.
const POOL_MAX = parseInt(process.env.DB_POOL_MAX ?? "10");
const POOL_TIMEOUT_MS = parseInt(process.env.DB_POOL_TIMEOUT_MS ?? "10000");
const CONNECT_TIMEOUT_S = parseInt(process.env.DB_CONNECT_TIMEOUT_S ?? "10");

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // Track in-flight query count for pool metrics
  private _activeQueries = 0;
  private _totalQueries = 0;
  private _poolErrors = 0;

  constructor(@Optional() private readonly redisService?: RedisService) {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("connection_limit", String(POOL_MAX));
    url.searchParams.set("pool_timeout", String(POOL_TIMEOUT_MS / 1000));
    url.searchParams.set("connect_timeout", String(CONNECT_TIMEOUT_S));

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
      // 1. Connection pool metrics tracking middleware
      client.$use(async (params, next) => {
        this._activeQueries++;
        this._totalQueries++;
        poolMetricsRegistry.update(this.getPoolMetrics());
        try {
          return await next(params);
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
    this.logger.log(
      `Prisma connected — pool_max=${POOL_MAX} pool_timeout=${POOL_TIMEOUT_MS}ms connect_timeout=${CONNECT_TIMEOUT_S}s`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  getPoolMetrics() {
    return {
      pool_max: POOL_MAX,
      pool_timeout_ms: POOL_TIMEOUT_MS,
      connect_timeout_s: CONNECT_TIMEOUT_S,
      active_queries: this._activeQueries,
      total_queries: this._totalQueries,
      pool_timeout_errors: this._poolErrors,
    };
  }
}
