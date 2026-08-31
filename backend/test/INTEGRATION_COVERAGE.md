# Backend API Integration Test Coverage (issue #1050)

Traceability matrix for **issue #1050 — Add Integration Tests for Backend API**.
The suite runs against a real PostgreSQL database and the NestJS testing module
(`@nestjs/testing` + `supertest`); the blockchain provider is swapped for
`MockBlockchainProvider` so no live Stellar network is required.

## How to run

```bash
# One-shot (spins up the throwaway Postgres + Redis, migrates, runs the suite):
npm run test:db:up
npm run test:db:migrate
npm run test:integration          # jest --config ./test/jest-e2e.json --runInBand --coverage --forceExit
npm run test:db:down

# CI entrypoint (adds JUnit reporter):
npm run test:integration:ci
```

CI job: `.github/workflows/backend-integration.yml` — runs on every PR touching
`backend/**`, provisions `postgres:16` + `redis:7` service containers, migrates
with `prisma migrate deploy`, seeds sample data per test, and fails the build if
line coverage drops below 80 %.

## Acceptance criteria → evidence

| # | Criterion | Where it is satisfied |
|---|-----------|-----------------------|
| 1 | All endpoints have integration tests | Auth: `auth.e2e-spec.ts`, `auth-refresh-cookie.e2e-spec.ts`, `rbac.e2e-spec.ts`. Projects: `projects.e2e-spec.ts`. Credits: `credits.e2e-spec.ts`, `credit-lifecycle.e2e-spec.ts`. Marketplace: `marketplace.e2e-spec.ts`. Retirement / certificates: `retirement.e2e-spec.ts`, `certificate.e2e-spec.ts`, `certificate-cid-verify.e2e-spec.ts`. Webhooks: `webhook.e2e-spec.ts`. Cross-surface smoke: `integration-coverage.e2e-spec.ts`. |
| 2 | Test database seeded with sample data | `test-helpers.ts` → `seedTestData()` creates users (corporation / verifier / admin), a `carbonProject` (`PROJ001`), a `creditBatch` (`BATCH001`), and a `retirementRecord` (`RET001`) before every test. |
| 3 | Tests cover success and error responses | Success paths asserted throughout; error paths in `error-handling-404.e2e-spec.ts` (404 contract across every resource), `rbac.e2e-spec.ts` (401/403), `auth.e2e-spec.ts` (invalid nonce/signature → 401), and negative cases inside each controller spec. |
| 4 | Database cleanup after each test | `test-helpers.ts` → `cleanDatabase()` truncates every table in FK-safe order and resets the mock provider; invoked in `beforeEach`/`afterAll` of each spec. |
| 5 | Test command: `npm run test:integration` | Defined in `backend/package.json`; wired into `backend-integration.yml` via `test:integration:ci`. |

## Endpoint group → spec

| Endpoint group | Primary spec(s) | Notable cases |
|----------------|-----------------|---------------|
| `POST /auth/nonce`, `POST /auth/verify`, refresh cookie | `auth.e2e-spec.ts`, `auth-refresh-cookie.e2e-spec.ts` | nonce issuance, signature verification, invalid nonce → 401, refresh rotation at the real `/api/v1` prefix |
| `GET /projects`, `GET /projects/:id`, `POST /projects*` | `projects.e2e-spec.ts` | list + filter, unknown id → 404, role-guarded writes |
| `GET /credits/*`, lifecycle transitions | `credits.e2e-spec.ts`, `credit-lifecycle.e2e-spec.ts` | batch lookup, unknown batch → 404, Active → PartiallyRetired → FullyRetired state machine |
| `GET /marketplace/listings`, `GET /marketplace/listings/:id`, `GET /marketplace/search` | `marketplace.e2e-spec.ts` | listing index, single listing, unknown listing → 404 |
| `POST /credits/retire`, `GET /retirements*` | `retirement.e2e-spec.ts` | retirement submission, auth-required list → 401 |
| `GET /certificate/*`, CID verification | `certificate.e2e-spec.ts`, `certificate-cid-verify.e2e-spec.ts` | certificate generation + retrieval, on-chain CID match (#600) |
| `POST /webhooks/*` | `webhook.e2e-spec.ts` | signed satellite webhook auth + payload handling |
| RBAC across all guarded routes | `rbac.e2e-spec.ts` | corporation / verifier / admin scoping, 401 without token, 403 on wrong role |
| Cross-surface smoke (health, projects, credits, marketplace, auth, retirements, verifiers) | `integration-coverage.e2e-spec.ts` | one assertion per surface so a broken module fails fast |
