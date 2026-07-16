#!/usr/bin/env bash
# Daily PostgreSQL backup — dumps to S3 and alerts on failure.
# Required env vars: DATABASE_URL, BACKUP_S3_BUCKET
# Optional env vars: ADMIN_ALERT_WEBHOOK (Slack/Discord webhook URL)

set -euo pipefail

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BACKUP_FILE="/tmp/carbonledger-backup-${TIMESTAMP}.dump"
S3_KEY="daily/${TIMESTAMP}.dump"

alert() {
  local msg="$1"
  echo "[backup] ERROR: ${msg}" >&2
  if [[ -n "${ADMIN_ALERT_WEBHOOK:-}" ]]; then
    curl -s -X POST "${ADMIN_ALERT_WEBHOOK}" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"🚨 CarbonLedger DB backup FAILED: ${msg}\"}" || true
  fi
}

cleanup() {
  rm -f "${BACKUP_FILE}"
}
trap cleanup EXIT

# Validate required vars
if [[ -z "${DATABASE_URL:-}" ]]; then
  alert "DATABASE_URL is not set"
  exit 1
fi
if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
  alert "BACKUP_S3_BUCKET is not set"
  exit 1
fi

echo "[backup] Starting backup at ${TIMESTAMP}"

# Dump
if ! pg_dump --format=custom --no-password "${DATABASE_URL}" -f "${BACKUP_FILE}"; then
  alert "pg_dump failed"
  exit 1
fi

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[backup] Dump complete (${BACKUP_SIZE}), uploading to s3://${BACKUP_S3_BUCKET}/${S3_KEY}"

# Upload
if ! aws s3 cp "${BACKUP_FILE}" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" \
    --storage-class STANDARD_IA \
    --no-progress; then
  alert "S3 upload failed"
  exit 1
fi

echo "[backup] Backup succeeded: s3://${BACKUP_S3_BUCKET}/${S3_KEY} (${BACKUP_SIZE})"
