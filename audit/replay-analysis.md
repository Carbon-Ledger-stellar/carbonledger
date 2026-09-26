# Retirement Replay Attack Analysis

**Feature:** #568  
**Date:** 2026-07-26  
**Author:** CarbonLedger Security Review  
**Status:** Patched

---

## 1. Overview

A "replay attack" in the context of carbon credit retirements means:

- Resubmitting a previously-completed retirement transaction to trigger a **second on-chain retirement** (double-counting), or
- Submitting a **fabricated / stolen `txHash`** to the off-chain API to fraudulently generate retirement certificates without a real on-chain transaction.

This document enumerates every retirement auth path, identifies gaps, and describes the patches applied in this branch.

---

## 2. Retirement Auth Paths and Replay Resistance

### 2.1 On-Chain Path (Soroban / Stellar)

**Contract:** `carbon_credit` (Rust / Soroban)

**Replay resistance:**

| Mechanism | Description | Strength |
|-----------|-------------|----------|
| Ledger sequence number | Every Stellar transaction includes a sequence number that increments per account. A replayed transaction with the same sequence will be rejected by the network with `txBAD_SEQ`. | **Strong** — enforced at protocol level |
| `AlreadyRetired = 5` error | The `carbon_credit` contract's `retire_credits()` function checks for an existing retirement record on-chain. If the credits are already marked retired, it returns error code 5. This is enforced inside the Soroban VM and cannot be bypassed. | **Strong** — enforced at VM level |
| Immutability | Soroban ledger state is append-only for retirements. The on-chain `RetirementCertificate` struct, once written, cannot be overwritten. | **Strong** |

**Conclusion:** The on-chain path is adequately protected against replay. An attacker cannot re-execute the same Soroban transaction twice, and attempting to retire already-retired credits via a new transaction will hit the `AlreadyRetired` guard.

---

### 2.2 Off-Chain API Path (NestJS Backend)

**Endpoint:** `POST /retirements`  
**Service:** `retirements.service.ts` → `retireCredits()`

#### 2.2.1 Existing Guard: `(batchId + retiredBy)` Uniqueness

```typescript
const existing = await this.prisma.retirementRecord.findFirst({
  where: { batchId: dto.batchId, retiredBy: dto.retiredBy },
});
if (existing) {
  throw new ConflictException('Credits already retired (AlreadyRetired)');
}
```

**Analysis:**

- This prevents the same wallet from retiring the same batch twice. ✅
- However, it does **not** prevent a **different wallet** (`retiredBy`) from submitting the same `txHash` with a different account address. ❌
- A colluding attacker who controls two wallet addresses could retire the same batch twice (once per wallet) if the batch uniqueness is not enforced separately.

#### 2.2.2 Gap 1: `txHash` Not Unique in Database

**Current schema:**

```prisma
model RetirementRecord {
  ...
  txHash  String   // ← no @unique, no @@index
  ...
}
```

**Risk:** An attacker can submit two `POST /retirements` requests:

1. Request A: `{ batchId: "B1", retiredBy: "WALLET_A", txHash: "REAL_TX" }` → succeeds, certificate issued
2. Request B: `{ batchId: "B1", retiredBy: "WALLET_B", txHash: "REAL_TX" }` → also succeeds if `WALLET_B` has not retired `B1` before

The `(batchId, retiredBy)` check passes for Request B because `WALLET_B` is new. The same real transaction hash is now linked to two retirement records. Even worse, an attacker could fabricate a `txHash` by copying any historical Stellar transaction hash and submit it as if it were their retirement transaction.

**Patch:** Add `@unique` to `txHash` in the Prisma schema and enforce uniqueness at the service layer.

#### 2.2.3 Gap 2: `txHash` Not Verified On-Chain Before Certificate Issuance

**Current flow:**

```
POST /retirements
  → DB check (batchId+retiredBy uniqueness only)
  → DB write (RetirementRecord created)
  → generateAndPinCertificate()   ← IPFS pin happens here
     → No on-chain verification at any point
```

**Risk:** An attacker can:

1. Fabricate any string as `txHash` (e.g., `"0x" + "a" * 64`)
2. Call `POST /retirements` with the fake hash
3. Receive a legitimate IPFS-pinned certificate claiming the retirement happened on Stellar
4. Present this certificate to regulators or ESG auditors as proof of retirement

There is **no** HTTP call to Horizon or Soroban RPC to verify that the submitted `txHash` actually exists and succeeded on the Stellar network before issuing the certificate.

**Patch:** Add an on-chain verification step in `certificate.service.ts` that calls the Stellar Horizon API to confirm the transaction exists and succeeded before pinning the certificate to IPFS.

---

### 2.3 Certificate Endpoint

**Endpoint:** `GET /certificates/:id` and `GET /retirements/:id/certificate`

**Auth:** `@Public()` — no authentication required

**Analysis:**

- These endpoints are intentionally public for auditability. This is a design choice, not a vulnerability.
- However, the combination of (a) no on-chain verification during retirement creation + (b) public certificate endpoint + (c) `max-age=31536000` immutable caching means that a fraudulently-issued certificate will be cached permanently in CDN/browser caches and publicly accessible forever.
- **This amplifies Gap 2**: once a fake certificate is issued, it propagates globally through HTTP caches before any tamper detection can revoke it.

**Partial mitigation (existing):** The `verifyCertificateIntegrity` endpoint (`POST /retirements/verify-integrity`) + `isValid` flag on `RetirementRecord` allows post-hoc revocation. But this is reactive, not preventive.

