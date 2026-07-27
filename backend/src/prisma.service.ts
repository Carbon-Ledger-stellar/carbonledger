import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CorrelationIdContext } from './logger/correlation-id.context';

// Pool sizing: allow override via env, default to 10 for production safety.
// Formula: (num_cores * 2) + effective_spindle_count — start conservative.
const POOL_MAX           = parseInt(process.env.DB_POOL_MAX           ?? '10');
const POOL_TIMEOUT_MS    = parseInt(process.env.DB_POOL_TIMEOUT_MS    ?? '10000');
const CONNECT_TIMEOUT_S  = parseInt(process.env.DB_CONNECT_TIMEOUT_S  ?? '10');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // Pool / query metrics
  private _activeQueries  = 0;
  private _totalQueries   = 0;
  private _poolErrors     = 0;

  constructor() {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('connection_limit', String(POOL_MAX));
    url.searchParams.set('pool_timeout',     String(POOL_TIMEOUT_MS / 1000));
    url.searchParams.set('connect_timeout',  String(CONNECT_TIMEOUT_S));

    super({
      datasources: { db: { url: url.toString() } },
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
    });

    /**
     * Prisma middleware — runs around every query.
     *
     * Responsibilities:
     *  1. Track pool metrics (_activeQueries, _totalQueries, _poolErrors)
     *  2. Pass the current correlationId, actor, and role from AsyncLocalStorage
     *     into the query log so every DB operation is traceable.
     *  3. Log slow queries (> SLOW_QUERY_THRESHOLD_MS) at warn level.
     */
    const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS ?? '500');

    this.$use(async (params, next) => {
      this._activeQueries++;
      this._totalQueries++;

      const t0 = Date.now();

      // Capture correlation context before the await so we don't lose it
      const ctx = CorrelationIdContext.getContext();
      const correlationId = ctx?.correlationId;
      const actor         = ctx?.actor;
      const role          = ctx?.role;

      try {
        const result = await next(params);

        const durationMs = Date.now() - t0;

        if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
          // NestJS Logger is synchronous — safe to call here
          this.logger.warn(
            `Slow query: ${params.model}.${params.action} took ${durationMs}ms`,
            // Structured fields are attached as second arg (NestJS Logger ignores them,
            // but they appear in the JSON output when the app uses LoggerService)
          );
          // Also write directly to stdout as structured JSON so it always appears
          // regardless of which logger is active.
          if (correlationId) {
            process.stdout.write(
              JSON.stringify({
                timestamp:     new Date().toISOString(),
                level:         'warn',
                service:       'carbonledger-backend',
                message:       `Slow query detected`,
                correlationId,
                actor,
                role,
                model:         params.model,
                action:        params.action,
                durationMs,
              }) + '\n',
            );
          }
        }

        return result;
      } catch (err: any) {
        if (err?.code === 'P2024') {
          this._poolErrors++;
          if (correlationId) {
            process.stdout.write(
              JSON.stringify({
                timestamp:     new Date().toISOString(),
                level:         'error',
                service:       'carbonledger-backend',
                message:       'Prisma connection pool timeout',
                correlationId,
                actor,
                role,
                model:         params.model,
                action:        params.action,
                errorCode:     err.code,
              }) + '\n',
            );
          }
        }
        throw err;
      } finally {
        this._activeQueries--;
      }
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(
      `Prisma connected — pool_max=${POOL_MAX} pool_timeout=${POOL_TIMEOUT_MS}ms connect_timeout=${CONNECT_TIMEOUT_S}s`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  getPoolMetrics() {
    return {
      pool_max:            POOL_MAX,
      pool_timeout_ms:     POOL_TIMEOUT_MS,
      connect_timeout_s:   CONNECT_TIMEOUT_S,
      active_queries:      this._activeQueries,
      total_queries:       this._totalQueries,
      pool_timeout_errors: this._poolErrors,
    };
  }
}
