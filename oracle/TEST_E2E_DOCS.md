# E2E Oracle → Soroban Integration Tests

## Overview

This document describes the end-to-end integration test suite for CarbonLedger's Oracle → Soroban pipeline. The tests verify that:

1. ✅ Python oracle submits monitoring data → Soroban carbon_oracle contract receives it
2. ✅ Carbon_registry contract status updates based on oracle data
3. ✅ Stale data detection works correctly (>365 day freshness window)
4. ✅ All tests run against Stellar Testnet (not mocked)
5. ✅ Tests are scheduled nightly via GitHub Actions CI

## Test Architecture

```
┌─────────────────────────────────────────────────────────────┐
│           GitHub Actions Nightly Trigger (UTC 2 AM)         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│        test_oracle_e2e.py (Python Integration Tests)       │
│                                                             │
│  1. Oracle initialization                                  │
│  2. Registry initialization                                │
│  3. Register project (admin)                               │
│  4. Verify project (verifier)                              │
│  5. Submit monitoring data (oracle) ← PRIMARY TEST         │
│  6. Retrieve monitoring data                               │
│  7. Stale data detection check                             │
│  8. Update registry status (oracle)                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │    Stellar Testnet RPC        │
         │  https://soroban-testnet...   │
         └───────────────────────────────┘
                    │             │
        ┌───────────┘             └──────────────┐
        ▼                                        ▼
┌─────────────────────────┐  ┌──────────────────────────┐
│  carbon_oracle contract │  │ carbon_registry contract │
│                         │  │                          │
│ submit_monitoring_data()│  │ register_project()       │
│ get_monitoring_data()   │  │ verify_project()         │
│ is_monitoring_current() │  │ update_project_status()  │
└─────────────────────────┘  └──────────────────────────┘
```

## Test Files

### `oracle/test_oracle_e2e.py`

Main E2E test suite running against Stellar Testnet.

**Key Functions:**

- `test_submit_monitoring_data()` — PRIMARY: Verifies oracle can submit and data is stored on-chain
- `test_retrieve_monitoring_data()` — PRIMARY: Confirms on-chain state change
- `test_stale_data_detection()` — PRIMARY: Validates freshness check >365 days
- `test_update_registry_status()` — Verifies registry status updates

**Usage:**

```bash
cd oracle
python3 test_oracle_e2e.py
```

### `.github/workflows/e2e-nightly.yml`

GitHub Actions workflow for scheduled nightly testing.

**Schedule:** UTC 2 AM every day  
**Trigger:** Also supports manual `workflow_dispatch`  
**Timeout:** 30 minutes

## Environment Setup

### 1. Deploy Contracts to Testnet

Before running tests, deploy contracts:

```bash
cd contracts

# Build WASM artifacts
cargo build --target wasm32-unknown-unknown --release --workspace

# Deploy each contract using soroban CLI
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_oracle.wasm \
  --network testnet

soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --network testnet
```

Record contract IDs.

### 2. Create Testnet Keypairs

Generate keypairs for oracle, admin, and verifier roles:

```bash
# Generate keypairs (save secrets securely)
soroban keys generate --network testnet oracle
soroban keys generate --network testnet admin
soroban keys generate --network testnet verifier

# Fund accounts with friendbot
curl "https://friendbot.stellar.org?addr=GXXXXXX"  # Use public keys from above
```

### 3. Configure Environment Variables

Create `.env.test` (never commit to repo):

```env
# Soroban RPC and network
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Contract addresses (from deployment step 1)
ORACLE_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
REGISTRY_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Keypair secrets (from step 2)
ORACLE_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ADMIN_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VERIFIER_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 4. Configure GitHub Secrets

Add the following secrets to GitHub repository settings:

| Secret Name                   | Value                       | Notes                  |
| ----------------------------- | --------------------------- | ---------------------- |
| `ORACLE_CONTRACT_ID`          | Contract ID from deployment | Soroban Testnet        |
| `REGISTRY_CONTRACT_ID`        | Contract ID from deployment | Soroban Testnet        |
| `TESTNET_ORACLE_SECRET_KEY`   | Oracle keypair secret       | Keep secure in Secrets |
| `TESTNET_ADMIN_SECRET_KEY`    | Admin keypair secret        | Keep secure in Secrets |
| `TESTNET_VERIFIER_SECRET_KEY` | Verifier keypair secret     | Keep secure in Secrets |

**Never commit secrets to the repository.**

## Running Tests Locally

### One-time Setup

```bash
# 1. Create Python virtual environment
python3 -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# 2. Install dependencies
cd oracle
pip install -r requirements.txt

