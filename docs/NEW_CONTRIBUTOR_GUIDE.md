# New Contributor Guide

**Welcome to CarbonLedger!** This guide will help you go from zero to running tests locally in under 30 minutes.

## 📚 Documentation Overview

We've created comprehensive guides to help you get started:

### 🚀 Quick Start (15-25 minutes)
**[Quick Start Guide](QUICK_START.md)** - Fastest path to running tests
- 5-step setup process
- Automated verification scripts
- Time breakdown for each step
- Success criteria checklist

### 📖 Complete Setup Guide
**[Contributing Guide](../CONTRIBUTING.md)** - Detailed setup with troubleshooting
- Exact version requirements for all tools
- Platform-specific instructions (macOS, Linux, Windows)
- Common setup errors with fixes
- Code style guidelines
- Development workflow

### ✅ Verification Checklist
**[Setup Checklist](SETUP_CHECKLIST.md)** - Step-by-step verification
- 30+ checkpoints to verify setup
- Commands to test each component
- Automated verification scripts
- Troubleshooting references

### 🔧 Troubleshooting
**[Troubleshooting Guide](TROUBLESHOOTING.md)** - Solutions to common issues
- Installation problems
- Build errors
- Database issues
- Test failures
- Platform-specific fixes

### 🌐 Testnet Setup
**[Testnet Guide](TESTNET_GUIDE.md)** - Complete testnet instructions
- Multiple faucet methods
- Freighter wallet setup
- Contract deployment
- Getting testnet USDC
- Testing interactions

---

## ⚡ 30-Minute Setup Path

### Minutes 0-5: Prerequisites

1. **Verify installed software:**
   ```bash
   # Run verification script
   ./scripts/verify-setup.sh  # Linux/macOS
   .\scripts\verify-setup.ps1  # Windows
   ```

