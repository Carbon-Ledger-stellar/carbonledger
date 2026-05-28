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
