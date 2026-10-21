import crypto from 'crypto';
import axios, { AxiosRequestConfig } from 'axios';
import { logger } from '../utils/logger';

/**
 * Webhook delivery service.
 *
 * Payloads are signed with HMAC-SHA256 so receivers can verify authenticity.
 * The signature covers the timestamp and the raw JSON body to prevent replay
 * attacks: `X-CarbonLedger-Signature: t=<unix>,v1=<hex hmac>`.
 */

export interface WebhookPayload {
  event: string;
  data: unknown;
  timestamp?: number;
}

export interface WebhookDeliveryResult {
  success: boolean;
  status?: number;
  error?: string;
}

const SIGNATURE_HEADER = 'X-CarbonLedger-Signature';
const TIMESTAMP_HEADER = 'X-CarbonLedger-Timestamp';

function getSigningSecret(): string {
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    throw new Error('WEBHOOK_SIGNING_SECRET is not configured');
  }
  return secret;
}

/**
 * Compute the HMAC-SHA256 signature for a timestamped payload.
 * The signed message is `${timestamp}.${rawBody}` so the timestamp is
 * tamper-evident and cannot be altered without invalidating the signature.
 */
export function signWebhookPayload(rawBody: string, timestamp: number, secret?: string): string {
  const signingSecret = secret ?? getSigningSecret();
  return crypto
    .createHmac('sha256', signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

/**
 * Build the signature header value: `t=<unix>,v1=<hex>`.
 */
export function buildSignatureHeader(rawBody: string, timestamp: number, secret?: string): string {
  const signature = signWebhookPayload(rawBody, timestamp, secret);
  return `t=${timestamp},v1=${signature}`;
}

export async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  options: AxiosRequestConfig = {}
): Promise<WebhookDeliveryResult> {
  const timestamp = Math.floor(Date.now() / 1000);
  const body: WebhookPayload = { ...payload, timestamp };
  const rawBody = JSON.stringify(body);

  let signatureHeader: string;
  try {
    signatureHeader = buildSignatureHeader(rawBody, timestamp);
  } catch (err) {
    logger.error('Failed to sign webhook payload', { error: (err as Error).message });
    return { success: false, error: (err as Error).message };
  }

  try {
    const response = await axios.post(url, rawBody, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        [SIGNATURE_HEADER]: signatureHeader,
        [TIMESTAMP_HEADER]: String(timestamp),
        ...(options.headers ?? {}),
      },
    });

    return { success: response.status >= 200 && response.status < 300, status: response.status };
  } catch (err) {
    const error = err as { response?: { status?: number }; message?: string };
    logger.error('Webhook delivery failed', { url, error: error.message });
    return { success: false, status: error.response?.status, error: error.message };
  }
}
