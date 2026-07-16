# Troubleshooting Guide

Quick solutions to common setup and development issues.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Build Errors](#build-errors)
- [Database Issues](#database-issues)
- [Test Failures](#test-failures)
- [Runtime Errors](#runtime-errors)
- [Platform-Specific Issues](#platform-specific-issues)

---

## Installation Issues

### Rust Installation Fails

**Symptoms:**
```
curl: (7) Failed to connect to sh.rustup.rs
```

**Solutions:**

1. Check internet connection and firewall settings
2. Try alternative installation:
   ```bash
   # macOS/Linux
   wget https://sh.rustup.rs -O rustup-init.sh
   sh rustup-init.sh
   
   # Windows
   # Download from https://rustup.rs and run installer
   ```

3. If behind corporate proxy:
   ```bash
   export https_proxy=http://proxy.company.com:8080
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

---

### wasm32 Target Installation Fails

**Symptoms:**
```
error: toolchain 'stable-x86_64-unknown-linux-gnu' does not support target 'wasm32-unknown-unknown'
```

**Solution:**
```bash
# Update Rust first
rustup update stable

# Then add target
rustup target add wasm32-unknown-unknown
```

---

### Stellar CLI Installation Fails

**Symptoms:**
```
error: failed to compile `stellar-cli`
```

**Solutions:**

1. Update Rust and try again:
   ```bash
   rustup update
   cargo install --locked stellar-cli --version 21.0.0 --force
   ```

2. If still fails, install without lock file:
   ```bash
   cargo install stellar-cli --version 21.0.0
   ```

3. Check system requirements:
   - Rust 1.74+
   - 4GB RAM minimum
   - Stable internet connection

---

### npm install Fails

**Symptoms:**
```
npm ERR! code EACCES
npm ERR! syscall access
```

**Solutions:**

1. Fix npm permissions (Linux/macOS):
   ```bash
   sudo chown -R $USER:$USER ~/.npm
   sudo chown -R $USER:$USER /usr/local/lib/node_modules
   ```

2. Use nvm (recommended):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 20
   nvm use 20
   ```

3. Clear cache and retry:
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

---

## Build Errors

### Cargo Build Fails: Linker Not Found

**Symptoms:**
```
error: linker `cc` not found
```

**Solutions:**

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install build-essential
```

**Linux (Fedora/RHEL):**
```bash
sudo dnf groupinstall "Development Tools"
```

**Windows:**
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
- Select "Desktop development with C++"

---

### Cargo Build Fails: Out of Memory

**Symptoms:**
```
error: could not compile `carbon_registry`
SIGKILL: kill
```

**Solutions:**

1. Build contracts one at a time:
   ```bash
   cd contracts/carbon_registry
   cargo build --target wasm32-unknown-unknown --release
   
   cd ../carbon_credit
   cargo build --target wasm32-unknown-unknown --release
   ```

2. Reduce parallel jobs:
   ```bash
   cargo build --target wasm32-unknown-unknown --release -j 1
   ```

3. Increase swap space (Linux):
   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

---

### TypeScript Build Fails

**Symptoms:**
```
error TS2307: Cannot find module '@stellar/stellar-sdk'
```

**Solutions:**

1. Reinstall dependencies:
   ```bash
   cd frontend  # or backend
   rm -rf node_modules package-lock.json
   npm install
   ```

2. Check Node.js version:
   ```bash
   node --version  # Should be 18.x or 20.x
   ```

3. Clear TypeScript cache:
   ```bash
   rm -rf .next  # frontend
   rm -rf dist   # backend
   npm run build
   ```

---

## Database Issues

### PostgreSQL Connection Refused

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solutions:**

**macOS:**
```bash
# Check if running
brew services list

# Start PostgreSQL
brew services start postgresql@16

# Verify
psql -U postgres -c "SELECT version();"
```

**Linux:**
```bash
# Check status
sudo systemctl status postgresql

# Start service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify
sudo -u postgres psql -c "SELECT version();"
```

**Windows:**
```powershell
# Check service status
Get-Service -Name "postgresql*"

# Start service
Start-Service postgresql-x64-16

# Or use Services app (services.msc)
```

---

### Database Authentication Failed

**Symptoms:**
```
error: password authentication failed for user "carbonledger"
```

**Solutions:**

1. Reset password:
   ```bash
   # macOS/Linux
   sudo -u postgres psql
   ALTER USER carbonledger WITH PASSWORD 'changeme';
   \q
   
   # Windows
   psql -U postgres
   ALTER USER carbonledger WITH PASSWORD 'changeme';
   \q
   ```

2. Check `.env` file:
   ```env
   DATABASE_URL=postgresql://carbonledger:changeme@localhost:5432/carbonledger
   ```

3. Verify user exists:
   ```bash
   psql -U postgres -c "\du"
   ```

---

### Prisma Migration Fails

**Symptoms:**
```
Error: P1001: Can't reach database server
```

**Solutions:**

1. Verify PostgreSQL is running (see above)

2. Check database exists:
   ```bash
   psql -U postgres -c "\l" | grep carbonledger
   ```

3. Create database if missing:
   ```bash
   createdb -U postgres carbonledger
   ```

4. Reset migrations (development only):
   ```bash
   cd backend
   npx prisma migrate reset
   npx prisma migrate dev
   ```

---

### Database Already Exists Error

**Symptoms:**
```
ERROR: database "carbonledger" already exists
```

**Solution:**
This is not an error. The database is already set up. Continue with:
```bash
cd backend
npx prisma migrate dev
```

---

## Test Failures

### Rust Tests Fail: Contract Not Found

**Symptoms:**
```
Error: Contract not found: CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM
```

**Solution:**
This is expected for integration tests. Run unit tests only:
```bash
cd contracts
cargo test --lib
```

---

### Backend Tests Fail: Database Connection

**Symptoms:**
```
Error: Can't reach database server at `localhost:5432`
```

**Solutions:**

1. Start PostgreSQL (see Database Issues above)

2. Run migrations:
   ```bash
   cd backend
   npx prisma migrate dev
   ```

3. Use test database:
   ```bash
   # Create test database
   createdb carbonledger_test
   
   # Update .env.test
   DATABASE_URL=postgresql://carbonledger:changeme@localhost:5432/carbonledger_test
   
   # Run tests
   npm test
   ```

---

### Frontend Tests Fail: Module Not Found

**Symptoms:**
```
Cannot find module '@stellar/freighter-api'
```

**Solution:**
```bash
cd frontend
npm install
npm test
```

---

## Runtime Errors

### Freighter Wallet Not Detected

**Symptoms:**
```
Error: Freighter is not installed
```

**Solutions:**

1. Install [Freighter extension](https://freighter.app)
2. Refresh browser page
3. Check browser console for errors
4. Try different browser (Chrome, Firefox, Brave)

---

### Contract Invocation Fails

**Symptoms:**
```
Error: Transaction failed: txBAD_AUTH
```

**Solutions:**

1. Check wallet is connected:
   ```javascript
   const publicKey = await window.freighterApi.getPublicKey();
   console.log('Connected:', publicKey);
   ```

2. Verify network (Testnet vs Mainnet):
   ```javascript
   const network = await window.freighterApi.getNetwork();
   console.log('Network:', network); // Should be "TESTNET"
   ```

3. Check account has XLM:
   ```bash
   stellar account balance <PUBLIC_KEY> --network testnet
   ```

4. Fund account if needed:
   ```bash
   stellar keys generate test --network testnet --fund
   ```

---

### CORS Error in Browser

**Symptoms:**
```
Access to fetch at 'http://localhost:3001' has been blocked by CORS policy
```

**Solutions:**

1. Check backend CORS configuration:
   ```typescript
   // backend/src/main.ts
   app.enableCors({
     origin: 'http://localhost:3000',
     credentials: true,
   });
   ```

2. Verify backend is running:
   ```bash
   curl http://localhost:3001/api/v1/health
   ```

3. Check environment variables:
   ```env
   # .env
   FRONTEND_URL=http://localhost:3000
   
   # frontend/.env.local
   NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
   ```

---

## Platform-Specific Issues

### macOS: Command Line Tools Missing

**Symptoms:**
```
xcrun: error: invalid active developer path
```

**Solution:**
```bash
xcode-select --install
```

---

### macOS: Homebrew PostgreSQL Issues

**Symptoms:**
```
psql: could not connect to server: No such file or directory
```

**Solutions:**

1. Reinstall PostgreSQL:
   ```bash
   brew uninstall postgresql@16
   brew install postgresql@16
   brew services start postgresql@16
   ```

2. Check socket location:
   ```bash
   ls -la /tmp/.s.PGSQL.5432
   ```

3. Use TCP connection:
   ```env
   DATABASE_URL=postgresql://carbonledger:changeme@127.0.0.1:5432/carbonledger
   ```

---

### Linux: Permission Denied Errors

**Symptoms:**
```
EACCES: permission denied, mkdir '/usr/local/lib/node_modules'
```

**Solutions:**

1. Use nvm instead of system Node.js (recommended)
2. Fix permissions:
   ```bash
   sudo chown -R $USER:$USER /usr/local/lib/node_modules
   ```
3. Use sudo (not recommended):
   ```bash
   sudo npm install -g <package>
   ```

---

### Windows: Long Path Issues

**Symptoms:**
```
ENAMETOOLONG: name too long
```

**Solutions:**

1. Enable long paths:
   ```powershell
   # Run as Administrator
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```

2. Use shorter project path:
   ```powershell
   # Instead of C:\Users\YourName\Documents\Projects\carbonledger
   # Use C:\dev\carbonledger
   ```

---

### Windows: PowerShell Execution Policy

**Symptoms:**
```
cannot be loaded because running scripts is disabled on this system
```

**Solution:**
```powershell
# Run as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

### Windows: Git Line Endings

**Symptoms:**
```
warning: LF will be replaced by CRLF
```

**Solution:**
```bash
git config --global core.autocrlf input
```

---

## Still Having Issues?

1. **Check the logs:**
   - Backend: `backend/logs/`
   - Frontend: Browser console (F12)
   - Contracts: `cargo test -- --nocapture`

2. **Search existing issues:**
   - [GitHub Issues](https://github.com/YOUR_USERNAME/carbonledger/issues)

3. **Ask for help:**
   - [GitHub Discussions](https://github.com/YOUR_USERNAME/carbonledger/discussions)
   - Include:
     - Operating system and version
     - Node.js, Rust, Python versions
     - Full error message
     - Steps to reproduce

4. **Run verification script:**
   ```bash
   # Linux/macOS
   ./scripts/verify-setup.sh
   
   # Windows
   .\scripts\verify-setup.ps1
   ```

---

## Useful Commands

### Check Versions
```bash
node --version
npm --version
rustc --version
cargo --version
python3 --version
psql --version
stellar --version
```

### Clean Build
```bash
# Contracts
cd contracts
cargo clean
cargo build --target wasm32-unknown-unknown --release

# Backend
cd backend
rm -rf node_modules dist
npm install
npm run build

# Frontend
cd frontend
rm -rf node_modules .next
npm install
npm run build
```

### Reset Database
```bash
cd backend
npx prisma migrate reset
npx prisma migrate dev
npx prisma generate
```

### View Logs
```bash
# Backend logs
tail -f backend/logs/app.log

# Docker logs
docker-compose logs -f backend
docker-compose logs -f frontend
```

---

**Need more help?** See [CONTRIBUTING.md](../CONTRIBUTING.md) for detailed setup instructions.
