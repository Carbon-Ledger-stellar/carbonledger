# Performance Optimization Guide

This guide covers common performance bottlenecks in the CarbonLedger backend and the solutions implemented to address them.

## Table of Contents

1. [Common Performance Bottlenecks](#common-performance-bottlenecks)
2. [Caching Strategy](#caching-strategy)
3. [Database Indexing](#database-indexing)
4. [Query Optimization](#query-optimization)
5. [Tools & Monitoring](#tools--monitoring)
6. [Benchmarking](#benchmarking)
7. [Troubleshooting](#troubleshooting)

---

## Common Performance Bottlenecks

### 1. **Repeated Database Queries for Read-Heavy Operations**
- **Symptom**: Slow response times for frequently accessed project listings, prices, and marketplace data.
- **Root Cause**: Each request queries the database without caching, causing unnecessary database load.
- **Impact**: High latency on read operations, increased database connections.

### 2. **Missing or Inefficient Database Indexes**
- **Symptom**: Query timeouts or slow queries on filtered/sorted operations.
- **Root Cause**: Queries scan entire tables instead of using indexes.
- **Impact**: Slow filtering by status, country, vintage year; O(n) scans instead of O(log n) lookups.

### 3. **N+1 Query Problems**
- **Symptom**: Multiplied queries when fetching related data.
- **Root Cause**: Fetching parent records then querying for each child record.
- **Impact**: 100 projects = 100+ additional queries for related batches/listings.

### 4. **Inefficient Joins Without Proper Indexes**
- **Symptom**: Slow paginated queries that join multiple tables.
- **Root Cause**: Join operations on fields without indexes.
- **Impact**: Exponential slowdown as dataset grows.

### 5. **Large Result Sets Without Pagination**
- **Symptom**: Memory spikes, timeouts on bulk operations.
- **Root Cause**: Fetching all records instead of pagination.
- **Impact**: OOM errors, network timeouts.

---

## Caching Strategy

### 2.1 Redis Caching Architecture

We use Redis as a distributed cache with graceful degradation. If Redis is unavailable, the system continues to function by querying the database directly.

#### Cache Layers

| Layer | Data | TTL | Invalidation | Use Case |
|-------|------|-----|--------------|----------|
| L1: Project Listings | Paginated project results | 5 min | On project update/delete | Browse/filter projects |
| L2: Market Prices | Aggregated pricing data | 5 min | On listing creation/update | Price discovery |
| L3: Project Detail | Single project metadata | 10 min | On project update | Project detail pages |
| L4: Verification Cache | Batch/credit verification | 30 min | On batch status change | Credit validation |

### 2.2 Cache Key Strategy

```
project:listing:{filters_hash}     // Project list with filters
project:detail:{projectId}         // Single project details
market:prices:{vintage}_{status}   // Market price aggregates
batch:verification:{batchId}       // Batch verification state
```

### 2.3 Cache Hit/Miss Strategy

**Target**: > 70% cache hit rate for listing operations

```javascript
// Pseudocode pattern
const cacheKey = `project:listing:${hashFilters(filters)}`;
const cached = await redis.get(cacheKey);
if (cached) {
  return cached; // Cache hit
}

// Cache miss - query database
const result = await db.query();
await redis.set(cacheKey, result, TTL_5_MIN);
return result;
```

### 2.4 Cache Invalidation on Mutations

```javascript
// When project is updated/deleted
await redis.del(`project:detail:${projectId}`);
await redis.delByPattern(`project:listing:*`); // Invalidate all listings

// When listing is created/updated
await redis.del(`market:prices:*`);
await redis.delByPattern(`project:listing:*`);

// When batch status changes
await redis.del(`batch:verification:${batchId}`);
await redis.delByPattern(`project:listing:*`);
```

### 2.5 Fallback Behavior

If Redis is unavailable:
- Cache reads return `null`
- Cache writes silently fail (`return false`)
- Application continues to work with direct database queries
- Logs warn about degraded performance

```javascript
// Example from RedisService
async get<T>(key: string): Promise<T | null> {
  if (!this.connected || !this.client) return null; // Graceful degradation
  try {
    const raw = await this.client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    this.logger.warn(`Redis GET failed: ${err.message}`);
    return null; // Return null, let caller fall back to DB
  }
}
```

---

## Database Indexing

### 3.1 Index Analysis

#### Critical Queries to Index

1. **Project Listing with Filters**
   ```sql
   SELECT * FROM "CarbonProject" 
   WHERE status = ? AND methodology = ? AND country = ?
   ORDER BY createdAt DESC
   LIMIT ? OFFSET ?
   ```

2. **Market Listing Browse**
   ```sql
   SELECT * FROM "MarketListing"
   WHERE status = ? AND methodology = ? AND vintageYear = ?
   ORDER BY pricePerCredit ASC
   LIMIT ? OFFSET ?
   ```

3. **Credit Batch Lookup**
   ```sql
   SELECT * FROM "CreditBatch"
   WHERE projectId = ? AND status = ?
   ORDER BY issuedAt DESC
   ```

4. **Retirement Records by User**
   ```sql
   SELECT * FROM "RetirementRecord"
   WHERE retiredBy = ?
   ORDER BY retiredAt DESC
   LIMIT ? OFFSET ?
   ```

### 3.2 Proposed Index Strategy

#### New Indexes to Add

| Table | Index Columns | Reason | Expected Improvement |
|-------|---------------|--------|----------------------|
| `CarbonProject` | `(status, createdAt)` | Browse/filter projects | +50% query time |
| `CarbonProject` | `(country, status)` | Regional filtering | +40% query time |
| `CreditBatch` | `(projectId, status)` | Batch lookups | +45% query time |
| `MarketListing` | `(status, createdAt DESC)` | Listing browsing | +55% query time |
| `MarketListing` | `(methodology, vintageYear, status)` | Filtered search | +60% query time |
| `RetirementRecord` | `(retiredBy, retiredAt DESC)` | User retirement history | +50% query time |

### 3.3 Current Index Status

```prisma
// CarbonProject - Already has:
@@index([status])
@@index([createdAt])
@@index([methodology, country, status])

// Recommended additions:
@@index([status, createdAt])  // Optimize ORDER BY createdAt DESC
@@index([country, status])     // Regional + status filtering
```

### 3.4 Index Creation

```sql
-- Create new indexes
CREATE INDEX idx_carbon_project_status_created_at ON "CarbonProject"(status, "createdAt" DESC);
CREATE INDEX idx_carbon_project_country_status ON "CarbonProject"(country, status);
CREATE INDEX idx_credit_batch_project_status ON "CreditBatch"("projectId", status);
CREATE INDEX idx_market_listing_status_created_at ON "MarketListing"(status, "createdAt" DESC);
CREATE INDEX idx_retirement_retired_by_at ON "RetirementRecord"("retiredBy", "retiredAt" DESC);

-- Verify index creation
SELECT schemaname, tablename, indexname FROM pg_indexes 
WHERE tablename IN ('CarbonProject', 'CreditBatch', 'MarketListing', 'RetirementRecord');
```

### 3.5 Index Maintenance

- **Monitor**: Use `EXPLAIN ANALYZE` on slow queries
- **Analyze**: Run `ANALYZE` after bulk operations
- **Reindex**: Periodic `REINDEX` during maintenance windows
- **Monitor Bloat**: Check index size growth vs. table size

---

## Query Optimization

### 4.1 Query Patterns

#### Pattern 1: Paginated Listing with Filters
```javascript
// ✅ GOOD: Indexed, paginated
const projects = await prisma.carbonProject.findMany({
  where: {
    status: filter.status,
    country: filter.country,
    deletedAt: null,
  },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: offset,
  select: { id: true, name: true, status: true, createdAt: true },
});

// ❌ BAD: No pagination, fetches everything
const projects = await prisma.carbonProject.findMany({
  where: { status: 'Active' },
});
```

#### Pattern 2: Batch Lookups
```javascript
// ✅ GOOD: Specific fields, index on projectId
const batches = await prisma.creditBatch.findMany({
  where: { projectId, status: 'Active' },
  select: { id: true, batchId: true, amount: true },
});

// ❌ BAD: Fetches all fields including large JSON
const batches = await prisma.creditBatch.findMany({
  where: { projectId },
});
```

#### Pattern 3: Count Queries
```javascript
// ✅ GOOD: Use count() for aggregates
const count = await prisma.carbonProject.count({
  where: { status: 'Active', country: 'Kenya' },
});

// ❌ BAD: Fetch all and count in memory
const projects = await prisma.carbonProject.findMany({ where: { ... } });
const count = projects.length;
```

### 4.2 Prisma Best Practices

| Pattern | Benefit | Example |
|---------|---------|---------|
| `select` | Fetch only needed fields | Reduces network, JSON parse time by 30-50% |
| `take/skip` | Pagination | Limits memory usage, enables cursor pagination |
| `count()` | Efficient aggregates | O(1) instead of O(n) |
| Parallel `Promise.all()` | Concurrent queries | Reduces waterfall latency |

### 4.3 Connection Pooling

Current configuration in `src/prisma.service.ts`:
```typescript
// Pool settings
maxConnections: 20          // Max simultaneous connections
minConnections: 5           // Minimum pool size
connectionTimeoutMillis: 2000
idleConnectionTimeoutMillis: 30000
```

---

## Tools & Monitoring

### 5.1 Built-in Monitoring

#### RedisService Status
```typescript
// Check Redis connection
if (redisService.isConnected) {
  console.log('Cache available');
} else {
  console.log('Cache unavailable - database fallback active');
}
```

#### Query Performance Logging
```typescript
// Log slow queries (configured in .env)
QUERY_SLOW_THRESHOLD_MS=500  // Log queries > 500ms
```

#### Metrics Collected
- Cache hit/miss ratio
- Query execution time
- Database connection pool usage
- Memory usage

### 5.2 Recommended Tools

| Tool | Purpose | How to Use |
|------|---------|-----------|
| `redis-cli` | Monitor cache | `redis-cli --stat` |
| `EXPLAIN ANALYZE` | Query planner | `EXPLAIN ANALYZE SELECT...` |
| `pg_stat_statements` | Database stats | Query `pg_stat_statements` view |
| New Relic / Datadog | APM | Configure APM integration |
| `top` / `htop` | System resources | Monitor memory, CPU |

### 5.3 Health Checks

```bash
# Check Redis
redis-cli ping
# Response: PONG

# Check Database
psql $DATABASE_URL -c "SELECT 1;"
# Response: 1

# Check indices
psql $DATABASE_URL -c "
  SELECT tablename, indexname FROM pg_indexes 
  WHERE tablename IN ('CarbonProject', 'CreditBatch', 'MarketListing');
"
```

---

## Benchmarking

### 6.1 Benchmark Methodology

#### Setup
1. Clean database with 10,000+ projects, 50,000+ listings
2. Warm cache with typical queries
3. Run tests 5x, record median time
4. Measure: time, memory, DB connections

#### Metrics
- **Latency**: Response time in ms
- **Throughput**: Requests/second
- **Cache Hit Rate**: (Hits / Total) %
- **Memory**: Peak heap size during test

### 6.2 Baseline Performance (Before Optimization)

```
Project List (1000 items):      450ms  |  Cache Hit: 0%   | Memory: 45MB
Market Browse (500 listings):    380ms  |  Cache Hit: 0%   | Memory: 32MB
Project Detail:                  120ms  |  Cache Hit: 0%   | Memory: 8MB
Batch Lookup (50 per project):   890ms  |  Cache Hit: 0%   | Memory: 78MB
```

### 6.3 Expected Performance (After Optimization)

```
Project List (cached):            45ms  |  Cache Hit: 85%  | Memory: 8MB
Market Browse (cached):           38ms  |  Cache Hit: 90%  | Memory: 5MB
Project Detail (cached):           5ms  |  Cache Hit: 92%  | Memory: 1MB
Batch Lookup (indexed):          200ms  |  Cache Hit: 0%   | Memory: 18MB
```

### 6.4 Running Benchmarks

```bash
# Run performance tests
npm run test -- src/projects/projects.performance.spec.ts

# Run with coverage
npm run test:coverage -- src/projects/projects.performance.spec.ts

# Profile specific service
npm run test -- src/redis.service.spec.ts --verbose
```

---

## Troubleshooting

### Issue 1: Low Cache Hit Rate

**Symptoms**: Cache hit rate < 50%

**Diagnosis**:
```bash
# Check Redis
redis-cli info stats
# Look for: hits, misses ratio

# Check cache keys
redis-cli KEYS "project:*" | wc -l
```

**Solutions**:
1. Increase TTL for stable data (10-15 min for project details)
2. Expand cache key patterns to catch more queries
3. Check filter variability - too many unique filter combinations?
4. Validate Redis is connected: `redisService.isConnected`

### Issue 2: Slow Queries Despite Indexes

**Symptoms**: Query still takes > 500ms

**Diagnosis**:
```sql
EXPLAIN ANALYZE 
SELECT * FROM "CarbonProject" 
WHERE status = 'Active' AND country = 'Kenya'
ORDER BY createdAt DESC
LIMIT 20;

-- Look for "Sequential Scan" - index not being used
```

**Solutions**:
1. Run `ANALYZE CarbonProject;` to update statistics
2. Check if filter is too selective (e.g., returns 1% of rows)
3. Verify index was actually created: `\d CarbonProject`
4. Consider composite index if using multiple filters

### Issue 3: Cache Invalidation Issues

**Symptoms**: Stale data being served

**Diagnosis**:
```typescript
// Check if invalidation ran
const keys = await redis.delByPattern('project:listing:*');
console.log(`Invalidated ${keys.length} keys`);
```

**Solutions**:
1. Verify mutation handlers call cache invalidation
2. Check Redis connectivity during invalidation
3. Add logging to mutation endpoints
4. Implement manual cache clear endpoint for debugging

### Issue 4: High Memory Usage

**Symptoms**: Memory grows continuously

**Diagnosis**:
```bash
# Check top memory consumers
redis-cli INFO memory
# Look for: used_memory_human, peak_memory_human

# Check key count
redis-cli DBSIZE
```

**Solutions**:
1. Reduce TTL for cache entries
2. Implement cache size limits with eviction policy: `maxmemory-policy allkeys-lru`
3. Use smaller selection fields in queries (avoid fetching large JSON)
4. Implement cache cleanup jobs for expired keys

### Issue 5: Database Connection Pool Exhaustion

**Symptoms**: "Cannot acquire a database connection" errors

**Diagnosis**:
```sql
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
SELECT max_conn FROM pg_database WHERE datname = current_database();
```

**Solutions**:
1. Increase `maxConnections` in Prisma config
2. Reduce connection timeout
3. Implement query timeouts
4. Profile for long-running queries holding connections
5. Use connection pooling middleware (PgBouncer)

---

## Performance Checklist

- [ ] Redis is configured and connected (`REDIS_URL` in `.env`)
- [ ] Caching middleware is enabled on read endpoints
- [ ] New indexes are created and analyzed
- [ ] Pagination is implemented on all list endpoints
- [ ] Slow queries are logged (`QUERY_SLOW_THRESHOLD_MS`)
- [ ] Cache invalidation is implemented for all mutations
- [ ] Cache hit rate is monitored (target > 70%)
- [ ] Database statistics are analyzed regularly
- [ ] Connection pool is sized appropriately
- [ ] Fallback behavior works when Redis is down

---

## Additional Resources

- [Redis Documentation](https://redis.io/documentation)
- [Prisma Query Optimization](https://www.prisma.io/docs/guides/performance-and-optimization)
- [PostgreSQL Query Planning](https://www.postgresql.org/docs/current/using-explain.html)
- [Database Indexing Best Practices](https://use-the-index-luke.com/)

