#!/usr/bin/env node
/**
 * verify-certificate.js
 *
 * Standalone CLI to verify a CarbonLedger retirement certificate's Ed25519
 * issuer signature (#594). Trusts nothing but the certificate file itself
 * and the CERTIFICATE_SIGNING_KEY published in Stellar.toml — no network
 * call, no CarbonLedger backend involved.
 *
 * Usage:
 *   node backend/scripts/verify-certificate.js <certificate.json> [Stellar.toml path]
 *
 * Exit code: 0 if the signature is valid, 1 otherwise.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Keypair } = require('@stellar/stellar-sdk');

function canonicalize(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Minimal TOML value extractor — good enough for `KEY = "value"` lines. */
function readTomlStringField(tomlText, key) {
  const match = tomlText.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1] : null;
}

function loadPublishedKeys(stellarTomlPath) {
  const tomlText = fs.readFileSync(stellarTomlPath, 'utf8');
  return {
    current: readTomlStringField(tomlText, 'CERTIFICATE_SIGNING_KEY'),
    previous: readTomlStringField(tomlText, 'CERTIFICATE_SIGNING_KEY_PREVIOUS'),
  };
}

function verifyCertificate(certificate) {
  const { issuer_signature: signatureHex, issuer_public_key: publicKey, ...signedContent } = certificate;

  if (!signatureHex || !publicKey) {
    return { valid: false, reason: 'certificate is missing issuer_signature or issuer_public_key' };
  }

  const contentHash = crypto.createHash('sha256').update(canonicalize(signedContent)).digest();

  let valid;
  try {
    valid = Keypair.fromPublicKey(publicKey).verify(contentHash, Buffer.from(signatureHex, 'hex'));
  } catch (err) {
    return { valid: false, reason: `invalid public key or signature encoding: ${err.message}` };
  }

  return {
    valid,
    publicKey,
    contentHash: contentHash.toString('hex'),
    reason: valid ? undefined : 'signature does not match certificate content — content may have been tampered with',
  };
}

function main() {
  const [certificatePath, stellarTomlPathArg] = process.argv.slice(2);

  if (!certificatePath) {
    console.error('Usage: node verify-certificate.js <certificate.json> [Stellar.toml path]');
    process.exit(1);
  }

  const stellarTomlPath = stellarTomlPathArg || path.resolve(__dirname, '../../Stellar.toml');
  const certificate = JSON.parse(fs.readFileSync(certificatePath, 'utf8'));
  const result = verifyCertificate(certificate);

  if (!result.valid) {
    console.error(`INVALID: ${result.reason}`);
    process.exit(1);
  }

  let keyStatus = 'unknown (Stellar.toml not readable or key not published)';
  try {
    const published = loadPublishedKeys(stellarTomlPath);
    if (published.current && result.publicKey === published.current) {
      keyStatus = 'current';
    } else if (published.previous && result.publicKey === published.previous) {
      keyStatus = 'previous (rotated out — see CERTIFICATE_SIGNING.md)';
    } else if (published.current || published.previous) {
      keyStatus = 'NOT PUBLISHED — this key does not match Stellar.toml';
    }
  } catch (err) {
    keyStatus = `could not read ${stellarTomlPath}: ${err.message}`;
  }

  console.log('VALID');
  console.log(`  content hash:  ${result.contentHash}`);
  console.log(`  signed by:     ${result.publicKey}`);
  console.log(`  key status:    ${keyStatus}`);

  if (keyStatus.startsWith('NOT PUBLISHED')) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { verifyCertificate, canonicalize, readTomlStringField, loadPublishedKeys };
