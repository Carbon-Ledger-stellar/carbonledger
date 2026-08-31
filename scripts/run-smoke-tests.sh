#!/usr/bin/env bash
# scripts/run-smoke-tests.sh
#
# Runner script for the post-deployment smoke test suite.
# Runs all smoke tests in order, targeting the environment specified via
# environment variables (or localhost defaults).
#
# Usage:
#   ./scripts/run-smoke-tests.sh [options]
#
# Options:
#   --api-url <url>       Backend API base URL  (default: http://localhost:3001/api/v1)
#   --raw-url <url>       Backend raw URL       (default: http://localhost:3001)
#   --frontend-url <url>  Frontend URL          (default: http://localhost:3000)
#   --api-token <token>   Bearer token for authenticated endpoints (optional)
#   --seed-batch-id <id>  Seed credit batch ID for deeper checks (optional)
#   --seed-serial <sn>    Seed serial number for lookup tests    (optional)
#   --skip-frontend       Skip Playwright frontend tests (faster)
#   --skip-contracts      Skip Soroban contract checks
#   --no-color            Disable coloured output
#
# Environment variables (override defaults):
#   SMOKE_API_URL         Backend API base URL
#   SMOKE_API_RAW_URL     Backend raw URL
#   SMOKE_FRONTEND_URL    Frontend URL
#   SMOKE_API_TOKEN       Bearer token for authenticated tests
#   SMOKE_SEED_BATCH_ID   Known batch ID with seed data
#   SMOKE_SEED_SERIAL     Known serial number with seed data
#
# Exits:
#   0 — all smoke tests passed
#   1 — one or more smoke tests failed
#
# Closes #1057

set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────

NO_COLOR=false

color() {
  if [ "$NO_COLOR" = "false" ]; then
    echo -e "$1"
  else
    echo -e "$2"
  fi
}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── Defaults ───────────────────────────────────────────────────────────────

SMOKE_API_URL="${SMOKE_API_URL:-http://localhost:3001/api/v1}"
SMOKE_API_RAW_URL="${SMOKE_API_RAW_URL:-http://localhost:3001}"
SMOKE_FRONTEND_URL="${SMOKE_FRONTEND_URL:-http://localhost:3000}"
SMOKE_API_TOKEN="${SMOKE_API_TOKEN:-}"
SMOKE_SEED_BATCH_ID="${SMOKE_SEED_BATCH_ID:-}"
SMOKE_SEED_SERIAL="${SMOKE_SEED_SERIAL:-}"

SKIP_FRONTEND=false
SKIP_CONTRACTS=false

# ── Argument parsing ───────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)        SMOKE_API_URL="$2";      shift 2 ;;
    --raw-url)        SMOKE_API_RAW_URL="$2";  shift 2 ;;
    --frontend-url)   SMOKE_FRONTEND_URL="$2"; shift 2 ;;
    --api-token)      SMOKE_API_TOKEN="$2";    shift 2 ;;
    --seed-batch-id)  SMOKE_SEED_BATCH_ID="$2"; shift 2 ;;
    --seed-serial)    SMOKE_SEED_SERIAL="$2";  shift 2 ;;
    --skip-frontend)  SKIP_FRONTEND=true;      shift   ;;
    --skip-contracts) SKIP_CONTRACTS=true;     shift   ;;
    --no-color)       NO_COLOR=true;           shift   ;;
    *)                echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Setup ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SMOKE_DIR="$REPO_ROOT/smoke-tests"

START_TIME=$(date +%s)
FAILED=()
PASSED=()

export SMOKE_API_URL
export SMOKE_API_RAW_URL
export SMOKE_FRONTEND_URL
export SMOKE_API_TOKEN
export SMOKE_SEED_BATCH_ID
export SMOKE_SEED_SERIAL

# ── Helpers ────────────────────────────────────────────────────────────────

run_suite() {
  local name="$1"
  local pattern="$2"
  local label="${3:-$name}"

  echo ""
  color "${CYAN}${BOLD}▶  Running: ${label}${NC}" "▶  Running: ${label}"

  if npx jest \
    --config jest.smoke.json \
    --testPathPattern="$pattern" \
    --forceExit \
    --reporters=default \
    --reporters=jest-junit 2>&1; then
    PASSED+=("$label")
    color "${GREEN}✓  ${label} passed${NC}" "✓  ${label} passed"
  else
    FAILED+=("$label")
    color "${RED}✗  ${label} FAILED${NC}" "✗  ${label} FAILED"
  fi
}

