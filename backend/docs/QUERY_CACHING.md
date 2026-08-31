# Query Result Caching Guide

**Version:** 1.0  
**Last Updated:** August 28, 2026  
**Status:** Active

---

## Overview

The Carbon Ledger platform implements automatic query result caching using Prisma middleware and Redis. This guide explains how caching works, how to configure it, and how to troubleshoot cache-related issues.

### Goals
- **Cache Hit Rate Target:** > 60%
- **Performance Improvement:** > 40%
- **Memory Usage:** < 512MB
- **Cache TTL:** Default 5 minutes (configurable per model)

---

## Quick Start

### Enable/Disable Caching

```bash
# Enable caching (default)
CACHE_ENABLED=true

# Disable caching
CACHE_ENABLED=false
```

### Configuration

```bash
# Set default TTL (seconds)
CACHE_TTL_SECONDS=300  # 5 minutes

# Set Redis connection
REDIS_URL=redis://localhost:6379

# Set max cache memory (bytes)
CACHE_MAX_MEMORY=536870912  # 512MB

# Set eviction policy
CACHE_EVICTION_POLICY=lru  # or 'lfu', 'fifo'
```

---

## How Caching Works

### Middleware Layers

The caching system consists of two layers in `src/prisma.service.ts`:

1. **Pool Metrics Middleware** - Tracks connection pool health
2. **Caching Middleware** - Caches read queries, invalidates on writes

### Query Cache Flow

```
Application Request
    ↓
Prisma Client Query
    ↓
Cache Middleware
    ├─ Is this a READ operation? (find, count, etc.)
    │  ├─ YES → Check Redis cache
    │  │    ├─ Cache HIT → Return cached result
    │  │    └─ Cache MISS → Query database, cache result
    │  └─ NO (CREATE/UPDATE/DELETE) → Query database, invalidate related caches
    ↓
Result returned to application
```

### Cache Keys

Cache keys are generated deterministically from query details:

```
Format: prisma:cache:{Model}:{Action}:{ArgsHash}

Example:
prisma:cache:CarbonProject:findUnique:abc123def456
prisma:cache:CreditBatch:findMany:xyz789
```

The args hash is SHA-256 of normalized query arguments, ensuring identical queries produce identical cache keys.

---

## Cacheable Models & TTLs

### Default Cacheable Models

| Model | TTL | Reason | Cacheable |
|-------|-----|--------|-----------|
| CarbonProject | 5 min | Frequently read, infrequently updated | ✅ Yes |
| CreditBatch | 5 min | Central to credit operations | ✅ Yes |
| MarketListing | 5 min | High browse volume | ✅ Yes |
| RetirementRecord | 10 min | Moderate read, low update | ✅ Yes |
| PriceApproval | 30 min | Reference data, rarely changes | ✅ Yes |
| ProjectType | 30 min | Taxonomy data | ✅ Yes |
| User | 10 min | Profile lookups | ✅ Yes |
| OracleJob | 1 min | Monitoring data, frequently updated | ✅ Yes |

### Non-Cached Models

These models are not cached for safety/correctness reasons:

- **IdempotencyRecord** - Must reflect latest writes immediately
- **AuditLog** - Audit trail must be queryable real-time
- **WebhookDelivery** - Status must be current for delivery tracking

---

## Cache Invalidation

### Automatic Invalidation

The `CacheInvalidationService` automatically invalidates caches when data changes:

```typescript
// Project creation invalidates:
// - All CarbonProject caches
// - Related CreditBatch caches
// - MarketListing caches

// Credit retirement invalidates:
// - CreditBatch cache
// - RetirementRecord caches

// Marketplace purchase invalidates:
// - MarketListing caches
// - PriceApproval caches
// - Related Project caches
```

### Manual Invalidation

```typescript
import { CacheInvalidationService } from '@/cache/cache-invalidation';

constructor(private cache: CacheInvalidationService) {}

async updateProject(projectId: string) {
  // ... update logic ...
  
  // Invalidate project caches
  await this.cache.invalidateProject(projectId);
}

// Other methods:
await this.cache.invalidateAllProjects();
await this.cache.invalidateBatch(batchId);
await this.cache.invalidateAllListings();
await this.cache.invalidatePricing();
await this.cache.invalidateUser(publicKey);
```

---

## Monitoring Cache Performance

### Metrics Endpoint

