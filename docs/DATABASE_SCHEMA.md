# CarbonLedger Database Schema Reference

This document describes every table, field, relationship, and index in the CarbonLedger PostgreSQL database. It serves as the authoritative reference for the application's persistent data model.

## Overview

The database is organized into four functional domains:

1. **Core Assets** — Projects, credits, retirements, marketplace listings
2. **Temporal History** — Full audit trail for compliance and point-in-time queries
3. **Observability** — Audit logs, oracle sync state, event logs
4. **Infrastructure** — Jobs, webhooks, idempotency, API keys

### Key Design Principles

- **Immutability where possible** — CreditEvent, RetirementRecord, and history tables are append-only
- **Soft deletes** — Use `deletedAt` + `retentionUntil` for GDPR compliance
- **Temporal versioning** — `started_at` and `ended_at` track state transitions
- **Decimal(18,2) for currency** — All carbon credits and prices use fixed-point arithmetic
- **HMAC signatures** — Audit logs and credit events are signed for tamper detection
- **Indexes for common queries** — Every WHERE clause and JOIN is indexed

---

## Core Assets Domain

### CarbonProject

**Purpose:** Project metadata, verification status, and aggregate credit statistics.

| Field | Type | Nullable | Constraints | Purpose |
|-------|------|----------|-------------|---------|
| id | CUID | NOT NULL | PRIMARY KEY | Internal database ID |
| projectId | String | NOT NULL | UNIQUE | External identifier (e.g., "proj-stellar-01") |
| name | String | NOT NULL | | Human-readable project name |
| description | Text | NULLABLE | | Markdown-formatted project description |
| methodology | String | NOT NULL | | Verification methodology (e.g., "Verra VCS") |
| country | String | NOT NULL | | ISO country code (e.g., "US", "BR") |
| projectType | String | NOT NULL | | Type of mitigation (e.g., "Wind Farm", "Forestry") |
| status | String | NOT NULL | DEFAULT("Pending") | Pending / Approved / Rejected / Active |
| vintageYear | Int | NOT NULL | | First year of credit eligibility |
| methodologyScore | Int | NOT NULL | | Verification score (1-100) |
| totalCreditsIssued | Decimal(18,2) | NOT NULL | DEFAULT(0) | Aggregate issuance (one-time value) |
| totalCreditsRetired | Decimal(18,2) | NOT NULL | DEFAULT(0) | Aggregate retirement (sum of retirements) |
| metadataCid | String | NOT NULL | | IPFS CID of project metadata |
| metadataHash | String | NULLABLE | | Keccak256 hash of metadata for verification |
| verifierAddress | String | NOT NULL | | Stellar public key of verifier |
| ownerAddress | String | NOT NULL | | Stellar public key of project owner |
| coordinates | JSON | NULLABLE | | GeoJSON point for map visualization |
| migrationVersion | String | NULLABLE | | Version tag if migrated from legacy system |
| lastMonitoringAt | DateTime | NULLABLE | | Timestamp of most recent monitoring submission |
| deletedAt | DateTime | NULLABLE | | Soft delete timestamp |
| deletionReason | String | NULLABLE | | Reason for deletion (compliance, fraud, etc.) |
| retentionUntil | DateTime | NULLABLE | | GDPR retention deadline; after this, purge anonymized data |
| started_at | DateTime | NOT NULL | DEFAULT(now()) | When this version became active |
| ended_at | DateTime | NULLABLE | | When this version ended (null = current) |
| createdAt | DateTime | NOT NULL | DEFAULT(now()) | Record creation timestamp |
| updatedAt | DateTime | NOT NULL | DEFAULT(now()) | Record last update timestamp |

**Relationships:**
- ←→ CreditBatch (1:N) — a project has many credit batches
- ←→ RetirementRecord (1:N) — a project has many retirement records
- ←→ MarketListing (1:N) — a project has many marketplace listings
- ←→ MonitoringData (1:N) — a project receives many monitoring submissions
- ←→ IPFSFile (1:N) — a project may have multiple attached files

