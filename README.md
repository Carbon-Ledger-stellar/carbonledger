#  CarbonLedger

> **Verified carbon credits. Permanent retirement. Full provenance.**  
> A decentralized carbon credit marketplace on Stellar where carbon projects mint tokenized RWAs, corporations buy and retire them on-chain, and every credit has an immutable audit trail from issuance to retirement.

![Stellar](https://img.shields.io/badge/Stellar-Soroban-7C3AED?style=for-the-badge&logo=stellar&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-Smart_Contracts-orange?style=for-the-badge&logo=rust&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js&logoColor=white)
![USDC](https://img.shields.io/badge/Stablecoin-USDC-2775CA?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-In_Development-yellow?style=for-the-badge)

---
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/4b0f600a-b771-4a4f-949b-d5516055bccb" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/84e0166c-abcb-434b-9cb5-d43c6150bb42" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/7c302ff7-779a-4d69-9201-bd049246061b" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/31782501-adce-4a49-8674-bbe7b96be905" />


<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/6820e80e-389f-4769-b440-94be5077adf1" />


website https://carbon-truth-chain.lovable.app/
website https://v0.app/dev-fatima-24s-projects/chat/frontend-build-rJlPO6dX1jO?f=1

##  Table of Contents

- [The Problem](#-the-problem)
- [The Solution](#-the-solution)
- [How It Works](#-how-it-works)
- [Architecture](#-architecture)
- [Smart Contracts](#-smart-contracts)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Contract Deployment](#-contract-deployment)
- [Oracle Setup](#-oracle-setup)
- [Frontend Setup](#-frontend-setup)
- [Running Tests](#-running-tests)
- [User Roles](#-user-roles)
- [Credit Lifecycle](#-credit-lifecycle)
- [Roadmap](#-roadmap)
- [Changelog](#-changelog)
- [Contributing](#-contributing)
- [Security](#-security)
- [License](#-license)

---

## 🎯 New Contributors Start Here!

**Want to contribute?** We've created comprehensive guides to get you started in under 30 minutes:

- 📖 **[New Contributor Guide](docs/NEW_CONTRIBUTOR_GUIDE.md)** - Complete overview
- 🚀 **[Quick Start Guide](docs/QUICK_START.md)** - Setup in 15-25 minutes
- ✅ **[Setup Checklist](docs/SETUP_CHECKLIST.md)** - Verify your environment
- 🔧 **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues solved
- 📋 **[Quick Reference](docs/QUICK_REFERENCE.md)** - One-page command reference
- 🔑 **[Configuration Guide](docs/configuration.md)** - Every environment variable explained
- ♻️ **[Credit Lifecycle](docs/carbon-credit-lifecycle.md)** - Actors, contracts, data, and error conditions for each stage

**Run this to verify your setup:**
```bash
./scripts/verify-setup.sh  # Linux/macOS
.\scripts\verify-setup.ps1  # Windows
```

---

##  The Problem

The voluntary carbon credit market moves over **$2 billion annually** — yet it is riddled with:

- **Fraud** — projects claiming credits for sequestration that never happened
- **Double-counting** — the same tonne of CO2 sold to multiple buyers
- **Opacity** — corporations have no way to verify what they actually bought
- **Greenwashing** — retired credits with no on-chain proof of retirement
- **Inaccessibility** — small projects cannot afford traditional registry fees

The result is a market where companies pay real money for carbon credits that may not represent real impact — and have no way to prove otherwise to regulators or the public.

---

##  The Solution

**CarbonLedger** puts the entire carbon credit lifecycle on Stellar:

- Every credit is minted with a **unique serial number** — double counting is mathematically impossible
- Every retirement is **permanently irreversible on-chain** — greenwashing is eliminated
- Every credit carries **full provenance** — from project registration to satellite monitoring to issuance to transfer to retirement
- Every retirement generates a **beautiful verifiable certificate** with a permanent public URL
- The entire audit trail is **publicly accessible without a wallet** — regulators, journalists, and the public can verify everything

---

## ⚙️ How It Works

```
PROJECT DEVELOPER          CARBONLEDGER               CORPORATION
       │                        │                           │
       │── Submit project ─────►│                           │
       │   (methodology +       │                           │
       │    coordinates)        │                           │
       │                        │◄── Oracle monitoring ─────│
       │◄── Project verified ───│    (satellite data)       │
       │                        │                           │
       │── Request issuance ───►│                           │
       │   (verified tonnes)    │                           │
       │◄── Credits minted ─────│                           │
       │   (serial numbers      │                           │
       │    assigned)           │                           │
       │                        │◄── Browse marketplace ────│
       │                        │◄── Purchase credits ──────│
       │◄── USDC payment ───────│                           │
       │                        │◄── Retire credits ────────│
       │                        │    (beneficiary + reason) │
       │                        │──► Certificate issued ────►│
       │                        │    (permanent on-chain)   │
```

---

##  Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    NEXT.JS 14 FRONTEND                       │
│   Public Audit │ Marketplace │ Buy │ Retire │ Dashboard      │
└───────────────────────────┬──────────────────────────────────┘
                            │  @stellar/stellar-sdk
                            │  @stellar/freighter-api
┌───────────────────────────▼──────────────────────────────────┐
│                  SOROBAN CONTRACTS (Rust)                    │
│  carbon_registry │ carbon_credit │ carbon_marketplace        │
│  carbon_oracle                                               │
└───────────────────────────┬──────────────────────────────────┘
                            │  py-stellar-base
┌───────────────────────────▼──────────────────────────────────┐
│            ORACLE / VERIFICATION BRIDGE (Python)             │
│  verification_listener │ price_oracle │ satellite_monitor    │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│          OFF-CHAIN LAYER (PostgreSQL + IPFS)                 │
│  Project docs │ Credit batches │ Retirements │ Certificates  │
└──────────────────────────────────────────────────────────────┘
```

> Key architectural decisions are documented in [docs/adr/](docs/adr/). See the [ADR index](docs/adr/README.md) for the full list.

---

##  Smart Contracts

CarbonLedger deploys 4 Soroban contracts written in Rust:

### `carbon_registry`
Manages carbon project registration, verification, and lifecycle status.

| Function | Description |
|----------|-------------|
| `register_project()` | Submit a new carbon project for verification |
| `verify_project()` | Accredited verifier approves a project |
| `reject_project()` | Permanently reject a fraudulent project |
| `suspend_project()` | Halt new issuance from project under investigation |
| `update_project_status()` | Oracle pushes monitoring data on-chain |
| `get_project()` | Query full project details |

### `carbon_credit`
Mints, transfers, and permanently retires tokenized carbon credits.

| Function | Description |
|----------|-------------|
| `mint_credits()` | Mint credits for verified projects with unique serial numbers |
| `retire_credits()` | Permanently and irreversibly retire credits on-chain |
| `transfer_credits()` | Transfer credits between accounts |
| `verify_serial_range()` | Detect double issuance before minting |
| `get_credit_batch()` | Query a credit batch by ID |
| `get_retirement_certificate()` | Retrieve a permanent retirement certificate |

### `carbon_marketplace`
Handles credit listings, purchases, and bulk corporate buying.

| Function | Description |
|----------|-------------|
| `list_credits()` | List credits for sale with price per tonne |
| `delist_credits()` | Remove an active listing |
| `purchase_credits()` | Buy credits — USDC to seller, credits to buyer |
| `bulk_purchase()` | Corporations buy from multiple projects in one tx |
| `get_active_listings()` | Browse all available credits |
| `get_listings_by_vintage()` | Filter credits by vintage year |

### `carbon_oracle`
Receives and validates off-chain monitoring and price data.

| Function | Description |
|----------|-------------|
| `submit_monitoring_data()` | Verifier pushes satellite monitoring data |
| `update_credit_price()` | Push benchmark price per methodology and vintage |
| `flag_project()` | Flag a project for investigation |
| `is_monitoring_current()` | Returns false if no data in last 365 days |
| `get_benchmark_price()` | Get current market price per methodology |

### Error Constants

```rust
pub enum CarbonError {
    ProjectNotFound          = 1,
    ProjectNotVerified       = 2,
    ProjectSuspended         = 3,
    InsufficientCredits      = 4,
    AlreadyRetired           = 5,
    SerialNumberConflict     = 6,
    UnauthorizedVerifier     = 7,
    UnauthorizedOracle       = 8,
    InvalidVintageYear       = 9,
    ListingNotFound          = 10,
    InsufficientLiquidity    = 11,
    PriceNotSet              = 12,
    MonitoringDataStale      = 13,
    DoubleCountingDetected   = 14,
    RetirementIrreversible   = 15,
    ZeroAmountNotAllowed     = 16,
    ProjectAlreadyExists     = 17,
    InvalidSerialRange       = 18,
}
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Rust + Soroban SDK |
| Blockchain | Stellar Mainnet / Testnet |
| Frontend | Next.js 14 (App Router) + TypeScript |
| Wallet | Freighter (@stellar/freighter-api) |
| Stellar SDK | @stellar/stellar-sdk, soroban-client |
| Payment Token | USDC on Stellar |
| Trading | Stellar DEX (SDEX) |
| Oracle Bridge | Python + py-stellar-base |
| Satellite Data | Google Earth Engine / Planet Labs |
| Price Feeds | Xpansiv CBL + Toucan Protocol |
| Database | PostgreSQL + Prisma ORM |
| File Storage | IPFS via Pinata |
| Auth | JWT + Stellar keypair + SEP-0030 |
| Backend API | NestJS |
| Testing | Rust unit tests + Stellar Testnet |

---

##  Project Structure

> For the full annotated reference, see **[docs/folder-structure.md](docs/folder-structure.md)**.

```
carbonledger/
├── .github/          # CI/CD workflows, issue templates, and PR template
├── audit/            # Pre-audit checklist and security review artifacts
├── backend/          # NestJS REST API — auth, projects, credits, retirements, marketplace, oracle
│   └── prisma/
│       └── schema.prisma  # Prisma database schema — all PostgreSQL models and relations
├── components/       # Shared UI components used outside the Next.js app directory
├── contracts/        # Soroban smart contracts written in Rust
│   └── Cargo.toml    # Rust workspace manifest for all Soroban contract crates
├── docs/             # Project documentation: guides, ADRs, runbooks, API references
├── frontend/         # Next.js 14 (App Router) web application
├── hooks/            # Shared React hooks used across the monorepo
├── infra/            # Infrastructure-as-code (Terraform) for cloud provisioning
├── load-tests/       # k6 load test scripts and results for the marketplace API
├── logging/          # Observability stack configuration: Loki, Promtail, Grafana
├── oracle/           # Python oracle bridge: verification listener, price feeds, satellite monitor
├── scripts/          # Developer utility scripts: setup, deploy, test runners, DB backup
├── tests/            # Cross-contract and upgrade path integration tests (Rust)
├── .env.example      # Environment variable template — copy to .env before running locally
├── docker-compose.yml  # Local development stack definition — starts all services with one command
├── Stellar.toml      # SEP-0001 metadata file for the Stellar network
└── README.md
```

---

##  Getting Started

**Estimated setup time: 25-40 minutes**

Follow these steps to set up CarbonLedger for local development and testing on a clean Ubuntu 22.04 or macOS 14 system.

### 1. Prerequisites (5 minutes)

Ensure you have the following installed:

- [Node.js](https://nodejs.org) (version 18+)
- [Rust](https://rustup.rs) (version 1.74+)
- [Python](https://python.org) (version 3.10+)
- [PostgreSQL](https://postgresql.org) (version 14+)
- [Redis](https://redis.io) (version 6+)
- [Git](https://git-scm.com)

You can verify your installation with:
```bash
./scripts/verify-setup.sh
```

### 2. Clone and Configure (2 minutes)

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/carbonledger.git
cd carbonledger

# Copy environment file
cp .env.example .env

# Edit .env and set these minimum values:
# - DATABASE_URL=postgresql://carbonledger:changeme@localhost:5432/carbonledger
# - JWT_SECRET=your-random-secret-key (use `openssl rand -hex 32` to generate)
# - REDIS_PASSWORD=changeme (optional, but recommended)
```

### 3. Install Rust Toolchain (3 minutes)

```bash
# Add WebAssembly target for Soroban smart contracts
rustup target add wasm32-unknown-unknown

# Install Stellar CLI for contract deployment
cargo install --locked stellar-cli --version 21.0.0
```

### 4. Setup PostgreSQL (3 minutes)

```bash
# Start PostgreSQL service if not running
# macOS: brew services start postgresql@16
# Linux (Ubuntu): sudo systemctl start postgresql

# Create database and user
createdb carbonledger
# Or if you prefer to set up a user and password:
# sudo -u postgres psql -c "CREATE USER carbonledger WITH PASSWORD 'changeme';"
# sudo -u postgres psql -c "ALTER USER carbonledger WITH SUPERUSER;"
# sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE carbonledger TO carbonledger;"
# Then update .env accordingly
```

### 5. Setup Redis (2 minutes)

```bash
# Start Redis service
# macOS: brew services start redis
# Linux (Ubuntu): sudo systemctl start redis
# Alternatively, you can run Redis in the background:
# redis-server --daemonize yes

# Verify Redis is running
redis-cli ping
# Should return: PONG
```

### 6. Configure Stellar Testnet and Create Funded Account (5 minutes)

```bash
# Generate a funded testnet account (requires Stellar CLI)
stellar keys generate deployer --network testnet --fund

# Save the generated secret key securely - you'll need it for deployment
# Example output:
#   Secret Key: SDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
#   Public Key: GAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Fund your account with testnet XLM (if not already funded by the --fund flag)
# You can also friendbot: curl https://friendbot.stellar.org/?addr=GAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 7. Install Freighter Wallet and Configure for Testnet (3 minutes)

1. Install the [Freighter wallet extension](https://freighter.app) for your browser (Chrome/Firefox).
2. Create a new wallet or import an existing one.
3. In Freighter settings, switch to **Testnet** network.
4. (Optional) Fund your Freighter wallet with testnet XLM using the Stellar Discord faucet or by sending from your deployer account.

### 8. Install Dependencies (7 minutes)

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma migrate dev
cd ..

# Frontend
cd frontend
npm install
cd ..

# Oracle (Python)
cd oracle
pip3 install -r requirements.txt
cd ..

# Note: Contracts will be built in the next step
```

### 9. Build Contracts (2 minutes)

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
cd ..
```

### 10. Deploy Contracts to Testnet (5 minutes)

```bash
cd contracts

# Replace 'deployer' with the alias you used in step 6, or use the secret key directly
# Example using the alias:
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source deployer \
  --network testnet

# Repeat for carbon_credit, carbon_marketplace, and carbon_oracle contracts
# Save the returned contract IDs to your .env file:
#   CARBON_REGISTRY_CONTRACT_ID=...
#   CARBON_CREDIT_CONTRACT_ID=...
#   CARBON_MARKETPLACE_CONTRACT_ID=...
#   CARBON_ORACLE_CONTRACT_ID=...
#   USDC_CONTRACT_ID= (use the testnet USDC contract: GDTTYN6ZEVJZAINM4AA642YOZBTT5DT4JY3UDZVKWYGJEQS6S6J6Y6ZE - see Stellar.toml for the configured value)
```

> **Note**: The testnet USDC contract address on Stellar testnet is: `GDTTYN6ZEVJZAINM4AA642YOZBTT5DT4JY3UDZVKWYGJEQS6S6J6Y6ZE` (as of the time of writing, but check [Stellar.toml](Stellar.toml) in the repo for the configured value).

### 11. Start Oracle Services (2 minutes to start, then they run in background)

```bash
# Start verification listener (polls every 6 hours)
cd oracle
python3 verification_listener.py &
# Example output:
#   [INFO] Verification listener started
#   [INFO] Listening for new verification requests on blockchain...
#   [INFO] Next check in: 6 hours

# Start price oracle (runs every 12 hours)
python3 price_oracle.py &
# Example output:
#   [INFO] Price oracle started
#   [INFO] Fetching benchmark prices from Xpansiv CBL and Toucan Protocol...
#   [INFO] Next update in: 12 hours

# Start satellite monitor (webhook receiver)
python3 satellite_monitor.py &
# Example output:
#   [INFO] Satellite monitor started
#   [INFO] Listening for webhooks on port 5001
#   [INFO] Ready to receive satellite data from Google Earth Engine

cd ..
# Note: These services run in the background. You can stop them with `kill %1` `kill %2` `kill %3` or by closing the terminal.
```

### 12. Run Tests (10 minutes)

```bash
# Run all tests to verify your setup
./scripts/test-all.sh

# Expected output:
#   ✓ Carbon Registry Tests passed
#   ✓ Carbon Credit Tests passed
#   ✓ Carbon Marketplace Tests passed
#   ✓ Carbon Oracle Tests passed
#   ✓ Backend Unit Tests passed
#   ✓ Frontend Unit Tests passed
#   All tests passed! ✓
```

### 13. Start Development Servers (Optional)

```bash
# Terminal 1: Backend
cd backend
npm run start:dev
# → http://localhost:3001

# Terminal 2: Frontend
cd frontend
npm run dev
# → http://localhost:3000

# Terminal 3: Oracle services (if not already started)
cd oracle
python3 verification_listener.py &
python3 price_oracle.py &
python3 satellite_monitor.py &
```

### ✅ Success Criteria

After completing these steps, you should have:
- A running PostgreSQL database
- A running Redis instance
- Deployed contracts on Stellar testnet
- Configured Freighter wallet connected to testnet
- Oracle services running in the background
- All tests passing

You are now ready to contribute to CarbonLedger!

---

### 🐳 Alternative: Docker Setup

If you prefer Docker (still requires Rust toolchain for contract development):

```bash
# Copy environment file
cp .env.example .env

# Start all services (PostgreSQL, Redis, Backend, Frontend, Oracle)
docker-compose up --build

# Services will be available at:
# - Frontend: http://localhost:3000
# - Backend: http://localhost:3001
# - PostgreSQL: localhost:5432
# - Redis: localhost:6379
```

**Note**: You still need to:
1. Install Rust toolchain (for contract development)
2. Generate a funded testnet account (step 6 above)
3. Deploy contracts (step 10 above) using the Stellar CLI
4. Start oracle services (step 11 above) if not using Docker for them (they are included in docker-compose)

## 🔗 Contract Deployment

```bash
cd contracts

# Build all contracts
cargo build --target wasm32-unknown-unknown --release

# Deploy carbon_registry
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet

# Deploy carbon_credit
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_credit.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet

# Deploy carbon_marketplace
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_marketplace.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet

# Deploy carbon_oracle
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_oracle.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet
```

Save all returned contract IDs to your `.env` file.

---

##  Oracle Setup

```bash
cd oracle
pip install -r requirements.txt

# Start verification listener (polls every 6 hours)
python3 verification_listener.py

# Start price oracle (runs every 12 hours)
python3 price_oracle.py

# Start satellite monitor (webhook receiver)
python3 satellite_monitor.py
```

---

## 💻 Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

Install [Freighter wallet](https://freighter.app) and switch to **Testnet**.

---

## 🐳 Run With Docker

The complete development stack can be started with a single command:

```bash
docker-compose up --build
```

This starts all services:
- **PostgreSQL** (port 5432) - Database with health checks
- **Redis** (port 6379) - Cache with Sentinel HA
- **NestJS Backend** (port 3001) - API server with health checks
- **Next.js Frontend** (port 3000) - Web application
- **Oracle Services** (port 5001) - Verification, price, and satellite monitoring
- **Observability Stack** - Loki, Promtail, and Grafana for logging

### Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key variables:
- `POSTGRES_PASSWORD` - Database password
- `REDIS_PASSWORD` - Redis password
- `JWT_SECRET` - Backend JWT secret
- `STELLAR_NETWORK` - testnet or public
- Contract IDs for `CARBON_*_CONTRACT_ID`

### Service Dependencies

Services start in order with health checks:
1. PostgreSQL and Redis start first
2. Backend waits for database and Redis to be healthy
3. Frontend waits for backend to be healthy
4. Oracle services connect to database and blockchain

### Development with Hot Reload

Volume mounts enable hot reload:
- Backend: `./backend` → `/app` (NestJS watches for changes)
- Frontend: `./frontend` → `/app` (Next.js dev mode)
- Oracle: `./oracle` → `/app` (Python auto-reload)

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f oracle_verification

# Grafana dashboards
# Open http://localhost:3200 (default: admin/admin)
```

### Stopping Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

---

##  Running Tests

### Run All Tests

```bash
# Automated test runner
./scripts/test-all.sh

# Or manually:
cd contracts && cargo test          # 30 Rust tests
cd backend && npm test              # Backend tests
cd frontend && npm test             # Frontend tests
```

### Individual Test Suites

```bash
# Rust contracts
cd contracts
cargo test                          # All contracts
cargo test -p carbon_registry       # Specific contract
cargo test -- --nocapture           # With output

# Backend (NestJS)
cd backend
npm test                            # All tests
npm test -- --watch                 # Watch mode
npm test projects.service.spec.ts   # Specific file

# Frontend (Next.js)
cd frontend
npm test                            # All tests
npm test -- --coverage              # With coverage
```

### Test Coverage (30 tests across 4 contracts)

| Contract | Tests |
|----------|-------|
| carbon_registry | 7 tests |
| carbon_credit | 10 tests |
| carbon_marketplace | 7 tests |
| carbon_oracle | 6 tests |

**See:** [CONTRIBUTING.md](CONTRIBUTING.md#running-tests) for detailed testing guide

---

##  User Roles

###  Project Developer
- Register carbon offset project with methodology and coordinates
- Submit monitoring data for credit issuance
- Track issued vs retired credits and receive USDC payments

###  Corporation
- Browse credits by methodology, vintage year, country, and price
- Purchase single or bulk credits from multiple projects
- Retire credits and download permanent certificates for ESG reporting

###  Verifier
- Accredited verifiers approve projects for credit issuance
- Submit on-chain attestations for monitoring periods
- Earn attestation fees per verified project

###  Public / Auditor
- Browse full audit trail without wallet connection
- Look up any serial number and see complete history
- Verify retirement certificates via permanent public URL

---

##  Credit Lifecycle

```
Project Registered → Verifier Approved → Oracle Monitoring →
Credits Minted (serial numbers assigned) → Listed on Marketplace →
Purchased by Corporation → Retired On-Chain (irreversible) →
Certificate Issued (permanent public URL) →
ESG Report Filed 
```

> For the full lifecycle reference — actors involved, contract functions called, on-chain and off-chain data, error conditions, and a sequence diagram — see **[docs/carbon-credit-lifecycle.md](docs/carbon-credit-lifecycle.md)**.

---

##  Key Parameters

| Parameter | Value |
|-----------|-------|
| Serial number uniqueness | Globally enforced across all batches |
| Retirement | Permanently irreversible on-chain |
| Oracle freshness | 365 days maximum for monitoring data |
| Price cache TTL | 24 hours temporary storage |
| Methodology score minimum | 70 out of 100 |
| Price deviation alert | 15% single update threshold |
| Protocol fee | 1% of each transaction |

---

##  Roadmap

### Phase 1 — Contracts 
- [x] `carbon_registry` — project registration and verification
- [x] `carbon_credit` — mint, retire, transfer with serial numbers
- [x] `carbon_marketplace` — list, buy, bulk purchase
- [x] `carbon_oracle` — monitoring data and price feeds
- [x] 30 Rust unit tests
- [x] Stellar Testnet deployment

### Phase 2 — Oracle Layer 
- [ ] Verification listener service
- [ ] Xpansiv CBL price feed integration
- [ ] Google Earth Engine satellite webhook
- [ ] End-to-end oracle → Soroban test

### Phase 3 — Frontend 
- [ ] Freighter wallet integration
- [ ] Public audit explorer (no wallet required)
- [ ] Corporate bulk purchase flow
- [ ] Retirement certificate PDF generator
- [ ] Serial number lookup tool

### Phase 4 — Mainnet 
- [ ] Smart contract security audit
- [ ] Gold Standard and Verra VCS methodology validation
- [ ] Mainnet deployment
- [ ] Regulatory compliance review
- [ ] Third party registry API integrations

---

##  Contributing

We welcome contributions! Here's how to get started:

### Quick Links

- 📖 [Quick Start Guide](docs/QUICK_START.md) - Setup in under 30 minutes
- 📝 [Contributing Guide](CONTRIBUTING.md) - Detailed setup and workflow
- 🔧 [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and fixes
- 🏷️ [Good First Issues](https://github.com/YOUR_USERNAME/carbonledger/labels/good%20first%20issue)

### Development Workflow

```bash
# 1. Create feature branch
git checkout -b feat/your-feature-name

# 2. Make changes and test
./scripts/test-all.sh

# 3. Commit with conventional commits
git commit -m "feat: add serial number validation"

# 4. Push and create PR
git push origin feat/your-feature-name
```

### Code Guidelines

- Follow [Conventional Commits](https://www.conventionalcommits.org/)
- Use `CarbonError` enum for all contract errors
- Follow checks-effects-interactions pattern in Soroban contracts
- Retirement must always be irreversible
- Avoid crypto jargon on buyer-facing pages
- Add tests for new features
- Update documentation

**See:** [CONTRIBUTING.md](CONTRIBUTING.md) for complete guidelines

---

## 📜 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a full history of changes and releases.

---

## 🔒 Security

We take security seriously. If you discover a vulnerability, please report it responsibly:

- **Do not** open a public GitHub issue
- **Email** security@carbonledger.io with details
- See [SECURITY.md](./SECURITY.md) for our full security policy, threat model, and responsible disclosure process

---

##  License

MIT License — see [LICENSE](./LICENSE) for details.

---

##  Acknowledgements

- [Stellar Development Foundation](https://stellar.org) — Soroban and RWA infrastructure
- [Verra VCS](https://verra.org) — carbon methodology standards
- [Gold Standard](https://goldstandard.org) — verification framework
- [Xpansiv CBL](https://xpansiv.com) — carbon market price data
- [Google Earth Engine](https://earthengine.google.com) — satellite monitoring

---

<div align="center">

**Built on Stellar. Built for the planet.**

⭐ Star this repo if CarbonLedger matters to you

[Website](#) · [Audit Explorer](#) · [Twitter](#) · [Discord](#)

</div>
