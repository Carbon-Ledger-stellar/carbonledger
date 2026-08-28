# ADR-010: API Design and Versioning Strategy

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-08-28 |
| Deciders | API Architecture, Backend Team |

## Context

CarbonLedger exposes multiple classes of APIs:

1. **Public API** — read-only access for marketplace browsing, project discovery (low-cost rate limiting)
2. **Authenticated API** — write operations for project registration, credit minting, retirement
3. **Oracle API** — ingest endpoints for off-chain bridge (signature-guarded)
4. **Webhook API** — event subscriptions for corporate platforms

Without clear versioning and compatibility guarantees, breaking changes cascade into client applications. We need a strategy that balances:
- Ease of evolution (add fields without versioning burden)
- Backwards compatibility (old clients continue working)
- Clear deprecation path (graceful migration for breaking changes)

## Decision

Use **header-based API versioning** with optional backwards-compatibility for non-breaking changes.

### Versioning Scheme

- **No version required** for stable endpoints (marketplace read, project search) — these are stable
- **Optional Accept-Version header** (e.g., `Accept-Version: 1`) for future versions
- **Path-based versioning only if** a breaking change is unavoidable (e.g., `/api/v2/credits/*` if v1 retire schema changes fundamentally)
- **Semantic versioning** in release notes: MAJOR.MINOR.PATCH

### Non-Breaking Changes (No Version Bump)

✅ Add new optional fields to response DTOs  
✅ Add new optional query parameters  
✅ Add new endpoints  
✅ Widen validation (accept more input)  
✅ Narrow responses (fewer required fields)  

### Breaking Changes (Path Version Bump)

❌ Remove a field from a response  
❌ Rename a field  
❌ Change field type (e.g., Decimal → String)  
❌ Tighten validation (reject previously valid input)  
❌ Change semantics of an existing field  

### Implementation

**OpenAPI/Swagger:**
- Maintain a single OpenAPI spec (backend/docs/openapi.json)
- Document all endpoints with clear response schemas
- Mark deprecated fields with `deprecated: true` and `x-deprecationMessage`
- Generate TypeScript client from spec

**Deprecation Timeline:**
1. Release field/endpoint as deprecated (v1.2.0)
2. Announce in release notes with migration guide
3. Support deprecated features for ≥3 releases (~6-12 months)
4. Remove deprecated features in major version bump

**Rate Limiting by API Class:**
| Endpoint | Rate Limit | Rationale |
|----------|-----------|-----------|
| Public project/marketplace | 100 req/60s per IP | High volume, no auth needed |
| Public API key endpoints | 1000 req/24h per key | Corporate integrations |
| Auth (verify/challenge) | 5-10 req/60s per IP | Security gate, prevent brute force |
| Retire credits | 10 req/60s per user | Economically sensitive, prevent spam |
| Default authenticated | 60 req/60s per user | Standard tier |

## Consequences

### Positive

- **Loose coupling** — clients can upgrade at their own pace
- **Clear contracts** — OpenAPI spec is source of truth for client expectations
- **Graceful evolution** — can add fields/endpoints without versioning
- **Deprecation path** — breaking changes have a clear migration window

### Negative

- **Backward compat burden** — old field/endpoint support multiplies code paths
- **Testing complexity** — must test multiple API versions in parallel
- **Client confusion** — without clear guidance, clients may use deprecated features
- **Schema explosion** — many optional fields make types harder to reason about

### Mitigation

- Use Zod/class-validator to separate "accepted input" from "schema"
- Automation: run OpenAPI diff on CI to catch breaking changes
- Document deprecation clearly: linked from API reference, release notes, breaking-change alerts
- Provide migration examples (old code vs. new code) for each breaking change

## Related ADRs

- **ADR-005 (Off-chain storage)** — API is the boundary between off-chain backend and clients
- **ADR-004 (Oracle design)** — oracle API is a specialized versioning concern (separate security, no versioning needed)
