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
  - `publicKey` (string, required, Stellar public key format)

**Response schema**:
```json
{
  "nonce": "carbonledger:abc123-def456",
  "expiresAt": "2026-06-01T12:34:56.000Z"
}
```

**Example cURL**:
```bash
curl -X GET "https://api.carbonledger.io/api/v1/auth/challenge?publicKey=GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE" \
  -H "Accept: application/json"
```

**Errors**:
- `400 Bad Request` - Invalid or missing publicKey
- `429 Too Many Requests` - Rate limit exceeded

#### `POST /api/v1/auth/verify`

- Auth: public
- Rate limit: 5 requests / 60 seconds per IP
- Body:
  - `publicKey` (string, required)
  - `signature` (string, required, signed challenge)

**Request schema**:
```json
{
  "publicKey": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
  "signature": "abcdef1234567890..."
}
```

**Response schema**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**Example cURL**:
```bash
curl -X POST "https://api.carbonledger.io/api/v1/auth/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
    "signature": "abcdef1234567890..."
  }'
```

**Errors**:
- `400 Bad Request` - Invalid challenge or signature
- `401 Unauthorized` - Challenge expired or signature verification failed
- `429 Too Many Requests` - Rate limit exceeded

#### `POST /api/v1/auth/refresh`

- Auth: bearer token (refresh token)
- Rate limit: 10 requests / 60 seconds per account

**Request schema**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response schema**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**Example cURL**:
```bash
curl -X POST "https://api.carbonledger.io/api/v1/auth/refresh" \
  -H "Authorization: Bearer <refresh_token>" \
  -H "Content-Type: application/json"
```

**Errors**:
- `401 Unauthorized` - Invalid or expired refresh token
- `429 Too Many Requests` - Rate limit exceeded

---

## Credits API

### `GET /api/v1/credits`

List carbon credits with pagination and filtering.

- Auth: required (bearer token)
- Rate limit: 60 requests / 60 seconds
- Query parameters:
  - `page` (integer, optional, default: 1)
  - `limit` (integer, optional, default: 20, max: 100)
  - `projectId` (string, optional)
  - `status` (enum, optional): `issued`, `retired`, `listed`
  - `vintageYearMin` (integer, optional)
  - `vintageYearMax` (integer, optional)
  - `sortBy` (enum, optional): `createdAt`, `vintageYear`, `amount` (default: `createdAt`)
  - `sortOrder` (enum, optional): `asc`, `desc` (default: `desc`)

**Response schema**:
```json
{
  "data": [
    {
      "id": "batch-uuid",
      "projectId": 1,
      "serialStart": 1000,
      "serialEnd": 1999,
      "amount": 1000,
      "vintageYear": 2024,
      "status": "issued",
      "createdAt": "2026-06-01T12:34:56.000Z",
      "txHash": "abcdef1234567890...",
      "metadata": {
        "issuer": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
        "beneficialOwner": "Acme Corp"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

**Example cURL**:
```bash
curl -X GET "https://api.carbonledger.io/api/v1/credits?page=1&limit=20&status=issued" \
  -H "Authorization: Bearer <access_token>" \
  -H "Accept: application/json"
```

**Errors**:
- `400 Bad Request` - Invalid query parameters
- `401 Unauthorized` - Missing or invalid bearer token
- `429 Too Many Requests` - Rate limit exceeded

### `POST /api/v1/credits/mint`

Issue new carbon credits for a project.

- Auth: required (must be project issuer)
- Rate limit: 30 requests / 60 seconds
- Body:
  - `projectId` (integer, required)
  - `serialStart` (integer, required, must be > 0)
  - `serialEnd` (integer, required, must be >= serialStart)
  - `vintageYear` (integer, required, 1990-current year)
  - `beneficialOwner` (string, optional, max 255 chars)

**Request schema**:
```json
{
  "projectId": 1,
  "serialStart": 2000,
  "serialEnd": 2999,
  "vintageYear": 2024,
  "beneficialOwner": "Acme Corp Sustainability Unit"
}
```

**Response schema**:
```json
{
  "id": "batch-uuid",
  "projectId": 1,
  "serialStart": 2000,
  "serialEnd": 2999,
  "amount": 1000,
  "vintageYear": 2024,
  "status": "pending",
  "txHash": "abc123def456...",
  "metadata": {
    "issuer": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
    "beneficialOwner": "Acme Corp Sustainability Unit"
  },
  "createdAt": "2026-06-01T12:34:56.000Z"
}
```

**Example cURL**:
```bash
curl -X POST "https://api.carbonledger.io/api/v1/credits/mint" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": 1,
    "serialStart": 2000,
    "serialEnd": 2999,
    "vintageYear": 2024,
    "beneficialOwner": "Acme Corp Sustainability Unit"
  }'
