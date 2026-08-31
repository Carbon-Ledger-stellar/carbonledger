# CarbonLedger Testing Strategy

A comprehensive guide to testing patterns, pyramid structure, coverage targets, and best practices for CarbonLedger backend, contracts, and frontend.

## Testing Pyramid

The testing pyramid prioritizes fast, isolated unit tests at the base, integrated tests in the middle, and slow end-to-end tests at the top.

```
                    ╱╲
                   ╱  ╲
                  ╱ E2E ╲         5% of tests
                 ╱────────╲      Run: < 1 min total (parallel)
                ╱          ╲     Cost: High (slow, flaky)
               ╱  Integration ╲  25% of tests
              ╱────────────────╲ Run: < 5 min
             ╱                  ╲ Cost: Medium
            ╱                    ╲
           ╱────────────────────────╲
          ╱      Unit Tests (70%)     ╲  Run: < 5 sec
         ╱──────────────────────────────╲ Cost: Low (fast, deterministic)
        ╱                                ╲
```

### Recommended Test Counts

| Level | Count | Total Time | Rationale |
|-------|-------|-----------|-----------|
| Unit | 200-300 | <5s | Fast feedback, catch regressions early |
| Integration | 50-100 | 1-2min | Database, Redis, external service mocking |
| E2E | 10-20 | <1min (parallel) | User journeys, critical flows |
| **Total** | **~350-400** | **<10min** | Full suite runs in CI before merge |

---

## Test Types

### 1. Unit Tests

**Purpose:** Test individual functions/methods in isolation without external dependencies.

**Characteristics:**
- Fast (< 100ms each)
- Deterministic (no randomness, no external I/O)
- Focused on single responsibility
- Use mocks for all dependencies

**Technology Stack:**
- Framework: Jest (`*.spec.ts`)
- Mocking: `jest.mock()`, `jest.spyOn()`, `sinon.stub()`
- Assertions: Jest matchers (`expect()`)

**Example (NestJS Service):**

```typescript
// src/projects/projects.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { StellarService } from '../stellar/stellar.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: jest.Mocked<PrismaService>;
  let stellar: jest.Mocked<StellarService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: PrismaService,
          useValue: {
            carbonProject: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: StellarService,
          useValue: {
            verifySignature: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    stellar = module.get(StellarService) as jest.Mocked<StellarService>;
  });

  describe('createProject', () => {
    it('should create a project with valid metadata', async () => {
      const input = {
        name: 'Solar Farm Alpha',
        country: 'US',
        methodology: 'Verra VCS',
      };

      prisma.carbonProject.create.mockResolvedValue({
        id: 'proj-1',
        projectId: 'proj-1',
        ...input,
        status: 'Pending',
        totalCreditsIssued: 0,
        totalCreditsRetired: 0,
        // ... other required fields
      });

      const result = await service.createProject(input, 'owner-key');

      expect(result.projectId).toBe('proj-1');
      expect(prisma.carbonProject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining(input),
        })
      );
    });

    it('should throw if country code is invalid', async () => {
      const input = {
        name: 'Invalid Country Project',
        country: 'XX', // Invalid
        methodology: 'Verra VCS',
      };

      await expect(service.createProject(input, 'owner-key')).rejects.toThrow(
        'Invalid country code'
      );
    });

    it('should call stellar.verifySignature for authorization', async () => {
      stellar.verifySignature.mockResolvedValue(true);

      await service.createProject(
        { name: 'Test', country: 'US', methodology: 'Verra VCS' },
        'owner-key'
      );

      expect(stellar.verifySignature).toHaveBeenCalled();
    });
  });
});
```

**Best Practices:**

1. **Test behavior, not implementation**
   ```typescript
   // ❌ Bad: Testing internal state
   expect(service['internalCache']).toEqual(...);

   // ✅ Good: Testing behavior
   expect(result).toEqual(expectedOutput);
   ```

2. **Use descriptive test names**
   ```typescript
   // ❌ Bad: Too vague
   it('works', () => { ... });

   // ✅ Good: Clear outcome
   it('should create a project with valid metadata', () => { ... });
   ```

3. **Arrange-Act-Assert pattern**
   ```typescript
   it('should retire credits', async () => {
     // Arrange
     const mockBatch = { batchId: 'batch-1', amount: 1000 };
     prisma.creditBatch.findUnique.mockResolvedValue(mockBatch);

     // Act
     const result = await service.retireCredits('batch-1', 100);

     // Assert
     expect(result.amount).toBe(100);
     expect(prisma.creditBatch.update).toHaveBeenCalled();
   });
   ```

