import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

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

  constructor() {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("connection_limit", String(POOL_MAX));
    url.searchParams.set("pool_timeout", String(POOL_TIMEOUT_MS / 1000));
    url.searchParams.set("connect_timeout", String(CONNECT_TIMEOUT_S));

    super({
      datasources: { db: { url: url.toString() } },
      log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
    });

    // Track active queries for metrics. Prisma 6 removed $use middleware; the
    // supported replacement is a query-level client extension. $extends returns
    // a proxy wrapping this client rather than mutating it, so we return that
    // proxy as the instance — counters still live on (and are read from) the
    // underlying client, which the proxy delegates to.
    const self = this;
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            self._activeQueries++;
            self._totalQueries++;
            try {
              return await query(args);
            } catch (err: any) {
              if (err?.code === "P2024") self._poolErrors++; // pool timeout
              throw err;
            } finally {
              self._activeQueries--;
            }
          },
        },
      },
    }) as unknown as PrismaService;
  }

  async onModuleInit() {
    await this.$connect();
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
