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
