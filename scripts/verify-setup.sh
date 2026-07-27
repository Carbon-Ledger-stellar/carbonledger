#!/bin/bash

# CarbonLedger - Setup Verification Script
# Checks if all prerequisites are installed correctly

echo "🔍 CarbonLedger Setup Verification"
echo "==================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

# Check function
check_command() {
    local cmd=$1
    local name=$2
    local required_version=$3
    
    if command -v $cmd &> /dev/null; then
        local version=$($cmd --version 2>&1 | head -n 1)
        echo -e "${GREEN}✓${NC} $name: $version"
    else
        echo -e "${RED}✗${NC} $name: Not found"
        echo "   Install from: $4"
        ERRORS=$((ERRORS + 1))
    fi
}

# Check version
check_version() {
    local cmd=$1
    local name=$2
    local min_version=$3
    local current_version=$4
    
    if [ -z "$current_version" ]; then
        echo -e "${YELLOW}⚠${NC} $name: Version check skipped"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${GREEN}✓${NC} $name: $current_version"
    fi
}

echo "📋 Checking Prerequisites"
echo "-------------------------"

# Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓${NC} Node.js: $NODE_VERSION"
    
    # Check if version is 18 or 20
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [ "$MAJOR_VERSION" -lt 18 ]; then
        echo -e "${YELLOW}⚠${NC} Warning: Node.js 18+ recommended (you have v$MAJOR_VERSION)"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗${NC} Node.js: Not found"
    echo "   Install from: https://nodejs.org"
    ERRORS=$((ERRORS + 1))
fi

# npm
check_command "npm" "npm" "" "https://nodejs.org"

# Rust
if command -v rustc &> /dev/null; then
    RUST_VERSION=$(rustc --version)
    echo -e "${GREEN}✓${NC} Rust: $RUST_VERSION"
else
    echo -e "${RED}✗${NC} Rust: Not found"
    echo "   Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    ERRORS=$((ERRORS + 1))
fi

# Cargo
check_command "cargo" "Cargo" "" "https://rustup.rs"

# Python
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo -e "${GREEN}✓${NC} Python: $PYTHON_VERSION"
    
    # Check if version is 3.10+
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d'.' -f2)
    if [ "$PYTHON_MINOR" -lt 10 ]; then
        echo -e "${YELLOW}⚠${NC} Warning: Python 3.10+ recommended"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗${NC} Python: Not found"
    echo "   Install from: https://python.org"
    ERRORS=$((ERRORS + 1))
fi

# PostgreSQL
if command -v psql &> /dev/null; then
    PSQL_VERSION=$(psql --version)
    echo -e "${GREEN}✓${NC} PostgreSQL: $PSQL_VERSION"
else
    echo -e "${RED}✗${NC} PostgreSQL: Not found"
    echo "   Install from: https://postgresql.org"
    ERRORS=$((ERRORS + 1))
fi

# Docker (optional)
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo -e "${GREEN}✓${NC} Docker: $DOCKER_VERSION"
else
    echo -e "${YELLOW}⚠${NC} Docker: Not found (optional)"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "🔧 Checking Rust Toolchain"
echo "--------------------------"

# wasm32 target
if rustup target list | grep -q "wasm32-unknown-unknown (installed)"; then
    echo -e "${GREEN}✓${NC} wasm32-unknown-unknown target installed"
else
    echo -e "${RED}✗${NC} wasm32-unknown-unknown target not installed"
    echo "   Run: rustup target add wasm32-unknown-unknown"
    ERRORS=$((ERRORS + 1))
fi

# Stellar CLI
if command -v stellar &> /dev/null; then
    STELLAR_VERSION=$(stellar --version)
    echo -e "${GREEN}✓${NC} Stellar CLI: $STELLAR_VERSION"
else
    echo -e "${YELLOW}⚠${NC} Stellar CLI: Not found (needed for deployment)"
    echo "   Run: cargo install --locked stellar-cli"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "🗄️  Checking Database"
echo "---------------------"

# Check if PostgreSQL is running
if pg_isready -h localhost -p 5432 &> /dev/null; then
    echo -e "${GREEN}✓${NC} PostgreSQL is running"
    
    # Check if database exists
    if psql -h localhost -U carbonledger -d carbonledger -c '\q' 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Database 'carbonledger' exists"
    else
        echo -e "${YELLOW}⚠${NC} Database 'carbonledger' not found"
        echo "   Run: createdb carbonledger"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗${NC} PostgreSQL is not running"
    echo "   macOS: brew services start postgresql@16"
    echo "   Linux: sudo systemctl start postgresql"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "📦 Checking Dependencies"
echo "------------------------"

# Backend node_modules
if [ -d "backend/node_modules" ]; then
    echo -e "${GREEN}✓${NC} Backend dependencies installed"
else
    echo -e "${YELLOW}⚠${NC} Backend dependencies not installed"
    echo "   Run: cd backend && npm install"
    WARNINGS=$((WARNINGS + 1))
fi

# Frontend node_modules
if [ -d "frontend/node_modules" ]; then
    echo -e "${GREEN}✓${NC} Frontend dependencies installed"
else
    echo -e "${YELLOW}⚠${NC} Frontend dependencies not installed"
    echo "   Run: cd frontend && npm install"
    WARNINGS=$((WARNINGS + 1))
fi

# Contracts build
if [ -d "contracts/target" ]; then
    echo -e "${GREEN}✓${NC} Contracts built"
else
    echo -e "${YELLOW}⚠${NC} Contracts not built"
    echo "   Run: cd contracts && cargo build --target wasm32-unknown-unknown --release"
    WARNINGS=$((WARNINGS + 1))
fi

# Python packages
if python3 -c "import stellar_sdk" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Python dependencies installed"
else
    echo -e "${YELLOW}⚠${NC} Python dependencies not installed"
    echo "   Run: cd oracle && pip3 install -r requirements.txt"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "📄 Checking Configuration"
echo "-------------------------"

# .env file
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} .env file exists"
    
    # Check critical variables
    if grep -q "DATABASE_URL=" .env && [ -n "$(grep DATABASE_URL= .env | cut -d'=' -f2)" ]; then
        echo -e "${GREEN}✓${NC} DATABASE_URL configured"
    else
        echo -e "${YELLOW}⚠${NC} DATABASE_URL not set in .env"
        WARNINGS=$((WARNINGS + 1))
    fi
    
    if grep -q "JWT_SECRET=" .env && [ -n "$(grep JWT_SECRET= .env | cut -d'=' -f2)" ]; then
        echo -e "${GREEN}✓${NC} JWT_SECRET configured"
    else
        echo -e "${YELLOW}⚠${NC} JWT_SECRET not set in .env"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗${NC} .env file not found"
    echo "   Run: cp .env.example .env"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "==================================="
echo "📊 Summary"
echo "==================================="

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "You're ready to run tests:"
    echo "  ./scripts/test-all.sh"
    echo ""
    echo "Or start developing:"
    echo "  cd backend && npm run start:dev"
    echo "  cd frontend && npm run dev"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Setup complete with $WARNINGS warning(s)${NC}"
    echo ""
    echo "You can proceed, but some features may not work."
    echo "See CONTRIBUTING.md for detailed setup instructions."
    exit 0
else
    echo -e "${RED}✗ Setup incomplete: $ERRORS error(s), $WARNINGS warning(s)${NC}"
    echo ""
    echo "Please fix the errors above before continuing."
    echo "See CONTRIBUTING.md for detailed setup instructions."
    exit 1
fi
