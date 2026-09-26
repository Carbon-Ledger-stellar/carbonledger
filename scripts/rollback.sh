#!/bin/bash

set -e

ENVIRONMENT=${1:-production}
IMAGE_TAG=${2:-latest}

echo "🔄 Rolling back ${ENVIRONMENT} deployment..."

if [ "$ENVIRONMENT" == "production" ]; then
    kubectl set image deployment/backend backend=ghcr.io/carbon-ledger-stellar/carbonledger/backend:${IMAGE_TAG}
    kubectl set image deployment/frontend frontend=ghcr.io/carbon-ledger-stellar/carbonledger/frontend:${IMAGE_TAG}
else
    kubectl set image deployment/backend backend=ghcr.io/carbon-ledger-stellar/carbonledger/backend:staging-${IMAGE_TAG}
    kubectl set image deployment/frontend frontend=ghcr.io/carbon-ledger-stellar/carbonledger/frontend:staging-${IMAGE_TAG}
fi

echo "⏳ Waiting for rollback to complete..."
kubectl rollout status deployment/backend
kubectl rollout status deployment/frontend

echo "✅ Rollback completed successfully!"
