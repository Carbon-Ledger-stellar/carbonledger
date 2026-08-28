# Prisma Connection Pool Configuration

## Overview

CarbonLedger uses Prisma's built-in connection pool (via `libquery`) to manage PostgreSQL connections. Unbounded connections exhaust `max_connections` on the database server; this configuration enforces safe limits for production.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DB_POOL_MAX` | `10` | Maximum open connections per Prisma instance |
| `DB_POOL_TIMEOUT_MS` | `10000` | Milliseconds to wait for a free slot before throwing `P2024` |
| `DB_CONNECT_TIMEOUT_S` | `10` | Seconds to wait when opening a new TCP connection |

These are appended to `DATABASE_URL` as query parameters (`connection_limit`, `pool_timeout`, `connect_timeout`) and also passed to the `PrismaClient` constructor so both the URL and the client agree.

## Sizing Guidelines

```
DB_POOL_MAX = (num_cores × 2) + 1
```

Cap at: `pg max_connections / number_of_backend_replicas − 5` (leave headroom for migrations and admin tools).

| Deployment | Recommended `DB_POOL_MAX` |
|---|---|
| Single replica, 2-core | 5 |
| Single replica, 4-core | 10 (default) |
| 3 replicas, 4-core each | 10 (30 total, safe under pg default 100) |
| High-traffic, dedicated DB | 20–25 |

## Pool Metrics Endpoint

```
GET /api/v1/health/pool
```

Response:

```json
{
  "pool_max": 10,
  "pool_timeout_ms": 10000,
  "connect_timeout_s": 10,
  "active_queries": 3,
  "total_queries": 14821,
  "pool_timeout_errors": 0
}
```

`pool_timeout_errors` counts `P2024` errors (pool exhausted). Alert if this is non-zero in production.

## Load Testing

The spec `src/prisma.pool.spec.ts` fires 500 concurrent `SELECT 1` queries and asserts ≤1% failure rate:

```bash
cd backend
DATABASE_URL=postgresql://... DB_POOL_MAX=10 npx jest --testPathPattern=prisma.pool
```

Expected output with `DB_POOL_MAX=10`: all 500 queries succeed (they queue behind the pool and drain within `pool_timeout`).

## Error Handling

Prisma throws `PrismaClientKnownRequestError` with code `P2024` when the pool is exhausted and `pool_timeout` expires. Callers should catch this and return HTTP 503.

## References

- [Prisma connection pool docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool)
- [PostgreSQL max_connections](https://www.postgresql.org/docs/current/runtime-config-connection.html)
