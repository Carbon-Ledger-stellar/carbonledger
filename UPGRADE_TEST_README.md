# CarbonLedger Upgrade Path Test

This document describes the comprehensive upgrade path test for CarbonLedger smart contracts, testing the migration from v1 to v2 contracts on Stellar Testnet.

## Overview

The upgrade path test verifies:
- ✅ v1 contract deployment and functionality
- ✅ State preservation during upgrade
- ✅ v2 contract deployment and new features
- ✅ Retired credits remain retired after upgrade
- ✅ Access control (non-admin upgrade attempts fail)

## Prerequisites

1. **Install Rust and Soroban CLI**:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install --locked soroban-cli
cargo install stellar-cli
```

2. **Stellar Testnet Account**: Fund your testnet account at https://friendbot.stellar.org/

3. **Environment Variables** (optional, defaults provided in script):
```bash
export ADMIN_SECRET_KEY="your_admin_secret_key"
export ORACLE_SECRET_KEY="your_oracle_secret_key"  
export VERIFIER_SECRET_KEY="your_verifier_secret_key"
```

## Contract Versions

### v1 Contract (`carbon_registry_v1`)
- Basic project registration and verification
- Credit issuance and retirement
- Project lifecycle management
- Admin/verifier/oracle access control

### v2 Contract (`carbon_registry_v2`)
- All v1 functionality (backward compatible)
- **New Features**:
  - `certify_project()` - Add credit scores and certification
  - `get_version()` - Query contract version
  - `get_upgrade_history()` - Track upgrade history
  - New `Certified` project status
  - Enhanced project data structure with certification fields
- **Security**: Upgrade restricted to admin only

## Test Structure

### 1. Unit Tests
Location: `tests/upgrade_path_test.rs`

Tests included:
- `test_upgrade_path_v1_to_v2()` - Complete upgrade flow
- `test_state_preservation_after_upgrade()` - Data integrity
- `test_retired_credits_remain_retired()` - Retirement persistence
- `test_upgrade_by_non_admin_fails()` - Access control
- `test_new_v2_functions()` - New functionality verification

### 2. Integration Test Script
Location: `scripts/test_upgrade_path.sh`

Automated test that:
- Builds both contract versions
- Deploys v1 to testnet
- Creates test data (projects, credits, retirements)
- Deploys v2 to testnet
- Migrates state
- Verifies all acceptance criteria

## Running the Tests

### 1. Unit Tests (Local)
```bash
cd contracts
cargo test --package carbon_registry_v1 --package carbon_registry_v2 --package carbon_registry_v2 --test upgrade_path_test
```

### 2. Integration Test (Testnet)
```bash
# Make script executable
chmod +x scripts/test_upgrade_path.sh

# Run the complete test
./scripts/test_upgrade_path.sh
```

## Acceptance Criteria Verification

### ✅ Test runs on Testnet
The integration script deploys both contracts to Stellar Testnet and executes all test scenarios on the live network.

### ✅ State from v1 readable in v2
- Project data structure is backward compatible
- All v1 fields preserved in v2
- Migration process maintains data integrity

### ✅ Retired credits in v1 remain retired in v2
- Retirement amounts are preserved during upgrade
- Additional retirement attempts respect existing retirement amounts
- Over-retirement protection maintained

### ✅ Upgrade by non-admin → fails
- `upgrade_from_v1()` function requires admin authentication
- Non-admin attempts return `UnauthorizedUpgrade` error
- Access control enforced at contract level

## Test Data

The test uses the following sample project:
- **Project ID**: `proj-upgrade-test-001`
- **Name**: "Upgrade Test Forest Project"
- **Methodology**: VCS
- **Country**: Brazil
- **Type**: Forestry
- **Vintage Year**: 2023
- **Credits Issued**: 1000
- **Credits Retired**: 300
- **Credit Score (v2)**: 85

## Expected Output

Successful test execution should show:
```
🚀 Starting CarbonLedger Upgrade Path Test
==========================================
✅ v1 contract built successfully
✅ v2 contract built successfully
✅ v1 contract deployed: [CONTRACT_ID]
✅ v1 contract initialized
✅ Project registered in v1
✅ Project verified in v1
✅ Credits issued in v1
✅ Credits retired in v1
✅ v2 contract deployed: [CONTRACT_ID]
✅ v2 contract initialized
✅ Project migrated to v2
✅ New v2 function certify_project works
✅ Non-admin upgrade correctly rejected
✅ Over-retirement correctly rejected

🎉 Upgrade Path Test Completed Successfully!
==========================================
```

## Manual Testing Steps

For manual verification, follow these steps:

### 1. Deploy v1
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry_v1.wasm \
  --source $ADMIN_SECRET_KEY \
  --network testnet
```

### 2. Initialize v1
```bash
soroban contract invoke \
  --id $V1_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize \
  --admin $ADMIN_ADDRESS \
  --oracle $ORACLE_ADDRESS \
  --verifiers "[\"$VERIFIER_ADDRESS\"]"
```

### 3. Create Test Data
Register project, verify, issue credits, retire credits using v1 contract.

### 4. Deploy v2
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry_v2.wasm \
  --source $ADMIN_SECRET_KEY \
  --network testnet
```

### 5. Initialize v2 and Migrate
Initialize v2 with same accounts and re-register/migrate project data.

### 6. Verify
- Check state preservation
- Test new v2 functions
- Verify retirement persistence
- Test access controls

## Troubleshooting

### Common Issues

1. **"cargo not found"** - Install Rust: https://rustup.rs/
2. **"soroban not found"** - Install Soroban CLI: `cargo install soroban-cli`
3. **"Insufficient funds"** - Fund testnet account: https://friendbot.stellar.org/
4. **"Contract not found"** - Verify contract deployment succeeded
5. **"Auth required"** - Check secret keys and account addresses

### Debug Commands

```bash
# Check contract code
soroban contract read \
  --id $CONTRACT_ID \
  --network testnet

# Check account balance
stellar account balance $ACCOUNT_ADDRESS --network testnet

# Check transaction status
stellar transaction status $TRANSACTION_HASH --network testnet
```

## Security Considerations

- **Admin Keys**: Keep admin secret keys secure
- **Testnet Only**: Never run upgrade tests on mainnet without thorough audit
- **State Migration**: Ensure complete state backup before production upgrades
- **Access Control**: Verify all admin-only functions are properly protected

## Next Steps

After successful test completion:
1. Review test results and logs
2. Verify all acceptance criteria met
3. Document any edge cases or issues
4. Prepare for mainnet upgrade procedure
5. Schedule production upgrade window

## Files Created

- `contracts/carbon_registry_v1/` - v1 contract implementation
- `contracts/carbon_registry_v2/` - v2 contract implementation  
- `tests/upgrade_path_test.rs` - Unit test suite
- `scripts/test_upgrade_path.sh` - Integration test script
- `UPGRADE_TEST_README.md` - This documentation
