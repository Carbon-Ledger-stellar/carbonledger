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
```bash
# Verify PostgreSQL is running
psql -U carbonledger -d carbonledger -h localhost

# If password fails, reset it:
sudo -u postgres psql -c "ALTER USER carbonledger WITH PASSWORD 'changeme';"
```

---

## UI/UX: Disabled State Indicators

This section is the design specification for disabled buttons and inputs shown when a
contract is paused. It is the single source of truth for the paused-contract disabled
state and must be applied consistently across the app (dashboard, marketplace, forms,
mobile controls).

### When to use the disabled state

Apply the disabled state to any interactive control whose action is blocked because the
contract is paused. The control must be rendered with the native `disabled` attribute
(buttons/inputs) or `aria-disabled="true"` (custom controls) so assistive technology
reports the state.

### Disabled button design spec

| Property | Value |
|----------|-------|
| Background | `--color-surface-disabled` (neutral-200 light / neutral-700 dark) |
| Text / icon | `--color-text-disabled` (neutral-500 light / neutral-400 dark) |
| Border | 1px solid `--color-border-disabled` (neutral-300 light / neutral-600 dark) |
| Border radius | Same as the enabled variant (do not change shape) |
| Padding / size | Identical to the enabled variant (no layout shift) |
| Shadow | None |
| Hover / active | No hover, focus-ring, or active styles |

Disabled controls keep the same dimensions as their enabled counterparts so pausing a
contract never causes layout shift.

### Cursor and opacity specifications

| State | Cursor | Opacity |
|-------|--------|---------|
| Disabled (default) | `not-allowed` | `0.6` |
| Disabled (loading/pending) | `progress` | `0.6` |
| Enabled | `pointer` | `1.0` |

- Opacity is applied to the whole control, not just the label, so the border and icon
  fade together.
- Never use `opacity: 0` or `visibility: hidden` — the control must remain perceivable.
- Do not rely on opacity alone to convey the state; pair it with the disabled colors
  above and the tooltip described below.

### Tooltip styling

Every disabled control that is disabled because the contract is paused must expose a
tooltip explaining why.

| Property | Value |
|----------|-------|
| Trigger | Hover and keyboard focus on the disabled control |
| Background | `--color-tooltip-bg` (neutral-900 light / neutral-100 dark) |
| Text | `--color-tooltip-text` (neutral-50 light / neutral-900 dark) |
| Font size | `0.75rem` (12px), weight 500 |
| Padding | `6px 10px` |
| Border radius | `4px` |
| Max width | `240px` |
| Offset | `8px` above the control |
| Motion | Fade in `120ms ease-out`; respect `prefers-reduced-motion` |

Default copy: **"Contract is paused. Actions are temporarily unavailable."**

Because native `disabled` elements do not fire pointer events, wrap the control in a
focusable container (or use `aria-disabled` on a custom control) so the tooltip is
reachable by both mouse and keyboard.

### Color contrast

Disabled states are exempt from WCAG 1.4.3 minimum contrast, but the tooltip and any
status text must still meet **WCAG 2.1 AA**:

- Tooltip text on tooltip background: contrast ratio **≥ 4.5:1** (verify in both light
  and dark themes).
- Disabled label on disabled background: target **≥ 3:1** so the control stays legible
  even though it is non-interactive.
- Never convey the paused state by color alone — the tooltip text and `disabled`/
  `aria-disabled` semantics carry the meaning.

### Testing the disabled state

Verify the spec across these UI states before merging:

- [ ] Light theme and dark theme
- [ ] Enabled → disabled transition (no layout shift)
- [ ] Hover and keyboard focus on a disabled control (tooltip appears)
- [ ] Screen reader announces the disabled state and tooltip copy
- [ ] Mobile / touch: disabled controls are non-tappable and the tooltip is reachable
- [ ] `prefers-reduced-motion` disables the tooltip fade

---

## Testnet Setup

See the [Testnet Setup](#testnet-setup) section in the project docs for deploying
contracts to Stellar testnet and funding accounts via Friendbot.

---

## Development Workflow

1. Create a feature branch from `main`.
2. Make your changes and add tests where applicable.
3. Run the relevant test suites locally (see [Running Tests](#running-tests)).
4. Open a pull request describing the change and linking the issue.
