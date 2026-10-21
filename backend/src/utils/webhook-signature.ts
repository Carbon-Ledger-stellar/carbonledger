import { createHmac, timingSafeEqual } from 'crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'X-CarbonLedger-Signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'X-CarbonLedger-Timestamp';

/**
 * Builds the canonical string that is signed for a webhook delivery.
 * The timestamp is part of the signed payload so receivers can reject
 * replayed deliveries by checking it against a tolerance window.
 */
export function buildWebhookSignaturePayload(
  timestamp: string | number,
  rawBody: string,
): string {
  return `${timestamp}.${rawBody}`;
}

/**
 * Computes an HMAC-SHA256 signature for a webhook payload.
 * Returns the hex-encoded digest to be sent in the
 * X-CarbonLedger-Signature header.
 */
export function signWebhookPayload(
  secret: string,
  rawBody: string,
  timestamp: string | number = Math.floor(Date.now() / 1000),
): { signature: string; timestamp: string } {
  const ts = String(timestamp);
  const payload = buildWebhookSignaturePayload(ts, rawBody);
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return { signature, timestamp: ts };
}

/**
 * Verifies a received webhook signature against the expected HMAC.
 * Uses a constant-time comparison to avoid timing attacks.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  timestamp: string | number,
  receivedSignature: string,
): boolean {
  const { signature } = signWebhookPayload(secret, rawBody, timestamp);
  const expected = Buffer.from(signature, 'hex');
  const received = Buffer.from(receivedSignature, 'hex');
  if (expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}

/**
 * Returns the headers required to sign a webhook delivery.
 */
export function buildWebhookSignatureHeaders(
  secret: string,
  rawBody: string,
  timestamp: string | number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const { signature, timestamp: ts } = signWebhookPayload(secret, rawBody, timestamp);
  return {
    [WEBHOOK_SIGNATURE_HEADER]: signature,
    [WEBHOOK_TIMESTAMP_HEADER]: ts,
  };
}