# 3. Create .env file with test credentials
cp .env.example .env
# Edit .env with Testnet contract IDs and keypair secrets
```

### Pre-Flight Validation

When you run the tests, they automatically perform pre-flight validation checks:

```
PRE-FLIGHT VALIDATION
================================================================================

1. Validating contract ID formats...
   ✓ Contract ID formats valid

2. Verifying contracts...
   ✓ oracle contract: CXXXXXXXXX... (format valid)
   ✓ registry contract: CXXXXXXXXX... (format valid)

3. Checking account balances...
   ✓ Oracle: Balance OK: 1000.50 XLM
   ✓ Admin: Balance OK: 500.25 XLM
   ✓ Verifier: Balance OK: 250.75 XLM

4. Checking network connectivity...
   ✓ Connected to Testnet (ledger: 12345678)

================================================================================
✓ All pre-flight checks passed!
================================================================================
```

These checks validate:

- ✅ Contract IDs have correct format (start with 'C', 56 chars)
- ✅ All accounts are created on Testnet
- ✅ All accounts have sufficient XLM balance (≥1.0 XLM)
- ✅ Network connectivity to Stellar Testnet RPC

If any check fails, the test provides clear guidance on how to fix it.

### Run Tests

```bash
# From oracle/ directory
python3 test_oracle_e2e.py
```

### Expected Output

```
================================================================================
CARBONLEDGER E2E TEST SUITE
Oracle → Soroban Integration Tests
================================================================================

================================================================================
TEST 1: Oracle Contract Initialization
================================================================================
2026-04-25 10:15:30 [INFO] ✓ Oracle contract C123... expected to be initialized
...

================================================================================
TEST 5: Oracle Submits Monitoring Data (PRIMARY)
================================================================================
2026-04-25 10:15:35 [INFO] Project ID: e2e-test-proj-1234567890
2026-04-25 10:15:35 [INFO] Period: 2026-Q1
2026-04-25 10:15:35 [INFO] Tonnes Verified: 1500
2026-04-25 10:15:35 [INFO] Methodology Score: 85
2026-04-25 10:15:35 [INFO] ✓ Monitoring data submitted successfully
  TX: abc123def456...
...

================================================================================
TEST SUMMARY
================================================================================
✓ PASS: Oracle Initialization
✓ PASS: Registry Initialization
✓ PASS: Project Registration
✓ PASS: Project Verification
✓ PASS: Submit Monitoring Data
✓ PASS: Retrieve Monitoring Data
✓ PASS: Stale Data Detection
✓ PASS: Update Registry Status
================================================================================
Total: 8 passed, 0 failed
================================================================================
```

## Test Acceptance Criteria

### ✅ Primary Tests (Must Pass)

1. **Submit monitoring data to oracle contract**
   - Python oracle submits data via `submit_monitoring_data()`
   - Transaction confirms on Stellar Testnet
   - Data stored in contract persistent storage

2. **Verify on-chain state change**
   - Call `get_monitoring_data()` from oracle contract
   - Retrieve submitted data with correct values:
     - Project ID matches
     - Period matches
     - Tonnes verified = 1500
     - Methodology score = 85
     - Satellite CID matches

3. **Stale data detection**
   - Call `is_monitoring_current(project_id)` returns true (data just submitted)
   - Verify freshness check function exists and works
   - Unit tests (in contract code) verify >365 day stale detection
   - Integration test confirms function is callable on-chain

4. **Registry status updated**
   - Oracle updates project status in registry contract
   - Status change confirmed via `get_project(project_id)`
   - Status transitions from Pending → Verified → Active

### ✅ Secondary Tests (Nice to Have)

- Price updates in carbon_oracle contract
- Methodology score warnings (score < 70)
- Event emissions on-chain
- Project suspension/flagging by oracle

## Troubleshooting

### Pre-Flight Validation Errors

#### Error: "Invalid Contract ID Format"

```
RuntimeError: Invalid ORACLE_CONTRACT_ID format: GXXXXXX
Must start with 'C' and be 56 characters long.
```

**Cause:** Contract ID is wrong format or from wrong network  
**Solution:**

1. Deploy contracts to Stellar **Testnet** (not Mainnet)
2. Verify contract ID starts with 'C' (not 'G')
3. Update `.env` with correct contract ID from deployment

#### Error: "Account Not Found on Testnet"

```
RuntimeError: Oracle account not found on Testnet.
Fund with: curl 'https://friendbot.stellar.org?addr=GXXXXXX'
```

**Cause:** Account doesn't exist on Testnet  
**Solution:**

```bash
curl "https://friendbot.stellar.org?addr=GXXXXXX"  # Fund account
sleep 10  # Wait for funding
```

#### Error: "Balance Too Low"

```
RuntimeError: Oracle account not funded:
Balance too low: 0.50 XLM (need ≥1.0 XLM)
```

**Cause:** Account has insufficient XLM  
**Solution:** Fund again with friendbot (gives 10,000 XLM per account)

#### Error: "Failed to Connect to Stellar Testnet"

```
RuntimeError: Failed to connect to Stellar Testnet: Connection refused
RPC URL: https://soroban-testnet.stellar.org
```

**Cause:** Network connectivity issue  
**Solution:**

- Check: `ping soroban-testnet.stellar.org`
- Verify status: https://status.stellar.org
- Retry after a few minutes

### Test Fails: "Missing required env var"

```
RuntimeError: Missing required env var: ORACLE_SECRET_KEY
```

**Solution:**

```bash
# Check .env file exists and has all required variables
cat .env

