# CarbonLedger API Integration Guide

> **Audience:** Third-party developers who want to integrate with the CarbonLedger API.  
> **Base URL:** `https://api.carbonledger.com` (production) · `http://localhost:3000` (local dev)  
> **API Prefix:** all routes start with `/api`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Rate Limits & Throttling](#2-rate-limits--throttling)
3. [Pagination](#3-pagination)
4. [Error Handling](#4-error-handling)
5. [Workflow Examples](#5-workflow-examples)
   - [5.1 Look Up a Project by ID](#51-look-up-a-project-by-id)
   - [5.2 Check Credit Batch Availability](#52-check-credit-batch-availability)
   - [5.3 Mint Credits (Project Developer)](#53-mint-credits-project-developer)
   - [5.4 Retire Credits & Get Certificate](#54-retire-credits--get-certificate)
   - [5.5 Track a Retirement Certificate](#55-track-a-retirement-certificate)
   - [5.6 Browse Marketplace Listings](#56-browse-marketplace-listings)
   - [5.7 Verify a Serial Number](#57-verify-a-serial-number)
6. [SDK Recommendations](#6-sdk-recommendations)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Authentication

CarbonLedger uses **JWT Bearer tokens** issued after a [Stellar keypair](https://developers.stellar.org/docs/glossary/key-pair/) challenge-response handshake.  No password is involved — you prove ownership of a Stellar keypair by signing a server-issued nonce.

### 1.1 Auth Flow (3 steps)

```
GET  /api/auth/challenge?publicKey=<STELLAR_PUBLIC_KEY>
  → { nonce, expiresAt }

Sign "carbonledger:<nonce>" with your Stellar secret key.

POST /api/auth/verify
  body: { publicKey, signature, nonce, role? }
  → { access_token, refresh_token }

Use: Authorization: Bearer <access_token>
```

`access_token` expires in 15 minutes.  `refresh_token` is valid for 7 days.

### 1.2 Roles

| Role | Description |
|------|-------------|
| `corporation` | Buy and retire credits (default) |
| `project_developer` | Register projects and list credits |
| `verifier` | Approve/reject projects |
| `admin` | Full access |

---

### JavaScript Example

```javascript
import * as StellarSdk from '@stellar/stellar-sdk';

const BASE_URL = 'https://api.carbonledger.com';

async function login(secretKey) {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const publicKey = keypair.publicKey();

  // Step 1: Get challenge nonce
  const challengeRes = await fetch(
    `${BASE_URL}/api/auth/challenge?publicKey=${publicKey}`
  );
  if (!challengeRes.ok) throw new Error('Failed to get challenge');
  const { nonce } = await challengeRes.json();

  // Step 2: Sign the challenge
  const message = `carbonledger:${nonce}`;
  const msgBuffer = Buffer.from(message, 'utf8');
  const signature = keypair.sign(msgBuffer).toString('hex');

  // Step 3: Exchange for JWT
  const authRes = await fetch(`${BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, signature, nonce }),
  });
  if (!authRes.ok) throw new Error('Authentication failed');
  return authRes.json(); // { access_token, refresh_token }
}

// Refresh an expired access token
async function refreshToken(refreshToken) {
  const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  return res.json(); // { access_token, refresh_token }
}
```

---

### Python Example

```python
import requests
from stellar_sdk import Keypair

BASE_URL = "https://api.carbonledger.com"

def login(secret_key: str) -> dict:
    keypair = Keypair.from_secret(secret_key)
    public_key = keypair.public_key

    # Step 1: Get challenge nonce
    resp = requests.get(
        f"{BASE_URL}/api/auth/challenge",
        params={"publicKey": public_key},
    )
    resp.raise_for_status()
    nonce = resp.json()["nonce"]

    # Step 2: Sign the challenge
    message = f"carbonledger:{nonce}"
    signature = keypair.sign(message.encode()).hex()

    # Step 3: Exchange for JWT
    auth_resp = requests.post(
        f"{BASE_URL}/api/auth/verify",
        json={"publicKey": public_key, "signature": signature, "nonce": nonce},
    )
    auth_resp.raise_for_status()
    return auth_resp.json()  # { access_token, refresh_token }

def refresh_token(refresh_token: str) -> dict:
    resp = requests.post(
        f"{BASE_URL}/api/auth/refresh",
        json={"refreshToken": refresh_token},
    )
    resp.raise_for_status()
    return resp.json()
```

---

### cURL Example

```bash
PUBLIC_KEY="GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGP35PJLYOQ8RQEABKN1CK"

# Step 1: Get challenge
NONCE=$(curl -s "https://api.carbonledger.com/api/auth/challenge?publicKey=$PUBLIC_KEY" \
  | jq -r '.nonce')

# Step 2: Sign (requires stellar-sign CLI or equivalent)
SIGNATURE=$(stellar-sign "carbonledger:$NONCE" --secret-key "$SECRET_KEY")

# Step 3: Exchange for JWT
curl -X POST https://api.carbonledger.com/api/auth/verify \
  -H "Content-Type: application/json" \
  -d "{\"publicKey\":\"$PUBLIC_KEY\",\"signature\":\"$SIGNATURE\",\"nonce\":\"$NONCE\"}"
```

---

## 2. Rate Limits & Throttling

| Endpoint Group | Limit | Window |
|----------------|-------|--------|
| `POST /api/auth/verify` | **5 requests** | 60 seconds per IP |
| `GET  /api/auth/challenge` | 10 requests | 60 seconds per IP |
| `POST /api/auth/refresh` | 10 requests | 60 seconds per IP |
| `POST /api/credits/retire` | 10 requests | 60 seconds per IP |
| All other endpoints | 60 requests | 60 seconds per IP |

When you exceed a limit you receive **HTTP 429 Too Many Requests**:

```json
{
  "statusCode": 429,
  "message": "Too Many Requests",
  "error": "RateLimitExceeded",
  "retryAfter": 47
}
```

The `Retry-After` header (and `retryAfter` body field) contains the number of seconds to wait.

### Account Lockout

After **10 consecutive failed authentication attempts** on the same public key, the account is temporarily locked for **30 minutes**.  Requests during the lockout period return:

```json
{
  "statusCode": 401,
  "message": "Account temporarily locked. Too many failed attempts.",
  "error": "Unauthorized"
}
```

Contact your CarbonLedger admin to unlock early: `POST /api/admin/accounts/:publicKey/unlock`.

### Retry Strategy

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;

    const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, retryAfter * 1000));
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## 3. Pagination

All list endpoints use **cursor-based pagination** (recommended) or limit/offset.

### Cursor-based (recommended)

```
GET /api/projects?limit=20&cursor=<last_seen_id>
```

Response includes a `nextCursor` field:

```json
{
  "data": [ ... ],
  "nextCursor": "clz1abc123",
  "hasMore": true
}
```

Pass `cursor=<nextCursor>` in the next request to fetch the following page.

### Offset-based

```
GET /api/marketplace/listings?limit=20&offset=40
```

### JavaScript Pagination Helper

```javascript
async function* paginateProjects(accessToken, filters = {}) {
  let cursor = undefined;
  do {
    const params = new URLSearchParams({ limit: 20, ...filters, ...(cursor ? { cursor } : {}) });
    const res = await fetch(`${BASE_URL}/api/projects?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json();
    yield* body.data;
    cursor = body.nextCursor;
  } while (cursor);
}

// Usage
for await (const project of paginateProjects(token, { methodology: 'VCS', country: 'BR' })) {
  console.log(project.projectId, project.name);
}
```

---

## 4. Error Handling

### HTTP Status Codes

| Code | Meaning | Recovery |
|------|---------|----------|
| `400 Bad Request` | Invalid request body (validation error) | Fix payload — check `message` array for field-level details |
| `401 Unauthorized` | Missing/invalid JWT, expired token, or locked account | Re-authenticate or refresh token |
| `403 Forbidden` | Authenticated but lacks required role | Use an account with the correct role |
| `404 Not Found` | Resource does not exist | Verify the ID/key in the request |
| `409 Conflict` | Business logic conflict (e.g. double retirement) | Do not retry — the action is permanently invalid |
| `422 Unprocessable Entity` | Over-retirement attempt | Reduce the requested amount |
| `429 Too Many Requests` | Rate limit exceeded | Wait `Retry-After` seconds |
| `500 Internal Server Error` | Unexpected server error | Retry with exponential backoff; report if persistent |
| `503 Service Unavailable` | Database pool exhausted or Stellar node unreachable | Retry after 5–10 seconds |

### Error Response Shape

```json
{
  "statusCode": 400,
  "message": [
    "serialEnd must be a positive integer string",
    "Invalid serial range: serialEnd must be greater than serialStart"
  ],
  "error": "Bad Request"
}
```

### CarbonLedger Domain Error Codes

These appear in `4xx` responses when a business rule is violated:

| Error | Code | Description | Recovery |
|-------|------|-------------|----------|
| `SerialNumberConflict` | 6 | Duplicate batch ID | Use a unique batchId |
| `DoubleCountingDetected` | 14 | Serial range overlaps existing batch | Choose a non-overlapping range |
| `InvalidSerialRange` | 18 | serialEnd ≤ serialStart, or zero/overflow | Fix serial range |
| `AlreadyRetired` | 5 | Batch is fully retired | Retirement is irreversible |
| `InsufficientCredits` | 4 | Retire amount exceeds available | Reduce amount |
| `InvalidVintageYear` | 9 | Vintage year out of range 1990–currentYear+1 | Fix vintageYear |
| `ProjectNotVerified` | 2 | Project not yet approved by verifier | Wait for verification |
| `ProjectSuspended` | 3 | Project under investigation | Contact project owner |

### Python Error Handler

```python
class CarbonLedgerError(Exception):
    def __init__(self, status_code: int, message, error: str):
        self.status_code = status_code
        self.message = message
        self.error = error
        super().__init__(f"[{status_code}] {error}: {message}")

def api_request(method: str, path: str, token: str = None, **kwargs) -> dict:
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = requests.request(method, f"{BASE_URL}{path}", headers=headers, **kwargs)
    if not resp.ok:
        body = resp.json()
        raise CarbonLedgerError(resp.status_code, body.get("message"), body.get("error", ""))
    return resp.json()
```

---

## 5. Workflow Examples

### 5.1 Look Up a Project by ID

Returns full project details including methodology, status, and credit issuance totals.

**Endpoint:** `GET /api/projects/:id` (public — no auth required)

#### JavaScript

```javascript
async function getProject(projectId) {
  const res = await fetch(`${BASE_URL}/api/projects/${projectId}`);
  if (!res.ok) throw new Error(`Project ${projectId} not found`);
  return res.json();
}

const project = await getProject('proj-vcs-amazon-001');
console.log(project.name, project.status, project.totalCreditsIssued);
```

#### Python

```python
def get_project(project_id: str) -> dict:
    return api_request("GET", f"/api/projects/{project_id}")

project = get_project("proj-vcs-amazon-001")
print(project["name"], project["status"], project["totalCreditsIssued"])
```

#### cURL

```bash
curl https://api.carbonledger.com/api/projects/proj-vcs-amazon-001
```

---

### 5.2 Check Credit Batch Availability

Retrieve a specific credit batch and inspect how many tonnes are still active.

**Endpoint:** `GET /api/credits/batch/:id` (public)

#### JavaScript

```javascript
async function checkBatchAvailability(batchId) {
  const res = await fetch(`${BASE_URL}/api/credits/batch/${batchId}`);
  if (!res.ok) throw new Error(`Batch ${batchId} not found`);
  const batch = await res.json();

  const isAvailable = batch.status !== 'FullyRetired';
  return { batch, isAvailable };
}

const { batch, isAvailable } = await checkBatchAvailability('batch-vcs-001');
if (isAvailable) {
  console.log(`${batch.amount} tCO₂e available (serial range ${batch.serialStart}–${batch.serialEnd})`);
} else {
  console.log('Batch is fully retired');
}
```

#### Python

```python
def check_batch(batch_id: str) -> dict:
    batch = api_request("GET", f"/api/credits/batch/{batch_id}")
    batch["isAvailable"] = batch["status"] != "FullyRetired"
    return batch

batch = check_batch("batch-vcs-001")
if batch["isAvailable"]:
    print(f"{batch['amount']} tCO₂e available")
```

#### cURL

```bash
curl https://api.carbonledger.com/api/credits/batch/batch-vcs-001
```

---

### 5.3 Mint Credits (Project Developer)

Mint a new credit batch for a verified project.  Requires `admin` role.

**Endpoint:** `POST /api/credits/mint`

> **Note:** `serialStart` and `serialEnd` must be positive integer strings with no decimal point.  
> `serialEnd` must be strictly greater than `serialStart` and ≤ `18446744073709551615` (u64 max).

#### JavaScript

```javascript
async function mintCredits(accessToken, batchData) {
  const res = await fetch(`${BASE_URL}/api/credits/mint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(batchData),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Mint failed: ${JSON.stringify(err.message)}`);
  }
  return res.json();
}

const batch = await mintCredits(token, {
  batchId: 'batch-vcs-amazon-2023-001',
  projectId: 'proj-vcs-amazon-001',
  vintageYear: 2023,
  amount: 10000,           // 10,000 tCO₂e
  serialStart: '1',
  serialEnd: '10000',
  metadataCid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
});
console.log('Minted:', batch.batchId);
```

#### Python

```python
def mint_credits(token: str, batch_data: dict) -> dict:
    return api_request("POST", "/api/credits/mint", token=token, json=batch_data)

batch = mint_credits(token, {
    "batchId": "batch-vcs-amazon-2023-001",
    "projectId": "proj-vcs-amazon-001",
    "vintageYear": 2023,
    "amount": 10000,
    "serialStart": "1",
    "serialEnd": "10000",
    "metadataCid": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
})
print("Minted:", batch["batchId"])
```

#### cURL

```bash
curl -X POST https://api.carbonledger.com/api/credits/mint \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "batch-vcs-amazon-2023-001",
    "projectId": "proj-vcs-amazon-001",
    "vintageYear": 2023,
    "amount": 10000,
    "serialStart": "1",
    "serialEnd": "10000",
    "metadataCid": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
  }'
```

---

### 5.4 Retire Credits & Get Certificate

Permanently retire credits on-chain.  Retirement is **irreversible**.  Requires `corporation` or `admin` role.

**Endpoint:** `POST /api/credits/retire`

> The `holderPublicKey` in the body is **overridden** by the authenticated user's public key — you cannot retire credits on behalf of another user.

#### JavaScript

```javascript
async function retireCredits(accessToken, retireData) {
  const res = await fetch(`${BASE_URL}/api/credits/retire`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(retireData),
  });
  if (res.status === 409) {
    throw new Error('Credits already fully retired — retirement is irreversible');
  }
  if (res.status === 422) {
    const err = await res.json();
    throw new Error(`Over-retirement: ${err.message}`);
  }
  if (!res.ok) throw new Error('Retirement failed');
  return res.json();
}

const retirement = await retireCredits(token, {
  batchId: 'batch-vcs-amazon-2023-001',
  amount: 500,                              // 500 tCO₂e
  beneficiary: 'Acme Corp (ESG 2023)',
  retirementReason: 'Scope 1 emissions offset — fiscal year 2023',
  holderPublicKey: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGP35PJLYOQ8RQEABKN1CK',
});

console.log('Retirement ID:', retirement.retirementId);
console.log('Certificate URL:', retirement.certificateUrl);
```

#### Python

```python
def retire_credits(token: str, retire_data: dict) -> dict:
    return api_request("POST", "/api/credits/retire", token=token, json=retire_data)

retirement = retire_credits(token, {
    "batchId": "batch-vcs-amazon-2023-001",
    "amount": 500,
    "beneficiary": "Acme Corp (ESG 2023)",
    "retirementReason": "Scope 1 emissions offset — fiscal year 2023",
    "holderPublicKey": "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGP35PJLYOQ8RQEABKN1CK",
})
print("Certificate URL:", retirement.get("certificateUrl"))
```

#### cURL

```bash
curl -X POST https://api.carbonledger.com/api/credits/retire \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "batch-vcs-amazon-2023-001",
    "amount": 500,
    "beneficiary": "Acme Corp (ESG 2023)",
    "retirementReason": "Scope 1 emissions offset — fiscal year 2023",
    "holderPublicKey": "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGP35PJLYOQ8RQEABKN1CK"
  }'
```

---

### 5.5 Track a Retirement Certificate

Retrieve an existing retirement record by its ID.  Requires authentication (the retirement must belong to the requesting user, or the user must be an admin).

**Endpoint:** `GET /api/retirements/:id`

#### JavaScript

```javascript
async function getRetirement(accessToken, retirementId) {
  const res = await fetch(`${BASE_URL}/api/retirements/${retirementId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 403) throw new Error('Access denied — not your retirement');
  if (res.status === 404) throw new Error('Retirement not found');
  return res.json();
}

const cert = await getRetirement(token, 'ret-batch-vcs-amazon-2023-001-1693000000000');
console.log('Beneficiary:', cert.beneficiary);
console.log('Serial numbers:', cert.serialNumbers.slice(0, 5), '…');
console.log('On-chain tx:', cert.txHash);
```

#### Python

```python
def get_retirement(token: str, retirement_id: str) -> dict:
    return api_request("GET", f"/api/retirements/{retirement_id}", token=token)

cert = get_retirement(token, "ret-batch-vcs-amazon-2023-001-1693000000000")
print("Beneficiary:", cert["beneficiary"])
print("TX Hash:", cert["txHash"])
```

#### cURL

```bash
curl https://api.carbonledger.com/api/retirements/ret-batch-vcs-001-1693000000000 \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Also verify a retirement certificate's IPFS integrity:

```bash
curl -X POST https://api.carbonledger.com/api/retirements/verify-integrity \
  -H "Content-Type: application/json" \
  -d '{"retirementId":"ret-001","content":"{\"amount\":500,...}"}'
```

---

### 5.6 Browse Marketplace Listings

List active credit offerings.  **No authentication required.**

**Endpoint:** `GET /api/marketplace/listings`

| Query param | Type | Description |
|-------------|------|-------------|
| `methodology` | string | Filter by methodology (e.g. `VCS`, `Gold Standard`) |
| `country` | string | ISO 3166-1 alpha-2 country code |
| `vintage` | number | Vintage year (e.g. `2023`) |
| `limit` | number | Page size (default 20, max 100) |
| `offset` | number | Offset for pagination |

#### JavaScript

```javascript
async function getListings(filters = {}) {
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined))
  );
  const res = await fetch(`${BASE_URL}/api/marketplace/listings?${params}`);
  return res.json();
}

// Browse VCS credits from Brazil, vintage 2023
const { data } = await getListings({ methodology: 'VCS', country: 'BR', vintage: 2023, limit: 10 });
data.forEach(listing => {
  console.log(`${listing.listingId}: ${listing.amountAvailable} tCO₂e @ ${listing.pricePerCredit} USDC`);
});
```

#### Python

```python
def get_listings(methodology=None, country=None, vintage=None, limit=20, offset=0):
    params = {k: v for k, v in {
        "methodology": methodology, "country": country,
        "vintage": vintage, "limit": limit, "offset": offset,
    }.items() if v is not None}
    return api_request("GET", "/api/marketplace/listings", params=params)

result = get_listings(methodology="VCS", country="BR", vintage=2023)
for listing in result.get("data", []):
    print(listing["listingId"], listing["amountAvailable"])
```

#### cURL

```bash
curl "https://api.carbonledger.com/api/marketplace/listings?methodology=VCS&country=BR&vintage=2023&limit=10"
```

---

### 5.7 Verify a Serial Number

Look up any serial number to see its full provenance — which batch it belongs to and whether it has been retired.

**Endpoint:** `GET /api/credits/lookup/:serial` (public)

#### JavaScript

```javascript
async function lookupSerial(serial) {
  const res = await fetch(`${BASE_URL}/api/credits/lookup/${serial}`);
  if (res.status === 404) return { found: false };
  const record = await res.json();
  const isRetired = 'retirementId' in record;
  return { found: true, isRetired, record };
}

const { found, isRetired, record } = await lookupSerial('42');
if (!found) console.log('Serial not found');
else if (isRetired) console.log('Retired by:', record.beneficiary, 'on', record.retiredAt);
else console.log('Active in batch:', record.batchId);
```

#### Python

```python
def lookup_serial(serial: str) -> dict:
    try:
        record = api_request("GET", f"/api/credits/lookup/{serial}")
        return {"found": True, "isRetired": "retirementId" in record, "record": record}
    except CarbonLedgerError as e:
        if e.status_code == 404:
            return {"found": False}
        raise

info = lookup_serial("42")
if info["found"] and info["isRetired"]:
    print("Retired by:", info["record"]["beneficiary"])
```

#### cURL

```bash
curl https://api.carbonledger.com/api/credits/lookup/42
```

---

## 6. SDK Recommendations

| Language | Library | Notes |
|----------|---------|-------|
| JavaScript/TypeScript | [`@stellar/stellar-sdk`](https://www.npmjs.com/package/@stellar/stellar-sdk) | Keypair signing, transaction building |
| Python | [`stellar-sdk`](https://pypi.org/project/stellar-sdk/) | `pip install stellar-sdk` |
| Rust | [`stellar-base`](https://crates.io/crates/stellar-base) | For contract-level integrations |

No official CarbonLedger SDK exists yet.  The patterns in this guide are the canonical integration approach.  A thin wrapper around `fetch`/`requests` is sufficient for most use cases.

---

## 7. Troubleshooting

### `401 Invalid or expired challenge`

The nonce is single-use and expires after **5 minutes**.  Request a fresh nonce immediately before signing — do not cache nonces.

### `401 Signature verification failed`

- Ensure you sign the exact string `carbonledger:<nonce>` (no trailing newline).
- Signature must be hex-encoded (not base64).
- Verify you are using the private key that corresponds to the `publicKey` you submitted.

### `401 Account temporarily locked`

More than 10 consecutive failed login attempts triggered a 30-minute lockout.  Wait 30 minutes, or ask an admin to call `POST /api/admin/accounts/:publicKey/unlock`.

### `400 Invalid serial range`

- `serialStart` must be a string of digits ≥ `"1"`.
- `serialEnd` must be strictly greater than `serialStart`.
- `serialEnd` must not exceed `"18446744073709551615"` (u64 max).
- Neither field may contain decimal points, negative signs, or leading zeros on multi-digit values.

### `400 Serial number range overlaps existing batch`

Serial numbers are globally unique across all batches.  The range `[serialStart, serialEnd]` you submitted overlaps an already-registered batch.  Choose a non-overlapping range.

### `409 Credits are already fully retired`

Retirement is permanently irreversible by design.  You cannot re-use a fully retired batch.

### `503 Service temporarily unavailable — please retry`

The database connection pool is exhausted (error code `P2024`).  Back off and retry after 5 seconds with jitter.

### Correlation IDs

Every response includes an `X-Correlation-Id` header.  Include it when filing support requests:

```javascript
const res = await fetch(url, options);
const correlationId = res.headers.get('X-Correlation-Id');
```

---

## Appendix: Complete Request/Response Examples

### Successful mint response

```json
{
  "id": "clz1abc123",
  "batchId": "batch-vcs-amazon-2023-001",
  "projectId": "proj-vcs-amazon-001",
  "vintageYear": 2023,
  "amount": "10000.00",
  "serialStart": "1",
  "serialEnd": "10000",
  "status": "Active",
  "metadataCid": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
  "issuedAt": "2026-08-29T04:00:00.000Z"
}
```

### Successful retire response

```json
{
  "id": "clz2def456",
  "retirementId": "ret-batch-vcs-amazon-2023-001-1693000000000",
  "batchId": "batch-vcs-amazon-2023-001",
  "projectId": "proj-vcs-amazon-001",
  "amount": "500.00",
  "retiredBy": "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGP35PJLYOQ8RQEABKN1CK",
  "beneficiary": "Acme Corp (ESG 2023)",
  "retirementReason": "Scope 1 emissions offset — fiscal year 2023",
  "vintageYear": 2023,
  "serialNumbers": ["1", "2", "3", "..."],
  "txHash": "a1b2c3d4e5f6...",
  "certificateCid": null,
  "isValid": true,
  "retiredAt": "2026-08-29T04:30:00.000Z",
  "certificateUrl": null
}
```
