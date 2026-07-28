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
    super({
      log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
    });
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

  /**
   * Track a query execution for pool metrics.
   * Called by services that want to report query stats.
   */
  trackQuery(errorCode?: string): void {
    this._activeQueries++;
    this._totalQueries++;
    if (errorCode === "P2024") this._poolErrors++;
    this._activeQueries--;
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
