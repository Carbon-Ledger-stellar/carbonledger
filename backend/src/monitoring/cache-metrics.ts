/**
 * Cache Performance Metrics
 * 
 * Tracks cache hit/miss rates, memory usage, and performance improvements.
 * Exports metrics to monitoring systems (Prometheus, Datadog, etc.)
 */

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis.service';

@Injectable()
export class CacheMetricsService {
  private readonly logger = new Logger('CacheMetricsService');
  private readonly metricsPrefix = 'cache:metrics:';
  private readonly historyPrefix = 'cache:history:';
  private readonly maxHistoryEntries = 1000;

  constructor(private readonly redis: RedisService) {
    this.initializeMetrics();
  }

  /**
   * Initialize metrics counters
   */
  private async initializeMetrics(): Promise<void> {
    try {
      const hitKey = `${this.metricsPrefix}hits`;
      const missKey = `${this.metricsPrefix}misses`;
      const errorKey = `${this.metricsPrefix}errors`;

      // Initialize if not exists
      await this.redis.setnx(hitKey, '0');
      await this.redis.setnx(missKey, '0');
      await this.redis.setnx(errorKey, '0');
    } catch (error) {
      this.logger.error('Failed to initialize metrics:', error);
    }
  }

  /**
   * Record a cache hit
   */
  async recordHit(
    modelName: string,
    queryKey: string,
    responseTimeMs: number,
  ): Promise<void> {
    try {
      const hitKey = `${this.metricsPrefix}hits`;
      const modelHitKey = `${this.metricsPrefix}hits:${modelName}`;
      const responseTimeKey = `${this.metricsPrefix}responsetime:${modelName}`;

      await Promise.all([
        this.redis.incr(hitKey),
        this.redis.incr(modelHitKey),
        this.redis.zadd(responseTimeKey, responseTimeMs, queryKey),
        this.recordHistory('hit', modelName, responseTimeMs),
      ]);
    } catch (error) {
      this.logger.error('Error recording cache hit:', error);
      await this.recordMetricError();
    }
  }

  /**
   * Record a cache miss
   */
  async recordMiss(
    modelName: string,
    queryKey: string,
    responseTimeMs: number,
  ): Promise<void> {
    try {
      const missKey = `${this.metricsPrefix}misses`;
      const modelMissKey = `${this.metricsPrefix}misses:${modelName}`;
      const responseTimeKey = `${this.metricsPrefix}responsetime:db:${modelName}`;

      await Promise.all([
        this.redis.incr(missKey),
        this.redis.incr(modelMissKey),
        this.redis.zadd(responseTimeKey, responseTimeMs, queryKey),
        this.recordHistory('miss', modelName, responseTimeMs),
      ]);
    } catch (error) {
      this.logger.error('Error recording cache miss:', error);
      await this.recordMetricError();
    }
  }

  /**
   * Record cache operation error
   */
  async recordMetricError(): Promise<void> {
    try {
      await this.redis.incr(`${this.metricsPrefix}errors`);
    } catch (error) {
      this.logger.error('Failed to record metric error:', error);
    }
  }

  /**
   * Record history entry for time-series analysis
   */
  private async recordHistory(
    type: 'hit' | 'miss',
    modelName: string,
    responseTimeMs: number,
  ): Promise<void> {
    try {
      const timestamp = Date.now();
      const historyKey = `${this.historyPrefix}${modelName}`;

      const entry = JSON.stringify({
        timestamp,
        type,
        responseTimeMs,
      });

      // Add with sorted set (by timestamp) and maintain max size
      await this.redis.zadd(historyKey, timestamp, entry);

      // Trim to max entries
      const size = await this.redis.zcard(historyKey);
      if (size > this.maxHistoryEntries) {
        await this.redis.zremrangebyrank(
          historyKey,
          0,
          size - this.maxHistoryEntries - 1,
        );
      }
    } catch (error) {
      // Non-critical - don't block on history errors
      this.logger.debug('Error recording history:', error);
    }
  }

