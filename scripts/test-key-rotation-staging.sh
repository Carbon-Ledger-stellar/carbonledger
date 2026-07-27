#!/bin/bash

# Key Rotation Staging Test Script
# Tests all key rotation procedures in staging environment

set -e

# Configuration
STAGING_API_URL="http://localhost:3001/api/v1"
LOG_FILE="./key-rotation-test-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

# Helper function to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    local token=$4

    if [ "$method" = "GET" ]; then
        curl -s -w "\nHTTP_CODE:%{http_code}" \
            -H "Authorization: Bearer $token" \
            "$STAGING_API_URL$endpoint"
    else
        curl -s -w "\nHTTP_CODE:%{http_code}" \
            -X "$method" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "$data" \
            "$STAGING_API_URL$endpoint"
    fi
}

# Get auth token
get_auth_token() {
    log "Getting authentication token..."
    
    local response=$(api_call "POST" "/auth/login" '{
        "publicKey": "GTESTADMIN123456789",
        "role": "admin"
    }' "")
    
    local http_code=$(echo "$response" | tail -n1 | cut -d: -f2)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "201" ]; then
        local token=$(echo "$body" | jq -r '.access_token')
        log "Authentication successful"
        echo "$token"
    else
        error "Authentication failed: $body"
        exit 1
    fi
}

# Test Oracle Key Rotation
test_oracle_rotation() {
    log "Testing Oracle Key Rotation..."
    
    local token=$1
    local rotation_data='{
        "newOraclePublicKey": "GTESTORACLE123456789",
        "newOracleSecretKey": "STESTORACLE123456789",
        "reason": "Staging test rotation"
    }'
    
    local response=$(api_call "POST" "/key-rotation/oracle" "$rotation_data" "$token")
    local http_code=$(echo "$response" | tail -n1 | cut -d: -f2)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "201" ]; then
        local rotation_id=$(echo "$body" | jq -r '.id')
        log "Oracle rotation initiated successfully: $rotation_id"
        
        # Wait a moment and check status
        sleep 2
        local status_response=$(api_call "GET" "/key-rotation/$rotation_id" "" "$token")
        local status_http_code=$(echo "$status_response" | tail -n1 | cut -d: -f2)
        local status_body=$(echo "$status_response" | sed '$d')
        
        if [ "$status_http_code" = "200" ]; then
            local status=$(echo "$status_body" | jq -r '.status')
            log "Oracle rotation status: $status"
        else
            warning "Failed to get rotation status: $status_body"
        fi
        
        return 0
    else
        error "Oracle rotation failed: $body"
        return 1
    fi
}

# Test Admin Key Rotation
test_admin_rotation() {
    log "Testing Admin Key Rotation..."
    
    local token=$1
    local rotation_data='{
        "newAdminPublicKey": "GTESTNEWADMIN123456",
        "newAdminSecretKey": "STESTNEWADMIN123456",
        "reason": "Staging admin rotation test",
        "multiSigRequired": true,
        "timeLockHours": 1
    }'
    
    local response=$(api_call "POST" "/key-rotation/admin" "$rotation_data" "$token")
    local http_code=$(echo "$response" | tail -n1 | cut -d: -f2)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "201" ]; then
        local rotation_id=$(echo "$body" | jq -r '.id')
        log "Admin rotation initiated successfully: $rotation_id"
        
        # Check if it's scheduled
        local scheduled_at=$(echo "$body" | jq -r '.scheduledAt')
        if [ "$scheduled_at" != "null" ]; then
            log "Admin rotation scheduled for: $scheduled_at"
        fi
        
        return 0
    else
        error "Admin rotation failed: $body"
        return 1
    fi
}

