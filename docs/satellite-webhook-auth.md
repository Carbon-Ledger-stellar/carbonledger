# Satellite Webhook Authentication

**Feature:** #585  
**Service:** `oracle/satellite_monitor.py`  
**Scheme:** HMAC-SHA256 request signing with timestamp replay protection

---

## Overview

All inbound satellite monitoring webhooks must be signed by a registered data provider using HMAC-SHA256. Requests that are unsigned, incorrectly signed, or replayed outside the 5-minute window are rejected before any data processing occurs.

---

## Required Headers

Every webhook request to `POST /webhook/satellite` must include the following headers:

| Header | Type | Description |
|--------|------|-------------|
| `X-Provider-ID` | string | The provider's registered identifier (looked up in `SatelliteWebhookProvider` table) |
| `X-Timestamp` | integer | Unix epoch timestamp in **seconds** at time of request |
| `X-Signature` | string | Hex-encoded HMAC-SHA256 signature (see below) |

---

## Signature Computation

The signature is computed over a message that concatenates the provider ID, timestamp, and raw request body. This ensures that the signature is specific to both the sender identity and the exact request content.

```
message = "{provider_id}.{timestamp}" (UTF-8 encoded) + "." + raw_body_bytes
signature = hex(HMAC-SHA256(provider_key_bytes, message))
```

**Example (Python):**

```python
import hmac, hashlib, time, json, requests

PROVIDER_ID  = "my-provider"
PROVIDER_KEY = bytes.fromhex("your_hex_encoded_key")
URL          = "https://oracle.carbonledger.io/webhook/satellite"

body    = json.dumps({"project_id": "PROJ-001", ...}).encode()
ts      = int(time.time())
msg     = f"{PROVIDER_ID}.{ts}".encode() + b"." + body
sig     = hmac.new(PROVIDER_KEY, msg, hashlib.sha256).hexdigest()

requests.post(URL, data=body, headers={
    "Content-Type": "application/json",
    "X-Provider-ID": PROVIDER_ID,
    "X-Timestamp":   str(ts),
    "X-Signature":   sig,
})
```

**Example (Node.js):**

```js
const crypto = require('crypto');

const providerId = 'my-provider';
const providerKey = Buffer.from('your_hex_encoded_key', 'hex');
const body = JSON.stringify({ project_id: 'PROJ-001', ... });
const ts = Math.floor(Date.now() / 1000);
const msg = Buffer.concat([
  Buffer.from(`${providerId}.${ts}`),
  Buffer.from('.'),
  Buffer.from(body),
]);
const sig = crypto.createHmac('sha256', providerKey).update(msg).digest('hex');
```

---

## Replay Protection

The `X-Timestamp` header is validated against the server's current time. Requests where `|server_time - X-Timestamp| > 300` seconds (5 minutes) are rejected with HTTP `400 Bad Request`.

This prevents an attacker who captures a valid signed request from replaying it more than 5 minutes later.

```
|server_time - X-Timestamp| ≤ 300s   → accepted
|server_time - X-Timestamp| > 300s   → 400 (timestamp_expired or timestamp_future)
```

**Important:** Ensure your server clock is synchronized (NTP). A clock drift of more than a few seconds will cause requests to fail near the boundary.

---

## Provider Key Registry

Provider keys are stored in the `SatelliteWebhookProvider` PostgreSQL table:

```prisma
model SatelliteWebhookProvider {
  id          String   @id @default(cuid())
  providerId  String   @unique    // identifies the provider in X-Provider-ID header
  name        String              // human-readable name
  hmacKey     String              // hex-encoded HMAC-SHA256 key (32+ bytes recommended)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

The oracle service loads provider keys from the database on first request per `providerId` and caches them in-process for **60 seconds**. This means key rotation takes effect within 60 seconds without requiring a service restart.

---

## Key Rotation

To rotate a provider's key without downtime:

1. Generate a new 32-byte random key:
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```
2. Update the `hmacKey` field in the `SatelliteWebhookProvider` table.
3. Update the provider's sending system to use the new key.
4. The oracle service will pick up the new key within 60 seconds (cache TTL).
5. Optionally invalidate the in-process cache immediately by restarting the oracle process.

**Recommendation:** During rotation, briefly configure the provider to send requests signed with both keys (if your sending system supports it), then switch to the new key only after verifying the new key is accepted.

---

## Error Responses

| HTTP Status | `reason` field | Cause |
|-------------|----------------|-------|
| `401 Unauthorized` | `missing_provider_id` | `X-Provider-ID` header absent |
| `400 Bad Request` | `missing_timestamp` | `X-Timestamp` header absent |
| `400 Bad Request` | `invalid_timestamp_format` | `X-Timestamp` is not a valid integer |
| `400 Bad Request` | `timestamp_expired` | Timestamp is more than 5 min in the past |
| `400 Bad Request` | `timestamp_future` | Timestamp is more than 5 min in the future |
| `401 Unauthorized` | `missing_signature` | `X-Signature` header absent |
| `401 Unauthorized` | `unknown_provider` | `providerId` not found or inactive in DB |
| `401 Unauthorized` | `invalid_signature` | Signature does not match computed HMAC |

---

## Legacy Path (GEE_WEBHOOK_SECRET)

For backward compatibility, requests that **do not include** `X-Provider-ID` fall back to the legacy `X-GEE-Secret` plaintext comparison. This path will be removed in a future release. All new data providers must register their keys in the `SatelliteWebhookProvider` table and use HMAC-SHA256.

To disable the legacy path, unset `GEE_WEBHOOK_SECRET` in your `.env`.

---

## Security Notes

- **Constant-time comparison:** The signature comparison uses `hmac.compare_digest()` to prevent timing oracle attacks.
- **Key storage:** `hmacKey` values should be encrypted at rest (column-level encryption or vault). The current schema stores them as hex strings; production deployments should use a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault).
- **Key length:** Use at least 32 bytes (256 bits) of cryptographically random data per provider key.
- **HTTPS:** Always run the oracle service behind HTTPS/TLS. HMAC protects integrity but not confidentiality in transit.

---

## Testing

Unit tests for the authentication scheme are in `oracle/test_satellite_webhook_auth.py`. Run them with:

```bash
cd oracle
python3 -m pytest test_satellite_webhook_auth.py -v
# or
python3 -m unittest test_satellite_webhook_auth -v
```