4. **Mock external dependencies, not business logic**
   ```typescript
   // ✅ Good: Mock Prisma (external), test service logic
   prisma.creditBatch.findUnique.mockResolvedValue(batch);
   const result = await service.retireCredits(batchId, amount);
   expect(result.status).toBe('retired');

   // ❌ Bad: Mocking the thing you're trying to test
   jest.spyOn(service, 'retireCredits').mockResolvedValue({ ... });
   ```

---

### 2. Integration Tests

**Purpose:** Test multiple components working together (services, database, external APIs).

**Characteristics:**
- Slower (1-10 sec per test)
- Require real or test database
- Mock external services (APIs, RPC)
- Test data flow across layers

**Technology Stack:**
- Framework: Jest with separate config (`jest-e2e.json`)
- Database: Testcontainers or docker-compose (PostgreSQL + Redis)
- Mocking: NestJS `Test.createTestingModule()` with real providers
- Fixtures: Factory functions to seed test data

**Example (Database Integration):**

```typescript
// test/integration/projects.integration.spec.ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Projects Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Run migrations
    await prisma.$executeRawUnsafe('SELECT 1');
  });

  afterAll(async () => {
    // Clean up: delete test data
    await prisma.$transaction([
      prisma.carbonProject.deleteMany(),
      prisma.creditBatch.deleteMany(),
    ]);
    await app.close();
  });

  afterEach(async () => {
    // Clean test data between tests
    await prisma.carbonProject.deleteMany();
  });

  describe('POST /api/v1/projects', () => {
    it('should register a new project and record in database', async () => {
      const projectData = {
        name: 'Integration Test Project',
        country: 'US',
        methodology: 'Verra VCS',
        description: 'Test project',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${validToken}`)
        .send(projectData)
        .expect(201);

      // Verify response
      expect(response.body).toHaveProperty('projectId');
      expect(response.body.status).toBe('Pending');

      // Verify database
      const storedProject = await prisma.carbonProject.findUnique({
        where: { projectId: response.body.projectId },
      });
      expect(storedProject).toBeDefined();
      expect(storedProject.name).toBe(projectData.name);

      // Verify history was recorded
      const history = await prisma.carbonProjectHistory.findFirst({
        where: { projectId: response.body.projectId },
      });
      expect(history).toBeDefined();
      expect(history.ended_at).toBeNull(); // Current version
    });

    it('should prevent duplicate projectIds', async () => {
      // Create first project
      await prisma.carbonProject.create({
        data: {
          projectId: 'proj-duplicate',
          name: 'First',
          country: 'US',
          methodology: 'Verra VCS',
          // ... required fields
        },
      });

      // Try to create duplicate
      await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ projectId: 'proj-duplicate', name: 'Second', ... })
        .expect(409); // Conflict
    });

    it('should apply rate limiting (10 requests per 60 seconds)', async () => {
      for (let i = 0; i < 11; i++) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/projects')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ name: `Project ${i}`, ... });

        if (i < 10) {
          expect(response.status).toBe(201);
        } else {
          expect(response.status).toBe(429); // Too Many Requests
        }
      }
    });
  });

  describe('Temporal queries (point-in-time)', () => {
    it('should retrieve project state at a past timestamp', async () => {
      // Create project
      const project = await prisma.carbonProject.create({
        data: {
          projectId: 'temporal-test',
          name: 'Version 1',
          status: 'Pending',
          // ...
        },
      });

      // Record creation time
      const createdAt = project.createdAt;

      // Wait 100ms
      await new Promise(resolve => setTimeout(resolve, 100));

      // Update project
      await prisma.carbonProject.update({
        where: { projectId: 'temporal-test' },
        data: { status: 'Active', name: 'Version 2' },
      });

      // Query past state
      const pastState = await prisma.carbonProjectHistory.findFirst({
        where: {
          projectId: 'temporal-test',
          started_at: { lte: createdAt },
        },
        orderBy: { started_at: 'desc' },
      });

      expect(pastState.name).toBe('Version 1');
      expect(pastState.status).toBe('Pending');

      // Query current state
      const currentState = await prisma.carbonProject.findUnique({
        where: { projectId: 'temporal-test' },
      });

      expect(currentState.name).toBe('Version 2');
      expect(currentState.status).toBe('Active');
    });
  });
});
```

**Database Setup (docker-compose.test.yml):**

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: carbonledger_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6380:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
```

