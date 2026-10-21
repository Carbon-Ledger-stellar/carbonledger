# Pause Webhook Events Reference

CarbonLedger provides automated webhook notifications for smart contract lifecycle state changes. Integrators and dApps can subscribe to real-time webhook deliveries to react immediately when operations are halted or resumed.

---

## Supported Webhook Events

| Event Name | Trigger | Typical Payload Size | Delivery SLA |
| :--- | :--- | :--- | :--- |
| `contract.paused` | Soroban `Paused` event emitted on-chain | ~1.2 KB | < 2.5s from ledger close |
| `contract.unpaused` | Soroban `Unpaused` event emitted on-chain | ~0.9 KB | < 2.5s from ledger close |

---

## 1. `contract.paused` (PausedEvent)

Emitted whenever an authorized administrator invokes `pause_operations` on the CarbonCredit contract.

### Event Payload Schema
```json
{
  "id": "evt_pause_01J8F9X2B48V7M3Z5K9D",
  "event": "contract.paused",
  "createdAt": "2026-09-24T20:15:30.142Z",
  "data": {
    "contractId": "CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B",
    "network": "testnet",
    "adminAddress": "GBXYZ76EXAMPLEADMINWALLETSTARSOLAR747362",
    "pausedAt": 1727208930,
    "pausedUntil": 1727295330,
    "maxDurationHours": 24,
    "reason": "Emergency investigation regarding oracle pricing anomaly",
    "affectedOperations": [
      "mint_credits",
      "transfer",
      "retire_credits",
      "marketplace_purchase"
    ],
    "transactionHash": "4a7f29bb5c689d02347101ad79803bf56f10c662865c345330a1bf64c23f1124",
    "ledgerSequence": 1045239
  }
}
```

---

## 2. `contract.unpaused` (UnpausedEvent)

Emitted when operations are manually resumed via `unpause_operations` or when the time-bound pause window has naturally expired.

### Event Payload Schema
```json
{
  "id": "evt_unpause_01J8FB89D12P9T8N2Q4X",
  "event": "contract.unpaused",
  "createdAt": "2026-09-24T22:45:10.890Z",
  "data": {
    "contractId": "CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B",
    "network": "testnet",
    "adminAddress": "GBXYZ76EXAMPLEADMINWALLETSTARSOLAR747362",
    "unpausedAt": 1727217910,
    "reason": "Incident mitigated; anomaly identified as oracle off-chain timeout",
    "downtimeDurationSeconds": 8980,
    "status": "operational",
    "transactionHash": "9b12a83ef7c02b1928374a01c349586fe09a7b6c5d4e3f2109847123958abcdef",
    "ledgerSequence": 1045781
  }
}
```

---

## Webhook Signature Verification

All webhook requests sent by CarbonLedger include signature headers to prevent spoofing and replay attacks:

- `X-CarbonLedger-Signature`: `t=1727208930,v1=9e82c813a4...`
- `X-CarbonLedger-Timestamp`: `1727208930`

### Verification Example (Node.js / Express)
```typescript
import crypto from 'crypto';
import { Request, Response } from 'express';

export function verifyWebhookSignature(req: Request, secret: string): boolean {
  const header = req.headers['x-carbonledger-signature'] as string;
  if (!header) return false;

  const [tPart, v1Part] = header.split(',');
  const timestamp = tPart.split('=')[1];
  const signature = v1Part.split('=')[1];

  // Prevent replay attacks (reject payloads older than 5 minutes)
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimestamp - Number(timestamp)) > 300) {
    return false;
  }

  const payloadToSign = `${timestamp}.${JSON.stringify(req.body)}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadToSign)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}
```

---

## Delivery & Retry Policy

When your endpoint does not respond with HTTP `2xx` within 5 seconds, CarbonLedger retries delivery using exponential backoff with jitter:

| Attempt | Delay | Backoff Strategy |
| :--- | :--- | :--- |
| Initial | 0s | Immediate |
| Attempt 1 | 15s | Exponential |
| Attempt 2 | 1m | Exponential |
| Attempt 3 | 5m | Exponential |
| Attempt 4 | 30m | Exponential |
| Attempt 5 | 2h | Final retry before sending to Dead Letter Queue (DLQ) |

---

## Subscribing to Pause Webhook Events

You can register your webhook endpoint via the REST API:

```bash
curl -X POST https://api.carbonledger.io/api/v1/webhooks/subscriptions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/webhooks/carbonledger",
    "events": [
      "contract.paused",
      "contract.unpaused"
    ],
    "description": "Production pause event notification hook"
  }'
```
