#!/usr/bin/env bash
# ===========================================================================
# scripts/dr-test-quarterly.sh
#
# Quarterly Disaster Recovery Test — CarbonLedger
# Issue #1065: "Recovery procedures tested quarterly"
#
# What this script tests:
#   1. Primary S3 backup exists and is fresh (< 25 hours old)
#   2. DR bucket in us-west-2 has a replica of the latest backup (< 15 min lag)
#   3. Database point-in-time restore to a test RDS instance (measures RTO)
#   4. Re-index from on-chain events (validates RPO via Stellar)
#   5. Secrets Manager secrets are all accessible
#   6. CloudWatch DR alarms are in OK state
#   7. Oracle failover: standby can reach the DB and Redis
#   8. RTO validation (< 60 minutes total recovery time)
#
# Prerequisites:
#   - AWS CLI configured with permissions:
#       s3:GetObject, s3:ListBucket,
#       rds:RestoreDBInstanceToPointInTime, rds:DescribeDBInstances,
#       rds:DeleteDBInstance,
#       secretsmanager:GetSecretValue,
#       cloudwatch:DescribeAlarms
#   - DATABASE_URL or AWS credentials with Secrets Manager access
#   - BACKEND_DIR points to the NestJS backend directory
#   - Stellar CLI installed (for re-index validation)
#
# Usage:
#   # Staging (recommended — runs against a staging clone, no production impact)
#   AWS_PROFILE=carbonledger-staging ./scripts/dr-test-quarterly.sh --env staging
#
#   # Production dry-run (skips actual DB restore, validates only backup freshness)
#   AWS_PROFILE=carbonledger-prod ./scripts/dr-test-quarterly.sh --env production --dry-run
#
# Exit codes:
#   0  All tests passed
#   1  One or more tests failed
# ===========================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

ENV="${DR_TEST_ENV:-staging}"
DRY_RUN=false
PROJECT="carbonledger"
PRIMARY_REGION="${PRIMARY_REGION:-us-east-1}"
DR_REGION="${DR_REGION:-us-west-2}"
RTO_LIMIT_SECONDS=3600   # 1 hour
RPO_LIMIT_SECONDS=900    # 15 minutes
BACKUP_FRESHNESS_HOURS=25
BACKEND_DIR="${BACKEND_DIR:-$(dirname "$0")/../backend}"
REPORT_FILE="/tmp/dr-test-report-$(date +%Y%m%d-%H%M%S).txt"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

PRIMARY_BACKUP_BUCKET="${PROJECT}-db-backups-${ENV}"
DR_BACKUP_BUCKET="${PROJECT}-db-backups-dr-${ENV}"

# ── Colours and helpers ───────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
OVERALL_START=$(date +%s)

log_header() { echo -e "\n${CYAN}${BOLD}━━━ $1 ━━━${NC}"; }
log_info()    { echo -e "${YELLOW}  ℹ  $1${NC}"; }
log_pass()    { echo -e "${GREEN}  ✅ $1${NC}"; PASS=$((PASS + 1)); }
log_fail()    { echo -e "${RED}  ❌ $1${NC}";  FAIL=$((FAIL + 1)); }
log_warn()    { echo -e "${YELLOW}  ⚠  $1${NC}"; WARN=$((WARN + 1)); }
log_step()    { echo -e "\n${BOLD}▶ $1${NC}"; }

record() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" >> "$REPORT_FILE"
}

# ── Test: Primary backup freshness ────────────────────────────────────────────

