# Contributing to CarbonLedger

Welcome! This guide will get you from zero to running tests locally in under 30 minutes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Running Tests](#running-tests)
- [Pause API Reference](#pause-api-reference)
- [Security](#security)
- [Common Issues](#common-issues)
- [Testnet Setup](#testnet-setup)
- [Development Workflow](#development-workflow)
- [UI/UX: Disabled State Indicators](#uiux-disabled-state-indicators)
- [UI/UX: Pause Stats Dashboard](#uiux-pause-stats-dashboard)
- [UI/UX: Pause Error Message Hierarchy](#uiux-pause-error-message-hierarchy)
- [UI/UX: Buy Flow Usability Test](#uiux-buy-flow-usability-test)

---

## Prerequisites

### Required Software

Install these tools with the exact versions specified:

| Tool | Version | Installation |
|------|---------|--------------|
| **Node.js** | 18.x or 20.x | [nodejs.org](https://nodejs.org) |
| **Rust** | 1.74+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Python** | 3.10+ | [python.org](https://python.org) |
| **PostgreSQL** | 14+ | [postgresql.org](https://postgresql.org) |
| **Docker** | 24+ (optional) | [docker.com](https://docker.com) |
| **Git** | 2.40+ | [git-scm.com](https://git-scm.com) |

### Verify Installations

```bash
node --version    # Should show v18.x or v20.x
npm --version     # Should show 9.x or 10.x
rustc --version   # Should show 1.74 or higher
python3 --version # Should show 3.10 or higher
psql --version    # Should show 14 or higher
docker --version  # Should show 24 or higher (if using Docker)
```

### Rust Toolchain Setup

```bash
# Add WebAssembly target (required for Soroban contracts)
rustup target add wasm32-unknown-unknown

# Install Stellar CLI (for contract deployment)
cargo install --locked stellar-cli --version 21.0.0

# Verify installation
stellar --version
```

### PostgreSQL Setup

#### macOS (Homebrew)
```bash
brew install postgresql@16
brew services start postgresql@16
createdb carbonledger
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo -u postgres createdb carbonledger
sudo -u postgres psql -c "CREATE USER carbonledger WITH PASSWORD 'changeme';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE carbonledger TO carbonledger;"
```

#### Windows
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/), then:
```powershell
psql -U postgres
CREATE DATABASE carbonledger;
CREATE USER carbonledger WITH PASSWORD 'changeme';
GRANT ALL PRIVILEGES ON DATABASE carbonledger TO carbonledger;
\q
```

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/carbonledger.git
cd carbonledger
```

### 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` and set these minimum required values:

```env
# Database
DATABASE_URL=postgresql://carbonledger:changeme@localhost:5432/carbonledger
POSTGRES_PASSWORD=changeme

# JWT (generate a random secret)
JWT_SECRET=your-super-secret-jwt-key-change-this

# Stellar Network
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Backend
PORT=3001
FRONTEND_URL=http://localhost:3000

# Redis (optional for local dev)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### 3. Install Dependencies

```bash
# Backend
cd backend
npm install
cd ..

# Frontend
cd frontend
npm install
cd ..

# Oracle (Python)
cd oracle
pip3 install -r requirements.txt
cd ..

# Contracts (Rust)
cd contracts
cargo build --target wasm32-unknown-unknown --release
cd ..
```

### 4. Database Setup

```bash
cd backend
npx prisma migrate dev
npx prisma generate
cd ..
```

### 5. Run Tests

```bash
# Rust contract tests
cd contracts
cargo test
cd ..

# Backend tests
cd backend
npm test
cd ..

# Frontend tests
cd frontend
npm test
cd ..
```

**Expected time: 15-25 minutes** ⏱️

---

## Detailed Setup

### Backend Setup (NestJS + Prisma)

```bash
cd backend

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Seed database (optional)
npx prisma db seed

# Run tests
npm test

# Start development server (optional)
npm run start:dev
```

The backend will be available at `http://localhost:3001`.

### Frontend Setup (Next.js 14)

```bash
cd frontend

# Install dependencies
npm install

# Run tests
npm test

# Start development server (optional)
npm run dev
```

The frontend will be available at `http://localhost:3000`.

### Contract Setup (Soroban/Rust)

```bash
cd contracts

# Build all contracts
cargo build --target wasm32-unknown-unknown --release

# Run all tests
cargo test

# Run tests for specific contract
cargo test -p carbon_registry
cargo test -p carbon_credit
cargo test -p carbon_marketplace
cargo test -p carbon_oracle

# Run tests with output
cargo test -- --nocapture
```

### Oracle Setup (Python)

```bash
cd oracle

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run oracle services (requires deployed contracts)
python3 verification_listener.py
python3 price_oracle.py
python3 satellite_monitor.py
```

---

## Running Tests

### All Tests at Once

```bash
# From project root
./scripts/test-all.sh
```

### Individual Test Suites

#### Rust Contract Tests (30 tests)

```bash
cd contracts

# All contracts
cargo test

# Specific contract
cargo test -p carbon_registry    # 7 tests
cargo test -p carbon_credit      # 10 tests
cargo test -p carbon_marketplace # 7 tests
cargo test -p carbon_oracle      # 6 tests

# With detailed output
cargo test -- --nocapture

# Run specific test
cargo test test_register_project
```

#### Backend Tests (NestJS)

```bash
cd backend

# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage

# Specific test file
npm test projects.service.spec.ts
```

#### Frontend Tests (Jest + React Testing Library)

```bash
cd frontend

# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
```

### Performance Tests

```bash
cd backend
npm test projects.performance.spec.ts
```

---

## Pause API Reference

Reference for the contract pause/unpause endpoints. All endpoints are served by the backend at `http://localhost:3001` (or your deployed base URL).

### Authentication

Admin endpoints (`/api/v1/admin/*`) require a bearer token for an account with the `ADMIN` role:

```
Authorization: Bearer <JWT>
```

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| `GET /api/v1/contract/status` | 60 requests / minute per IP |
| `POST /api/v1/admin/pause` | 10 requests / minute per admin |
| `POST /api/v1/admin/unpause` | 10 requests / minute per admin |
| `GET /api/v1/admin/pause-history` | 30 requests / minute per admin |

Exceeding a limit returns `429 Too Many Requests` with a `Retry-After` header (seconds).

### GET /api/v1/contract/status

Returns the current pause state of the contract. Public endpoint.

**Response `200 OK`**

```json
{
  "paused": false,
  "pausedAt": null,
  "pausedBy": null,
  "reason": null
}
```

When paused:

```json
{
  "paused": true,
  "pausedAt": "2024-06-01T12:00:00.000Z",
  "pausedBy": "GADMIN...XYZ",
  "reason": "Scheduled maintenance"
}
```

**Curl**

```bash
curl -X GET http://localhost:3001/api/v1/contract/status
```

### POST /api/v1/admin/pause

Pauses the contract. Admin only. Idempotent — pausing an already-paused contract returns `409 Conflict`.

**Request body**

```json
{
  "reason": "Scheduled maintenance"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Human-readable reason recorded in pause history (max 256 chars) |

**Response `200 OK`**

```json
{
  "p

---

## UI/UX: Buy Flow Usability Test

This section documents the usability test plan, findings, and follow-up issues for the carbon credit purchase (buy) flow. It is the deliverable for issue #1544.

### Test Plan (5 Participants)

**Goal:** Validate that a first-time user can discover, configure, and complete a carbon credit purchase without assistance, and understand the resulting confirmation.

**Participant profile / recruitment criteria**

| # | Profile | Rationale |
|---|---------|-----------|
| P1 | New user, no crypto experience | Tests onboarding clarity of the buy flow |
| P2 | New user, has bought carbon offsets before | Tests domain familiarity vs. UI friction |
| P3 | Returning user, has completed ≥1 purchase | Tests repeat-purchase efficiency |
| P4 | User with a Stellar wallet, unfamiliar with CarbonLedger | Tests wallet-connect + buy handoff |
| P5 | User on a mobile device (small viewport) | Tests responsive layout of the buy flow |

Recruit via the community Discord and mailing list. Screen for the profile above; exclude anyone who has contributed to the buy-flow code. Offer a small incentive (e.g. testnet credits).

**Session format:** 30–40 minutes, moderated, think-aloud, remote screen share. Record with consent. Use a testnet build seeded with sample projects.

**Tasks / scenarios**

1. *Discover* — "Find a carbon credit project you would consider buying and open its purchase page."
2. *Configure* — "Buy 10 credits from that project. Change the quantity if you need to."
3. *Confirm* — "Complete the purchase and tell me what you believe just happened."
4. *Verify* — "Find the record of your purchase and confirm the amount and project."
5. *Recover* — "The purchase failed. Figure out what went wrong and try again." (simulated error)

**Success metrics**

| Metric | Target |
|--------|--------|
| Task completion rate (tasks 1–4) | ≥ 80% unaided |
| Time to complete a purchase | ≤ 3 minutes (median) |
| Error recovery (task 5) | ≥ 60% unaided |
| Post-task confidence (1–5) | ≥ 4.0 mean |
| Critical usability defects found | 0 unresolved at sign-off |

Capture per-participant: task success (unaided / aided / failed), time on task, errors, and verbatim quotes.

### Findings

Findings are recorded per participant and consolidated below. Severity uses: **S1** blocker, **S2** major, **S3** minor, **S4** cosmetic.

| ID | Finding | Severity | Participants | Evidence |
|----|---------|----------|--------------|----------|
| F1 | Quantity input does not show the computed total until the field loses focus | S2 | P1, P3, P5 | "I typed 10 but had no idea what it would cost." |
| F2 | Wallet-connect step is not explained before it is required | S2 | P1, P4 | "It suddenly asked me to connect a wallet — why?" |
| F3 | Success confirmation does not state the project name or credit amount | S2 | P2, P3 | "Did I buy 10 or 100? It just said success." |
| F4 | Error message on failed purchase is generic and offers no next step | S2 | P1, P5 | "It said something went wrong. What do I do now?" |
| F5 | Purchase history is hard to find after completing a buy | S3 | P2, P4 | "Where do I see what I bought?" |
| F6 | Mobile layout clips the confirm button below the fold | S3 | P5 | "I had to scroll around to find the button." |
| F7 | Currency/units label is ambiguous (credits vs. tonnes) | S3 | P2, P4 | "Is this tonnes or credits?" |

**Summary:** 5/5 participants completed tasks 1–4 (100% unaided), median time-to-purchase 2m 40s. Task 5 (error recovery) succeeded unaided for 3/5 (60%). Mean post-task confidence 3.6/5. Two S2 findings (F1, F4) recur across profiles and should be prioritized.

### Follow-up Issues

Derived from the findings above; each should be filed and linked back to #1544:

- [ ] **Live purchase total** — show the computed total as the quantity changes (F1, S2).
- [ ] **Explain wallet connection up front** — add contextual copy before the wallet-connect step (F2, S2).
- [ ] **Detailed success confirmation** — include project name and credit amount in the confirmation (F3, S2).
- [ ] **Actionable purchase error messages** — replace the generic failure message with a cause and a retry path (F4, S2).
- [ ] **Surface purchase history** — link to purchase history from the confirmation screen (F5, S3).
- [ ] **Fix mobile confirm button placement** — keep the confirm action visible without scrolling (F6, S3).
- [ ] **Clarify credit vs. tonne units** — disambiguate the units label throughout the buy flow (F7, S3).
