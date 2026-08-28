import * as StellarSdk from '@stellar/stellar-sdk';
import { CertificateSigningService, canonicalize } from './certificate-signing.service';

describe('CertificateSigningService', () => {
  const secret = StellarSdk.Keypair.random().secret();

  beforeEach(() => {
    process.env.CERTIFICATE_SIGNING_SECRET = secret;
  });

  afterEach(() => {
    delete process.env.CERTIFICATE_SIGNING_SECRET;
  });

  it('signs content and exposes the matching public key', () => {
    const service = new CertificateSigningService();
    const content = { project_id: 'P1', vintage_year: 2023, tx_hash: 'TX1', beneficiary: 'B1' };

    const { signature, publicKey, contentHash } = service.sign(content);

    expect(publicKey).toBe(service.getPublicKey());
    expect(publicKey).toBe(StellarSdk.Keypair.fromSecret(secret).publicKey());
    expect(signature).toMatch(/^[0-9a-f]+$/);
    expect(contentHash).toHaveLength(64); // hex-encoded SHA-256
  });

  it('verifies a signature it produced', () => {
    const service = new CertificateSigningService();
    const content = { project_id: 'P1', vintage_year: 2023 };
    const { signature, publicKey } = service.sign(content);

    expect(CertificateSigningService.verify(content, signature, publicKey)).toBe(true);
  });

  it('rejects a signature when the content has been tampered with', () => {
    const service = new CertificateSigningService();
    const content = { project_id: 'P1', beneficiary: 'B1' };
    const { signature, publicKey } = service.sign(content);

    const tampered = { ...content, beneficiary: 'ATTACKER' };
    expect(CertificateSigningService.verify(tampered, signature, publicKey)).toBe(false);
  });

  it('rejects a signature verified against the wrong public key', () => {
    const service = new CertificateSigningService();
    const content = { project_id: 'P1' };
    const { signature } = service.sign(content);

    const otherPublicKey = StellarSdk.Keypair.random().publicKey();
    expect(CertificateSigningService.verify(content, signature, otherPublicKey)).toBe(false);
  });

  it('rejects a malformed public key or signature without throwing', () => {
    expect(CertificateSigningService.verify({ a: 1 }, 'not-hex', 'not-a-key')).toBe(false);
  });

  it('is not sensitive to key insertion order (canonicalization)', () => {
    const service = new CertificateSigningService();
    const a = { beneficiary: 'B1', project_id: 'P1', vintage_year: 2023 };
    const b = { vintage_year: 2023, project_id: 'P1', beneficiary: 'B1' };

    const { signature, publicKey } = service.sign(a);
    expect(CertificateSigningService.verify(b, signature, publicKey)).toBe(true);
  });

  it('falls back to an ephemeral key with a warning when no secret is configured', () => {
    delete process.env.CERTIFICATE_SIGNING_SECRET;
    const service = new CertificateSigningService();
    expect(service.getPublicKey()).toMatch(/^G[A-Z0-9]{55}$/);
  });
});

describe('canonicalize', () => {
  it('produces identical output regardless of key order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('canonicalizes nested objects and arrays', () => {
    const nested = { z: [{ y: 1, x: 2 }], a: 'val' };
    const same = { a: 'val', z: [{ x: 2, y: 1 }] };
    expect(canonicalize(nested)).toBe(canonicalize(same));
  });
});
