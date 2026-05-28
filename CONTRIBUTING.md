# Contributing to CarbonLedger

Welcome! This guide will get you from zero to running tests locally in under 30 minutes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Running Tests](#running-tests)
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
sudo -u postgres psql
ALTER USER carbonledger WITH PASSWORD 'changeme';
\q
```

---

### Issue: `stellar-cli` installation fails

**Solution:**
```bash
# Update Rust first
rustup update

# Install with specific version
cargo install --locked stellar-cli --version 21.0.0 --force

# If still fails, try without lock file
cargo install stellar-cli --version 21.0.0
```

---

### Issue: Python `stellar-sdk` import error

**Symptoms:**
```
ModuleNotFoundError: No module named 'stellar_sdk'
```

**Solution:**
```bash
cd oracle
pip3 install --upgrade pip
pip3 install -r requirements.txt

# If using virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

### Issue: Frontend build fails with TypeScript errors

**Solution:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

### Issue: Docker Compose fails to start

**Symptoms:**
```
Error: port 5432 already in use
```

**Solution:**
```bash
# Stop local PostgreSQL
brew services stop postgresql@16  # macOS
sudo systemctl stop postgresql    # Linux

# Or change port in docker-compose.yml
ports:
  - "5433:5432"  # Use 5433 instead
```

---

### Issue: Tests fail with "Contract not found"

**Solution:**
This is expected for integration tests without deployed contracts. Unit tests should pass:
```bash
cd contracts
cargo test --lib  # Run only unit tests
```

---

## Testnet Setup

### Quick Start

```bash
# 1. Generate and fund testnet account
stellar keys generate alice --network testnet --fund

# 2. Deploy contracts
cd contracts
./scripts/deploy-testnet.sh

# 3. Update .env with contract IDs
```

### Detailed Guide

For complete testnet setup including:
- Multiple faucet methods
- Freighter wallet setup
- Contract deployment and initialization
- Getting testnet USDC
- Testing contract interactions
- Troubleshooting testnet issues

**See:** [Testnet Guide](docs/TESTNET_GUIDE.md)

---

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feat/your-feature-name
```

### 2. Make Changes

Edit code, add tests, update documentation.

### 3. Run Tests Locally

```bash
# Rust tests
cd contracts && cargo test

# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test
```

### 4. Commit Changes

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git add .
git commit -m "feat: add serial number validation"
git commit -m "fix: resolve double-counting bug"
git commit -m "docs: update API documentation"
```

### 5. Push and Create PR

```bash
git push origin feat/your-feature-name
```

Then create a Pull Request on GitHub.

---

## Code Style Guidelines

### Rust (Contracts)

- Use `snake_case` for functions and variables
- Use `PascalCase` for types and enums
- Add doc comments for public functions
- Use `CarbonError` enum for all errors
- Follow checks-effects-interactions pattern

```rust
/// Register a new carbon project
pub fn register_project(
    env: Env,
    project_id: String,
    owner: Address,
) -> Result<(), CarbonError> {
    // Checks
    if project_exists(&env, &project_id) {
        return Err(CarbonError::ProjectAlreadyExists);
    }
    
    // Effects
    save_project(&env, &project_id, &owner);
    
    // Interactions
    emit_event(&env, "ProjectRegistered", project_id);
    
    Ok(())
}
```

### TypeScript (Frontend/Backend)

- Use `camelCase` for variables and functions
- Use `PascalCase` for components and classes
- Add JSDoc comments for exported functions
- Use TypeScript strict mode
- Prefer `const` over `let`

```typescript
/**
 * Retire carbon credits permanently on-chain
 */
export async function retireCredits(
  batchId: string,
  amount: number,
  beneficiary: string
): Promise<RetirementCertificate> {
  // Implementation
}
```

### Python (Oracle)

- Follow PEP 8 style guide
- Use `snake_case` for functions and variables
- Use `PascalCase` for classes
- Add docstrings for functions
- Use type hints

```python
def submit_monitoring_data(
    project_id: str,
    tonnes_verified: int,
    methodology_score: int
) -> str:
    """
    Submit monitoring data to oracle contract
    
    Args:
        project_id: Unique project identifier
        tonnes_verified: Verified CO2 tonnes
        methodology_score: Quality score (0-100)
        
    Returns:
        Transaction hash
    """
    # Implementation
```

---

## Getting Help

- **Documentation**: Check [docs/](docs/) folder
- **Architecture Decisions**: See [docs/adr/](docs/adr/)
- **API Reference**: See [backend/docs/PROJECTS_API.md](backend/docs/PROJECTS_API.md)
- **Issues**: [GitHub Issues](https://github.com/YOUR_USERNAME/carbonledger/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)

---

## Next Steps

After completing this guide, you should be able to:

- ✅ Run all tests locally
- ✅ Deploy contracts to testnet
- ✅ Start the development servers
- ✅ Make code changes and test them
- ✅ Submit pull requests

Ready to contribute? Check out:

- [Good First Issues](https://github.com/YOUR_USERNAME/carbonledger/labels/good%20first%20issue)
- [Roadmap](README.md#-roadmap)
- [Architecture Decisions](docs/adr/README.md)

---

**Welcome to the CarbonLedger community!** 🌍
