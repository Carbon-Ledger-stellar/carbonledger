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
- [License](#-license)

---

## 🎯 New Contributors Start Here!

**Want to contribute?** We've created comprehensive guides to get you started in under 30 minutes:

- 📖 **[New Contributor Guide](docs/NEW_CONTRIBUTOR_GUIDE.md)** - Complete overview
- 🚀 **[Quick Start Guide](docs/QUICK_START.md)** - Setup in 15-25 minutes
- ✅ **[Setup Checklist](docs/SETUP_CHECKLIST.md)** - Verify your environment
- 🔧 **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues solved
- 📋 **[Quick Reference](docs/QUICK_REFERENCE.md)** - One-page command reference

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

```
carbonledger/
├── contracts/
│   ├── carbon_registry/
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   ├── carbon_credit/
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   ├── carbon_marketplace/
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   └── carbon_oracle/
│       ├── src/lib.rs
│       └── Cargo.toml
├── oracle/
│   ├── verification_listener.py
│   ├── price_oracle.py
│   ├── satellite_monitor.py
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── projects/
│   │   ├── marketplace/
│   │   ├── buy/
│   │   ├── retire/
│   │   ├── dashboard/
│   │   ├── verify/
│   │   └── audit/
│   ├── components/
│   │   ├── CreditCard.tsx
│   │   ├── RetirementCertificate.tsx
│   │   ├── ProvenanceTrail.tsx
│   │   ├── MarketplaceFilter.tsx
│   │   ├── BulkPurchaseCart.tsx
│   │   ├── AuditExplorer.tsx
│   │   ├── SerialNumberLookup.tsx
│   │   ├── OracleStatus.tsx
│   │   ├── Toast.tsx
│   │   ├── LoadingSkeleton.tsx
│   │   ├── ErrorBoundary.tsx
│   │   └── TransactionStatus.tsx
│   ├── lib/
│   │   ├── stellar.ts
│   │   ├── soroban.ts
│   │   ├── freighter.ts
│   │   ├── carbon-utils.ts
│   │   ├── sdex.ts
│   │   ├── api.ts
│   │   └── wallet-errors.ts
│   └── styles/
│       └── design-system.ts
├── backend/
│   ├── src/
│   │   ├── auth/
│   │   ├── projects/
│   │   ├── credits/
│   │   ├── retirements/
│   │   ├── marketplace/
│   │   └── oracle/
│   └── prisma/schema.prisma
├── .github/
│   └── workflows/ci.yml
├── .env.example
├── docker-compose.yml
├── Stellar.toml
└── README.md
```

---

##  Getting Started

### For Contributors

**New to the project?** Follow our step-by-step guide:

📖 **[Quick Start Guide](docs/QUICK_START.md)** - Get running in under 30 minutes

📝 **[Contributing Guide](CONTRIBUTING.md)** - Detailed setup with troubleshooting

🔧 **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions

### Quick Setup

```bash
# 1. Clone and configure
git clone https://github.com/YOUR_USERNAME/carbonledger.git
cd carbonledger
cp .env.example .env

# 2. Install Rust toolchain
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --version 21.0.0

# 3. Setup database
createdb carbonledger

# 4. Install dependencies
cd backend && npm install && npx prisma migrate dev && cd ..
cd frontend && npm install && cd ..
cd oracle && pip3 install -r requirements.txt && cd ..
cd contracts && cargo build --target wasm32-unknown-unknown --release && cd ..

# 5. Run tests
./scripts/test-all.sh
```

### Verify Your Setup

```bash
# Linux/macOS
./scripts/verify-setup.sh

# Windows
.\scripts\verify-setup.ps1
```

### Prerequisites

| Tool | Version | Installation |
|------|---------|--------------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Rust | 1.74+ | [rustup.rs](https://rustup.rs) |
| Python | 3.10+ | [python.org](https://python.org) |
| PostgreSQL | 14+ | [postgresql.org](https://postgresql.org) |
| Docker | 24+ (optional) | [docker.com](https://docker.com) |

---

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

```bash
docker-compose up --build
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
