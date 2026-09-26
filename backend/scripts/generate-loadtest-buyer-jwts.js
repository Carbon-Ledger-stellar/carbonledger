#!/usr/bin/env node
/**
 * backend/scripts/generate-loadtest-buyer-jwts.js
 *
 * Provisions N distinct "corporation"-role buyer identities against the real
 * wallet-signature auth flow (GET /auth/challenge -> sign -> POST /auth/verify)
 * and writes their access tokens to load-tests/buyer-jwts.json for the
 * marketplace bulk-purchase k6 load test suite (issue #630).
 *
 * The backend's auth flow is Stellar-wallet-based (Freighter-style
 * challenge/response), not email+password, so JWTs cannot be minted with a
 * single fixed credential the way an admin-panel login could be. Each
 * simulated buyer needs its own keypair, a signed challenge, and its own
 * access token — this script does that against a running backend instance
 * exactly the way a real Freighter-connected client would, using the same
 * @stellar/stellar-sdk dependency the backend itself uses to verify.
 *
 * Usage (run from the backend/ directory so node_modules resolves):
 *   cd backend
 *   BASE_URL=http://localhost:3001 BUYER_COUNT=100 \
 *     node scripts/generate-loadtest-buyer-jwts.js
 *
 * Output:
 *   load-tests/buyer-jwts.json — [{ "publicKey": "G...", "jwt": "eyJ..." }, ...]
 */

const path = require("path");
const fs = require("fs");
const StellarSdk = require("@stellar/stellar-sdk");

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const API = `${BASE_URL}/api/v1`;
const BUYER_COUNT = parseInt(process.env.BUYER_COUNT || "100", 10);
const OUTPUT_PATH = path.join(__dirname, "..", "..", "load-tests", "buyer-jwts.json");

async function provisionBuyer() {
  const keypair = StellarSdk.Keypair.random();
  const publicKey = keypair.publicKey();

  const challengeRes = await fetch(
    `${API}/auth/challenge?publicKey=${encodeURIComponent(publicKey)}`,
  );
  if (!challengeRes.ok) {
    throw new Error(`challenge failed for ${publicKey}: HTTP ${challengeRes.status}`);
  }
  const { nonce } = await challengeRes.json();

  const message = `carbonledger:${nonce}`;
  const signature = keypair.sign(Buffer.from(message, "utf8")).toString("hex");

  const verifyRes = await fetch(`${API}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey, signature, nonce, role: "corporation" }),
  });
  if (!verifyRes.ok) {
    throw new Error(`verify failed for ${publicKey}: HTTP ${verifyRes.status}`);
  }
  const { access_token } = await verifyRes.json();
  if (!access_token) {
    throw new Error(`no access_token in verify response for ${publicKey}`);
  }

  return { publicKey, jwt: access_token };
}

async function main() {
  console.log(`[INFO] Provisioning ${BUYER_COUNT} corporate buyer identities at ${BASE_URL} ...`);

  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      `API not reachable at ${BASE_URL}/health — is the backend running?`,
    );
  }

  const buyers = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < BUYER_COUNT; i += CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(CONCURRENCY, BUYER_COUNT - i) },
      () => provisionBuyer(),
    );
    const results = await Promise.all(batch);
    buyers.push(...results);
    console.log(`[INFO] Provisioned ${buyers.length}/${BUYER_COUNT} buyers`);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(buyers, null, 2));
  console.log(`[OK] Wrote ${buyers.length} buyer identities to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
});
