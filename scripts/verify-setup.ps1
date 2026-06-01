# CarbonLedger - Setup Verification Script (PowerShell)
# Checks if all prerequisites are installed correctly

Write-Host "🔍 CarbonLedger Setup Verification" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

$Errors = 0
$Warnings = 0

function Check-Command {
    param(
        [string]$Command,
        [string]$Name,
        [string]$InstallUrl
    )
    
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        $version = & $Command --version 2>&1 | Select-Object -First 1
        Write-Host "✓ $Name`: $version" -ForegroundColor Green
        return $true
    } else {
        Write-Host "✗ $Name`: Not found" -ForegroundColor Red
        Write-Host "   Install from: $InstallUrl" -ForegroundColor Yellow
        $script:Errors++
        return $false
    }
}

Write-Host "📋 Checking Prerequisites" -ForegroundColor Yellow
Write-Host "-------------------------"

# Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node --version
    Write-Host "✓ Node.js: $nodeVersion" -ForegroundColor Green
    
    $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($majorVersion -lt 18) {
        Write-Host "⚠ Warning: Node.js 18+ recommended (you have v$majorVersion)" -ForegroundColor Yellow
        $Warnings++
    }
} else {
    Write-Host "✗ Node.js: Not found" -ForegroundColor Red
    Write-Host "   Install from: https://nodejs.org" -ForegroundColor Yellow
    $Errors++
}

# npm
Check-Command "npm" "npm" "https://nodejs.org" | Out-Null

# Rust
if (Get-Command rustc -ErrorAction SilentlyContinue) {
    $rustVersion = rustc --version
    Write-Host "✓ Rust: $rustVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Rust: Not found" -ForegroundColor Red
    Write-Host "   Install from: https://rustup.rs" -ForegroundColor Yellow
    $Errors++
}

# Cargo
Check-Command "cargo" "Cargo" "https://rustup.rs" | Out-Null

# Python
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonVersion = python --version
    Write-Host "✓ Python: $pythonVersion" -ForegroundColor Green
} elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
    $pythonVersion = python3 --version
    Write-Host "✓ Python: $pythonVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Python: Not found" -ForegroundColor Red
    Write-Host "   Install from: https://python.org" -ForegroundColor Yellow
    $Errors++
}

# PostgreSQL
if (Get-Command psql -ErrorAction SilentlyContinue) {
    $psqlVersion = psql --version
    Write-Host "✓ PostgreSQL: $psqlVersion" -ForegroundColor Green
} else {
    Write-Host "✗ PostgreSQL: Not found" -ForegroundColor Red
    Write-Host "   Install from: https://postgresql.org" -ForegroundColor Yellow
    $Errors++
}

# Docker (optional)
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $dockerVersion = docker --version
    Write-Host "✓ Docker: $dockerVersion" -ForegroundColor Green
} else {
    Write-Host "⚠ Docker: Not found (optional)" -ForegroundColor Yellow
    $Warnings++
}

Write-Host ""
Write-Host "🔧 Checking Rust Toolchain" -ForegroundColor Yellow
Write-Host "--------------------------"

# wasm32 target
$targets = rustup target list 2>&1
if ($targets -match "wasm32-unknown-unknown \(installed\)") {
    Write-Host "✓ wasm32-unknown-unknown target installed" -ForegroundColor Green
} else {
    Write-Host "✗ wasm32-unknown-unknown target not installed" -ForegroundColor Red
    Write-Host "   Run: rustup target add wasm32-unknown-unknown" -ForegroundColor Yellow
    $Errors++
}

# Stellar CLI
if (Get-Command stellar -ErrorAction SilentlyContinue) {
    $stellarVersion = stellar --version
    Write-Host "✓ Stellar CLI: $stellarVersion" -ForegroundColor Green
} else {
    Write-Host "⚠ Stellar CLI: Not found (needed for deployment)" -ForegroundColor Yellow
    Write-Host "   Run: cargo install --locked stellar-cli" -ForegroundColor Yellow
    $Warnings++
}

Write-Host ""
Write-Host "🗄️  Checking Database" -ForegroundColor Yellow
Write-Host "---------------------"

