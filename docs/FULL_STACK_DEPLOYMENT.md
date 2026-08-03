# Full Stack Deployment Guide (Testnet & Mainnet)

This guide covers the deployment of the complete CarbonLedger stack for both testnet and Phase 4 mainnet launch. It includes instructions for bare-metal/VPS setups, covering smart contracts, the NestJS backend, Next.js frontend, and Oracle services.

## Prerequisites
- Linux VPS (Ubuntu 22.04 or similar recommended)
- Node.js 18+ and npm
- PM2 installed globally (`npm install -g pm2`)
- Nginx
- PostgreSQL database
- Stellar CLI installed

---

## 1. Smart Contract Deployment

Deploying the Soroban contracts involves compiling the WASM and submitting it to the network using the Stellar CLI.

### Building Contracts
```bash
soroban contract build
```

### Deploying to Testnet
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbonledger_contract.wasm \
  --source admin \
  --network testnet
```

### Deploying to Mainnet
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbonledger_contract.wasm \
  --source admin \
  --network public
```

### Contract Rollback
To rollback a contract, you can revert the alias to a previous contract ID or redeploy the previous WASM binary:
```bash
# Example: Redeploying a previous contract version
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbonledger_contract_v_prev.wasm \
  --source admin \
  --network public
```

---

## 2. Backend Deployment

The backend is built with NestJS. We deploy it using PM2 as the process manager (for Python-based microservices, Gunicorn would be used instead) and Nginx as the reverse proxy.

### Build and Start with PM2
```bash
cd backend
npm install
npm run build

# Start with PM2
pm2 start dist/main.js --name carbonledger-backend
pm2 save
pm2 startup
```

### Nginx Configuration
Create a new site configuration in `/etc/nginx/sites-available/carbonledger-backend`:
```nginx
server {
    listen 80;
    server_name api.carbonledger.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/carbonledger-backend /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

### Backend Rollback
If a deployment fails, use PM2 to revert or git checkout to the previous tag and rebuild:
```bash
# PM2 rollback to previous version
pm2 reload carbonledger-backend

# Or via Git
git checkout previous_release_tag
npm ci
npm run build
pm2 restart carbonledger-backend
```

---

## 3. Frontend Deployment

The frontend is built with Next.js. It can be deployed to Vercel (recommended) or self-hosted on a VPS.

### Option A: Vercel Deployment
1. Connect your GitHub repository to Vercel.
2. Select the `frontend` directory and Next.js framework preset.
3. Configure environment variables for Testnet/Mainnet.
4. Click **Deploy**.

**Rollback on Vercel:** Go to the deployments tab in the Vercel dashboard, click the three dots on the previous successful deployment, and select "Promote to Production". This rollback is instant.

### Option B: Self-Hosted with PM2
```bash
cd frontend
npm install
npm run build

# Start with PM2
pm2 start npm --name "carbonledger-frontend" -- start
pm2 save
```

Configure Nginx similar to the backend, pointing to port 3000 (or the chosen Next.js port).

**Self-Hosted Rollback:**
```bash
git checkout previous_release_tag
npm ci
npm run build
pm2 restart carbonledger-frontend
```

---

## 4. Oracle Service Deployment

Oracle services provide off-chain data and run continuously. We deploy them natively using `systemd` on the Linux VPS.

### Building the Oracle Service
```bash
cd oracle
npm install
npm run build
```

### Creating the Systemd Service File
Create a file at `/etc/systemd/system/carbonledger-oracle.service`:
```ini
[Unit]
Description=CarbonLedger Oracle Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/path/to/carbonledger/oracle
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
Environment=NODE_ENV=production
EnvironmentFile=/path/to/carbonledger/oracle/.env

[Install]
WantedBy=multi-user.target
```

### Enabling and Starting the Service
```bash
sudo systemctl daemon-reload
sudo systemctl enable carbonledger-oracle
sudo systemctl start carbonledger-oracle
```

### Oracle Service Rollback
To rollback the Oracle service, switch the code to a previous working build and restart the `systemd` service:
```bash
cd oracle
git checkout previous_release_tag
npm ci
npm run build
sudo systemctl restart carbonledger-oracle
```


---

## 5. Infrastructure — Staging → Production Promotion Runbook

Added in #685.  This section documents how to promote a validated staging
deployment to production.

### Prerequisites

Before promoting staging → production:

- [ ] All unit tests pass on the release commit: `./scripts/test-all.sh`
- [ ] Load tests pass on staging: `k6 run load-tests/marketplace.k6.js`
- [ ] Smoke tests pass on staging testnet contracts
- [ ] Terraform `staging` workspace shows "No changes" (no drift)
- [ ] PR has been reviewed and merged to `main`

### Step 1 — Validate staging environment

```bash
cd infra/main
terraform workspace select staging

