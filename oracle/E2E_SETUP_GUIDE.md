# E2E Test Environment Configuration Template

This file documents how to set up your environment for running E2E tests locally and in CI.

## Local Setup

### 1. Python Environment

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
cd oracle
pip install -r requirements.txt
```

### 2. Testnet Contract Deployment

Before running tests, deploy contracts to Stellar Testnet:

```bash
cd contracts

# Build WASM
cargo build --target wasm32-unknown-unknown --release --workspace

# Deploy carbon_oracle
ORACLE_CONTRACT_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_oracle.wasm \
  --network testnet \
  --source-account oracle)
echo "ORACLE_CONTRACT_ID=$ORACLE_CONTRACT_ID"

# Deploy carbon_registry
REGISTRY_CONTRACT_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --network testnet \
  --source-account admin)
echo "REGISTRY_CONTRACT_ID=$REGISTRY_CONTRACT_ID"
```

### 3. Create Testnet Keypairs

```bash
# Generate keypairs (save outputs in secure location)
soroban keys generate --network testnet oracle
soroban keys generate --network testnet admin
soroban keys generate --network testnet verifier

# Get public keys
soroban keys show oracle
soroban keys show admin
soroban keys show verifier

# Fund with Testnet friendbot
curl "https://friendbot.stellar.org?addr=GXXXXX_oracle_pubkey"
curl "https://friendbot.stellar.org?addr=GXXXXX_admin_pubkey"
curl "https://friendbot.stellar.org?addr=GXXXXX_verifier_pubkey"

# Verify funding (should show account balance)
soroban config identity show oracle
```

### 4. Create Local Environment File

Create `oracle/.env` with your Testnet configuration:

```env
# Network Configuration
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Contract Addresses (from step 2)
ORACLE_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
REGISTRY_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Keypair Secrets (from step 3)
# WARNING: Keep these secure! Never commit to repository!
ORACLE_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ADMIN_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VERIFIER_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Optional: Additional Oracle Configuration
XPANSIV_API_KEY=
TOUCAN_API_KEY=
DATABASE_URL=
ADMIN_ALERT_WEBHOOK=
```

**IMPORTANT:** Add `.env` to `.gitignore` to prevent accidental commits of secrets.

### 5. Run Tests Locally

```bash
cd oracle
python3 test_oracle_e2e.py
```

## GitHub Actions CI Setup

### 1. GitHub Secrets Configuration

In your repository settings (Settings → Secrets and variables → Actions), create these secrets:

#### Oracle Contract Secrets

| Name                   | Value                                | Example       |
| ---------------------- | ------------------------------------ | ------------- |
| `ORACLE_CONTRACT_ID`   | Oracle contract ID from deployment   | `CAAAAAAA...` |
| `REGISTRY_CONTRACT_ID` | Registry contract ID from deployment | `CAAAAAAA...` |

#### Testnet Account Secrets

| Name                          | Value                           | Sensitivity |
| ----------------------------- | ------------------------------- | ----------- |
| `TESTNET_ORACLE_SECRET_KEY`   | Secret key for oracle account   | 🔐 Secret   |
| `TESTNET_ADMIN_SECRET_KEY`    | Secret key for admin account    | 🔐 Secret   |
| `TESTNET_VERIFIER_SECRET_KEY` | Secret key for verifier account | 🔐 Secret   |

**How to add secrets:**

1. Go to repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Enter name and value
4. Click "Add secret"

### 2. Workflow Trigger

The nightly workflow in `.github/workflows/e2e-nightly.yml` automatically:

- Runs on schedule: **2 AM UTC every day**
- Can be manually triggered via "Run workflow" button
- Accepts optional debug flag for verbose logging

### 3. Verify Workflow is Enabled

```bash
# Check workflow file syntax
# This happens automatically in CI, but you can validate locally with:
python3 -m yamllint .github/workflows/e2e-nightly.yml
```

## Testnet Funding and Account Management

### Check Account Balance

```bash
# Check balance on any account
soroban config identity show oracle

# Or via Stellar API
curl https://horizon-testnet.stellar.org/accounts/GXXXXX | jq '.balances'
```

### Fund Account with Friendbot

```bash
# One-time funding
curl "https://friendbot.stellar.org?addr=GXXXXX"

# Verify funding succeeded
soroban config identity show oracle
```

### Check Recent Transactions

```bash
# View recent transactions for oracle account
curl "https://horizon-testnet.stellar.org/accounts/GXXXXX/transactions" | jq '.records[] | {id, created_at, type}'
```

## Troubleshooting Configuration Issues

### Issue: "Invalid contract ID"

```
RuntimeError: Invalid contract ID: CXXXXXXXXX
```

**Solution:**

1. Verify contract was deployed to Testnet (not Mainnet)
2. Check contract ID spelling and format (should start with 'C')
3. Verify environment variable is set: `echo $ORACLE_CONTRACT_ID`

### Issue: "Account not found"

```
RuntimeError: Account GXXXXX not found
```

**Solution:**

1. Fund account with friendbot: `curl "https://friendbot.stellar.org?addr=GXXXXX"`
2. Wait 10 seconds for funding to complete
3. Verify funding: `soroban config identity show`

### Issue: "Insufficient balance for transaction"

```
RuntimeError: Transaction failed: Fee bump too large
```

**Solution:**

1. Fund account with more XLM (test friendbot gives 10,000 XLM)
2. Reduce transaction fees in test config
3. Check recent transactions: `soroban tx recent --network testnet`

### Issue: "Network timeout"

```
TimeoutError: Transaction not confirmed within 60s
```

**Solution:**

1. Verify network connectivity: `ping soroban-testnet.stellar.org`
2. Check if Testnet RPC is operational: https://status.stellar.org
3. Increase timeout in test: `TEST_TIMEOUT = 120` in `test_oracle_e2e.py`
4. Retry test later

## Security Best Practices

### ✅ DO:

- Use GitHub Secrets for all keypairs (never in code)
- Rotate test account keypairs regularly
- Use separate keypairs for oracle, admin, verifier roles
- Run tests against Testnet only (never Mainnet)
- Review workflow logs for sensitive data leaks

### ❌ DON'T:

- Commit `.env` files or secret keys to repository
- Share secret keys in GitHub issues or pull requests
- Use production keypairs in test environments
- Leave test accounts with large balances (use friendbot sparingly)
- Print full keypairs in logs (redact in logs when debugging)

## References

- [Soroban CLI Setup](https://developers.stellar.org/docs/smart-contracts/guides/soroban-cli)
- [Stellar Testnet](https://developers.stellar.org/docs/fundamentals-and-concepts/testnet-public-private-networks)
- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [CarbonLedger Contracts](../../contracts/README.md)
