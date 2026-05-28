#!/usr/bin/env bash
# scripts/run-perf-tests.sh
#
# Runs the marketplace listings performance test (warm + cold cache).
# Requires k6: https://k6.io/docs/get-started/installation/
#
# Usage:
#   ./scripts/run-perf-tests.sh [BASE_URL]
#
# Examples:
#   ./scripts/run-perf-tests.sh
#   ./scripts/run-perf-tests.sh http://localhost:3001

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
SCRIPT="$(dirname "$0")/perf-test-listings.js"

if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 not found. Install from https://k6.io/docs/get-started/installation/"
  exit 1
fi

echo "=== CarbonLedger — Marketplace Listings Performance Test ==="
echo "Target: ${BASE_URL}"
echo ""

# ── Warm cache run ────────────────────────────────────────────────────────────
echo "--- Warm cache (p95 target: <500ms) ---"
k6 run -e BASE_URL="${BASE_URL}" -e CACHE=warm "${SCRIPT}"

# ── Cold cache run ────────────────────────────────────────────────────────────
echo ""
echo "--- Cold cache (p95 target: <2000ms) ---"
echo "Flushing Redis cache via API..."
curl -sf -X POST "${BASE_URL}/marketplace/cache/flush" \
  -H "Authorization: Bearer ${ADMIN_TOKEN:-}" \
  -o /dev/null || echo "  (cache flush skipped — set ADMIN_TOKEN or flush manually)"

k6 run -e BASE_URL="${BASE_URL}" -e CACHE=cold "${SCRIPT}"

echo ""
echo "Results saved to scripts/perf-results-listings.json"
