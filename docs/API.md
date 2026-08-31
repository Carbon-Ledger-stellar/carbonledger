# CarbonLedger API

This file is the OpenAPI 3.0 contract for the HTTP API. The running NestJS application uses the `/api` global prefix and URI versioning, so version 1 routes are served below `/api/v1` and version 2 routes below `/api/v2`.

The checked-in NestJS exporter is [`backend/src/export-openapi.ts`](../backend/src/export-openapi.ts). It can generate `docs/openapi.json` from controller decorators. This Markdown file is the human-reviewed contract and includes examples for the public and operational API surface.

## Authentication

Protected endpoints accept a short-lived JWT access token:

```http
Authorization: Bearer <access-token>
```

Obtain an access token by requesting a wallet challenge, signing the nonce with the Stellar wallet, and posting the signature to `/api/v1/auth/verify`. The refresh token is returned as an HTTP-only, Secure, SameSite cookie named `refresh_token`; browser clients should not read or persist it in JavaScript. Send credentials when calling `/auth/refresh` and `/auth/logout`.

The third-party read API uses an API key instead:

```http
X-Api-Key: <api-key>
```

API keys are rate-limited to 1,000 requests per day. Never put JWTs or API keys in URLs, source control, or client-side logs.

## Pagination

List endpoints use cursor pagination where supported:

```http
GET /api/v1/v1/projects?limit=20&cursor=eyJvZmZzZXQiOjIwfQ
```

`limit` is optional, defaults to `20`, and is capped at `100`. A paginated response has this shape:

```json
{
  "items": [],
  "nextCursor": "eyJvZmZzZXQiOjQwfQ",
  "hasMore": true
}
```

When `hasMore` is `false`, omit `nextCursor` or return `null`. Treat cursors as opaque strings and pass them unchanged to the next request.

## Error envelope

Validation and unexpected errors use the common envelope below. The API documents `400`, `401`, `403`, and `500` for every protected operation where those statuses can occur.

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "requestId": "req_01HX..."
}
```

Common domain error codes include `ProjectNotFound`, `ProjectNotVerified`, `ProjectSuspended`, `InsufficientCredits`, `AlreadyRetired`, `SerialNumberConflict`, `UnauthorizedVerifier`, `UnauthorizedOracle`, `InvalidVintageYear`, `ListingNotFound`, `InsufficientLiquidity`, `PriceNotSet`, `MonitoringDataStale`, `DoubleCountingDetected`, `RetirementIrreversible`, `ZeroAmountNotAllowed`, `ProjectAlreadyExists`, and `InvalidSerialRange`.

## OpenAPI 3.0 specification

```yaml
openapi: 3.0.3
info:
  title: CarbonLedger API
  version: 1.0.0
  description: >-
    API for verified carbon projects, credit batches, marketplace operations,
    retirement certificates, provenance, oracle data, and administration.
  contact:
    name: CarbonLedger Team
    url: https://carbonledger.io
servers:
  - url: https://carbonledger.io/api/v1
    description: Production API v1
  - url: https://carbonledger.io/api/v2
    description: Production API v2
  - url: http://localhost:3001/api/v1
    description: Local API v1
security:
  - bearerAuth: []
tags:
  - name: Authentication
  - name: Public API
  - name: Projects
  - name: Credits
  - name: Marketplace
  - name: Retirements
  - name: Certificates
  - name: Oracle
  - name: Administration
  - name: Operations