**Indexes:**
```sql
CREATE INDEX idx_CarbonProject_methodology ON "CarbonProject"(methodology);
CREATE INDEX idx_CarbonProject_country ON "CarbonProject"(country);
CREATE INDEX idx_CarbonProject_status ON "CarbonProject"(status);
CREATE INDEX idx_CarbonProject_vintage ON "CarbonProject"(vintageYear);
CREATE INDEX idx_CarbonProject_created ON "CarbonProject"(createdAt);
CREATE INDEX idx_CarbonProject_compound ON "CarbonProject"(methodology, country, status);
CREATE INDEX idx_CarbonProject_temporal ON "CarbonProject"(started_at, ended_at);
```

**Example Query:**
```sql
-- Find all active projects in Brazil with Verra methodology
SELECT * FROM "CarbonProject"
WHERE country = 'BR' AND methodology = 'Verra VCS' AND status = 'Active'
  AND (ended_at IS NULL OR ended_at > now())
ORDER BY createdAt DESC;
```

---

### CreditBatch

**Purpose:** Tracks the issuance of a batch of carbon credits with serial number ranges.

| Field | Type | Nullable | Constraints | Purpose |
|-------|------|----------|-------------|---------|
| id | CUID | NOT NULL | PRIMARY KEY | Internal database ID |
| batchId | String | NOT NULL | UNIQUE | External batch identifier |
| projectId | String | NOT NULL | FOREIGN KEY | Reference to CarbonProject.projectId |
| vintageYear | Int | NOT NULL | | Year these credits were earned |
| amount | Decimal(18,2) | NOT NULL | | Total credits in batch (e.g., 10000.00) |
| serialStart | String | NOT NULL | | First serial number (e.g., "SERIAL-0001") |
| serialEnd | String | NOT NULL | | Last serial number (e.g., "SERIAL-10000") |
| status | String | NOT NULL | DEFAULT("Active") | Active / Retired / Burned / Delisted |
| metadataCid | String | NOT NULL | | IPFS CID of batch metadata |
| issuedAt | DateTime (TZ) | NOT NULL | DEFAULT(now()) | Timestamp batch was minted on-chain |
| deletedAt | DateTime | NULLABLE | | Soft delete timestamp |
| started_at | DateTime | NOT NULL | DEFAULT(now()) | When this version became active |
| ended_at | DateTime | NULLABLE | | When this version ended (null = current) |

**Relationships:**
- ←→ CarbonProject (N:1) — many batches belong to one project
- ←→ RetirementRecord (1:N) — a batch may have many retirement records (partial/full retirement)
- ←→ MarketListing (1:N) — a batch may have many marketplace listings
- ←→ IPFSFile (1:N) — a batch may have metadata files attached

**Indexes:**
```sql
CREATE INDEX idx_CreditBatch_projectId_vintage ON "CreditBatch"(projectId, vintageYear, status);
CREATE INDEX idx_CreditBatch_deletedAt ON "CreditBatch"(deletedAt);
CREATE INDEX idx_CreditBatch_temporal ON "CreditBatch"(started_at, ended_at);
```

**Example Query:**
```sql
-- Find all active credit batches for a project
SELECT * FROM "CreditBatch"
WHERE projectId = 'proj-stellar-01'
  AND status = 'Active'
  AND (ended_at IS NULL OR ended_at > now())
ORDER BY issuedAt DESC;
```

---

### RetirementRecord

**Purpose:** Immutable record of a carbon credit retirement (permanent removal from circulation).

