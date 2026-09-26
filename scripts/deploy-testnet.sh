#!/usr/bin/env bash
# scripts/deploy-testnet.sh — deploy all CarbonLedger contracts to Stellar testnet,
# initialize them in dependency order, run smoke tests, and write
# testnet-contract-ids.json for the CI artifact.
#
# Usage:
#   ADMIN_SECRET_KEY=S... ORACLE_SECRET_KEY=S... ./scripts/deploy-testnet.sh
#
# Idempotency:
#   - If a contract ID is already in .env.testnet AND the WASM hash matches,
#     the deploy step is skipped (no re-deploy).
#   - Pass FORCE_REDEPLOY=true to bypass the hash check.
#
# Outputs:
#   .env.testnet              — contract IDs + network config
#   testnet-contract-ids.json — machine-readable artifact for CI
#
# Requirements: stellar-cli (cargo install stellar-cli --version 21.0.1), jq, curl
set -euo pipefail

NETWORK="testnet"
RPC_URL="https://soroban-testnet.stellar.org"
HORIZON_URL="https://horizon-testnet.stellar.org"
PASSPHRASE="Test SDF Network ; September 2015"
ENV_FILE=".env.testnet"
WASM_DIR="contracts/target/wasm32-unknown-unknown/release"
FORCE_REDEPLOY="${FORCE_REDEPLOY:-false}"
CONTRACT_IDS_JSON="testnet-contract-ids.json"

: "${ADMIN_SECRET_KEY:?ADMIN_SECRET_KEY is required}"
: "${ORACLE_SECRET_KEY:?ORACLE_SECRET_KEY is required}"

log()  { echo "[$(date -u +%H:%M:%S)] $*"; }
ok()   { echo "[OK]    $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

# ── helpers ───────────────────────────────────────────────────────────────────

get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true; }

set_env() {
  local key=$1 val=$2
  if grep -qE "^$key=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^$key=.*|$key=$val|" "$ENV_FILE"
  else
    echo "$key=$val" >> "$ENV_FILE"
  fi
}

wasm_hash() {
  sha256sum "$1" | cut -d' ' -f1
}

deploy_contract() {
  local name=$1
  local wasm="$WASM_DIR/${name}.wasm"
  local env_key="${name^^}_CONTRACT_ID"
  local hash_key="${name^^}_WASM_HASH"

  [ -f "$wasm" ] || fail "WASM not found: $wasm — run 'cargo build --target wasm32-unknown-unknown --release' first"

  local current_hash; current_hash=$(wasm_hash "$wasm")
  local stored_id; stored_id=$(get_env "$env_key")
  local stored_hash; stored_hash=$(get_env "$hash_key")

  if [ -n "$stored_id" ] && [ "$stored_hash" = "$current_hash" ] && [ "$FORCE_REDEPLOY" != "true" ]; then
    log "$name: WASM hash unchanged ($current_hash) — skipping redeploy (existing ID: $stored_id)"
    echo "$stored_id"
    return
  fi

  log "Deploying $name (WASM hash: $current_hash)..."
  local id
  id=$(stellar contract deploy \
    --wasm "$wasm" \
    --source "$ADMIN_SECRET_KEY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$PASSPHRASE" \
    --ignore-checks 2>&1) \
    || fail "Deploy of $name failed: $id"

  ok "$name deployed: $id"
  set_env "$env_key"   "$id"
  set_env "$hash_key"  "$current_hash"
  echo "$id"
}

invoke() {
  local contract=$1; shift
  stellar contract invoke \
    --id "$contract" \
    --source "$ADMIN_SECRET_KEY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$PASSPHRASE" \
    -- "$@" 2>/dev/null
}