# Verify Testnet keypairs are funded
curl "https://horizon-testnet.stellar.org/accounts/GXXXXXX"
```

### Test Fails: "Transaction not confirmed in time"

```
TimeoutError: Transaction abc123... not confirmed within 60s
```

**Causes:**

- Network congestion (retry in a few minutes)
- Invalid contract ID (check deployment)
- Low account balance (fund with friendbot)

**Solution:**

```bash
# Check Testnet transaction status
soroban tx hash abc123... --network testnet

# Fund account if needed
curl "https://friendbot.stellar.org?addr=GXXXXXX"
```

### Test Fails: "UnauthorizedOracle"

```
RuntimeError: Transaction failed: CarbonError::UnauthorizedOracle = 8
```

**Solution:**

- Verify oracle contract was initialized with correct oracle keypair
- Confirm `TESTNET_ORACLE_SECRET_KEY` matches the oracle address in contract

```bash
# Check contract initialization
soroban contract invoke \
  --id CXXXXXXXXX \
  --fn get_oracle_address \
  --network testnet
```

## CI/CD Integration

### Nightly Schedule

Tests run automatically via GitHub Actions:

- **Time:** 2 AM UTC every day
- **Branch:** Main branch
- **Duration:** ~5-10 minutes

### Manual Trigger

Trigger tests manually from GitHub Actions tab:

1. Go to repository → Actions → "E2E Oracle Tests (Nightly)"
2. Click "Run workflow"
3. Select branch and debug mode
4. Monitor logs in real-time

### Notifications

- ✅ Pass: Logged in workflow summary
- ❌ Fail: Workflow marked as failed; artifacts uploaded for debugging

## Extending the Tests

### Add New Test Cases

Add to `test_oracle_e2e.py`:

```python
def test_custom_scenario(ctx: E2ETestContext) -> bool:
    """
    Test description and acceptance criteria.
    """
    log.info("=" * 80)
    log.info("TEST N: Custom Scenario")
    log.info("=" * 80)

    try:
        args = [scval.to_string(...), scval.to_int128(...)]
        tx_hash = build_and_submit(
            ctx.server,
            ctx.oracle_keypair,
            ctx.oracle_contract_id,
            "contract_function",
            args,
        )
        log.info(f"✓ Test passed: {tx_hash}")
        return True
    except Exception as e:
        log.error(f"✗ Test failed: {e}")
        return False
```

Then add to `tests` list in `run_e2e_tests()`:

```python
tests = [
    ...
    ("Custom Scenario", test_custom_scenario),
]
```

### Add to GitHub Actions

Update `.github/workflows/e2e-nightly.yml`:

```yaml
env:
  CUSTOM_ENV_VAR: ${{ secrets.CUSTOM_SECRET }}

run: |
  python3 test_oracle_e2e.py --verbose
```

## References

- [Stellar Soroban Docs](https://developers.stellar.org/docs/learn/soroban)
- [py-stellar-base](https://github.com/StellarCN/py-stellar-base)
- [Soroban CLI](https://github.com/stellar/rs-soroban-cli)
- [Carbon Ledger Contracts](../../contracts/README.md)
- [Oracle Setup](./README.md)

## Support

For issues or questions:

1. Check [Troubleshooting](#troubleshooting) section
2. Review GitHub Actions logs
3. Inspect contract storage with soroban CLI:
   ```bash
   soroban contract inspect --id CXXXXXXXXX --network testnet
   ```
4. Open an issue with full test output and environment details