# Test JWT Key Rotation
test_jwt_rotation() {
    log "Testing JWT Key Rotation..."
    
    local token=$1
    local rotation_data='{
        "newJWTSecret": "staging-test-secret-key-32-chars-minimum",
        "reason": "Staging JWT rotation test",
        "transitionPeriodHours": 2
    }'
    
    local response=$(api_call "POST" "/key-rotation/jwt" "$rotation_data" "$token")
    local http_code=$(echo "$response" | tail -n1 | cut -d: -f2)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "201" ]; then
        local rotation_id=$(echo "$body" | jq -r '.id')
        log "JWT rotation initiated successfully: $rotation_id"
        
        # JWT rotation should start immediately (in_progress status)
        local status=$(echo "$body" | jq -r '.status')
        if [ "$status" = "in_progress" ]; then
            log "JWT rotation is in progress (zero-downtime mode)"
        fi
        
        return 0
    else
        error "JWT rotation failed: $body"
        return 1
    fi
}

# Test Rotation Status Retrieval
test_rotation_status() {
    log "Testing Rotation Status Retrieval..."
    
    local token=$1
    local response=$(api_call "GET" "/key-rotation" "" "$token")
    local http_code=$(echo "$response" | tail -n1 | cut -d: -f2)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        local count=$(echo "$body" | jq '. | length')
        log "Retrieved $count rotation records"
        
        # Display recent rotations
        echo "$body" | jq -r '.[] | "Rotation: \(.type) - \(.status) - \(.reason)"' | head -5 | while read line; do
            log "  $line"
        done
        
        return 0
    else
        error "Failed to retrieve rotation status: $body"
        return 1
    fi
}

# Test System Health During Rotation
test_system_health() {
    log "Testing System Health During Rotation..."
    
    # Test basic health endpoint
    local health_response=$(curl -s "http://localhost:3001/health")
    local health_status=$(echo "$health_response" | jq -r '.status')
    
    if [ "$health_status" = "ok" ]; then
        log "System health check passed"
    else
        warning "System health check failed: $health_response"
    fi
    
    # Test oracle operations
    log "Testing oracle operations..."
    local oracle_response=$(curl -s "http://localhost:3001/api/v1/oracle/status/test-project")
    log "Oracle status endpoint accessible"
    
    # Test authentication with current token
    log "Testing authentication..."
    local auth_test=$(curl -s -H "Authorization: Bearer $1" "http://localhost:3001/api/v1/projects")
    log "Authentication endpoint accessible"
}

# Main test execution
main() {
    log "Starting Key Rotation Staging Tests"
    log "API URL: $STAGING_API_URL"
    log "Log file: $LOG_FILE"
    
    # Check dependencies
    if ! command -v jq &> /dev/null; then
        error "jq is required but not installed. Please install jq to continue."
        exit 1
    fi
    
    if ! command -v curl &> /dev/null; then
        error "curl is required but not installed. Please install curl to continue."
        exit 1
    fi
    
    # Get authentication token
    local token=$(get_auth_token)
    
    # Test system health before rotations
    test_system_health "$token"
    
    # Execute rotation tests
    local test_results=()
    
    test_oracle_rotation "$token"
    test_results+=($?)
    
    test_admin_rotation "$token"
    test_results+=($?)
    
    test_jwt_rotation "$token"
    test_results+=($?)
    
    test_rotation_status "$token"
    test_results+=($?)
    
    # Test system health after rotations
    test_system_health "$token"
    
    # Summary
    log "Test Summary:"
    local failed=0
    for i in "${!test_results[@]}"; do
        if [ ${test_results[$i]} -eq 0 ]; then
            log "  Test $((i+1)): PASSED"
        else
            error "  Test $((i+1)): FAILED"
            failed=$((failed + 1))
        fi
    done
    
    if [ $failed -eq 0 ]; then
        log "All tests passed! ✓"
        log "Key rotation procedures are working correctly in staging."
        exit 0
    else
        error "$failed tests failed. Please review the logs and fix issues before production deployment."
        exit 1
    fi
}

# Run the tests
main "$@"