# ── Pre-flight ─────────────────────────────────────────────────────────────

echo ""
color "${BOLD}CarbonLedger Smoke Test Suite${NC}" "CarbonLedger Smoke Test Suite"
color "${CYAN}Target API:       ${SMOKE_API_URL}${NC}" "Target API:       ${SMOKE_API_URL}"
color "${CYAN}Target Frontend:  ${SMOKE_FRONTEND_URL}${NC}" "Target Frontend:  ${SMOKE_FRONTEND_URL}"
echo ""

# Verify the API is reachable before running tests
echo "Checking API reachability..."
if ! curl --silent --fail --max-time 10 "${SMOKE_API_RAW_URL}/health" > /dev/null 2>&1; then
  color "${RED}ERROR: Backend API not reachable at ${SMOKE_API_RAW_URL}/health${NC}" \
        "ERROR: Backend API not reachable at ${SMOKE_API_RAW_URL}/health"
  echo "  Make sure the backend is running and SMOKE_API_RAW_URL is correct."
  exit 1
fi
color "${GREEN}✓  Backend API is reachable${NC}" "✓  Backend API is reachable"

# ── Install dependencies ───────────────────────────────────────────────────

echo ""
echo "Installing smoke test dependencies..."
cd "$SMOKE_DIR"
npm install --silent

# ── Run test suites ────────────────────────────────────────────────────────

# 1. Health & DB checks (fastest, most critical — run first)
run_suite "smoke-db"      "smoke-db"      "Database Health"

# 2. Core backend API checks
run_suite "smoke-backend" "smoke-backend" "Backend API"

# 3. Mint/retire lifecycle read-path
run_suite "smoke-mint-retire" "smoke-mint-retire" "Mint/Retire Transaction"

# 4. Audit trail lookup
run_suite "smoke-audit-trail" "smoke-audit-trail" "Audit Trail Lookup"

# 5. Contract checks (optional, may be slow)
if [ "$SKIP_CONTRACTS" = "false" ]; then
  run_suite "smoke-contracts" "smoke-contracts" "Contract Deployment"
else
  color "${YELLOW}⚠  Skipping contract tests (--skip-contracts)${NC}" \
        "⚠  Skipping contract tests (--skip-contracts)"
fi

# 6. Frontend Playwright checks (optional, slow)
if [ "$SKIP_FRONTEND" = "false" ]; then
  echo ""
  color "${CYAN}${BOLD}▶  Running: Frontend (Playwright)${NC}" "▶  Running: Frontend (Playwright)"

  # Install Playwright browser if needed
  npx playwright install --with-deps chromium > /dev/null 2>&1 || true

  if npx playwright test --config playwright.smoke.config.ts --reporter=list; then
    PASSED+=("Frontend (Playwright)")
    color "${GREEN}✓  Frontend (Playwright) passed${NC}" "✓  Frontend (Playwright) passed"
  else
    FAILED+=("Frontend (Playwright)")
    color "${RED}✗  Frontend (Playwright) FAILED${NC}" "✗  Frontend (Playwright) FAILED"
  fi
else
  color "${YELLOW}⚠  Skipping frontend tests (--skip-frontend)${NC}" \
        "⚠  Skipping frontend tests (--skip-frontend)"
fi

# ── Summary ────────────────────────────────────────────────────────────────

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "────────────────────────────────────────────────"
color "${BOLD}Smoke Test Results${NC}" "Smoke Test Results"
echo "────────────────────────────────────────────────"
echo "Duration: ${DURATION}s"
echo ""

if [ ${#PASSED[@]} -gt 0 ]; then
  for suite in "${PASSED[@]}"; do
    color "${GREEN}✓  ${suite}${NC}" "✓  ${suite}"
  done
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  echo ""
  for suite in "${FAILED[@]}"; do
    color "${RED}✗  ${suite}${NC}" "✗  ${suite}"
  done

  echo ""
  color "${RED}${BOLD}SMOKE TESTS FAILED (${#FAILED[@]} suite(s) failed)${NC}" \
        "SMOKE TESTS FAILED (${#FAILED[@]} suite(s) failed)"
  echo ""
  echo "Check the output above for details."
  echo "JUnit report: smoke-tests/smoke-junit.xml"
  echo ""
  exit 1
fi

echo ""
color "${GREEN}${BOLD}ALL SMOKE TESTS PASSED (${#PASSED[@]} suites in ${DURATION}s)${NC}" \
     "ALL SMOKE TESTS PASSED (${#PASSED[@]} suites in ${DURATION}s)"
echo ""
