# CarbonLedger Backend API Reference

This document describes every backend API endpoint, along with authentication requirements, request/response schemas, example calls, error codes, and rate limiting behavior.

## Overview

- Base URL prefix: `/api/v1`
- Version header: `Accept-Version: 1` (optional)
- Machine-readable spec: `backend/docs/openapi.json`
- Public read-only API spec: `backend/docs/public-api.openapi.yaml`
- Generated from NestJS DTOs defined under `backend/src/**/*.dto.ts`

> Keep this reference in sync by regenerating the OpenAPI spec after changing DTOs or controllers:
>
> ```bash
> cd backend
> npm install
> npm run export:openapi
> ```

## Authentication Flow

CarbonLedger uses JWT authentication with Stellar keypair challenge/response.
The flow is:

1. `GET /api/v1/auth/challenge?publicKey=<stellar_public_key>`
2. Sign the returned challenge nonce with the Stellar private key
3. `POST /api/v1/auth/verify` with the signed payload
4. Receive `access_token` and `refresh_token`
5. Use `Authorization: Bearer <access_token>` for protected endpoints
6. Renew tokens with `POST /api/v1/auth/refresh`

### Authentication endpoints

#### `GET /api/v1/auth/challenge`

- Auth: public
- Rate limit: 10 requests / 60 seconds per IP
- Query parameters:
  - `publicKey` (string, required)

**Response schema**:
```json
{
  "nonce": "carbonledger:abc123-def456",
  "expiresAt": "2026-06-01T12:34:56.000Z"
}
```

**Errors**:
- `400 Bad Request` — invalid or missing `publicKey`
- `429 Too Many Requests` — rate limit exceeded

#### `POST /api/v1/auth/verify`

- Auth: public
- Rate limit: 5 requests / 60 seconds per IP
- Request body schema:
```json
{
  "publicKey": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "signature": "MEUCIQD...",
  "nonce": "carbonledger:abc123-def456",
  "role": "project_developer"
}
```

- Response schema:
```json
{
  "access_token": "eyJhbGci...",
  "refresh_token": "eyJhbGci..."
}
```

**Errors**:
- `400 Bad Request` — malformed request or invalid signature
- `401 Unauthorized` — challenge expired, signature invalid, or pubkey mismatch
- `429 Too Many Requests` — rate limit exceeded

#### `POST /api/v1/auth/refresh`

- Auth: public
- Rate limit: 10 requests / 60 seconds per IP
- Request body schema:
```json
{
  "refreshToken": "eyJhbGci..."
}
```

- Response schema:
```json
{
  "access_token": "eyJhbGci...",
  "refresh_token": "eyJhbGci..."
}
```

**Errors**:
- `400 Bad Request` — malformed request
- `401 Unauthorized` — invalid or expired refresh token
- `429 Too Many Requests` — rate limit exceeded

### JWT details

- `access_token` expires in `15m` by default (`JWT_EXPIRY`)
- `refresh_token` expires in `7d` by default (`JWT_REFRESH_EXPIRY`)
- Token claims include `sub` (publicKey), `role`, and `type`
- `Authorization` header format: `Bearer <access_token>`

## Global rate limiting summary

| Endpoint groups | Rate limit |
|---|---|
| Auth challenge | 10 req / 60s / IP |
| Auth verify | 5 req / 60s / IP |
| Auth refresh | 10 req / 60s / IP |
| Public project / marketplace / stats | 100 req / 60s / IP |
| Public API key endpoints | 1000 req / 24h per API key |
| Retire credits | 10 req / 60s per user |
| Default authenticated endpoints | 60 req / 60s |
| Default unauthenticated endpoints | 60 req / 60s |

> Responses exceeding throttling limits return `429 Too Many Requests`.

## Endpoint reference

### Health

#### `GET /api/v1/health`
- Auth: none
- Response schema:
```json
{
  "status": "ok",
  "stellar_network": "testnet",
  "timestamp": "2026-06-01T12:34:56.000Z"
}
```

#### `GET /api/v1/health/pool`
- Auth: none
- Response schema: database pool metrics object

### Projects

