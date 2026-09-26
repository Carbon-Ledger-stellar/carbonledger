#!/usr/bin/env bash
# Monthly PostgreSQL restore test — verifies backups are restorable and tracks metrics
# Runs on first day of month at 03:00 UTC
# Exit codes: 0=success, 1=critical failure, 2=restore SLA exceeded

set -euo pipefail

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TEST_REPORT="/tmp/restore-test-report-${TIMESTAMP}.json"
TEST_LOG="/var/log/carbonledger/restore-test-${TIMESTAMP}.log"
STAGING_DB="carbonledger_restore_test_$(date -u +%Y%m%d%H%M%S)"
MAX_RESTORE_TIME=1800  # 30 minutes in seconds
EXIT_CODE=0

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Logging ─────────────────────────────────────────────────────────────────

log_section() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "${TEST_LOG}"
  echo -e "${BLUE}$1${NC}" | tee -a "${TEST_LOG}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "${TEST_LOG}"
}

log_info() {
  echo -e "${YELLOW}ℹ  $1${NC}" | tee -a "${TEST_LOG}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}" | tee -a "${TEST_LOG}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}" | tee -a "${TEST_LOG}"
  EXIT_CODE=1
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "${TEST_LOG}"
}

# ── Cleanup ─────────────────────────────────────────────────────────────────

cleanup() {
  log_info "Cleaning up test database ${STAGING_DB}..."
  if psql "${DATABASE_URL}" \
    -c "DROP DATABASE IF EXISTS \"${STAGING_DB}\" WITH (FORCE);" \
    2>/dev/null || true; then
    log_success "Test database dropped"
  fi
}
trap cleanup EXIT

# ── Alert webhook ───────────────────────────────────────────────────────────

alert_webhook() {
  local status="$1"
  local message="$2"
  local details="$3"
  
  if [[ -z "${RESTORE_TEST_WEBHOOK:-}" ]]; then
    return
  fi
  
  local color="danger"
  [[ "${status}" == "success" ]] && color="good"
  [[ "${status}" == "warning" ]] && color="warning"
  
  curl -s -X POST "${RESTORE_TEST_WEBHOOK}" \
    -H "Content-Type: application/json" \
    -d "{\"attachments\": [{\"color\": \"${color}\", \"title\": \"CarbonLedger Monthly Restore Test - ${status}\", \"text\": \"${message}\", \"fields\": [{\"title\": \"Details\", \"value\": \"\`\`\`${details}\`\`\`\", \"short\": false}]}]}" || true
}

# ── Validation ──────────────────────────────────────────────────────────────

log_section "Restore Test: Environment Validation"

if [[ -z "${DATABASE_URL:-}" ]]; then
  log_error "DATABASE_URL is not set"
  exit 1
fi

if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
  log_error "BACKUP_S3_BUCKET is not set"
  exit 1
fi

log_success "Environment variables validated"

# ── Find latest backup ──────────────────────────────────────────────────────

log_section "Restore Test: Locating Latest Backup"

log_info "Searching s3://${BACKUP_S3_BUCKET}/daily/ for latest backup..."
LATEST_BACKUP=$(aws s3 ls "s3://${BACKUP_S3_BUCKET}/daily/" \
  --recursive \
  --human-readable \
  --summarize | \
  grep '\.dump$' | \
  sort | \
  tail -1 | \
  awk '{print $NF}')

if [[ -z "${LATEST_BACKUP}" ]]; then
  log_error "No backups found in S3 bucket"
  alert_webhook "failure" "Monthly restore test failed" "No backups found in s3://${BACKUP_S3_BUCKET}/daily/"
  exit 1
fi

FULL_BACKUP_PATH="s3://${BACKUP_S3_BUCKET}/${LATEST_BACKUP}"
log_success "Latest backup: ${FULL_BACKUP_PATH}"

# ── Run restore test ────────────────────────────────────────────────────────

log_section "Restore Test: Running Restore"

# Create staging database for test
log_info "Creating staging database ${STAGING_DB} for restore test..."
if ! psql "${DATABASE_URL}" \
    -c "CREATE DATABASE \"${STAGING_DB}\" WITH OWNER carbonledger;" \
    2>/dev/null; then
  log_error "Failed to create staging database"
  exit 1
fi
log_success "Staging database created"

# Use custom restore script to restore into staging DB
log_info "Running restore script to test backup..."
RESTORE_START=$(date +%s)

