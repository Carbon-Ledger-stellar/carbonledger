/**
 * Cache Configuration
 * 
 * Centralized configuration for query result caching behavior,
 * TTL settings, and model-specific policies.
 */

export interface CacheConfig {
  enabled: boolean;
  defaultTtlSeconds: number;
  redisUrl: string;
  keyPrefix: string;
  maxMemoryBytes: number;
  evictionPolicy: 'lru' | 'lfu' | 'fifo';
  modelPolicies: Record<string, ModelCachePolicy>;
}

export interface ModelCachePolicy {
  cacheable: boolean;
  ttlSeconds: number;
  maxSize?: number;
  invalidationTriggers: string[]; // Models that trigger invalidation
}

export class CacheConfigService {
  private config: CacheConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): CacheConfig {
    const env = process.env;

    return {
      enabled: env.CACHE_ENABLED !== 'false',
      defaultTtlSeconds: parseInt(env.CACHE_TTL_SECONDS || '300', 10), // 5 minutes
      redisUrl:
        env.REDIS_URL ||
        `redis://${env.REDIS_HOST || 'localhost'}:${env.REDIS_PORT || '6379'}`,
      keyPrefix: env.CACHE_KEY_PREFIX || 'prisma:cache:',
      maxMemoryBytes: parseInt(env.CACHE_MAX_MEMORY || '536870912', 10), // 512MB
      evictionPolicy: (env.CACHE_EVICTION_POLICY as any) || 'lru',
      modelPolicies: this.loadModelPolicies(),
    };
  }

  private loadModelPolicies(): Record<string, ModelCachePolicy> {
    return {
      // High-read models: 5-minute TTL
      CarbonProject: {
        cacheable: true,
        ttlSeconds: 300,
        invalidationTriggers: ['CarbonProject', 'CreditBatch', 'MarketListing'],
      },
      CreditBatch: {
        cacheable: true,
        ttlSeconds: 300,
        invalidationTriggers: ['CreditBatch', 'RetirementRecord'],
      },
      MarketListing: {
        cacheable: true,
        ttlSeconds: 300,
        invalidationTriggers: [
          'MarketListing',
          'CarbonProject',
          'PriceApproval',
        ],
      },

      // Reference data: 30-minute TTL (less frequently changed)
      PriceApproval: {
        cacheable: true,
        ttlSeconds: 1800,
        invalidationTriggers: ['PriceApproval', 'MarketListing'],
      },
      ProjectType: {
        cacheable: true,
        ttlSeconds: 1800,
        invalidationTriggers: ['ProjectType'],
      },

      // Medium-read models: 10-minute TTL
      RetirementRecord: {
        cacheable: true,
        ttlSeconds: 600,
        invalidationTriggers: ['RetirementRecord', 'CreditBatch'],
      },
      User: {
        cacheable: true,
        ttlSeconds: 600,
        invalidationTriggers: ['User'],
      },

      // Oracle/monitoring: 1-minute TTL (frequently updated)
      OracleJob: {
        cacheable: true,
        ttlSeconds: 60,
        invalidationTriggers: ['OracleJob'],
      },
      MonitoringData: {
        cacheable: true,
        ttlSeconds: 60,
        invalidationTriggers: ['MonitoringData'],
      },

      // Not cached (write-heavy or sensitive)
      IdempotencyRecord: {
        cacheable: false,
        ttlSeconds: 0,
        invalidationTriggers: [],
      },
      AuditLog: {
        cacheable: false,
        ttlSeconds: 0,
        invalidationTriggers: [],
      },
      WebhookDelivery: {
        cacheable: false,
        ttlSeconds: 0,
        invalidationTriggers: [],
      },
    };
  }

  /**
   * Get overall cache configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Check if a model is cacheable
   */
  isModelCacheable(modelName: string): boolean {
    return this.config.modelPolicies[modelName]?.cacheable ?? false;
  }

  /**
   * Get TTL for a specific model
   */
  getModelTtl(modelName: string): number {
    return (
      this.config.modelPolicies[modelName]?.ttlSeconds ||
      this.config.defaultTtlSeconds
    );
  }

  /**
   * Get invalidation triggers for a model
   */
  getInvalidationTriggers(modelName: string): string[] {
    return this.config.modelPolicies[modelName]?.invalidationTriggers || [];
  }

  /**
   * Get list of all cacheable models
   */
  getCacheableModels(): string[] {
    return Object.entries(this.config.modelPolicies)
      .filter(([, policy]) => policy.cacheable)
      .map(([model]) => model);
  }

  /**
   * Check if caching is globally enabled
   */
  isCachingEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get Redis connection URL
   */
  getRedisUrl(): string {
    return this.config.redisUrl;
  }

  /**
   * Get cache key prefix
   */
  getKeyPrefix(): string {
    return this.config.keyPrefix;
  }

  /**
   * Get max cache memory
   */
  getMaxMemory(): number {
    return this.config.maxMemoryBytes;
  }

  /**
   * Validate configuration
   */
  validate(): string[] {
    const errors: string[] = [];

    if (this.config.defaultTtlSeconds < 1) {
      errors.push('Default TTL must be at least 1 second');
    }

    if (this.config.maxMemoryBytes < 1000000) {
      errors.push('Max memory must be at least 1MB');
    }

    if (!['lru', 'lfu', 'fifo'].includes(this.config.evictionPolicy)) {
      errors.push('Invalid eviction policy');
    }

    return errors;
  }

  /**
   * Get configuration as environment variable string
   * (useful for debugging)
   */
  toEnvString(): string {
    return `
Cache Configuration:
  Enabled: ${this.config.enabled}
  Default TTL: ${this.config.defaultTtlSeconds}s
  Redis URL: ${this.config.redisUrl}
  Key Prefix: ${this.config.keyPrefix}
  Max Memory: ${this.config.maxMemoryBytes}b (${(this.config.maxMemoryBytes / 1024 / 1024).toFixed(2)}MB)
  Eviction Policy: ${this.config.evictionPolicy}
  Cacheable Models: ${this.getCacheableModels().length}
    `.trim();
  }
}

/**
 * Default export for singleton instance
 */
export const cacheConfigService = new CacheConfigService();

