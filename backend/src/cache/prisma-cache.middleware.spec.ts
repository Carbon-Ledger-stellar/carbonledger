import { Logger } from '@nestjs/common';
import {
  createPrismaCacheMiddleware,
  generateCacheKey,
  hashQueryArgs,
  DEFAULT_CACHE_TTL_SECONDS,
  DEFAULT_CACHEABLE_MODELS,
  PrismaMiddlewareParams,
} from './prisma-cache.middleware';
import { RedisService } from '../redis.service';

describe('PrismaCacheMiddleware', () => {
  let mockRedisService: jest.Mocked<RedisService>;
  let mockLogger: jest.Mocked<Logger>;
  let cacheStore: Map<string, any>;

  beforeEach(() => {
    cacheStore = new Map<string, any>();

    mockRedisService = {
      get: jest.fn().mockImplementation(async (key: string) => {
        return cacheStore.has(key) ? cacheStore.get(key) : null;
      }),
      set: jest.fn().mockImplementation(async (key: string, value: any, _ttl: number) => {
        cacheStore.set(key, value);
        return true;
      }),
      del: jest.fn().mockImplementation(async (...keys: string[]) => {
        for (const k of keys) cacheStore.delete(k);
        return true;
      }),
      delByPattern: jest.fn().mockImplementation(async (pattern: string) => {
        const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        for (const key of Array.from(cacheStore.keys())) {
          if (regex.test(key)) {
            cacheStore.delete(key);
          }
        }
        return true;
      }),
    } as unknown as jest.Mocked<RedisService>;

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
  });

  describe('Deterministic Key Generation', () => {
    it('generates consistent keys regardless of object property ordering', () => {
      const args1 = { where: { status: 'Active', vintageYear: 2024 } };
      const args2 = { where: { vintageYear: 2024, status: 'Active' } };

      const hash1 = hashQueryArgs(args1);
      const hash2 = hashQueryArgs(args2);

      expect(hash1).toBe(hash2);
      expect(generateCacheKey('prisma:cache:', 'CarbonProject', 'findMany', args1)).toBe(
        generateCacheKey('prisma:cache:', 'CarbonProject', 'findMany', args2),
      );
    });

    it('handles null, undefined, dates, and nested structures cleanly', () => {
      const date = new Date('2026-01-01T00:00:00.000Z');
      const hashNull = hashQueryArgs(null);
      const hashUndef = hashQueryArgs(undefined);
      const hashWithDate = hashQueryArgs({ date, count: BigInt(10) });

      expect(hashNull).toBe('default');
      expect(hashUndef).toBe('default');
      expect(typeof hashWithDate).toBe('string');
      expect(hashWithDate.length).toBe(32);
    });
  });

  describe('Read Query Caching & Cache Misses Logging', () => {
    it('logs cache miss, calls next(), and caches result with 5-minute TTL on first query', async () => {
      const middleware = createPrismaCacheMiddleware({
        redisService: mockRedisService,
        logger: mockLogger,
        ttlSeconds: DEFAULT_CACHE_TTL_SECONDS,
      });

      const mockProject = { id: 'p1', projectId: 'PROJ-001', name: 'Reforestation Project' };
      const nextFn = jest.fn().mockResolvedValue([mockProject]);

      const params: PrismaMiddlewareParams = {
        model: 'CarbonProject',
        action: 'findMany',
        args: { where: { status: 'Active' } },
      };

      // 1. First execution -> Cache miss
      const result = await middleware(params, nextFn);

      expect(result).toEqual([mockProject]);
      expect(nextFn).toHaveBeenCalledTimes(1);
      expect(mockRedisService.get).toHaveBeenCalledTimes(1);
      expect(mockRedisService.set).toHaveBeenCalledTimes(1);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('prisma:cache:CarbonProject:findMany:'),
        [mockProject],
        300, // 5-minute TTL
      );

      // Cache miss logged for monitoring
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('[Cache Miss] CarbonProject.findMany'),
      );
    });

    it('serves repeated queries directly from cache without calling next() (Cache Hit)', async () => {
      const middleware = createPrismaCacheMiddleware({
        redisService: mockRedisService,
        logger: mockLogger,
      });

      const mockListing = { id: 'l1', listingId: 'LIST-1', pricePerCredit: '15.00' };
      const nextFn = jest.fn().mockResolvedValue([mockListing]);

      const params: PrismaMiddlewareParams = {
        model: 'MarketListing',
        action: 'findMany',
        args: { where: { status: 'Active' } },
      };

      // 1. First call -> populate cache
      await middleware(params, nextFn);
      expect(nextFn).toHaveBeenCalledTimes(1);

      // 2. Second call -> served from cache
      const cachedResult = await middleware(params, nextFn);

      expect(cachedResult).toEqual([mockListing]);
      expect(nextFn).toHaveBeenCalledTimes(1); // Not called again
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[Cache Hit] MarketListing.findMany'),
      );
    });

    it('caches PriceApproval queries with 5-minute TTL', async () => {
      const middleware = createPrismaCacheMiddleware({
        redisService: mockRedisService,
        logger: mockLogger,
      });

      const priceData = [{ id: 'pa1', methodology: 'VCS', priceStroops: '1000' }];
      const nextFn = jest.fn().mockResolvedValue(priceData);

      const params: PrismaMiddlewareParams = {
        model: 'PriceApproval',
        action: 'findMany',
        args: { orderBy: { createdAt: 'desc' } },
      };

      const result1 = await middleware(params, nextFn);
      expect(result1).toEqual(priceData);
      expect(nextFn).toHaveBeenCalledTimes(1);

      const result2 = await middleware(params, nextFn);
      expect(result2).toEqual(priceData);
      expect(nextFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cache Invalidation on Mutations', () => {
    it.each([
      ['create', { data: { projectId: 'PROJ-NEW' } }],
      ['createMany', { data: [{ projectId: 'PROJ-1' }] }],
      ['update', { where: { id: 'p1' }, data: { status: 'Verified' } }],
      ['updateMany', { where: { status: 'Pending' }, data: { status: 'Active' } }],
      ['upsert', { where: { id: 'p1' }, update: {}, create: {} }],
      ['delete', { where: { id: 'p1' } }],
      ['deleteMany', { where: { status: 'Rejected' } }],
    ])('invalidates model cache on %s mutation', async (action, args) => {
      const middleware = createPrismaCacheMiddleware({
        redisService: mockRedisService,
        logger: mockLogger,
      });

      // Prepopulate cache for CarbonProject
      cacheStore.set('prisma:cache:CarbonProject:findMany:abc', [{ id: 'p1' }]);
      cacheStore.set('prisma:cache:CarbonProject:findUnique:def', { id: 'p1' });
      cacheStore.set('prisma:cache:MarketListing:findMany:xyz', [{ id: 'l1' }]);

      const mutationNext = jest.fn().mockResolvedValue({ success: true });

      const mutationParams: PrismaMiddlewareParams = {
        model: 'CarbonProject',
        action,
        args,
      };

      await middleware(mutationParams, mutationNext);

      expect(mutationNext).toHaveBeenCalledTimes(1);
      expect(mockRedisService.delByPattern).toHaveBeenCalledWith('prisma:cache:CarbonProject:*');
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('[Cache Invalidation] Purged cache for model "CarbonProject"'),
      );

      // CarbonProject cached keys should be deleted, MarketListing untouched
      expect(cacheStore.has('prisma:cache:CarbonProject:findMany:abc')).toBe(false);
      expect(cacheStore.has('prisma:cache:CarbonProject:findUnique:def')).toBe(false);
      expect(cacheStore.has('prisma:cache:MarketListing:findMany:xyz')).toBe(true);
    });
  });

  describe('Non-cacheable Models and Passthrough', () => {
    it('bypasses caching and invalidation for non-cacheable models like User or AuditLog', async () => {
      const middleware = createPrismaCacheMiddleware({
        redisService: mockRedisService,
        logger: mockLogger,
      });

      const nextFn = jest.fn().mockResolvedValue({ id: 'u1', email: 'test@example.com' });

      const params: PrismaMiddlewareParams = {
        model: 'User',
        action: 'findUnique',
        args: { where: { id: 'u1' } },
      };

      const result = await middleware(params, nextFn);

      expect(result).toEqual({ id: 'u1', email: 'test@example.com' });
      expect(nextFn).toHaveBeenCalledTimes(1);
      expect(mockRedisService.get).not.toHaveBeenCalled();
      expect(mockRedisService.set).not.toHaveBeenCalled();
    });

    it('passes through directly when no RedisService is provided or model is undefined', async () => {
      const middlewareWithoutRedis = createPrismaCacheMiddleware({
        logger: mockLogger,
      });

      const nextFn = jest.fn().mockResolvedValue({ count: 5 });

      const params: PrismaMiddlewareParams = {
        model: 'CarbonProject',
        action: 'count',
      };

      const result = await middlewareWithoutRedis(params, nextFn);

      expect(result).toEqual({ count: 5 });
      expect(nextFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Graceful Error Degradation', () => {
    it('falls back to database when Redis GET throws', async () => {
      mockRedisService.get = jest.fn().mockRejectedValue(new Error('Redis connection timeout'));

      const middleware = createPrismaCacheMiddleware({
        redisService: mockRedisService,
        logger: mockLogger,
      });

      const nextFn = jest.fn().mockResolvedValue([{ id: 'p1' }]);

      const params: PrismaMiddlewareParams = {
        model: 'CarbonProject',
        action: 'findMany',
      };

      const result = await middleware(params, nextFn);

      expect(result).toEqual([{ id: 'p1' }]);
      expect(nextFn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error reading from cache'),
      );
    });

    it('returns mutation result even if Redis invalidation fails', async () => {
      mockRedisService.delByPattern = jest.fn().mockRejectedValue(new Error('Redis cluster down'));

      const middleware = createPrismaCacheMiddleware({
        redisService: mockRedisService,
        logger: mockLogger,
      });

      const nextFn = jest.fn().mockResolvedValue({ id: 'p1', updated: true });

      const params: PrismaMiddlewareParams = {
        model: 'CarbonProject',
        action: 'update',
        args: { where: { id: 'p1' }, data: { status: 'Approved' } },
      };

      const result = await middleware(params, nextFn);

      expect(result).toEqual({ id: 'p1', updated: true });
      expect(nextFn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error invalidating cache'),
      );
    });
  });

  describe('Performance Improvement Benchmark (Acceptance Criteria: 40%+)', () => {
    it('improves query performance by more than 40% when served from cache', async () => {
      const simulatedDbLatencyMs = 25;
      const middleware = createPrismaCacheMiddleware({
        redisService: mockRedisService,
        logger: mockLogger,
      });

      const mockDbQuery = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, simulatedDbLatencyMs));
        return [{ id: 'p1', name: 'Reforestation' }];
      });

      const params: PrismaMiddlewareParams = {
        model: 'CarbonProject',
        action: 'findMany',
        args: { where: { methodology: 'VCS' } },
      };

      // Uncached run (DB query)
      const startUncached = performance.now();
      await middleware(params, mockDbQuery);
      const uncachedDuration = performance.now() - startUncached;

      // Cached run (served from memory/redis)
      const startCached = performance.now();
      await middleware(params, mockDbQuery);
      const cachedDuration = performance.now() - startCached;

      const performanceImprovement =
        ((uncachedDuration - cachedDuration) / uncachedDuration) * 100;

      expect(mockDbQuery).toHaveBeenCalledTimes(1);
      expect(cachedDuration).toBeLessThan(uncachedDuration);
      expect(performanceImprovement).toBeGreaterThanOrEqual(40);
    });
  });
});
