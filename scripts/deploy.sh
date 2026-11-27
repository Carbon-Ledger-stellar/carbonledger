#!/usr/bin/env bash
# scripts/deploy.sh — staged Kubernetes canary rollout for CarbonLedger
set -euo pipefail

NAMESPACE=${NAMESPACE:-carbonledger}
IMAGE=${IMAGE:?Set IMAGE to the immutable SHA-tagged backend image}
HEALTH_URL=${HEALTH_URL:-https://carbonledger.com/health}
CANARY_STAGES=${CANARY_STAGES:-5,25,50,100}
ROLLBACK_TIMEOUT=${ROLLBACK_TIMEOUT:-300s}

rollback() {
  echo "Canary failed; routing traffic to the stable deployment."
  kubectl annotate ingress backend-canary -n "$NAMESPACE" \
    nginx.ingress.kubernetes.io/canary-weight=0 --overwrite
  kubectl scale deployment backend-canary -n "$NAMESPACE" --replicas=0
  exit 1
}
trap rollback ERR

node ./scripts/canary-rollout.js "$(printf '%s' "$CANARY_STAGES" >/dev/null)"

sed "s|image: .*carbonledger/backend:.*|image: ${IMAGE}|" \
  deploy/kubernetes/canary-pause.yaml | kubectl apply -n "$NAMESPACE" -f -
kubectl rollout status deployment/backend-canary -n "$NAMESPACE" --timeout="$ROLLBACK_TIMEOUT"

IFS=',' read -ra STAGES <<< "$CANARY_STAGES"
for stage in "${STAGES[@]}"; do
  echo "Promoting canary to ${stage}%..."
  kubectl annotate ingress backend-canary -n "$NAMESPACE" \
    nginx.ingress.kubernetes.io/canary-weight="${stage}" --overwrite

  replicas=$((stage * 20 / 100))
  if [ "$stage" -eq 5 ]; then replicas=1; fi
  if [ "$replicas" -lt 1 ]; then replicas=1; fi
  kubectl scale deployment backend-canary -n "$NAMESPACE" --replicas="$replicas"

  curl --fail --retry 5 --retry-delay 5 "$HEALTH_URL"
  node ./scripts/canary-rollout.js "$stage"
  sleep 15
done

# Promote the tested revision to stable and stop canary traffic.
kubectl set image deployment/backend backend="${IMAGE}" -n "$NAMESPACE"
kubectl rollout status deployment/backend -n "$NAMESPACE" --timeout="$ROLLBACK_TIMEOUT"
kubectl annotate ingress backend-canary -n "$NAMESPACE" \
  nginx.ingress.kubernetes.io/canary-weight=0 --overwrite
kubectl scale deployment backend-canary -n "$NAMESPACE" --replicas=0

echo "Canary deployment complete."
