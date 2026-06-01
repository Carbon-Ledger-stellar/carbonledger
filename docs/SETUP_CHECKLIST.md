# Setup Verification Checklist

Use this checklist to verify your CarbonLedger development environment is correctly configured.

## ✅ Prerequisites

### System Requirements

- [ ] Operating System: macOS, Linux, or Windows
- [ ] 8GB RAM minimum (16GB recommended)
- [ ] 10GB free disk space
- [ ] Stable internet connection

### Required Software

- [ ] **Node.js 18+** installed
  ```bash
  node --version  # Should show v18.x or v20.x
  ```

- [ ] **npm 9+** installed
  ```bash
  npm --version  # Should show 9.x or 10.x
  ```

- [ ] **Rust 1.74+** installed
  ```bash
  rustc --version  # Should show 1.74 or higher
  ```

- [ ] **Cargo** installed
  ```bash
  cargo --version
  ```

- [ ] **Python 3.10+** installed
  ```bash
  python3 --version  # Should show 3.10 or higher
  ```

- [ ] **PostgreSQL 14+** installed
  ```bash
  psql --version  # Should show 14 or higher
  ```

- [ ] **Git** installed
  ```bash
  git --version
  ```

### Optional Software

- [ ] **Docker 24+** (for containerized development)
  ```bash
  docker --version
  ```

- [ ] **Docker Compose** (usually included with Docker)
  ```bash
  docker-compose --version
  ```

---

## ✅ Rust Toolchain

