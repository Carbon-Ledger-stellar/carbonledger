# Stellar Testnet Guide

Complete guide to setting up and using Stellar Testnet for CarbonLedger development.

## Table of Contents

- [What is Testnet?](#what-is-testnet)
- [Getting Testnet XLM](#getting-testnet-xlm)
- [Setting Up Freighter Wallet](#setting-up-freighter-wallet)
- [Deploying Contracts](#deploying-contracts)
- [Getting Testnet USDC](#getting-testnet-usdc)
- [Testing Contract Interactions](#testing-contract-interactions)
- [Troubleshooting](#troubleshooting)

---

## What is Testnet?

Stellar Testnet is a parallel blockchain for testing without using real money:

- **Free XLM** - Get unlimited testnet XLM from faucets
- **Same as Mainnet** - Identical functionality to production
- **Safe Testing** - No real value, perfect for development
- **Reset Anytime** - Accounts can be recreated freely

**Network Details:**
- Network: `TESTNET`
- Passphrase: `Test SDF Network ; September 2015`
- Horizon URL: `https://horizon-testnet.stellar.org`
- Soroban RPC: `https://soroban-testnet.stellar.org`

---

## Getting Testnet XLM

### Method 1: Stellar Laboratory (Web)

1. Visit [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test)
2. Click "Generate keypair"
3. Save your **Secret Key** securely
4. Click "Get test network lumens"
5. Account is funded with 10,000 XLM

**Pros:** Simple, no installation needed  
**Cons:** Manual process, need to save keys carefully

---

### Method 2: Stellar CLI (Recommended)

```bash
# Generate and fund account in one command
stellar keys generate alice --network testnet --fund

# Output:
# Secret key: SXXX...
# Public key: GXXX...
# Account funded with 10,000 XLM
```

**Pros:** Fast, automated, keys saved locally  
**Cons:** Requires Stellar CLI installation

---

### Method 3: Friendbot API

```bash
# Generate keypair first
stellar keys generate bob --network testnet

# Get public key
PUBLIC_KEY=$(stellar keys address bob)

# Fund via Friendbot
curl "https://friendbot.stellar.org?addr=$PUBLIC_KEY"
```

**Pros:** Scriptable, good for CI/CD  
**Cons:** Rate limited, requires curl

---

### Method 4: Freighter Wallet

1. Install [Freighter extension](https://freighter.app)
2. Create new wallet
3. Switch to Testnet in settings
4. Copy your public key
5. Visit [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test)
6. Paste public key and click "Get test network lumens"

**Pros:** Works with browser wallet  
**Cons:** Two-step process

---

## Setting Up Freighter Wallet

### Installation

1. **Install Extension:**
   - Chrome: [Chrome Web Store](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk)
   - Firefox: [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/freighter/)
   - Brave: Use Chrome Web Store link

2. **Create Wallet:**
   - Click "Create new wallet"
   - Save recovery phrase (12 or 24 words)
   - Set password
   - Confirm recovery phrase

3. **Switch to Testnet:**
   - Click Freighter icon
   - Settings → Network
   - Select "Testnet"

4. **Fund Account:**
   - Copy your public key (starts with G)
   - Use any faucet method above
   - Verify balance in Freighter

---

### Import Existing Account

If you generated keys with Stellar CLI:

```bash
# Show secret key
stellar keys show alice

# In Freighter:
# 1. Click "Import wallet"
# 2. Select "Import with secret key"
# 3. Paste secret key
# 4. Set password
```

---

## Deploying Contracts

### Prerequisites

```bash
# Verify Stellar CLI is installed
stellar --version

# Verify contracts are built
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

---

### Deploy All Contracts

```bash
cd contracts

# 1. Deploy carbon_registry
REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source alice \
  --network testnet)

echo "Registry: $REGISTRY_ID"

# 2. Deploy carbon_credit
CREDIT_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_credit.wasm \
  --source alice \
  --network testnet)

echo "Credit: $CREDIT_ID"

# 3. Deploy carbon_marketplace
MARKETPLACE_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_marketplace.wasm \
  --source alice \
  --network testnet)

echo "Marketplace: $MARKETPLACE_ID"

# 4. Deploy carbon_oracle
ORACLE_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_oracle.wasm \
  --source alice \
  --network testnet)

echo "Oracle: $ORACLE_ID"
```

---

### Save Contract IDs

Update your `.env` file:

```env
CARBON_REGISTRY_CONTRACT_ID=CXXX...
CARBON_CREDIT_CONTRACT_ID=CXXX...
CARBON_MARKETPLACE_CONTRACT_ID=CXXX...
CARBON_ORACLE_CONTRACT_ID=CXXX...
```

---

### Initialize Contracts

```bash
# Get your public key
ADMIN_KEY=$(stellar keys address alice)

# Initialize registry
stellar contract invoke \
  --id $REGISTRY_ID \
  --source alice \
  --network testnet \
  -- initialize \
  --admin $ADMIN_KEY

# Initialize credit contract
stellar contract invoke \
  --id $CREDIT_ID \
  --source alice \
  --network testnet \
  -- initialize \
  --admin $ADMIN_KEY \
  --registry $REGISTRY_ID

# Initialize marketplace
stellar contract invoke \
  --id $MARKETPLACE_ID \
  --source alice \
  --network testnet \
  -- initialize \
  --admin $ADMIN_KEY \
  --credit $CREDIT_ID

# Initialize oracle
stellar contract invoke \
  --id $ORACLE_ID \
  --source alice \
  --network testnet \
  -- initialize \
  --admin $ADMIN_KEY
```

---

## Getting Testnet USDC

### Method 1: Wrap Native Asset

```bash
# Deploy USDC token contract
USDC_ID=$(stellar contract asset deploy \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source alice \
  --network testnet)

echo "USDC Contract: $USDC_ID"

# Add to .env
echo "USDC_CONTRACT_ID=$USDC_ID" >> .env
```

---

### Method 2: Create Custom Test Token

```bash
# Create issuer account
stellar keys generate usdc-issuer --network testnet --fund

# Get issuer address
ISSUER=$(stellar keys address usdc-issuer)

# Deploy token
USDC_ID=$(stellar contract asset deploy \
  --asset USDC:$ISSUER \
  --source alice \
  --network testnet)

# Mint tokens to your account
stellar contract invoke \
  --id $USDC_ID \
  --source usdc-issuer \
  --network testnet \
  -- mint \
  --to $(stellar keys address alice) \
  --amount 1000000000000  # 100,000 USDC (7 decimals)
```

---

## Testing Contract Interactions

### Register a Project

```bash
stellar contract invoke \
  --id $REGISTRY_ID \
  --source alice \
  --network testnet \
  -- register_project \
  --project_id "PROJ-001" \
  --name "Amazon Reforestation" \
  --methodology "VCS" \
  --country "BR" \
  --vintage_year 2024 \
  --owner $(stellar keys address alice)
```

---

### Mint Credits

```bash
stellar contract invoke \
  --id $CREDIT_ID \
  --source alice \
  --network testnet \
  -- mint_credits \
  --project_id "PROJ-001" \
  --amount 1000 \
  --vintage_year 2024 \
  --serial_start "PROJ-001-2024-0001" \
  --serial_end "PROJ-001-2024-1000"
```

---

### List Credits for Sale

```bash
stellar contract invoke \
  --id $MARKETPLACE_ID \
  --source alice \
  --network testnet \
  -- list_credits \
  --batch_id "BATCH-001" \
  --amount 500 \
  --price_per_credit 1000000  # 1 USDC (7 decimals)
```

---

### Purchase Credits

```bash
# First, approve USDC spending
stellar contract invoke \
  --id $USDC_ID \
  --source bob \
  --network testnet \
  -- approve \
  --spender $MARKETPLACE_ID \
  --amount 500000000  # 500 USDC

# Then purchase
stellar contract invoke \
  --id $MARKETPLACE_ID \
  --source bob \
  --network testnet \
  -- purchase_credits \
  --listing_id "LIST-001" \
  --amount 500
```

---

### Retire Credits

```bash
stellar contract invoke \
  --id $CREDIT_ID \
  --source bob \
  --network testnet \
  -- retire_credits \
  --batch_id "BATCH-001" \
  --amount 100 \
  --beneficiary "Acme Corp" \
  --reason "2024 Carbon Neutrality Goal"
```

---

## Troubleshooting

### Account Not Found

**Error:**
```
Error: Account not found: GXXX...
```

**Solution:**
Fund the account using any faucet method above.

---

### Insufficient Balance

**Error:**
```
Error: Transaction failed: txINSUFFICIENT_BALANCE
```

**Solution:**
```bash
# Check balance
stellar account balance alice --network testnet

# Fund if needed
curl "https://friendbot.stellar.org?addr=$(stellar keys address alice)"
```

---

### Contract Not Found

**Error:**
```
Error: Contract not found: CXXX...
```

**Solution:**
Verify contract ID is correct:
```bash
# List deployed contracts
stellar contract list --network testnet

# Redeploy if needed
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source alice \
  --network testnet
```

---

### Wrong Network

**Error:**
```
Error: Network mismatch
```

**Solution:**
Verify you're using testnet:
```bash
# Check Freighter wallet network (should be TESTNET)
# Check .env file:
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

---

### Transaction Failed: Bad Auth

**Error:**
```
Error: Transaction failed: txBAD_AUTH
```

**Solutions:**

1. **Check signer:**
   ```bash
   # Verify you're using correct account
   stellar keys show alice
   ```

2. **Check account exists:**
   ```bash
   stellar account balance alice --network testnet
   ```

3. **Check contract permissions:**
   ```bash
   # Verify you're admin
   stellar contract invoke \
     --id $REGISTRY_ID \
     --source alice \
     --network testnet \
     -- get_admin
   ```

---

### Rate Limiting

**Error:**
```
Error: Too many requests
```

**Solution:**
Friendbot is rate limited. Wait 60 seconds or use a different method:
```bash
# Use Stellar Laboratory instead
# Or deploy your own faucet contract
```

---

## Useful Commands

### Check Account Balance

```bash
stellar account balance alice --network testnet
```

---

### View Transaction History

```bash
stellar account history alice --network testnet
```

---

### Get Contract Info

```bash
stellar contract info --id $REGISTRY_ID --network testnet
```

---

### Invoke Contract (Read-Only)

```bash
stellar contract invoke \
  --id $REGISTRY_ID \
  --source alice \
  --network testnet \
  -- get_project \
  --project_id "PROJ-001"
```

---

### Restore Contract TTL

```bash
stellar contract extend \
  --id $REGISTRY_ID \
  --source alice \
  --network testnet \
  --ledgers-to-extend 535680  # ~1 month
```

---

## Best Practices

1. **Save Keys Securely:**
   - Never commit secret keys to git
   - Use `.env` file (already in `.gitignore`)
   - Back up recovery phrases

2. **Use Named Accounts:**
   ```bash
   stellar keys generate alice --network testnet --fund
   stellar keys generate bob --network testnet --fund
   stellar keys generate verifier --network testnet --fund
   ```

3. **Test Incrementally:**
   - Deploy one contract at a time
   - Test each function before moving on
   - Use `--help` to see available options

4. **Monitor Resources:**
   ```bash
   # Check contract storage
   stellar contract read --id $REGISTRY_ID --network testnet
   
   # Check TTL
   stellar contract info --id $REGISTRY_ID --network testnet
   ```

5. **Clean Up:**
   ```bash
   # Testnet accounts expire after inactivity
   # Redeploy contracts as needed
   # No cost to recreate everything
   ```

---

## Resources

- **Stellar Laboratory:** https://laboratory.stellar.org
- **Friendbot:** https://friendbot.stellar.org
- **Horizon Testnet:** https://horizon-testnet.stellar.org
- **Soroban RPC:** https://soroban-testnet.stellar.org
- **Freighter Wallet:** https://freighter.app
- **Stellar Docs:** https://developers.stellar.org
- **Soroban Docs:** https://soroban.stellar.org

---

## Next Steps

After setting up testnet:

1. **Deploy contracts** using the commands above
2. **Update `.env`** with contract IDs
3. **Start backend** with `npm run start:dev`
4. **Start frontend** with `npm run dev`
5. **Connect Freighter** to `http://localhost:3000`
6. **Test the full flow** from project registration to retirement

**See:** [CONTRIBUTING.md](../CONTRIBUTING.md) for complete development workflow.
