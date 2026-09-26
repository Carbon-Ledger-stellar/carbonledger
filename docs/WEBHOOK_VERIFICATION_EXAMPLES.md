# Webhook Signature Verification Examples

This guide provides developers with production-ready examples and security best practices for verifying incoming webhooks from CarbonLedger across **Node.js/TypeScript**, **Python**, and **Go**.

---

## 🔐 Webhook Headers Overview

Every webhook HTTP request delivered by CarbonLedger includes standard security headers:

| Header Name | Description | Example |
|---|---|---|
| `X-CarbonLedger-Signature` | Hex-encoded HMAC-SHA256 digest of the payload. | `sha256=d8e8fca2dc6b1...` |
| `X-CarbonLedger-Timestamp` | Unix timestamp (seconds) when the webhook was generated. | `1725603400` |
| `X-CarbonLedger-Event-Id` | Globally unique identifier (UUIDv4) for idempotent deduplication. | `evt_91f4b23c-7e61-41f2-89b4-a21804f56f10` |

---

## 🛡️ Security Requirements

1. **Constant-Time Comparison**: Always use timing-safe comparison routines (`crypto.timingSafeEqual` in Node.js, `hmac.compare_digest` in Python, `hmac.Equal` in Go) to prevent side-channel timing attacks.
2. **Replay Attack Protection**: Reject webhooks whose `X-CarbonLedger-Timestamp` deviates by more than **300 seconds (5 minutes)** from the recipient server's current time.
3. **Out-of-Order & Duplicate Handling**: Record processed `X-CarbonLedger-Event-Id` in a deduplication cache (e.g. Redis with 24h TTL) to safely discard duplicate or out-of-order retries.
4. **Raw Body Inspection**: Compute HMAC digests on the **exact raw request body bytes** before any JSON parsing or character normalization.

---

## 1. Node.js / TypeScript Example

```typescript
import crypto from 'node:crypto';
import express, { Request, Response } from 'express';

const app = express();
const WEBHOOK_SECRET = process.env.CARBONLEDGER_WEBHOOK_SECRET || 'whsec_sample_secret_key_12345';
const MAX_ALLOWED_CLOCK_SKEW_SECONDS = 300; // 5 minutes

// In-memory replay/event cache (use Redis in production)
const processedEventIds = new Set<string>();

interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string
): WebhookVerificationResult {
  if (!signatureHeader || !timestampHeader) {
    return { valid: false, reason: 'Missing signature or timestamp header' };
  }

  // 1. Replay attack check: verify timestamp tolerance
  const eventTimestamp = parseInt(timestampHeader, 10);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (isNaN(eventTimestamp) || Math.abs(currentTimestamp - eventTimestamp) > MAX_ALLOWED_CLOCK_SKEW_SECONDS) {
    return { valid: false, reason: 'Timestamp outside acceptable window (potential replay attack)' };
  }

  // 2. Canonical signed payload: timestamp + '.' + rawBody
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8');
  const payloadToSign = Buffer.concat([Buffer.from(`${eventTimestamp}.`), bodyBuffer]);

  // 3. Compute HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadToSign);
  const computedSignature = `sha256=${hmac.digest('hex')}`;

  // 4. Timing-safe comparison
  const signatureBuffer = Buffer.from(signatureHeader, 'utf-8');
  const computedBuffer = Buffer.from(computedSignature, 'utf-8');

  if (signatureBuffer.length !== computedBuffer.length) {
    return { valid: false, reason: 'Signature length mismatch' };
  }

  const matches = crypto.timingSafeEqual(signatureBuffer, computedBuffer);
  return { valid: matches, reason: matches ? undefined : 'Signature verification failed' };
}

// Express route handling raw body buffer
app.post(
  '/webhooks/carbonledger',
  express.raw({ type: 'application/json' }),
  (req: Request, res: Response) => {
    const signature = req.header('X-CarbonLedger-Signature');
    const timestamp = req.header('X-CarbonLedger-Timestamp');
    const eventId = req.header('X-CarbonLedger-Event-Id');

    // Deduplication check
    if (eventId && processedEventIds.has(eventId)) {
      console.log(`[Webhook] Duplicate event ignored: ${eventId}`);
      return res.status(200).json({ status: 'ignored_duplicate' });
    }

    const verification = verifyWebhookSignature(req.body, signature, timestamp, WEBHOOK_SECRET);
    if (!verification.valid) {
      console.warn(`[Webhook] Unauthorized: ${verification.reason}`);
      return res.status(401).json({ error: verification.reason });
    }

    if (eventId) {
      processedEventIds.add(eventId);
    }

    const payload = JSON.parse(req.body.toString('utf-8'));
    console.log(`[Webhook] Verified event received: ${payload.event}`);

    // Process event asynchronously
    return res.status(200).json({ status: 'accepted' });
  }
);
```

---

## 2. Python (FastAPI / Standard Library) Example