# Confirm no drift
terraform plan -var-file=staging.tfvars \
  -var="db_username=$DB_USER" \
  -var="db_password=$DB_PASS" \
  | tail -5
# Expected: "No changes. Your infrastructure matches the configuration."
```

### Step 2 — Review production plan

```bash
terraform workspace select production

# Preview changes — review carefully before applying
terraform plan -var-file=production.tfvars \
  -var="db_username=$DB_USER" \
  -var="db_password=$DB_PASS" \
  -out=production.tfplan

# Examine the plan
terraform show production.tfplan
```

Key things to verify in the plan:
- No resource **replacements** (forced replace = downtime)
- No unexpected **deletions**
- Instance type changes match the allowed differences table in `infra/README.md`

### Step 3 — Apply to production

```bash
terraform workspace select production
terraform apply production.tfplan
```

### Step 4 — Deploy contracts to production (Stellar Mainnet)

```bash
NETWORK=mainnet \
ADMIN_SECRET_KEY=$PROD_ADMIN_SK \
ORACLE_SECRET_KEY=$PROD_ORACLE_SK \
./scripts/deploy-testnet.sh
```

> Note: `deploy-testnet.sh` is network-agnostic; set `NETWORK=mainnet` and
> point to the mainnet RPC URL.

### Step 5 — Deploy application services

```bash
# Backend
cd backend && npm run build
pm2 restart carbonledger-backend

# Frontend
cd frontend && npm run build
pm2 restart carbonledger-frontend

# Oracle
sudo systemctl restart carbonledger-oracle
```

### Step 6 — Smoke test production

```bash
# Verify all contracts respond
REGISTRY_ID=$(grep CARBON_REGISTRY_CONTRACT_ID .env.mainnet | cut -d= -f2)
stellar contract invoke \
  --id "$REGISTRY_ID" \
  --network mainnet \
  -- get_project --project_id "smoke-test-$(date +%s)" 2>&1 \
  | grep -qiE "(error|null|project)" && echo "✅ Registry live" || echo "❌ Registry failed"

# Verify API health
curl -sf https://api.carbonledger.io/health | jq .
```

### Rollback

If production behaves unexpectedly after promotion:

```bash
# Rollback contracts: re-deploy previous WASM (idempotent)
FORCE_REDEPLOY=true \
NETWORK=mainnet \
ADMIN_SECRET_KEY=$PROD_ADMIN_SK \
ORACLE_SECRET_KEY=$PROD_ORACLE_SK \
./scripts/deploy-testnet.sh

# Rollback backend/frontend: use PM2 + git
git checkout previous-release-tag
npm ci && npm run build
pm2 restart carbonledger-backend carbonledger-frontend

# Rollback infrastructure: revert tfvars change and re-apply
git checkout previous-release-tag -- infra/main/
terraform apply -var-file=production.tfvars \
  -var="db_username=$DB_USER" \
  -var="db_password=$DB_PASS"
```

### Environment Parity Verification

Run this after any infrastructure change to confirm parity:

```bash
# Both plans should show the same resource types (different sizes only)
terraform workspace select staging
terraform plan -var-file=staging.tfvars \
  -var="db_username=x" -var="db_password=x" \
  -out=/tmp/staging.plan

terraform workspace select production
terraform plan -var-file=production.tfvars \
  -var="db_username=x" -var="db_password=x" \
  -out=/tmp/production.plan

# Compare resource types (not sizes) — should be identical
terraform show -json /tmp/staging.plan    | jq '[.resource_changes[].type] | sort' > /tmp/staging-types.json
terraform show -json /tmp/production.plan | jq '[.resource_changes[].type] | sort' > /tmp/production-types.json
diff /tmp/staging-types.json /tmp/production-types.json && echo "✅ Parity verified" || echo "❌ Parity mismatch"
```
