#!/bin/bash

# Disaster Recovery Test Script for CarbonLedger
# Simulates DB loss and verifies reconstruction from on-chain events

set -e

echo "🚨 Starting Disaster Recovery Test"
echo "==================================="

# Configuration
DB_URL="${DATABASE_URL:-postgresql://carbonledger:changeme@localhost:5432/carbonledger}"
BACKUP_FILE="/tmp/db_backup.sql"
RECONSTRUCTED_DUMP="/tmp/db_reconstructed.sql"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Step 1: Backup current DB state
log_info "Backing up current database state..."
pg_dump "$DB_URL" > "$BACKUP_FILE"
log_success "Database backup created at $BACKUP_FILE"

# Step 2: Drop the database
log_info "Simulating database loss by dropping all data..."
psql "$DB_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO carbonledger; GRANT ALL ON SCHEMA public TO public;"
log_success "Database dropped and recreated"

# Step 3: Run Prisma migrations to recreate schema
log_info "Recreating database schema..."
cd backend
npx prisma migrate deploy
log_success "Schema recreated"

# Step 4: Run the indexer from genesis
log_info "Running indexer to reconstruct state from on-chain events..."
START_TIME=$(date +%s)
npx ts-node src/indexer.ts
END_TIME=$(date +%s)
RECOVERY_TIME=$((END_TIME - START_TIME))
log_success "Indexing completed in $RECOVERY_TIME seconds"

# Step 5: Dump reconstructed DB
log_info "Dumping reconstructed database..."
pg_dump "$DB_URL" > "$RECONSTRUCTED_DUMP"
log_success "Reconstructed DB dumped to $RECONSTRUCTED_DUMP"

# Step 6: Compare the dumps
log_info "Comparing original and reconstructed databases..."
if diff "$BACKUP_FILE" "$RECONSTRUCTED_DUMP" > /dev/null; then
    log_success "✅ Databases match exactly!"
else
    log_error "❌ Databases do not match"
    diff "$BACKUP_FILE" "$RECONSTRUCTED_DUMP" | head -20
    exit 1
fi

# Step 7: Document recovery time
log_info "Recovery Time: $RECOVERY_TIME seconds"
if [ $RECOVERY_TIME -lt 14400 ]; then  # 4 hours = 14400 seconds
    log_success "✅ Recovery time is under 4 hours target"
else
    log_error "❌ Recovery time exceeds 4 hours target"
fi

echo ""
echo "🎉 Disaster Recovery Test Completed Successfully!"
echo "Recovery Time: $RECOVERY_TIME seconds"
echo "All projects, batches, and retirements reconstructed."
echo "Reconstructed data matches original exactly."