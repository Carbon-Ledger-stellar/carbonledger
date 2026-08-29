#!/usr/bin/env node
/**
 * Encode strings / numbers into BLS12-381 Fr elements for circuit witnesses.
 * Uses SHA-256 truncated to 31 bytes (big-endian) to stay inside the field.
 */
const crypto = require("crypto");

/** BLS12-381 scalar field modulus */
const FR =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

function bytesToFr(buf) {
  const truncated = Buffer.from(buf).subarray(0, 31);
  let x = 0n;
  for (const b of truncated) {
    x = (x << 8n) + BigInt(b);
  }
  return (x % FR).toString();
}

function stringToFr(s) {
  return bytesToFr(crypto.createHash("sha256").update(String(s), "utf8").digest());
}

function amountToFr(amount) {
  // Support decimal tonnes as fixed 1e2 (matches Prisma Decimal(18,2))
  const n = Math.round(Number(amount) * 100);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`amount must be > 0, got ${amount}`);
  }
  return BigInt(n).toString();
}

function serialToFr(serial) {
  // Prefer numeric parse; fall back to hash for alphanumeric serials
  const digits = String(serial).replace(/\D/g, "");
  if (digits.length > 0 && digits.length <= 18) {
    return BigInt(digits).toString();
  }
  return stringToFr(serial);
}

function randomSaltFr() {
  return bytesToFr(crypto.randomBytes(32));
}

function buildWitnessInput(record, salt) {
  const s = salt || randomSaltFr();
  return {
    beneficiary: stringToFr(record.beneficiary),
    salt: s,
    retirementId: stringToFr(record.retirementId),
    amount: amountToFr(record.amount),
    projectId: stringToFr(record.projectId),
    serialStart: serialToFr(record.serialStart),
    serialEnd: serialToFr(record.serialEnd),
    retiredBy: stringToFr(record.retiredBy),
  };
}

module.exports = {
  FR,
  stringToFr,
  amountToFr,
  serialToFr,
  randomSaltFr,
  buildWitnessInput,
};

if (require.main === module) {
  const fs = require("fs");
  const recPath = process.argv[2];
  if (!recPath) {
    console.error("Usage: field-encode.js <retirement.json> [salt]");
    process.exit(1);
  }
  const record = JSON.parse(fs.readFileSync(recPath, "utf8"));
  const salt = process.argv[3];
  process.stdout.write(JSON.stringify(buildWitnessInput(record, salt), null, 2) + "\n");
}