  /**
   * Get overall cache statistics
   */
  async getOverallStats(): Promise<CacheMetrics> {
    try {
      const hitKey = `${this.metricsPrefix}hits`;
      const missKey = `${this.metricsPrefix}misses`;
      const errorKey = `${this.metricsPrefix}errors`;

      const hits = parseInt(await this.redis.get(hitKey), 10) || 0;
      const misses = parseInt(await this.redis.get(missKey), 10) || 0;
      const errors = parseInt(await this.redis.get(errorKey), 10) || 0;
      const total = hits + misses;

      const hitRate = total > 0 ? (hits / total) * 100 : 0;
      const missRate = total > 0 ? (misses / total) * 100 : 0;

      return {
        hits,
        misses,
        errors,
        total,
        hitRate: parseFloat(hitRate.toFixed(2)),
        missRate: parseFloat(missRate.toFixed(2)),
        avgResponseTimeMs: await this.getAverageResponseTime(),
        cacheMemoryUsageBytes: await this.getMemoryUsage(),
      };
    } catch (error) {
      this.logger.error('Error getting overall stats:', error);
      return this.getEmptyMetrics();
    }
  }

  /**
   * Get per-model cache statistics
   */
  async getModelStats(modelName: string): Promise<ModelCacheMetrics> {
    try {
      const hitKey = `${this.metricsPrefix}hits:${modelName}`;
      const missKey = `${this.metricsPrefix}misses:${modelName}`;

      const hits = parseInt(await this.redis.get(hitKey), 10) || 0;
      const misses = parseInt(await this.redis.get(missKey), 10) || 0;
      const total = hits + misses;

      const hitRate = total > 0 ? (hits / total) * 100 : 0;

      return {
        model: modelName,
        hits,
        misses,
        total,
        hitRate: parseFloat(hitRate.toFixed(2)),
        avgCachedResponseTimeMs: await this.getAverageResponseTime(modelName),
        avgDatabaseResponseTimeMs: await this.getAverageResponseTime(
          modelName,
          'db',
        ),
      };
    } catch (error) {
      this.logger.error(`Error getting stats for model ${modelName}:`, error);
      return {
        model: modelName,
        hits: 0,
        misses: 0,
        total: 0,
        hitRate: 0,
        avgCachedResponseTimeMs: 0,
        avgDatabaseResponseTimeMs: 0,
      };
    }
  }

  /**
   * Get average response time for cached vs DB queries
   */
  private async getAverageResponseTime(
    modelName?: string,
    source?: 'cache' | 'db',
  ): Promise<number> {
    try {
      const pattern =
        source === 'db'
          ? `${this.metricsPrefix}responsetime:db:${modelName || '*'}`
          : `${this.metricsPrefix}responsetime:${modelName || '*'}`;

      let avgTime = 0;

      if (modelName && source) {
        const scores = await this.redis.zrange(pattern, 0, -1, 'WITHSCORES');
        if (scores.length > 0) {
          let sum = 0;
          for (let i = 1; i < scores.length; i += 2) {
            sum += parseFloat(scores[i]);
          }
          avgTime = sum / (scores.length / 2);
        }
      }

      return parseFloat(avgTime.toFixed(2));
    } catch (error) {
      this.logger.debug('Error calculating average response time:', error);
      return 0;
    }
  }

  /**
   * Get cache memory usage estimation
   */
  private async getMemoryUsage(): Promise<number> {
    try {
      const info = await this.redis.info('memory');
      const memoryUsedMatch = info.match(/used_memory:(\d+)/);
      return memoryUsedMatch ? parseInt(memoryUsedMatch[1], 10) : 0;
    } catch (error) {
      this.logger.debug('Error getting memory usage:', error);
      return 0;
    }
  }

  /**
   * Calculate cache effectiveness score (0-100)
   */
  async getEffectivenessScore(): Promise<number> {
    try {
      const stats = await this.getOverallStats();

      // Score based on hit rate (most important)
      let score = stats.hitRate; // 0-100

      // Penalty for high error rate
      if (stats.errors > stats.total * 0.01) {
        score -= (stats.errors / stats.total) * 10; // Up to 10 point penalty
      }

      return Math.max(0, Math.min(100, score)); // Clamp 0-100
    } catch (error) {
      this.logger.error('Error calculating effectiveness score:', error);
      return 0;
    }
  }