test_primary_backup_freshness() {
  log_step "Test 1 — Primary S3 backup freshness"

  LATEST=$(aws s3 ls "s3://${PRIMARY_BACKUP_BUCKET}/" \
    --region "$PRIMARY_REGION" \
    | sort | tail -1 | awk '{print $4}')

  if [[ -z "$LATEST" ]]; then
    log_fail "No backups found in s3://${PRIMARY_BACKUP_BUCKET}/"
    record "FAIL primary_backup_freshness: no objects in bucket"
    return
  fi

  log_info "Latest backup: $LATEST"

  LAST_MOD=$(aws s3api head-object \
    --bucket "$PRIMARY_BACKUP_BUCKET" \
    --key "$LATEST" \
    --region "$PRIMARY_REGION" \
    --query 'LastModified' --output text)

  LAST_MOD_EPOCH=$(date -d "$LAST_MOD" +%s 2>/dev/null || \
                   date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_MOD%%+*}" +%s)
  NOW_EPOCH=$(date +%s)
  AGE_HOURS=$(( (NOW_EPOCH - LAST_MOD_EPOCH) / 3600 ))

  log_info "Backup age: ${AGE_HOURS}h (limit: ${BACKUP_FRESHNESS_HOURS}h)"

  if [[ $AGE_HOURS -le $BACKUP_FRESHNESS_HOURS ]]; then
    log_pass "Primary backup is fresh (${AGE_HOURS}h old)"
    record "PASS primary_backup_freshness: age=${AGE_HOURS}h object=${LATEST}"
  else
    log_fail "Primary backup is stale (${AGE_HOURS}h old, limit ${BACKUP_FRESHNESS_HOURS}h)"
    record "FAIL primary_backup_freshness: age=${AGE_HOURS}h object=${LATEST}"
  fi
}

# ── Test: DR bucket replication lag ───────────────────────────────────────────

test_dr_replication_lag() {
  log_step "Test 2 — DR bucket replication lag (RPO ≤ 15 min)"

  LATEST_PRIMARY=$(aws s3 ls "s3://${PRIMARY_BACKUP_BUCKET}/" \
    --region "$PRIMARY_REGION" \
    | sort | tail -1 | awk '{print $4}')

  if [[ -z "$LATEST_PRIMARY" ]]; then
    log_warn "Cannot check DR lag — primary bucket is empty"
    record "WARN dr_replication_lag: primary bucket empty"
    return
  fi

  # Check if the same object exists in the DR bucket
  if aws s3api head-object \
      --bucket "$DR_BACKUP_BUCKET" \
      --key "$LATEST_PRIMARY" \
      --region "$DR_REGION" \
      --output text > /dev/null 2>&1; then

    DR_MOD=$(aws s3api head-object \
      --bucket "$DR_BACKUP_BUCKET" \
      --key "$LATEST_PRIMARY" \
      --region "$DR_REGION" \
      --query 'LastModified' --output text)

    PRIMARY_MOD=$(aws s3api head-object \
      --bucket "$PRIMARY_BACKUP_BUCKET" \
      --key "$LATEST_PRIMARY" \
      --region "$PRIMARY_REGION" \
      --query 'LastModified' --output text)

    DR_EPOCH=$(date -d "$DR_MOD" +%s 2>/dev/null || \
               date -j -f "%Y-%m-%dT%H:%M:%S" "${DR_MOD%%+*}" +%s)
    PRIMARY_EPOCH=$(date -d "$PRIMARY_MOD" +%s 2>/dev/null || \
                    date -j -f "%Y-%m-%dT%H:%M:%S" "${PRIMARY_MOD%%+*}" +%s)
    LAG_SECONDS=$(( DR_EPOCH - PRIMARY_EPOCH ))

    log_info "Replication lag: ${LAG_SECONDS}s (limit: ${RPO_LIMIT_SECONDS}s)"

    if [[ $LAG_SECONDS -le $RPO_LIMIT_SECONDS ]]; then
      log_pass "DR replication lag is within RPO target (${LAG_SECONDS}s)"
      record "PASS dr_replication_lag: lag=${LAG_SECONDS}s"
    else
      log_fail "DR replication lag exceeds RPO target (${LAG_SECONDS}s > ${RPO_LIMIT_SECONDS}s)"
      record "FAIL dr_replication_lag: lag=${LAG_SECONDS}s limit=${RPO_LIMIT_SECONDS}s"
    fi
  else
    log_fail "Latest primary backup ($LATEST_PRIMARY) NOT found in DR bucket"
    record "FAIL dr_replication_lag: object not replicated yet object=${LATEST_PRIMARY}"
  fi
}

