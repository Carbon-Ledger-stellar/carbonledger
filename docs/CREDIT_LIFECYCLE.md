# Carbon Credit Lifecycle

Complete guide to the lifecycle of carbon credits in CarbonLedger: from project registration through verification, minting, and retirement.

## Table of Contents
- [Lifecycle Overview](#lifecycle-overview)
- [Lifecycle Diagram](#lifecycle-diagram)
- [State Transitions](#state-transitions)
- [Error Scenarios](#error-scenarios)
- [API Examples](#api-examples)
- [Integration Guide](#integration-guide)

---

## Lifecycle Overview

Each carbon credit in CarbonLedger follows a standardized lifecycle:

```
┌─────────────┐
│  Register   │  Project submits emissions reduction activity
│  Project    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Verify     │  Third-party verifies actual reductions achieved
│  Credits    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Mint       │  Credits recorded on blockchain
│  Credits    │
└──────┬──────┘
       │
       ├─────────────────┐
       │                 │
       ▼                 ▼
┌─────────────┐   ┌──────────────┐
│   Active    │   │   Transfer   │  Can be traded/sold
│  (Hold/     │   │   to Other   │
│   Own)      │   │   Accounts   │
└──────┬──────┘   └──────┬───────┘
       │                 │
       └────────┬────────┘
                │
                ▼
         ┌──────────────┐
         │   Retire     │  Credit burned, permanent removal
         │   Credit     │
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐
         │   Retired    │  Immutable record
         │   (Locked)   │
         └──────────────┘
```

---

## Lifecycle Diagram

### State Machine Definition

```
States:
  - PENDING_VERIFICATION    (1)
  - VERIFIED                (2)
  - MINTED                  (3)
  - ACTIVE                  (4)
  - TRANSFERRED             (5)
  - RETIRED                 (6)
  - INVALID                 (7)

Transitions:
  PENDING_VERIFICATION → VERIFIED (on verification approval)
  PENDING_VERIFICATION → INVALID (on verification rejection)
  VERIFIED → MINTED (on blockchain confirmation)
  MINTED → ACTIVE (on initial credit allocation)
  ACTIVE → TRANSFERRED (on credit transfer to another account)
  ACTIVE → RETIRED (on credit retirement request)
  TRANSFERRED → RETIRED (on credit retirement request)
  TRANSFERRED → ACTIVE (optional, on re-receipt)
  Any state → INVALID (on fraud detection or override)
```

### Visual State Diagram

```
                    ┌─────────────────────────────┐
                    │   PENDING_VERIFICATION      │
                    │   (Awaiting 3rd party)      │
                    └────┬────────────────┬────────┘
                         │                │
                    (approved)        (rejected)
                         │                │
                         ▼                ▼
                    ┌──────────┐    ┌──────────┐
                    │ VERIFIED │    │ INVALID  │
                    └────┬─────┘    │ (Blocked)│
                         │          └──────────┘
                    (mint on chain)
                         │
                         ▼
                    ┌──────────────────────────┐
                    │   MINTED (On Blockchain) │
                    │   Tx confirmed           │
                    └────┬───────────┬──────────┘
                         │           │
                    (allocation) (failed allocation)
                         │           │
                         ▼           ▼
                    ┌──────────┐ ┌────────────┐
                    │  ACTIVE  │ │  INVALID   │
                    │(Usable)  │ │  (Blocked) │
                    └────┬─────┘ └────────────┘
                         │
        ┌────────┬────────┴───────┬────────┐
        │        │                │        │
    (retire) (transfer)    (hold) (partial retire)
        │        │                │        │
        ▼        ▼                ▼        ▼
    ┌─────┐ ┌──────────┐      ┌──────┐ ┌─────┐
    │RETIRED│ │TRANSFERRED│      │ACTIVE│ │RETIRED
    │(Burned)│ │(New Owner)│      │(Hold)│ │(Partial)
    └─────┘ └──────────┘      └──────┘ └─────┘
```

---

## State Transitions

### 1. PENDING_VERIFICATION → VERIFIED

**Trigger**: Third-party verifier approves credits

**Prerequisites**:
- Project registration complete
- Emissions reduction documentation submitted
- Verification period elapsed (30 days minimum)
- Verifier identity confirmed

**Data Updated**:
```json
{
  "creditId": "CREDIT-2026-001",
  "state": "VERIFIED",
  "verificationDate": "2026-08-29T14:23:00Z",
  "verifierId": "VERIFIER-123",
  "verificationHash": "0x1234...",
  "quantity": 1000,
  "unit": "tCO2e"
}
```

**Blockchain Action**: None (not yet on-chain)

**Notification**:
```
To: Project owner
Subject: Credits Verified - Ready for Minting
Body: Your 1000 tCO2e credits have been verified and are ready to mint on blockchain.
```

---

### 2. VERIFIED → MINTED

**Trigger**: Project owner requests blockchain minting

**Prerequisites**:
- Credit state is VERIFIED
- Smart contract is accessible
- Owner has sufficient gas fees

**Smart Contract Call**:
```solidity
function mint(
  bytes32 creditId,
  uint256 quantity,
  string memory projectURI,
  bytes memory verificationProof
) public returns (uint256 tokenId)
```

**Data Updated**:
```json
{
  "creditId": "CREDIT-2026-001",
  "state": "MINTED",
  "tokenId": "0xabcd...",
  "blockchainTxHash": "0x7890...",
  "mintedDate": "2026-08-29T15:45:00Z",
  "contractAddress": "0xCarbonCredit...",
  "quantity": 1000
}
```

**Blockchain State**:
- Token created on CarbonCredit contract
- Owner: Project wallet address
- Metadata: IPFS link to project & verification data
- Event emitted: `CreditMinted(creditId, quantity, owner)`

**Timeline**:
- T+0: Mint transaction submitted
- T+30-60s: Transaction confirmed (1-2 blocks)
- T+3-5min: Backend records confirmation

---

### 3. MINTED → ACTIVE

**Trigger**: Blockchain confirmation + backend allocation

**Prerequisites**:
- Mint transaction confirmed on chain
- Credit balance verified
- No holds/disputes

**Data Updated**:
```json
{
  "creditId": "CREDIT-2026-001",
  "state": "ACTIVE",
  "allocationDate": "2026-08-29T15:47:00Z",
  "owner": "0xProjectWallet...",
  "available": 1000,
  "locked": 0,
  "retired": 0,
  "lastModified": "2026-08-29T15:47:00Z"
}
```

**Account Ledger Entry**:
```
Account: ProjectWallet
Entry Type: CREDIT_ALLOCATION
Amount: +1000 tCO2e
State: ACTIVE
Date: 2026-08-29
Memo: Minting of CREDIT-2026-001
```

**Notification**:
```
To: Project owner
Subject: Credits Minted Successfully
Body: 1000 tCO2e credits are now active and available for transfer or retirement.
```

---

### 4. ACTIVE → TRANSFERRED

**Trigger**: Credit transfer to another account

**Prerequisites**:
- Source state is ACTIVE
- Destination account exists and is verified
- Sufficient available balance
- No transfer restrictions active

**API Call**:
```
POST /api/v1/credits/transfer
{
  "creditId": "CREDIT-2026-001",
  "quantity": 500,
  "fromAddress": "0xProjectWallet...",
  "toAddress": "0xBuyerWallet...",
  "price": "25.00",
  "currency": "USD"
}
```

**Source Account Updated**:
```json
{
  "available": 500,  // 1000 - 500
  "transferred": 500,
  "lastModified": "2026-08-29T16:30:00Z"
}
```

**Destination Account Updated**:
```json
{
  "available": 500,  // 0 + 500
  "lastModified": "2026-08-29T16:30:00Z"
}
```

**Blockchain Transaction**:
```solidity
function safeTransferFrom(
  address from,
  address to,
  uint256 id,
  uint256 amount,
  bytes data
)
```

**Ledger Entries Created**:
```
FROM Account:
  Entry Type: CREDIT_TRANSFER_OUT
  Amount: -500 tCO2e
  Counterparty: 0xBuyerWallet...
  Price: $25.00/tCO2e
  Date: 2026-08-29
  
TO Account:
  Entry Type: CREDIT_TRANSFER_IN
  Amount: +500 tCO2e
  Counterparty: 0xProjectWallet...
  Price: $25.00/tCO2e
  Date: 2026-08-29
```

---

### 5. ACTIVE/TRANSFERRED → RETIRED

**Trigger**: Credit retirement request (permanent removal)

**Prerequisites**:
- Credit state is ACTIVE or TRANSFERRED
- Sufficient available balance
- Valid retirement reason provided
- 72-hour time lock (optional governance)

**API Call**:
```
POST /api/v1/credits/retire
{
  "creditId": "CREDIT-2026-001",
  "quantity": 500,
  "owner": "0xBuyerWallet...",
  "reason": "Corporate sustainability commitment 2026",
  "beneficiary": "Acme Corp",
  "certificate": true
}
```

**Retirement Request State**:
```json
{
  "retirementId": "RET-2026-001",
  "creditId": "CREDIT-2026-001",
  "status": "PENDING",
  "quantity": 500,
  "requester": "0xBuyerWallet...",
  "requestDate": "2026-08-29T17:00:00Z",
  "timelock": "2026-09-01T17:00:00Z",  // 72 hours
  "reason": "Corporate sustainability commitment 2026",
  "beneficiary": "Acme Corp"
}
```

**After Time Lock (72 hours later)**:

**Smart Contract Call**:
```solidity
function retire(
  bytes32 creditId,
  uint256 quantity,
  address beneficiary,
  string memory reason,
  bytes memory certificate
) public returns (bytes32 retirementId)
```

**Final State Updated**:
```json
{
  "creditId": "CREDIT-2026-001",
  "state": "RETIRED",
  "retiredQuantity": 500,
  "retirementDate": "2026-09-01T17:30:00Z",
  "retirementHash": "0xabcd...",
  "beneficiary": "Acme Corp",
  "certificate": "CERT-2026-001",
  "available": 0,  // Burned
  "locked": 0,
  "retired": 500
}
```

**Blockchain State**:
- Token burned (quantity removed from supply)
- Retirement certificate generated
- Event emitted: `CreditRetired(creditId, quantity, beneficiary, reason)`

**Account Ledger Entry**:
```
Account: BuyerWallet
Entry Type: CREDIT_RETIREMENT
Amount: -500 tCO2e
Beneficiary: Acme Corp
Reason: Corporate sustainability commitment 2026
Certificate: CERT-2026-001
Date: 2026-09-01
Immutable: Yes (Blockchain record)
```

**Retirement Certificate Generated**:
```json
{
  "certificateId": "CERT-2026-001",
  "creditId": "CREDIT-2026-001",
  "quantity": 500,
  "unit": "tCO2e",
  "beneficiary": "Acme Corp",
  "retirementDate": "2026-09-01",
  "projectName": "Renewable Energy Project A",
  "projectLocation": "Kenya",
  "projectStandard": "Gold Standard",
  "verificationId": "VERIFIER-123",
  "blockchainProof": "0xabcd...",
  "issuerSignature": "0x...",
  "publicURL": "https://carbonledger.io/certificates/CERT-2026-001"
}
```

---

## Error Scenarios

### Scenario 1: Verification Rejected

**Condition**: Verifier rejects credits

**State Change**:
```json
{
  "creditId": "CREDIT-2026-001",
  "state": "INVALID",
  "previousState": "PENDING_VERIFICATION",
  "rejectionDate": "2026-08-29T18:00:00Z",
  "rejectionReason": "Documentation incomplete - missing emissions calculation methodology",
  "rejectionMessage": "Please resubmit with complete ISO 14064-2 methodology documentation."
}
```

**Recovery Path**:
1. Project owner reviews rejection reason
2. Corrects documentation or resubmits with additional evidence
3. Creates new verification request
4. Enters PENDING_VERIFICATION state again (retry)

**Notification**:
```
To: Project owner
Subject: ⚠️ Credit Verification Rejected
Body: Your credit verification for CREDIT-2026-001 has been rejected.

Reason: Documentation incomplete - missing emissions calculation methodology

Please resubmit with complete ISO 14064-2 methodology documentation.
Link to resubmit: https://carbonledger.io/projects/PROJECT-001/resubmit

Support: support@carbonledger.io
```

---

### Scenario 2: Blockchain Mint Failure

**Condition**: Smart contract call fails (e.g., contract paused, gas limit, state error)

**Error Details**:
```json
{
  "creditId": "CREDIT-2026-001",
  "state": "VERIFIED",
  "mintAttempt": {
    "attemptNumber": 1,
    "timestamp": "2026-08-29T16:00:00Z",
    "txHash": "0x123...",
    "error": "Contract is paused",
    "errorCode": "PAUSED_CONTRACT",
    "gasUsed": "0",
    "gasPrice": "45 gwei"
  }
}
```

**Retry Logic**:
```
Attempt 1: T+0min   → Failed (contract paused)
Attempt 2: T+5min   → Retry with same parameters
Attempt 3: T+30min  → Notify operator
Attempt 4: T+1h     → Escalate to engineering
Attempt 5: T+4h     → Manual review required
```

**Recovery Steps**:
1. Check contract status
   ```bash
   web3 contract call 0xCarbonCredit "paused()" --network mainnet
   ```
2. If paused, request unpause from governance/admin
3. Retry mint transaction with same parameters
4. If persistent failure, investigate contract state

**Notification to Owner**:
```
To: Project owner
Subject: ⚠️ Minting Delay - Action Required
Body: Your credit mint request has encountered a temporary issue:

Credit: CREDIT-2026-001
Reason: Contract is paused (scheduled maintenance)
Status: Retrying automatically

Expected resolution: Within 4 hours
Next manual check: 2026-08-29 20:00 UTC

We will update you once minting completes.
```

---

### Scenario 3: Transfer Fails (Insufficient Balance)

**Condition**: User attempts to transfer more credits than available

**Transfer Request**:
```json
{
  "creditId": "CREDIT-2026-001",
  "requestedQuantity": 1500,
  "availableBalance": 1000,
  "error": "INSUFFICIENT_BALANCE"
}
```

**Error Response**:
```json
{
  "error": {
    "code": "TRANSFER_FAILED",
    "message": "Insufficient balance",
    "details": {
      "available": 1000,
      "requested": 1500,
      "deficit": 500
    }
  }
}
```

**User Action Required**:
- Reduce transfer quantity to ≤1000 tCO2e, or
- Wait for additional credits to be allocated/received

---

### Scenario 4: Retirement During Dispute

**Condition**: Credit has active dispute/hold, retirement requested

**State**:
```json
{
  "creditId": "CREDIT-2026-001",
  "state": "ACTIVE",
  "holds": [
    {
      "holdId": "HOLD-2026-001",
      "type": "FRAUD_INVESTIGATION",
      "amount": 500,
      "reason": "Potential duplicate verification",
      "expiresAt": "2026-09-15T00:00:00Z"
    }
  ],
  "available": 500,  // Total 1000 - 500 held
  "locked": 500
}
```

**Retirement Attempt**:
- ❌ Cannot retire credits that are held/locked
- ✅ Can retire available amount only

**Error Response**:
```json
{
  "error": {
    "code": "RETIREMENT_BLOCKED",
    "message": "Cannot retire locked credits",
    "details": {
      "available": 500,
      "locked": 500,
      "holds": [
        {
          "holdId": "HOLD-2026-001",
          "type": "FRAUD_INVESTIGATION",
          "reason": "Potential duplicate verification",
          "expiresAt": "2026-09-15T00:00:00Z"
        }
      ]
    }
  }
}
```

**Resolution**:
1. Wait for hold to expire (auto-release), or
2. Appeal hold with supporting documentation, or
3. Retire only available amount (500 tCO2e)

---

### Scenario 5: State Corruption / Oracle Mismatch

**Condition**: Backend state disagrees with blockchain state

**Detection**:
```
Backend State: ACTIVE, balance = 1000
Blockchain State: balance = 500 (someone transferred out)
Status: DESYNCHRONIZED
```

**Audit Log Entry**:
```json
{
  "eventId": "AUDIT-2026-001",
  "timestamp": "2026-08-29T19:00:00Z",
  "type": "STATE_MISMATCH",
  "creditId": "CREDIT-2026-001",
  "backendState": {
    "available": 1000,
    "locked": 0,
    "retired": 0
  },
  "blockchainState": {
    "balance": 500,
    "circulatingSupply": 500,
    "burnedSupply": 0
  },
  "discrepancy": {
    "type": "BALANCE_MISMATCH",
    "backend": 1000,
    "blockchain": 500,
    "delta": -500
  },
  "severity": "HIGH",
  "action": "MANUAL_INVESTIGATION_REQUIRED"
}
```

**Recovery Process**:
1. **Pause all operations** on affected credits
2. **Investigate root cause**:
   - Check blockchain transaction history
   - Review backend transaction log
   - Look for unauthorized transfers
3. **Reconcile states**:
   ```bash
   # Fetch on-chain balance as source of truth
   balance_from_chain=$(web3 contract call 0xToken "balanceOf(address)" \
     --address owner --network mainnet)
   
   # Update backend to match chain
   UPDATE credits SET available = $balance_from_chain WHERE creditId = ...
   ```
4. **Notify affected parties**
5. **Post-incident review** to prevent recurrence

---

## API Examples

### Example 1: Register Project (Creates Initial Credit)

```bash
POST /api/v1/projects/register
Content-Type: application/json

{
  "projectName": "Renewable Energy Project A",
  "projectType": "Solar Farm",
  "location": "Kenya",
  "startDate": "2026-01-01",
  "endDate": "2026-12-31",
  "emissionsReduction": 5000,
  "unit": "tCO2e",
  "methodology": "CDM AM0045 v19",
  "documentationUrl": "ipfs://QmXxxx...",
  "ownerAddress": "0xProjectWallet..."
}

Response:
{
  "creditId": "CREDIT-2026-001",
  "state": "PENDING_VERIFICATION",
  "quantity": 5000,
  "unit": "tCO2e",
  "createdDate": "2026-08-29T10:00:00Z",
  "verificationDeadline": "2026-09-28T23:59:59Z"
}
```

### Example 2: Verify Credits (Verifier Action)

```bash
POST /api/v1/verify/approve
Content-Type: application/json

Authorization: Bearer verifier_token

{
  "creditId": "CREDIT-2026-001",
  "decision": "APPROVED",
  "verificationReport": "ipfs://QmYyyy...",
  "verifierNotes": "Documentation complete, methodology valid, data verified"
}

Response:
{
  "creditId": "CREDIT-2026-001",
  "state": "VERIFIED",
  "verifiedQuantity": 5000,
  "verificationDate": "2026-08-29T12:00:00Z",
  "nextStep": "Ready for minting"
}
```

### Example 3: Mint Credits (Project Owner Action)

```bash
POST /api/v1/credits/mint
Content-Type: application/json

Authorization: Bearer project_owner_token

{
  "creditId": "CREDIT-2026-001",
  "quantity": 5000,
  "metadataUri": "ipfs://QmZzzz..."
}

Response:
{
  "creditId": "CREDIT-2026-001",
  "state": "MINTED",
  "tokenId": "0xabcd1234...",
  "txHash": "0x7890abcd...",
  "confirmation": "pending",
  "blockNumber": null,
  "estimatedConfirmation": "2026-08-29T12:10:00Z"
}
```

### Example 4: Transfer Credits (Marketplace Transaction)

```bash
POST /api/v1/credits/transfer
Content-Type: application/json

Authorization: Bearer seller_token

{
  "creditId": "CREDIT-2026-001",
  "quantity": 2500,
  "buyerAddress": "0xBuyerWallet...",
  "price": "25.00",
  "currency": "USD",
  "escrow": true
}

Response:
{
  "transferId": "TRANSFER-2026-001",
  "creditId": "CREDIT-2026-001",
  "quantity": 2500,
  "seller": "0xProjectWallet...",
  "buyer": "0xBuyerWallet...",
  "price": "25.00",
  "currency": "USD",
  "status": "PENDING_CONFIRMATION",
  "txHash": "0x9012cdef...",
  "estimatedCompletion": "2026-08-29T12:15:00Z"
}
```

### Example 5: Retire Credits (Final Burn)

```bash
POST /api/v1/credits/retire
Content-Type: application/json

Authorization: Bearer owner_token

{
  "creditId": "CREDIT-2026-001",
  "quantity": 2500,
  "beneficiary": "Acme Corp",
  "reason": "Corporate carbon neutrality commitment 2026",
  "certificateEmail": "sustainability@acme.com"
}

Response:
{
  "retirementId": "RET-2026-001",
  "creditId": "CREDIT-2026-001",
  "quantity": 2500,
  "status": "PENDING_TIMELOCK",
  "timelock": "2026-09-01T12:30:00Z",
  "estimatedCompletionDate": "2026-09-01T12:35:00Z",
  "certificateId": "CERT-2026-001",
  "certificateUrl": "https://carbonledger.io/certificates/CERT-2026-001"
}
```

---

## Integration Guide

### For Project Owners
1. Register project with emissions data
2. Wait for verification (30+ days)
3. Upon approval, mint credits to blockchain
4. Credits become active and tradeable
5. Retire or sell credits based on strategy

### For Buyers/Traders
1. Browse marketplace for available credits
2. Purchase credits (1000+ tCO2e minimum)
3. Receive credits in wallet
4. Can hold, transfer, or retire

### For Verifiers
1. Review submitted documentation
2. Approve or reject with feedback
3. Submit verification report
4. Credits become eligible for minting

### For Compliance Officers
1. Monitor credit state for anomalies
2. Investigate disputes/holds
3. Review retirement certificates
4. Maintain audit trail

---

**Document Version**: 1.0  
**Last Updated**: 2026-08-29  
**Next Review**: 2026-09-29
