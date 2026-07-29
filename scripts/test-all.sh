#!/bin/bash
# Run all tests including integration tests

set -e

echo "🧪 Running all tests..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Run unit tests
echo -e "${YELLOW}📦 Running unit tests...${NC}"
cargo test --workspace --lib

# Run integration tests
echo -e "${YELLOW}🔗 Running integration tests...${NC}"
cargo test --test lifecycle_integration_test -- --nocapture

# Run upgrade path tests
echo -e "${YELLOW}⬆️ Running upgrade path tests...${NC}"
cargo test --test upgrade_path_test -- --nocapture

# Run with coverage if available
if command -v cargo-tarpaulin &> /dev/null; then
    echo -e "${YELLOW}📊 Running coverage...${NC}"
    cargo tarpaulin --workspace --out Xml
fi

echo -e "${GREEN}✅ All tests passed!${NC}"