```

**Errors**:
- `400 Bad Request` - Invalid input (see validation below)
- `401 Unauthorized` - Not authorized to mint for this project
- `409 Conflict` - Serial range overlaps with existing range
- `422 Unprocessable Entity` - Project not verified or suspended
- `429 Too Many Requests` - Rate limit exceeded

**Input Validation**:
- `projectId`: Must be positive integer
- `serialStart`: Must be > 0
- `serialEnd`: Must be >= serialStart
- `serialEnd - serialStart + 1`: Must be <= 1,000,000,000 (MAX_BATCH_SIZE)
- `vintageYear`: Must be in range [1990, current_year]
- `beneficialOwner`: Must not contain SQL injection patterns or HTML tags

### `POST /api/v1/credits/retire`

Retire carbon credits (permanent removal from circulation).

- Auth: required (must own credits)
- Rate limit: 20 requests / 60 seconds
- Body:
  - `creditIds` (array of strings, required, min 1, max 100)
  - `reason` (string, optional, max 500 chars)

**Request schema**:
```json
{
  "creditIds": ["batch-uuid-1", "batch-uuid-2"],
  "reason": "Carbon offset for 2024 operations"
}
```

**Response schema**:
```json
{
  "retirementId": "retirement-uuid",
  "creditIds": ["batch-uuid-1", "batch-uuid-2"],
  "totalRetired": 2000,
  "status": "confirmed",
  "txHash": "abc123def456...",
  "createdAt": "2026-06-01T12:34:56.000Z",
  "certificateUrl": "https://cdn.carbonledger.io/certificates/retirement-uuid.pdf"
}
```

**Example cURL**:
```bash
curl -X POST "https://api.carbonledger.io/api/v1/credits/retire" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "creditIds": ["batch-uuid-1", "batch-uuid-2"],
    "reason": "Carbon offset for 2024 operations"
  }'
```

**Errors**:
- `400 Bad Request` - Invalid creditIds or reason
- `401 Unauthorized` - Not owner of credits
- `404 Not Found` - Credit batch not found
- `409 Conflict` - Credits already retired
- `422 Unprocessable Entity` - Invalid state for retirement
- `429 Too Many Requests` - Rate limit exceeded

### `POST /api/v1/credits/transfer`

Transfer credits to another Stellar account.

- Auth: required (must own credits)
- Rate limit: 20 requests / 60 seconds
- Body:
  - `creditIds` (array of strings, required)
  - `recipientAddress` (string, required, Stellar public key)

**Request schema**:
```json
{
  "creditIds": ["batch-uuid"],
  "recipientAddress": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE"
}
```

**Response schema**:
```json
{
  "transferId": "transfer-uuid",
  "creditIds": ["batch-uuid"],
  "totalAmount": 1000,
  "recipientAddress": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
  "status": "confirmed",
  "txHash": "abc123def456...",
  "createdAt": "2026-06-01T12:34:56.000Z"
}
```

**Example cURL**:
```bash
curl -X POST "https://api.carbonledger.io/api/v1/credits/transfer" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "creditIds": ["batch-uuid"],
    "recipientAddress": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE"
  }'
