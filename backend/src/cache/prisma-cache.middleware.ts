import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '../redis.service';

export interface PrismaCacheMiddlewareOptions {
  /** Time-to-live for cached queries in seconds. Default is 300s (5 minutes). */
  ttlSeconds?: number;
  /** List of Prisma models to automatically cache. Default includes frequently accessed models. */
  cacheableModels?: string[];
  /** Prefix for Redis keys. Default is 'prisma:cache:'. */
  keyPrefix?: string;
  /** Logger instance to use. */
  logger?: Logger;
  /** RedisService instance. */
  redisService?: RedisService;
}

export interface PrismaMiddlewareParams {
  model?: string;
  action: string;
  args?: any;
  dataPath?: string[];
  runInTransaction?: boolean;
}

export type PrismaMiddlewareNext = (params: PrismaMiddlewareParams) => Promise<any>;

export const DEFAULT_CACHE_TTL_SECONDS = 300; // 5 minutes

export const DEFAULT_CACHEABLE_MODELS = [
  'CarbonProject',
  'MarketListing',
  'PriceApproval',
  'CreditBatch',
  'OracleJob',
];

export const READ_ACTIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export const MUTATION_ACTIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * Deterministically serializes and hashes query arguments for consistent cache keys.
 */
export function hashQueryArgs(args: any): string {
  if (args === undefined || args === null) {
    return 'default';
  }

  const normalize = (val: any): any => {
    if (val === null || val === undefined) return val;
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'bigint') return val.toString();
    if (Array.isArray(val)) return val.map(normalize);
    if (typeof val === 'object') {
      const sortedObj: Record<string, any> = {};
      const keys = Object.keys(val).sort();
      for (const k of keys) {
        sortedObj[k] = normalize(val[k]);
      }
      return sortedObj;
    }
    return val;
  };

  try {
    const normalized = normalize(args);
    const jsonString = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(jsonString).digest('hex').substring(0, 32);
  } catch {
    return crypto.createHash('sha256').update(String(args)).digest('hex').substring(0, 32);
  }
}

/**
 * Generates a Redis cache key for a Prisma query.
 */
export function generateCacheKey(
  keyPrefix: string,
  model: string,
  action: string,
  args: any,
): string {
  const argsHash = hashQueryArgs(args);
  return `${keyPrefix}${model}:${action}:${argsHash}`;
}

/**
 * Creates a Prisma middleware that automatically caches read queries and invalidates on mutations.
 */
export function createPrismaCacheMiddleware(options: PrismaCacheMiddlewareOptions = {}) {
  const {
    ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
    cacheableModels = DEFAULT_CACHEABLE_MODELS,
    keyPrefix = 'prisma:cache:',
    logger = new Logger('PrismaCacheMiddleware'),
    redisService,
  } = options;

  const normalizedModels = new Set(cacheableModels.map((m) => m.toLowerCase()));

  return async (params: PrismaMiddlewareParams, next: PrismaMiddlewareNext): Promise<any> => {
    const { model, action, args } = params;

    // If no model or RedisService is not provided, proceed directly
    if (!model || !redisService) {
      return next(params);
    }

    const isCacheableModel = normalizedModels.has(model.toLowerCase());

    // 1. Handle Read Operations
    if (isCacheableModel && READ_ACTIONS.has(action)) {
      const cacheKey = generateCacheKey(keyPrefix, model, action, args);

      try {
        const cached = await redisService.get<any>(cacheKey);
        if (cached !== null && cached !== undefined) {
          logger.debug(`[Cache Hit] ${model}.${action} (key: ${cacheKey})`);
          return cached;
        }
      } catch (err: any) {
        logger.warn(`Error reading from cache for ${model}.${action}: ${err?.message}`);
      }

      // Cache miss - log for monitoring
      logger.log(`[Cache Miss] ${model}.${action} (key: ${cacheKey})`);

      const result = await next(params);

      if (result !== undefined) {
        try {
          await redisService.set(cacheKey, result, ttlSeconds);
        } catch (err: any) {
          logger.warn(`Error saving to cache for ${model}.${action}: ${err?.message}`);
        }
      }

      return result;
    }

    // 2. Handle Mutation Operations
    if (isCacheableModel && MUTATION_ACTIONS.has(action)) {
      const result = await next(params);

      try {
        const pattern = `${keyPrefix}${model}:*`;
        await redisService.delByPattern(pattern);
        logger.log(`[Cache Invalidation] Purged cache for model "${model}" following ${action} (pattern: ${pattern})`);
      } catch (err: any) {
        logger.warn(`Error invalidating cache for ${model}: ${err?.message}`);
      }

      return result;
    }

    // Default: pass through
    return next(params);
  };
}