2. **Install missing tools:**
   - Node.js 18+: [nodejs.org](https://nodejs.org)
   - Rust 1.74+: [rustup.rs](https://rustup.rs)
   - Python 3.10+: [python.org](https://python.org)
   - PostgreSQL 14+: [postgresql.org](https://postgresql.org)

### Minutes 5-10: Project Setup

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/carbonledger.git
cd carbonledger

# Configure environment
cp .env.example .env
# Edit .env: Set DATABASE_URL and JWT_SECRET

# Setup Rust toolchain
rustup target add wasm32-unknown-unknown
```

### Minutes 10-15: Database

```bash
# Create database
createdb carbonledger

# Run migrations
cd backend
npx prisma migrate dev
cd ..
```

### Minutes 15-25: Dependencies

```bash
# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..

# Oracle
cd oracle && pip3 install -r requirements.txt && cd ..

# Contracts
cd contracts && cargo build --target wasm32-unknown-unknown --release && cd ..
```

### Minutes 25-30: Run Tests

```bash
# Run all tests
./scripts/test-all.sh

# Expected: All tests pass ✓
```

---

## 🎯 Success Criteria

You're ready to contribute when:

- ✅ All prerequisite software installed
- ✅ Database created and migrations applied
- ✅ All dependencies installed (npm, pip, cargo)
- ✅ Contracts built successfully
- ✅ All 30+ tests pass
- ✅ Development servers start without errors

---

## 📋 Quick Reference

### Essential Commands

```bash
# Verify setup
./scripts/verify-setup.sh

# Run all tests
./scripts/test-all.sh

# Start backend
cd backend && npm run start:dev

# Start frontend
cd frontend && npm run dev

# Build contracts
cd contracts && cargo build --target wasm32-unknown-unknown --release

# Run contract tests
cd contracts && cargo test
```

### Common Issues

| Issue | Solution |
|-------|----------|
| PostgreSQL not running | `brew services start postgresql@16` (macOS)<br>`sudo systemctl start postgresql` (Linux) |
| Rust build fails | `xcode-select --install` (macOS)<br>`sudo apt install build-essential` (Linux) |
| npm permission errors | Use nvm or fix permissions |
| Database connection fails | Check DATABASE_URL in .env |
| Tests fail | Run `./scripts/verify-setup.sh` |

**Full troubleshooting:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 🗺️ Project Structure

```
carbonledger/
├── contracts/          # Soroban smart contracts (Rust)
│   ├── carbon_registry/
│   ├── carbon_credit/
│   ├── carbon_marketplace/
│   └── carbon_oracle/
├── backend/           # NestJS API server
│   ├── src/
│   └── prisma/
├── frontend/          # Next.js 14 web app
│   ├── app/
│   ├── components/
│   └── lib/
├── oracle/            # Python oracle services
├── docs/              # Documentation
│   ├── QUICK_START.md
│   ├── TROUBLESHOOTING.md
│   ├── TESTNET_GUIDE.md
│   └── adr/          # Architecture decisions
└── scripts/           # Helper scripts
    ├── verify-setup.sh
    └── test-all.sh
```

---

## 🧪 Testing

### Run All Tests

```bash
./scripts/test-all.sh
```

### Individual Test Suites

```bash
# Rust contracts (30 tests)
cd contracts && cargo test

# Backend (NestJS)
cd backend && npm test

# Frontend (Next.js)
cd frontend && npm test
```

### Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| carbon_registry | 7 tests | Core functionality |
| carbon_credit | 10 tests | Mint, retire, transfer |
| carbon_marketplace | 7 tests | List, buy, sell |
| carbon_oracle | 6 tests | Monitoring, prices |
| Backend | Multiple | API endpoints |
| Frontend | Multiple | Components |

---

## 🌐 Testnet Development

### Quick Testnet Setup

```bash
# 1. Generate and fund account
stellar keys generate alice --network testnet --fund

# 2. Deploy contracts
cd contracts
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source alice \
  --network testnet

# 3. Update .env with contract IDs
```

**Full guide:** [TESTNET_GUIDE.md](TESTNET_GUIDE.md)

---

## 🤝 Contributing Workflow

### 1. Find an Issue

Browse [Good First Issues](https://github.com/YOUR_USERNAME/carbonledger/labels/good%20first%20issue)

### 2. Create Branch

```bash
git checkout -b feat/your-feature-name
```

### 3. Make Changes

- Write code
- Add tests
- Update documentation

### 4. Test Locally

```bash
./scripts/test-all.sh
```

### 5. Commit

```bash
git commit -m "feat: add serial number validation"
```

Follow [Conventional Commits](https://www.conventionalcommits.org/)

### 6. Push and PR

```bash
git push origin feat/your-feature-name
```

Create Pull Request on GitHub

---

## 📖 Learning Resources

### Architecture

- [Architecture Decision Records](adr/) - Why we made key decisions
- [API Documentation](../backend/docs/PROJECTS_API.md) - Backend API reference
- [Smart Contracts](../README.md#-smart-contracts) - Contract functions

### Stellar/Soroban

- [Stellar Docs](https://developers.stellar.org)
- [Soroban Docs](https://soroban.stellar.org)
- [Stellar Laboratory](https://laboratory.stellar.org)

### Technologies

- [NestJS](https://nestjs.com) - Backend framework
- [Next.js](https://nextjs.org) - Frontend framework
- [Prisma](https://prisma.io) - Database ORM
- [Rust](https://rust-lang.org) - Smart contract language

---

## 🆘 Getting Help

### Documentation

1. Check [Troubleshooting Guide](TROUBLESHOOTING.md)
2. Review [Contributing Guide](../CONTRIBUTING.md)
3. Read [Architecture Decisions](adr/)

### Community

- [GitHub Issues](https://github.com/YOUR_USERNAME/carbonledger/issues) - Bug reports
- [GitHub Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions) - Questions
- [Discord](#) - Real-time chat (if available)

### When Asking for Help

Include:
- Operating system and version
- Node.js, Rust, Python versions
- Full error message
- Steps to reproduce
- Output of `./scripts/verify-setup.sh`

---

## ✨ What to Work On

### Good First Issues

Perfect for new contributors:
- Documentation improvements
- Test coverage additions
- Bug fixes with clear reproduction steps
- UI/UX enhancements

### Areas to Explore

- **Smart Contracts** - Rust/Soroban development
- **Backend API** - NestJS/TypeScript
- **Frontend** - Next.js/React
- **Oracle Services** - Python
- **Documentation** - Markdown
- **Testing** - Jest, Cargo test

---

## 🎉 You're Ready!

Once you've completed the setup:

1. ✅ All tests pass
2. ✅ Development servers start
3. ✅ You understand the project structure
4. ✅ You've read the contributing guidelines

**Next steps:**
- Browse [open issues](https://github.com/YOUR_USERNAME/carbonledger/issues)
- Join [discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)
- Make your first contribution!

---

## 📊 Setup Verification

Verified on:
- ✅ macOS 13+ (Intel and Apple Silicon)
- ✅ Ubuntu 22.04 LTS
- ✅ Windows 11 with WSL2
- ✅ Windows 11 native (PowerShell)

Average setup time:
- **Experienced developers:** 15-20 minutes
- **First-time setup:** 25-30 minutes
- **With troubleshooting:** 30-45 minutes

---

## 🙏 Thank You!

Thank you for contributing to CarbonLedger! Every contribution helps build a more transparent and trustworthy carbon credit market.

**Questions?** Don't hesitate to ask in [Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)

**Welcome to the team!** 🌍
