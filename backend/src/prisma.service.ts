import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { poolMetricsRegistry } from "./common/metrics.registry";
import { CorrelationIdContext } from "./logger/correlation-id.context";

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

    // Prisma 6 removed client middleware ($use); register only when available.
    const client = this as PrismaClient & {
      $use?: (
        middleware: (
          params: { model?: string; action: string },
          next: (params: { model?: string; action: string }) => Promise<unknown>,
        ) => Promise<unknown>,
      ) => void;
    };
    if (typeof client.$use === 'function') {
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

      client.$use(async (params, next) => {
        if (['CarbonProject', 'User', 'CreditBatch'].includes(params.model || '') && params.action === 'update') {
          let oldState = null;
          if ((params as any).args && (params as any).args.where) {
            const modelDelegate = params.model!.charAt(0).toLowerCase() + params.model!.slice(1);
            oldState = await (client as any)[modelDelegate].findUnique({ where: (params as any).args.where });
          }
          const newState = await next(params);

          const context = CorrelationIdContext.getContext();
          const actor = context?.actor || null;
          const ipAddress = context?.ip || null;

          const resourceId = (newState as any)?.id || (newState as any)?.projectId || (newState as any)?.batchId || null;

          await client.auditLog.create({
            data: {
              userId: actor,
              action: 'update',
              resourceId: resourceId,
              ipAddress: ipAddress,
              result: 'Success',
              metadata: {
                model: params.model,
                oldState,
                newState,
              }
            }
          });

          return newState;
        }
        return next(params);
      });

      client.$use(async (params, next) => {
        const softDeleteModels = ['CarbonProject', 'CreditBatch', 'MarketListing', 'RetirementRecord'];
        if (softDeleteModels.includes(params.model || '')) {
          const includeDeleted = params.args?.includeDeleted;
          if (params.args && 'includeDeleted' in params.args) {
            delete params.args.includeDeleted;
          }

          if (!includeDeleted) {
            if (params.action === 'findUnique' || params.action === 'findFirst') {
              params.action = 'findFirst';
              params.args.where = { deletedAt: null, ...params.args.where };
            }
            if (params.action === 'findMany') {
              if (params.args.where?.deletedAt === undefined) {
                params.args.where = { deletedAt: null, ...params.args.where };
              }
            }
            if (params.action === 'updateMany') {
              if (params.args.where?.deletedAt === undefined) {
                params.args.where = { deletedAt: null, ...params.args.where };
              }
            }
          }
          if (params.action === 'delete') {
            params.action = 'update';
            params.args.data = { deletedAt: new Date() };
          }
          if (params.action === 'deleteMany') {
            params.action = 'updateMany';
            if (params.args.data !== undefined) {
              params.args.data.deletedAt = new Date();
            } else {
              params.args.data = { deletedAt: new Date() };
            }
          }
        }
        return next(params);
      });
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