**Best Practices:**

1. **Isolate tests with transactions (rollback after)**
   ```typescript
   beforeEach(async () => {
     await prisma.$transaction(async (tx) => {
       // All changes in this transaction are rolled back after test
     });
   });
   ```

2. **Seed fixtures consistently**
   ```typescript
   async function seedProject() {
     return await prisma.carbonProject.create({
       data: {
         projectId: `test-${Date.now()}`,
         name: 'Test Project',
         // ...
       },
     });
   }

   it('should find project by ID', async () => {
     const project = await seedProject();
     const result = await service.findProject(project.projectId);
     expect(result).toEqual(project);
   });
   ```

3. **Test async flows and error handling**
   ```typescript
   it('should handle database connection errors', async () => {
     prisma.carbonProject.create.mockRejectedValue(
       new PrismaClientKnownRequestError('Connection failed', '2027', '15.0.0')
     );

     await expect(service.createProject(...)).rejects.toThrow(
       'Connection failed'
     );
   });
   ```

---

### 3. Contract Unit Tests (Rust + Soroban)

**Purpose:** Test Soroban contract logic in an isolated Env without RPC.

**Characteristics:**
- Fast (< 100ms per test)
- No network required
- Use `soroban_sdk::testutils::Env`
- Test state changes, events, and cross-contract calls

**Example (Credit Contract):**

```rust
// src/contracts/carbon_credit/src/lib.rs
#[cfg(test)]
mod tests {
  use super::*;
  use soroban_sdk::{testutils::*, IntoVal};

  #[test]
  fn test_mint_credits() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CreditContract);
    let credit = CreditContractClient::new(&env, &contract_id);

    let project_id = String::from_slice(&env, "proj-1");
    let batch_id = String::from_slice(&env, "batch-1");
    let amount = 1_000_000i128; // 1M credits in stroops

    // Mint credits
    credit.mint(
      project_id.clone(),
      batch_id.clone(),
      amount,
      vec![&env, String::from_slice(&env, "serial-1")],
    );

    // Query balance
    let balance = credit.balance(batch_id);
    assert_eq!(balance, amount);

    // Verify event was emitted
    let events = env.emitted_events().into_iter().collect::<Vec<_>>();
    assert!(events.iter().any(|e| {
      e.event.topics.get(0).unwrap()
        == &String::from_slice(&env, "mint").into_val(&env)
    }));
  }

  #[test]
  fn test_retire_credits() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CreditContract);
    let credit = CreditContractClient::new(&env, &contract_id);

    // Setup
    let batch_id = String::from_slice(&env, "batch-1");
    credit.mint(/* ... */);

    // Retire half the batch
    credit.retire(batch_id.clone(), 500_000);

    // Verify balance decreased
    let balance = credit.balance(batch_id);
    assert_eq!(balance, 500_000); // 1M - 500k = 500k
  }

  #[test]
  #[should_panic(expected = "InsufficientBalance")]
  fn test_retire_more_than_available() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CreditContract);
    let credit = CreditContractClient::new(&env, &contract_id);

    let batch_id = String::from_slice(&env, "batch-1");
    credit.mint(/* ... */);

    // Try to retire more than available
    credit.retire(batch_id, 2_000_000); // 2M > 1M available
  }
}
```

**Best Practices:**

1. **Test state invariants**
   ```rust
   // After every mint, balance should equal cumulative mints
   for i in 0..10 {
     contract.mint(batch_id, 100_000);
   }
   assert_eq!(contract.balance(batch_id), 1_000_000);
   ```

2. **Test event emissions**
   ```rust
   contract.retire(batch_id, 100_000);
   let events = env.emitted_events().into_iter().collect::<Vec<_>>();
   assert!(events.iter().any(|e| {
     e.event.topics.get(0) == Some(&String::from_slice(&env, "retire").into_val(&env))
   }));
   ```

3. **Test cross-contract calls**
   ```rust
   #[test]
   fn test_registry_mints_credits() {
     let env = Env::default();
     
     // Register both contracts
     let registry_id = env.register_contract(None, RegistryContract);
     let credit_id = env.register_contract(None, CreditContract);
     
     let registry = RegistryContractClient::new(&env, &registry_id);
     let credit = CreditContractClient::new(&env, &credit_id);
     
     // Registry calls credit contract
     registry.issue_credits(project_id, batch_id, amount, serial_numbers);
     
     // Verify credit was minted
     let balance = credit.balance(batch_id);
     assert_eq!(balance, amount);
   }
   ```