```

**Errors**:
- `400 Bad Request` - Invalid input
- `401 Unauthorized` - Not owner
- `404 Not Found` - Credit not found
- `422 Unprocessable Entity` - Invalid transfer state
- `429 Too Many Requests` - Rate limit exceeded

---

## Webhooks API

CarbonLedger sends real-time events to your application via webhooks. Subscribe to carbon credit lifecycle events including issuance, retirement, transfers, and certificate generation.

### Webhook Events

The following events are available:

- `credit.minted` - New credits issued for a project
- `credit.retired` - Credits permanently removed
- `credit.transferred` - Credits transferred between accounts
- `certificate.ready` - Retirement certificate generated and available
- `marketplace.listed` - Credits listed on marketplace
- `marketplace.delisted` - Credits removed from marketplace

### Event Payload Structure

All webhook events follow this structure:

```json
{
  "id": "event-uuid",
  "event": "credit.minted",
  "timestamp": "2026-06-01T12:34:56.000Z",
  "data": {
    "batchId": "batch-uuid",
    "projectId": 1,
    "amount": 1000,
    "vintageYear": 2024,
    "serialStart": 1000,
    "serialEnd": 1999,
    "issuer": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
    "txHash": "abc123def456..."
  }
}
```

### `POST /api/v1/webhooks/subscribe`

Register a new webhook subscription.

- Auth: required (bearer token)
- Rate limit: 10 requests / 60 seconds
- Body:
  - `url` (string, required, valid HTTPS URL)
  - `events` (array of strings, required, min 1)
  - `description` (string, optional, max 255 chars)

**Request schema**:
```json
{
  "url": "https://esg.example.com/webhooks/carbon-ledger",
  "events": ["credit.minted", "credit.retired", "certificate.ready"],
  "description": "ESG reporting system webhook"
}
```

**Response schema**:
```json
{
  "id": "webhook-sub-uuid",
  "url": "https://esg.example.com/webhooks/carbon-ledger",
  "events": ["credit.minted", "credit.retired", "certificate.ready"],
  "description": "ESG reporting system webhook",
  "secret": "whsec_1234567890abcdef...",
  "status": "active",
  "createdAt": "2026-06-01T12:34:56.000Z",
  "lastDeliveryAt": null,
  "failedDeliveryCount": 0
}
```

**Example cURL**:
```bash
curl -X POST "https://api.carbonledger.io/api/v1/webhooks/subscribe" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://esg.example.com/webhooks/carbon-ledger",
    "events": ["credit.minted", "credit.retired", "certificate.ready"],
    "description": "ESG reporting system webhook"
  }'