# Check if PostgreSQL service is running
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
if ($pgService -and $pgService.Status -eq "Running") {
    Write-Host "✓ PostgreSQL service is running" -ForegroundColor Green
} else {
    Write-Host "✗ PostgreSQL service is not running" -ForegroundColor Red
    Write-Host "   Start from Services app or run: net start postgresql-x64-16" -ForegroundColor Yellow
    $Errors++
}

Write-Host ""
Write-Host "📦 Checking Dependencies" -ForegroundColor Yellow
Write-Host "------------------------"

# Backend node_modules
if (Test-Path "backend/node_modules") {
    Write-Host "✓ Backend dependencies installed" -ForegroundColor Green
} else {
    Write-Host "⚠ Backend dependencies not installed" -ForegroundColor Yellow
    Write-Host "   Run: cd backend; npm install" -ForegroundColor Yellow
    $Warnings++
}

# Frontend node_modules
if (Test-Path "frontend/node_modules") {
    Write-Host "✓ Frontend dependencies installed" -ForegroundColor Green
} else {
    Write-Host "⚠ Frontend dependencies not installed" -ForegroundColor Yellow
    Write-Host "   Run: cd frontend; npm install" -ForegroundColor Yellow
    $Warnings++
}

# Contracts build
if (Test-Path "contracts/target") {
    Write-Host "✓ Contracts built" -ForegroundColor Green
} else {
    Write-Host "⚠ Contracts not built" -ForegroundColor Yellow
    Write-Host "   Run: cd contracts; cargo build --target wasm32-unknown-unknown --release" -ForegroundColor Yellow
    $Warnings++
}

# Python packages
$pythonCmd = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "python3" }
$stellarSdkCheck = & $pythonCmd -c "import stellar_sdk" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Python dependencies installed" -ForegroundColor Green
} else {
    Write-Host "⚠ Python dependencies not installed" -ForegroundColor Yellow
    Write-Host "   Run: cd oracle; pip install -r requirements.txt" -ForegroundColor Yellow
    $Warnings++
}

Write-Host ""
Write-Host "📄 Checking Configuration" -ForegroundColor Yellow
Write-Host "-------------------------"

# .env file
if (Test-Path ".env") {
    Write-Host "✓ .env file exists" -ForegroundColor Green
    
    $envContent = Get-Content ".env" -Raw
    
    if ($envContent -match "DATABASE_URL=.+") {
        Write-Host "✓ DATABASE_URL configured" -ForegroundColor Green
    } else {
        Write-Host "⚠ DATABASE_URL not set in .env" -ForegroundColor Yellow
        $Warnings++
    }
    
    if ($envContent -match "JWT_SECRET=.+") {
        Write-Host "✓ JWT_SECRET configured" -ForegroundColor Green
    } else {
        Write-Host "⚠ JWT_SECRET not set in .env" -ForegroundColor Yellow
        $Warnings++
    }
} else {
    Write-Host "✗ .env file not found" -ForegroundColor Red
    Write-Host "   Run: Copy-Item .env.example .env" -ForegroundColor Yellow
    $Errors++
}

Write-Host ""
Write-Host "===================================" -ForegroundColor Cyan
Write-Host "📊 Summary" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan

if ($Errors -eq 0 -and $Warnings -eq 0) {
    Write-Host "✓ All checks passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You're ready to run tests:"
    Write-Host "  cd contracts; cargo test"
    Write-Host "  cd backend; npm test"
    Write-Host "  cd frontend; npm test"
    Write-Host ""
    Write-Host "Or start developing:"
    Write-Host "  cd backend; npm run start:dev"
    Write-Host "  cd frontend; npm run dev"
    exit 0
} elseif ($Errors -eq 0) {
    Write-Host "⚠ Setup complete with $Warnings warning(s)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You can proceed, but some features may not work."
    Write-Host "See CONTRIBUTING.md for detailed setup instructions."
    exit 0
} else {
    Write-Host "✗ Setup incomplete: $Errors error(s), $Warnings warning(s)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please fix the errors above before continuing."
    Write-Host "See CONTRIBUTING.md for detailed setup instructions."
    exit 1
}