---

### 4. End-to-End Tests

**Purpose:** Test complete user journeys from API request to database update to event indexing.

**Characteristics:**
- Slow (5-30 sec per test)
- Test full stack: API → Service → Database → Event indexing
- Run in parallel with `--runInBand` disabled for speed
- Mock external services only (Stellar RPC, Oracle bridge)

**Example (Credit Retirement E2E):**

```typescript
// test/e2e/retirement.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import * as request from 'supertest';

describe('Credit Retirement (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Authenticate and get token
    userToken = await authenticateTestUser();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should complete a full retirement workflow', async () => {
    // Step 1: Create a project
    const projectRes = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: 'E2E Test Project',
        country: 'US',
        methodology: 'Verra VCS',
        description: 'Test project',
      })
      .expect(201);

    const { projectId } = projectRes.body;

    // Step 2: Verify project (as verifier)
    const verifierToken = await authenticateTestUser('verifier');
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ decision: 'approved', methodologyScore: 85 })
      .expect(200);

    // Step 3: Mint credit batch
    const mintRes = await request(app.getHttpServer())
      .post('/api/v1/credits/mint')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', `mint-${Date.now()}`)
      .send({
        projectId,
        amount: 1000,
        vintageYear: 2024,
        description: 'Test mint',
      })
      .expect(201);

    const { batchId, txHash } = mintRes.body;

    // Wait for event indexing (in production, this is async; for E2E we wait)
    await waitForEventIndexing(txHash);

    // Step 4: Retire credits
    const retireRes = await request(app.getHttpServer())
      .post('/api/v1/credits/retire')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', `retire-${Date.now()}`)
      .send({
        batchId,
        amount: 500,
        beneficiary: 'Test Corp',
        reason: 'ESG Commitment',
      })
      .expect(201);

    const { retirementId, certificateUrl } = retireRes.body;

    // Step 5: Wait for certificate generation
    await waitForCertificateGeneration(retirementId);

    // Step 6: Verify retirement in database
    const retirement = await prisma.retirementRecord.findUnique({
      where: { retirementId },
      include: { certificate: true },
    });

    expect(retirement).toBeDefined();
    expect(retirement.status).toBe('retired');
    expect(retirement.amount).toBe(500);
    expect(retirement.certificateStatus).toBe('generated');
    expect(retirement.certificate).toBeDefined();

    // Step 7: Verify certificate signature
    const certRes = await request(app.getHttpServer())
      .get(`/api/v1/certificates/${retirement.certificateContentCid}/verify`)
      .expect(200);

    expect(certRes.body.valid).toBe(true);

    // Step 8: Verify temporal history was recorded
    const history = await prisma.retirementRecordHistory.findMany({
      where: { retirementId },
      orderBy: { started_at: 'asc' },
    });

    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].ended_at).toBeNull(); // Current version
  });

  it('should prevent double-retirement with idempotency key', async () => {
    const idempotencyKey = `retire-idempotent-${Date.now()}`;

    // First request
    const res1 = await request(app.getHttpServer())
      .post('/api/v1/credits/retire')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ batchId: 'batch-1', amount: 100, ... })
      .expect(201);

    // Identical retry
    const res2 = await request(app.getHttpServer())
      .post('/api/v1/credits/retire')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ batchId: 'batch-1', amount: 100, ... })
      .expect(201);

    // Should get same response (cached)
    expect(res2.body).toEqual(res1.body);

    // Different body with same key should fail
    await request(app.getHttpServer())
      .post('/api/v1/credits/retire')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ batchId: 'batch-2', amount: 200, ... }) // Different batch
      .expect(422); // Unprocessable Entity
  });

  it('should handle webhook delivery on retirement', async () => {
    // Subscribe to retirement events
    const webhookUrl = 'https://webhook-test-receiver.example.com/retirements';
    await createWebhookSubscription(userToken, webhookUrl, ['retirement.confirmed']);

    // Retire credits
    const retireRes = await request(app.getHttpServer())
      .post('/api/v1/credits/retire')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ batchId: 'batch-1', amount: 100, ... })
      .expect(201);

    // Wait for webhook delivery
    const deliveryLog = await waitForWebhookDelivery(webhookUrl);

    expect(deliveryLog.success).toBe(true);
    expect(deliveryLog.statusCode).toBe(200);
    const payload = JSON.parse(deliveryLog.responseBody);
    expect(payload.eventType).toBe('retirement.confirmed');
    expect(payload.retirementId).toBe(retireRes.body.retirementId);
  });
});

// Helper functions
async function authenticateTestUser(role = 'project_developer') {
  const publicKey = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const signature = 'MEUC...'; // Ed25519 signature

  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/verify')
    .send({ publicKey, signature, nonce: 'test-nonce', role })
    .expect(200);

  return res.body.access_token;
}

async function waitForEventIndexing(txHash: string, timeoutMs = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const events = await prisma.creditEvent.findMany({
      where: { txHash },
    });
    if (events.length > 0) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Event indexing timeout for txHash: ${txHash}`);
}

