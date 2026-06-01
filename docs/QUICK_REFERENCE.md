# CarbonLedger Quick Reference

One-page reference for common commands and workflows.

## 🚀 Setup Commands

```bash
# Clone and configure
git clone https://github.com/YOUR_USERNAME/carbonledger.git
cd carbonledger
cp .env.example .env

# Verify setup
./scripts/verify-setup.sh  # Linux/macOS
.\scripts\verify-setup.ps1  # Windows

# Install Rust toolchain
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --version 21.0.0

# Setup database
createdb carbonledger
cd backend && npx prisma migrate dev && cd ..

# Install dependencies
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
cd oracle && pip3 install -r requirements.txt && cd ..
cd contracts && cargo build --target wasm32-unknown-unknown --release && cd ..

# Run all tests
./scripts/test-all.sh
```

## 🧪 Testing Commands

```bash
# All tests
./scripts/test-all.sh

# Rust contracts
cd contracts && cargo test
cd contracts && cargo test -p carbon_registry
cd contracts && cargo test -- --nocapture

# Backend
cd backend && npm test
cd backend && npm test -- --watch
cd backend && npm test projects.service.spec.ts

# Frontend
cd frontend && npm test
cd frontend && npm test -- --coverage
```

## 🔧 Development Commands

```bash
# Start backend
cd backend && npm run start:dev
# → http://localhost:3001

# Start frontend
cd frontend && npm run dev
# → http://localhost:3000

# Build contracts
cd contracts && cargo build --target wasm32-unknown-unknown --release

# Database migrations
cd backend && npx prisma migrate dev
cd backend && npx prisma generate
cd backend && npx prisma studio  # GUI
```

## 🌐 Testnet Commands

```bash
# Generate and fund account
stellar keys generate alice --network testnet --fund

# Check balance
stellar account balance alice --network testnet

# Deploy contract
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source alice \
  --network testnet

# Invoke contract
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- function_name \
  --arg value
```

## 🔍 Diagnostic Commands

```bash
# Check versions
node --version
npm --version
rustc --version
python3 --version
psql --version
stellar --version

# Check PostgreSQL
brew services list | grep postgresql  # macOS
sudo systemctl status postgresql      # Linux
Get-Service -Name "postgresql*"       # Windows

# Check database
psql -U carbonledger -d carbonledger -h localhost -c "SELECT version();"

# Check Rust targets
rustup target list | grep wasm32
```

## 🐛 Troubleshooting Commands

```bash
# PostgreSQL
brew services start postgresql@16     # macOS
sudo systemctl start postgresql       # Linux
net start postgresql-x64-16           # Windows

# Clean build
cd contracts && cargo clean && cargo build --target wasm32-unknown-unknown --release
cd backend && rm -rf node_modules dist && npm install
cd frontend && rm -rf node_modules .next && npm install

# Reset database
cd backend && npx prisma migrate reset

# View logs
tail -f backend/logs/app.log
docker-compose logs -f backend
```

## 📁 Project Structure

```
carbonledger/
├── contracts/          # Rust smart contracts
│   ├── carbon_registry/
│   ├── carbon_credit/
│   ├── carbon_marketplace/
│   └── carbon_oracle/
├── backend/           # NestJS API
│   ├── src/
│   └── prisma/
├── frontend/          # Next.js app
│   ├── app/
│   ├── components/
│   └── lib/
├── oracle/            # Python services
├── docs/              # Documentation
└── scripts/           # Helper scripts
```

## 🔗 Important URLs

### Local Development
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- API Docs: http://localhost:3001/api

### Testnet
- Horizon: https://horizon-testnet.stellar.org
- Soroban RPC: https://soroban-testnet.stellar.org
- Laboratory: https://laboratory.stellar.org
- Friendbot: https://friendbot.stellar.org

### Documentation
- Quick Start: docs/QUICK_START.md
- Contributing: CONTRIBUTING.md
- Troubleshooting: docs/TROUBLESHOOTING.md
- Testnet Guide: docs/TESTNET_GUIDE.md

## 🎯 Git Workflow

```bash
# Create branch
git checkout -b feat/your-feature

# Make changes and test
./scripts/test-all.sh

# Commit (Conventional Commits)
git commit -m "feat: add feature"
git commit -m "fix: resolve bug"
git commit -m "docs: update guide"

# Push and create PR
git push origin feat/your-feature
```

## 📝 Environment Variables

```env
# Required
DATABASE_URL=postgresql://carbonledger:changeme@localhost:5432/carbonledger
JWT_SECRET=your-random-secret-key
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# After deployment
CARBON_REGISTRY_CONTRACT_ID=CXXX...
CARBON_CREDIT_CONTRACT_ID=CXXX...
CARBON_MARKETPLACE_CONTRACT_ID=CXXX...
CARBON_ORACLE_CONTRACT_ID=CXXX...
```

## 🆘 Quick Help

| Issue | Command |
|-------|---------|
| Setup verification | `./scripts/verify-setup.sh` |
| PostgreSQL not running | `brew services start postgresql@16` |
| Database connection fails | Check `DATABASE_URL` in `.env` |
| Rust build fails | `xcode-select --install` (macOS) |
| Tests fail | `./scripts/verify-setup.sh` |
| Need help | See docs/TROUBLESHOOTING.md |

## 📚 Documentation

- 📖 [New Contributor Guide](NEW_CONTRIBUTOR_GUIDE.md)
- 🚀 [Quick Start](QUICK_START.md)
- ✅ [Setup Checklist](SETUP_CHECKLIST.md)
- 🔧 [Troubleshooting](TROUBLESHOOTING.md)
- 🌐 [Testnet Guide](TESTNET_GUIDE.md)
- 📝 [Contributing](../CONTRIBUTING.md)

## 🎓 Learning Resources

- Stellar: https://developers.stellar.org
- Soroban: https://soroban.stellar.org
- NestJS: https://nestjs.com
- Next.js: https://nextjs.org
- Prisma: https://prisma.io

---

**Print this page for quick reference!**

**Bookmark:** `docs/QUICK_REFERENCE.md`
