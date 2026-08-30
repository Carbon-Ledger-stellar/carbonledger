# Local Development Setup Guide

Complete step-by-step instructions for setting up CarbonLedger for local development on macOS, Linux, and Windows.

## Table of Contents

1. [System Requirements](#system-requirements)
2. [macOS Setup](#macos-setup)
3. [Linux Setup](#linux-setup)
4. [Windows Setup](#windows-setup)
5. [Database Setup](#database-setup)
6. [Redis Setup](#redis-setup)
7. [Backend Setup](#backend-setup)
8. [Frontend Setup](#frontend-setup)
9. [Verification](#verification)
10. [Common Issues & Troubleshooting](#common-issues--troubleshooting)

---

## System Requirements

### Minimum Requirements

- **Node.js**: 18.x or higher (LTS recommended)
- **npm**: 9.x or higher
- **Git**: Latest version
- **Docker**: (Optional, for PostgreSQL and Redis)
- **Disk Space**: 5GB minimum

### Optional Tools

- **pnpm**: Alternative package manager (faster than npm)
- **nvm** (macOS/Linux): Node version manager
- **Homebrew** (macOS): Package manager
- **PostgreSQL Client**: For direct database access

---

## macOS Setup

### Step 1: Install Prerequisites

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js using Homebrew
brew install node@18

# Verify installation
node --version  # Should be v18.x.x or higher
npm --version   # Should be 9.x or higher

# (Optional) Install Docker for containerized services
brew install --cask docker
```

### Step 2: Clone Repository

```bash
# Clone the repository
git clone https://github.com/yourorg/carbonledger.git
cd carbonledger

# Create and switch to development branch
git checkout -b feat/dev-setup
```

### Step 3: Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies (if applicable)
cd ../frontend
npm install

cd ..
```

### Step 4: Environment Configuration

```bash
# Backend environment setup
cd backend

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your local settings
nano .env.local  # or use your preferred editor

# Required variables:
# DATABASE_URL=postgresql://user:password@localhost:5432/carbonledger_dev
# REDIS_URL=redis://localhost:6379
# JWT_SECRET=your-local-secret-key
# NODE_ENV=development
```

### Step 5: Database Setup

```bash
# Start PostgreSQL (if using Homebrew installation)
brew services start postgresql@15

# Create database
createdb carbonledger_dev

# Run migrations
npm run prisma:migrate:deploy

# (Optional) Seed with test data
npm run prisma:db:seed
```

### Step 6: Start Development Services

```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start backend
npm run start:dev

# Terminal 3: Start frontend (if applicable)
cd ../frontend
npm run dev
```

### Step 7: Verify Installation

```bash
# Check backend health
curl http://localhost:3000/health

# Check Redis connection
redis-cli ping  # Should respond with PONG

# Backend should be running at http://localhost:3000
# Frontend should be running at http://localhost:3001 (if applicable)
```

---

## Linux Setup

### Step 1: Install Prerequisites

#### Ubuntu/Debian

```bash
# Update package manager
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js (using NodeSource repository)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Install Redis
sudo apt-get install -y redis-server

# Install Git
sudo apt-get install -y git

# Verify installations
node --version
npm --version
psql --version
redis-server --version
```

#### Fedora/RHEL

```bash
# Install Node.js
sudo dnf install -y nodejs

# Install PostgreSQL
sudo dnf install -y postgresql-server postgresql-contrib

# Install Redis
sudo dnf install -y redis

# Install Git
sudo dnf install -y git

# Verify installations
node --version
npm --version
```

### Step 2: Clone Repository

```bash
# Clone the repository
git clone https://github.com/yourorg/carbonledger.git
cd carbonledger

# Create development branch
git checkout -b feat/dev-setup
```

### Step 3: Install Dependencies

```bash
# Navigate to backend
cd backend
npm install

# Navigate to frontend and install
cd ../frontend
npm install

cd ..
```

### Step 4: Environment Configuration

```bash
cd backend

# Copy environment template
cp .env.example .env.local

# Edit with your preferred editor
nano .env.local

# Required variables for Linux development:
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/carbonledger_dev
# REDIS_URL=redis://localhost:6379
# JWT_SECRET=your-local-secret-key
# NODE_ENV=development
```

### Step 5: Database Setup

```bash
# Start PostgreSQL service
sudo systemctl start postgresql

# (Optional) Enable auto-start
sudo systemctl enable postgresql

# Create development database
sudo -u postgres createdb carbonledger_dev

# Run migrations
npm run prisma:migrate:deploy

# (Optional) Seed database
npm run prisma:db:seed
```

### Step 6: Redis Setup

```bash
# Start Redis service
sudo systemctl start redis-server

# (Optional) Enable auto-start
sudo systemctl enable redis-server

# Verify Redis is running
redis-cli ping  # Should respond with PONG
```

### Step 7: Start Development Services

```bash
# Terminal 1: Start backend
cd backend
npm run start:dev

# Terminal 2: Start frontend (if applicable)
cd frontend
npm run dev

# Check logs for any errors
tail -f backend/dist/main.js
```

### Step 8: Verify Installation

```bash
# Test backend health
curl http://localhost:3000/health

# Test Redis connection
redis-cli ping

# Test database connection
npm run prisma:studio  # Opens Prisma Studio at http://localhost:5555
```

---

## Windows Setup

### Step 1: Install Prerequisites

#### Using Chocolatey (Recommended)

```powershell
# Install Chocolatey (run as Administrator)
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Node.js
choco install nodejs

# Install PostgreSQL
choco install postgresql

# Install Redis
choco install redis-64

# Install Git
choco install git

# Verify installations
node --version
npm --version
psql --version
```

#### Using Windows Installers (Manual)

```powershell
# 1. Download and install Node.js from https://nodejs.org/
#    - Download LTS version (18.x or higher)
#    - Run installer and follow prompts
#    - Verify: open PowerShell and run:
node --version
npm --version

# 2. Download and install PostgreSQL from https://www.postgresql.org/download/windows/
#    - Run installer
#    - Remember the password for postgres user
#    - Note the installation port (default 5432)

# 3. Download and install Redis from https://github.com/microsoftarchive/redis/releases
#    - Extract to C:\Program Files\Redis
#    - Run redis-server.exe

# 4. Install Git from https://git-scm.com/download/win
```

### Step 2: Clone Repository

```powershell
# Open PowerShell or Command Prompt

# Clone repository
git clone https://github.com/yourorg/carbonledger.git
cd carbonledger

# Create development branch
git checkout -b feat/dev-setup
```

### Step 3: Install Dependencies

```powershell
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ..\frontend
npm install

cd ..
```

### Step 4: Environment Configuration

```powershell
cd backend

# Copy environment template
Copy-Item .env.example -Destination .env.local

# Edit with your preferred editor (or Notepad)
notepad .env.local

# Required variables for Windows:
# DATABASE_URL=postgresql://postgres:your_password@localhost:5432/carbonledger_dev
# REDIS_URL=redis://localhost:6379
# JWT_SECRET=your-local-secret-key
# NODE_ENV=development

# Note: Replace 'your_password' with the password you set during PostgreSQL installation
```

### Step 5: Database Setup

```powershell
# Start PostgreSQL (should auto-start as service)
# Verify via Services app (services.msc) or:
Get-Service -Name postgresql* | Start-Service

# Create database (using PostgreSQL client)
# Open PostgreSQL Command Line (psql) from PostgreSQL installation
psql -U postgres -c "CREATE DATABASE carbonledger_dev;"

# If psql not in PATH, find it:
# C:\Program Files\PostgreSQL\15\bin\psql.exe -U postgres

# Back in PowerShell, run migrations:
npm run prisma:migrate:deploy

# (Optional) Seed database
npm run prisma:db:seed
```

### Step 6: Redis Setup

```powershell
# Start Redis service
# Via Services app: search for "Services" → find "Redis" → right-click → Start
# Or via PowerShell:
Start-Service -Name Redis

# Verify Redis is running
redis-cli ping
# Should respond: PONG

# If redis-cli not found, add to PATH or use full path:
# C:\Program Files\Redis\redis-cli.exe ping
```

### Step 7: Start Development Services

```powershell
# Option A: Using separate PowerShell windows

# Window 1: Start backend
cd backend
npm run start:dev

# Window 2: Start frontend (if applicable)
cd frontend
npm run dev

# Option B: Using Windows Terminal with multiple panes
# Split terminal (Ctrl+Shift+2) and run commands in each pane
```

### Step 8: Verify Installation

```powershell
# Test backend health
curl http://localhost:3000/health

# Test Redis connection
redis-cli ping

# Test database connection
npm run prisma:studio
# Opens Prisma Studio at http://localhost:5555 in browser
```

---

## Database Setup

### Creating and Configuring PostgreSQL

#### Local PostgreSQL Connection

```bash
# macOS/Linux: Using default Unix socket
DATABASE_URL="postgresql://localhost/carbonledger_dev"

# Windows or with password
DATABASE_URL="postgresql://postgres:password@localhost:5432/carbonledger_dev"
```

#### Initial Database Commands

```bash
# Connect to PostgreSQL
psql -U postgres

# Create development database
CREATE DATABASE carbonledger_dev;

# Connect to new database
\c carbonledger_dev

# Create development user (optional)
CREATE USER carbonledger_dev WITH PASSWORD 'dev_password';
GRANT ALL PRIVILEGES ON DATABASE carbonledger_dev TO carbonledger_dev;

# Verify setup
\l  # List databases
\dt # List tables
\q  # Quit
```

#### Running Migrations

```bash
cd backend

# Apply pending migrations
npm run prisma:migrate:deploy

# Create new migration (if schema changes)
npm run prisma:migrate:dev -- --name describe_your_change

# Reset database (WARNING: destroys data)
npm run prisma:migrate:reset

# View migration status
npm run prisma:migrate:status
```

#### Seeding Test Data (Optional)

```bash
# If seed file exists
npm run prisma:db:seed

# Otherwise, manually insert test data using Prisma Studio
npm run prisma:studio
```

---

## Redis Setup

### Starting Redis

#### macOS

```bash
# Using Homebrew
brew services start redis

# Or run in foreground (for debugging)
redis-server
```

#### Linux

```bash
# Ubuntu/Debian
sudo systemctl start redis-server

# Fedora/RHEL
sudo systemctl start redis
```

#### Windows

```powershell
# Via Services
Start-Service -Name Redis

# Or run manually
C:\Program Files\Redis\redis-server.exe
```

### Verifying Redis

```bash
# Test connection
redis-cli ping
# Expected: PONG

# Check server info
redis-cli info server

# Check memory usage
redis-cli info memory

# Monitor in real-time
redis-cli monitor
```

### Redis Configuration

```bash
# Location of config
# macOS: /usr/local/etc/redis.conf
# Linux: /etc/redis/redis.conf
# Windows: C:\Program Files\Redis\redis.windows.conf

# Common settings for development
maxmemory 256mb                    # Limit memory usage
maxmemory-policy allkeys-lru       # Evict oldest keys when full
databases 16                       # Number of databases
```

---

## Backend Setup

### Install Backend Dependencies

```bash
cd backend
npm install
```

### Configure Environment

```bash
# Copy example environment
cp .env.example .env.local

# Minimum required variables
cat > .env.local << 'EOF'
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/carbonledger_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-dev-secret-key-min-32-chars
JWT_EXPIRATION_SECONDS=86400
PORT=3000
ADMIN_PUBLIC_KEY=your_admin_stellar_key
VERIFIER_PUBLIC_KEY=your_verifier_stellar_key
EOF
```

### Database Migrations

```bash
# Apply migrations
npm run prisma:migrate:deploy

# View database in studio
npm run prisma:studio
```

### Start Backend

```bash
# Development mode (with hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod

# Run tests
npm run test

# Run tests with coverage
npm run test:coverage
```

### API Documentation

```bash
# Generate OpenAPI spec
npm run export:openapi

# Access Swagger UI at http://localhost:3000/api/docs
```

---

## Frontend Setup

### Install Frontend Dependencies

```bash
cd frontend
npm install
```

### Configure Environment

```bash
# Copy example environment
cp .env.example .env.local

# Set API endpoint
echo "VITE_API_URL=http://localhost:3000" >> .env.local
```

### Start Frontend

```bash
# Development mode
npm run dev

# Build for production
npm run build

# Run tests
npm run test

# Lint and format
npm run lint
npm run format
```

---

## Verification

### Checklist for Complete Setup

- [ ] Node.js 18+ installed and working
- [ ] Git repository cloned
- [ ] npm dependencies installed (backend and frontend)
- [ ] PostgreSQL installed and running
- [ ] Database created: `carbonledger_dev`
- [ ] Migrations applied: `npm run prisma:migrate:deploy`
- [ ] Redis installed and running
- [ ] `.env.local` configured with proper credentials
- [ ] Backend starts without errors: `npm run start:dev`
- [ ] Frontend starts without errors (if applicable): `npm run dev`
- [ ] API responds to health check: `curl http://localhost:3000/health`
- [ ] Prisma Studio works: `npm run prisma:studio`

### Testing the Setup

```bash
# 1. Test backend API
curl http://localhost:3000/health
# Expected: {"status":"ok"}

# 2. Test database connection
npm run prisma:studio
# Should open http://localhost:5555 showing database tables

# 3. Test Redis connection
redis-cli ping
# Expected: PONG

# 4. Run unit tests
npm run test -- --run

# 5. Run integration tests (if database is ready)
npm run test:integration -- --run
```

---

## Common Issues & Troubleshooting

### Issue 1: npm install fails

**Symptoms**: Dependency installation errors, "ERR! code ERESOLVE"

**Solutions**:
```bash
# Clear npm cache
npm cache clean --force

# Use legacy peer deps (for compatibility)
npm install --legacy-peer-deps

# Use npm audit fix
npm audit fix --force
```

### Issue 2: PostgreSQL connection refused

**Symptoms**: "ECONNREFUSED 127.0.0.1:5432"

**Diagnosis**:
```bash
# Check if PostgreSQL is running
# macOS
brew services list | grep postgres

# Linux
sudo systemctl status postgresql

# Windows
Get-Service -Name postgresql*
```

**Solutions**:
```bash
# Start PostgreSQL service
# macOS
brew services start postgresql

# Linux
sudo systemctl start postgresql

# Windows
Start-Service -Name postgresql-x64-15
```

### Issue 3: Redis connection failed

**Symptoms**: "Error: connect ECONNREFUSED 127.0.0.1:6379"

**Diagnosis**:
```bash
redis-cli ping
# If no response, Redis isn't running
```

**Solutions**:
```bash
# Start Redis
# macOS
redis-server

# Linux
sudo systemctl start redis-server

# Windows
redis-server.exe
# Or via Services: Start-Service -Name Redis
```

### Issue 4: Database migration fails

**Symptoms**: "Migration failed", "Connection timeout"

**Solutions**:
```bash
# Check connection string
cat .env.local | grep DATABASE_URL

# Verify database exists
psql -U postgres -l | grep carbonledger_dev

# Create if missing
psql -U postgres -c "CREATE DATABASE carbonledger_dev;"

# Reset and reapply migrations
npm run prisma:migrate:reset

# View migration status
npm run prisma:migrate:status
```

### Issue 5: Port already in use

**Symptoms**: "Port 3000 is already in use"

**Solutions**:
```bash
# macOS/Linux: Find and kill process
lsof -i :3000
kill -9 <PID>

# Windows: Find and kill process
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Or use different port
PORT=3001 npm run start:dev
```

### Issue 6: Prisma Studio won't start

**Symptoms**: "Failed to start Prisma Studio", "Port 5555 already in use"

**Solutions**:
```bash
# Use different port
npm run prisma:studio -- --port 5556

# Or kill existing process
lsof -i :5555
kill -9 <PID>
```

### Issue 7: Cache hit rate low

**Symptoms**: Performance optimization not working, cache hits < 50%

**Solutions**:
```bash
# Verify Redis is connected
# Add to .env.local if not using default
REDIS_URL=redis://localhost:6379

# Check cache statistics
curl http://localhost:3000/health/cache
# or check logs for cache hit rate

# Clear all caches and retry
redis-cli FLUSHALL

# Check if Redis is responding
redis-cli ping
```

### Issue 8: Hot reload not working (backend)

**Symptoms**: Changes to code don't auto-reload

**Solutions**:
```bash
# Verify watch mode is enabled
npm run start:dev

# If not working, kill and restart
npm run build
npm run start:dev

# Check if file watcher has limit (Linux)
cat /proc/sys/fs/inotify/max_user_watches
# If low, increase:
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### Issue 9: Permission denied errors

**Symptoms**: "EACCES", "permission denied"

**Diagnosis**:
```bash
# Check file permissions
ls -la

# Check ownership
whoami
```

**Solutions**:
```bash
# macOS/Linux: Fix permissions
sudo chown -R $(whoami) .

# Or use sudo (not recommended)
sudo npm install
```

### Issue 10: Out of memory errors

**Symptoms**: "JavaScript heap out of memory", "FATAL ERROR"

**Solutions**:
```bash
# Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096" npm run build

# Or permanently in .env.local
NODE_OPTIONS=--max-old-space-size=4096

# Reduce cache TTL in backend/src/cache/cache.decorator.ts
```

---

## Getting Help

If you encounter issues not covered here:

1. **Check existing issues**: https://github.com/yourorg/carbonledger/issues
2. **Review logs**: Check backend/dist logs and Redis output
3. **Consult documentation**: See docs/API_REFERENCE.md
4. **Run diagnostics**:
   ```bash
   npm run test -- --verbose
   npm run test:coverage
   ```
5. **Ask the team**: Create an issue with:
   - OS and Node.js version
   - Exact error message
   - Steps to reproduce
   - Current `.env.local` (without secrets)

---

## Next Steps

1. **Read documentation**: Start with `backend/docs/API_REFERENCE.md`
2. **Explore the code**: Start with `src/projects/` to understand the structure
3. **Run tests**: `npm run test -- --run` to ensure everything works
4. **Set up your IDE**: Configure TypeScript, linting, and formatting
5. **Read contribution guidelines**: See `CONTRIBUTING.md`

Happy coding! 🚀