**Patch (preventive):** Block certificate issuance at source by verifying on-chain before the IPFS pin call.

---

### 2.4 Idempotency Middleware

**Model:** `IdempotencyRecord`  
**Scope:** API-level replay protection for all mutating endpoints

**Analysis:**

- The `IdempotencyRecord` middleware prevents the same `Idempotency-Key` header from triggering the same endpoint twice within 24 hours.
- This is effective against **accidental retries** (network timeouts causing duplicate submissions from the same client).
- It does **not** protect against a deliberate attacker who omits the `Idempotency-Key` header or uses a fresh key per request.
- The `Idempotency-Key` is optional, so an attacker simply omits it to bypass this guard.

**Conclusion:** Idempotency middleware is a convenience feature, not a security boundary. The txHash uniqueness check and on-chain verification are the correct defenses.

---

## 3. Attack Scenarios

### Scenario A: Replay via Different Wallet

1. Attacker controls `WALLET_A` and `WALLET_B`.
2. `WALLET_A` performs a real on-chain retirement → txHash = `TX_REAL`.
3. Attacker submits `POST /retirements` with `retiredBy: WALLET_B, txHash: TX_REAL`.
4. Without the txHash uniqueness check, a second retirement record is created with the same real transaction hash.
5. **Result:** Two retirement certificates exist for one on-chain retirement.

**Patched by:** txHash uniqueness check in `retireCredits()` + `@unique` index in schema.

### Scenario B: Fabricated Transaction Hash

1. Attacker fabricates a txHash string.
2. Submits `POST /retirements` with the fake hash.
3. Without on-chain verification, a RetirementRecord and IPFS certificate are created.
4. **Result:** A legitimate-looking certificate with an invalid txHash is publicly accessible.

**Patched by:** On-chain verification via Horizon API in `generateAndPinCertificate()`.

### Scenario C: Stolen Transaction Hash from Unrelated Transaction

1. Attacker finds any historical Stellar transaction hash.
2. Submits it as a retirement txHash.
3. Without on-chain verification, the certificate is issued.
4. **Result:** Certificate claims an unrelated transaction is a carbon credit retirement.

**Patched by:** On-chain verification checks that the transaction is specifically a `retire_credits` invocation on the `carbon_credit` contract.

---

## 4. Patches Applied

### Patch 1: txHash Uniqueness Check (Service Layer)

**File:** `backend/src/retirements/retirements.service.ts`

Added before the `(batchId, retiredBy)` check:

```typescript
const txHashExists = await this.prisma.retirementRecord.findFirst({
  where: { txHash: dto.txHash },
});
if (txHashExists) {
  throw new ConflictException('Transaction hash already used');
}
```

This ensures that even if two different wallets attempt to use the same `txHash`, only the first request succeeds.

### Patch 2: txHash Unique Index in Prisma Schema

**File:** `backend/prisma/schema.prisma`

Changed:

```prisma
txHash  String
```

To:

```prisma
txHash  String  @unique
```

This provides a database-level enforcement that backs up the service-layer check, preventing race conditions where two simultaneous requests both pass the `findFirst` check before either commits.

**Migration:** `backend/prisma/migrations/20260726000000_add_retirement_txhash_index/migration.sql`

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "RetirementRecord_txHash_key" ON "RetirementRecord"("txHash");
```

### Patch 3: On-Chain Verification Before Certificate Issuance

**File:** `backend/src/retirements/certificate.service.ts`

Added method `verifyOnChainRetirement(txHash: string): Promise<boolean>` that:

1. Calls `GET https://horizon-testnet.stellar.org/transactions/{txHash}` (or mainnet equivalent based on `STELLAR_NETWORK` env var)
2. Verifies the HTTP response is 200
3. Verifies `successful: true` in the response body

Added call in `generateAndPinCertificate()`:

```typescript
if (!skipVerification) {
  const isOnChain = await this.verifyOnChainRetirement(retirement.txHash);
  if (!isOnChain) {
    throw new BadRequestException(
      'Cannot issue certificate: retirement not confirmed on-chain'
    );
  }
}
```

**Config:** `SKIP_ONCHAIN_VERIFICATION=true` disables this check in test environments (defaults to `false`).

---

## 5. Residual Risks

| Risk | Severity | Status |
|------|----------|--------|
| Horizon API downtime blocks certificate issuance | Medium | Accepted — failure-safe is correct behavior. Consider retry with exponential backoff for production. |
| Attacker submits txHash from a real `retire_credits` call on a different contract | Low | Partially mitigated — contract ID is stored in the certificate. Full mitigation requires checking the contract invocation details in the Horizon response. |
| Race condition between txHash uniqueness check and DB insert | Low | Mitigated by `@unique` DB constraint. The constraint will reject the second insert even if both requests pass the `findFirst` check simultaneously. |
| `SKIP_ONCHAIN_VERIFICATION=true` in production misconfiguration | High | Operational risk. Should be monitored via config audit. Default is `false`. |

---

## 6. References

- [Stellar Horizon API: Transaction Details](https://developers.stellar.org/api/resources/transactions/single/)
- [Soroban Error Codes: AlreadyRetired = 5](../contracts/carbon_credit/src/lib.rs)
- [Idempotency Middleware](../backend/src/idempotency/idempotency.middleware.ts)
- [Prisma Schema: RetirementRecord](../backend/prisma/schema.prisma)
- [Carbon Credit Lifecycle](../docs/carbon-credit-lifecycle.md)