| Field | Type | Nullable | Constraints | Purpose |
|-------|------|----------|-------------|---------|
| id | CUID | NOT NULL | PRIMARY KEY | Internal database ID |
| retirementId | String | NOT NULL | UNIQUE | External retirement identifier |
| batchId | String | NOT NULL | FOREIGN KEY | Reference to CreditBatch.batchId |
| projectId | String | NOT NULL | FOREIGN KEY | Reference to CarbonProject.projectId |
| amount | Decimal(18,2) | NOT NULL | | Credits retired (may be < batch amount) |
| retiredBy | String | NOT NULL | | Stellar public key who initiated retirement |
| beneficiary | String | NOT NULL | | Entity on whose behalf credits were retired |
| retirementReason | String | NOT NULL | | Reason for retirement (e.g., "ESG compliance") |
| vintageYear | Int | NOT NULL | | Vintage year of credits retired |
| serialStart | String | NOT NULL | | First serial number retired |
| serialEnd | String | NOT NULL | | Last serial number retired |
| serialNumbers | String[] | NOT NULL | | Array of all retired serial numbers |
| txHash | String | NOT NULL | | Stellar transaction hash of retirement |
| certificateCid | String | NULLABLE | | IPFS CID of retirement certificate (PDF) |
| certificateUrl | String | NULLABLE | | Public HTTPS URL to certificate |
| certificateContentCid | String | NULLABLE | | IPFS CID of certificate JSON content |
| certificateContentHash | String | NULLABLE | | SHA-256 hex of certificate content |
| certificateStatus | String | NOT NULL | DEFAULT("pending_certificate") | pending / generated / failed |
| certificateRetries | Int | NOT NULL | DEFAULT(0) | Number of certificate generation attempts |
| certificateFailedAt | DateTime | NULLABLE | | Last certificate generation failure time |
| certificateGeneratedAt | DateTime | NULLABLE | | When certificate was successfully generated |
| legacyStatus | String | NULLABLE | | Status if migrated from legacy system |
| isValid | Boolean | NOT NULL | DEFAULT(true) | Whether retirement is cryptographically valid |
| validatedAt | DateTime | NULLABLE | | When validity was last checked |
| retiredAt | DateTime | NOT NULL | DEFAULT(now()) | When retirement was recorded |
| deletedAt | DateTime | NULLABLE | | Soft delete timestamp |
| started_at | DateTime | NOT NULL | DEFAULT(now()) | When this version became active |
| ended_at | DateTime | NULLABLE | | When this version ended (null = current) |

**Relationships:**
- ←→ CreditBatch (N:1) — many retirements from one batch
- ←→ CarbonProject (N:1) — many retirements per project
- ←→ RetirementCertificate (1:1) — one certificate per retirement
- ←→ ZkRetirementProof (1:1) — optional zero-knowledge proof
- ←→ IPFSFile (1:N) — may have attached supporting documents

**Indexes:**
```sql
CREATE INDEX idx_RetirementRecord_deletedAt ON "RetirementRecord"(deletedAt);
CREATE INDEX idx_RetirementRecord_projectId_retiredAt ON "RetirementRecord"(projectId, retiredAt);
CREATE INDEX idx_RetirementRecord_retiredBy_retiredAt ON "RetirementRecord"(retiredBy, retiredAt);
CREATE INDEX idx_RetirementRecord_certificateContentCid ON "RetirementRecord"(certificateContentCid);
CREATE INDEX idx_RetirementRecord_temporal ON "RetirementRecord"(started_at, ended_at);
```

**Example Query:**
```sql
-- Find all retirements by user in the last 30 days
SELECT * FROM "RetirementRecord"
WHERE retiredBy = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
  AND retiredAt > now() - interval '30 days'
  AND (ended_at IS NULL OR ended_at > now())
ORDER BY retiredAt DESC;
```

---

### MarketListing

**Purpose:** Allows sellers to list credit batches for sale on the marketplace.

| Field | Type | Nullable | Constraints | Purpose |
|-------|------|----------|-------------|---------|
| id | CUID | NOT NULL | PRIMARY KEY | Internal database ID |
| listingId | String | NOT NULL | UNIQUE | External listing identifier |
| projectId | String | NOT NULL | FOREIGN KEY | Project the credits are from |
| batchId | String | NOT NULL | FOREIGN KEY | Batch being listed |
| seller | String | NOT NULL | | Stellar public key of seller |
| amountAvailable | Decimal(18,2) | NOT NULL | | How many credits available (≤ batch amount) |
| pricePerCredit | String | NOT NULL | | Price in stroops per credit (may be decimal string) |
| vintageYear | Int | NOT NULL | | Vintage year of credits |
| methodology | String | NOT NULL | | Methodology (cached from project for search performance) |
| country | String | NOT NULL | | Country (cached from project for search performance) |
| status | String | NOT NULL | DEFAULT("Active") | Active / Partial / Sold / Delisted |
| createdAt | DateTime | NOT NULL | DEFAULT(now()) | When listing was created |
| updatedAt | DateTime | NOT NULL | DEFAULT(now()) | When listing was last updated |
| deletedAt | DateTime | NULLABLE | | Soft delete timestamp |

**Relationships:**
- ←→ CarbonProject (N:1) — many listings per project
- ←→ CreditBatch (N:1) — many listings per batch

