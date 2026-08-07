# Backend Integration Tests

This directory contains end-to-end integration tests for the CarbonLedger backend API.

## Test Coverage

### Auth Tests (`auth.e2e-spec.ts`)
- ✅ Valid signature → JWT issued
- ✅ Invalid signature → 401
- ✅ User creation on first login
- ✅ JWT token validation
- ✅ Protected endpoint access

### RBAC Tests (`rbac.e2e-spec.ts`)
- ✅ Corporation cannot call verifier endpoints → 403
- ✅ Role-based access control enforcement
- ✅ Cross-role access prevention
- ✅ Admin access to protected endpoints

### Certificate Tests (`certificate.e2e-spec.ts`)
- ✅ Retired credit → certificate retrievable
- ✅ Non-existent retirement → 404
- ✅ Certificate data integrity
- ✅ PDF generation for valid retirements

## Running Tests

### Prerequisites
- Docker installed and running
- Node.js 20+
- PostgreSQL (via Docker)

### Local Development

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Start test database:**
   ```bash
   npm run test:db:up
   ```

3. **Run migrations:**
   ```bash
   npm run test:db:migrate
   ```

4. **Run all integration tests:**
   ```bash
   npm run test:e2e
   ```

5. **Run tests in watch mode:**
   ```bash
   npm run test:e2e:watch
   ```

6. **Stop test database:**
   ```bash
   npm run test:db:down
   ```

### CI/CD

Tests run automatically in GitHub Actions on:
- Push to `main`, `develop`, or `feature/**` branches
- Pull requests to `main` or `develop`

The CI pipeline:
1. Spins up PostgreSQL in Docker
2. Runs Prisma migrations
3. Executes all integration tests
4. Uploads test results as artifacts

## Test Database

- **Host:** localhost
- **Port:** 5433 (to avoid conflicts with local dev DB)
- **Database:** carbonledger_test
- **User:** testuser
- **Password:** testpass

Connection string: `postgresql://testuser:testpass@localhost:5433/carbonledger_test?schema=public`

## Test Structure

Each test suite follows this pattern:

```typescript
describe('Feature Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);
  });

  // Test cases...
});
```

## Helper Functions

- `createTestApp()`: Creates a NestJS test application
- `cleanDatabase()`: Clears all test data
- `seedTestData()`: Seeds database with test fixtures

## Troubleshooting

### Port already in use
If port 5433 is already in use:
```bash
npm run test:db:down
docker ps -a | grep carbonledger-test-db
docker rm -f carbonledger-test-db
```

### Database connection issues
Ensure Docker is running and the test database is healthy:
```bash
docker ps
docker logs carbonledger-test-db
```

### Migration issues
Reset the test database:
```bash
npm run test:db:reset
```

## Adding New Tests

1. Create a new test file: `test/feature-name.e2e-spec.ts`
2. Import test helpers: `import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';`
3. Follow the existing test structure
4. Add any new seed data to `test-helpers.ts`

## Best Practices

- Use `beforeEach` to ensure clean state between tests
- Use descriptive test names that explain the expected behavior
- Test both success and failure scenarios
- Verify HTTP status codes and response structure
- Clean up resources in `afterAll` hooks
