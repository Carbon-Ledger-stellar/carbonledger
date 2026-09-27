# Contributing to CarbonLedger

Welcome! This guide will get you from zero to running tests locally in under 30 minutes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Running Tests](#running-tests)
- [Security](#security)
- [Common Issues](#common-issues)
- [Testnet Setup](#testnet-setup)
- [Development Workflow](#development-workflow)
- [UI/UX: Disabled State Indicators](#uiux-disabled-state-indicators)
- [UI/UX: Pause Stats Dashboard](#uiux-pause-stats-dashboard)
- [UI/UX: Pause Error Message Hierarchy](#uiux-pause-error-message-hierarchy)

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

---

## UI/UX: Pause Error Message Hierarchy

Design spec for pause-related failure messages (issue #1177). Applies to all pause/unpause error surfaces: inline banners, toasts, and modal dialogs.

### Severity Levels

| Level | When to use | Icon | Color token |
|-------|-------------|------|-------------|
| **Blocking** | Pause/unpause could not be applied; user action required | `alert-octagon` | `--color-error-strong` (`#B42318`) |
| **Warning** | Pause applied but with caveats (e.g. partial scope) | `alert-triangle` | `--color-warning-strong` (`#B54708`) |
| **Info** | Pause state changed successfully; confirmation only | `check-circle` | `--color-success-strong` (`#027A48`) |

### Icon and Color Usage

- Icons are 20px (inline) / 24px (modal), stroke width 2, rendered in the level's strong color.
- Message container uses the level's subtle background (`--color-error-subtle` `#FEF3F2`, `--color-warning-subtle` `#FFFAEB`, `--color-success-subtle` `#ECFDF3`) with a 1px border in the strong color at 20% opacity.
- Never rely on color alone: every message pairs its color with the matching icon and a text label.
- Contrast: text on subtle backgrounds must meet WCAG AA (4.5:1).

### Typography Scale

| Element | Token | Size / Weight / Line-height |
|---------|-------|-----------------------------|
| Title | `text-sm` | 14px / 600 / 20px |
| Body | `text-sm` | 14px / 400 / 20px |
| Helper / recovery hint | `text-xs` | 12px / 400 / 16px |
| Modal title | `text-base` | 16px / 600 / 24px |

- Title and body share the same size; hierarchy comes from weight and color, not size.
- Helper text is muted (`--color-text-muted`) and always follows the body with 4px spacing.

### Action Button Design

- Primary recovery action (e.g. **Retry pause**) uses the solid button style in the level's strong color.
- Secondary action (e.g. **Dismiss**) uses the ghost/text button style.
- Buttons are right-aligned, 8px gap, min height 32px, `text-sm` / 600.
- Blocking errors must always expose at least one recovery action; info messages may omit actions.

### Animation / Transition Specs

- Enter: fade in + 4px upward slide, 150ms, `ease-out`.
- Exit: fade out, 100ms, `ease-in`.
- Respect `prefers-reduced-motion`: skip transforms, keep opacity only.
- Toasts auto-dismiss after 6s for info, 8s for warning; blocking errors persist until dismissed.

---

## UI/UX: Pause Stats Dashboard

See the pause stats dashboard section above for layout and data conventions.
