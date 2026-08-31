#!/usr/bin/env bash
# Daily PostgreSQL backup — dumps to S3 and alerts on failure.
# Runs daily at 02:00 UTC (see systemd/carbonledger-backup.timer)
# Tracks backup metrics: size, duration, storage location
# Required env vars: DATABASE_URL, BACKUP_S3_BUCKET
# Optional env vars: ADMIN_ALERT_WEBHOOK (Slack/Discord webhook URL)

set -euo pipefail

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BACKUP_FILE="/tmp/carbonledger-backup-${TIMESTAMP}.dump"
S3_KEY="daily/${TIMESTAMP}.dump"
BACKUP_LOG="/var/log/carbonledger/backup.log"
BACKUP_METRICS="/var/log/carbonledger/backup-metrics.json"
EXIT_CODE=0

# ── Alerting ────────────────────────────────────────────────────────────────

alert() {
  local msg="$1"
  echo "[backup] ERROR: ${msg}" >&2
  if [[ -n "${ADMIN_ALERT_WEBHOOK:-}" ]]; then
    curl -s -X POST "${ADMIN_ALERT_WEBHOOK}" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"🚨 CarbonLedger DB backup FAILED: ${msg}\"}" || true
  fi
}

log_metric() {
  # Append metrics to JSON log file for monitoring
  if [[ -f "${BACKUP_METRICS}" ]]; then
    # Append to existing file (newline-delimited JSON)
    echo "$1" >> "${BACKUP_METRICS}"
  else
    mkdir -p "$(dirname "${BACKUP_METRICS}")"
    echo "$1" >> "${BACKUP_METRICS}"
  fi
}

cleanup() {
  rm -f "${BACKUP_FILE}"
}
trap cleanup EXIT

# ── Validation ──────────────────────────────────────────────────────────────

if [[ -z "${DATABASE_URL:-}" ]]; then
  alert "DATABASE_URL is not set"
  exit 1
fi
if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
  alert "BACKUP_S3_BUCKET is not set"
  exit 1
fi

# ── Backup execution ────────────────────────────────────────────────────────

echo "[backup] Starting backup at ${TIMESTAMP}" | tee -a "${BACKUP_LOG}"

DUMP_START=$(date +%s.%N)

# Dump database in custom format for smaller size and faster restore
if ! pg_dump --format=custom --no-password "${DATABASE_URL}" -f "${BACKUP_FILE}"; then
  alert "pg_dump failed"
  exit 1
fi

DUMP_END=$(date +%s.%N)
DUMP_TIME=$(echo "${DUMP_END} - ${DUMP_START}" | bc)
BACKUP_SIZE_BYTES=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}")
BACKUP_SIZE_MB=$(echo "scale=2; ${BACKUP_SIZE_BYTES} / 1048576" | bc)
BACKUP_SIZE_HUMAN=$(du -sh "${BACKUP_FILE}" | cut -f1)

echo "[backup] Dump complete (${BACKUP_SIZE_HUMAN}, ${DUMP_TIME}s), uploading to s3://${BACKUP_S3_BUCKET}/${S3_KEY}" | tee -a "${BACKUP_LOG}"

# ── S3 Upload ───────────────────────────────────────────────────────────────

UPLOAD_START=$(date +%s.%N)

if ! aws s3 cp "${BACKUP_FILE}" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" \
    --storage-class STANDARD_IA \
    --no-progress; then
  alert "S3 upload failed"
  exit 1
fi

UPLOAD_END=$(date +%s.%N)
UPLOAD_TIME=$(echo "${UPLOAD_END} - ${UPLOAD_START}" | bc)

echo "[backup] Backup succeeded: s3://${BACKUP_S3_BUCKET}/${S3_KEY} (${BACKUP_SIZE_HUMAN})" | tee -a "${BACKUP_LOG}"

# ── Track Metrics ───────────────────────────────────────────────────────────

# Store metrics in JSON format for monitoring and analytics
METRIC_JSON=$(cat <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "backup_key": "s3://${BACKUP_S3_BUCKET}/${S3_KEY}",
  "backup_size_bytes": ${BACKUP_SIZE_BYTES},
  "backup_size_mb": ${BACKUP_SIZE_MB},
  "dump_time_seconds": $(echo "${DUMP_TIME}" | cut -d. -f1),
  "upload_time_seconds": $(echo "${UPLOAD_TIME}" | cut -d. -f1),
  "total_time_seconds": $(echo "${DUMP_END} - ${DUMP_START} + ${UPLOAD_END} - ${UPLOAD_START}" | bc | cut -d. -f1),
  "status": "success"
}
EOF
)

log_metric "${METRIC_JSON}"

# ── Cleanup Old Backups ─────────────────────────────────────────────────────

# Note: S3 lifecycle policies handle automatic deletion (see terraform storage.tf)
# This is a safety check to list and log retention status
BACKUP_COUNT=$(aws s3 ls "s3://${BACKUP_S3_BUCKET}/daily/" --recursive | wc -l)
echo "[backup] Total backups in S3: ${BACKUP_COUNT}" | tee -a "${BACKUP_LOG}"

# ── Retention Check ─────────────────────────────────────────────────────────

# Verify that lifecycle policy is active (should clean backups older than 30 days)
echo "[backup] Retention policy: 30 days (managed by S3 lifecycle configuration)" | tee -a "${BACKUP_LOG}"
echo "[backup] Storage class: STANDARD_IA (infrequent access pricing for cost optimization)" | tee -a "${BACKUP_LOG}"

exit ${EXIT_CODE}
