# Verification Guide

This guide walks you through verifying that the integration tests are working correctly.

## Prerequisites Check

### 1. Verify Docker is Running
```bash
docker --version
docker ps
```

Expected: Docker version info and running containers list

### 2. Verify Node.js Version
```bash
node --version
```

Expected: v20.x.x or higher

### 3. Verify You're in Backend Directory
```bash
pwd
ls package.json
```

Expected: Should show backend directory and package.json exists

## Installation Verification

### 1. Install Dependencies
```bash
npm install
```

Expected output:
```
added XXX packages
```

### 2. Verify Test Dependencies
```bash
npm list jest supertest ts-jest
```

Expected: All three packages listed with versions

### 3. Generate Prisma Client
```bash
npx prisma generate
```

Expected:
```
✔ Generated Prisma Client
```

## Test Database Verification

### 1. Start Test Database
```bash
npm run test:db:up
```

Expected output:
```
Creating network "backend_default" with the default driver
Creating carbonledger-test-db ... done
```

### 2. Verify Database is Running
```bash
docker ps | grep carbonledger-test
```

Expected: Container running on port 5433

### 3. Check Database Health
```bash
docker logs carbonledger-test-db
```

Expected: PostgreSQL startup logs, ending with "database system is ready to accept connections"

### 4. Run Migrations
```bash
npm run test:db:migrate
```

Expected:
```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "carbonledger_test"
X migrations found in prisma/migrations
X migrations have been applied
```

## Running Tests

### 1. Run All Integration Tests
```bash
npm run test:e2e
```

Expected output:
```
PASS  test/auth.e2e-spec.ts
  Auth Integration Tests (e2e)
    POST /auth/login
      ✓ should issue JWT for valid signature (XXms)
      ✓ should return 401 for invalid signature (XXms)
      ...

PASS  test/rbac.e2e-spec.ts
  RBAC Integration Tests (e2e)
    Verifier Endpoints Access Control
      ✓ should return 403 when corporation tries to access verifier endpoints (XXms)
      ...

PASS  test/certificate.e2e-spec.ts
  Certificate Retrieval Integration Tests (e2e)
    GET /retirements/certificate/:id
      ✓ should retrieve certificate for retired credit (XXms)
      ...

Test Suites: 3 passed, 3 total
Tests:       36 passed, 36 total
```

### 2. Run Individual Test Suites

**Auth Tests Only:**
```bash
npm run test:e2e -- auth.e2e-spec.ts
```

Expected: 11 tests passed

**RBAC Tests Only:**
```bash
npm run test:e2e -- rbac.e2e-spec.ts
```

Expected: 13 tests passed

**Certificate Tests Only:**
```bash
npm run test:e2e -- certificate.e2e-spec.ts
```

Expected: 12 tests passed

### 3. Run Tests in Watch Mode
```bash
npm run test:e2e:watch
```

Expected: Tests run and watch for file changes

Press `q` to quit watch mode

## Verify Specific Acceptance Criteria

### AC1: Test DB Spun Up in CI via Docker

**Verify locally:**
```bash
npm run test:db:up
docker ps | grep carbonledger-test-db
```

**Verify in CI:**
1. Push changes to GitHub
2. Go to Actions tab
3. Check "Backend Integration Tests" workflow
4. Verify PostgreSQL service starts successfully

### AC2: Auth - Valid Signature → JWT; Invalid → 401

**Run auth tests:**
```bash
npm run test:e2e -- auth.e2e-spec.ts
```

**Look for these passing tests:**
- ✓ should issue JWT for valid signature
- ✓ should return 401 for invalid signature
- ✓ should reject requests with invalid token

### AC3: RBAC - Corporation Cannot Call Verifier Endpoints → 403

**Run RBAC tests:**
```bash
npm run test:e2e -- rbac.e2e-spec.ts
```

**Look for these passing tests:**
- ✓ should return 403 when corporation tries to access verifier endpoints
- ✓ should return 403 when corporation tries to review verifier application
- ✓ should prevent corporation from listing verifier applications

### AC4: Certificate - Retired Credit Retrievable; Non-existent → 404

**Run certificate tests:**
```bash
npm run test:e2e -- certificate.e2e-spec.ts
```

**Look for these passing tests:**
- ✓ should retrieve certificate for retired credit
- ✓ should return 404 for non-existent retirement
- ✓ should include all required fields for certificate generation

## Manual API Testing (Optional)

### 1. Start Backend Server
```bash
npm run start:dev
```

### 2. Test Auth Endpoint
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"GTEST123","role":"corporation"}'
```

Expected: JSON with `access_token`

### 3. Test Protected Endpoint (Should Fail)
```bash
curl http://localhost:3000/verifiers
```

Expected: 401 Unauthorized

### 4. Test Protected Endpoint (With Token)
```bash
TOKEN="<paste_token_from_step_2>"
curl http://localhost:3000/verifiers \
  -H "Authorization: Bearer $TOKEN"
```

Expected: 403 Forbidden (corporation role)

### 5. Test Certificate Endpoint
```bash
curl http://localhost:3000/retirements/certificate/NONEXISTENT
```

Expected: 404 Not Found

## Cleanup

### Stop Test Database
```bash
npm run test:db:down
```

Expected:
```
Stopping carbonledger-test-db ... done
Removing carbonledger-test-db ... done
Removing network backend_default
```

### Verify Cleanup
```bash
docker ps -a | grep carbonledger-test
```

Expected: No output (container removed)

## Troubleshooting

### Issue: Port 5433 Already in Use

**Solution:**
```bash
npm run test:db:down
docker ps -a | grep carbonledger-test
docker rm -f carbonledger-test-db
lsof -ti:5433 | xargs kill -9  # macOS/Linux
```

### Issue: Cannot Connect to Database

**Check container status:**
```bash
docker ps
docker logs carbonledger-test-db
```

**Restart database:**
```bash
npm run test:db:down
npm run test:db:up
```

### Issue: Migration Failed

**Reset database:**
```bash
npm run test:db:reset
```

### Issue: Tests Failing

**Clean and restart:**
```bash
npm run test:db:down
rm -rf node_modules
npm install
npx prisma generate
npm run test:e2e
```

## Success Criteria

✅ All checks pass:
- [ ] Docker is running
- [ ] Dependencies installed
- [ ] Test database starts successfully
- [ ] Migrations run without errors
- [ ] All 36 tests pass
- [ ] Auth tests: 11/11 passed
- [ ] RBAC tests: 13/13 passed
- [ ] Certificate tests: 12/12 passed

## CI/CD Verification

### GitHub Actions

1. **Push to branch:**
   ```bash
   git push origin feature/workspace-updates
   ```

2. **Check workflow:**
   - Go to GitHub repository
   - Click "Actions" tab
   - Find "Backend Integration Tests" workflow
   - Verify all steps pass:
     - ✓ Checkout code
     - ✓ Setup Node.js
     - ✓ Install dependencies
     - ✓ Setup test environment
     - ✓ Run Prisma migrations
     - ✓ Generate Prisma Client
     - ✓ Run integration tests

3. **View test results:**
   - Click on workflow run
   - Expand "Run integration tests" step
   - Verify all 36 tests passed

## Next Steps After Verification

1. ✅ Merge feature branch to develop/main
2. ✅ Monitor CI pipeline on subsequent commits
3. ✅ Add more integration tests as needed
4. ✅ Update documentation as features evolve

## Support

If you encounter issues:
1. Check `test/README.md` for detailed documentation
2. Review `test/QUICK_START.md` for quick reference
3. Check `test/IMPLEMENTATION_SUMMARY.md` for technical details
4. Review test files for examples
