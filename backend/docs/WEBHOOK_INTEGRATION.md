# CarbonLedger Webhook Integration Guide

This guide provides comprehensive instructions for integrating CarbonLedger webhooks into your application to receive real-time carbon credit lifecycle events.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Event Types](#event-types)
3. [Subscription Management](#subscription-management)
4. [Signature Verification](#signature-verification)
5. [Delivery Guarantees](#delivery-guarantees)
6. [Error Handling](#error-handling)
7. [Testing & Debugging](#testing--debugging)
8. [Best Practices](#best-practices)
9. [Migration Guide](#migration-guide)

---

## Quick Start

### 1. Create a Webhook Subscription

```bash
curl -X POST "https://api.carbonledger.io/api/v1/webhooks/subscribe" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/webhooks/carbonledger",
    "events": ["credit.minted", "credit.retired", "certificate.ready"],
    "description": "Production webhook for carbon credit tracking"
  }'
```

**Response**:
```json
{
  "id": "whsub_1234567890abcdef",
  "url": "https://your-app.com/webhooks/carbonledger",
  "events": ["credit.minted", "credit.retired", "certificate.ready"],
  "description": "Production webhook for carbon credit tracking",
  "secret": "whsec_test_abcdef1234567890ghijklmnop",
  "status": "active",
  "createdAt": "2026-06-01T12:34:56.000Z"
}
```

**Important**: Save the `secret` value securely. It will never be displayed again.

### 2. Set Up Your Webhook Endpoint

Create an HTTPS endpoint that:
- Accepts POST requests
- Verifies incoming webhook signatures
- Returns 2xx status code quickly
- Processes event asynchronously

**Example (Node.js/Express)**:
```javascript
const express = require('express');
const crypto = require('crypto');
const app = express();

// Store webhook secret in environment variable
const WEBHOOK_SECRET = process.env.CARBONLEDGER_WEBHOOK_SECRET;

// Middleware to parse raw body (required for signature verification)
app.post(
  '/webhooks/carbonledger',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // 1. Extract headers
      const signature = req.headers['x-carbonledger-signature'];
      const timestamp = req.headers['x-carbonledger-delivery-timestamp'];
      const event = req.headers['x-carbonledger-event'];

      if (!signature || !timestamp || !event) {
        return res.status(400).json({ error: 'Missing webhook headers' });
      }

      // 2. Verify signature
      const body = req.body.toString('utf-8');
      if (!verifySignature(signature, timestamp, body, WEBHOOK_SECRET)) {
        console.warn('[webhook] Signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // 3. Verify timestamp (max 5 min old, prevent replay attacks)
      const now = Math.floor(Date.now() / 1000);
      const ts = parseInt(timestamp, 10);
      if (Math.abs(now - ts) > 300) {
        console.warn('[webhook] Timestamp outside tolerance window');
        return res.status(401).json({ error: 'Request too old' });
      }

      // 4. Parse and acknowledge receipt (important!)
      const webhookData = JSON.parse(body);
      res.status(202).json({ received: true });

      // 5. Process asynchronously (don't wait)
      handleWebhookEvent(event, webhookData).catch(err => {
        console.error('[webhook] Processing failed:', err);
      });
    } catch (error) {
      console.error('[webhook] Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Verify HMAC signature
function verifySignature(signatureHeader, timestamp, body, secret) {
  // Parse signature header: "t=<timestamp>,v1=<signature>"
  const parts = signatureHeader.split(',');
  const versionedSig = parts.find(p => p.startsWith('v1='));
  if (!versionedSig) {
    return false;
  }

  const sig = versionedSig.split('=')[1];

  // Create expected signature
  const message = `${timestamp}.${body}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  // Constant-time comparison (prevent timing attacks)
  return crypto.timingSafeEqual(
    Buffer.from(sig),
    Buffer.from(expectedSig)
  );
}

// Handle webhook event asynchronously
async function handleWebhookEvent(event, data) {
  console.log(`[webhook] Processing ${event}:`, data);

  try {
    switch (event) {
      case 'credit.minted':
        await handleCreditMinted(data);
        break;
      case 'credit.retired':
        await handleCreditRetired(data);
        break;
      case 'credit.transferred':
        await handleCreditTransferred(data);
        break;
      case 'certificate.ready':
        await handleCertificateReady(data);
        break;
      default:
        console.warn(`[webhook] Unknown event type: ${event}`);
    }
  } catch (error) {
    console.error(`[webhook] Failed to handle ${event}:`, error);
    // Your monitoring/alerting system
    await alertOps(`Webhook handler failed for ${event}`, error);
  }
}

async function handleCreditMinted(data) {
  const { batchId, projectId, amount, vintageYear } = data;
  console.log(`✓ Credits minted: ${amount} credits for project ${projectId}`);
  
  // Update your database, trigger downstream processes, etc.
  // await db.credits.create({ batchId, projectId, amount, vintageYear });
}

async function handleCreditRetired(data) {
  const { retirementId, totalRetired, certificateUrl } = data;
  console.log(`✓ Credits retired: ${totalRetired} credits. Certificate: ${certificateUrl}`);
}

async function handleCreditTransferred(data) {
  const { transferId, amount, recipientAddress } = data;
  console.log(`✓ Credits transferred: ${amount} to ${recipientAddress}`);
}

async function handleCertificateReady(data) {
  const { certificateUrl, retirementId } = data;
  console.log(`✓ Certificate ready for retirement ${retirementId}: ${certificateUrl}`);
}

async function alertOps(message, error) {
  // Send to Slack, PagerDuty, or your monitoring system
  console.error(`[ALERT] ${message}`, error);
}

app.listen(3000, () => {
  console.log('Webhook endpoint listening on port 3000');
});
```

### 3. Test Your Integration

Trigger a test event using the CarbonLedger dashboard, or via API:

```bash
# Perform an action that triggers a webhook
curl -X POST "https://api.carbonledger.io/api/v1/credits/mint" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": 1,
    "serialStart": 2000,
    "serialEnd": 2999,
    "vintageYear": 2024,
    "beneficialOwner": "Test Organization"
  }'
```

Your webhook endpoint will receive the `credit.minted` event.

---

## Event Types

### credit.minted

Sent when new carbon credits are issued.

**Payload**:
```json
{
  "id": "evt_1234567890abcdef",
  "event": "credit.minted",
  "timestamp": "2026-06-01T12:34:56.000Z",
  "data": {
    "batchId": "batch_abc123",
    "projectId": 1,
    "amount": 1000,
    "vintageYear": 2024,
    "serialStart": 2000,
    "serialEnd": 2999,
    "issuer": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
    "beneficialOwner": "Test Organization",
    "txHash": "abc123def456789..."
  }
}
```

**Use cases**:
- Update credit inventory
- Trigger certification workflows
- Update ESG dashboards
- Notify stakeholders

---

### credit.retired

Sent when carbon credits are permanently removed from circulation.

**Payload**:
```json
{
  "id": "evt_1234567890abcdef",
  "event": "credit.retired",
  "timestamp": "2026-06-01T12:34:56.000Z",
  "data": {
    "retirementId": "ret_xyz789",
    "creditIds": ["batch_abc123", "batch_def456"],
    "totalRetired": 2000,
    "beneficialAccount": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
    "reason": "Carbon offset for 2024 operations",
    "certificateUrl": "https://cdn.carbonledger.io/certificates/ret_xyz789.pdf",
    "txHash": "abc123def456789..."
  }
}
```

**Use cases**:
- Verify retirement for compliance reporting
- Download and archive certificates
- Update ESG disclosure documents
- Trigger notification to stakeholders

---

### credit.transferred

Sent when credits change ownership.

**Payload**:
```json
{
  "id": "evt_1234567890abcdef",
  "event": "credit.transferred",
  "timestamp": "2026-06-01T12:34:56.000Z",
  "data": {
    "transferId": "xfer_abc123",
    "creditIds": ["batch_def456"],
    "amount": 500,
    "fromAddress": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
    "toAddress": "GBXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789ABCDEFGH",
    "txHash": "abc123def456789..."
  }
}
```

**Use cases**:
- Track credit ownership changes
- Validate counterparty transactions
- Update accounting records
- Audit trail logging

---

### certificate.ready

Sent when a retirement certificate is generated and available for download.

**Payload**:
```json
{
  "id": "evt_1234567890abcdef",
  "event": "certificate.ready",
  "timestamp": "2026-06-01T12:34:56.000Z",
  "data": {
    "retirementId": "ret_xyz789",
    "certificateId": "cert_abc123",
    "certificateUrl": "https://cdn.carbonledger.io/certificates/ret_xyz789.pdf",
    "recipientEmail": "user@example.com",
    "vintageYears": [2023, 2024],
    "totalAmount": 2500,
    "generatedAt": "2026-06-01T12:34:56.000Z"
  }
}
```

**Use cases**:
- Send certificate to user email
- Store certificate in document management system
- Update ESG reporting dashboards
- Archive for audit compliance

---

### marketplace.listed

Sent when credits are listed on the secondary marketplace.

**Payload**:
```json
{
  "id": "evt_1234567890abcdef",
  "event": "marketplace.listed",
  "timestamp": "2026-06-01T12:34:56.000Z",
  "data": {
    "listingId": "list_abc123",
    "creditIds": ["batch_abc123"],
    "amount": 500,
    "pricePerCredit": 25.50,
    "currency": "USD",
    "seller": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEANS7Y42VEJUCNHALX4U63ZE",
    "expiresAt": "2026-07-01T00:00:00.000Z"
  }
}
```

---

### marketplace.delisted

Sent when credits are removed from the marketplace.

**Payload**:
```json
{
  "id": "evt_1234567890abcdef",
  "event": "marketplace.delisted",
  "timestamp": "2026-06-01T12:34:56.000Z",
  "data": {
    "listingId": "list_abc123",
    "reason": "manual_delisting",
    "creditIds": ["batch_abc123"],
    "amount": 500
  }
}
```

---

## Subscription Management

### Create Subscription

```bash
curl -X POST "https://api.carbonledger.io/api/v1/webhooks/subscribe" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/webhooks/carbonledger",
    "events": ["credit.minted", "credit.retired"],
    "description": "Production webhook"
  }'
```

### List Subscriptions

```bash
curl -X GET "https://api.carbonledger.io/api/v1/webhooks/subscriptions" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### View Subscription Delivery History

```bash
curl -X GET "https://api.carbonledger.io/api/v1/webhooks/subscriptions/{subscriptionId}/deliveries?page=1&status=failed" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Deactivate Subscription

```bash
curl -X DELETE "https://api.carbonledger.io/api/v1/webhooks/subscriptions/{subscriptionId}" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Signature Verification

Every webhook includes an HMAC-SHA256 signature. Verification is **required** for security.

### Headers

```
X-CarbonLedger-Signature: t=1623038400,v1=abcdef1234567890
X-CarbonLedger-Event: credit.minted
X-CarbonLedger-Delivery-Timestamp: 1623038400
User-Agent: CarbonLedger-Webhook/1.0
```

### Verification Process

**Step 1: Extract signature components**
```
Signature: t=<timestamp>,v1=<signature>
```

**Step 2: Create message to verify**
```
message = "{timestamp}.{raw_body}"
```

**Step 3: Compute HMAC**
```
expected_sig = HMAC-SHA256(secret, message)
```

**Step 4: Constant-time comparison**
```
valid = timingSafeEqual(signature, expected_sig)
```

### Implementation Examples

**Node.js/JavaScript**:
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(request, secret) {
  const signature = request.headers['x-carbonledger-signature'];
  const timestamp = request.headers['x-carbonledger-delivery-timestamp'];
  const body = request.rawBody; // Must be raw, not parsed JSON

  if (!signature || !timestamp) {
    throw new Error('Missing webhook headers');
  }

  // Parse signature: "t=<timestamp>,v1=<sig>"
  const parts = signature.split(',');
  const sig = parts.find(p => p.startsWith('v1='))?.split('=')[1];

  if (!sig) {
    throw new Error('Invalid signature format');
  }

  // Verify timestamp (max 5 min old)
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Math.abs(now - ts) > 300) {
    throw new Error('Webhook timestamp outside tolerance');
  }

  // Verify signature
  const message = `${timestamp}.${body}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('Signature verification failed');
  }

  return true;
}
```

**Python**:
```python
import hmac
import hashlib
import time

def verify_webhook_signature(signature_header, timestamp_header, body, secret):
    """Verify CarbonLedger webhook signature."""
    
    # Parse signature header
    parts = dict(part.split('=') for part in signature_header.split(','))
    sig = parts.get('v1')
    
    if not sig:
        raise ValueError('Invalid signature format')
    
    # Verify timestamp (max 300 seconds old)
    now = int(time.time())
    ts = int(timestamp_header)
    if abs(now - ts) > 300:
        raise ValueError('Webhook timestamp outside tolerance')
    
    # Verify signature
    message = f'{timestamp_header}.{body}'.encode()
    secret_bytes = secret.encode()
    expected_sig = hmac.new(
        secret_bytes,
        message,
        hashlib.sha256
    ).hexdigest()
    
    # Constant-time comparison
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError('Signature verification failed')
    
    return True
```

**Go**:
```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
	"hex"
	"strings"
	"time"
)

func VerifyWebhookSignature(signatureHeader, timestampHeader string, body []byte, secret string) error {
	// Parse signature header
	parts := strings.Split(signatureHeader, ",")
	var sig string
	for _, part := range parts {
		if strings.HasPrefix(part, "v1=") {
			sig = strings.TrimPrefix(part, "v1=")
			break
		}
	}
	if sig == "" {
		return fmt.Errorf("invalid signature format")
	}

	// Verify timestamp
	now := time.Now().Unix()
	ts := parseInt(timestampHeader)
	if abs(now-ts) > 300 {
		return fmt.Errorf("webhook timestamp outside tolerance")
	}

	// Verify signature
	message := fmt.Sprintf("%s.%s", timestampHeader, string(body))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(sig), []byte(expectedSig)) {
		return fmt.Errorf("signature verification failed")
	}

	return nil
}
```

---

## Delivery Guarantees

### Retry Policy

Failed deliveries are retried using exponential backoff:

| Attempt | Delay After Previous | Total Wait | Backoff Window |
|---------|---------------------|-----------|---|
| 1 | Immediate | 0s | 0s - 0s |
| 2 | 1 min | 1 min | ±10% |
| 3 | 5 min | 6 min | ±10% |
| 4 | 30 min | 36 min | ±10% |
| 5 | 2 hours | 2h 36m | ±10% |
| Failed | Move to DLQ | N/A | N/A |

**Total retry window**: ~11 hours

### At-Least-Once Delivery

Each event is delivered **at least once**, but possibly more than once:
- Network issues may cause duplicate deliveries
- **Your endpoint must be idempotent**

**Best practice**: Use event ID for deduplication
```javascript
const processedEvents = new Set();

app.post('/webhooks/carbonledger', async (req, res) => {
  const webhookData = JSON.parse(req.body);
  
  // Check if already processed
  if (processedEvents.has(webhookData.id)) {
    console.log(`Webhook ${webhookData.id} already processed`);
    return res.status(202).json({ received: true });
  }
  
  // Process event
  processedEvents.add(webhookData.id);
  await handleWebhookEvent(webhookData);
  
  res.status(202).json({ received: true });
});
```

### Dead-Letter Queue

Events that fail all 5 retry attempts are stored in the dead-letter queue (DLQ):

```bash
# View dead-letter queue (admin endpoint)
curl -X GET "https://api.carbonledger.io/api/v1/admin/webhooks/dlq?page=1&limit=50" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

Response:
```json
{
  "data": [
    {
      "id": "dlq_entry_123",
      "subscriptionId": "whsub_xyz",
      "eventId": "evt_abc",
      "eventType": "credit.retired",
      "error": "Connection timeout after 30s",
      "lastAttemptAt": "2026-06-02T10:20:00.000Z",
      "payload": { ... }
    }
  ],
  "pagination": { ... }
}
```

---

## Error Handling

### Common Issues & Solutions

**Issue: Signature verification fails**
- Ensure `WEBHOOK_SECRET` matches the subscription's secret
- Ensure you're using the raw request body, not parsed JSON
- Verify timestamp is recent (within 5 minutes)

**Issue: Webhook endpoint not receiving events**
- Check that endpoint returns 2xx status code
- Verify endpoint is publicly accessible (not behind VPN/firewall)
- Check firewall allows HTTPS outbound from CarbonLedger IPs
- View delivery history: `GET /api/v1/webhooks/subscriptions/{id}/deliveries`

**Issue: Duplicate events processed**
- Implement idempotency using event ID
- Store processed event IDs in database or cache
- Check before processing: `SELECT * FROM processed_events WHERE event_id = ?`

**Issue: Events not processed in order**
- Webhooks are delivered in order within a single subscription
- Across multiple subscriptions, order is not guaranteed
- Order events in your application using timestamp or sequence number

### Monitoring & Alerts

Set up monitoring for:
1. **Failed deliveries**: Alert when `failedDeliveryCount` > 5
2. **Stale webhooks**: Alert when no delivery for 24+ hours
3. **Endpoint errors**: Track 5xx responses from your endpoint
4. **Processing latency**: Monitor time from event creation to processing

```javascript
// Example monitoring integration
async function monitorWebhookHealth() {
  const subscriptions = await getWebhookSubscriptions();
  
  for (const sub of subscriptions) {
    if (sub.failedDeliveryCount > 5) {
      await alertOps(
        `Webhook ${sub.id} has ${sub.failedDeliveryCount} failed deliveries`
      );
    }
    
    const timeSinceLastDelivery = Date.now() - new Date(sub.lastDeliveryAt);
    if (timeSinceLastDelivery > 24 * 60 * 60 * 1000) {
      await alertOps(`Webhook ${sub.id} stale (no delivery in 24h)`);
    }
  }
}

// Run every hour
setInterval(monitorWebhookHealth, 60 * 60 * 1000);
```

---

## Testing & Debugging

### Local Development

Use **ngrok** or **localtunnel** to expose local endpoint:

```bash
# Install ngrok
brew install ngrok

# Start tunnel to localhost:3000
ngrok http 3000
```

Create webhook subscription with ngrok URL:
```bash
curl -X POST "https://api.carbonledger.io/api/v1/webhooks/subscribe" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://abc123.ngrok.io/webhooks/carbonledger",
    "events": ["credit.minted"],
    "description": "Local development"
  }'
```

### Manual Testing

Trigger a webhook by performing an action:

```bash
# Mint credits (triggers credit.minted event)
curl -X POST "https://api.carbonledger.io/api/v1/credits/mint" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": 1,
    "serialStart": 5000,
    "serialEnd": 5999,
    "vintageYear": 2024
  }'
```

### Logging & Debugging

Enable detailed logging:

```javascript
process.env.DEBUG = 'carbonledger:*';

// Log all incoming webhooks
app.post('/webhooks/carbonledger', (req, res) => {
  console.log('[webhook] Received:');
  console.log('  Event:', req.headers['x-carbonledger-event']);
  console.log('  Timestamp:', req.headers['x-carbonledger-delivery-timestamp']);
  console.log('  Signature:', req.headers['x-carbonledger-signature']);
  console.log('  Body:', req.body.toString());
  
  // ... rest of handler
});
```

### Test Framework Integration

**Jest/Node.js**:
```javascript
describe('Webhook Integration', () => {
  it('should handle credit.minted event', async () => {
    const event = {
      id: 'evt_test123',
      event: 'credit.minted',
      timestamp: new Date().toISOString(),
      data: {
        batchId: 'batch_test',
        projectId: 1,
        amount: 1000,
        vintageYear: 2024,
        serialStart: 1000,
        serialEnd: 1999
      }
    };

    const response = await request(app)
      .post('/webhooks/carbonledger')
      .send(event)
      .set({
        'x-carbonledger-event': 'credit.minted',
        'x-carbonledger-signature': generateSignature(event),
        'x-carbonledger-delivery-timestamp': String(Math.floor(Date.now() / 1000))
      });

    expect(response.status).toBe(202);
    // Assert event was processed
    expect(await db.events.findOne({ id: event.id })).toBeDefined();
  });
});
```

---

## Best Practices

### 1. Always Verify Signatures

**Never skip signature verification**, even in testing:
```javascript
// ✅ Good
if (!verifySignature(signature, timestamp, body, secret)) {
  return res.status(401).json({ error: 'Invalid signature' });
}

// ❌ Bad
if (process.env.NODE_ENV === 'production') {
  // Don't skip in dev!
  verifySignature(...);
}
```

### 2. Process Asynchronously

Return 2xx immediately, process event in background:
```javascript
// ✅ Good
app.post('/webhooks', (req, res) => {
  res.status(202).json({ received: true }); // Acknowledge immediately
  handleEvent(req.body).catch(err => logger.error(err)); // Process later
});

// ❌ Bad - Times out for slow processing
app.post('/webhooks', async (req, res) => {
  await expensiveOperation(req.body); // Too slow!
  res.status(200).json({ processed: true });
});
```

### 3. Implement Idempotency

Use event ID to avoid duplicate processing:
```javascript
async function handleEvent(event) {
  const existingRecord = await db.processedEvents.findOne({ id: event.id });
  if (existingRecord) {
    logger.info(`Event ${event.id} already processed`);
    return; // Idempotent
  }

  // Process event
  await updateDatabase(event);
  
  // Record as processed
  await db.processedEvents.create({ id: event.id, processedAt: new Date() });
}
```

### 4. Monitor Webhook Health

Track metrics:
- Delivery success rate (target: >99.9%)
- Processing latency (target: <5s)
- Failed delivery count
- Time since last delivery

### 5. Use Appropriate Timeouts

- **Signature verification**: <100ms
- **Queue to worker**: <1s
- **Total delivery**: 30s
- **Async processing**: No limit (depends on your system)

### 6. Securely Store Secrets

**DO**:
```bash
export CARBONLEDGER_WEBHOOK_SECRET=whsec_xxx
```

**DON'T**:
```javascript
const secret = "whsec_xxx"; // Hardcoded!
```

### 7. Implement Rate Limiting

Webhooks count toward your API rate limits. Adjust accordingly:
```javascript
// If receiving 1000 webhooks/min, ensure your endpoint 
// can handle the throughput
const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2000 // Adjust based on expected volume
});

app.post('/webhooks/carbonledger', webhookRateLimiter, handler);
```

### 8. Version Your Handler

Include version in URL for future compatibility:
```javascript
// v1 endpoint
app.post('/webhooks/carbonledger/v1', handleWebhookV1);

// Future v2 endpoint
app.post('/webhooks/carbonledger/v2', handleWebhookV2);
```

---

## Migration Guide

### Migrating from Polling to Webhooks

If you currently poll the API for credit updates, webhooks provide real-time events:

**Before (Polling)**:
```javascript
// Poll every 5 minutes
setInterval(async () => {
  const credits = await fetch('/api/v1/credits?since=lastCheck');
  // Process new credits
}, 5 * 60 * 1000);
```

**After (Webhooks)**:
```javascript
// Real-time events
app.post('/webhooks/carbonledger', async (req, res) => {
  const event = JSON.parse(req.body);
  if (event.event === 'credit.minted') {
    // Handle immediately
    await updateInventory(event.data);
  }
  res.status(202).json({ received: true });
});
```

### Deprecation Timeline

- **v1 (Current)**: Webhooks available
- **v2 (Future)**: New event types added
- **v3 (Future)**: Polling API deprecated (webhooks only)

---

## Support

- **Documentation**: https://api-docs.carbonledger.io
- **GitHub Issues**: https://github.com/carbonledger/carbonledger/issues
- **Email**: api-support@carbonledger.io
- **Slack Community**: [Join](https://slack.carbonledger.io)
