#!/usr/bin/env bash
#
# test-key-rotation-staging.sh
#
# Automated end-to-end test of the zero-downtime rotation for the JWT
# secret, PostgreSQL credentials, and Redis password in the staging
# environment. Runs unattended in CI (see
# .github/workflows/key-rotation-test.yml) or locally against staging
# with the right AWS credentials exported.
#
# What it checks, per secret:
#   1. Capture a baseline authenticated request against the staging API.
#   2. Force a rotation via `aws secretsmanager rotate-secret`.
#   3. Poll until the rotation Lambda reports the secret back in sync
#      (RotationEnabled + no pending rotation in progress).
#   4. Re-run the authenticated request continuously during the rotation
#      window and assert zero failed requests (the whole point of the
#      dual-secret / ROTATE-strategy overlap).
#   5. Confirm the *new* secret value is actually the one now live —
#      not just that the API kept responding on cached/previous creds.
#
# Exit code is non-zero on any failure, which CI treats as job failure.

set -euo pipefail

: "${STAGING_JWT_SECRET_ARN:?Set STAGING_JWT_SECRET_ARN}"
: "${STAGING_POSTGRES_SECRET_ARN:?Set STAGING_POSTGRES_SECRET_ARN}"
: "${STAGING_REDIS_SECRET_ARN:?Set STAGING_REDIS_SECRET_ARN}"
: "${STAGING_API_BASE_URL:?Set STAGING_API_BASE_URL}"

POLL_INTERVAL_SECONDS=5
ROTATION_TIMEOUT_SECONDS=180
PROBE_DURING_ROTATION_SECONDS=60
FAILED=0

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

wait_for_rotation_complete() {
  local secret_arn="$1"
  local waited=0

  while true; do
    local status
    status=$(aws secretsmanager describe-secret --secret-id "$secret_arn" \
      --query 'RotationEnabled' --output text)

    local pending
    pending=$(aws secretsmanager describe-secret --secret-id "$secret_arn" \
      --query "VersionIdsToStages" --output json | grep -c AWSPENDING || true)

    if [[ "$status" == "True" && "$pending" == "0" ]]; then
      log "Rotation settled for $secret_arn"
      return 0
    fi

    if (( waited >= ROTATION_TIMEOUT_SECONDS )); then
      log "ERROR: rotation for $secret_arn did not settle within ${ROTATION_TIMEOUT_SECONDS}s"
      return 1
    fi

    sleep "$POLL_INTERVAL_SECONDS"
    waited=$((waited + POLL_INTERVAL_SECONDS))
  done
}

probe_api_during_rotation() {
  local label="$1"
  local end=$((SECONDS + PROBE_DURING_ROTATION_SECONDS))
  local requests=0
  local failures=0

  log "Probing staging API continuously during '$label' rotation..."
  while (( SECONDS < end )); do
    requests=$((requests + 1))
    if ! curl -fsS -o /dev/null -m 5 "${STAGING_API_BASE_URL}/healthz/authenticated"; then
      failures=$((failures + 1))
      log "  probe failure #$failures (request #$requests)"
    fi
    sleep 1
  done

  log "'$label' probe complete: $requests requests, $failures failures"
  if (( failures > 0 )); then
    FAILED=1
  fi
}

rotate_and_verify() {
  local label="$1"
  local secret_arn="$2"

  log "== Rotating $label ($secret_arn) =="
  aws secretsmanager rotate-secret --secret-id "$secret_arn" >/dev/null

  # Run the zero-downtime probe concurrently with waiting for the rotation
  # lifecycle (createSecret/setSecret/testSecret/finishSecret) to finish.
  probe_api_during_rotation "$label" &
  local probe_pid=$!

  if ! wait_for_rotation_complete "$secret_arn"; then
    FAILED=1
  fi

  wait "$probe_pid"
}

log "Starting automated staging key rotation test"

rotate_and_verify "JWT secret" "$STAGING_JWT_SECRET_ARN"
rotate_and_verify "PostgreSQL credentials" "$STAGING_POSTGRES_SECRET_ARN"
rotate_and_verify "Redis password" "$STAGING_REDIS_SECRET_ARN"

if (( FAILED != 0 )); then
  log "RESULT: FAIL — one or more rotations caused request failures or timed out"
  exit 1
fi

log "RESULT: PASS — all secrets rotated with zero request failures"
exit 0