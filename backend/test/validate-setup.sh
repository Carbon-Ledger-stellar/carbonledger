#!/bin/bash

# Integration Tests Setup Validation Script
# This script validates that all test infrastructure is properly configured

set -e

echo "🔍 Validating Integration Tests Setup..."
echo ""

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must be run from backend directory"
    exit 1
fi

echo "✅ Running from backend directory"

# Check required files exist
echo ""
echo "📁 Checking required files..."

required_files=(
    "jest.config.js"
    "test/jest-e2e.json"
    "test/test-helpers.ts"
    "test/auth.e2e-spec.ts"
    "test/rbac.e2e-spec.ts"
    "test/certificate.e2e-spec.ts"
    "docker-compose.test.yml"
    ".env.test"
)

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ $file"
    else
        echo "  ❌ Missing: $file"
        exit 1
    fi
done

# Check package.json has required scripts
echo ""
echo "📜 Checking package.json scripts..."

required_scripts=(
    "test:e2e"
    "test:db:up"
    "test:db:down"
    "test:db:migrate"
)

for script in "${required_scripts[@]}"; do
    if grep -q "\"$script\"" package.json; then
        echo "  ✅ $script"
    else
        echo "  ❌ Missing script: $script"
        exit 1
    fi
done

# Check if Docker is running
echo ""
echo "🐳 Checking Docker..."

if ! docker info > /dev/null 2>&1; then
    echo "  ⚠️  Docker is not running or not installed"
    echo "     Tests require Docker to run the PostgreSQL test database"
    exit 1
fi

echo "  ✅ Docker is running"

# Check if node_modules exists
echo ""
echo "📦 Checking dependencies..."

if [ ! -d "node_modules" ]; then
    echo "  ⚠️  node_modules not found"
    echo "     Run: npm install"
    exit 1
fi

echo "  ✅ Dependencies installed"

# Check if test dependencies are installed
if [ ! -d "node_modules/jest" ]; then
    echo "  ❌ Jest not installed"
    echo "     Run: npm install"
    exit 1
fi

if [ ! -d "node_modules/supertest" ]; then
    echo "  ❌ Supertest not installed"
    echo "     Run: npm install"
    exit 1
fi

echo "  ✅ Test dependencies installed"

# Check if Prisma client is generated
echo ""
echo "🔧 Checking Prisma..."

if [ ! -d "node_modules/.prisma/client" ]; then
    echo "  ⚠️  Prisma client not generated"
    echo "     Run: npx prisma generate"
    exit 1
fi

echo "  ✅ Prisma client generated"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ All checks passed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🚀 Ready to run tests:"
echo "   npm run test:e2e"
echo ""
echo "📚 Documentation:"
echo "   test/README.md"
echo "   test/QUICK_START.md"
echo ""
