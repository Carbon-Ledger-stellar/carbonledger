# Access Control Policy Documentation

> **Policy engine:** [CASL](https://casl.js.org/) v6 — Attribute-Based Access Control (ABAC)  
> **Location:** `backend/src/policies/`  
> **Last updated:** 2026-07

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Roles](#roles)
- [Resources (Subjects)](#resources-subjects)
- [Actions](#actions)
- [Policy Matrix](#policy-matrix)
- [Conditional (Attribute-Based) Rules](#conditional-attribute-based-rules)
- [How Guards Work Together](#how-guards-work-together)
- [How to Use in a Controller](#how-to-use-in-a-controller)
- [How to Extend Policies](#how-to-extend-policies)
- [Testing Policies](#testing-policies)
- [Design Decisions](#design-decisions)

---

## Overview

CarbonLedger uses **Attribute-Based Access Control (ABAC)** expressed via the CASL library. Every permission decision answers the question:

> **Can user with role _X_ perform action _Y_ on resource _Z_ when attribute _W_ is true?**

This replaces the previous RBAC-only approach where:
- `@Roles('corporation')` checked the role but not resource ownership
- Inline `if (resource.owner !== req.user.publicKey)` checks scattered throughout controllers made authorization logic hard to audit

All permission logic now lives in a single file: `src/policies/ability.factory.ts`.

---

## Architecture

```
src/policies/
├── types.ts                    # Action vocabulary, Subject classes, AppAbility type
├── ability.factory.ts          # Single source of truth — builds AppAbility per user
├── check-policies.decorator.ts # @CheckPolicies() decorator for route handlers
├── policies.guard.ts           # NestJS guard that evaluates @CheckPolicies() handlers
├── policies.module.ts          # NestJS module — import in feature modules
├── index.ts                    # Barrel exports
└── __tests__/
    ├── ability.factory.spec.ts  # All roles × resources × positive/negative cases
    ├── policies.guard.spec.ts   # Guard skip, allow, deny, missing user
    └── policy-scenarios.spec.ts # IDOR scenarios, owner scoping, status conditions
```

### Request lifecycle

```
HTTP Request
    │
    ▼
RolesGuard (APP_GUARD — global)
    │  ├─ Verifies JWT signature
    │  ├─ Loads user from DB (role from DB, not JWT)
    │  ├─ Attaches user to req.user
    │  └─ Checks @Roles() — coarse role gate
    │
    ▼
PoliciesGuard (@UseGuards(PoliciesGuard) per route)
    │  ├─ Reads @CheckPolicies() handlers
    │  ├─ Builds AppAbility for req.user via AbilityFactory
    │  └─ Evaluates each handler — throws ForbiddenException if any fails
    │
    ▼
Controller method
```

> **Important:** `PoliciesGuard` runs *after* `RolesGuard`. It relies on `req.user` being already set. Always use `@Roles()` alongside `@CheckPolicies()` to ensure the coarse role gate fires first.

---

## Roles

| Role | Description |
|------|-------------|
| `admin` | Unrestricted access to all resources and actions |
| `verifier` | Reads and approves/rejects carbon projects; read-only on credits |
| `project_developer` | Creates and manages own projects; uploads documents; lists credits for sale |
| `corporation` | Purchases and retires credits; exports own ESG reports; manages own listings |
| `public` | Unauthenticated/anonymous — read-only on verified projects, public audit trail |

---

## Resources (Subjects)

Each subject maps to a domain entity from the Prisma schema. Subject classes are defined in `src/policies/types.ts`.

| Subject Class | Prisma Model | Key Attributes |
|---------------|-------------|----------------|
| `ProjectSubject` | `CarbonProject` | `ownerAddress`, `status` |
| `CreditBatchSubject` | `CreditBatch` | `projectId` |
| `RetirementSubject` | `RetirementRecord` | `retiredBy` |
| `MarketListingSubject` | `MarketListing` | `seller` |
| `OracleDataSubject` | `MonitoringData` / `OracleJob` | — |
| `UserSubject` | `User` | `publicKey` |
| `AuditLogSubject` | `AuditLog` | — |
| `UploadSubject` | `IPFSFile` | `uploaderPublicKey` |
| `ExportSubject` | (derived — export operations) | — |
| `StatsSubject` | (derived — stats queries) | — |
| `NotificationSubject` | `NotificationPreference` | `ownerPublicKey` |
| `ZkProofSubject` | `ZkRetirementProof` | `retiredBy` |

---

## Actions

| Action | Meaning |
|--------|---------|
| `manage` | Wildcard — all actions (admin only) |
| `create` | Create a new resource |
| `read` | Read / list a resource |
| `update` | Modify an existing resource |
| `delete` | Remove a resource |
| `verify` | Verifier approves a project |
| `reject` | Verifier rejects a project |
| `mint` | Admin mints a new credit batch |
| `retire` | Corporation retires credits on-chain |
| `list` | List credits for sale in the marketplace |
| `delist` | Remove a listing from the marketplace |
| `purchase` | Buy credits from a marketplace listing |
| `export` | Export data (CSV/PDF) |
| `ingest` | Oracle ingest (monitoring data / price feed) |
| `hold` | Admin places a price update on hold |
| `approve` | Admin approves a held price update |
| `generateProof` | Corporation generates a ZK retirement proof |
| `assignRole` | Admin assigns a role to a user |
| `reindex` | Admin triggers a re-index of on-chain data |

---

## Policy Matrix

> ✅ = allowed &nbsp; ❌ = denied &nbsp; 🔑 = conditional (see next section)

### Projects

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `create` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `read` | ✅ | ✅ | ✅ | ✅ | 🔑 status=Verified |
| `update` | ✅ | ❌ | 🔑 own | ❌ | ❌ |
| `verify` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `reject` | ✅ | ✅ | ❌ | ❌ | ❌ |

### Credits / Batches

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `mint` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `retire` | ✅ | ❌ | ❌ | ✅ | ❌ |

### Retirements

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `read` | ✅ | ❌ | ❌ | 🔑 own | ✅ (audit trail) |
| `export` | ✅ | ❌ | ❌ | 🔑 own | ❌ |

### ZK Proofs

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `generateProof` | ✅ | ❌ | ❌ | 🔑 own | ❌ |
| `read` | ✅ | ❌ | ❌ | 🔑 own | ❌ |

### Marketplace Listings

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `read` | ✅ | ❌ | ✅ | ✅ | ✅ |
| `list` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `delist` | ✅ | ❌ | 🔑 own | 🔑 own | ❌ |
| `purchase` | ✅ | ❌ | ❌ | ✅ | ❌ |

### Users / Verifiers

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `read` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `create` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `update` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `delete` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `assignRole` | ✅ | ❌ | ❌ | ❌ | ❌ |

### Audit Logs

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `read` | ✅ | ✅ | ❌ | ❌ | ❌ |

### Oracle Data

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `read` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `hold` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `approve` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `reject` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `ingest` | ✅ | ❌ | ❌ | ❌ | ❌ (OracleGuard) |

### Uploads

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `create` | ✅ | ❌ | ✅ | ✅ | ❌ |
| `read` | ✅ | ❌ | ✅ | ✅ | ✅ (by CID) |

### Export

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `export` | ✅ | ❌ | ❌ | ✅ | ❌ |

### Stats

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `read` | ✅ | ✅ | ✅ | ✅ | ✅ |

### Notifications

| Action | admin | verifier | project_developer | corporation | public |
|--------|:-----:|:--------:|:-----------------:|:-----------:|:------:|
| `read` | ✅ | ❌ | 🔑 own | 🔑 own | ❌ |
| `update` | ✅ | ❌ | 🔑 own | 🔑 own | ❌ |

---

## Conditional (Attribute-Based) Rules

The following rules use **resource attributes** (the "A" in ABAC) to scope permissions beyond the role:

### Retirement ownership (`retiredBy`)

```typescript
// In AbilityFactory (corporation role):
can('read',    RetirementSubject, { retiredBy: user.publicKey });
can('export',  RetirementSubject, { retiredBy: user.publicKey });
```

**In the controller:**
```typescript
const retirement = await this.retirementsService.findOne(id);
const ability = this.abilityFactory.createForUser(req.user);
if (ability.cannot('read', subject(RetirementSubject, { retiredBy: retirement.retiredBy }))) {
  throw new ForbiddenException('Access denied');
}
```

### Marketplace delist IDOR (`seller`)

```typescript
// In AbilityFactory (corporation role):
can('delist', MarketListingSubject, { seller: user.publicKey });
```

**In the controller:**
```typescript
const listing = await this.marketplaceService.findOne(id);
const ability = this.abilityFactory.createForUser(req.user);
if (ability.cannot('delist', subject(MarketListingSubject, { seller: listing.seller }))) {
  throw new ForbiddenException('You can only delist your own listings');
}
```

### ZK proof ownership (`retiredBy`)

```typescript
// In AbilityFactory (corporation role):
can('generateProof', ZkProofSubject, { retiredBy: user.publicKey });
can('read',          ZkProofSubject, { retiredBy: user.publicKey });
```

### Notification preferences (`ownerPublicKey`)

```typescript
// In AbilityFactory (corporation / project_developer roles):
can('read',   NotificationSubject, { ownerPublicKey: user.publicKey });
can('update', NotificationSubject, { ownerPublicKey: user.publicKey });
```

### Project ownership (`ownerAddress`)

```typescript
// In AbilityFactory (project_developer role):
can('update', ProjectSubject, { ownerAddress: user.publicKey });
```

### Public project status (`status`)

```typescript
// In AbilityFactory (public role):
can('read', ProjectSubject, { status: 'Verified' });
```

---

## How Guards Work Together

### Two-layer model

1. **RolesGuard** (global `APP_GUARD`) — coarse-grained. Validates JWT, loads `req.user` from DB, checks `@Roles()` decoration. All controllers benefit automatically.

2. **PoliciesGuard** — fine-grained. Evaluates `@CheckPolicies()` handlers using the built `AppAbility`. Applied per-route via `@UseGuards(PoliciesGuard)`.

### OracleGuard (separate concern)

Oracle ingest endpoints (`POST /oracle/ingest/*`) use a completely separate authentication mechanism: an **Ed25519 Stellar keypair signature** (not JWT). These routes use `@Public()` to bypass RolesGuard, and `@UseGuards(OracleGuard)` to verify the oracle's cryptographic signature. No CASL policy applies here.

---

## How to Use in a Controller

### 1. Import PoliciesModule in your feature module

```typescript
// my-feature/my-feature.module.ts
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [AuthModule, PoliciesModule],
  ...
})
export class MyFeatureModule {}
```

### 2. Decorate your route

```typescript
import { UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, CreditBatchSubject } from '../policies';

@Post('mint')
@Roles('admin')
@UseGuards(PoliciesGuard)
@CheckPolicies((ability) => ability.can('mint', CreditBatchSubject))
mint(@Body() dto: MintCreditsDto) { ... }
```

### 3. For attribute-based checks (after loading the resource)

```typescript
import { AbilityFactory } from '../policies/ability.factory';
import { subject } from '@casl/ability';

@Get(':id')
async findOne(@Param('id') id: string, @Request() req: any) {
  const retirement = await this.retirementsService.findOne(id);
  const ability = this.abilityFactory.createForUser(req.user);
  if (ability.cannot('read', subject(RetirementSubject, { retiredBy: retirement.retiredBy }))) {
    throw new ForbiddenException('Access denied');
  }
  return retirement;
}
```

> **Why not `@CheckPolicies()` here?** The `@CheckPolicies()` decorator runs before the handler executes, so the resource hasn't been loaded yet. When an ownership check requires a DB value, use `AbilityFactory` directly inside the handler after loading the resource.

---

## How to Extend Policies

### Adding a new resource

1. Add a new subject class to `src/policies/types.ts`:

```typescript
export class NewResourceSubject {
  ownerPublicKey: string;
}
```

2. Add it to the `Subjects` union type in `types.ts`.

3. Add rules to `ability.factory.ts`:

```typescript
case 'corporation':
  can('create', NewResourceSubject);
  can('read', NewResourceSubject, { ownerPublicKey: user.publicKey });
  break;
```

4. Add `@CheckPolicies()` decoration to the new controller routes.

5. Add unit tests to `ability.factory.spec.ts` and `policy-scenarios.spec.ts`.

### Adding a new action

1. Add it to the `Action` union in `types.ts`:

```typescript
export type Action = ... | 'myNewAction';
```

2. Add the rule in `ability.factory.ts` for the appropriate role(s).

3. Use it in a `@CheckPolicies()` handler:

```typescript
@CheckPolicies((ability) => ability.can('myNewAction', SomeSubject))
```

### Adding a new role

1. Add the role literal to `AuthenticatedUser` in `types.ts` and to `UserRole` in `auth/decorators.ts`.

2. Add a `case 'newRole':` block in `ability.factory.ts`.

3. Update DB schema and seed data.

4. Add tests for the new role in `ability.factory.spec.ts`.

---

## Testing Policies

Tests live in `src/policies/__tests__/`:

| File | Covers |
|------|--------|
| `ability.factory.spec.ts` | All roles × resources × positive/negative cases |
| `policies.guard.spec.ts` | Guard skip (public), allow (handlers pass), deny (handlers fail), missing user |
| `policy-scenarios.spec.ts` | Ownership scoping (retirement, ZK proof, notifications, listings, projects) |

Running the policy tests in isolation:

```bash
cd backend
npx jest src/policies --no-coverage
```

---

## Design Decisions

### Why CASL?

CASL is the most widely adopted ABAC library for NestJS/TypeScript. It provides:
- A fluent builder API (`can()` / `cannot()`)
- Mongo-style conditions for attribute matching
- TypeScript generics for type-safe subject/action definitions
- No runtime dependencies on a policy engine server

### Why not a global PoliciesGuard?

Making `PoliciesGuard` global (via `APP_GUARD`) would require every route to declare `@CheckPolicies()` or be marked `@Public()`. This would break existing routes without explicit policies. Instead, PoliciesGuard is applied per-route with `@UseGuards(PoliciesGuard)`, making adoption incremental and explicit.

### Why keep RolesGuard?

`RolesGuard` is the existing coarse-grained gate. It handles:
- JWT validation
- Loading `req.user` from the database (role comes from DB, not JWT payload)
- `@Roles()` decoration for fast role-level rejection

`PoliciesGuard` adds the fine-grained layer on top. Both guards complement each other.

### Why inline `ForbiddenException` for attribute checks?

For post-load ownership checks (e.g., `retirement.retiredBy`), the resource must be fetched from the DB first. CASL conditions are evaluated at the time `ability.cannot()` is called — so calling it with the loaded resource attributes works correctly. Using `subject(SubjectClass, resourceInstance)` attaches the correct subject type for CASL to evaluate conditions against.