  /**
   * Get performance improvement estimate
   * Compares cache response times vs database response times
   */
  async getPerformanceImprovement(): Promise<PerformanceMetrics> {
    try {
      const cachedKey = `${this.metricsPrefix}responsetime:*`;
      const dbKey = `${this.metricsPrefix}responsetime:db:*`;

      // Get average cached time
      let cachedTimes = [];
      const cacheScores = await this.redis.zrange(cachedKey, 0, -1, 'WITHSCORES');
      for (let i = 1; i < cacheScores.length; i += 2) {
        cachedTimes.push(parseFloat(cacheScores[i]));
      }

      // Get average DB time
      let dbTimes = [];
      const dbScores = await this.redis.zrange(dbKey, 0, -1, 'WITHSCORES');
      for (let i = 1; i < dbScores.length; i += 2) {
        dbTimes.push(parseFloat(dbScores[i]));
      }

      const avgCachedTime =
        cachedTimes.reduce((a, b) => a + b, 0) / (cachedTimes.length || 1);
      const avgDbTime =
        dbTimes.reduce((a, b) => a + b, 0) / (dbTimes.length || 1);

      const improvementPercent =
        avgDbTime > 0 ? ((avgDbTime - avgCachedTime) / avgDbTime) * 100 : 0;

      return {
        avgCachedResponseTimeMs: parseFloat(avgCachedTime.toFixed(2)),
        avgDatabaseResponseTimeMs: parseFloat(avgDbTime.toFixed(2)),
        improvementPercent: parseFloat(improvementPercent.toFixed(2)),
      };
    } catch (error) {
      this.logger.error('Error calculating performance improvement:', error);
      return {
        avgCachedResponseTimeMs: 0,
        avgDatabaseResponseTimeMs: 0,
        improvementPercent: 0,
      };
    }
  }

  /**
   * Get all model statistics at once
   */
  async getAllModelStats(
    models: string[],
  ): Promise<Record<string, ModelCacheMetrics>> {
    const stats: Record<string, ModelCacheMetrics> = {};

    for (const model of models) {
      stats[model] = await this.getModelStats(model);
    }

    return stats;
  }

  /**
   * Reset all metrics (use with caution)
   */
  async reset(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.metricsPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      this.logger.warn('All cache metrics have been reset');
    } catch (error) {
      this.logger.error('Error resetting metrics:', error);
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  async exportPrometheus(): Promise<string> {
    try {
      const stats = await this.getOverallStats();
      const performance = await this.getPerformanceImprovement();
      const effectiveness = await this.getEffectivenessScore();

      return `
# HELP cache_hits_total Total cache hits
# TYPE cache_hits_total counter
cache_hits_total ${stats.hits}

# HELP cache_misses_total Total cache misses
# TYPE cache_misses_total counter
cache_misses_total ${stats.misses}

# HELP cache_hit_rate_percent Cache hit rate percentage
# TYPE cache_hit_rate_percent gauge
cache_hit_rate_percent ${stats.hitRate}

# HELP cache_errors_total Total cache errors
# TYPE cache_errors_total counter
cache_errors_total ${stats.errors}

# HELP cache_memory_bytes Cache memory usage in bytes
# TYPE cache_memory_bytes gauge
cache_memory_bytes ${stats.cacheMemoryUsageBytes}

# HELP cache_performance_improvement_percent Performance improvement percentage
# TYPE cache_performance_improvement_percent gauge
cache_performance_improvement_percent ${performance.improvementPercent}

# HELP cache_effectiveness_score Cache effectiveness score 0-100
# TYPE cache_effectiveness_score gauge
cache_effectiveness_score ${effectiveness}
      `.trim();
    } catch (error) {
      this.logger.error('Error exporting Prometheus metrics:', error);
      return '';
    }
  }

  private getEmptyMetrics(): CacheMetrics {
    return {
      hits: 0,
      misses: 0,
      errors: 0,
      total: 0,
      hitRate: 0,
      missRate: 0,
      avgResponseTimeMs: 0,
      cacheMemoryUsageBytes: 0,
    };
  }
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  errors: number;
  total: number;
  hitRate: number;
  missRate: number;
  avgResponseTimeMs: number;
  cacheMemoryUsageBytes: number;
}

export interface ModelCacheMetrics {
  model: string;
  hits: number;
  misses: number;
  total: number;
  hitRate: number;
  avgCachedResponseTimeMs: number;
  avgDatabaseResponseTimeMs: number;
}

export interface PerformanceMetrics {
  avgCachedResponseTimeMs: number;
  avgDatabaseResponseTimeMs: number;
  improvementPercent: number;
}