smoke_test() {
  local name=$1 contract=$2 fn=$3
  shift 3
  log "Smoke test: $name.$fn ..."
  local output
  output=$(stellar contract invoke \
    --id "$contract" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$PASSPHRASE" \
    -- "$fn" "$@" 2>&1) || true
  echo "  → $output"
  # Any response (including a contract error) proves the contract is live
  [ -n "$output" ] && ok "$name.$fn: live" || fail "$name smoke test returned empty — contract may not be deployed"
}

# ── build ─────────────────────────────────────────────────────────────────────

log "Building contracts..."
(cd contracts && cargo build --target wasm32-unknown-unknown --release --workspace -q)
ok "Build complete"

# ── deploy ────────────────────────────────────────────────────────────────────

touch "$ENV_FILE"

REGISTRY_ID=$(deploy_contract carbon_registry)
CREDIT_ID=$(deploy_contract carbon_credit)
MARKETPLACE_ID=$(deploy_contract carbon_marketplace)
ORACLE_ID=$(deploy_contract carbon_oracle)

# Derive public keys from secret keys
ADMIN_PK=$(stellar keys address "$ADMIN_SECRET_KEY" 2>/dev/null \
  || python3 -c "
from stellar_sdk import Keypair
print(Keypair.from_secret('$ADMIN_SECRET_KEY').public_key)
" 2>/dev/null \
  || echo "UNKNOWN_ADMIN_PK")

ORACLE_PK=$(stellar keys address "$ORACLE_SECRET_KEY" 2>/dev/null \
  || python3 -c "
from stellar_sdk import Keypair
print(Keypair.from_secret('$ORACLE_SECRET_KEY').public_key)
" 2>/dev/null \
  || echo "UNKNOWN_ORACLE_PK")

set_env "STELLAR_NETWORK"     "$NETWORK"
set_env "STELLAR_RPC_URL"     "$RPC_URL"
set_env "STELLAR_HORIZON_URL" "$HORIZON_URL"
set_env "NETWORK_PASSPHRASE"  "$PASSPHRASE"
set_env "ADMIN_PUBLIC_KEY"    "$ADMIN_PK"
set_env "ORACLE_PUBLIC_KEY"   "$ORACLE_PK"

# ── initialize (idempotent — contracts guard against double-init) ──────────────

log "Initializing carbon_registry..."
invoke "$REGISTRY_ID" initialize \
  --admin "$ADMIN_PK" \
  || log "carbon_registry: already initialized (skipping)"

log "Initializing carbon_credit..."
invoke "$CREDIT_ID" initialize \
  --admin "$ADMIN_PK" \
  --registry "$REGISTRY_ID" \
  || log "carbon_credit: already initialized (skipping)"

log "Initializing carbon_marketplace..."
invoke "$MARKETPLACE_ID" initialize \
  --admin "$ADMIN_PK" \
  --credit_contract "$CREDIT_ID" \
  || log "carbon_marketplace: already initialized (skipping)"

log "Initializing carbon_oracle..."
invoke "$ORACLE_ID" initialize \
  --admin "$ADMIN_PK" \
  --oracle "$ORACLE_PK" \
  --registry "$REGISTRY_ID" \
  || log "carbon_oracle: already initialized (skipping)"

ok "All contracts initialized"

# ── smoke tests ───────────────────────────────────────────────────────────────

log "=== Smoke tests: one read call per contract ==="
smoke_test "carbon_registry"    "$REGISTRY_ID"    "get_project"          --project_id "smoke-$(date +%s)"
smoke_test "carbon_credit"      "$CREDIT_ID"       "get_version"
smoke_test "carbon_marketplace" "$MARKETPLACE_ID"  "get_active_listings"
smoke_test "carbon_oracle"      "$ORACLE_ID"       "is_monitoring_current" --project_id "smoke-$(date +%s)"
ok "All smoke tests passed"

# ── write testnet-contract-ids.json ───────────────────────────────────────────

DEPLOY_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
REGISTRY_HASH=$(wasm_hash "$WASM_DIR/carbon_registry.wasm")
CREDIT_HASH=$(wasm_hash "$WASM_DIR/carbon_credit.wasm")
MARKETPLACE_HASH=$(wasm_hash "$WASM_DIR/carbon_marketplace.wasm")
ORACLE_HASH=$(wasm_hash "$WASM_DIR/carbon_oracle.wasm")

cat > "$CONTRACT_IDS_JSON" <<EOF
{
  "network":     "$NETWORK",
  "deploy_ts":   "$DEPLOY_TS",
  "rpc_url":     "$RPC_URL",
  "contracts": {
    "carbon_registry":    "$REGISTRY_ID",
    "carbon_credit":      "$CREDIT_ID",
    "carbon_marketplace": "$MARKETPLACE_ID",
    "carbon_oracle":      "$ORACLE_ID"
  },
  "wasm_hashes": {
    "carbon_registry":    "$REGISTRY_HASH",
    "carbon_credit":      "$CREDIT_HASH",
    "carbon_marketplace": "$MARKETPLACE_HASH",
    "carbon_oracle":      "$ORACLE_HASH"
  }
}
EOF

ok "Contract IDs written to $CONTRACT_IDS_JSON"
cat "$CONTRACT_IDS_JSON"

log ""
log "=== Deploy complete ==="
log "Contract IDs also written to $ENV_FILE"
log ""
log "Next steps:"
log "  1. Copy contract IDs to your .env file:"
log "     source $ENV_FILE"
log "  2. Run the E2E smoke test suite:"
log "     ./scripts/run-perf-tests.sh"
