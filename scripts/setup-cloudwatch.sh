#!/usr/bin/env bash
# scripts/setup-cloudwatch.sh
# Creates CloudWatch log groups (90-day retention), metric filters for ERROR
# log lines, and alarms that fire when error rate exceeds threshold.
#
# Usage:
#   AWS_REGION=us-east-1 ALARM_SNS_ARN=arn:aws:sns:... bash scripts/setup-cloudwatch.sh
#
# Required env:
#   AWS_REGION        — AWS region (default: us-east-1)
#   ALARM_SNS_ARN     — SNS topic ARN for alarm notifications
# Optional env:
#   LOG_GROUP_PREFIX  — prefix for all log groups (default: /carbonledger)
#   ENV               — environment tag (default: production)
#   ERROR_THRESHOLD   — errors per 5-min window to trigger alarm (default: 10)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="${LOG_GROUP_PREFIX:-/carbonledger}"
ENV="${ENV:-production}"
THRESHOLD="${ERROR_THRESHOLD:-10}"
SNS_ARN="${ALARM_SNS_ARN:-}"

if [[ -z "$SNS_ARN" ]]; then
  echo "ERROR: ALARM_SNS_ARN is required" >&2
  exit 1
fi

# ── Log groups ────────────────────────────────────────────────────────────────

SERVICES=(
  "backend"
  "oracle-verification"
  "oracle-price"
  "oracle-satellite"
)

for svc in "${SERVICES[@]}"; do
  GROUP="${PREFIX}/${svc}"
  echo "→ Log group: $GROUP"

  aws logs create-log-group \
    --log-group-name "$GROUP" \
    --region "$REGION" 2>/dev/null || true

  aws logs put-retention-policy \
    --log-group-name "$GROUP" \
    --retention-in-days 90 \
    --region "$REGION"

  aws logs tag-log-group \
    --log-group-name "$GROUP" \
    --tags "Environment=${ENV},Project=carbonledger,Service=${svc}" \
    --region "$REGION"
done

# ── Metric filters (count ERROR-level JSON log lines) ─────────────────────────

METRIC_NAMESPACE="CarbonLedger/Logs"

for svc in "${SERVICES[@]}"; do
  GROUP="${PREFIX}/${svc}"
  METRIC_NAME="${svc}-error-count"

  echo "→ Metric filter: $METRIC_NAME"

  aws logs put-metric-filter \
    --log-group-name "$GROUP" \
    --filter-name "${svc}-errors" \
    --filter-pattern '{ $.level = "ERROR" || $.level = "error" }' \
    --metric-transformations \
      metricName="${METRIC_NAME}",metricNamespace="${METRIC_NAMESPACE}",metricValue=1,defaultValue=0,unit=Count \
    --region "$REGION"
done

# ── Alarms ────────────────────────────────────────────────────────────────────

for svc in "${SERVICES[@]}"; do
  METRIC_NAME="${svc}-error-count"
  ALARM_NAME="carbonledger-${svc}-error-rate-${ENV}"

  echo "→ Alarm: $ALARM_NAME (threshold: ${THRESHOLD} errors / 5 min)"

  aws cloudwatch put-metric-alarm \
    --alarm-name "$ALARM_NAME" \
    --alarm-description "Error rate spike in ${svc} (${ENV})" \
    --namespace "$METRIC_NAMESPACE" \
    --metric-name "$METRIC_NAME" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --threshold "$THRESHOLD" \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "$SNS_ARN" \
    --ok-actions "$SNS_ARN" \
    --region "$REGION"
done

echo ""
echo "✓ CloudWatch setup complete"
echo "  Log groups : ${PREFIX}/{backend,oracle-*}  (90-day retention)"
echo "  Metric ns  : ${METRIC_NAMESPACE}"
echo "  Alarms     : ${#SERVICES[@]} alarms → $SNS_ARN"
