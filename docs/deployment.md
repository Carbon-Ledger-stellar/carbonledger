# Zero-Downtime Deployment

CarbonLedger uses a **rolling deployment** strategy so the API stays available during every release.

## Strategy

| Concern | Approach |
|---------|----------|
| Deployment type | Rolling (one replica replaced at a time) |
| Canary stages | 5%, 25%, 50%, 100% with configurable thresholds |
| Health gate | New container must pass `/health` before old one stops |
| Rollback time | < 5 minutes (automated on failure) |
| DB migrations | Run before containers are replaced (`prisma migrate deploy`) |
| Rollout window | 30 minutes maximum before automatic rollback |

## Canary rollout policy

CarbonLedger’s deployment automation now enforces a staged canary rollout using the existing zero-downtime rolling strategy:

- `CANARY_STAGES` defaults to `5,25,50,100`
- `CANARY_ERROR_THRESHOLD` defaults to `4%`
- `CANARY_MAX_DURATION_SECONDS` defaults to `1800` (30 minutes)
- Grafana stays open during the rollout at `http://localhost:3200` for live metrics review
- A failed health check or error-rate threshold breach triggers a rollback before the next stage is promoted

This fits the project architecture because the repo already has `docker-compose` health checks and a Grafana/Loki stack, but it does not currently have an edge-level traffic splitter or service-mesh routing. The safe implementation is therefore to gate each progressive stage with the existing health and monitoring infrastructure rather than inventing a new ingress layer that the project does not deploy.

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
