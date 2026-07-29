#!/usr/bin/env bash
# scripts/seed-loadtest.sh — seed the staging database with 1000 active
# marketplace listings so the k6 load tests have real data to work with.
#
# Usage:
#   ./scripts/seed-loadtest.sh
#
#   # With custom base URL and auth:
#   BASE_URL=https://staging.carbonledger.io \
#   ADMIN_SECRET=your-jwt-here \
#   ./scripts/seed-loadtest.sh
#
# Output:
#   load-tests/seed-data.json  — listing IDs consumed by marketplace.k6.js
#
# Prerequisites:
#   - curl, jq
#   - Backend API running and reachable at BASE_URL
#   - A valid admin JWT (or ADMIN_EMAIL + ADMIN_PASSWORD for auto-login)
#
# Environment variables:
#   BASE_URL        API base URL (default: http://localhost:3001)
#   ADMIN_EMAIL     Admin email for JWT login (default: admin@loadtest.local)
#   ADMIN_PASSWORD  Admin password (default: loadtest-password-changeme)
#   ADMIN_SECRET    Pre-issued JWT (skips login step if set)
#   LISTING_COUNT   Number of listings to seed (default: 1000)
#   BATCH_SIZE      Listings per request batch (default: 50)
#   CLEAN_FIRST     Set to "true" to delete existing load test data first
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
API="${BASE_URL}/api/v1"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@loadtest.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-loadtest-password-changeme}"
LISTING_COUNT="${LISTING_COUNT:-1000}"
BATCH_SIZE="${BATCH_SIZE:-50}"
SEED_OUTPUT="load-tests/seed-data.json"
CLEAN_FIRST="${CLEAN_FIRST:-false}"

# Methodology options matching contract constants
METHODOLOGIES=("VCS-VM0015" "Gold Standard TPDDTEC" "ACR-Forest" "CAR-Protocol" "Plan Vivo")
VINTAGES=(2020 2021 2022 2023 2024)
COUNTRIES=("Brazil" "Indonesia" "Kenya" "Peru" "Ghana" "Colombia" "Viet Nam" "India")