```bash
GET /metrics/cache

Response:
{
  "hits": 15234,
  "misses": 3842,
  "errors": 2,
  "total": 19076,
  "hitRate": 79.87,
  "missRate": 20.13,
  "avgResponseTimeMs": 12.3,
  "cacheMemoryUsageBytes": 314572800
}
```

### Per-Model Metrics

```bash
GET /metrics/cache/models

Response:
{
  "CarbonProject": {
    "hits": 5234,
    "misses": 1023,
    "total": 6257,
    "hitRate": 83.6,
    "avgCachedResponseTimeMs": 8.2,
    "avgDatabaseResponseTimeMs": 45.3
  },
  "CreditBatch": {
    "hits": 8901,
    "misses": 2234,
    "total": 11135,
    "hitRate": 79.93,
    "avgCachedResponseTimeMs": 10.1,
    "avgDatabaseResponseTimeMs": 52.1
  }
}
```

### Cache Effectiveness Score

```bash
GET /metrics/cache/effectiveness

Response:
{
  "score": 82.5,  // 0-100
  "recommendation": "Cache configuration is optimal",
  "potential_improvements": []
}
```

---

## Performance Tuning

### Optimal Configuration

**For high-traffic environments:**
```env
CACHE_ENABLED=true
CACHE_TTL_SECONDS=300
CACHE_MAX_MEMORY=1073741824  # 1GB
CACHE_EVICTION_POLICY=lru
```

**For development:**
```env
CACHE_ENABLED=false  # Disable for faster feedback loops
```

**For staging/testing:**
```env
CACHE_ENABLED=true
CACHE_TTL_SECONDS=60  # Shorter TTL for faster testing
```

### Tuning TTL per Model

If hit rate is too low, increase TTL:
```typescript
// In cache.config.ts
CarbonProject: {
  cacheable: true,
  ttlSeconds: 600,  // Increase from 300 to 600
  invalidationTriggers: ['CarbonProject', 'CreditBatch', 'MarketListing'],
}
```

If memory usage is high, decrease TTL or model count:
```typescript
// Reduce TTL
ttlSeconds: 120  // 2 minutes instead of 5

// Or disable caching for a model
cacheable: false
```

---

## Troubleshooting

### Issue: Low Cache Hit Rate (< 50%)

**Symptoms:** Cache metrics show hit rate below 50%

**Root Causes:**
1. **Query variation** - Same data queried with different parameters
2. **High data mutation** - Cache invalidated too frequently
3. **Short TTL** - Cache expires too quickly

**Solutions:**
```typescript
// Check if queries are identical
// Log cache hits/misses per query pattern

// Increase TTL if safe
CarbonProject: {
  ttlSeconds: 600  // 10 minutes
}

// Review invalidation triggers
// May be invalidating too often
```

### Issue: High Memory Usage (> 512MB)

**Symptoms:** Cache memory growing continuously

**Root Causes:**
1. **Large result sets** - Caching big queries
2. **Retention of unused data** - TTL too long
3. **LRU eviction not working** - Redis memory limit issue

**Solutions:**
```bash
# Check Redis info
redis-cli INFO memory

# Monitor per-model size
GET /metrics/cache/models

# Reduce TTL
CACHE_TTL_SECONDS=120  # 2 minutes

# Reduce max memory
CACHE_MAX_MEMORY=268435456  # 256MB

# Explicitly flush cache
POST /metrics/cache/flush
```

### Issue: Stale Data Served

**Symptoms:** Users seeing outdated information after update

**Root Causes:**
1. **Invalidation missed** - Cache not invalidated on update
2. **Update happened before invalidation** - Race condition
3. **Different cache key** - Query params changed

**Solutions:**
```typescript
// Verify invalidation is called
// Add logging to invalidation service

// Use database transaction
await this.prisma.$transaction(async (tx) => {
  const updated = await tx.carbonProject.update({...});
  // Invalidation happens after update
  await this.cache.invalidateProject(projectId);
  return updated;
});

// Increase TTL slightly for stale-while-revalidate pattern
// (Serve stale data while refreshing in background)
```

### Issue: Cache Disabled Not Working

**Symptoms:** Cache configuration changes don't take effect

**Solutions:**
```bash
# Restart application
kubectl rollout restart deployment/api

# Or clear environment and reload
unset CACHE_ENABLED
export CACHE_ENABLED=false
npm start

# Verify cache is disabled
curl http://localhost:3000/metrics/cache
# Should show all zeros or disabled status
```

### Issue: Redis Connection Errors

**Symptoms:** Logs show "Unable to connect to Redis"