**Indexes:**
```sql
CREATE INDEX idx_MarketListing_composite ON "MarketListing"(methodology, vintageYear, status, pricePerCredit);
CREATE INDEX idx_MarketListing_seller_status ON "MarketListing"(seller, status);
CREATE INDEX idx_MarketListing_deletedAt ON "MarketListing"(deletedAt);
CREATE INDEX idx_MarketListing_status_created ON "MarketListing"(status, createdAt DESC);
```

**Example Query:**
```sql
-- Find cheapest listings for a specific methodology/vintage
SELECT * FROM "MarketListing"
WHERE methodology = 'Verra VCS' AND vintageYear = 2024
  AND status = 'Active'
  AND (deletedAt IS NULL)
ORDER BY pricePerCredit ASC
LIMIT 10;
```

---

## Temporal History Domain

### CarbonProjectHistory

**Purpose:** Append-only snapshot of every state change to a CarbonProject. Enables point-in-time queries and compliance audits.

| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| id | CUID | NOT NULL | Unique history entry ID |
| projectId | String | NOT NULL | Which project this version is for |
| name → deletionReason | (all project fields) | | Full snapshot of project state at this version |
| started_at | DateTime | NOT NULL | When this version became active |
| ended_at | DateTime | NULLABLE | When this version ended (null = current) |

**Indexes:**
```sql
CREATE INDEX idx_CarbonProjectHistory_projectId_start ON "CarbonProjectHistory"(projectId, started_at);
CREATE INDEX idx_CarbonProjectHistory_temporal ON "CarbonProjectHistory"(started_at, ended_at);
CREATE INDEX idx_CarbonProjectHistory_ended ON "CarbonProjectHistory"(ended_at) WHERE ended_at IS NOT NULL;
```

**Example Query (Point-in-Time):**
```sql
-- What was the status of this project on June 1, 2026?
SELECT * FROM "CarbonProjectHistory"
WHERE projectId = 'proj-stellar-01'
  AND started_at <= '2026-06-01'::timestamp
  AND (ended_at IS NULL OR ended_at > '2026-06-01'::timestamp)
LIMIT 1;
```

**Example Query (Full History):**
```sql
-- Show all status changes for a project
SELECT projectId, status, started_at, ended_at
FROM "CarbonProjectHistory"
WHERE projectId = 'proj-stellar-01'
ORDER BY started_at ASC;
```

---

### CreditBatchHistory

**Purpose:** Append-only snapshot of every state change to a CreditBatch.

| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| id | CUID | NOT NULL | Unique history entry ID |
| batchId | String | NOT NULL | Which batch this version is for |
| projectId | String | NOT NULL | Which project owns this batch |
| (all batch fields) | | | Full snapshot of batch state at this version |
| started_at | DateTime | NOT NULL | When this version became active |
| ended_at | DateTime | NULLABLE | When this version ended (null = current) |

**Indexes:**
```sql
CREATE INDEX idx_CreditBatchHistory_batchId_start ON "CreditBatchHistory"(batchId, started_at);
CREATE INDEX idx_CreditBatchHistory_projectId_start ON "CreditBatchHistory"(projectId, started_at);
CREATE INDEX idx_CreditBatchHistory_temporal ON "CreditBatchHistory"(started_at, ended_at);
CREATE INDEX idx_CreditBatchHistory_ended ON "CreditBatchHistory"(ended_at) WHERE ended_at IS NOT NULL;
```

---

### RetirementRecordHistory

**Purpose:** Append-only snapshot of every state change to a RetirementRecord.

| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| id | CUID | NOT NULL | Unique history entry ID |
| retirementId | String | NOT NULL | Which retirement this version is for |
| (all retirement fields) | | | Full snapshot of retirement state at this version |
| started_at | DateTime | NOT NULL | When this version became active |
| ended_at | DateTime | NULLABLE | When this version ended (null = current) |

**Indexes:**
```sql
CREATE INDEX idx_RetirementRecordHistory_retirementId ON "RetirementRecordHistory"(retirementId, started_at);
CREATE INDEX idx_RetirementRecordHistory_projectId ON "RetirementRecordHistory"(projectId, started_at);
CREATE INDEX idx_RetirementRecordHistory_ended ON "RetirementRecordHistory"(ended_at) WHERE ended_at IS NOT NULL;
```