paths:
  /auth/challenge:
    get:
      tags: [Authentication]
      summary: Create a wallet challenge
      security: []
      parameters:
        - name: publicKey
          in: query
          required: true
          schema: { type: string, example: GABC... }
      responses:
        '200': { $ref: '#/components/responses/Ok' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '500': { $ref: '#/components/responses/ServerError' }
  /auth/verify:
    post:
      tags: [Authentication]
      summary: Exchange a signed challenge for a JWT
      security: []
      requestBody: { $ref: '#/components/requestBodies/AuthVerify' }
      responses:
        '200': { $ref: '#/components/responses/Ok' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '500': { $ref: '#/components/responses/ServerError' }
  /auth/refresh:
    post:
      tags: [Authentication]
      summary: Rotate the refresh token and return a new JWT
      security: []
      requestBody: { $ref: '#/components/requestBodies/Refresh' }
      responses:
        '200': { $ref: '#/components/responses/Ok' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '500': { $ref: '#/components/responses/ServerError' }
  /auth/logout:
    post:
      tags: [Authentication]
      summary: Revoke the current access and refresh tokens
      requestBody: { $ref: '#/components/requestBodies/Refresh' }
      responses:
        '200': { $ref: '#/components/responses/Ok' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '500': { $ref: '#/components/responses/ServerError' }

  /v1/projects:
    get:
      tags: [Public API]
      summary: List verified projects for integrations
      security: [{ apiKeyAuth: [] }]
      parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }, { $ref: '#/components/parameters/Methodology' }, { $ref: '#/components/parameters/Country' }, { $ref: '#/components/parameters/Vintage' }]
      responses:
        '200': { $ref: '#/components/responses/Paginated' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/ServerError' }
  /v1/credits/batch/{batchId}:
    get:
      tags: [Public API]
      summary: Retrieve a credit batch
      security: [{ apiKeyAuth: [] }]
      parameters: [{ $ref: '#/components/parameters/BatchId' }]
      responses:
        '200': { $ref: '#/components/responses/Ok' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/ServerError' }
  /v1/certificates/{retirementId}:
    get:
      tags: [Public API]
      summary: Verify a retirement certificate
      security: [{ apiKeyAuth: [] }]
      parameters: [{ $ref: '#/components/parameters/RetirementId' }]
      responses:
        '200': { $ref: '#/components/responses/Ok' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/ServerError' }
  /v1/api-keys:
    post:
      tags: [Public API]
      summary: Provision a third-party API key
      security: []
      requestBody: { $ref: '#/components/requestBodies/Json' }
      responses:
        '201': { $ref: '#/components/responses/Created' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '500': { $ref: '#/components/responses/ServerError' }
  /public/serial/{number}:
    get:
      tags: [Public API]
      summary: Look up one credit serial number
      security: []
      parameters:
        - name: number
          in: path
          required: true
          schema: { type: string, example: CARB-001-0001 }
      responses:
        '200': { $ref: '#/components/responses/Ok' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/ServerError' }
  /public/serials:
    post:
      tags: [Public API]
      summary: Look up up to ten serial numbers
      security: []
      requestBody: { $ref: '#/components/requestBodies/Serials' }
      responses:
        '200': { $ref: '#/components/responses/Ok' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '500': { $ref: '#/components/responses/ServerError' }

  /projects:
    get: { tags: [Projects], summary: List projects, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
    post: { tags: [Projects], summary: Create a project, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /projects/search:
    get: { tags: [Projects], summary: Search projects, parameters: [{ $ref: '#/components/parameters/Query' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /projects/{id}:
    get: { tags: [Projects], summary: Get a project, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
    patch: { tags: [Projects], summary: Update a project, parameters: [{ $ref: '#/components/parameters/Id' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /projects/batch-create:
    post: { tags: [Projects], summary: Create projects in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /projects/register:
    post: { tags: [Projects], summary: Register a project on-chain, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /projects/{id}/status:
    patch: { tags: [Projects], summary: Change project status, parameters: [{ $ref: '#/components/parameters/Id' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /projects/{id}/verify:
    post: { tags: [Projects], summary: Verify a project, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /projects/{id}/reject:
    post: { tags: [Projects], summary: Reject a project, parameters: [{ $ref: '#/components/parameters/Id' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /credits/project/{projectId}/batches:
    get: { tags: [Credits], summary: List project credit batches, parameters: [{ $ref: '#/components/parameters/ProjectId' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/batch/{id}:
    get: { tags: [Credits], summary: Get a credit batch, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/retirement/{id}:
    get: { tags: [Credits], summary: Get a retirement record, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/lookup/{serial}:
    get: { tags: [Credits], summary: Look up a serial, parameters: [{ $ref: '#/components/parameters/Serial' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/provenance/{serial}:
    get: { tags: [Credits], summary: Get credit provenance, parameters: [{ $ref: '#/components/parameters/Serial' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/mint:
    post: { tags: [Credits], summary: Mint credits, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/batch-mint:
    post: { tags: [Credits], summary: Mint credit batches in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/retire:
    post: { tags: [Credits], summary: Retire credits, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/batch-retire:
    post: { tags: [Credits], summary: Retire credit batches in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /credits/bulk-retire:
    post: { tags: [Credits], summary: Retire credits in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /marketplace/listings:
    get: { tags: [Marketplace], summary: List marketplace listings, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
    post: { tags: [Marketplace], summary: Create a listing, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /marketplace/listings/{id}:
    get: { tags: [Marketplace], summary: Get a listing, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
    delete: { tags: [Marketplace], summary: Delist a listing, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /marketplace/search:
    get: { tags: [Marketplace], summary: Search marketplace listings, parameters: [{ $ref: '#/components/parameters/Query' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /marketplace/listings/batch:
    post: { tags: [Marketplace], summary: Create listings in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /marketplace/purchase:
    post: { tags: [Marketplace], summary: Purchase a listing, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /marketplace/bulk-purchase:
    post: { tags: [Marketplace], summary: Purchase listings in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /retirements:
    get: { tags: [Retirements], summary: List retirements, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
    post: { tags: [Retirements], summary: Create a retirement, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/search:
    get: { tags: [Retirements], summary: Search retirements, parameters: [{ $ref: '#/components/parameters/Query' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/bulk:
    post: { tags: [Retirements], summary: Create retirements in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/bulk/csv:
    post: { tags: [Retirements], summary: Start CSV retirement import, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '202': { $ref: '#/components/responses/Accepted' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/bulk/csv/{jobId}/status:
    get: { tags: [Retirements], summary: Get CSV retirement job status, parameters: [{ $ref: '#/components/parameters/JobId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/{id}:
    get: { tags: [Retirements], summary: Get a retirement, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/{id}/certificate-status:
    get: { tags: [Retirements], summary: Get certificate generation status, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/{id}/certificate:
    get: { tags: [Retirements], summary: Download a retirement certificate, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Download' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/generate-pdf:
    post: { tags: [Retirements], summary: Generate a certificate PDF, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/export/csv:
    get: { tags: [Retirements], summary: Export retirements as CSV, parameters: [{ $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Download' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/export/pdf:
    get: { tags: [Retirements], summary: Export retirements as PDF, responses: { '200': { $ref: '#/components/responses/Download' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/verify-integrity:
    post: { tags: [Retirements], summary: Verify retirement integrity, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/verify-signature:
    post: { tags: [Retirements], summary: Verify a certificate signature, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /retirements/{id}/zk-proof:
    get: { tags: [Retirements], summary: Get a retirement zero-knowledge proof, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
    post: { tags: [Retirements], summary: Generate a retirement zero-knowledge proof, parameters: [{ $ref: '#/components/parameters/Id' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /certificates/{retirementId}:
    get: { tags: [Certificates], summary: Get a retirement certificate, parameters: [{ $ref: '#/components/parameters/RetirementId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /certificates/{retirementId}/pdf:
    get: { tags: [Certificates], summary: Download a certificate PDF, parameters: [{ $ref: '#/components/parameters/RetirementId' }], responses: { '200': { $ref: '#/components/responses/Download' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /certificates/{retirementId}/status:
    get: { tags: [Certificates], summary: Get certificate status, parameters: [{ $ref: '#/components/parameters/RetirementId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /certificates/{cid}/verify:
    get: { tags: [Certificates], summary: Verify a certificate by content ID, parameters: [{ name: cid, in: path, required: true, schema: { type: string, example: bafy... } }], security: [], responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /audit:
    get: { tags: [Operations], summary: Query audit records, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /audit/verify:
    get: { tags: [Operations], summary: Verify audit integrity, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /audit/credits/{batchId}/events:
    get: { tags: [Operations], summary: List credit audit events, parameters: [{ $ref: '#/components/parameters/BatchId' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /audit/credits/{batchId}/state:
    get: { tags: [Operations], summary: Get projected credit state, parameters: [{ $ref: '#/components/parameters/BatchId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /audit/credits/{batchId}/projection:
    get: { tags: [Operations], summary: Get credit projection, parameters: [{ $ref: '#/components/parameters/BatchId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /audit/credits/projections/rebuild:
    post: { tags: [Operations], summary: Rebuild credit projections, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /audit/credits/{batchId}/integrity:
    get: { tags: [Operations], summary: Check credit integrity, parameters: [{ $ref: '#/components/parameters/BatchId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/status/{projectId}:
    get: { tags: [Oracle], summary: Get project oracle status, parameters: [{ $ref: '#/components/parameters/ProjectId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/services/health:
    get: { tags: [Oracle], summary: Check oracle services, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/ingest/monitoring:
    post: { tags: [Oracle], summary: Ingest monitoring data, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/ingest/batch-monitoring:
    post: { tags: [Oracle], summary: Ingest monitoring data in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/ingest/price:
    post: { tags: [Oracle], summary: Ingest a price, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/ingest/batch-price:
    post: { tags: [Oracle], summary: Ingest prices in bulk, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/ingest/flag:
    post: { tags: [Oracle], summary: Submit an oracle flag, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/price-approvals/hold:
    post: { tags: [Oracle], summary: Place a price approval on hold, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/price-approvals:
    get: { tags: [Oracle], summary: List price approvals, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/price-approvals/{id}/approve:
    post: { tags: [Oracle], summary: Approve a price, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /oracle/price-approvals/{id}/reject:
    post: { tags: [Oracle], summary: Reject a price, parameters: [{ $ref: '#/components/parameters/Id' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /stats:
    get: { tags: [Operations], summary: Get protocol statistics, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /stats/aggregate:
    get: { tags: [Operations], summary: Get aggregated statistics, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /stats/cache:
    get: { tags: [Operations], summary: Get statistics cache status, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /stats/leaderboard:
    get: { tags: [Operations], summary: Get retirement leaderboard, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /portfolio/metrics:
    get: { tags: [Operations], summary: Get portfolio metrics, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /portfolio/refresh-views:
    get: { tags: [Operations], summary: Refresh portfolio views, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /health:
    get: { tags: [Operations], summary: Basic liveness check, security: [], responses: { '200': { $ref: '#/components/responses/Ok' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /health/ready:
    get: { tags: [Operations], summary: Dependency readiness check, security: [], responses: { '200': { $ref: '#/components/responses/Ok' }, '503': { $ref: '#/components/responses/ServerError' } } }
  /metrics:
    get: { tags: [Operations], summary: Prometheus metrics, security: [], responses: { '200': { description: Prometheus text response, content: { text/plain: { schema: { type: string, example: carbonledger_contract_calls_total 42 } } } }, '500': { $ref: '#/components/responses/ServerError' } } }

  /notifications/preferences/{publicKey}:
    get: { tags: [Operations], summary: Get notification preferences, parameters: [{ $ref: '#/components/parameters/PublicKey' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
    patch: { tags: [Operations], summary: Update notification preferences, parameters: [{ $ref: '#/components/parameters/PublicKey' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /webhooks:
    get: { tags: [Operations], summary: List webhooks, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
    post: { tags: [Operations], summary: Create a webhook, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /webhooks/deliveries:
    get: { tags: [Operations], summary: List webhook deliveries, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /webhooks/{id}:
    get: { tags: [Operations], summary: Get a webhook, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
    delete: { tags: [Operations], summary: Delete a webhook, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /webhooks/{id}/logs:
    get: { tags: [Operations], summary: Get webhook delivery logs, parameters: [{ $ref: '#/components/parameters/Id' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /uploads/files:
    get: { tags: [Operations], summary: List uploaded files, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /uploads/files/{cid}:
    get: { tags: [Operations], summary: Retrieve an uploaded file, parameters: [{ name: cid, in: path, required: true, schema: { type: string, example: bafy... } }], responses: { '200': { $ref: '#/components/responses/Download' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /uploads/project/{projectId}/documents:
    post: { tags: [Operations], summary: Upload project documents, parameters: [{ $ref: '#/components/parameters/ProjectId' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /uploads/certificate/{retirementId}/certificate:
    post: { tags: [Operations], summary: Upload certificate material, parameters: [{ $ref: '#/components/parameters/RetirementId' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /uploads/webhook/pinata:
    post: { tags: [Operations], summary: Receive a Pinata upload webhook, security: [], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /admin/users/{publicKey}/role:
    post: { tags: [Administration], summary: Change a user's role, parameters: [{ $ref: '#/components/parameters/PublicKey' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/verifiers:
    get: { tags: [Administration], summary: List verifiers, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
    post: { tags: [Administration], summary: Create a verifier, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/verifiers/{address}:
    delete: { tags: [Administration], summary: Remove a verifier, parameters: [{ name: address, in: path, required: true, schema: { type: string, example: GABC... } }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/treasury:
    get: { tags: [Administration], summary: Get treasury information, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
    post: { tags: [Administration], summary: Update treasury information, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/oracle/health:
    get: { tags: [Administration], summary: Get oracle health, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/reindex:
    post: { tags: [Administration], summary: Reindex application data, responses: { '202': { $ref: '#/components/responses/Accepted' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/projects/{projectId}:
    delete: { tags: [Administration], summary: Soft-delete a project, parameters: [{ $ref: '#/components/parameters/ProjectId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/projects/{projectId}/restore:
    post: { tags: [Administration], summary: Restore a project, parameters: [{ $ref: '#/components/parameters/ProjectId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/credits/{batchId}:
    delete: { tags: [Administration], summary: Soft-delete a credit batch, parameters: [{ $ref: '#/components/parameters/BatchId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/credits/{batchId}/restore:
    post: { tags: [Administration], summary: Restore a credit batch, parameters: [{ $ref: '#/components/parameters/BatchId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/retirements/{retirementId}:
    delete: { tags: [Administration], summary: Soft-delete a retirement, parameters: [{ $ref: '#/components/parameters/RetirementId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/retirements/{retirementId}/restore:
    post: { tags: [Administration], summary: Restore a retirement, parameters: [{ $ref: '#/components/parameters/RetirementId' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/purge:
    delete: { tags: [Administration], summary: Permanently purge eligible records, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/audit-logs:
    get: { tags: [Administration], summary: List administration audit logs, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/abuse-log:
    get: { tags: [Administration], summary: List abuse events, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/satellite/quarantine:
    get: { tags: [Administration], summary: List quarantined satellite records, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/satellite/quarantine/depth:
    get: { tags: [Administration], summary: Get quarantine depth, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/satellite/quarantine/{id}:
    get: { tags: [Administration], summary: Get a quarantined record, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /admin/satellite/quarantine/{id}/review:
    post: { tags: [Administration], summary: Review a quarantined record, parameters: [{ $ref: '#/components/parameters/Id' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /queue/jobs:
    post: { tags: [Operations], summary: Enqueue a background job, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '202': { $ref: '#/components/responses/Accepted' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /queue/jobs/{id}:
    get: { tags: [Operations], summary: Get background job status, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /queue/stats:
    get: { tags: [Operations], summary: Get queue statistics, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /verifiers:
    get: { tags: [Administration], summary: List verifiers, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
    post: { tags: [Administration], summary: Apply to become a verifier, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /verifiers/{id}:
    get: { tags: [Administration], summary: Get a verifier, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }
    patch: { tags: [Administration], summary: Review a verifier, parameters: [{ $ref: '#/components/parameters/Id' }], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /verifiers/{publicKey}/pending-projects:
    get: { tags: [Administration], summary: List projects awaiting verifier review, parameters: [{ $ref: '#/components/parameters/PublicKey' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /verifiers/{publicKey}/history:
    get: { tags: [Administration], summary: Get verifier history, parameters: [{ $ref: '#/components/parameters/PublicKey' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /verifiers/{publicKey}/fees:
    get: { tags: [Administration], summary: Get verifier fees, parameters: [{ $ref: '#/components/parameters/PublicKey' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /verifiers/{publicKey}/fees/export:
    get: { tags: [Administration], summary: Export verifier fees, parameters: [{ $ref: '#/components/parameters/PublicKey' }], responses: { '200': { $ref: '#/components/responses/Download' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /key-rotation/oracle:
    post: { tags: [Administration], summary: Rotate oracle keys, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /key-rotation/admin:
    post: { tags: [Administration], summary: Rotate admin keys, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /key-rotation/jwt:
    post: { tags: [Administration], summary: Rotate JWT signing keys, requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '200': { $ref: '#/components/responses/Ok' }, '400': { $ref: '#/components/responses/BadRequest' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /key-rotation:
    get: { tags: [Administration], summary: List key rotations, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /key-rotation/{id}:
    get: { tags: [Administration], summary: Get key rotation details, parameters: [{ $ref: '#/components/parameters/Id' }], responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/ServerError' } } }

  /public/projects:
    get: { tags: [Public API], summary: List public projects, security: [], parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '400': { $ref: '#/components/responses/BadRequest' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /export/projects:
    get: { tags: [Operations], summary: Export projects, parameters: [{ $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Download' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /export/retirements:
    get: { tags: [Operations], summary: Export retirements, parameters: [{ $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Download' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /logs:
    post: { tags: [Operations], summary: Ingest an application log, security: [], requestBody: { $ref: '#/components/requestBodies/Json' }, responses: { '201': { $ref: '#/components/responses/Created' }, '400': { $ref: '#/components/responses/BadRequest' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /logs/by-correlation-id:
    get: { tags: [Operations], summary: Find logs by correlation ID, parameters: [{ $ref: '#/components/parameters/Query' }, { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Cursor' }], responses: { '200': { $ref: '#/components/responses/Paginated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }
  /api/v1/observability/metrics:
    get: { tags: [Operations], summary: Get observability metrics, responses: { '200': { $ref: '#/components/responses/Ok' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/ServerError' } } }


components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Short-lived access token from `/auth/verify`.
    apiKeyAuth:
      type: apiKey
      in: header
      name: X-Api-Key
      description: Third-party read API key.
  parameters:
    Id: { name: id, in: path, required: true, schema: { type: string, example: proj_01HX123 } }
    ProjectId: { name: projectId, in: path, required: true, schema: { type: string, example: project-amazon-001 } }
    BatchId: { name: batchId, in: path, required: true, schema: { type: string, example: batch-2024-001 } }
    RetirementId: { name: retirementId, in: path, required: true, schema: { type: string, example: ret_01HX123 } }
    JobId: { name: jobId, in: path, required: true, schema: { type: string, example: job_01HX123 } }
    Serial: { name: serial, in: path, required: true, schema: { type: string, example: CARB-001-0001 } }
    PublicKey: { name: publicKey, in: path, required: true, schema: { type: string, example: GABC... } }
    Limit: { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 100, default: 20, example: 20 } }
    Cursor: { name: cursor, in: query, required: false, schema: { type: string, nullable: true, example: eyJvZmZzZXQiOjIwfQ } }
    Query: { name: q, in: query, required: false, schema: { type: string, example: rainforest } }
    Methodology: { name: methodology, in: query, required: false, schema: { type: string, example: VCS } }
    Country: { name: country, in: query, required: false, schema: { type: string, example: Brazil } }
    Vintage: { name: vintage, in: query, required: false, schema: { type: integer, example: 2024 } }
  requestBodies:
    Json:
      required: true
      content:
        application/json:
          schema: { $ref: '#/components/schemas/JsonObject' }
          example: { projectId: project-amazon-001, amount: 100 }
    AuthVerify:
      required: true
      content:
        application/json:
          schema: { $ref: '#/components/schemas/AuthVerifyRequest' }
          example: { publicKey: GABC..., signature: signed_nonce, nonce: nonce_01HX, role: buyer }
    Refresh:
      required: false
      content:
        application/json:
          schema: { type: object, properties: { refreshToken: { type: string, writeOnly: true } } }
          example: { refreshToken: optional-for-non-browser-clients }
    Serials:
      required: true
      content:
        application/json:
          schema: { type: object, required: [serials], properties: { serials: { type: array, maxItems: 10, items: { type: string } } } }
          example: { serials: [CARB-001-0001, CARB-001-0002] }
  schemas:
    JsonObject: { type: object, additionalProperties: true }
    AuthVerifyRequest:
      type: object
      required: [publicKey, signature, nonce]
      properties:
        publicKey: { type: string, example: GABC... }
        signature: { type: string, example: signed_nonce }
        nonce: { type: string, example: nonce_01HX }
        role: { type: string, example: buyer }
    OkPayload: { type: object, additionalProperties: true, example: { id: record_01HX, status: active } }
    Page:
      type: object
      required: [items, hasMore]
      properties:
        items: { type: array, items: { $ref: '#/components/schemas/OkPayload' } }
        nextCursor: { type: string, nullable: true, example: eyJvZmZzZXQiOjQwfQ }
        hasMore: { type: boolean, example: true }
    Error:
      type: object
      required: [statusCode, error, message, requestId]
      properties:
        statusCode: { type: integer, example: 400 }
        error: { type: string, example: Bad Request }
        message: { type: string, example: Validation failed }
        code: { type: string, example: VALIDATION_ERROR }
        requestId: { type: string, example: req_01HX123 }
  responses:
    Ok:
      description: Successful response
      content: { application/json: { schema: { $ref: '#/components/schemas/OkPayload' }, example: { id: record_01HX, status: active } } }
    Created:
      description: Resource created
      content: { application/json: { schema: { $ref: '#/components/schemas/OkPayload' }, example: { id: record_01HX, created: true } } }
    Accepted:
      description: Job accepted for asynchronous processing
      content: { application/json: { schema: { $ref: '#/components/schemas/OkPayload' }, example: { jobId: job_01HX, status: queued } } }
    Paginated:
      description: Paginated response
      content: { application/json: { schema: { $ref: '#/components/schemas/Page' }, example: { items: [], nextCursor: eyJvZmZzZXQiOjQwfQ, hasMore: true } } }
    Download:
      description: File download
      content: { application/pdf: { schema: { type: string, format: binary } }, text/csv: { schema: { type: string } } }
    BadRequest:
      description: Invalid input or validation failure
      content: { application/json: { schema: { $ref: '#/components/schemas/Error' }, example: { statusCode: 400, error: Bad Request, message: Validation failed, code: VALIDATION_ERROR, requestId: req_01HX123 } } }
    Unauthorized:
      description: Missing, expired, or invalid JWT/API key
      content: { application/json: { schema: { $ref: '#/components/schemas/Error' }, example: { statusCode: 401, error: Unauthorized, message: Authentication required, code: UNAUTHORIZED, requestId: req_01HX123 } } }
    Forbidden:
      description: Authenticated identity lacks permission or origin is not allowed
      content: { application/json: { schema: { $ref: '#/components/schemas/Error' }, example: { statusCode: 403, error: Forbidden, message: Insufficient permissions, code: FORBIDDEN, requestId: req_01HX123 } } }
    NotFound:
      description: Resource not found
      content: { application/json: { schema: { $ref: '#/components/schemas/Error' }, example: { statusCode: 404, error: Not Found, message: Resource not found, code: NOT_FOUND, requestId: req_01HX123 } } }
    ServerError:
      description: Unexpected server or dependency failure
      content: { application/json: { schema: { $ref: '#/components/schemas/Error' }, example: { statusCode: 500, error: Internal Server Error, message: An unexpected error occurred, code: INTERNAL_ERROR, requestId: req_01HX123 } } }

```

## Swagger UI

The backend currently has no Swagger UI bootstrap or static-file mount. Because this request requires leaving existing application code unchanged, this repository change does not claim a runtime `/api-docs` route that is not currently mounted.

To expose the spec safely in a later application change:

1. Install `swagger-ui-express` and its type package in `backend`.
2. Generate the decorator-based JSON with `npm run export:openapi` or serve this contract after converting its YAML block to JSON.
3. In the Nest bootstrap, mount `SwaggerUI.serve` and `SwaggerUI.setup(document, { explorer: true })` at `/api-docs` before `app.listen`.
4. Protect operational/admin schemas from public indexing, and ensure `X-Api-Key` and Bearer authentication are represented in the Authorize control.
5. Verify that `GET /api-docs` loads the UI and that its spec URL is same-origin and read-only.

The intended browser URL is:

```text
https://carbonledger.io/api-docs
```

The documented spec endpoint should be:

```text
https://carbonledger.io/api-docs-json
```
