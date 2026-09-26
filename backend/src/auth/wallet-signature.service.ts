import { Injectable, Logger } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';

/** Result of a signature verification attempt */
export interface SignatureVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * WalletSignatureService — Ed25519 signature verification for HTTP requests.
 *
 * Clients sign the canonical payload string:
 *   `${timestamp}:${nonce}:${canonicalBody}`
 *
 * where `canonicalBody` is the JSON-serialised request body with keys sorted
 * alphabetically (deterministic regardless of client serialisation order).
 *
 * Protection properties:
 *  - Replay prevention: each nonce is single-use and stored with a TTL
 *  - Timestamp freshness: rejections if timestamp is >5 minutes from now
 *  - Forward/backward: rejects both stale and future-dated timestamps
 *
 * Issue #1078: Wallet Signature Verification.
 */
@Injectable()
export class WalletSignatureService {
  private readonly logger = new Logger(WalletSignatureService.name);

  /** 5 minutes in milliseconds — both max age and max future skew */
  static readonly TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

  /** In-memory nonce store: nonce → expiresAt (epoch ms) */
  private readonly nonceStore = new Map<string, number>();

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Full pipeline: validate timestamp, check nonce, verify ed25519 signature.
   *
   * @param publicKey  - Stellar public key (G...)
   * @param signature  - Hex-encoded Ed25519 signature
   * @param nonce      - Single-use random string from the client
   * @param timestamp  - Unix epoch milliseconds at signing time
   * @param body       - Raw request body object (will be canonicalised)
   */
  verifyRequestSignature(
    publicKey: string,
    signature: string,
    nonce: string,
    timestamp: number,
    body: Record<string, unknown>,
  ): SignatureVerificationResult {
    // 1. Timestamp freshness
    const tsCheck = this.isTimestampValid(timestamp);
    if (!tsCheck.valid) return tsCheck;

    // 2. Nonce reuse
    if (this.isNonceConsumed(nonce)) {
      return { valid: false, reason: 'Nonce has already been used (replay detected).' };
    }

    // 3. Signature
    const canonicalPayload = this.buildPayload(timestamp, nonce, body);
    const sigCheck = this.verifySignature(publicKey, signature, canonicalPayload);
    if (!sigCheck.valid) return sigCheck;

    // 4. Consume nonce on success
    this.consumeNonce(nonce, WalletSignatureService.TIMESTAMP_TOLERANCE_MS * 2);

    return { valid: true };
  }

  /**
   * Validate that a Unix-epoch-millisecond timestamp is within the
   * acceptable freshness window (±5 minutes from server time).
   */
  isTimestampValid(
    timestamp: number,
    toleranceMs = WalletSignatureService.TIMESTAMP_TOLERANCE_MS,
  ): SignatureVerificationResult {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return { valid: false, reason: 'Timestamp is missing or not a valid number.' };
    }
    const now = Date.now();
    const diff = Math.abs(now - timestamp);
    if (diff > toleranceMs) {
      const direction = timestamp < now ? 'expired' : 'future-dated';
      return {
        valid: false,
        reason: `Request timestamp is ${direction} (skew: ${Math.round(diff / 1000)}s, max allowed: ${Math.round(toleranceMs / 1000)}s).`,
      };
    }
    return { valid: true };
  }

  /**
   * Returns true if the nonce has already been consumed.
   * Also purges any expired entries on each check (lazy GC).
   */
  isNonceConsumed(nonce: string): boolean {
    this.purgeExpiredNonces();
    return this.nonceStore.has(nonce);
  }

  /**
   * Mark a nonce as consumed. Stored with the given TTL so the nonce store
   * does not grow unbounded. TTL should be at least as long as the timestamp
   * tolerance so a nonce cannot be reused within the valid window.
   *
   * @param nonce  - The nonce to consume
   * @param ttlMs  - How long (ms) to keep the nonce before purging it
   */
  consumeNonce(nonce: string, ttlMs: number): void {
    this.nonceStore.set(nonce, Date.now() + ttlMs);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Build the canonical payload string that the client must sign.
   * Keys in `body` are sorted to ensure deterministic JSON serialisation.
   */
  buildPayload(
    timestamp: number,
    nonce: string,
    body: Record<string, unknown>,
  ): string {
    const canonical = this.sortedJsonStringify(body);
    return `${timestamp}:${nonce}:${canonical}`;
  }

  /** Recursively sorts object keys before JSON serialisation */
  private sortedJsonStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.sortedJsonStringify(v)).join(',') + ']';
    }
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {});
    return (
      '{' +
      Object.entries(sorted)
        .map(([k, v]) => `${JSON.stringify(k)}:${this.sortedJsonStringify(v)}`)
        .join(',') +
      '}'
    );
  }

  /** Verify an Ed25519 hex signature against a UTF-8 message using the Stellar SDK */
  private verifySignature(
    publicKey: string,
    signatureHex: string,
    message: string,
  ): SignatureVerificationResult {
    try {
      const keypair = StellarSdk.Keypair.fromPublicKey(publicKey);
      const msgBuffer = Buffer.from(message, 'utf8');
      const sigBuffer = Buffer.from(signatureHex, 'hex');
      const ok = keypair.verify(msgBuffer, sigBuffer);
      if (!ok) {
        return { valid: false, reason: 'Signature verification failed.' };
      }
      return { valid: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Signature verification error: ${msg}`);
      return { valid: false, reason: 'Invalid signature format or public key.' };
    }
  }

  /** Remove all nonces whose TTL has elapsed */
  private purgeExpiredNonces(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.nonceStore) {
      if (now > expiresAt) {
        this.nonceStore.delete(nonce);
      }
    }
  }
}