async function waitForCertificateGeneration(retirementId: string, timeoutMs = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const retirement = await prisma.retirementRecord.findUnique({
      where: { retirementId },
    });
    if (retirement?.certificateStatus === 'generated') return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Certificate generation timeout for retirement: ${retirementId}`);
}
```

**Best Practices:**

1. **Isolate E2E tests from each other**
   ```typescript
   afterEach(async () => {
     // Delete test data after each test so tests don't interfere
     await prisma.retirementRecord.deleteMany();
     await prisma.creditBatch.deleteMany();
   });
   ```

2. **Mock external services (don't call real RPC)**
   ```typescript
   jest.mock('../src/stellar/stellar.service', () => ({
     StellarService: jest.fn(() => ({
       submitTransaction: jest.fn().mockResolvedValue({ txHash: 'test-hash' }),
       getEvents: jest.fn().mockResolvedValue([]),
     })),
   }));
   ```

3. **Test error flows**
   ```typescript
   it('should fail gracefully on invalid retirement amount', async () => {
     const res = await request(app.getHttpServer())
       .post('/api/v1/credits/retire')
       .set('Authorization', `Bearer ${userToken}`)
       .send({ batchId: 'batch-1', amount: -100 })
       .expect(400);

     expect(res.body.error).toBe('Amount must be positive');
   });
   ```

---

### 5. Property-Based Testing (Advanced)

**Purpose:** Generate random inputs and verify that system invariants always hold.

**Use case:** Validate that after any sequence of mints, retirements, and transfers, the sum of all credit balances equals the total issued.

**Technology:** `fast-check` library

```typescript
import fc from 'fast-check';

describe('Credit invariants (property-based)', () => {
  it('should maintain conservation of credits (total minted = retired + remaining)', () => {
    const arbCreditOperations = fc.array(
      fc.oneof(
        fc.record({
          type: fc.constant('mint'),
          amount: fc.integer({ min: 1, max: 10_000_000 }),
        }),
        fc.record({
          type: fc.constant('retire'),
          amount: fc.integer({ min: 1, max: 1_000_000 }),
        })
      ),
      { minLength: 1, maxLength: 100 }
    );

    fc.assert(
      fc.property(arbCreditOperations, (operations) => {
        let totalMinted = 0;
        let totalRetired = 0;

        for (const op of operations) {
          if (op.type === 'mint') {
            totalMinted += op.amount;
          } else if (op.type === 'retire' && op.amount <= totalMinted - totalRetired) {
            totalRetired += op.amount;
          }
        }

        // Invariant: remaining = minted - retired (always >= 0)
        const remaining = totalMinted - totalRetired;
        expect(remaining).toBeGreaterThanOrEqual(0);
        expect(remaining + totalRetired).toBe(totalMinted);
      })
    );
  });
});
```

---

## Coverage Targets

### Backend (NestJS)

```
Lines:       ≥ 80%
Branches:    ≥ 80%
Functions:   ≥ 80%
Statements:  ≥ 80%
```

**Execution:**
```bash
npm run test:coverage
# Output: coverage/index.html (open in browser)
```

**Files to prioritize (highest impact):**
- `src/projects/projects.service.ts` — core business logic
- `src/credits/credits.service.ts` — credit lifecycle
- `src/retirements/retirements.service.ts` — retirement logic
- `src/auth/auth.service.ts` — authentication
- `src/temporal/temporal.service.ts` — history tracking

**Acceptable exclusions:**
- Controllers (HTTP layer is tested via E2E)
- Error handling stubs (rare, platform-specific errors)
- Logging (not business critical)

### Contracts (Rust/Soroban)

```
Lines:       ≥ 90%
Branches:    ≥ 85%
Functions:   ≥ 90%
```

**Rationale:** Smart contracts are immutable once deployed; higher coverage is essential.

**Coverage tracking:**
```bash
cargo tarpaulin --out Html --output-dir coverage/
```

### Frontend (React/TypeScript)

```
Lines:       ≥ 70%
Branches:    ≥ 65%
Functions:   ≥ 70%
Statements:  ≥ 70%
```

**Rationale:** UI is less critical than backend; coverage > 70% catches major breaks.

---

## Running Tests

### Local Development

```bash
# Run all unit tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Run contracts tests
cd packages/contracts && cargo test

# Run full suite (backend + contracts + frontend)
./scripts/test-all.sh
```

### CI/CD Pipeline

```bash
# In GitHub Actions (/.github/workflows/ci.yml)
- npm run test -- --ci --coverage
- npm run test:e2e -- --ci
- cargo test --release

# After tests pass:
- Upload coverage to Codecov
- Post comment on PR with coverage delta
```

---

## Debugging Failing Tests

### Common Issues

**1. Flaky timing (setTimeout, async issues)**
```typescript
// ❌ Bad: Might timeout
it('should process event', async () => {
  service.processEvent(event);
  // Event processed asynchronously; test might finish before it completes
});

// ✅ Good: Wait for completion
it('should process event', async () => {
  const processed = new Promise(resolve => 
    service.onEventProcessed(() => resolve())
  );
  service.processEvent(event);
  await processed; // Wait for callback
});
```

**2. Mock not applied (order matters)**
```typescript
// ❌ Bad: Mock after import
const module = require('./service');
jest.mock('./dependency'); // Too late!

// ✅ Good: Mock before import
jest.mock('./dependency');
const module = require('./service');
```

**3. Database not cleaned up**
```typescript
// ❌ Bad: Test B sees data from Test A
afterEach(() => {
  // Forgot to clean up
});

// ✅ Good: Explicit cleanup
afterEach(async () => {
  await prisma.$transaction([
    prisma.retirementRecord.deleteMany(),
    prisma.creditBatch.deleteMany(),
    prisma.carbonProject.deleteMany(),
  ]);
});
```

### Debug Commands

```bash
# Run single test file
npx jest projects.service.spec.ts

# Run tests matching pattern
npx jest --testNamePattern="should retire"

# Run with verbose output
npx jest --verbose

# Inspect with debugger
node --inspect-brk node_modules/.bin/jest --runInBand
# Then open chrome://inspect in Chrome DevTools

# Print test timeline (useful for slow tests)
npx jest --detectOpenHandles
```

---

## Test Data and Factories

Create reusable test data factories to avoid repetition:

```typescript
// test/factories/project.factory.ts
export const createTestProject = (overrides = {}) => ({
  projectId: `proj-${Date.now()}`,
  name: 'Test Project',
  country: 'US',
  methodology: 'Verra VCS',
  status: 'Active',
  totalCreditsIssued: 1000,
  totalCreditsRetired: 0,
  ...overrides,
});

export const createTestBatch = (projectId: string, overrides = {}) => ({
  batchId: `batch-${Date.now()}`,
  projectId,
  vintageYear: 2024,
  amount: 1000,
  serialStart: 'serial-1',
  serialEnd: 'serial-1000',
  status: 'Active',
  ...overrides,
});

// Usage in tests
it('should retire half a batch', async () => {
  const project = createTestProject();
  const batch = createTestBatch(project.projectId);

  const result = await service.retireCredits(batch.batchId, 500);
  expect(result.amount).toBe(500);
});
```

---

## Continuous Integration

### GitHub Actions Workflow

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        env:
          POSTGRES_DB: carbonledger_test
          POSTGRES_PASSWORD: test

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test -- --ci --coverage

      - name: Run E2E tests
        run: npm run test:e2e -- --ci
        env:
          DATABASE_URL: postgresql://postgres:test@postgres:5432/carbonledger_test

      - name: Run contract tests
        run: cd packages/contracts && cargo test --release

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

      - name: Comment coverage on PR
        if: github.event_name == 'pull_request'
        uses: romeovs/lcov-reporter-action@v0.3.1
        with:
          lcov-file: ./coverage/lcov.info
```

---

## Further Reading

- **Jest Documentation:** https://jestjs.io/docs/getting-started
- **NestJS Testing:** https://docs.nestjs.com/fundamentals/testing
- **Soroban Testing:** https://soroban.stellar.org/docs/learn/testing
- **Testing Best Practices:** https://testingjavascript.com
- **Property-Based Testing:** https://hypothesis.works
