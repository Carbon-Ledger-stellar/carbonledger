# Docker Compose — Full Local Stack

Complete guide for running CarbonLedger locally with Docker Compose.

## Quick Start

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Start all services
docker-compose up --build

# 3. Verify all services are healthy
docker-compose ps
```

All services will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001/api/v1
- **Grafana**: http://localhost:3200 (admin/admin)
- **Loki**: http://localhost:3100
- **Satellite Monitor**: http://localhost:5001

## Services Overview

### Infrastructure Layer

| Service | Port | Purpose | Health Check |
|---------|------|---------|--------------|
| PostgreSQL | 5432 | Primary database | `pg_isready` |
| Redis Primary | 6379 | Cache & job queue | `redis-cli ping` |
| Redis Replica | - | HA failover | `redis-cli ping` |
| Redis Sentinel | 26379 | HA orchestration | `redis-cli ping` |

### Application Layer

| Service | Port | Purpose | Health Check |
|---------|------|---------|--------------|
| Backend (NestJS) | 3001 | REST API | `GET /health/ready` |
| Frontend (Next.js) | 3000 | Web UI | HTTP 200 |
| Oracle Verification | - | Project verification | Process check |
| Oracle Price | - | Price feeds | Process check |
| Oracle Satellite | 5001 | Satellite webhooks | `GET /health` |

### Observability Layer

| Service | Port | Purpose |
|---------|------|---------|
| Loki | 3100 | Log aggregation |
| Promtail | - | Log shipper |
| Grafana | 3200 | Dashboards & alerts |

## Environment Configuration

### Required Variables

Copy `.env.example` to `.env` and fill in:

```bash
# Stellar Network
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# Contract IDs (after deployment)
CARBON_REGISTRY_CONTRACT_ID=C...
CARBON_CREDIT_CONTRACT_ID=C...
CARBON_MARKETPLACE_CONTRACT_ID=C...
CARBON_ORACLE_CONTRACT_ID=C...
USDC_CONTRACT_ID=C...

# Oracle Keypair
ORACLE_SECRET_KEY=S...
ORACLE_PUBLIC_KEY=G...

# Admin Keypair
ADMIN_SECRET_KEY=S...
ADMIN_PUBLIC_KEY=G...

# Database
POSTGRES_PASSWORD=<secure-password>

# Auth
JWT_SECRET=<random-secret>

# Optional: API Keys
XPANSIV_API_KEY=
TOUCAN_API_KEY=
GOLD_STANDARD_API_KEY=
VERRA_VCS_API_KEY=
```

### Default Values

Services use sensible defaults for local development:
- PostgreSQL: `carbonledger:changeme@localhost:5432/carbonledger`
- Redis: No password (set `REDIS_PASSWORD` to enable)
- Stellar Network: Testnet
- Log Level: `info`

## Startup Sequence

Docker Compose automatically manages startup order via `depends_on`:

```
PostgreSQL ✓
    ↓
Redis Primary ✓
    ↓
Redis Replica ✓
    ↓
Redis Sentinel ✓
    ↓
Backend (migrations run) ✓
    ↓
Frontend ✓
    ↓
Oracle Services ✓
    ↓
Loki ✓
    ↓
Promtail ✓
    ↓
Grafana ✓
```

## Health Checks

All services include health checks. Monitor status:

```bash
# Watch all services
docker-compose ps

# Check specific service
docker-compose ps backend

# View logs with health status
docker-compose logs --follow backend
```

Health check intervals:
- **PostgreSQL**: 10s (5 retries)
- **Redis**: 10s (5 retries)
- **Backend**: 15s (3 retries, 30s start period)
- **Frontend**: Implicit (depends on backend)
- **Oracle Services**: 30s (3 retries, 10s start period)
- **Loki**: 10s (5 retries)

## Data Persistence

PostgreSQL and Grafana data are persisted in Docker volumes:

```bash
# List volumes
docker volume ls | grep carbonledger

# Inspect volume
docker volume inspect carbonledger_postgres_data

# Backup database
docker-compose exec postgres pg_dump -U carbonledger carbonledger > backup.sql

# Restore database
docker-compose exec -T postgres psql -U carbonledger carbonledger < backup.sql
```

## Common Operations

### View Logs

```bash
# All services
docker-compose logs --follow

# Specific service
docker-compose logs --follow backend

# Last 100 lines
docker-compose logs --tail=100 backend

# Timestamp format
docker-compose logs --timestamps backend
```

### Execute Commands

```bash
# Run Prisma migrations
docker-compose exec backend npx prisma migrate dev

# Access PostgreSQL
docker-compose exec postgres psql -U carbonledger -d carbonledger

# Access Redis
docker-compose exec redis-primary redis-cli

# Run backend tests
docker-compose exec backend npm test

# Run frontend tests
docker-compose exec frontend npm test
```

### Restart Services

```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart backend

# Restart and rebuild
docker-compose up --build backend
```

### Stop and Clean

```bash
# Stop all services (keep volumes)
docker-compose stop

# Stop and remove containers
docker-compose down

# Remove everything including volumes
docker-compose down -v

# Remove images too
docker-compose down -v --rmi all
```

## Troubleshooting

### Backend fails to start

```bash
# Check logs
docker-compose logs backend

# Verify database connection
docker-compose exec backend npm run typeorm migration:show

# Reset migrations
docker-compose exec backend npx prisma migrate reset
```

### PostgreSQL won't start

```bash
# Check volume
docker volume inspect carbonledger_postgres_data

# Remove and recreate
docker-compose down -v
docker-compose up postgres
```

### Redis connection issues

```bash
# Check Redis status
docker-compose exec redis-primary redis-cli ping

# Check Sentinel
docker-compose exec redis-sentinel redis-cli -p 26379 ping

# View Sentinel config
docker-compose exec redis-sentinel redis-cli -p 26379 info
```

### Oracle services not connecting

```bash
# Check network
docker network ls | grep carbonledger

# Verify DNS resolution
docker-compose exec oracle_verification ping backend

# Check environment variables
docker-compose exec oracle_verification env | grep STELLAR
```

### Grafana not showing logs

```bash
# Verify Loki is healthy
docker-compose logs loki

# Check Promtail is shipping logs
docker-compose logs promtail

# Verify Grafana datasource
# Visit http://localhost:3200 → Configuration → Data Sources → Loki
```

## Performance Tuning

### Database Connection Pool

Adjust in `.env`:
```bash
DB_POOL_MAX=20          # Increase for high concurrency
DB_POOL_TIMEOUT_MS=5000 # Reduce timeout for faster failures
DB_CONNECT_TIMEOUT_S=5  # Reduce connection timeout
```

### Redis Memory

```bash
# Increase Redis memory limit
docker-compose exec redis-primary redis-cli CONFIG SET maxmemory 512mb
```

### Log Rotation

Logs are rotated automatically:
- Max size: 10MB per file
- Max files: 3 per service

## Network Configuration

Services communicate via Docker network `carbonledger_default`:

```
Frontend (3000) → Backend (3001) → PostgreSQL (5432)
                                 → Redis (6379)
                                 → Loki (3100)

Oracle Services → Backend (3001)
                → PostgreSQL (5432)
                → Stellar RPC (external)

Grafana (3200) → Loki (3100)
```

## Production Considerations

For production deployment, see:
- [Deployment Guide](./deployment.md)
- [Infrastructure as Code](../infra/README.md)
- [Security Guide](../SECURITY.md)

## Support

For issues:
1. Check logs: `docker-compose logs --follow`
2. Review [Troubleshooting Guide](./TROUBLESHOOTING.md)
3. Open an issue with logs attached
