# Deployment Guide

## Overview

The Carbon Ledger project uses GitHub Actions for continuous deployment.

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Staging | staging.carbonledger.com | Pre-production testing |
| Production | carbonledger.com | Live production |

## Deployment Process

1. **Push to main** → Triggers workflow
2. **Tests** → Lint, unit tests, contract tests
3. **Build** → Docker images built and pushed
4. **Migrations** → Database migrations run
5. **Staging deploy** → Deploy to staging environment
6. **Production deploy** → Deploy to production (if staging succeeds)

## Rollback

### Automatic Rollback

If production deployment fails, the workflow automatically rolls back.

### Manual Rollback

```bash
# Rollback to previous version
./scripts/rollback.sh production

# Rollback to specific version
./scripts/rollback.sh production latest
kubectl logs -l app=carbonledger
kubectl rollout history deployment/backend
