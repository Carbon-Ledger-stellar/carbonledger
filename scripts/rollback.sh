#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT=${1:-production}
NAMESPACE=${NAMESPACE:-carbonledger}
TIMEOUT=${ROLLBACK_TIMEOUT:-300s}

echo "Rolling back ${ENVIRONMENT} backend and canary..."

# Stop canary traffic first. This is a single routing change, normally under
# one minute, and leaves the known-good stable deployment untouched.
kubectl annotate ingress backend-canary -n "$NAMESPACE" \
  nginx.ingress.kubernetes.io/canary-weight=0 --overwrite
kubectl scale deployment backend-canary -n "$NAMESPACE" --replicas=0

# Roll the stable deployment back to the immediately previous Kubernetes
# revision. This intentionally avoids guessing a mutable image tag.
kubectl rollout undo deployment/backend -n "$NAMESPACE" --timeout="$TIMEOUT"
kubectl rollout status deployment/backend -n "$NAMESPACE" --timeout="$TIMEOUT"

echo "Rollback completed successfully."