```python
import hmac
import hashlib
import time
from typing import Optional, Tuple
from fastapi import FastAPI, Request, HTTPException, status

app = FastAPI()
WEBHOOK_SECRET = "whsec_sample_secret_key_12345".encode("utf-8")
MAX_ALLOWED_CLOCK_SKEW_SECONDS = 300  # 5 minutes

# In-memory deduplication set (replace with Redis in production)
processed_event_ids = set()

def verify_webhook_signature(
    raw_body: bytes,
    signature_header: Optional[str],
    timestamp_header: Optional[str],
    secret: bytes
) -> Tuple[bool, Optional[str]]:
    if not signature_header or not timestamp_header:
        return False, "Missing signature or timestamp header"

    # 1. Replay attack check
    try:
        event_time = int(timestamp_header)
    except ValueError:
        return False, "Invalid timestamp format"

    now = int(time.time())
    if abs(now - event_time) > MAX_ALLOWED_CLOCK_SKEW_SECONDS:
        return False, "Timestamp outside tolerance window (replay attack prevention)"

    # 2. Reconstruct canonical signed payload: timestamp.body
    payload = f"{event_time}.".encode("utf-8") + raw_body

    # 3. Compute HMAC-SHA256 digest
    computed_digest = "sha256=" + hmac.new(secret, payload, hashlib.sha256).hexdigest()

    # 4. Constant-time comparison
    if not hmac.compare_digest(signature_header, computed_digest):
        return False, "Invalid signature"

    return True, None

@app.post("/webhooks/carbonledger")
async def handle_carbonledger_webhook(request: Request):
    raw_body = await request.body()
    signature = request.headers.get("X-CarbonLedger-Signature")
    timestamp = request.headers.get("X-CarbonLedger-Timestamp")
    event_id = request.headers.get("X-CarbonLedger-Event-Id")

    # Idempotent deduplication
    if event_id and event_id in processed_event_ids:
        return {"status": "ignored_duplicate"}

    is_valid, error_reason = verify_webhook_signature(raw_body, signature, timestamp, WEBHOOK_SECRET)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error_reason
        )

    if event_id:
        processed_event_ids.add(event_id)

    # Process payload safely
    return {"status": "accepted"}
```

---

## 3. Go (net/http) Example

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const (
	maxAllowedClockSkewSeconds = 300
	webhookSecret              = "whsec_sample_secret_key_12345"
)

var (
	seenEvents = make(map[string]bool)
	seenMu     sync.Mutex
)

// VerifyWebhook checks HMAC-SHA256 signature and timestamp tolerance.
func VerifyWebhook(rawBody []byte, signatureHeader, timestampHeader, secret string) (bool, error) {
	if signatureHeader == "" || timestampHeader == "" {
		return false, fmt.Errorf("missing signature or timestamp headers")
	}

	eventTimestamp, err := strconv.ParseInt(timestampHeader, 10, 64)
	if err != nil {
		return false, fmt.Errorf("invalid timestamp header: %w", err)
	}

	// 1. Clock skew check
	now := time.Now().Unix()
	if math.Abs(float64(now-eventTimestamp)) > float64(maxAllowedClockSkewSeconds) {
		return false, fmt.Errorf("timestamp exceeds 300s clock skew window")
	}

	// 2. Canonical payload: <timestamp>.<raw_body>
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", eventTimestamp)))
	mac.Write(rawBody)
	expectedHex := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	// 3. Constant-time comparison
	if !hmac.Equal([]byte(signatureHeader), []byte(expectedHex)) {
		return false, fmt.Errorf("signature verification failed")
	}

	return true, nil
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	signature := r.Header.Get("X-CarbonLedger-Signature")
	timestamp := r.Header.Get("X-CarbonLedger-Timestamp")
	eventID := r.Header.Get("X-CarbonLedger-Event-Id")

	// Deduplication check
	if eventID != "" {
		seenMu.Lock()
		if seenEvents[eventID] {
			seenMu.Unlock()
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ignored_duplicate"}`))
			return
		}
		seenEvents[eventID] = true
		seenMu.Unlock()
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Cannot read body", http.StatusBadRequest)
		return
	}

	valid, err := VerifyWebhook(bodyBytes, signature, timestamp, webhookSecret)
	if !valid || err != nil {
		http.Error(w, fmt.Sprintf("Unauthorized: %v", err), http.StatusUnauthorized)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"accepted"}`))
}

func main() {
	http.HandleFunc("/webhooks/carbonledger", webhookHandler)
	fmt.Println("Server listening on :8080...")
	http.ListenAndServe(":8080", nil)
}
```

---

## 📋 Security Checklist

- [x] Use HTTPS endpoints only for receiving webhooks in production.
- [x] Read raw body before JSON parsing to avoid whitespace/key-ordering mutations.
- [x] Reject any request where `|now - timestamp| > 300` seconds.
- [x] Use timing-safe equality functions to avoid side-channel information leaks.
- [x] Store webhook secrets securely (e.g. AWS Secrets Manager, HashiCorp Vault).
- [x] Persist event IDs in a shared cache to handle duplicate or out-of-order arrivals.
