# Security Regression Tests

**Directory:** `tests/security-regressions/`  
**CI gate:** Required check — these tests must pass on every PR to `main` or `develop`.

---

## Purpose

Every vulnerability found and patched in CarbonLedger has a corresponding regression
test in this directory. The tests are organised by vulnerability category (matching
the audit scope in `AUDIT_SCOPE.md`) and prevent the same bug from being reintroduced
by future changes.

**Rule:** When a security patch is merged, a corresponding regression test must be added
in the same PR. This is enforced by the PR template at `.github/pull_request_template.md`.

---

## Test Inventory

### Category 1 — Reentrancy (`reentrancy.spec.ts`)

| Test ID | Finding | Description |
|---|---|---|
| REG-001 | Audit §3.1 | `purchase_credits` does not mutate listing state after USDC transfer |
| REG-002 | Audit §3.1 | `bulk_purchase` loop cannot partially update listings mid-execution |
| REG-003 | Audit §3.1 | Checks-effects-interactions order is enforced in marketplace contract |

### Category 2 — Authorization (`authorization.spec.ts`)

| Test ID | Finding | Description |
|---|---|---|
| REG-004 | Audit §3.2 | Arbitrary caller cannot mint credits (admin-only gate) |
| REG-005 | Audit §3.2 | Verifier cannot self-approve a project they submitted |
| REG-006 | Audit §3.2 | `delist_credits` rejects non-seller callers |
| REG-007 | Audit §3.2 | `initialize()` cannot be called a second time (re-init guard) |
| REG-008 | Audit §3.2 | Oracle update endpoint rejects non-oracle callers |

### Category 3 — Integer Overflow / Underflow (`overflow.spec.ts`)

| Test ID | Finding | Description |
|---|---|---|
| REG-009 | Audit §3.3 | `total_cost = price × amount` is guarded against overflow |
| REG-010 | Audit §3.3 | `batch.amount - retired` cannot underflow below zero |
| REG-011 | Audit §3.3 | Protocol fee calculation handles zero-amount edge case |

### Category 4 — Serial Number / Double-Counting (`serial-collision.spec.ts`)

| Test ID | Finding | Description |
|---|---|---|
| REG-012 | Audit §3.4 | Exact duplicate serial range is rejected |
| REG-013 | Audit §3.4 | Partial overlap serial range is rejected |
| REG-014 | Audit §3.4 | Contained serial range (new inside existing) is rejected |
| REG-015 | Audit §3.4 | Reverse-contained serial range (new wraps existing) is rejected |
| REG-016 | Audit §3.4 | Single-credit batch (`serial_start == serial_end`) is accepted |
| REG-017 | Audit §3.4 | `serial_end < serial_start` is rejected as invalid range |

### Category 5 — Additional Findings (`additional-findings.spec.ts`)

| Test ID | Finding | Description |
|---|---|---|
| REG-018 | Audit §4 (listing collision) | Duplicate `listing_id` is rejected by the backend |
| REG-019 | Audit §4 (oracle SPOF) | Oracle update is rejected without valid oracle credentials |
| REG-020 | Audit §4 (holder check) | Backend validates credit holder before allowing retirement |

---

## Running the Tests

```bash
# All security regression tests
cd backend
npx jest --testPathPattern="../../tests/security-regressions"

# A single category
npx jest --testPathPattern="../../tests/security-regressions/reentrancy"
```

In CI these are run as part of the `security-regression-tests` job, which is a required
check on every PR and must pass before merge.

---

## Adding New Regression Tests

When a security fix is merged:

1. Identify the category (reentrancy / authorization / overflow / serial / additional)
2. Add a test in the appropriate file in this directory
3. Comment the test with `// REG-NNN: <link to issue or audit finding>`
4. Update the table above with the new test ID and description
5. Ensure the test **fails** on the unfixed code and **passes** on the fixed code

**PR Template reminder:** `.github/pull_request_template.md` includes a checklist item:
- [ ] Security patch: added corresponding regression test in `tests/security-regressions/`

---

## CI Integration

The `security-regression-tests` job in `.github/workflows/ci.yml`:
- Runs on every PR to `main` and `develop`
- Is listed as a required status check (branch protection)
- Cannot be bypassed or skipped
- Runs in isolation with a dedicated test database

---

## Test File Layout

```
tests/security-regressions/
├── README.md                  ← This file
├── reentrancy.spec.ts         ← REG-001–003: Reentrancy checks
├── authorization.spec.ts      ← REG-004–008: Authorization checks
├── overflow.spec.ts           ← REG-009–011: Integer overflow/underflow
├── serial-collision.spec.ts   ← REG-012–017: Serial number collision
└── additional-findings.spec.ts← REG-018–020: Other audit findings
```