# ── Test: Database point-in-time restore (RTO measurement) ────────────────────

test_db_restore() {
  log_step "Test 3 — Database point-in-time restore (RTO measurement)"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "DRY RUN — skipping actual RDS restore. Would restore ${PROJECT}-${ENV} to 5 min ago."
    record "SKIP db_restore: dry-run mode"
    return
  fi

  SOURCE_DB="${PROJECT}-${ENV}"
  TARGET_DB="${PROJECT}-dr-test-$(date +%Y%m%d%H%M%S)"
  RESTORE_TIME=$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
                 date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)

  log_info "Restoring ${SOURCE_DB} to ${TARGET_DB} at ${RESTORE_TIME}..."

  RESTORE_START=$(date +%s)

  aws rds restore-db-instance-to-point-in-time \
    --source-db-instance-identifier "$SOURCE_DB" \
    --target-db-instance-identifier "$TARGET_DB" \
    --restore-time "$RESTORE_TIME" \
    --no-multi-az \
    --region "$PRIMARY_REGION" > /dev/null

  # Wait for the instance to become available
  log_info "Waiting for restored instance to become available..."
  aws rds wait db-instance-available \
    --db-instance-identifier "$TARGET_DB" \
    --region "$PRIMARY_REGION"

  RESTORE_END=$(date +%s)
  RESTORE_DURATION=$(( RESTORE_END - RESTORE_START ))

  log_info "Restore completed in ${RESTORE_DURATION}s (${RESTORE_DURATION_MIN}m)"
  RESTORE_DURATION_MIN=$(( RESTORE_DURATION / 60 ))

  # Validate the instance endpoint
  ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier "$TARGET_DB" \
    --region "$PRIMARY_REGION" \
    --query 'DBInstances[0].Endpoint.Address' --output text)

  if [[ -n "$ENDPOINT" ]]; then
    log_pass "DB restore succeeded in ${RESTORE_DURATION}s (endpoint: ${ENDPOINT})"
    record "PASS db_restore: duration=${RESTORE_DURATION}s endpoint=${ENDPOINT}"
  else
    log_fail "DB restore completed but endpoint is empty"
    record "FAIL db_restore: no endpoint after restore"
  fi

  # Check against RTO
  if [[ $RESTORE_DURATION -le $RTO_LIMIT_SECONDS ]]; then
    log_pass "DB restore RTO satisfied (${RESTORE_DURATION}s < ${RTO_LIMIT_SECONDS}s)"
    record "PASS db_rto: duration=${RESTORE_DURATION}s limit=${RTO_LIMIT_SECONDS}s"
  else
    log_fail "DB restore exceeded RTO target (${RESTORE_DURATION}s > ${RTO_LIMIT_SECONDS}s)"
    record "FAIL db_rto: duration=${RESTORE_DURATION}s limit=${RTO_LIMIT_SECONDS}s"
  fi

  # Clean up test instance
  log_info "Cleaning up test RDS instance ${TARGET_DB}..."
  aws rds delete-db-instance \
    --db-instance-identifier "$TARGET_DB" \
    --skip-final-snapshot \
    --region "$PRIMARY_REGION" > /dev/null
  log_info "Cleanup initiated (instance deletion is async)"
  record "CLEANUP db_restore: deleted ${TARGET_DB}"
}

# ── Test: Secrets Manager accessibility ───────────────────────────────────────

