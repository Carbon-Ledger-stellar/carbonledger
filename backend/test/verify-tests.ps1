# Integration Tests Verification Script
# This script verifies that all integration test files and configurations are in place

Write-Host "=== CarbonLedger Integration Tests Verification ===" -ForegroundColor Cyan
Write-Host ""

$allChecks = @()

# Check test files
Write-Host "Checking test files..." -ForegroundColor Yellow
$testFiles = @(
    "test/auth.e2e-spec.ts",
    "test/rbac.e2e-spec.ts",
    "test/certificate.e2e-spec.ts",
    "test/test-helpers.ts",
    "test/jest-e2e.json"
)

foreach ($file in $testFiles) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
        $allChecks += $true
    } else {
        Write-Host "  ✗ $file (MISSING)" -ForegroundColor Red
        $allChecks += $false
    }
}

# Check configuration files
Write-Host ""
Write-Host "Checking configuration files..." -ForegroundColor Yellow
$configFiles = @(
    "docker-compose.test.yml",
    ".env.test",
    "jest.config.js"
)

foreach ($file in $configFiles) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
        $allChecks += $true
    } else {
        Write-Host "  ✗ $file (MISSING)" -ForegroundColor Red
        $allChecks += $false
    }
}

# Check documentation
Write-Host ""
Write-Host "Checking documentation..." -ForegroundColor Yellow
$docFiles = @(
    "test/README.md",
    "test/QUICK_START.md",
    "test/ACCEPTANCE_CRITERIA_CHECKLIST.md",
    "test/VERIFICATION_GUIDE.md"
)

foreach ($file in $docFiles) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
        $allChecks += $true
    } else {
        Write-Host "  ✗ $file (MISSING)" -ForegroundColor Red
        $allChecks += $false
    }
}

# Check package.json scripts
Write-Host ""
Write-Host "Checking package.json scripts..." -ForegroundColor Yellow
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$requiredScripts = @(
    "test:e2e",
    "test:e2e:watch",
    "test:db:up",
    "test:db:down",
    "test:db:migrate",
    "pretest:e2e"
)

foreach ($script in $requiredScripts) {
    if ($packageJson.scripts.PSObject.Properties.Name -contains $script) {
        Write-Host "  ✓ $script" -ForegroundColor Green
        $allChecks += $true
    } else {
        Write-Host "  ✗ $script (MISSING)" -ForegroundColor Red
        $allChecks += $false
    }
}

# Check dependencies
Write-Host ""
Write-Host "Checking test dependencies..." -ForegroundColor Yellow
$requiredDeps = @(
    "@types/jest",
    "@types/supertest",
    "jest",
    "supertest",
    "ts-jest",
    "dotenv-cli"
)

foreach ($dep in $requiredDeps) {
    if ($packageJson.devDependencies.PSObject.Properties.Name -contains $dep) {
        Write-Host "  ✓ $dep" -ForegroundColor Green
        $allChecks += $true
    } else {
        Write-Host "  ✗ $dep (MISSING)" -ForegroundColor Red
        $allChecks += $false
    }
}

# Check Docker
Write-Host ""
Write-Host "Checking Docker availability..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version 2>$null
    if ($dockerVersion) {
        Write-Host "  ✓ Docker is installed: $dockerVersion" -ForegroundColor Green
        $allChecks += $true
    } else {
        Write-Host "  ✗ Docker not found" -ForegroundColor Red
        $allChecks += $false
    }
} catch {
    Write-Host "  ✗ Docker not available" -ForegroundColor Red
    $allChecks += $false
}

# Summary
Write-Host ""
Write-Host "=== Verification Summary ===" -ForegroundColor Cyan
$passed = ($allChecks | Where-Object { $_ -eq $true }).Count
$total = $allChecks.Count
$percentage = [math]::Round(($passed / $total) * 100, 2)

Write-Host "Passed: $passed / $total ($percentage%)" -ForegroundColor $(if ($passed -eq $total) { "Green" } else { "Yellow" })

if ($passed -eq $total) {
    Write-Host ""
    Write-Host "✓ All checks passed! Integration tests are ready to run." -ForegroundColor Green
    Write-Host ""
    Write-Host "To run tests:" -ForegroundColor Cyan
    Write-Host "  npm run test:e2e" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "⚠ Some checks failed. Please review the output above." -ForegroundColor Yellow
}

Write-Host ""
