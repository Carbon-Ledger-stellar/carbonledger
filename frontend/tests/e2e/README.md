# Playwright E2E Tests

This directory contains end-to-end tests for the CarbonLedger application using Playwright.

## Setup

1. Install dependencies:
```bash
cd frontend
npm ci
npx playwright install --with-deps
```

2. Set up testnet accounts:
   - Create 3 funded testnet accounts using the Stellar Laboratory or friendbot
   - One account for project developer
   - One account for verifier (needs to be registered as a verifier in the system)
   - One account for buyer

3. Set environment variables:
```bash
export E2E_PROJECT_DEVELOPER="G..."
export E2E_VERIFIER="G..."
export E2E_BUYER="G..."
export VERIFIER_TOKEN="..."  # Auth token for verifier account
```

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI mode for debugging
npm run test:e2e:ui

# Run specific test
npx playwright test lifecycle.spec.ts
```

## Test Coverage

The lifecycle test covers:
- Project registration
- Project verification
- Credit minting
- Marketplace listing
- Credit purchase
- Credit retirement
- Certificate generation
- Retirement irreversibility validation

## CI Integration

Tests run automatically on:
- Pull requests to `main` branch
- Pushes to `main` branch

Requires funded testnet accounts to be configured as repository secrets.