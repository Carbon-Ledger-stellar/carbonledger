import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as StellarSdk from '@stellar/stellar-sdk';

// The CLI (backend/scripts/verify-certificate.js) is a standalone CommonJS
// script — it must work without any NestJS wiring, so it's required
// directly rather than imported as a Nest provider.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyCertificate, canonicalize, readTomlStringField } = require('../../scripts/verify-certificate.js');

const scriptPath = path.join(__dirname, '../../scripts/verify-certificate.js');

describe('verify-certificate CLI', () => {
  const keypair = StellarSdk.Keypair.random();

  function signCertificate(content: Record<string, unknown>) {
    const hash = crypto.createHash('sha256').update(canonicalize(content)).digest();
    const signature = keypair.sign(hash);
    return { ...content, issuer_signature: signature.toString('hex'), issuer_public_key: keypair.publicKey() };
  }

  describe('verifyCertificate', () => {
    it('validates a correctly signed certificate', () => {
      const cert = signCertificate({ project_id: 'P1', vintage_year: 2023, beneficiary: 'B1' });
      const result = verifyCertificate(cert);
      expect(result.valid).toBe(true);
      expect(result.publicKey).toBe(keypair.publicKey());
    });

    it('rejects a certificate whose content was tampered with after signing', () => {
      const cert = signCertificate({ project_id: 'P1', beneficiary: 'B1' });
      const tampered = { ...cert, beneficiary: 'ATTACKER' };
      const result = verifyCertificate(tampered);
      expect(result.valid).toBe(false);
    });

    it('rejects a certificate missing the signature fields', () => {
      const result = verifyCertificate({ project_id: 'P1' });
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/missing issuer_signature/);
    });

    it('rejects a malformed public key gracefully (no throw)', () => {
      const cert = signCertificate({ project_id: 'P1' });
      const result = verifyCertificate({ ...cert, issuer_public_key: 'not-a-real-key' });
      expect(result.valid).toBe(false);
    });
  });

  describe('readTomlStringField', () => {
    it('extracts a simple quoted TOML field', () => {
      const toml = 'VERSION = "2.0.0"\nCERTIFICATE_SIGNING_KEY = "GABC123"\n';
      expect(readTomlStringField(toml, 'CERTIFICATE_SIGNING_KEY')).toBe('GABC123');
    });

    it('returns null when the field is absent', () => {
      const toml = 'VERSION = "2.0.0"\n';
      expect(readTomlStringField(toml, 'CERTIFICATE_SIGNING_KEY')).toBeNull();
    });
  });

  describe('end-to-end CLI process', () => {
    it('exits 0 for a valid certificate matching the published key', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-verify-'));
      const cert = signCertificate({ project_id: 'P1', vintage_year: 2023 });
      const certPath = path.join(dir, 'cert.json');
      const tomlPath = path.join(dir, 'Stellar.toml');
      fs.writeFileSync(certPath, JSON.stringify(cert));
      fs.writeFileSync(tomlPath, `CERTIFICATE_SIGNING_KEY = "${keypair.publicKey()}"\n`);

      expect(() => execFileSync('node', [scriptPath, certPath, tomlPath], { stdio: 'pipe' })).not.toThrow();
    });

    it('exits non-zero for a tampered certificate', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-verify-'));
      const cert = signCertificate({ project_id: 'P1' });
      const tampered = { ...cert, project_id: 'ATTACKER_PROJECT' };
      const certPath = path.join(dir, 'cert.json');
      const tomlPath = path.join(dir, 'Stellar.toml');
      fs.writeFileSync(certPath, JSON.stringify(tampered));
      fs.writeFileSync(tomlPath, `CERTIFICATE_SIGNING_KEY = "${keypair.publicKey()}"\n`);

      expect(() => execFileSync('node', [scriptPath, certPath, tomlPath], { stdio: 'pipe' })).toThrow();
    });

    it('exits non-zero when the signing key does not match the published Stellar.toml key', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-verify-'));
      const cert = signCertificate({ project_id: 'P1' });
      const certPath = path.join(dir, 'cert.json');
      const tomlPath = path.join(dir, 'Stellar.toml');
      fs.writeFileSync(certPath, JSON.stringify(cert));
      fs.writeFileSync(
        tomlPath,
        `CERTIFICATE_SIGNING_KEY = "${StellarSdk.Keypair.random().publicKey()}"\n`,
      );

      expect(() => execFileSync('node', [scriptPath, certPath, tomlPath], { stdio: 'pipe' })).toThrow();
    });
  });
});