- [ ] **wasm32 target** installed
  ```bash
  rustup target list | grep "wasm32-unknown-unknown (installed)"
  ```
  If not installed:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```

- [ ] **Stellar CLI** installed (optional, for deployment)
  ```bash
  stellar --version
  ```
  If not installed:
  ```bash
  cargo install --locked stellar-cli --version 21.0.0
  ```

---

## ✅ Database Setup

- [ ] **PostgreSQL service** is running
  ```bash
  # macOS
  brew services list | grep postgresql
  
  # Linux
  sudo systemctl status postgresql
  
  # Windows
  Get-Service -Name "postgresql*"
  ```

- [ ] **Database created**
  ```bash
  psql -U postgres -c "\l" | grep carbonledger
  ```
  If not created:
  ```bash
  createdb carbonledger
  ```

- [ ] **Database user created** (if needed)
  ```bash
  psql -U postgres -c "\du" | grep carbonledger
  ```
  If not created:
  ```bash
  sudo -u postgres psql -c "CREATE USER carbonledger WITH PASSWORD 'changeme';"
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE carbonledger TO carbonledger;"
  ```

- [ ] **Can connect to database**
  ```bash
  psql -U carbonledger -d carbonledger -h localhost -c "SELECT version();"
  ```

---

## ✅ Project Setup

- [ ] **Repository cloned**
  ```bash
  cd carbonledger
  git status
  ```

- [ ] **.env file created**
  ```bash
  ls -la .env
  ```
  If not created:
  ```bash
  cp .env.example .env
  ```

- [ ] **DATABASE_URL configured** in .env
  ```bash
  grep "DATABASE_URL=" .env
  ```
  Should show:
  ```
  DATABASE_URL=postgresql://carbonledger:changeme@localhost:5432/carbonledger
  ```

- [ ] **JWT_SECRET configured** in .env
  ```bash
  grep "JWT_SECRET=" .env
  ```
  Should have a value (not empty)

---

## ✅ Backend Setup

- [ ] **Dependencies installed**
  ```bash
  ls backend/node_modules
  ```
  If not installed:
  ```bash
  cd backend && npm install
  ```

- [ ] **Prisma client generated**
  ```bash
  ls backend/node_modules/.prisma/client
  ```
  If not generated:
  ```bash
  cd backend && npx prisma generate
  ```

- [ ] **Database migrations applied**
  ```bash
  cd backend && npx prisma migrate status
  ```
  Should show "Database schema is up to date"
  
  If not:
  ```bash
  npx prisma migrate dev
  ```

- [ ] **Backend tests pass**
  ```bash
  cd backend && npm test
  ```

---

## ✅ Frontend Setup

- [ ] **Dependencies installed**
  ```bash
  ls frontend/node_modules
  ```
  If not installed:
  ```bash
  cd frontend && npm install
  ```

- [ ] **Frontend tests pass**
  ```bash
  cd frontend && npm test
  ```

---

## ✅ Oracle Setup

- [ ] **Python dependencies installed**
  ```bash
  python3 -c "import stellar_sdk; print('OK')"
  ```
  If fails:
  ```bash
  cd oracle && pip3 install -r requirements.txt
  ```

- [ ] **All Python packages available**
  ```bash
  python3 -c "import stellar_sdk, requests, psycopg2, dotenv, schedule, flask; print('All packages OK')"
  ```

---

## ✅ Contracts Setup

- [ ] **Contracts built**
  ```bash
  ls contracts/target/wasm32-unknown-unknown/release/*.wasm
  ```
  Should show 4 .wasm files
  
  If not built:
  ```bash
  cd contracts && cargo build --target wasm32-unknown-unknown --release
  ```

- [ ] **Contract tests pass**
  ```bash
  cd contracts && cargo test
  ```
  Should show:
  - carbon_registry: 7 tests passed
  - carbon_credit: 10 tests passed
  - carbon_marketplace: 7 tests passed
  - carbon_oracle: 6 tests passed

---

## ✅ All Tests Pass

- [ ] **Run all tests**
  ```bash
  ./scripts/test-all.sh
  ```
  Should show:
  ```
  ✓ Carbon Registry Tests passed
  ✓ Carbon Credit Tests passed
  ✓ Carbon Marketplace Tests passed
  ✓ Carbon Oracle Tests passed
  ✓ Backend Unit Tests passed
  ✓ Frontend Unit Tests passed
  
  All tests passed! ✓
  ```

---

## ✅ Development Servers (Optional)

- [ ] **Backend starts successfully**
  ```bash
  cd backend && npm run start:dev
  ```
  Should show:
  ```
  Nest application successfully started
  Application is running on: http://localhost:3001
  ```

- [ ] **Frontend starts successfully**
  ```bash
  cd frontend && npm run dev
  ```
  Should show:
  ```
  ready - started server on 0.0.0.0:3000
  ```

- [ ] **Can access frontend**
  - Open browser to http://localhost:3000
  - Page loads without errors

- [ ] **Can access backend API**
  ```bash
  curl http://localhost:3001/api/v1/health
  ```
  Should return health status

---

## ✅ Testnet Setup (Optional)

- [ ] **Freighter wallet installed**
  - Visit chrome://extensions or about:addons
  - Freighter should be listed

- [ ] **Testnet account funded**
  ```bash
  stellar keys generate alice --network testnet --fund
  ```
  Should show:
  ```
  Secret key: SXXX...
  Public key: GXXX...
  ```

- [ ] **Can check balance**
  ```bash
  stellar account balance alice --network testnet
  ```
  Should show 10,000 XLM

- [ ] **Contracts deployed** (if needed)
  ```bash
  cd contracts
  stellar contract deploy \
    --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
    --source alice \
    --network testnet
  ```

---

## 🎯 Final Verification

Run the automated verification script:

```bash
# Linux/macOS
./scripts/verify-setup.sh

# Windows
.\scripts\verify-setup.ps1
```

Expected output:
```
✓ All checks passed!

You're ready to run tests:
  ./scripts/test-all.sh

Or start developing:
  cd backend && npm run start:dev
  cd frontend && npm run dev
```

---

## 📊 Summary

Count your checkmarks:

- **30+ checks passed**: Perfect! You're ready to contribute
- **25-29 checks passed**: Good! Minor issues, but can proceed
- **20-24 checks passed**: Some setup needed, review failed items
- **< 20 checks passed**: Significant setup needed, see troubleshooting

---

## 🆘 If Checks Fail

1. **Review error messages** carefully
2. **Check [Troubleshooting Guide](TROUBLESHOOTING.md)** for solutions
3. **Run verification script** for detailed diagnostics
4. **Ask for help** in [GitHub Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)

---

## 📚 Next Steps

Once all checks pass:

1. ✅ Read [Contributing Guide](../CONTRIBUTING.md)
2. ✅ Review [Architecture Decisions](adr/)
3. ✅ Browse [Good First Issues](https://github.com/YOUR_USERNAME/carbonledger/labels/good%20first%20issue)
4. ✅ Start coding!

---

**Setup Time:** ~20-30 minutes for first-time setup

**Questions?** See [CONTRIBUTING.md](../CONTRIBUTING.md) or ask in [Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)