**Solutions:**
```bash
# Test Redis connectivity
redis-cli -u $REDIS_URL PING
# Response should be: PONG

# Check Redis URL format
redis://localhost:6379  # Standard
redis://user:pass@localhost:6379  # With auth
redis://localhost:6379/1  # With database

# Monitor Redis memory
redis-cli INFO memory
redis-cli DBSIZE

# Check Redis logs
docker logs <redis-container>
```

---

## Best Practices

### 1. Design for Cache Misses

```typescript
// ❌ Bad: Assume cache always hits
const data = await prisma.carbonProject.findUnique({...});
// Could hit database, don't assume speed

// ✅ Good: Design with cache misses in mind
const data = await prisma.carbonProject.findUnique({...});
// Acceptable latency: 50ms (database) + 5ms (network)
```

### 2. Invalidate Appropriately

```typescript
// ❌ Bad: Invalidate everything
await this.cache.clearAllCache();  // Nuclear option

// ✅ Good: Invalidate specifically
await this.cache.invalidateProject(projectId);
// Other caches remain valid
```

### 3. Monitor Regularly

```typescript
// Add to health checks
const cacheMetrics = await this.cacheMetrics.getOverallStats();
if (cacheMetrics.hitRate < 50) {
  logger.warn('Cache hit rate low', cacheMetrics);
}
```

### 4. Test Cache Behavior

```typescript
// Unit test: verify cache invalidation
it('should invalidate project cache on update', async () => {
  const project = await prisma.carbonProject.create({...});
  const cached1 = await prisma.carbonProject.findUnique({...});
  // Cache hit
  
  await prisma.carbonProject.update({...});
  // Cache invalidated
  
  const cached2 = await prisma.carbonProject.findUnique({...});
  // Cache miss, fetches from database
  expect(cached2).toEqual(updated);
});
```

### 5. Document Cache Assumptions

```typescript
/**
 * @description Gets project with up-to-date pricing
 * 
 * NOTE: Uses query cache with 5-minute TTL.
 * Price updates may be delayed up to 5 minutes.
 * For real-time pricing, use findUnique directly.
 */
async getProjectWithPricing(projectId: string) {
  // ...
}
```

---

## Operations

### Daily Checks

```bash
# Monitor cache hit rate
curl http://api.carbonledger.io/metrics/cache | grep hitRate

# Check memory usage
curl http://api.carbonledger.io/metrics/cache | grep memory

# Verify no errors
curl http://api.carbonledger.io/metrics/cache | grep errors
# Should be 0 or very low
```

### Weekly Maintenance

```bash
# Analyze cache effectiveness
npm run cache:analyze

# Review slow queries (not cached)
npm run cache:slow-queries

# Check invalidation effectiveness
npm run cache:invalidation-audit
```

### Monthly Optimization

```bash
# Review cache hit rate trends
npm run cache:trends

# Identify candidates for caching
npm run cache:candidates

# Optimize TTL settings
npm run cache:optimize-ttl
```

---

## Performance Benchmarks

### Expected Performance

| Query Type | Without Cache | With Cache | Improvement |
|------------|---------------|-----------|-------------|
| findUnique | 45ms | 8ms | 82% faster |
| findMany (10 items) | 52ms | 10ms | 81% faster |
| count | 38ms | 5ms | 87% faster |
| aggregate | 120ms | 12ms | 90% faster |

### Cache Hit Rate by Model

| Model | Target | Typical | Range |
|-------|--------|---------|-------|
| CarbonProject | > 60% | 83% | 70-90% |
| CreditBatch | > 60% | 79% | 65-85% |
| MarketListing | > 60% | 81% | 75-87% |
| User | > 60% | 72% | 60-80% |

---

## FAQ

**Q: Can I cache sensitive data?**
A: Yes, but ensure Redis connection is encrypted and access controlled.

**Q: What if cache and database conflict?**
A: Cache invalidation should handle this. If issues persist, disable caching and investigate.

**Q: How long until cache is consistent?**
A: Default TTL is 5 minutes. Invalidation is immediate for mutations.

**Q: Can I cache JOIN queries?**
A: Yes, Prisma handles JOIN caching transparently.

**Q: Is caching enabled by default?**
A: Yes, it's enabled in production (CACHE_ENABLED=true).

---

## Support

For cache-related issues:
1. Check metrics: `/metrics/cache`
2. Review logs: Look for "PrismaCacheMiddleware"
3. Contact SRE team with metrics export
4. Disable caching if urgent: `CACHE_ENABLED=false`

---

**Next Review:** August 28, 2027