---

## Observability Domain

### AuditLog

**Purpose:** Chronological record of all significant actions (mutations, state changes). Tamper-protected with HMAC-SHA256 hash chain.

| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| id | CUID | NOT NULL | Unique log entry ID |
| userId | String | NULLABLE | User who performed the action (null for system) |
| action | String | NOT NULL | Action type (e.g., "project.approved", "credit.retired") |
| resourceId | String | NULLABLE | ID of the resource affected (project ID, retirement ID) |
| ipAddress | String | NULLABLE | IP address of client |
| result | String | NULLABLE | Outcome (e.g., "Success", "Failure: validation error") |
| metadata | JSON | NULLABLE | Additional context (e.g., status before/after) |
| timestamp | DateTime | NOT NULL | When action occurred |
| previousHash | String | NULLABLE | SHA-256 of previous entry's entryHash (forms hash chain) |
| entryHash | String | NULLABLE | SHA-256 of this entry's canonical JSON |

**Hash Chain Design:**
To detect tampering, each entry's hash includes the previous entry's hash:
```
Entry 1: entryHash = SHA256(userId + action + timestamp + ... + null)
Entry 2: entryHash = SHA256(userId + action + timestamp + ... + Entry1.entryHash)
Entry 3: entryHash = SHA256(userId + action + timestamp + ... + Entry2.entryHash)
```

If any entry is modified retroactively, all subsequent hashes break.

**Indexes:**
```sql
CREATE INDEX idx_AuditLog_userId ON "AuditLog"(userId);
CREATE INDEX idx_AuditLog_action ON "AuditLog"(action);
CREATE INDEX idx_AuditLog_resourceId ON "AuditLog"(resourceId);
CREATE INDEX idx_AuditLog_timestamp ON "AuditLog"(timestamp);
CREATE INDEX idx_AuditLog_entryHash ON "AuditLog"(entryHash);
```

**Example Query:**
```sql
-- Who approved this project and when?
SELECT userId, timestamp, metadata
FROM "AuditLog"
WHERE action = 'project.approved' AND resourceId = 'proj-stellar-01'
ORDER BY timestamp DESC
LIMIT 1;
```

---

### CreditEvent

**Purpose:** Append-only event log of every credit mutation (mint, transfer, retire, list, delist). Tamper-protected with HMAC-SHA256 signature.

| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| id | CUID | NOT NULL | Unique event ID |
| creditBatchId | String | NOT NULL | Which batch was affected |
| eventType | String | NOT NULL | Event type (mint/transfer/retire/list/delist) |
| actor | String | NOT NULL | Stellar public key who triggered event |
| oldState | JSON | NULLABLE | Snapshot before mutation (e.g., status=Active) |
| newState | JSON | NULLABLE | Snapshot after mutation (e.g., status=Retired) |
| timestamp | DateTime | NOT NULL | When event occurred |
| txHash | String | NOT NULL | Stellar transaction hash (or deterministic stub) |
| signature | String | NOT NULL | HMAC-SHA256(id + batchId + eventType + actor + timestamp + txHash) |

**Signature Verification:**
Consumers can recompute the signature to verify the event was not modified:
```typescript
const expectedSignature = hmacSha256(
  `${event.id}${event.creditBatchId}${event.eventType}${event.actor}${event.timestamp}${event.txHash}`,
  HMAC_SECRET
);
if (expectedSignature !== event.signature) {
  throw new Error('Event was tampered with');
}
```

**Indexes:**
```sql
CREATE INDEX idx_CreditEvent_batchId ON "CreditEvent"(creditBatchId);
CREATE INDEX idx_CreditEvent_timestamp ON "CreditEvent"(timestamp);
CREATE INDEX idx_CreditEvent_batchId_timestamp ON "CreditEvent"(creditBatchId, timestamp);
```

---

## Infrastructure Domain

### User

**Purpose:** Registered users of the platform (project developers, verifiers, corporations).