log()  { echo "[$(date -u +%H:%M:%S)] $*"; }
info() { echo "[INFO]  $*"; }
ok()   { echo "[OK]    $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

# ── Dependency check ───────────────────────────────────────────────────────────
for cmd in curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
done

mkdir -p load-tests
mkdir -p load-tests/results

# ── Auth: obtain JWT ──────────────────────────────────────────────────────────
if [ -z "${ADMIN_SECRET:-}" ]; then
  log "Obtaining admin JWT from ${API}/auth/login ..."
  LOGIN_RESPONSE=$(curl -sf -X POST "${API}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" 2>&1) \
    || fail "Login failed. Ensure the backend is running at ${BASE_URL} and credentials are correct."

  ADMIN_SECRET=$(echo "$LOGIN_RESPONSE" | jq -r '.access_token // .token // empty')
  [ -n "$ADMIN_SECRET" ] || fail "Could not extract JWT from login response: $LOGIN_RESPONSE"
  ok "JWT obtained"
else
  ok "Using pre-set ADMIN_SECRET"
fi

AUTH_HEADER="Authorization: Bearer ${ADMIN_SECRET}"

# ── Health check ───────────────────────────────────────────────────────────────
log "Checking API health at ${BASE_URL}/health ..."
HEALTH=$(curl -sf "${BASE_URL}/health" 2>&1) \
  || fail "API not reachable at ${BASE_URL}/health. Is the backend running?"
ok "API healthy: $HEALTH"

# ── Optional cleanup ──────────────────────────────────────────────────────────
if [ "$CLEAN_FIRST" = "true" ]; then
  log "Cleaning up previous load-test data ..."
  curl -sf -X DELETE "${API}/admin/loadtest-data" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d '{"prefix":"listing-loadtest-"}' 2>/dev/null \
    && ok "Previous load-test listings deleted" \
    || log "No load-test listings to delete (or delete endpoint not supported)"
fi

# ── Seed projects (prerequisites for listings) ────────────────────────────────
log "Seeding load-test projects ..."
declare -A PROJECT_IDS
for i in $(seq 0 4); do
  METH="${METHODOLOGIES[$i]}"
  PROJECT_ID="proj-loadtest-$(printf '%04d' $i)"
  curl -sf -X POST "${API}/projects" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{
      \"projectId\":\"${PROJECT_ID}\",
      \"name\":\"Load Test Project ${i}\",
      \"methodology\":\"${METH}\",
      \"country\":\"${COUNTRIES[$((i % ${#COUNTRIES[@]}))]}\",
      \"description\":\"Automated load test project — do not use in production\",
      \"coordinates\":{\"lat\":\"-3.4653\",\"lon\":\"-62.2159\"},
      \"developer\":\"loadtest-developer@carbonledger.io\"
    }" >/dev/null 2>&1 || log "  Project ${PROJECT_ID} may already exist — continuing"
  PROJECT_IDS[$i]="$PROJECT_ID"
done
ok "Projects seeded (5 projects)"

# ── Seed listings ─────────────────────────────────────────────────────────────
log "Seeding ${LISTING_COUNT} listings in batches of ${BATCH_SIZE} ..."

LISTING_IDS=()
CREATED=0
FAILED=0
BATCH_NUM=0

while [ $CREATED -lt "$LISTING_COUNT" ]; do
  BATCH_END=$(( CREATED + BATCH_SIZE ))
  [ $BATCH_END -gt "$LISTING_COUNT" ] && BATCH_END="$LISTING_COUNT"

  BATCH_NUM=$(( BATCH_NUM + 1 ))
  BATCH_PAYLOADS="["

  for i in $(seq $CREATED $(( BATCH_END - 1 )) ); do
    LISTING_ID="listing-loadtest-$(printf '%04d' $(( i + 1 )))"
    PROJECT_IDX=$(( i % 5 ))
    METH="${METHODOLOGIES[$PROJECT_IDX]}"
    VINTAGE="${VINTAGES[$((i % ${#VINTAGES[@]}))]}"
    PRICE=$(( 1000000 + (i % 50) * 100000 ))  # 1.0 – 5.9 USDC (7 decimals)
    AMOUNT=$(( 10 + (i % 90) ))                # 10 – 99 credits per listing

    if [ $i -gt $CREATED ]; then BATCH_PAYLOADS="${BATCH_PAYLOADS},"; fi
    BATCH_PAYLOADS="${BATCH_PAYLOADS}{
      \"listingId\":\"${LISTING_ID}\",
      \"projectId\":\"${PROJECT_IDS[$PROJECT_IDX]}\",
      \"methodology\":\"${METH}\",
      \"vintage\":${VINTAGE},
      \"pricePerCredit\":${PRICE},
      \"amount\":${AMOUNT},
      \"batchId\":\"batch-loadtest-$(printf '%04d' $(( i + 1 )))\",
      \"sellerPublicKey\":\"GBLOADTEST$(printf '%046d' $(( i + 1 )))\"
    }"

    LISTING_IDS+=("$LISTING_ID")
  done

  BATCH_PAYLOADS="${BATCH_PAYLOADS}]"

  RESPONSE=$(curl -sf -X POST "${API}/marketplace/listings/batch" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"listings\":${BATCH_PAYLOADS}}" 2>&1) || {
    # Fall back to individual creation if batch endpoint not available
    for i in $(seq $CREATED $(( BATCH_END - 1 ))); do
      LISTING_ID="listing-loadtest-$(printf '%04d' $(( i + 1 )))"
      PROJECT_IDX=$(( i % 5 ))
      VINTAGE="${VINTAGES[$((i % ${#VINTAGES[@]}))]}"
      PRICE=$(( 1000000 + (i % 50) * 100000 ))
      AMOUNT=$(( 10 + (i % 90) ))
      curl -sf -X POST "${API}/marketplace/listings" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "{
          \"listingId\":\"${LISTING_ID}\",
          \"projectId\":\"${PROJECT_IDS[$PROJECT_IDX]}\",
          \"vintage\":${VINTAGE},
          \"pricePerCredit\":${PRICE},
          \"amount\":${AMOUNT},
          \"batchId\":\"batch-loadtest-$(printf '%04d' $(( i + 1 )))\",
          \"sellerPublicKey\":\"GBLOADTEST$(printf '%046d' $(( i + 1 )))\"
        }" >/dev/null 2>&1 \
        || FAILED=$(( FAILED + 1 ))
    done
  }

  CREATED=$BATCH_END
  log "  Batch ${BATCH_NUM}: seeded up to listing-loadtest-$(printf '%04d' $CREATED) (${CREATED}/${LISTING_COUNT})"
done

ok "Seeding complete: ${CREATED} listings created, ${FAILED} failed"

# ── Write seed-data.json ───────────────────────────────────────────────────────
log "Writing seed manifest to ${SEED_OUTPUT} ..."

LISTING_JSON="["
for i in "${!LISTING_IDS[@]}"; do
  [ $i -gt 0 ] && LISTING_JSON="${LISTING_JSON},"
  LISTING_JSON="${LISTING_JSON}\"${LISTING_IDS[$i]}\""
done
LISTING_JSON="${LISTING_JSON}]"

cat > "$SEED_OUTPUT" <<EOF
{
  "generated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "baseUrl": "${BASE_URL}",
  "listingCount": ${#LISTING_IDS[@]},
  "listingIds": ${LISTING_JSON}
}
EOF

ok "Seed manifest written: ${SEED_OUTPUT} (${#LISTING_IDS[@]} listing IDs)"

# ── Print run instructions ─────────────────────────────────────────────────────
echo ""
echo "=== Seed complete ==="
echo ""
echo "Run the load tests with:"
echo ""
echo "  k6 run \\"
echo "    -e BASE_URL=${BASE_URL} \\"
echo "    -e JWT=${ADMIN_SECRET:0:20}... \\"
echo "    load-tests/marketplace.k6.js"
echo ""
echo "With JSON output for RESULTS.md baseline:"
echo ""
echo "  k6 run \\"
echo "    -e BASE_URL=${BASE_URL} \\"
echo "    -e JWT=\$JWT \\"
echo "    --out json=load-tests/results/run-\$(date +%Y%m%d-%H%M%S).json \\"
echo "    load-tests/marketplace.k6.js"
echo ""
echo "For CPU flamegraph profiling:"
echo "  See load-tests/RESULTS.md §Profiling"
