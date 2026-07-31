# Webhook Integration Guide for Corporate ESG Platforms

CarbonLedger delivers real-time retirement, certificate, and purchase events to your ESG platform
via outbound webhooks. This guide explains how to register a subscription, verify payload integrity,
and handle delivery failures.

---

## 1. Overview

| Item                 | Detail                                                          |
|----------------------|-----------------------------------------------------------------|
| HTTP Method          | `POST`                                                          |
| Content-Type         | `application/json`                                              |
| Signature Header     | `X-CarbonLedger-Signature: sha256=<hex>`                        |
| Event Header         | `X-CarbonLedger-Event: <event_type>`                            |
| Timestamp Header     | `X-CarbonLedger-Delivery-Timestamp: <unix_seconds>`             |
| User-Agent           | `CarbonLedger-Webhook/1.0`                                      |
| Retry Strategy       | 3 attempts with exponential backoff (30s → 5m → 30m)           |
| Timeout              | 10 seconds per attempt                                          |

## 2. Event Types

| Event                  | Trigger                                               | Payload Highlights                   |
|------------------------|-------------------------------------------------------|--------------------------------------|
| `retirement.confirmed` | A credit retirement is confirmed on the Stellar chain | `retirementId`, `txHash`, `amount`   |
| `certificate.ready`    | The retirement PDF certificate is generated + pinned  | `certificateUrl`, `certificateCid`   |
| `credit.purchased`     | Credits are purchased from a market listing           | `listingId`, `buyer`, `seller`       |

## 3. Registering a Webhook

Send a `POST` to `/api/v1/webhooks` with your Stellar public key and HTTPS endpoint:

```bash
curl -X POST https://api.carbonledger.network/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt>" \
  -d '{
    "ownerAddress": "GABC...YOUR...PUBLIC...KEY",
    "url": "https://esg.yourcompany.com/webhooks/carbonledger",
    "events": ["retirement.confirmed", "certificate.ready", "credit.purchased"]
  }'
```

Response (201):

```json
{
  "id": "clx...",
  "ownerAddress": "GABC...",
  "url": "https://esg.yourcompany.com/webhooks/carbonledger",
  "secret": "<64-char-hex-secret>",
  "events": ["retirement.confirmed", "certificate.ready", "credit.purchased"],
  "active": true,
  "createdAt": "2026-07-28T12:00:00Z"
}
```

**Store the `secret` securely.** You will use it to verify incoming webhook signatures.

## 4. Verifying Webhook Signatures

Every delivery includes an `X-CarbonLedger-Signature` header with an HMAC-SHA256 digest
computed over the canonical payload:

```
body = timestamp + "." + JSON.stringify(payload)
signature = HMAC-SHA256(secret, body)
```

### Verification Example (Node.js)

```ts
import { createHmac } from 'crypto';

function verifySignature(
  secret: string,
  timestamp: string,        // from X-CarbonLedger-Delivery-Timestamp header
  rawBody: string,          // raw JSON body string
  signatureHeader: string,  // from X-CarbonLedger-Signature header
): boolean {
  const body = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const received = signatureHeader.replace('sha256=', '');

  return createHmac('sha256', secret).update(expected).digest('hex')
    === createHmac('sha256', secret).update(received).digest('hex');
  // Timing-safe comparison
}
```

### Verification Example (Python)

```python
import hmac
import hashlib

def verify_signature(secret: str, timestamp: str, raw_body: str, signature_header: str) -> bool:
    body = f"{timestamp}.{raw_body}"
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    received = signature_header.replace("sha256=", "")
    return hmac.compare_digest(expected, received)
```

## 5. Responding to Webhooks

Your endpoint should:

1. **Verify the signature** using the secret from registration.
2. **Parse `X-CarbonLedger-Event`** to determine the event type.
3. **Process the payload** idempotently (events may be redelivered).
4. **Return HTTP 2xx** within 10 seconds to acknowledge receipt.

Returning any non-2xx status code or timing out will trigger retries.

## 6. Delivery Retry Policy

| Attempt | Delay       |
|---------|-------------|
| 1       | Immediate   |
| 2       | 30 seconds  |
| 3       | 5 minutes   |

If all 3 attempts fail, the subscription is **automatically deactivated** and the owner
receives an email notification. You can re-enable it by re-registering the same URL.

## 7. Delivery Logs

Monitor delivery history via:

```bash
GET /api/v1/webhooks/{id}/logs?page=1&pageSize=20
```

Each log entry includes:

```json
{
  "id": "log-...",
  "subscriptionId": "sub-...",
  "eventType": "retirement.confirmed",
  "url": "https://esg.yourcompany.com/webhooks/carbonledger",
  "statusCode": 200,
  "responseBody": "{\"ok\":true}",
  "success": true,
  "attempt": 1,
  "error": null,
  "timestamp": "2026-07-28T12:05:00Z"
}
```

## 8. Unsubscribing

```bash
DELETE /api/v1/webhooks/{id}
```

This deactivates (does not delete) the subscription, preserving delivery history.

## 9. Example Payloads

### retirement.confirmed

```json
{
  "retirementId": "uuid-...",
  "batchId": "BATCH001",
  "projectId": "PROJ001",
  "amount": 100.5,
  "retiredBy": "GCORP123",
  "beneficiary": "Acme Corp",
  "vintageYear": 2024,
  "txHash": "0xabc123...",
  "retiredAt": "2026-07-28T12:00:00Z"
}
```

### certificate.ready

```json
{
  "retirementId": "uuid-...",
  "beneficiary": "Acme Corp",
  "amount": 100.5,
  "projectName": "Kenya Solar Farm",
  "vintageYear": 2024,
  "txHash": "0xabc123...",
  "certificateUrl": "https://gateway.pinata.cloud/ipfs/Qm...",
  "certificateCid": "Qm...",
  "timestamp": "2026-07-28T12:05:00Z"
}
```

### credit.purchased

```json
{
  "listingId": "LIST001",
  "batchId": "BATCH001",
  "projectId": "PROJ001",
  "buyer": "GCORP123",
  "seller": "GDEVELOPER456",
  "amount": 50,
  "pricePerCredit": "0.015",
  "txHash": "0xdef456...",
  "vintageYear": 2024,
  "methodology": "ACM0002",
  "timestamp": "2026-07-28T11:55:00Z"
}
```

## 10. Security Recommendations

- **Use HTTPS only** — all webhook URLs must be HTTPS.
- **Store secrets securely** — treat the secret like an API key.
- **Verify every signature** — never trust a payload without verifying its HMAC.
- **Idempotent processing** — use `retirementId` or `txHash` as idempotency keys.
- **Firewall allowlisting** — CarbonLedger deliveries originate from our API server IPs (contact support for the current list).
