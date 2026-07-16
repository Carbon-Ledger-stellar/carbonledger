# Zero-Downtime Deployment

CarbonLedger uses a **rolling deployment** strategy so the API stays available during every release.

## Strategy

| Concern | Approach |
|---------|----------|
| Deployment type | Rolling (one replica replaced at a time) |
| Health gate | New container must pass `/health` before old one stops |
| Rollback time | < 5 minutes (automated on failure) |
| DB migrations | Run before containers are replaced (`prisma migrate deploy`) |

## Files

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Production overlay — rolling update config, replica counts |
| `scripts/deploy.sh` | Orchestrates pull → migrate → rolling replace → smoke test |
| `backend/src/main.ts` | Exposes `GET /health` used by Docker health checks |

## Deployment Procedure

```bash
# 1. Set environment variables
cp .env.example .env
# edit .env with production values

# 2. Run the deployment script
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

The script will:
1. Pull the latest images
2. Run Prisma migrations (zero-downtime — additive only)
3. Start a second backend replica with the new image
4. Wait for it to pass the health check
5. Remove the old replica
6. Repeat for frontend
7. Run a smoke test against `/health`
8. Automatically rollback if any step fails

## Rollback

Rollback is automatic on failure. To trigger manually:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml rollback backend
```

Manual rollback completes in under 5 minutes because the previous image is still cached locally.

## Health Check Endpoint

```
GET /health
→ 200 { "status": "ok", "timestamp": "..." }
```

Docker waits for this to return 200 before routing traffic to a new container.

## Migration Safety Rules

- All migrations must be **additive** (no column drops, no renames) to support running old and new code simultaneously during the rollover window.
- Destructive changes must be split across two releases: first add the new column, then (in a later release) drop the old one.

## Resource Limits

Every service has memory and CPU limits to prevent a runaway process from consuming all host resources. The defaults are sized for the shared testnet environment.

| Service | Memory limit | CPU limit | Memory reservation | CPU reservation |
|---------|-------------|-----------|-------------------|-----------------|
| backend | 512 MB | 0.75 cores | 128 MB | 0.25 cores |
| frontend | 256 MB | 0.50 cores | 64 MB | 0.10 cores |
| postgres | 1 GB | 1.00 cores | 256 MB | 0.25 cores |
| redis-primary / replica / sentinel | 256 MB each | 0.25 cores | 32 MB | 0.05 cores |
| oracle_verification / price / satellite | 256 MB each | 0.50 cores | 64 MB | 0.10 cores |
| loki / promtail / grafana | 256 MB each | 0.25 cores | 64 MB | 0.05 cores |

Limits are set via `deploy.resources` in `docker-compose.yml` and are fully configurable through environment variables — no compose file edits needed.

### Adjusting limits for your environment

Override any limit in your `.env` file before running `docker compose up`:

```bash
# Example: give postgres more headroom on a production host
POSTGRES_MEM_LIMIT=4g
POSTGRES_CPU_LIMIT=2.00
```

See `.env.example` for the full list of `*_MEM_LIMIT`, `*_CPU_LIMIT`, `*_MEM_RESERVATION`, and `*_CPU_RESERVATION` variables.

> **Note:** `deploy.resources` is honoured by `docker compose` (v2) without Swarm mode. It is ignored by the legacy `docker-compose` (v1) binary.

## Monitoring Resource Usage

### Live stats

```bash
# All services — refreshes every second
docker stats

# Specific services only
docker stats carbonledger-backend-1 carbonledger-postgres-1
```

Example output on the testnet stack at idle:

```
CONTAINER                          CPU %   MEM USAGE / LIMIT   MEM %   NET I/O         BLOCK I/O
carbonledger-backend-1             0.4%    148MiB / 512MiB     28.9%   12.3MB / 8.1MB  0B / 4.2MB
carbonledger-frontend-1            0.1%    72MiB / 256MiB      28.1%   2.1MB / 0.9MB   0B / 1.1MB
carbonledger-postgres-1            0.2%    312MiB / 1GiB       30.5%   5.4MB / 3.2MB   0B / 18MB
carbonledger-redis-primary-1       0.1%    8MiB / 256MiB       3.1%    1.2MB / 0.8MB   0B / 0B
carbonledger-redis-replica-1       0.1%    7MiB / 256MiB       2.7%    0.9MB / 0.6MB   0B / 0B
carbonledger-redis-sentinel-1      0.0%    6MiB / 256MiB       2.3%    0.4MB / 0.3MB   0B / 0B
carbonledger-oracle_verification-1 0.0%    45MiB / 256MiB      17.6%   0.3MB / 0.1MB   0B / 0B
carbonledger-oracle_price-1        0.0%    42MiB / 256MiB      16.4%   0.2MB / 0.1MB   0B / 0B
carbonledger-oracle_satellite-1    0.0%    44MiB / 256MiB      17.2%   0.1MB / 0.1MB   0B / 0B
carbonledger-loki-1                0.1%    98MiB / 256MiB      38.3%   1.1MB / 0.5MB   0B / 2.1MB
carbonledger-promtail-1            0.0%    28MiB / 256MiB      10.9%   0.8MB / 0.4MB   0B / 0B
carbonledger-grafana-1             0.1%    85MiB / 256MiB      33.2%   0.6MB / 0.3MB   0B / 1.4MB
```

### Interpreting the output

| Column | What to watch for |
|--------|------------------|
| CPU % | Sustained >80% on a single service — consider raising `*_CPU_LIMIT` or scaling horizontally |
| MEM USAGE / LIMIT | Usage consistently above 80% of the limit risks OOM kills — raise `*_MEM_LIMIT` |
| MEM % | Quick view of headroom; >90% is a warning sign |
| NET I/O | Unexpected spikes may indicate a runaway oracle poll or a DDoS |

### One-shot snapshot (no live refresh)

```bash
docker stats --no-stream
```

Useful in scripts or CI to capture a baseline after deployment.