| Field | Type | Nullable | Constraints | Purpose |
|-------|------|----------|-------------|---------|
| id | CUID | NOT NULL | PRIMARY KEY | Internal user ID |
| publicKey | String | NOT NULL | UNIQUE | Stellar public key (GXXX...) |
| email | String | NULLABLE | UNIQUE | Optional email for notifications |
| role | String | NOT NULL | DEFAULT("corporation") | project_developer / verifier / corporation / admin |
| isSubscribed | Boolean | NOT NULL | DEFAULT(true) | Whether user wants email notifications |
| deletedAt | DateTime | NULLABLE | | Soft delete timestamp |
| deletionReason | String | NULLABLE | | Reason for deletion |
| retentionUntil | DateTime | NULLABLE | | GDPR retention deadline |
| createdAt | DateTime | NOT NULL | DEFAULT(now()) | Account creation time |

**Relationships:**
- ←→ NotificationPreference (1:1) — user's email notification settings

---

### ApiKey

**Purpose:** Long-lived API credentials for corporate integrations.

| Field | Type | Nullable | Constraints | Purpose |
|-------|------|----------|-------------|---------|
| id | CUID | NOT NULL | PRIMARY KEY | Internal key ID |
| key | String | NOT NULL | UNIQUE, INDEXED | The actual API key (bcrypt-hashed in prod) |
| organizationName | String | NOT NULL | | Name of organization |
| contactEmail | String | NOT NULL | | Contact for key support |
| isActive | Boolean | NOT NULL | DEFAULT(true) | Whether key is enabled |
| createdAt | DateTime | NOT NULL | DEFAULT(now()) | When key was issued |

**Rate Limiting:**
- API key endpoints: 1000 requests per 24 hours per key

---

### IdempotencyRecord

**Purpose:** Caches responses for critical mutating endpoints to allow safe retries. TTL = 24 hours.

| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| id | CUID | NOT NULL | Internal record ID |
| idempotencyKey | String | NOT NULL | Client-supplied Idempotency-Key header |
| endpoint | String | NOT NULL | Normalized endpoint (e.g., "POST:/api/v1/credits/mint") |
| requestHash | String | NOT NULL | SHA-256 of request body (detects changed body) |
| responseStatus | Int | NOT NULL | HTTP status of cached response |
| responseBody | String | NOT NULL | Cached response body |
| txHash | String | NULLABLE | Stellar transaction hash if operation created one |
| createdAt | DateTime | NOT NULL | When record was created |

**Unique Constraint:**
```sql
UNIQUE(idempotencyKey, endpoint)
```

Allows same key to be reused across different endpoints without collision.

**Example Usage:**
```typescript
POST /api/v1/credits/mint
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

// If request fails (network error, timeout), client retries:
POST /api/v1/credits/mint
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

// Backend checks IdempotencyRecord:
// If record exists with SAME requestHash, return cached response
// If record exists with DIFFERENT requestHash, return 422 (request body mismatch)
// If no record, process request and cache response
```

---

### OracleSubmissionNonce

**Purpose:** Idempotency ledger for oracle submissions. One row per logical submission; replay conflicts on insert.

| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| submissionId | Char(64) | NOT NULL | SHA-256(canonical_json(payload)) — identical payloads have identical IDs |
| service | VarChar(50) | NOT NULL | Service name (e.g., "verification_listener") |
| functionName | VarChar(100) | NOT NULL | Function being invoked (e.g., "record_monitoring") |
| payloadHash | Char(64) | NOT NULL | SHA-256 of payload |
| nonce | BigInt | NOT NULL, UNIQUE | Allocated once per submission; reused across retries |
| status | VarChar(20) | NOT NULL | pending / submitted / failed |
| txHash | VarChar(200) | NULLABLE | Stellar transaction hash once submitted |
| createdAt | TimestampTZ | NOT NULL | Submission timestamp |
| updatedAt | TimestampTZ | NOT NULL | Last status update |

**Nonce Reuse Pattern:**
```sql
-- Oracle submits: payload X with nonce 12345
INSERT INTO oracle_submission_nonces (submission_id, nonce, status) VALUES (..., 12345, 'pending');

-- Submission times out; oracle retries the SAME payload:
-- submissionId is identical → insert fails (duplicate key) OR returns existing nonce
SELECT nonce FROM oracle_submission_nonces WHERE submission_id = $1;
-- Reuse nonce 12345 for retry

-- On-chain contract validates nonce:
// If nonce has been used before, reject with InvalidNonce error
// This prevents double-submission
```

---

### WebhookSubscription & WebhookDeliveryLog

