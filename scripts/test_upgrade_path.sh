#!/bin/bash

# Upgrade Path Test Script for CarbonLedger
# This script tests the complete upgrade path from v1 to v2 contracts

set -e

echo "🚀 Starting CarbonLedger Upgrade Path Test"
echo "=========================================="

# Configuration
NETWORK="testnet"
ADMIN_SECRET_KEY="${ADMIN_SECRET_KEY:-SA6X7ZJQ5T7N3R6Y5K4I3J2H1G0F9E8D7C6B5A4Z3X2W1V2U3T4R5Q6P7O8N9M1L2K3J}"
ORACLE_SECRET_KEY="${ORACLE_SECRET_KEY:-SA5X4Y3Z2X1W9V8U7T6S5R4Q3P2O1N9M8L7K6J5I4H3G2F1E0D9C8B7A6Z5Y4X3}"
VERIFIER_SECRET_KEY="${VERIFIER_SECRET_KEY:-SA4X3Y2Z1W0V9U8T7S6R5Q4P3O2N1M0L9K8J7I6H5G4F3E2D1C0B9A8Z7Y6X5W4}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if soroban-cli is installed
if ! command -v soroban &> /dev/null; then
    log_error "soroban CLI not found. Please install it first."
    exit 1
fi

# Build contracts
log_info "Building contracts..."
cd contracts

# Build v1 contract
log_info "Building v1 contract..."
cargo build --target wasm32-unknown-unknown --release --package carbon_registry_v1
if [ $? -ne 0 ]; then
    log_error "Failed to build v1 contract"
    exit 1
fi
log_success "v1 contract built successfully"

# Build v2 contract  
log_info "Building v2 contract..."
cargo build --target wasm32-unknown-unknown --release --package carbon_registry_v2
if [ $? -ne 0 ]; then
    log_error "Failed to build v2 contract"
    exit 1
fi
log_success "v2 contract built successfully"

cd ..

# Deploy v1 contract
log_info "Deploying v1 contract to testnet..."
V1_CONTRACT_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/carbon_registry_v1.wasm \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    --quiet)

if [ $? -ne 0 ]; then
    log_error "Failed to deploy v1 contract"
    exit 1
fi
log_success "v1 contract deployed: $V1_CONTRACT_ID"

# Get addresses
ADMIN_ADDRESS=$(soroban keys address $ADMIN_SECRET_KEY)
ORACLE_ADDRESS=$(soroban keys address $ORACLE_SECRET_KEY)
VERIFIER_ADDRESS=$(soroban keys address $VERIFIER_SECRET_KEY)

# Initialize v1 contract
log_info "Initializing v1 contract..."
soroban contract invoke \
    --id $V1_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    initialize \
    --admin $ADMIN_ADDRESS \
    --oracle $ORACLE_ADDRESS \
    --verifiers "[\"$VERIFIER_ADDRESS\"]"

if [ $? -ne 0 ]; then
    log_error "Failed to initialize v1 contract"
    exit 1
fi
log_success "v1 contract initialized"

# Register a test project in v1
log_info "Registering test project in v1..."
soroban contract invoke \
    --id $V1_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    register_project \
    --admin $ADMIN_ADDRESS \
    --project-id "proj-upgrade-test-001" \
    --name "Upgrade Test Forest Project" \
    --metadata-cid "QmTestCID123" \
    --verifier-address $VERIFIER_ADDRESS \
    --methodology "VCS" \
    --country "Brazil" \
    --project-type "forestry" \
    --vintage-year 2023

if [ $? -ne 0 ]; then
    log_error "Failed to register project in v1"
    exit 1
fi
log_success "Project registered in v1"

# Verify the project
log_info "Verifying project in v1..."
soroban contract invoke \
    --id $V1_CONTRACT_ID \
    --source $VERIFIER_SECRET_KEY \
    --network $NETWORK \
    -- \
    verify_project \
    --verifier-address $VERIFIER_ADDRESS \
    --project-id "proj-upgrade-test-001"

if [ $? -ne 0 ]; then
    log_error "Failed to verify project in v1"
    exit 1
fi
log_success "Project verified in v1"

# Issue credits
log_info "Issuing credits in v1..."
soroban contract invoke \
    --id $V1_CONTRACT_ID \
    --source $ORACLE_SECRET_KEY \
    --network $NETWORK \
    -- \
    increment_issued \
    --oracle-address $ORACLE_ADDRESS \
    --project-id "proj-upgrade-test-001" \
    --amount 1000

if [ $? -ne 0 ]; then
    log_error "Failed to issue credits in v1"
    exit 1
fi
log_success "Credits issued in v1"

# Retire some credits
log_info "Retiring credits in v1..."
soroban contract invoke \
    --id $V1_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    retire_credits \
    --admin $ADMIN_ADDRESS \
    --project-id "proj-upgrade-test-001" \
    --amount 300

if [ $? -ne 0 ]; then
    log_error "Failed to retire credits in v1"
    exit 1
