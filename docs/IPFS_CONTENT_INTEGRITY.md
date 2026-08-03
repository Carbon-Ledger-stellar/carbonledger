# IPFS Content Integrity Verification (#101)

## Overview

Implements content integrity verification for retirement certificates stored on IPFS. When retrieving certificates, the system verifies that the content hash matches the CID (Content Identifier) stored on-chain, preventing certificate tampering via IPFS content substitution.

## Implementation Details

### 1. Database Schema Updates

**File**: `backend/prisma/schema.prisma`

Added fields to `RetirementRecord` model:
- `certificateCid: String?` - Stores the IPFS CID hash for certificate content
- `isValid: Boolean` - Marks certificate as invalid if CID mismatch detected (default: true)
- `validatedAt: DateTime?` - Timestamp of last integrity verification

```prisma
model RetirementRecord {
  // ... existing fields ...
  certificateCid   String?  // IPFS CID for certificate content integrity verification
  isValid          Boolean  @default(true)  // Invalid if CID mismatch detected
  validatedAt      DateTime? // Last validation timestamp
}
```

### 2. Smart Contract Updates

**File**: `contracts/carbon_credit/src/lib.rs`

Updated `RetirementCertificate` struct to include certificate_cid:
```rust
pub struct RetirementCertificate {
    // ... existing fields ...
    pub certificate_cid: String,  // IPFS CID for content integrity verification
}
```

Updated `retire_credits` function signature to accept certificate_cid parameter:
```rust
pub fn retire_credits(
    env: Env,
    holder: Address,
    batch_id: String,
    amount: i128,
    retirement_reason: String,
    beneficiary: String,
    retirement_id: String,
    tx_hash: String,
    certificate_cid: String,  // NEW parameter
) -> Result<RetirementCertificate, CarbonError>
```

### 3. IPFS Service

**File**: `backend/src/common/ipfs.service.ts`

Created `IpfsService` with three main functions:

#### `calculateContentHash(content: Buffer | string): string`
- Computes SHA256 hash of certificate content
- Returns hex string suitable for CID storage

#### `verifyCidMatch(content: Buffer | string, storedCid: string): boolean`
- Verifies fetched certificate content against stored CID
- Compares content hash with stored CID hash
- Returns true if match, false if mismatch (tampering detected)

#### `generateCid(certificateJson: string): string`
- Generates IPFS CID from certificate JSON
- Creates consistent hash for on-chain storage

### 4. Retirements Service Updates

**File**: `backend/src/retirements/retirements.service.ts`

Added `verifyCertificateIntegrity` method:
- Takes retirement ID and fetched content
- Verifies against stored CID
- Marks certificate as invalid on mismatch
- Logs security alerts for tampering detection
- Updates validation timestamp on success

Error Handling:
- Throws if certificate has no CID stored
- Returns detailed error messages on verification failure
- Logs warnings on tampering detection

### 5. Credits Service Updates

**File**: `backend/src/credits/credits.service.ts`

Modified `retireCredits` method to:
1. Generate certificate data JSON from retirement details
2. Compute CID hash using IpfsService
3. Store CID in database record
4. Set `isValid: true` and `validatedAt` on creation

The CID is generated from structured certificate data to ensure consistency across on-chain and off-chain storage.

### 6. Retirements Controller Updates

**File**: `backend/src/retirements/retirements.controller.ts`

Added new endpoint:
```
POST /retirements/verify-integrity
{
  "retirementId": "ret-b1-1234567890",
  "content": "base64-encoded or raw certificate content"
}
```

Response on valid certificate:
```json
{
  "valid": true,
  "retirementId": "ret-b1-1234567890",
  "message": "Certificate content integrity verified",
  "storedCid": "sha256hash..."
}
```

Response on tampered certificate:
```json
{
  "valid": false,
  "retirementId": "ret-b1-1234567890",
  "message": "Certificate content integrity verification failed - tampering detected",
  "storedCid": "sha256hash..."
}
```

## Certificate Retrieval Flow

```
1. User requests certificate from IPFS using CID pointer
2. IPFS gateway returns certificate content
3. Client/Backend calls /retirements/verify-integrity endpoint with:
   - retirementId: stored in on-chain retirement record
   - fetched content from IPFS
4. Service verifies:
   - Certificate exists in database
   - CID is stored
   - Retrieved content hash matches stored CID
5. On Success:
   - Updates validatedAt timestamp
   - Returns verification success
   - Certificate marked valid
6. On Mismatch (Tampering Detected):
   - Sets isValid = false in database
   - Logs security alert
   - Returns verification failure
   - Certificate marked invalid for auditing
```

## Security Characteristics

### Tampering Prevention
- ✅ CID content hash stored on-chain (immutable on Stellar)
- ✅ Retrieved content verified against stored CID
- ✅ Mismatch immediately detected and logged
- ✅ Invalid certificates marked in database for auditing

### Implementation Details
- Uses SHA256 hashing (industry standard)
- CID stored in both database and on-chain contract
- Validation timestamp tracks verification history
- No external IPFS dependency required for verification (hash-based)

### Limitations & Future Improvements
- Current implementation uses SHA256 hash as CID
- Future: Support full IPFS CIDv1 format with multihashing
- Future: Automatic re-verification on periodic audits
- Future: Webhook alerts on tampering detection
- Future: Integration with Pinata for pinning status verification

## Testing

Updated all contract tests to include certificate_cid parameter:
- `test_retire_credits_permanent`
- `test_retired_credits_cannot_be_transferred`
- `test_retired_credits_cannot_be_retired_again`
- `test_partial_retirement_updates_status`
- `test_get_retirement_certificate`

## Database Migration Required

A migration is needed to add the new fields to existing retirement records:

```sql
ALTER TABLE "RetirementRecord"
ADD COLUMN "certificateCid" TEXT DEFAULT NULL,
ADD COLUMN "isValid" BOOLEAN DEFAULT true,
ADD COLUMN "validatedAt" TIMESTAMP DEFAULT NULL;
```

## Acceptance Criteria Status

- ✅ CID stored in DB and on-chain at retirement time
- ✅ On retrieval, hash of fetched content verified against stored CID
- ✅ Mismatch → certificate marked invalid, alert raised (logging)
- ✅ Documented in certificate retrieval flow (this document)

## Files Changed

- `backend/prisma/schema.prisma` - Updated RetirementRecord schema
- `backend/src/common/ipfs.service.ts` - Created IPFS verification service
- `backend/src/retirements/retirements.service.ts` - Added verification logic
- `backend/src/retirements/retirements.controller.ts` - Added verify-integrity endpoint
- `backend/src/retirements/retirements.module.ts` - Added IpfsService provider
- `backend/src/credits/credits.service.ts` - Added CID generation on retirement
- `backend/src/credits/credits.module.ts` - Added IpfsService provider
- `contracts/carbon_credit/src/lib.rs` - Updated RetirementCertificate struct and retire_credits function
