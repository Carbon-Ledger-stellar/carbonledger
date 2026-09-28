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
  "paused": true,
  "pausedAt": "2024-06-01T12:00:00.000Z",
  "pausedBy": "GADMIN...XYZ",
  "reason": "Scheduled maintenance"
}
```

**Curl**

```bash
curl -X POST http://localhost:3001/api/v1/admin/pause \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Scheduled maintenance"}'
```

### POST /api/v1/admin/unpause

Resumes the contract. Admin only. Idempotent — unpausing an already-active contract returns `409 Conflict`.

**Request body**

```json
{
  "reason": "Maintenance complete"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Human-readable reason recorded in pause history (max 256 chars) |

**Response `200 OK`**

```json
{
  "paused": false,
  "pausedAt": null,
  "pausedBy": null,
  "reason": "Maintenance complete"
}
```

**Curl**

```bash
curl -X POST http://localhost:3001/api/v1/admin/unpause \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Maintenance complete"}'
```

### GET /api/v1/admin/pause-history

Returns the chronological pause/unpause history. Admin only.

**Query parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | 1 | Page number (1-based) |
| `limit` | integer | 20 | Items per page (max 100) |

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "ph_01H...",
      "action": "pause",
      "reason": "Scheduled maintenance",
      "actor": "GADMIN...XYZ",
      "timestamp": "2024-06-01T12:00:00.000Z"
    },
    {
      "id": "ph_01H...",
      "action": "unpause",
      "reason": "Maintenance complete",
      "actor": "GADMIN...XYZ",
      "timestamp": "2024-06-01T13:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 2
}
```

**Curl**

```bash
curl -X GET "http://localhost:3001/api/v1/admin/pause-history?page=1&limit=20" \
  -H "Authorization: Bearer $JWT"
```

### Error Codes

| Status | Code | Description |
|--------|------|-------------|
| `400` | `VALIDATION_ERROR` | Request body or query parameters failed validation (e.g. `reason` exceeds 256 chars, invalid `page`/`limit`). |
| `401` | `UNAUTHORIZED` | Missing or invalid bearer token. |
| `403` | `FORBIDDEN` | Authenticated account lacks the `ADMIN` role. |
| `404` | `NOT_FOUND` | Requested resource does not exist. |
| `409` | `CONFLICT` | Contract is already in the requested state (already paused/unpaused). |
| `429` | `RATE_LIMITED` | Rate limit exceeded; retry after the `Retry-After` interval. |
| `500` | `INTERNAL_ERROR` | Unexpected server error; retry and report if it persists. |

**Error response shape**

```json
{
  "statusCode": 409,
  "code": "CONFLICT",
  "message": "Contract is already paused"
}
```

---

## Security

### Reporting Vulnerabilities

If you discover a security vulnerability in CarbonLedger, **do not open a public GitHub issue**.

Please report privately to: **security@carbonledger.io**

Include:
- Affected component(s) (contract, backend, frontend, oracle)
- Description of the vulnerability and its impact
- Proof-of-concept or reproduction steps if available
- Your suggested severity (Critical / High / Medium / Low)

We will acknowledge receipt within **48 hours** and aim to provide a full response within **7 days**. Critical findings will be triaged within **24 hours**.

For complete details, see [SECURITY.md](SECURITY.md).

---

## Common Issues

### Issue: `cargo build` fails with "linker not found"

**Solution (macOS):**
```bash
xcode-select --install
```

**Solution (Linux):**
```bash
sudo apt install build-essential
```

**Solution (Windows):**
Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)

---

### Issue: `rustup target add wasm32-unknown-unknown` fails

**Solution:**
```bash
rustup update
rustup target add wasm32-unknown-unknown
```

---

### Issue: PostgreSQL connection refused

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution (macOS):**
```bash
brew services start postgresql@16
```

**Solution (Linux):**
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**Solution (Windows):**
```powershell
# Start PostgreSQL service from Services app
# Or run: net start postgresql-x64-16
```

---

### Issue: `npx prisma migrate dev` fails with authentication error

**Symptoms:**
```
Error: P1001: Can't reach database server
```

**Solution:**
Check your `DATABASE_URL` in `.env`:
```bash
# Verify PostgreSQL is running
psql -U carbonledger -d carbonledger -h localhost

# If password fails, reset it:
sudo -u pos

/* … truncated 5291 chars — edit only what you need near the top … */