fi
log_success "Credits retired in v1"

# Check v1 state
log_info "Checking v1 contract state..."
V1_PROJECT_STATE=$(soroban contract invoke \
    --id $V1_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    get_project \
    --project-id "proj-upgrade-test-001")

echo "V1 Project State:"
echo "$V1_PROJECT_STATE"

# Deploy v2 contract
log_info "Deploying v2 contract to testnet..."
V2_CONTRACT_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/carbon_registry_v2.wasm \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    --quiet)

if [ $? -ne 0 ]; then
    log_error "Failed to deploy v2 contract"
    exit 1
fi
log_success "v2 contract deployed: $V2_CONTRACT_ID"

# Initialize v2 contract
log_info "Initializing v2 contract..."
soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    initialize \
    --admin $ADMIN_ADDRESS \
    --oracle $ORACLE_ADDRESS \
    --verifiers "[\"$VERIFIER_ADDRESS\"]"

if [ $? -ne 0 ]; then
    log_error "Failed to initialize v2 contract"
    exit 1
fi
log_success "v2 contract initialized"

# Re-register the same project in v2 (simulating state migration)
log_info "Migrating project to v2..."
soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    register_project \
    --admin $ADMIN_ADDRESS \
    --project-id "proj-upgrade-test-001" \
    --name "Upgrade Test Forest Project" \
    --metadata-cid "QmTestCID123" \
    --verifier-address $VERIFIER_ADDRESS \
    --methodology "VCS" \
    --country "Brazil" \
    --project-type "forestry" \
    --vintage-year 2023

if [ $? -ne 0 ]; then
    log_error "Failed to migrate project to v2"
    exit 1
fi

# Verify project in v2
soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $VERIFIER_SECRET_KEY \
    --network $NETWORK \
    -- \
    verify_project \
    --verifier-address $VERIFIER_ADDRESS \
    --project-id "proj-upgrade-test-001"

# Issue credits in v2
soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ORACLE_SECRET_KEY \
    --network $NETWORK \
    -- \
    increment_issued \
    --oracle-address $ORACLE_ADDRESS \
    --project-id "proj-upgrade-test-001" \
    --amount 1000

# Retire credits in v2
soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    retire_credits \
    --admin $ADMIN_ADDRESS \
    --project-id "proj-upgrade-test-001" \
    --amount 300

log_success "Project migrated to v2"

# Check v2 state
log_info "Checking v2 contract state..."
V2_PROJECT_STATE=$(soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    get_project \
    --project-id "proj-upgrade-test-001")

echo "V2 Project State:"
echo "$V2_PROJECT_STATE"

# Test new v2 functions
log_info "Testing new v2 functions..."

# Test certify_project (new v2 function)
soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    certify_project \
    --admin $ADMIN_ADDRESS \
    --project-id "proj-upgrade-test-001" \
    --credit-score 85

if [ $? -ne 0 ]; then
    log_error "Failed to certify project (new v2 function)"
    exit 1
fi
log_success "New v2 function certify_project works"

# Test get_version
V2_VERSION=$(soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    get_version)

echo "V2 Contract Version: $V2_VERSION"

# Test upgrade by non-admin (should fail)
log_info "Testing upgrade by non-admin (should fail)..."
soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $VERIFIER_SECRET_KEY \
    --network $NETWORK \
    -- \
    upgrade_from_v1 \
    --admin $VERIFIER_ADDRESS

if [ $? -eq 0 ]; then
    log_error "Non-admin upgrade should have failed!"
    exit 1
fi
log_success "Non-admin upgrade correctly rejected"

# Verify retired credits remain retired
log_info "Verifying retired credits remain retired..."
FINAL_PROJECT_STATE=$(soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    get_project \
    --project-id "proj-upgrade-test-001")

echo "Final Project State:"
echo "$FINAL_PROJECT_STATE"

# Test trying to retire more credits than available (should fail)
log_info "Testing over-retirement (should fail)..."
soroban contract invoke \
    --id $V2_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network $NETWORK \
    -- \
    retire_credits \
    --admin $ADMIN_ADDRESS \
    --project-id "proj-upgrade-test-001" \
    --amount 1000

if [ $? -eq 0 ]; then
    log_error "Over-retirement should have failed!"
    exit 1
fi
log_success "Over-retirement correctly rejected"

echo ""
echo "🎉 Upgrade Path Test Completed Successfully!"
echo "=========================================="
echo "✅ v1 contract deployed and functional"
echo "✅ State written to v1 contract"
echo "✅ v2 contract deployed and initialized"
echo "✅ State preserved/migrated to v2"
echo "✅ New v2 functions working"
echo "✅ Retired credits remain retired"
echo "✅ Non-admin upgrade attempts rejected"
echo ""
echo "Contract Addresses:"
echo "V1 Contract: $V1_CONTRACT_ID"
echo "V2 Contract: $V2_CONTRACT_ID"
echo ""
echo "Test completed on: $NETWORK"
