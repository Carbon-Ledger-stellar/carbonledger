import { WalletSignatureService } from './wallet-signature.service';
import * as StellarSdk from '@stellar/stellar-sdk';

describe('WalletSignatureService', () => {
  let service: WalletSignatureService;
  let keypair: StellarSdk.Keypair;

  beforeEach(() => {
    service = new WalletSignatureService();
    keypair = StellarSdk.Keypair.random();
  });

  // ── Helper ────────────────────────────────────────────────────────────────

  function sign(
    kp: StellarSdk.Keypair,
    timestamp: number,
    nonce: string,
    body: Record<string, unknown>,
  ): string {
    const payload = service.buildPayload(timestamp, nonce, body);
    const sig = kp.sign(Buffer.from(payload, 'utf8'));
    return sig.toString('hex');
  }

  // ── isTimestampValid ───────────────────────────────────────────────────────

  describe('isTimestampValid', () => {
    it('accepts a timestamp within the tolerance window', () => {
      const result = service.isTimestampValid(Date.now());
      expect(result.valid).toBe(true);
    });

    it('rejects a timestamp older than 5 minutes', () => {
      const old = Date.now() - 6 * 60 * 1000;
      const result = service.isTimestampValid(old);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/expired/);
    });

    it('rejects a future timestamp beyond 5 minutes', () => {
      const future = Date.now() + 6 * 60 * 1000;
      const result = service.isTimestampValid(future);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/future-dated/);
    });

    it('rejects zero timestamp', () => {
      const result = service.isTimestampValid(0);
      expect(result.valid).toBe(false);
    });

    it('rejects NaN timestamp', () => {
      const result = service.isTimestampValid(NaN);
      expect(result.valid).toBe(false);
    });

    it('accepts a timestamp at the exact boundary', () => {
      const tolerance = WalletSignatureService.TIMESTAMP_TOLERANCE_MS;
      // Exactly at the boundary — valid
      const result = service.isTimestampValid(Date.now() - tolerance + 100);
      expect(result.valid).toBe(true);
    });
  });

  // ── isNonceConsumed / consumeNonce ────────────────────────────────────────

  describe('isNonceConsumed / consumeNonce', () => {
    it('returns false for an unknown nonce', () => {
      expect(service.isNonceConsumed('unknown-nonce-xyz')).toBe(false);
    });

    it('returns true after consuming a nonce', () => {
      const nonce = 'test-nonce-1234567890';
      service.consumeNonce(nonce, 60_000);
      expect(service.isNonceConsumed(nonce)).toBe(true);
    });

    it('returns false after the nonce TTL has expired', () => {
      const nonce = 'expiring-nonce';
      // Set TTL in the past
      service.consumeNonce(nonce, -1);
      // Next call purges expired nonces
      expect(service.isNonceConsumed(nonce)).toBe(false);
    });
  });

  // ── verifyRequestSignature — success ──────────────────────────────────────

  describe('verifyRequestSignature (success)', () => {
    it('accepts a valid signature', () => {
      const timestamp = Date.now();
      const nonce = 'valid-nonce-abc123def456';
      const body = { amount: 100, batchId: 'batch-1' };
      const signature = sign(keypair, timestamp, nonce, body);

      const result = service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        timestamp,
        body,
      );

      expect(result.valid).toBe(true);
    });

    it('canonicalises body key order before verification', () => {
      const timestamp = Date.now();
      const nonce = 'canon-nonce-abc123def456';
      const bodyInOrder = { amount: 100, batchId: 'batch-1' };
      const bodyOutOfOrder = { batchId: 'batch-1', amount: 100 };
      const signature = sign(keypair, timestamp, nonce, bodyInOrder);

      // Body with different key order must still verify
      const result = service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        timestamp,
        bodyOutOfOrder,
      );

      expect(result.valid).toBe(true);
    });

    it('consumes the nonce on success (preventing replay)', () => {
      const timestamp = Date.now();
      const nonce = 'one-time-nonce-abc12345';
      const body = {};
      const signature = sign(keypair, timestamp, nonce, body);

      service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        timestamp,
        body,
      );

      expect(service.isNonceConsumed(nonce)).toBe(true);
    });
  });

  // ── verifyRequestSignature — invalid signature ────────────────────────────

  describe('verifyRequestSignature (invalid signature)', () => {
    it('rejects a wrong signature', () => {
      const timestamp = Date.now();
      const nonce = 'wrong-sig-nonce-abc12345';
      const body = { amount: 100 };
      const wrongSig = 'a'.repeat(128); // 64 bytes of 0xaa, invalid

      const result = service.verifyRequestSignature(
        keypair.publicKey(),
        wrongSig,
        nonce,
        timestamp,
        body,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('rejects a signature from a different keypair', () => {
      const otherKeypair = StellarSdk.Keypair.random();
      const timestamp = Date.now();
      const nonce = 'other-key-nonce-abc12345';
      const body = { amount: 100 };
      const signature = sign(otherKeypair, timestamp, nonce, body);

      const result = service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        timestamp,
        body,
      );

      expect(result.valid).toBe(false);
    });

    it('rejects a signature over a different body', () => {
      const timestamp = Date.now();
      const nonce = 'diff-body-nonce-abc12345';
      const originalBody = { amount: 100 };
      const tamperedBody = { amount: 9999 };
      const signature = sign(keypair, timestamp, nonce, originalBody);

      const result = service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        timestamp,
        tamperedBody,
      );

      expect(result.valid).toBe(false);
    });
  });

  // ── verifyRequestSignature — replay attack ────────────────────────────────

  describe('verifyRequestSignature (replay attack)', () => {
    it('rejects a replayed request with the same nonce', () => {
      const timestamp = Date.now();
      const nonce = 'replay-nonce-abc12345678';
      const body = {};
      const signature = sign(keypair, timestamp, nonce, body);

      // First request — valid
      const first = service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        timestamp,
        body,
      );
      expect(first.valid).toBe(true);

      // Replay — same nonce, different timestamp to bypass the timestamp check
      const result = service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        Date.now(),
        body,
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/replay/i);
    });
  });

  // ── verifyRequestSignature — timestamp expired ────────────────────────────

  describe('verifyRequestSignature (timestamp)', () => {
    it('rejects an expired timestamp', () => {
      const expiredTimestamp = Date.now() - 10 * 60 * 1000; // 10 min ago
      const nonce = 'expired-ts-nonce-abc1234';
      const body = {};
      const signature = sign(keypair, expiredTimestamp, nonce, body);

      const result = service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        expiredTimestamp,
        body,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/expired/);
    });

    it('rejects a far-future timestamp', () => {
      const futureTimestamp = Date.now() + 10 * 60 * 1000;
      const nonce = 'future-ts-nonce-abc12345';
      const body = {};
      const signature = sign(keypair, futureTimestamp, nonce, body);

      const result = service.verifyRequestSignature(
        keypair.publicKey(),
        signature,
        nonce,
        futureTimestamp,
        body,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/future-dated/);
    });
  });

  // ── buildPayload canonical format ─────────────────────────────────────────

  describe('buildPayload', () => {
    it('produces consistent output regardless of input key order', () => {
      const ts = 1_700_000_000_000;
      const nonce = 'test-nonce';
      const a = service.buildPayload(ts, nonce, { z: 1, a: 2 });
      const b = service.buildPayload(ts, nonce, { a: 2, z: 1 });
      expect(a).toBe(b);
    });

    it('includes timestamp and nonce as prefix', () => {
      const ts = 1_700_000_000_000;
      const nonce = 'my-nonce';
      const payload = service.buildPayload(ts, nonce, {});
      expect(payload.startsWith(`${ts}:${nonce}:`)).toBe(true);
    });
  });
});