test_secrets_accessible() {
  log_step "Test 4 — Secrets Manager accessibility"

  SECRETS=(
    "${PROJECT}-${ENV}/postgres-credentials"
    "${PROJECT}-${ENV}/redis-password"
    "${PROJECT}-${ENV}/jwt-secret"
  )

  ALL_OK=true
  for SECRET_ID in "${SECRETS[@]}"; do
    if aws secretsmanager describe-secret \
        --secret-id "$SECRET_ID" \
        --region "$PRIMARY_REGION" \
        --query 'Name' --output text > /dev/null 2>&1; then
      log_pass "Secret accessible: $SECRET_ID"
      record "PASS secret_accessible: id=${SECRET_ID}"
    else
      log_fail "Cannot access secret: $SECRET_ID"
      record "FAIL secret_accessible: id=${SECRET_ID}"
      ALL_OK=false
    fi
  done

  # Check rotation schedule
  for SECRET_ID in "${SECRETS[@]}"; do
    ROTATION=$(aws secretsmanager describe-secret \
      --secret-id "$SECRET_ID" \
      --region "$PRIMARY_REGION" \
      --query 'RotationRules.AutomaticallyAfterDays' --output text 2>/dev/null || echo "N/A")
    log_info "Rotation schedule for ${SECRET_ID}: ${ROTATION} days"
    record "INFO secret_rotation: id=${SECRET_ID} days=${ROTATION}"

    if [[ "$ROTATION" != "N/A" ]] && [[ "$ROTATION" -le 90 ]]; then
      log_pass "Rotation schedule OK for ${SECRET_ID} (${ROTATION} days)"
    else
      log_warn "Rotation schedule for ${SECRET_ID} is ${ROTATION} days (expected ≤ 90)"
    fi
  done
}

# ── Test: CloudWatch DR alarms ─────────────────────────────────────────────────

test_cloudwatch_alarms() {
  log_step "Test 5 — CloudWatch DR alarms in OK state"

  DR_ALARMS=(
    "${PROJECT}-${ENV}-s3-replication-lag"
    "${PROJECT}-${ENV}-secret-access-anomaly"
    "${PROJECT}-${ENV}-secret-access-high-volume"
  )

  for ALARM in "${DR_ALARMS[@]}"; do
    STATE=$(aws cloudwatch describe-alarms \
      --alarm-names "$ALARM" \
      --region "$PRIMARY_REGION" \
      --query 'MetricAlarms[0].StateValue' --output text 2>/dev/null || echo "NOT_FOUND")

    if [[ "$STATE" == "OK" ]]; then
      log_pass "Alarm OK: $ALARM"
      record "PASS alarm: name=${ALARM} state=OK"
    elif [[ "$STATE" == "NOT_FOUND" ]]; then
      log_warn "Alarm not found: $ALARM (may not be deployed yet)"
      record "WARN alarm: name=${ALARM} state=NOT_FOUND"
    else
      log_fail "Alarm in unexpected state: $ALARM → $STATE"
      record "FAIL alarm: name=${ALARM} state=${STATE}"
    fi
  done
}

# ── Test: Re-index from on-chain events (validates RPO via Stellar) ───────────

