#!/bin/bash

# CarbonLedger - Run All Tests
# This script runs all test suites across the project

set -e  # Exit on error

echo "🧪 CarbonLedger Test Suite"
echo "=========================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track failures
FAILED=0

# Function to run tests and track results
run_test() {
    local name=$1
    local command=$2
    
    echo -e "${YELLOW}Running $name...${NC}"
    if eval "$command"; then
        echo -e "${GREEN}✓ $name passed${NC}"
        echo ""
    else
        echo -e "${RED}✗ $name failed${NC}"
        echo ""
        FAILED=$((FAILED + 1))
    fi
}

# 1. Rust Contract Tests
echo "📦 Testing Soroban Contracts"
echo "----------------------------"
run_test "Carbon Registry Tests" "cd contracts && cargo test -p carbon_registry --quiet"
run_test "Carbon Credit Tests" "cd contracts && cargo test -p carbon_credit --quiet"
run_test "Carbon Marketplace Tests" "cd contracts && cargo test -p carbon_marketplace --quiet"
run_test "Carbon Oracle Tests" "cd contracts && cargo test -p carbon_oracle --quiet"

# 2. Backend Tests
echo "🔧 Testing Backend (NestJS)"
echo "---------------------------"
run_test "Backend Unit Tests" "cd backend && npm test --silent"

# 3. Frontend Tests
echo "🎨 Testing Frontend (Next.js)"
echo "-----------------------------"
run_test "Frontend Unit Tests" "cd frontend && npm test --silent"

# Summary
echo "=========================="
echo "📊 Test Summary"
echo "=========================="

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    echo ""
    echo "You're ready to contribute! 🚀"
    exit 0
else
    echo -e "${RED}$FAILED test suite(s) failed ✗${NC}"
    echo ""
    echo "Please fix the failing tests before submitting a PR."
    echo "See CONTRIBUTING.md for troubleshooting help."
    exit 1
fi