**Purpose:** Event-driven webhooks for corporate ESG platforms.

**WebhookSubscription:**
| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| id | CUID | NOT NULL | Subscription ID |
| ownerAddress | String | NOT NULL | Stellar public key of subscriber |
| url | String | NOT NULL | HTTPS endpoint to POST events to |
| secret | String | NOT NULL | Shared secret for HMAC-SHA256 signing |
| events | String[] | NOT NULL | Which events to subscribe to (e.g., ["retirement.confirmed"]) |
| active | Boolean | NOT NULL | Whether subscription is enabled |
| createdAt | DateTime | NOT NULL | When subscription was created |

**WebhookDeliveryLog:**
| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| id | CUID | NOT NULL | Delivery attempt ID |
| subscriptionId | String | NOT NULL | Which subscription this belongs to |
| eventType | String | NOT NULL | Which event was delivered |
| url | String | NOT NULL | Where event was sent |
| statusCode | Int | NULLABLE | HTTP status code (null if connection failed) |
| responseBody | String | NULLABLE | Response body (for debugging failed deliveries) |
| success | Boolean | NOT NULL | Whether delivery succeeded |
| attempt | Int | NOT NULL | Attempt number (1, 2, 3, ...) |
| error | String | NULLABLE | Error message if failed |
| timestamp | DateTime | NOT NULL | When delivery was attempted |

**Delivery Policy:**
- Exponential backoff: retry at 1min, 5min, 15min, 1hr, 4hr, then give up
- Max 5 retries per event
- Log every attempt for debugging

---

## Schema Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                   CORE ASSETS DOMAIN                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐        ┌──────────────────┐                │
│  │  CarbonProject  │        │   CreditBatch    │                │
│  ├─────────────────┤        ├──────────────────┤                │
│  │ projectId (PK)  │───────▶│ batchId (PK)     │                │
│  │ name            │    1:N │ projectId (FK)   │                │
│  │ methodology     │        │ amount           │                │
│  │ country         │        │ serialStart/End  │                │
│  │ status          │        │ started_at       │                │
│  │ totalCredits... │        │ ended_at         │                │
│  │ started_at      │        └──────────────────┘                │
│  │ ended_at        │                │                            │
│  └─────────────────┘                │                            │
│         │                           │ 1:N                        │
│    1:N  │                           │                            │
│         │                    ┌──────▼────────────────┐           │
│         │                    │  RetirementRecord     │           │
│         │                    ├──────────────────────┤           │
│         │                    │ retirementId (PK)    │           │
│         │                    │ batchId (FK)         │           │
│         │                    │ amount               │           │
│         │                    │ retiredBy            │           │
│         │                    │ certificateStatus    │           │
│         │                    │ started_at           │           │
│         │                    │ ended_at             │           │
│         │                    └──────────────────────┘           │
│         │                                                         │
│         └──────────────┬──────────────────────────┘              │
│                        │                                          │
│                   1:N  │                                          │
│                        │                                          │
│                    ┌───▼──────────────┐                          │
│                    │  MarketListing   │                          │
│                    ├──────────────────┤                          │
│                    │ listingId (PK)   │                          │
│                    │ batchId (FK)     │                          │
│                    │ pricePerCredit   │                          │
│                    │ status           │                          │
│                    └──────────────────┘                          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 TEMPORAL HISTORY DOMAIN                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────┐                                      │
│  │ CarbonProjectHistory   │    (Append-only snapshots)          │
│  ├────────────────────────┤                                      │
│  │ (all CarbonProject ... │                                      │
│  │  fields)               │                                      │
│  │ started_at             │                                      │
│  │ ended_at (null=current)│                                      │
│  └────────────────────────┘                                      │
│                                                                   │
│  ┌────────────────────────┐                                      │
│  │ CreditBatchHistory     │    (Append-only snapshots)          │
│  ├────────────────────────┤                                      │
│  │ (all CreditBatch ...   │                                      │
│  │  fields)               │                                      │
│  │ started_at             │                                      │
│  │ ended_at (null=current)│                                      │
│  └────────────────────────┘                                      │
│                                                                   │
│  ┌────────────────────────┐                                      │
│  │RetirementRecordHistory │    (Append-only snapshots)          │
│  ├────────────────────────┤                                      │
│  │ (all RetirementRecord..│                                      │
│  │  fields)               │                                      │
│  │ started_at             │                                      │
│  │ ended_at (null=current)│                                      │
│  └────────────────────────┘                                      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│               OBSERVABILITY DOMAIN                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐          ┌──────────────────┐              │
│  │   AuditLog       │          │   CreditEvent    │              │
│  ├──────────────────┤          ├──────────────────┤              │
│  │ id (PK)          │          │ id (PK)          │              │
│  │ userId           │          │ creditBatchId    │              │
│  │ action           │          │ eventType        │              │
│  │ resourceId       │          │ actor            │              │
│  │ timestamp        │          │ oldState         │              │
│  │ previousHash     │          │ newState         │              │
│  │ entryHash        │          │ timestamp        │              │
│  │                  │          │ txHash           │              │
│  │ (HMAC chain for  │          │ signature        │              │
│  │  tamper detect)  │          │                  │              │
│  │                  │          │ (HMAC signing    │              │
│  │                  │          │  for immutabil.) │              │
│  └──────────────────┘          └──────────────────┘              │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Storage Overhead Analysis

