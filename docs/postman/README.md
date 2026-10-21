# CarbonLedger Pause API — Postman Collection

> **Closes:** #1197

This directory contains the Postman Collection and Environment files for testing all pause-related endpoints in the CarbonLedger API.

## Files

| File | Description |
|------|-------------|
| `CarbonLedger_Pause_API.postman_collection.json` | Collection with 5 requests, pre-request scripts, test assertions, and example responses |
| `CarbonLedger_Testnet.postman_environment.json` | Pre-configured environment variables for the testnet deployment |

## Endpoints

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 1 | `GET` | `/api/v1/contract/status` | None | Current pause state and contract status |
| 2 | `POST` | `/api/v1/admin/pause` | Admin JWT | Trigger emergency pause |
| 3 | `POST` | `/api/v1/admin/unpause` | Admin JWT | Lift active pause (idempotent) |
| 4 | `GET` | `/api/v1/admin/pause-history` | Admin JWT | Paginated audit log of pause events |
| 5 | `POST` | `/api/v1/marketplace/purchase` | User JWT | Verify write operations are blocked while paused |

## Quick Start

### Via Postman UI

1. Open Postman and click **Import** (top-left).
2. Import **both** files:
   - `CarbonLedger_Pause_API.postman_collection.json`
   - `CarbonLedger_Testnet.postman_environment.json`
3. Select **CarbonLedger Testnet Environment** as your active environment.
4. Set `adminAuthToken` to a valid admin JWT:
   - Go to **Environments** → **CarbonLedger Testnet Environment**
   - Edit the `adminAuthToken` value (obtain via `POST /api/v1/auth/verify` with an admin Stellar keypair)
5. Run request **#1** (Get Contract Status) to verify connectivity.
6. Run requests **#2 → #5 → #3 → #4** in order for a complete pause lifecycle test.

### Via Newman CLI (CI/CD)

```bash
# Install Newman if not already installed
npm install -g newman

# Run the full collection against testnet
newman run docs/postman/CarbonLedger_Pause_API.postman_collection.json \
  --environment docs/postman/CarbonLedger_Testnet.postman_environment.json \
  --env-var "adminAuthToken=${TESTNET_ADMIN_TOKEN}" \
  --reporters cli,json \
  --reporter-json-export newman-results.json
```

### Using a local backend

Override `baseUrl` to test against a local development server:

```bash
newman run docs/postman/CarbonLedger_Pause_API.postman_collection.json \
  --environment docs/postman/CarbonLedger_Testnet.postman_environment.json \
  --env-var "baseUrl=http://localhost:3001" \
  --env-var "adminAuthToken=${LOCAL_ADMIN_TOKEN}"
```

## Collection Features

### Pre-request Scripts

Every request includes a pre-request script that:
- Validates `adminAuthToken` is set before admin endpoints are called (throws a descriptive error if missing)
- Generates a timestamped `pauseReason` for each run so pause events are distinguishable in the audit log
- Sets default values for pagination variables if not already configured

### Test Assertions

Each request has automated tests:

**Request #1 (Get Status):**
- Asserts HTTP 200
- Validates `isPaused` (bool), `status` (enum), `pauseUntil` (null or positive int)
- Stores pause state in collection variables for use by subsequent tests

**Request #2 (Pause):**
- Accepts both `200` (paused) and `409` (already paused)
- On `200`: validates `transactionHash`, `pauseUntil` is in the future and within 72 hours, `affectedContracts` is an array
- Stores `transactionHash` and `pauseUntil` in collection variables

**Request #3 (Unpause):**
- Asserts HTTP 200 (idempotent — no error if already operational)
- Validates `status: "operational"`, `transactionHash` present
- Clears pause-state collection variables

**Request #4 (History):**
- Validates pagination fields (`items`, `total`, `limit`, `offset`)
- Validates each item has `id`, `action`, `reason`, `timestamp`, `transactionHash`
- Validates `action` is one of `"paused"`, `"unpaused"`, `"auto_expired"`
- Validates `items.length <= limit`

**Request #5 (Verify Blocked):**
- Asserts `409` or `423` when the contract is paused
- Validates error body has `error: "CONTRACT_PAUSED"` or `"EmergencyPaused"`

### Example Responses

All 5 requests include saved example responses for:
- Success (2xx)
- Already-paused / idempotent states
- Error cases (400, 403, 409)

These examples are visible in Postman's **Examples** panel and serve as documentation for integrators.

## Obtaining an Admin JWT

Admin endpoints require a JWT issued for an account with the `admin` role:

```bash
# 1. Get a challenge nonce for your admin public key
NONCE=$(curl -s "https://api.carbonledger.io/api/v1/auth/challenge?publicKey=${ADMIN_PUBLIC_KEY}" | jq -r '.nonce')

# 2. Sign the nonce with your admin Stellar keypair
SIGNATURE=$(stellar keys sign "carbonledger:${NONCE}" --sign-with-key "${ADMIN_PUBLIC_KEY}")

# 3. Exchange for a JWT
ADMIN_JWT=$(curl -s -X POST "https://api.carbonledger.io/api/v1/auth/verify" \
  -H "Content-Type: application/json" \
  -d "{\"publicKey\":\"${ADMIN_PUBLIC_KEY}\",\"signature\":\"${SIGNATURE}\",\"nonce\":\"${NONCE}\"}" \
  | jq -r '.access_token')

echo "Admin JWT: ${ADMIN_JWT}"
```

Set the resulting JWT as `adminAuthToken` in the environment.

## Related Documentation

- [Pause Tutorial](../tutorials/pause-operations-tutorial.md) — How to integrate pause handling
- [SDK Examples](../sdk-examples/pause-integration-examples.md) — JS, Python, Go SDK examples
- [Pause API Reference](../pause-api-reference.md) — Complete function signatures and error codes
- [Pause Specification](../pause-specification.md) — Design decisions and state model
