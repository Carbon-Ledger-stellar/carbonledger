# Quick Start Guide

Get CarbonLedger running locally in under 30 minutes.

## ⚡ Prerequisites Checklist

Before starting, ensure you have:

- [ ] Node.js 18+ installed
- [ ] Rust 1.74+ installed
- [ ] Python 3.10+ installed
- [ ] PostgreSQL 14+ installed and running
- [ ] Git installed

**Not sure?** Run the verification script:
```bash
# Linux/macOS
./scripts/verify-setup.sh

# Windows
.\scripts\verify-setup.ps1
```

---

## 🚀 5-Step Setup

### Step 1: Clone and Configure (2 min)

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/carbonledger.git
cd carbonledger

# Copy environment file
cp .env.example .env

# Edit .env and set these minimum values:
# - DATABASE_URL=postgresql://carbonledger:changeme@localhost:5432/carbonledger
# - JWT_SECRET=your-random-secret-key
```

### Step 2: Install Rust Toolchain (3 min)

```bash
# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI (optional, for deployment)
cargo install --locked stellar-cli --version 21.0.0
```

### Step 3: Setup Database (2 min)

```bash
# Create database
createdb carbonledger

# Or on Linux with sudo:
sudo -u postgres createdb carbonledger
sudo -u postgres psql -c "CREATE USER carbonledger WITH PASSWORD 'changeme';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE carbonledger TO carbonledger;"
```

### Step 4: Install Dependencies (5 min)

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

# Contracts (Rust)
cd contracts
cargo build --target wasm32-unknown-unknown --release
cd ..
```

### Step 5: Run Tests (10 min)

```bash
# All tests
./scripts/test-all.sh

# Or individually:
cd contracts && cargo test          # Rust tests (30 tests)
cd backend && npm test              # Backend tests
cd frontend && npm test             # Frontend tests
```

---

## ✅ Success Criteria

You should see:

```
✓ Carbon Registry Tests passed
✓ Carbon Credit Tests passed
✓ Carbon Marketplace Tests passed
✓ Carbon Oracle Tests passed
✓ Backend Unit Tests passed
✓ Frontend Unit Tests passed

All tests passed! ✓
You're ready to contribute! 🚀
```

---

## 🎯 Next Steps

### Start Development Servers

```bash
# Terminal 1: Backend
cd backend
npm run start:dev
# → http://localhost:3001

# Terminal 2: Frontend
cd frontend
npm run dev
# → http://localhost:3000

# Terminal 3: Database (if using Docker)
docker-compose up postgres redis
```

### Deploy to Testnet

1. **Get testnet XLM:**
   ```bash
   stellar keys generate alice --network testnet --fund
   ```

2. **Deploy contracts:**
   ```bash
   cd contracts
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
     --source alice \
     --network testnet
   ```

3. **Save contract IDs to `.env`**

### Install Freighter Wallet

1. Install [Freighter extension](https://freighter.app)
2. Create wallet or import existing
3. Switch to **Testnet** in settings
4. Visit `http://localhost:3000`

---

## 🐳 Alternative: Docker Setup

If you prefer Docker:

```bash
# Copy environment file
cp .env.example .env

# Start all services
docker-compose up --build

# Services will be available at:
# - Frontend: http://localhost:3000
# - Backend: http://localhost:3001
# - PostgreSQL: localhost:5432
# - Redis: localhost:6379
```

**Note:** You still need Rust toolchain for contract development.

---

## 📚 Learn More

- **Full Setup Guide:** [CONTRIBUTING.md](../CONTRIBUTING.md)
- **Troubleshooting:** [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Architecture:** [docs/adr/](adr/)
- **API Documentation:** [backend/docs/PROJECTS_API.md](../backend/docs/PROJECTS_API.md)

---

## 🆘 Common Issues

### PostgreSQL not running
```bash
# macOS
brew services start postgresql@16

# Linux
sudo systemctl start postgresql

# Windows
net start postgresql-x64-16
```

### Rust build fails
```bash
# Update Rust
rustup update

# Install build tools
# macOS: xcode-select --install
# Linux: sudo apt install build-essential
# Windows: Install Visual Studio Build Tools
```

### Tests fail
```bash
# Clean and rebuild
cd contracts
cargo clean
cargo build --target wasm32-unknown-unknown --release
cargo test
```

### Need help?
- Run: `./scripts/verify-setup.sh` (or `.ps1` on Windows)
- Check: [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Ask: [GitHub Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)

---

## ⏱️ Time Breakdown

| Step | Time | What's Happening |
|------|------|------------------|
| Clone & Configure | 2 min | Download code, setup .env |
| Rust Toolchain | 3 min | Install wasm32 target, Stellar CLI |
| Database Setup | 2 min | Create PostgreSQL database |
| Install Dependencies | 5 min | npm install, cargo build, pip install |
| Run Tests | 10 min | 30 Rust tests + Backend + Frontend |
| **Total** | **~22 min** | Ready to contribute! |

*Times are approximate and depend on internet speed and hardware.*

---

## 🎉 You're Ready!

Once all tests pass, you can:

- Browse [good first issues](https://github.com/YOUR_USERNAME/carbonledger/labels/good%20first%20issue)
- Read the [architecture decisions](adr/)
- Start building features
- Submit your first PR

**Welcome to CarbonLedger!** 🌍