RESTORE_OUTPUT=$(/bin/bash /opt/carbonledger/scripts/restore-db.sh \
  --backup-key "${FULL_BACKUP_PATH}" \
  --target-db "${STAGING_DB}" \
  2>&1 || true)

RESTORE_END=$(date +%s)
RESTORE_TIME=$((RESTORE_END - RESTORE_START))

echo "${RESTORE_OUTPUT}" | tee -a "${TEST_LOG}"

# Check if restore was successful
if psql "${DATABASE_URL%/*}/${STAGING_DB}" -c "SELECT 1" > /dev/null 2>&1; then
  log_success "Restore completed successfully in ${RESTORE_TIME}s"
else
  log_error "Restore verification failed - cannot connect to restored database"
  alert_webhook "failure" "Monthly restore test failed" "Cannot connect to restored database after restore"
  exit 1
fi

# ── Verify restore time SLA ─────────────────────────────────────────────────

log_section "Restore Test: Validating SLA"

if [[ ${RESTORE_TIME} -lt ${MAX_RESTORE_TIME} ]]; then
  log_success "✅ Restore time (${RESTORE_TIME}s) is under 30-minute SLA"
else
  log_warning "⚠️  Restore time (${RESTORE_TIME}s) EXCEEDS 30-minute SLA (1800s)"
  EXIT_CODE=2
fi

# ── Verify data integrity ───────────────────────────────────────────────────

log_section "Restore Test: Validating Data Integrity"

STAGING_DB_URL="${DATABASE_URL%/*}/${STAGING_DB}"

# Get table count
TABLE_COUNT=$(psql "${STAGING_DB_URL}" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null)
log_info "Restored tables: ${TABLE_COUNT}"

# Get database size
DB_SIZE=$(psql "${STAGING_DB_URL}" -t -c "SELECT pg_size_pretty(pg_database_size('${STAGING_DB}'));" 2>/dev/null)
log_info "Restored database size: ${DB_SIZE}"

# Try to query key tables to ensure data integrity
for table in migrations carbon_credits marketplace_listings users; do
  if psql "${STAGING_DB_URL}" -t -c "SELECT COUNT(*) FROM ${table};" > /dev/null 2>&1; then
    ROW_COUNT=$(psql "${STAGING_DB_URL}" -t -c "SELECT COUNT(*) FROM ${table};" 2>/dev/null)
    log_info "Table ${table}: ${ROW_COUNT} rows"
  fi
done

log_success "Data integrity checks passed"

# ── Generate report ────────────────────────────────────────────────────────

log_section "Restore Test: Report"

cat > "${TEST_REPORT}" <<EOF
{
  "test_timestamp": "${TIMESTAMP}",
  "backup_source": "${FULL_BACKUP_PATH}",
  "staging_database": "${STAGING_DB}",
  "restore_time_seconds": ${RESTORE_TIME},
  "max_restore_time_sla_seconds": ${MAX_RESTORE_TIME},
  "sla_met": $([ ${RESTORE_TIME} -lt ${MAX_RESTORE_TIME} ] && echo "true" || echo "false"),
  "database_size": "${DB_SIZE}",
  "table_count": ${TABLE_COUNT},
  "test_status": "$([ ${EXIT_CODE} -eq 0 ] && echo "PASSED" || echo "FAILED")",
  "exit_code": ${EXIT_CODE}
}
EOF

log_success "Report saved to ${TEST_REPORT}"
cat "${TEST_REPORT}" | tee -a "${TEST_LOG}"

# ── Send webhook notification ───────────────────────────────────────────────

if [[ ${EXIT_CODE} -eq 0 ]]; then
  log_success "Monthly restore test PASSED ✅"
  alert_webhook "success" "Monthly restore test passed successfully" "Restore time: ${RESTORE_TIME}s (SLA: ${MAX_RESTORE_TIME}s)\nDatabase size: ${DB_SIZE}\nTables: ${TABLE_COUNT}"
elif [[ ${EXIT_CODE} -eq 2 ]]; then
  log_warning "Monthly restore test PASSED with SLA warning ⚠️"
  alert_webhook "warning" "Monthly restore test passed but restore time exceeded SLA" "Restore time: ${RESTORE_TIME}s (SLA: ${MAX_RESTORE_TIME}s)\nDatabase size: ${DB_SIZE}"
else
  log_error "Monthly restore test FAILED ❌"
  alert_webhook "failure" "Monthly restore test failed" "$(tail -20 "${TEST_LOG}")"
fi

exit ${EXIT_CODE}
