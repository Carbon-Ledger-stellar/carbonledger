import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Deterministically stringifies an object with keys sorted recursively, so
 * the signature is not sensitive to property insertion order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export interface CertificateSignature {
  contentHash: string; // hex-encoded SHA-256 of the canonicalized content
  signature: string; // hex-encoded Ed25519 signature over contentHash
  publicKey: string; // Stellar (G...) public key — must match Stellar.toml's CERTIFICATE_SIGNING_KEY
}

/**
 * Signs retirement certificates with a CarbonLedger-controlled Ed25519
 * (Stellar) key pair so third parties can verify authenticity using only
 * the public key published in Stellar.toml — no trust in this backend
 * required (#594).
 */
@Injectable()
export class CertificateSigningService {
  private readonly logger = new Logger(CertificateSigningService.name);
  private readonly keypair: StellarSdk.Keypair;

  constructor() {
    const secret = process.env.CERTIFICATE_SIGNING_SECRET;
    if (secret) {
      this.keypair = StellarSdk.Keypair.fromSecret(secret);
    } else {
      // Dev/test fallback so the service doesn't crash on boot. Signatures
      // produced this way will NOT match the public key published in
      // Stellar.toml — CERTIFICATE_SIGNING_SECRET must be set in production.
      this.keypair = StellarSdk.Keypair.random();
      this.logger.warn(
        'CERTIFICATE_SIGNING_SECRET not set — using an ephemeral signing key. ' +
          'Certificates signed now cannot be verified against Stellar.toml.',
      );
    }
  }

  getPublicKey(): string {
    return this.keypair.publicKey();
  }

  hashContent(content: Record<string, unknown>): Buffer {
    return crypto.createHash('sha256').update(canonicalize(content)).digest();
  }

  /**
   * Signs the SHA-256 hash of the canonicalized certificate content. The
   * signature covers every substantive field passed in `content` — callers
   * must include all fields that should be tamper-evident (project id,
   * vintage year, serial range, retirement tx hash, beneficiary, timestamp,
   * etc.) and must exclude the signature fields themselves.
   */
  sign(content: Record<string, unknown>): CertificateSignature {
    const hash = this.hashContent(content);
    const signature = this.keypair.sign(hash);
    return {
      contentHash: hash.toString('hex'),
      signature: signature.toString('hex'),
      publicKey: this.keypair.publicKey(),
    };
  }

  /**
   * Verifies a certificate's signature. Pure/static so it can run with only
   * the public key from Stellar.toml — the same logic the standalone CLI
   * tool (scripts/verify-certificate.js) uses.
   */
  static verify(content: Record<string, unknown>, signatureHex: string, publicKey: string): boolean {
    const hash = crypto.createHash('sha256').update(canonicalize(content)).digest();
    try {
      return StellarSdk.Keypair.fromPublicKey(publicKey).verify(hash, Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  }
}