```

**Errors**:
- `400 Bad Request` - Invalid URL or event type
- `401 Unauthorized` - Missing or invalid bearer token
- `409 Conflict` - URL already subscribed to same events
- `429 Too Many Requests` - Rate limit exceeded

**Security**:
- URL must use HTTPS (TLS 1.2+)
- URL must resolve to a public IP (no private ranges)
- Timeout: 30 seconds per delivery attempt

### `GET /api/v1/webhooks/subscriptions`

List all active webhook subscriptions for authenticated user.

- Auth: required (bearer token)
- Rate limit: 60 requests / 60 seconds
- Query parameters:
  - `page` (integer, optional, default: 1)
  - `limit` (integer, optional, default: 20, max: 100)

**Response schema**:
```json
{
  "data": [
    {
      "id": "webhook-sub-uuid",
      "url": "https://esg.example.com/webhooks/carbon-ledger",
      "events": ["credit.minted", "credit.retired"],
      "description": "ESG reporting system",
      "status": "active",
      "failedDeliveryCount": 0,
      "createdAt": "2026-06-01T12:34:56.000Z",
      "lastDeliveryAt": "2026-06-02T10:15:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

**Example cURL**:
```bash
curl -X GET "https://api.carbonledger.io/api/v1/webhooks/subscriptions?page=1&limit=20" \
  -H "Authorization: Bearer <access_token>" \
  -H "Accept: application/json"
```

**Errors**:
- `401 Unauthorized` - Missing or invalid bearer token
- `429 Too Many Requests` - Rate limit exceeded

### `DELETE /api/v1/webhooks/subscriptions/{subscriptionId}`

Deactivate a webhook subscription (reversible).

- Auth: required (must own subscription)
- Rate limit: 20 requests / 60 seconds
- Path parameters:
  - `subscriptionId` (string, required)

**Response schema**:
```json
{
  "id": "webhook-sub-uuid",
  "status": "inactive",
  "deactivatedAt": "2026-06-02T12:34:56.000Z",
  "message": "Subscription deactivated successfully"
}
```

**Example cURL**:
```bash
curl -X DELETE "https://api.carbonledger.io/api/v1/webhooks/subscriptions/webhook-sub-uuid" \
  -H "Authorization: Bearer <access_token>"
```

**Errors**:
- `401 Unauthorized` - Not owner of subscription
- `404 Not Found` - Subscription not found
- `429 Too Many Requests` - Rate limit exceeded

### `GET /api/v1/webhooks/subscriptions/{subscriptionId}/deliveries`

View delivery attempt history for a subscription.

- Auth: required (must own subscription)
- Rate limit: 60 requests / 60 seconds
- Path parameters:
  - `subscriptionId` (string, required)
- Query parameters:
  - `page` (integer, optional, default: 1)
  - `limit` (integer, optional, default: 50, max: 100)
  - `status` (enum, optional): `success`, `failed`, `pending`

**Response schema**:
```json
{
  "data": [
    {
      "id": "delivery-uuid",
      "eventId": "event-uuid",
      "event": "credit.minted",
      "status": "success",
      "httpStatus": 200,
      "attempt": 1,
      "error": null,
      "deliveredAt": "2026-06-02T10:15:00.000Z"
    },
    {
      "id": "delivery-uuid-2",
      "eventId": "event-uuid-2",
      "event": "credit.retired",
      "status": "failed",
      "httpStatus": 500,
      "attempt": 3,
      "error": "Timeout after 30s",
      "deliveredAt": "2026-06-02T10:20:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 237,
    "totalPages": 5
  }
}
```

**Example cURL**:
```bash
curl -X GET "https://api.carbonledger.io/api/v1/webhooks/subscriptions/webhook-sub-uuid/deliveries?page=1&status=failed" \
  -H "Authorization: Bearer <access_token>" \
  -H "Accept: application/json"
```

**Errors**:
- `401 Unauthorized` - Not owner of subscription
- `404 Not Found` - Subscription not found
- `429 Too Many Requests` - Rate limit exceeded

### Webhook Delivery & Signature Verification

#### Delivery Guarantees

- **At-least-once delivery**: Events are retried up to 5 times over 24 hours
- **Exponential backoff**: 1m → 5m → 30m → 2h → 8h delays between retries
- **Dead-letter queue**: Failed events after final retry are stored (viewable via admin API)

#### HMAC Signature Verification

Every webhook request includes an HMAC-SHA256 signature for authentication:

**Headers**:
```
X-CarbonLedger-Signature: t=1623038400,v1=deadbeef1234567890abcdef
X-CarbonLedger-Event: credit.minted
X-CarbonLedger-Delivery-Timestamp: 1623038400
User-Agent: CarbonLedger-Webhook/1.0
```

**Verification algorithm**:
```typescript
import * as crypto from 'crypto';

function verifyWebhookSignature(
  payload: string,  // raw request body (before JSON parsing)
  signature: string,
  secret: string,
  timestamp: number,
  toleranceSeconds: number = 300
): boolean {
  // 1. Verify timestamp is recent (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  // 2. Create HMAC message: "{timestamp}.{payload}"
  const hmacMessage = `${timestamp}.${payload}`;

  // 3. Compute expected signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(hmacMessage)
    .digest('hex');

  // 4. Compare signatures (constant-time to prevent timing attacks)
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}
```

**Example webhook handler (Node.js/Express)**:
```javascript
const express = require('express');
const crypto = require('crypto');
const app = express();

app.post('/webhooks/carbon-ledger', express.raw({ type: 'application/json' }), (req, res) => {
  // Extract headers
  const signature = req.headers['x-carbonledger-signature'];
  const timestamp = parseInt(req.headers['x-carbonledger-delivery-timestamp'], 10);
  const event = req.headers['x-carbonledger-event'];

  // Verify signature
  const secret = process.env.WEBHOOK_SECRET;
  const payload = req.body.toString('utf-8');
  
  const [timestampStr, sig] = signature.split(',v1=');
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Verify timestamp (max 5 min old)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return res.status(401).json({ error: 'Request too old' });
  }

  // Process webhook
  const webhookData = JSON.parse(payload);
  console.log(`Received ${event} event:`, webhookData);

  // Respond quickly (2xx status code) to acknowledge receipt
  res.status(202).json({ received: true });

  // Process asynchronously (do not wait for completion)
  processWebhookEvent(event, webhookData).catch(err => {
    console.error('Webhook processing failed:', err);
  });
});

async function processWebhookEvent(event, data) {
  // Handle event...
}

app.listen(3000);
```

### Webhook Retry Policy

Failed deliveries are retried with exponential backoff:

| Attempt | Delay | Cumulative |
|---------|-------|-----------|
| 1 | Immediate | 0m |
| 2 | 1 minute | 1m |
| 3 | 5 minutes | 6m |
| 4 | 30 minutes | 36m |
| 5 | 2 hours | 2h 36m |
| Final | 8 hours | 10h 36m |

After the final retry fails, the event is moved to the dead-letter queue. Admin APIs provide access to review and manually retry failed events.

---

## Projects API

### `GET /api/v1/projects`

List verified carbon projects.

- Auth: optional (bearer token for extended info)
- Rate limit: 100 requests / 60 seconds
- Query parameters:
  - `page` (integer, optional, default: 1)
  - `limit` (integer, optional, default: 20, max: 100)
  - `status` (enum, optional): `verified`, `pending`, `suspended`
  - `search` (string, optional, fulltext search on name/description)

**Response schema**:
```json
{
  "data": [
    {
      "id": 1,
      "name": "Forest Conservation Initiative",
      "description": "Reforestation project in Amazon",
      "verifiedTonnes": 50000,
      "issuedCredits": 45000,
      "retiredCredits": 15000,
      "status": "verified",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "issuer": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

**Example cURL**:
```bash
curl -X GET "https://api.carbonledger.io/api/v1/projects?status=verified" \
  -H "Accept: application/json"
```

**Errors**:
- `400 Bad Request` - Invalid query parameters
- `429 Too Many Requests` - Rate limit exceeded

### `POST /api/v1/projects`

Create a new carbon project (requires admin approval).

- Auth: required (bearer token)
- Rate limit: 5 requests / 60 seconds
- Body:
  - `name` (string, required, 3-200 chars)
  - `description` (string, required, 20-2000 chars)
  - `location` (string, required)
  - `methodology` (string, required)

**Request schema**:
```json
{
  "name": "Forest Conservation Initiative",
  "description": "Large-scale reforestation project in Brazilian Amazon",
  "location": "Amazon Basin, Brazil",
  "methodology": "VCS Carbon Credits Standard v4.3"
}
```

**Response schema**:
```json
{
  "id": 1,
  "name": "Forest Conservation Initiative",
  "status": "pending_review",
  "createdAt": "2026-06-01T12:34:56.000Z"
}
```

**Example cURL**:
```bash
curl -X POST "https://api.carbonledger.io/api/v1/projects" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Forest Conservation Initiative",
    "description": "Large-scale reforestation project in Brazilian Amazon",
    "location": "Amazon Basin, Brazil",
    "methodology": "VCS Carbon Credits Standard v4.3"
  }'
```

**Errors**:
- `400 Bad Request` - Invalid input
- `401 Unauthorized` - Missing bearer token
- `422 Unprocessable Entity` - Validation failed
- `429 Too Many Requests` - Rate limit exceeded

---

## Error Codes Reference

| Code | HTTP Status | Description | Recovery |
|------|------------|-------------|----------|
| `INVALID_INPUT` | 400 | Request validation failed (see details) | Fix input and retry |
| `UNAUTHORIZED` | 401 | Missing or invalid credentials | Obtain valid token via auth endpoints |
| `FORBIDDEN` | 403 | Insufficient permissions for action | Use authorized account |
| `NOT_FOUND` | 404 | Resource does not exist | Verify resource ID |
| `CONFLICT` | 409 | Serial range overlap or duplicate subscription | Check existing ranges/subscriptions |
| `RATE_LIMITED` | 429 | Rate limit exceeded | Wait and retry (see retry-after header) |
| `UNPROCESSABLE_ENTITY` | 422 | Business logic validation failed | See details field for reason |
| `INTERNAL_ERROR` | 500 | Server error (rare, idempotent if 202 was returned) | Retry with exponential backoff |

### Response Error Format

All error responses follow this structure:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Validation failed",
    "details": [
      {
        "field": "serialStart",
        "issue": "Must be greater than 0"
      },
      {
        "field": "beneficialOwner",
        "issue": "Contains invalid HTML: <script>"
      }
    ],
    "requestId": "req-123-456",
    "timestamp": "2026-06-01T12:34:56.000Z"
  }
}
```

---

## Input Validation & Security

### SQL Injection Prevention

All string inputs are validated against SQL injection patterns:

**Blocked patterns**:
- `' OR '1'='1`
- `; DROP TABLE`
- `--` (SQL comments)
- `/*` and `*/` (multi-line comments)
- `xp_`, `sp_` (stored procedures)

**Implementation**: Parameterized queries via Prisma ORM (no raw SQL)

### XSS (Cross-Site Scripting) Protection

HTML/JavaScript patterns are sanitized from user inputs:

**Blocked patterns**:
- `<script>`, `</script>`
- `<iframe>`, `</iframe>`
- `onclick=`, `onerror=`, `onload=` (event handlers)
- `javascript:` protocol

**Sanitization**: DOMPurify library + Content Security Policy headers

### Beneficial Owner Field

The `beneficialOwner` field specifically validates:
- Max length: 255 characters
- Allowed: alphanumeric, spaces, hyphens, apostrophes, periods
- Blocked: HTML tags, SQL keywords, script patterns

**Valid**:
- "Acme Corporation Inc."
- "John O'Brien-Smith"
- "XYZ Ltd."

**Invalid**:
- "Acme<script>alert('xss')</script>"
- "Acme'; DROP TABLE"

---

## Rate Limiting

CarbonLedger uses token-bucket rate limiting. Limits apply per:
- **Public endpoints**: Per IP address
- **Authenticated endpoints**: Per user account
- **Webhook deliveries**: Per subscription

**Response headers**:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 47
X-RateLimit-Reset: 1623038400
Retry-After: 25
```

When rate limit is exceeded (HTTP 429):
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retryAfter": 25
  }
}
```

Recommended backoff strategy: Wait `Retry-After` seconds before retrying.

---

## Pagination

List endpoints support cursor-based and offset-based pagination:

**Offset pagination** (simpler, less efficient for large datasets):
```
GET /api/v1/credits?page=2&limit=50
```

**Cursor pagination** (recommended for production):
```
GET /api/v1/credits?cursor=next-cursor&limit=50
```

Response includes:
```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 50,
    "total": 10000,
    "totalPages": 200,
    "cursors": {
      "next": "abcd1234...",
      "prev": "xyz9876..."
    }
  }
}
```

---

## Versioning

API version is specified via the `Accept-Version` header (optional, defaults to latest):

```
Accept-Version: 1
```

Currently supported versions: **1** (latest)

Future changes will require explicit version bump. Legacy versions will be supported for ≥2 major.minor releases.

---

## Support & Feedback

- **API Documentation**: https://api-docs.carbonledger.io
- **GitHub Issues**: https://github.com/carbonledger/carbonledger/issues
- **Email Support**: api-support@carbonledger.io
- **Status Page**: https://status.carbonledger.io
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
