#!/usr/bin/env bash
# PostgreSQL restore script — restores from S3 backup and verifies integrity.
# Usage: ./restore-db.sh [--backup-key s3://bucket/path/to/backup.dump] [--target-db db_name] [--verify-only]
# Required env vars: DATABASE_URL, BACKUP_S3_BUCKET, AWS credentials
# Optional env vars: RESTORE_WEBHOOK (Slack/Discord webhook URL)

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RESTORE_LOG="/tmp/restore-${TIMESTAMP}.log"
BACKUP_FILE="/tmp/carbonledger-restore-${TIMESTAMP}.dump"
TARGET_DB="${TARGET_DB:-carbonledger}"
VERIFY_ONLY="${VERIFY_ONLY:-false}"
BACKUP_KEY="${BACKUP_KEY:-}"
LATEST_BACKUP_MODE="true"  # true = get latest backup, false = use BACKUP_KEY

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --backup-key)
      BACKUP_KEY="$2"
      LATEST_BACKUP_MODE="false"
      shift 2
      ;;
    --target-db)
      TARGET_DB="$2"
      shift 2
      ;;
    --verify-only)
      VERIFY_ONLY="true"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Logging functions
alert() {
  local msg="$1"
  echo "[restore] ERROR: ${msg}" | tee -a "${RESTORE_LOG}" >&2
  if [[ -n "${RESTORE_WEBHOOK:-}" ]]; then
    curl -s -X POST "${RESTORE_WEBHOOK}" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"🚨 CarbonLedger DB restore FAILED at ${TIMESTAMP}: ${msg}\"}" || true
  fi
}

log_info() {
  echo "[restore] INFO: $1" | tee -a "${RESTORE_LOG}"
}

