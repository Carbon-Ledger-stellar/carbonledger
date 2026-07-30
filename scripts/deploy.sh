#!/usr/bin/env bash
# scripts/deploy.sh — zero-downtime rolling deployment for CarbonLedger
# Requires: docker compose v2, jq
set -euo pipefail

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
HEALTH_URL="http://localhost:3001/health"
ROLLBACK_TIMEOUT=300   # 5 minutes

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

wait_healthy() {
  local service=$1 retries=18
  log "Waiting for $service to be healthy..."
  for i in $(seq 1 $retries); do
    if $COMPOSE ps "$service" | grep -q "healthy"; then
      log "$service is healthy."
      return 0
    fi
    sleep 10
  done
  log "ERROR: $service did not become healthy in time."
  return 1
}

rollback() {
  log "Rolling back to previous image..."
  $COMPOSE rollback backend 2>/dev/null || $COMPOSE up -d --no-deps backend
  log "Rollback complete."
  exit 1
}

trap rollback ERR

log "Pulling latest images..."
$COMPOSE pull backend frontend

log "Running database migrations..."
$COMPOSE run --rm backend sh -c "npx prisma migrate deploy"

log "Deploying backend (rolling)..."
$COMPOSE up -d --no-deps --scale backend=2 backend
wait_healthy backend

log "Deploying frontend (rolling)..."
$COMPOSE up -d --no-deps --scale frontend=2 frontend
wait_healthy frontend

log "Smoke test..."
HTTP_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$HEALTH_URL" || echo "000")
if [ "$HTTP_STATUS" != "200" ]; then
  log "Smoke test failed (HTTP $HTTP_STATUS)."
  rollback
fi

log "Deployment complete. All services healthy."