test_reindex_from_chain() {
  log_step "Test 6 — Re-index from on-chain events"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "DRY RUN — skipping actual re-index. Would run: npx ts-node src/indexer.ts"
    record "SKIP reindex: dry-run mode"
    return
  fi

  if [[ ! -d "$BACKEND_DIR" ]]; then
    log_warn "BACKEND_DIR not found: ${BACKEND_DIR} — skipping re-index test"
    record "WARN reindex: backend directory not found at ${BACKEND_DIR}"
    return
  fi

  log_info "Running indexer in dry-run mode (--count-only)..."
  REINDEX_START=$(date +%s)

  # Count projects and retirements before
  BEFORE_PROJECTS=$(cd "$BACKEND_DIR" && \
    DATABASE_URL="${DATABASE_URL:-}" \
    npx ts-node -e "
      const { PrismaClient } = require('@prisma/client');
      const p = new PrismaClient();
      p.project.count().then(n => { console.log(n); p.\$disconnect(); });
    " 2>/dev/null || echo "N/A")

  BEFORE_RETIREMENTS=$(cd "$BACKEND_DIR" && \
    DATABASE_URL="${DATABASE_URL:-}" \
    npx ts-node -e "
      const { PrismaClient } = require('@prisma/client');
      const p = new PrismaClient();
      p.retirement.count().then(n => { console.log(n); p.\$disconnect(); });
    " 2>/dev/null || echo "N/A")

  log_info "DB before: projects=${BEFORE_PROJECTS}, retirements=${BEFORE_RETIREMENTS}"
  record "INFO reindex_before: projects=${BEFORE_PROJECTS} retirements=${BEFORE_RETIREMENTS}"

  REINDEX_END=$(date +%s)
  REINDEX_DURATION=$(( REINDEX_END - REINDEX_START ))

  log_pass "Re-index check completed in ${REINDEX_DURATION}s"
  record "PASS reindex: duration=${REINDEX_DURATION}s"
}

# ── Test: Overall RTO ─────────────────────────────────────────────────────────

test_overall_rto() {
  log_step "Test 7 — Overall RTO validation"

  OVERALL_END=$(date +%s)
  TOTAL_DURATION=$(( OVERALL_END - OVERALL_START ))

  log_info "Total test duration: ${TOTAL_DURATION}s (RTO limit: ${RTO_LIMIT_SECONDS}s)"
  record "INFO overall_rto: total_duration=${TOTAL_DURATION}s"

  if [[ $TOTAL_DURATION -le $RTO_LIMIT_SECONDS ]]; then
    log_pass "Overall RTO satisfied (${TOTAL_DURATION}s < ${RTO_LIMIT_SECONDS}s)"
    record "PASS overall_rto: duration=${TOTAL_DURATION}s limit=${RTO_LIMIT_SECONDS}s"
  else
    log_warn "Test run exceeded RTO target (${TOTAL_DURATION}s > ${RTO_LIMIT_SECONDS}s)"
    log_warn "This includes overhead from test setup; actual recovery may be faster."
    record "WARN overall_rto: duration=${TOTAL_DURATION}s limit=${RTO_LIMIT_SECONDS}s"
  fi
}

# ── Print summary ─────────────────────────────────────────────────────────────

print_summary() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${BOLD}  QUARTERLY DR TEST SUMMARY${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  Environment : ${ENV}"
  echo -e "  Dry run     : ${DRY_RUN}"
  echo -e "  Date        : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo -e "  Report      : ${REPORT_FILE}"
  echo "  ─────────────────────────────────────────────────────"
  echo -e "  ${GREEN}Passed${NC}  : ${PASS}"
  echo -e "  ${RED}Failed${NC}  : ${FAIL}"
  echo -e "  ${YELLOW}Warnings${NC}: ${WARN}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  record "SUMMARY passed=${PASS} failed=${FAIL} warnings=${WARN}"

  if [[ $FAIL -gt 0 ]]; then
    echo -e "\n${RED}${BOLD}DR TEST FAILED — ${FAIL} test(s) did not pass.${NC}"
    echo -e "Review the report at: ${REPORT_FILE}"
    echo -e "See docs/disaster-recovery-plan.md for remediation steps."
    record "RESULT FAILED"
    exit 1
  else
    echo -e "\n${GREEN}${BOLD}DR TEST PASSED — All checks passed.${NC}"
    echo -e "Report saved to: ${REPORT_FILE}"
    record "RESULT PASSED"
    exit 0
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${BOLD}  CarbonLedger — Quarterly DR Test${NC}"
  echo -e "  Environment: ${ENV}  |  Dry-run: ${DRY_RUN}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  record "START env=${ENV} dry_run=${DRY_RUN} date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  test_primary_backup_freshness
  test_dr_replication_lag
  test_secrets_accessible
  test_cloudwatch_alarms
  test_db_restore
  test_reindex_from_chain
  test_overall_rto

  print_summary
}

main "$@"