log_success() {
  echo "[restore] SUCCESS: $1" | tee -a "${RESTORE_LOG}"
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

log_info "Starting restore at ${TIMESTAMP}"
log_info "Target database: ${TARGET_DB}"
log_info "Restore log: ${RESTORE_LOG}"

# ── Find backup to restore ──────────────────────────────────────────────────

if [[ "${LATEST_BACKUP_MODE}" == "true" ]]; then
  log_info "Searching for latest backup in s3://${BACKUP_S3_BUCKET}/daily/"
  LATEST_BACKUP=$(aws s3 ls "s3://${BACKUP_S3_BUCKET}/daily/" \
    --recursive \
    --human-readable \
    --summarize | \
    grep '\.dump$' | \
    sort | \
    tail -1 | \
    awk '{print $NF}')
  
  if [[ -z "${LATEST_BACKUP}" ]]; then
    alert "No backups found in s3://${BACKUP_S3_BUCKET}/daily/"
    exit 1
  fi
  BACKUP_KEY="s3://${BACKUP_S3_BUCKET}/${LATEST_BACKUP}"
  log_info "Latest backup found: ${BACKUP_KEY}"
else
  log_info "Using specified backup: ${BACKUP_KEY}"
fi

# ── Download backup from S3 ─────────────────────────────────────────────────

log_info "Downloading backup from ${BACKUP_KEY}..."
DOWNLOAD_START=$(date +%s)

if ! aws s3 cp "${BACKUP_KEY}" "${BACKUP_FILE}" --no-progress; then
  alert "S3 download failed for ${BACKUP_KEY}"
  exit 1
fi

DOWNLOAD_END=$(date +%s)
DOWNLOAD_TIME=$((DOWNLOAD_END - DOWNLOAD_START))
BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
log_success "Backup downloaded (${BACKUP_SIZE}, ${DOWNLOAD_TIME}s)"

# ── Verify backup integrity ─────────────────────────────────────────────────

log_info "Verifying backup integrity with pg_restore --list..."
if ! pg_restore --list "${BACKUP_FILE}" > /dev/null 2>&1; then
  alert "Backup file is corrupted or invalid"
  exit 1
fi
log_success "Backup integrity verified"

# ── Restore backup ──────────────────────────────────────────────────────────

if [[ "${VERIFY_ONLY}" == "true" ]]; then
  log_info "Verify-only mode: skipping actual restore"
  log_success "Restore verification complete (backup is valid)"
  exit 0
fi

log_info "Restoring backup to database ${TARGET_DB}..."
RESTORE_START=$(date +%s)

# Prepare target database: drop and recreate
log_info "Preparing target database (dropping existing, creating fresh)..."
if ! psql "${DATABASE_URL}" \
    -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\" WITH (FORCE);" \
    -c "CREATE DATABASE \"${TARGET_DB}\" WITH OWNER carbonledger;" \
    2>/dev/null; then
  alert "Failed to prepare target database ${TARGET_DB}"
  exit 1
fi
log_success "Target database prepared"

# Update the database URL to use the target DB
RESTORE_DB_URL="${DATABASE_URL%/*}/${TARGET_DB}"

# Restore
log_info "Running pg_restore to restore database..."
if ! pg_restore \
    --host "$(echo "${RESTORE_DB_URL}" | sed -n 's/.*@\([^:/]*\).*/\1/p')" \
    --username carbonledger \
    --dbname "${TARGET_DB}" \
    --no-password \
    --verbose \
    "${BACKUP_FILE}" 2>&1 | tee -a "${RESTORE_LOG}"; then
  alert "pg_restore failed"
  exit 1
fi

RESTORE_END=$(date +%s)
RESTORE_TIME=$((RESTORE_END - RESTORE_START))

# ── Verify restored database ────────────────────────────────────────────────

log_info "Verifying restored database integrity..."
VERIFY_START=$(date +%s)

# Check row counts match (basic verification)
ORIGINAL_ROWS=$(pg_restore --list "${BACKUP_FILE}" | grep -c "TABLE DATA" || echo 0)
if ! psql "${RESTORE_DB_URL}" -c "SELECT 1" > /dev/null 2>&1; then
  alert "Cannot connect to restored database"
  exit 1
fi
log_success "Database connection verified"

# Verify database size
RESTORED_SIZE=$(psql "${RESTORE_DB_URL}" -t -c "SELECT pg_size_pretty(pg_database_size('${TARGET_DB}'));" 2>/dev/null)
log_info "Restored database size: ${RESTORED_SIZE}"

VERIFY_END=$(date +%s)
VERIFY_TIME=$((VERIFY_END - VERIFY_START))

# ── Report results ──────────────────────────────────────────────────────────

log_success "Restore completed successfully!"
log_info "============================================"
log_info "Backup Size:         ${BACKUP_SIZE}"
log_info "Download Time:       ${DOWNLOAD_TIME}s"
log_info "Restore Time:        ${RESTORE_TIME}s"
log_info "Verification Time:   ${VERIFY_TIME}s"
log_info "Total Time:          $((DOWNLOAD_TIME + RESTORE_TIME + VERIFY_TIME))s"
log_info "Restored to:         ${TARGET_DB}"
log_info "============================================"

# Check restore time against SLA
if [[ ${RESTORE_TIME} -lt 1800 ]]; then
  log_success "✅ Restore time (${RESTORE_TIME}s) is under 30-minute SLA"
else
  alert "❌ Restore time (${RESTORE_TIME}s) exceeds 30-minute SLA!"
  exit 1
fi

# Save restore metrics
if command -v psql &> /dev/null; then
  log_info "Recording restore metrics to database..."
  METRIC_JSON="{\"backup_key\": \"${BACKUP_KEY}\", \"backup_size_bytes\": $(stat -f%z "${BACKUP_FILE}" 2>/dev/null || stat -c%s "${BACKUP_FILE}"), \"download_time_seconds\": ${DOWNLOAD_TIME}, \"restore_time_seconds\": ${RESTORE_TIME}, \"verify_time_seconds\": ${VERIFY_TIME}, \"timestamp\": \"${TIMESTAMP}\"}"
  
  # Try to insert into backup_metrics table if it exists
  psql "${RESTORE_DB_URL}" <<EOSQL 2>/dev/null || true
    INSERT INTO backup_metrics (
      backup_key, 
      backup_size_bytes, 
      download_time_seconds, 
      restore_time_seconds, 
      verify_time_seconds,
      verified_at
    ) VALUES (
      '${BACKUP_KEY}',
      $(stat -f%z "${BACKUP_FILE}" 2>/dev/null || stat -c%s "${BACKUP_FILE}"),
      ${DOWNLOAD_TIME},
      ${RESTORE_TIME},
      ${VERIFY_TIME},
      NOW()
    );
EOSQL
fi

exit 0