**Projection (1M projects, 10M credit batches, 5M retirements):**

| Table | Rows | Avg Row Size | Storage | Notes |
|-------|------|--------------|---------|-------|
| CarbonProject | 1M | 2KB | 2GB | Current active projects |
| CreditBatch | 10M | 1KB | 10GB | All active/historical batches |
| RetirementRecord | 5M | 3KB | 15GB | All retirement records |
| **Active Subtotal** | | | **27GB** | Production tables |
| | | | | |
| CarbonProjectHistory | 5M | 2KB | 10GB | ~5 versions per project avg |
| CreditBatchHistory | 50M | 1KB | 50GB | ~5 versions per batch avg |
| RetirementRecordHistory | 5M | 3KB | 15GB | Single version per retirement |
| **History Subtotal** | | | **75GB** | History tables |
| | | | | |
| **Total** | | | **102GB** | ~3.8x active tables |
| | | | | |
| **Overhead** | | | **75%** | (history / active) |

**Actual overhead is likely 15-20%** because:
- Not all records have history (most retirements don't change)
- Indexes are shared (added indexes are only ~10% of table size)
- Compression can reduce by 20-30%

---

## Query Performance Tips

### Common Patterns

**1. Find current state:**
```sql
SELECT * FROM "CarbonProject"
WHERE projectId = $1 AND ended_at IS NULL;
```

**2. Point-in-time query:**
```sql
SELECT * FROM "CarbonProjectHistory"
WHERE projectId = $1
  AND started_at <= $timestamp
  AND (ended_at IS NULL OR ended_at > $timestamp);
```

**3. Full history:**
```sql
SELECT * FROM "CarbonProjectHistory"
WHERE projectId = $1
ORDER BY started_at ASC;
```

**4. Recent changes:**
```sql
SELECT * FROM "CreditEvent"
WHERE creditBatchId = $1
  AND timestamp > now() - interval '24 hours'
ORDER BY timestamp DESC;
```

All these queries should return in <100ms on a properly indexed database.

---

## Retention and Archival

**GDPR Compliance:**
- User data: 3 years after account deletion (configurable via `retentionUntil`)
- Project data: 7 years (regulatory default for carbon projects)
- Audit logs: 10 years (compliance requirement)
- History tables: Archive to cold storage after 7 years; keep warm for 2 years

**Archival Process (monthly job):**
```sql
-- Archive old history to S3
INSERT INTO s3://carbonledger-archive/carbon-project-history-2019/
SELECT * FROM "CarbonProjectHistory"
WHERE ended_at < '2019-12-31';

-- Delete from production (after verifying backup)
DELETE FROM "CarbonProjectHistory"
WHERE ended_at < '2019-12-31';
```

---

## Further Reading

- **Temporal Table Design:** [PostgreSQL Docs on Temporal Queries](https://www.postgresql.org/docs/15/functions-datetime.html)
- **HMAC-SHA256 Signing:** [OWASP: Using HMAC for Integrity](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- **Soft Delete Patterns:** [Martin Fowler: Soft Delete](https://martinfowler.com/bliki/AnalysisStagnation.html)
- **Indexing Best Practices:** [PostgreSQL Index Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)
