#!/usr/bin/env bash
# scripts/deploy-testnet.sh — deploy all CarbonLedger contracts to Stellar testnet,
# initialize them in dependency order, and run an end-to-end smoke test.
#
# Usage:
#   ADMIN_SECRET_KEY=S... ORACLE_SECRET_KEY=S... ./scripts/deploy-testnet.sh
#
# Outputs contract IDs to .env.testnet (idempotent — skips deploy if ID already present).
#
# Requirements: stellar-cli (cargo install stellar-cli), jq, curl
set -euo pipefail

NETWORK="testnet"
RPC_URL="https://soroban-testnet.stellar.org"
HORIZON_URL="https://horizon-testnet.stellar.org"
PASSPHRASE="Test SDF Network ; September 2015"
ENV_FILE=".env.testnet"
WASM_DIR="contracts/target/wasm32-unknown-unknown/release"

: "${ADMIN_SECRET_KEY:?ADMIN_SECRET_KEY is required}"
: "${ORACLE_SECRET_KEY:?ORACLE_SECRET_KEY is required}"

log()  { echo "[$(date -u +%H:%M:%S)] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

# ── helpers ──────────────────────────────────────────────────────────────────

get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true; }

set_env() {
  local key=$1 val=$2
  if grep -qE "^$key=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^$key=.*|$key=$val|" "$ENV_FILE"
  else
    echo "$key=$val" >> "$ENV_FILE"
  fi
}

deploy_contract() {
  local name=$1 wasm="$WASM_DIR/${name}.wasm"
  local existing; existing=$(get_env "${name^^}_CONTRACT_ID")
  if [ -n "$existing" ]; then
    log "$name already deployed: $existing (skipping)"
    echo "$existing"
    return
  fi
  log "Deploying $name..."
  local id
  id=$(stellar contract deploy \
    --wasm "$wasm" \
    --source "$ADMIN_SECRET_KEY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$PASSPHRASE" 2>/dev/null)
  log "$name → $id"
  set_env "${name^^}_CONTRACT_ID" "$id"
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

# ── build ─────────────────────────────────────────────────────────────────────

log "Building contracts..."
(cd contracts && cargo build --target wasm32-unknown-unknown --release --workspace -q)

# ── deploy ────────────────────────────────────────────────────────────────────

touch "$ENV_FILE"

REGISTRY_ID=$(deploy_contract carbon_registry)
CREDIT_ID=$(deploy_contract carbon_credit)
MARKETPLACE_ID=$(deploy_contract carbon_marketplace)
ORACLE_ID=$(deploy_contract carbon_oracle)

ADMIN_PK=$(stellar keys address "$ADMIN_SECRET_KEY" 2>/dev/null || \
  stellar keys show --secret "$ADMIN_SECRET_KEY" 2>/dev/null | grep Public | awk '{print $2}')
ORACLE_PK=$(stellar keys address "$ORACLE_SECRET_KEY" 2>/dev/null || \
  stellar keys show --secret "$ORACLE_SECRET_KEY" 2>/dev/null | grep Public | awk '{print $2}')

set_env "STELLAR_NETWORK"    "$NETWORK"
set_env "STELLAR_RPC_URL"    "$RPC_URL"
set_env "STELLAR_HORIZON_URL" "$HORIZON_URL"
set_env "NETWORK_PASSPHRASE" "$PASSPHRASE"
set_env "ADMIN_PUBLIC_KEY"   "$ADMIN_PK"
set_env "ORACLE_PUBLIC_KEY"  "$ORACLE_PK"

# ── initialize (idempotent — contracts guard against double-init) ──────────────

log "Initializing carbon_registry..."
invoke "$REGISTRY_ID" initialize --admin "$ADMIN_PK" || log "registry already initialized"

log "Initializing carbon_credit..."
invoke "$CREDIT_ID" initialize --admin "$ADMIN_PK" --registry "$REGISTRY_ID" || log "credit already initialized"

log "Initializing carbon_marketplace..."
invoke "$MARKETPLACE_ID" initialize --admin "$ADMIN_PK" --credit_contract "$CREDIT_ID" || log "marketplace already initialized"

log "Initializing carbon_oracle..."
invoke "$ORACLE_ID" initialize --admin "$ADMIN_PK" --oracle "$ORACLE_PK" --registry "$REGISTRY_ID" || log "oracle already initialized"

# ── smoke test ────────────────────────────────────────────────────────────────

log "=== Smoke test: register → mint → list → buy → retire ==="

PROJECT_ID="SMOKE-$(date +%s)"
VERIFIER_PK="$ADMIN_PK"   # admin acts as verifier on testnet

log "1. Register project..."
invoke "$REGISTRY_ID" register_project \
  --project_id "$PROJECT_ID" \
  --developer "$ADMIN_PK" \
  --methodology "VCS-VM0015" \
  --coordinates '{"lat":"-3.4653","lon":"-62.2159"}' \
  --description "Smoke test project"

log "2. Verify project (admin as verifier)..."
invoke "$REGISTRY_ID" verify_project \
  --project_id "$PROJECT_ID" \
  --verifier "$VERIFIER_PK"

log "3. Mint credits..."
BATCH_ID=$(invoke "$CREDIT_ID" mint_credits \
  --project_id "$PROJECT_ID" \
  --amount 100 \
  --vintage_year 2024 \
  --serial_start 1 \
  --serial_end 100)
log "   batch_id=$BATCH_ID"

log "4. List credits on marketplace..."
invoke "$MARKETPLACE_ID" list_credits \
  --batch_id "$BATCH_ID" \
  --amount 10 \
  --price_per_tonne 1500000   # 1.50 USDC (7 decimals)

log "5. Purchase credits..."
invoke "$MARKETPLACE_ID" purchase_credits \
  --batch_id "$BATCH_ID" \
  --amount 5 \
  --buyer "$ADMIN_PK"

log "6. Retire credits..."
CERT=$(invoke "$CREDIT_ID" retire_credits \
  --batch_id "$BATCH_ID" \
  --amount 5 \
  --beneficiary "$ADMIN_PK" \
  --reason "Smoke test retirement")
log "   certificate=$CERT"

log "=== Smoke test PASSED ==="
log ""
log "Contract IDs written to $ENV_FILE:"
cat "$ENV_FILE"
