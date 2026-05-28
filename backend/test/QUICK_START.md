# Integration Tests Quick Start

## 🚀 Run Tests in 3 Steps

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Start Test Database & Run Tests
```bash
npm run test:e2e
```

That's it! The `pretest:e2e` script automatically:
- Starts PostgreSQL in Docker
- Runs database migrations
- Then executes all integration tests

### 3. Stop Test Database (Optional)
```bash
npm run test:db:down
```

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run all integration tests |
| `npm run test:e2e:watch` | Run tests in watch mode |
| `npm run test:db:up` | Start test database only |
| `npm run test:db:down` | Stop and remove test database |
| `npm run test:db:migrate` | Run migrations on test DB |
| `npm run test:db:reset` | Reset test database |

## ✅ What Gets Tested

### Auth Flow
- ✅ Valid login → JWT issued
- ✅ Invalid login → 401
- ✅ Token validation

### RBAC Enforcement
- ✅ Corporation blocked from verifier endpoints → 403
- ✅ Admin access to all endpoints
- ✅ Role-specific permissions

### Certificate Retrieval
- ✅ Retired credit → certificate found
- ✅ Non-existent → 404
- ✅ Complete certificate data

## 🐛 Troubleshooting

### "Port 5433 already in use"
```bash
npm run test:db:down
docker ps -a | grep carbonledger-test
docker rm -f carbonledger-test-db
```

### "Cannot connect to database"
```bash
docker ps  # Check if container is running
docker logs carbonledger-test-db  # Check logs
```

### "Migration failed"
```bash
npm run test:db:reset  # Reset and re-run migrations
```

## 📊 CI/CD

Tests run automatically in GitHub Actions on every push and PR. Check `.github/workflows/backend-tests.yml` for configuration.