#### `GET /api/v1/projects`
- Auth: none
- Query params:
  - `methodology` (string)
  - `country` (string)
  - `vintage` (string)
  - `cursor` (string)
  - `limit` (string)

- Response: paginated project list

#### `GET /api/v1/projects/search`
- Auth: none
- Request query schema derived from `SearchProjectsDto`
- Query parameters include:
  - `search` (string)
  - `methodology` (string[])
  - `country` (string[])
  - `status` (Pending|Verified|Rejected|Suspended|Completed|Certified)
  - `vintageYear` (number[])
  - `oracleFreshness` (fresh|stale|unknown)
  - `cursor` (string)
  - `limit` (number, 1-100)
  - `sortBy` (`createdAt`|`vintageYear`|`totalCreditsIssued`|`name`)
  - `sortOrder` (`asc`|`desc`)

- Response schema: paginated list of carbon projects with metadata

#### `GET /api/v1/projects/{id}`
- Auth: none
- Path params:
  - `id` (string)
- Response schema: project details object
- Errors: `404 Not Found` if missing

#### `POST /api/v1/projects/register`
- Auth: Bearer JWT with role `project_developer` or `admin`
- Request body schema (`RegisterProjectDto`):
```json
{
  "projectId": "proj-001",
  "name": "Amazon Reforestation",
  "description": "Project description",
  "methodology": "VCS",
  "country": "BR",
  "projectType": "forestry",
  "metadataCid": "Qm...",
  "verifierAddress": "G...",
  "ownerAddress": "G...",
  "vintageYear": 2024,
  "methodologyScore": 85
}
```
- Response schema: newly created project object
- Errors: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`

#### `PATCH /api/v1/projects/{id}/status`
- Auth: Bearer JWT with role `admin`
- Request body schema (`UpdateProjectStatusDto`):
```json
{
  "status": "Verified",
  "reason": "Manual review completed"
}
```
- Response schema: updated project object

#### `POST /api/v1/projects/{id}/verify`
- Auth: Bearer JWT with role `verifier` or `admin`
- Request body schema:
```json
{
  "verifierPublicKey": "G..."
}
```
- Response: verification result

#### `POST /api/v1/projects/{id}/reject`
- Auth: Bearer JWT with role `verifier` or `admin`
- Request body schema:
```json
{
  "verifierPublicKey": "G...",
  "reason": "Documentation incomplete"
}
```
- Response: rejection result

### Credits

#### `GET /api/v1/credits/batch/{id}`
- Auth: none
- Response schema: credit batch details
- Errors: `404 Not Found`

#### `GET /api/v1/credits/retirement/{id}`
- Auth: none
- Response schema: credit retirement details
- Errors: `404 Not Found`

#### `GET /api/v1/credits/lookup/{serial}`
- Auth: none
- Response schema: credit lookup result
- Errors: `404 Not Found`

#### `POST /api/v1/credits/mint`
- Auth: Bearer JWT with role `admin`
- Request body schema (`MintCreditsDto`):
```json
{
  "batchId": "batch-001",
  "projectId": "proj-001",
  "vintageYear": 2024,
  "amount": 1000.00,
  "serialStart": "1000001",
  "serialEnd": "1001500",
  "metadataCid": "Qm..."
}
```
- Response schema: minted credits object

#### `POST /api/v1/credits/retire`
- Auth: Bearer JWT with role `corporation` or `admin`
- Request body schema (`RetireCreditsDto`):
```json
{
  "batchId": "batch-001",
  "amount": 10.5,
  "beneficiary": "Acme Corp",
  "retirementReason": "2026 ESG offset",
  "holderPublicKey": "G..."
}
```
- Note: `holderPublicKey` is overridden by authenticated user public key.
- Rate limit: 10 requests / 60 seconds per user
- Response schema: retirement confirmation object

### Marketplace

#### `GET /api/v1/marketplace/listings`
- Auth: none
- Rate limit: 100 requests / 60 seconds per IP
- Query params:
  - `methodology`, `country`, `vintage`, `minPrice`, `maxPrice`, `search`, `cursor`, `limit`
- Response schema: paginated marketplace listing list

#### `GET /api/v1/marketplace/listings/{id}`
- Auth: none
- Rate limit: 100 requests / 60 seconds per IP
- Response schema: listing details
- Errors: `404 Not Found`

#### `POST /api/v1/marketplace/listings`
- Auth: Bearer JWT with role `project_developer`, `corporation`, or `admin`
- Request body schema (`CreateListingDto`):
```json
{
  "listingId": "list-001",
  "projectId": "proj-001",
  "credit_batch_id": "batch-001",
  "amount": 100,
  "price_per_tonne": "25.00",
  "vintageYear": 2024,
  "methodology": "VCS",
  "country": "BR"
}
```
- Response schema: created listing object

#### `DELETE /api/v1/marketplace/listings/{id}`
- Auth: Bearer JWT with role `project_developer`, `corporation`, or `admin`
- Response schema: deletion confirmation
- Errors: `403 Forbidden` if caller does not own the listing

#### `POST /api/v1/marketplace/purchase`
- Auth: Bearer JWT with role `corporation` or `admin`
- Request body schema (`PurchaseDto`):
```json
{
  "listingId": "list-001",
  "amount": 10
}
```
- Note: buyerPublicKey is taken from the authenticated JWT.
- Response schema: purchase result

#### `POST /api/v1/marketplace/bulk-purchase`
- Auth: Bearer JWT with role `corporation` or `admin`
- Request body schema (`BulkPurchaseDto`):
```json
{
  "listingIds": ["list-001", "list-002"],
  "amounts": [5, 10]
}
```
- Note: buyerPublicKey is taken from the authenticated JWT.
- Response schema: bulk purchase result

### Oracle

#### `GET /api/v1/oracle/status/{projectId}`
- Auth: none
- Response schema:
```json
{
  "projectId": "proj-001",
  "lastSubmittedAt": "2026-05-31T12:00:00.000Z",
  "isCurrent": true,
  "latestScore": 92
}
```

#### `POST /api/v1/oracle/ingest/monitoring`
- Auth: Oracle keypair signature via `OracleGuard`
- Request body schema (`SubmitMonitoringDto`):
```json
{
  "projectId": "proj-001",
  "period": "2026-Q1",
  "tonnesVerified": 125,
  "methodologyScore": 94,
  "satelliteCid": "Qm...",
  "submittedBy": "oracle-keypair-public"
}
```
- Response schema: monitoring record object

#### `POST /api/v1/oracle/ingest/price`
- Auth: Oracle keypair signature via `OracleGuard`
- Request body schema (`UpdatePriceDto`):
```json
{
  "methodology": "VCS",
  "vintageYear": 2024,
  "priceUsdc": "15.00"
}
```
- Response schema:
```json
{
  "received": true,
  "oracleUpdateId": "price:VCS:2024"
}
```

#### `POST /api/v1/oracle/ingest/flag`
- Auth: Oracle keypair signature via `OracleGuard`
- Request body schema (`FlagProjectDto`):
```json
{
  "projectId": "proj-001",
  "reason": "Credible monitoring anomaly detected"
}
```
- Response schema:
```json
{
  "flagged": true,
  "projectId": "proj-001",
  "reason": "Credible monitoring anomaly detected"
}
```

#### `POST /api/v1/oracle/price-approvals/hold`
- Auth: Bearer JWT with role `admin`
- Request body schema (`HoldPriceUpdateDto`):
```json
{
  "methodology": "VCS",
  "vintageYear": 2024,
  "priceStroops": "100"
}
```
- Response schema: pending price approval object

#### `GET /api/v1/oracle/price-approvals`
- Auth: Bearer JWT with role `admin`
- Response schema: list of pending price approvals

#### `POST /api/v1/oracle/price-approvals/{id}/approve`
- Auth: Bearer JWT with role `admin`
- Response schema: updated approval object

#### `POST /api/v1/oracle/price-approvals/{id}/reject`
- Auth: Bearer JWT with role `admin`
- Request body:
```json
{"reason": "Incorrect vintage year"}
```
- Response schema: rejected approval object

### Retirements and Certificates

#### `GET /api/v1/retirements`
- Auth: Bearer JWT required
- Query params: `cursor`, `limit`
- Response schema: paginated retirements list scoped to requesting user

#### `GET /api/v1/retirements/{id}`
- Auth: Bearer JWT required
- Response schema: retirement detail
- Errors: `403 Forbidden` if caller is not the owner or admin

#### `POST /api/v1/retirements/generate-pdf`
- Auth: Bearer JWT with role `corporation` or `admin`
- Request body:
```json
{
  "retirementId": "ret-001"
}
```
- Response: PDF generation result

#### `GET /api/v1/retirements/export/csv`
- Auth: Bearer JWT with role `corporation` or `admin`
- Query params: export filter fields plus authenticated `retiredBy`
- Response: CSV file download

#### `GET /api/v1/retirements/export/pdf`
- Auth: Bearer JWT with role `corporation` or `admin`
- Query params: export filter fields plus authenticated `retiredBy`
- Response: PDF file download

#### `POST /api/v1/retirements/verify-integrity`
- Auth: none
- Request body schema:
```json
{
  "retirementId": "ret-001",
  "content": "..."
}
```
- Response schema: integrity verification result

#### `GET /api/v1/certificates/{id}`
- Auth: none
- Response schema: retirement certificate metadata and project reference

### Uploads

#### `POST /api/v1/uploads/project/{projectId}/documents`
- Auth: Bearer JWT with role `project_developer` or `admin`
- Content-Type: `multipart/form-data`
- Request payload: file field named `file`
- Supported file types: `application/pdf`, `application/json`
- Max size: 50 MB
- Response schema: uploaded file metadata and IPFS gateway URL

#### `POST /api/v1/uploads/certificate/{retirementId}/certificate`
- Auth: Bearer JWT with role `corporation` or `admin`
- Content-Type: `multipart/form-data`
- Supported file type: `application/pdf`
- Max size: 50 MB
- Response schema: uploaded certificate metadata

#### `POST /api/v1/uploads/webhook/pinata`
- Auth: public
- Request body: arbitrary webhook payload from Pinata
- Response schema:
```json
{
  "success": true,
  "message": "Webhook processed"
}
```

#### `GET /api/v1/uploads/files`
- Auth: Bearer JWT with role `admin`
- Query params: `pinStatus`, `linkedEntityType`, `linkedEntityId`
- Response schema: file listing

#### `GET /api/v1/uploads/files/{cid}`
- Auth: none
- Response schema: file metadata
- Errors: `404 Not Found`

### Verifiers

#### `POST /api/v1/verifiers/apply`
- Auth: public
- Request body schema (`ApplyVerifierDto`):
```json
{
  "publicKey": "G...",
  "organizationName": "Verifier Inc",
  "accreditationBody": "SDS",
  "accreditationId": "ACC-123",
  "contactEmail": "contact@example.com",
  "documentsCid": "Qm..."
}
```
- Response schema: verifier application confirmation

#### `GET /api/v1/verifiers`
- Auth: Bearer JWT with role `admin` or `verifier`
- Query param: `status`
- Response schema: list of verifier applications

#### `GET /api/v1/verifiers/{id}`
- Auth: Bearer JWT with role `admin` or `verifier`
- Response schema: verifier application details

#### `PATCH /api/v1/verifiers/{id}/review`
- Auth: Bearer JWT with role `admin`
- Request body schema (`ReviewVerifierDto`):
```json
{
  "adminPublicKey": "G...",
  "decision": "approved",
  "rejectionReason": "optional reason"
}
```
- Response schema: review result

#### `GET /api/v1/verifiers/{publicKey}/pending-projects`
- Auth: Bearer JWT with role `verifier` or `admin`
- Response schema: pending project list for the verifier

### Notifications

#### `GET /api/v1/notifications/preferences/{publicKey}`
- Auth: Bearer JWT required
- Response schema:
```json
{
  "projectApproved": true,
  "creditsMinted": false,
  "purchaseConfirmed": true,
  "retirementConfirmed": true
}
```

#### `PATCH /api/v1/notifications/preferences/{publicKey}`
- Auth: Bearer JWT required
- Request body schema (`UpdateNotificationPreferencesDto`):
```json
{
  "projectApproved": true,
  "creditsMinted": false
}
```
- Response schema: updated preferences object

### Admin

All `/api/v1/admin/*` endpoints require `Authorization: Bearer <JWT>` with role `admin`.

#### `GET /api/v1/admin/verifiers`
- Response schema: list of whitelisted verifier addresses

#### `POST /api/v1/admin/verifiers`
- Request body schema (`VerifierWhitelistDto`):
```json
{
  "address": "G..."
}
```

#### `DELETE /api/v1/admin/verifiers/{address}`
- Response schema: deletion confirmation

#### `GET /api/v1/admin/treasury`
- Response schema: treasury address and balance metadata

#### `POST /api/v1/admin/treasury`
- Request body schema (`UpdateTreasuryDto`):
```json
{
  "address": "G..."
}
```

#### `GET /api/v1/admin/oracle/health`
- Response schema: oracle health status

#### `POST /api/v1/admin/reindex`
- Response schema: reindex trigger confirmation

#### `GET /api/v1/admin/audit-logs`
- Query params: `limit`, `offset`, `action`
- Response schema: audit log list

### Export

#### `GET /api/v1/export/projects`
- Auth: Bearer JWT with role `admin`
- Query params: filters and `format=json|csv`
- Response: JSON array or CSV download

#### `GET /api/v1/export/retirements`
- Auth: Bearer JWT with role `admin`
- Query params: filters and `format=json|csv`
- Response: JSON array or CSV download

### Queue

#### `POST /api/v1/queue/jobs`
- Auth: Bearer JWT with role `admin`
- Request body schema (`EnqueueJobDto`):
```json
{
  "type": "CERTIFICATE_GENERATION",
  "payload": { "projectId": "proj-001", "amount": 100 }
}
```
- Response schema: job enqueue confirmation

#### `GET /api/v1/queue/jobs/{id}`
- Auth: Bearer JWT with role `admin`
- Response schema: job status and result

#### `GET /api/v1/queue/stats`
- Auth: Bearer JWT with role `admin`
- Response schema: queue statistics

### Audit

#### `GET /api/v1/audit`
- Auth: Bearer JWT with role `admin`
- Query params: `limit`, `offset`, `userId`, `action`
- Response schema: audit log list

### Stats

#### `GET /api/v1/stats`
- Auth: none
- Rate limit: 100 requests / 60 seconds per IP
- Response schema: platform statistics

#### `GET /api/v1/stats/aggregate`
- Auth: none
- Rate limit: 100 requests / 60 seconds per IP
- Response schema: aggregated platform metrics

#### `GET /api/v1/stats/cache`
- Auth: none
- Response schema: cache metrics

### Logger

#### `POST /api/v1/logs`
- Auth: none
- Request body schema:
```json
{
  "level": "error",
  "message": "Something failed",
  "trace_id": "abc123",
  "user_id": "G...",
  "url": "https://app.example.com/page"
}
```
- Response: `204 No Content`

### Observability

#### `GET /api/v1/observability/metrics`
- Auth: none
- Response schema: dashboard metrics object

## Public API for third parties

The public, read-only API uses `X-Api-Key` authentication and lives under `/v1/*`.
Reference the generated spec at `backend/docs/public-api.openapi.yaml`.

## Error handling and common response patterns

Most errors return JSON with `statusCode`, `message`, and optionally `error`.
Common HTTP statuses:

- `400 Bad Request` — invalid request shape, missing fields, or validation failure
- `401 Unauthorized` — missing or invalid JWT / API key
- `403 Forbidden` — role does not permit this action
- `404 Not Found` — resource not found
- `409 Conflict` — duplicate or invalid business state
- `429 Too Many Requests` — rate limit exceeded
- `500 Internal Server Error` — server-side failure

## Keeping docs in sync with DTOs

All request schema definitions are derived from DTO classes in `backend/src/**/.dto.ts`.
When you change a DTO, regenerate the OpenAPI spec:

```bash
cd backend
npm run export:openapi
```

Then review `backend/docs/openapi.json` and update this Markdown reference as needed.
