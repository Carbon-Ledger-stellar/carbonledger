# Testnet Deployment Runbook

Step-by-step guide for deploying all four CarbonLedger contracts to Stellar Testnet.

## Prerequisites

```bash
# Install Stellar CLI
cargo install --locked stellar-cli --version 21.0.0

# Verify installation
stellar --version

# Create testnet account (if needed)
# Visit: https://laboratory.stellar.org/#account-creator?network=testnet
```

## Environment Setup

```bash
# 1. Create deployment keypair
stellar keys generate --network testnet

# Save output:
# Public Key: G...
# Secret Key: S...

# 2. Fund account with testnet XLM
# Visit: https://laboratory.stellar.org/#account-creator?network=testnet

# 3. Set environment variables
export ADMIN_SECRET_KEY="S..."
export ADMIN_PUBLIC_KEY="G..."
export STELLAR_NETWORK="testnet"
export STELLAR_RPC_URL="https://soroban-testnet.stellar.org"
```

## Contract Deployment Order

Contracts must be deployed in this order due to dependencies:

```
1. carbon_registry    (no dependencies)
   ↓
2. carbon_credit      (depends on registry)
   ↓
3. carbon_marketplace (depends on credit)
   ↓
4. carbon_oracle      (depends on registry)
```

## Step 1: Deploy carbon_registry

### Build Contract

```bash
cd contracts/carbon_registry
cargo build --target wasm32-unknown-unknown --release
cd ../..
```

### Deploy to Testnet

```bash
stellar contract deploy \
  --wasm contracts/carbon_registry/target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source $ADMIN_SECRET_KEY \
  --network testnet
```

**Output:**
```
Contract ID: CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4
```

### Verify Deployment

```bash
stellar contract info \
  --id CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4 \
  --network testnet
```

### Initialize Registry

```bash
stellar contract invoke \
  --id CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4 \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize \
  --admin $ADMIN_PUBLIC_KEY
```

### Save Contract ID

```bash
export CARBON_REGISTRY_CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
echo "CARBON_REGISTRY_CONTRACT_ID=$CARBON_REGISTRY_CONTRACT_ID" >> .env
```

## Step 2: Deploy carbon_credit

### Build Contract

```bash
cd contracts/carbon_credit
cargo build --target wasm32-unknown-unknown --release
cd ../..
```

### Deploy to Testnet

```bash
stellar contract deploy \
  --wasm contracts/carbon_credit/target/wasm32-unknown-unknown/release/carbon_credit.wasm \
  --source $ADMIN_SECRET_KEY \
  --network testnet
```

**Output:**
```
Contract ID: CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4
```

### Verify Deployment

```bash
stellar contract info \
  --id CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4 \
  --network testnet
```

### Initialize Credit Contract

```bash
stellar contract invoke \
  --id CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4 \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize \
  --registry $CARBON_REGISTRY_CONTRACT_ID \
  --admin $ADMIN_PUBLIC_KEY
```

### Save Contract ID

```bash
export CARBON_CREDIT_CONTRACT_ID="CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4"
echo "CARBON_CREDIT_CONTRACT_ID=$CARBON_CREDIT_CONTRACT_ID" >> .env
```

## Step 3: Deploy carbon_marketplace

### Build Contract

```bash
cd contracts/carbon_marketplace
cargo build --target wasm32-unknown-unknown --release
cd ../..
```

### Deploy to Testnet

```bash
stellar contract deploy \
  --wasm contracts/carbon_marketplace/target/wasm32-unknown-unknown/release/carbon_marketplace.wasm \
  --source $ADMIN_SECRET_KEY \
  --network testnet
```

**Output:**
```
Contract ID: CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCSC4
```

### Verify Deployment

```bash
stellar contract info \
  --id CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCSC4 \
  --network testnet
```

### Initialize Marketplace

```bash
stellar contract invoke \
  --id CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCSC4 \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize \
  --credit $CARBON_CREDIT_CONTRACT_ID \
  --admin $ADMIN_PUBLIC_KEY
```

### Save Contract ID

```bash
export CARBON_MARKETPLACE_CONTRACT_ID="CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCSC4"
echo "CARBON_MARKETPLACE_CONTRACT_ID=$CARBON_MARKETPLACE_CONTRACT_ID" >> .env
```

## Step 4: Deploy carbon_oracle

### Build Contract

```bash
cd contracts/carbon_oracle
cargo build --target wasm32-unknown-unknown --release
cd ../..
```

### Deploy to Testnet

```bash
stellar contract deploy \
  --wasm contracts/carbon_oracle/target/wasm32-unknown-unknown/release/carbon_oracle.wasm \
  --source $ADMIN_SECRET_KEY \
  --network testnet
```

**Output:**
```
Contract ID: CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDSC4
```

### Verify Deployment

```bash
stellar contract info \
  --id CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDSC4 \
  --network testnet
```

### Initialize Oracle

```bash
stellar contract invoke \
  --id CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDSC4 \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize \
  --registry $CARBON_REGISTRY_CONTRACT_ID \
  --admin $ADMIN_PUBLIC_KEY
```

### Save Contract ID

```bash
export CARBON_ORACLE_CONTRACT_ID="CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDSC4"
echo "CARBON_ORACLE_CONTRACT_ID=$CARBON_ORACLE_CONTRACT_ID" >> .env
```

## Step 5: Wire Contract IDs

Update `.env` with all contract IDs:

```bash
cat >> .env << EOF
CARBON_REGISTRY_CONTRACT_ID=$CARBON_REGISTRY_CONTRACT_ID
CARBON_CREDIT_CONTRACT_ID=$CARBON_CREDIT_CONTRACT_ID
CARBON_MARKETPLACE_CONTRACT_ID=$CARBON_MARKETPLACE_CONTRACT_ID
CARBON_ORACLE_CONTRACT_ID=$CARBON_ORACLE_CONTRACT_ID
EOF
```

## Verification Steps

### Verify All Contracts Deployed

```bash
echo "Registry: $CARBON_REGISTRY_CONTRACT_ID"
echo "Credit: $CARBON_CREDIT_CONTRACT_ID"
echo "Marketplace: $CARBON_MARKETPLACE_CONTRACT_ID"
echo "Oracle: $CARBON_ORACLE_CONTRACT_ID"

# Check each contract exists
for CONTRACT in $CARBON_REGISTRY_CONTRACT_ID $CARBON_CREDIT_CONTRACT_ID $CARBON_MARKETPLACE_CONTRACT_ID $CARBON_ORACLE_CONTRACT_ID; do
  stellar contract info --id $CONTRACT --network testnet
done
```

### Test Registry Contract

```bash
# Register a test project
stellar contract invoke \
  --id $CARBON_REGISTRY_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- register_project \
  --developer $ADMIN_PUBLIC_KEY \
  --methodology "VCS" \
  --location "US" \
  --coordinates "40.7128,-74.0060"
```

### Test Credit Contract

```bash
# Mint test credits
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- mint_credits \
  --project_id 1 \
  --amount 1000 \
  --vintage_year 2024
```

### Test Marketplace Contract

```bash
# List credits
stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- list_credits \
  --credit_batch_id 1 \
  --price_per_tonne 15
```

## Rollback Procedure

### If Deployment Fails

1. **Identify the failed contract**
   ```bash
   stellar contract info --id $CONTRACT_ID --network testnet
   ```

2. **Redeploy the contract**
   ```bash
   stellar contract deploy \
     --wasm contracts/<contract>/target/wasm32-unknown-unknown/release/<contract>.wasm \
     --source $ADMIN_SECRET_KEY \
     --network testnet
   ```

3. **Update environment variable**
   ```bash
   export <CONTRACT>_ID="new_contract_id"
   ```

### If Initialization Fails

1. **Check contract state**
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --source $ADMIN_SECRET_KEY \
     --network testnet \
     -- get_admin
   ```

2. **Reinitialize**
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --source $ADMIN_SECRET_KEY \
     --network testnet \
     -- initialize \
     --admin $ADMIN_PUBLIC_KEY
   ```

### If Dependencies Are Wrong

1. **Redeploy dependent contract**
   ```bash
   # Example: carbon_credit depends on registry
   stellar contract deploy \
     --wasm contracts/carbon_credit/target/wasm32-unknown-unknown/release/carbon_credit.wasm \
     --source $ADMIN_SECRET_KEY \
     --network testnet
   ```

2. **Reinitialize with correct dependencies**
   ```bash
   stellar contract invoke \
     --id $NEW_CREDIT_CONTRACT_ID \
     --source $ADMIN_SECRET_KEY \
     --network testnet \
     -- initialize \
     --registry $CARBON_REGISTRY_CONTRACT_ID \
     --admin $ADMIN_PUBLIC_KEY
   ```

## Automated Deployment Script

For faster deployments, use the provided script:

```bash
./scripts/deploy-testnet.sh
```

This script:
- Builds all contracts
- Deploys in correct order
- Initializes each contract
- Saves contract IDs to `.env`
- Runs verification tests

## Monitoring Deployment

### Check Transaction Status

```bash
# View recent transactions
stellar transaction list --network testnet

# Get transaction details
stellar transaction info <tx_hash> --network testnet
```

### Monitor Contract Events

```bash
# Stream contract events
stellar contract events \
  --id $CARBON_REGISTRY_CONTRACT_ID \
  --network testnet \
  --follow
```

## Troubleshooting

### "Contract not found" Error

```bash
# Verify contract ID is correct
stellar contract info --id $CONTRACT_ID --network testnet

# Check network is testnet
echo $STELLAR_NETWORK
```

### "Insufficient balance" Error

```bash
# Check account balance
stellar account info --source $ADMIN_PUBLIC_KEY --network testnet

# Fund account at: https://laboratory.stellar.org/#account-creator?network=testnet
```

### "Invalid initialization parameters" Error

```bash
# Verify contract initialization signature
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize --help
```

### "Dependency contract not found" Error

```bash
# Ensure registry is deployed first
stellar contract info --id $CARBON_REGISTRY_CONTRACT_ID --network testnet

# Redeploy dependent contract with correct registry ID
```

## Post-Deployment

1. **Update backend environment**
   ```bash
   cp .env backend/.env
   ```

2. **Update frontend environment**
   ```bash
   cp .env frontend/.env.local
   ```

3. **Start services**
   ```bash
   docker-compose up --build
   ```

4. **Run integration tests**
   ```bash
   ./scripts/test-all.sh
   ```

## Mainnet Deployment

For mainnet deployment, follow the same steps but:

1. Use mainnet network: `--network mainnet`
2. Use mainnet RPC: `https://soroban-mainnet.stellar.org`
3. Use production keypair (stored securely)
4. Perform security audit before deployment
5. Use gradual rollout strategy

See [Production Deployment Guide](./deployment.md) for details.
