# ADR-012: Stellar Integration Patterns and Key Management

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-08-28 |
| Deciders | Stellar Integration Team, Security |

## Context

CarbonLedger integrates with Stellar for:
1. User authentication via Freighter wallet (SEP-0030 challenge/response)
2. Contract deployment and function invocation
3. Transaction indexing via RPC
4. USDC settlement for marketplace transactions
5. XLM payments for fees

Without clear patterns for key management, RPC fallback, and rate limiting, we risk:
- Accidental key exposure in logs/environments
- Single-RPC-endpoint failure causing outages
- Unauthenticated RPC abuse from competitors

## Decision

Establish the following patterns:

### 1. Key Management

**Server Private Keys (for contract operations):**
- Stored as encrypted secrets in AWS Secrets Manager
- Rotatable without code deploy (fetched at runtime)
- Used only for contract calls that must be authorized by the backend (e.g., settling marketplace transactions)
- Separate key per environment (testnet, staging, mainnet)

**Client Private Keys (for users):**
- Never stored on backend; only public key and optional user email are stored
- User signs transactions locally in Freighter wallet
- Challenge/response flow ensures user possession of private key without transmitting it

**Stellar.toml Configuration:**
```
# All public keys referenced by contracts, indexed, etc.
SIGNING_KEY = "GCDA...XXXX"  # Backend signer (contract operations)
CERTIFICATE_SIGNING_KEY = "GHHH...YYYY"  # Retirement certificate signer
```

**Rationale:**
- Private keys are never transmitted; only signatures prove possession
- Secrets Manager allows automatic key rotation
- Stellar.toml is public and immutable; changes are audited

### 2. RPC Fallback and Failover

**Primary RPC endpoint:** `https://soroban-rpc.stellar.org`  
**Fallback endpoint:** `https://soroban-rpc-testnet.stellar.org` (if needed; may deploy local RPC on high load)

**Implementation:**
```typescript
const primaryRpc = new SorobanRpc.Server(PRIMARY_RPC_URL);
const fallbackRpc = new SorobanRpc.Server(FALLBACK_RPC_URL);

async function getEvents(options): Promise<Events> {
  try {
    return await primaryRpc.getEvents(options);
  } catch (e) {
    if (e.code === 'ECONNREFUSED' || e.statusCode >= 500) {
      console.log('Primary RPC failed, trying fallback');
      return await fallbackRpc.getEvents(options);
    }
    throw e;
  }
}
```

**Rationale:**
- Stellar.org RPC is reliable but not SLA-guaranteed for production; fallback is prudent
- Fallback is attempted only on network/server errors, not client errors (4xx)
- Metrics logged for every failover to detect pattern changes

### 3. Rate Limiting and Caching

**RPC Rate Limits:**
- Stellar.org public RPC: ~1000 requests/minute/IP (undocumented but conservative estimate)
- Backend queues all contract calls through Bull MQ to smooth bursty load
- Transaction submissions are retried with exponential backoff

**Event Indexing Cache:**
```typescript
// Cache last-indexed ledger in SyncMetadata table
// Prevents re-indexing same events if process restarts
const lastIndexedLedger = await prisma.syncMetadata.findUnique({
  where: { id: "singleton" }
});

// Request only new events
const events = await sorobanRpc.getEvents({
  startLedger: lastIndexedLedger + 1,
  filters: [...]
});

// Update checkpoint after successful ingestion
await prisma.syncMetadata.update({
  where: { id: "singleton" },
  data: { lastIndexedLedger: latestLedger }
});
```

**Rationale:**
- Checkpoint prevents re-processing the same events (idempotency)
- Caching reduces RPC load by 90%+ on restart scenarios
- Bull MQ smooths spiky contract submission load

### 4. SEP-0030 Challenge/Response Flow

**Step 1: Challenge Request**
```
GET /api/v1/auth/challenge?publicKey=GXXX...
200 OK
{
  "nonce": "carbonledger:abc123-def456",
  "expiresAt": "2026-06-01T12:34:56Z"
}
```

**Step 2: Sign Challenge**
```
User signs with Freighter:
{
  "publicKey": "GXXX...",
  "nonce": "carbonledger:abc123-def456"
}
→ Produces signature (Ed25519)
```

**Step 3: Verify Signature**
```
POST /api/v1/auth/verify
{
  "publicKey": "GXXX...",
  "signature": "MEU...",
  "nonce": "carbonledger:abc123-def456"
}

Backend verification:
1. Hash nonce + publicKey
2. Verify signature over hash
3. Check nonce hasn't been used before (replay protection)
4. Check nonce hasn't expired
5. Issue JWT with sub = publicKey
```

**Rationale:**
- User never transmits private key; only signature proves possession
- Nonce prevents replay (same signed message can't be used twice)
- Expiry (5 min) limits window for MitM attacks
- JWT token allows stateless auth for subsequent API calls

## Consequences

### Positive

- **Zero private key exposure** — users control keys locally; backend never sees them
- **Scalable RPC** — caching and fallover prevent single RPC as bottleneck
- **Audit trail** — all Stellar transactions are immutable and publicly queryable
- **USDC Native** — native USDC on Stellar eliminates bridge risk

### Negative

- **Challenge expiry** — users have narrow window to sign (5 min); UX friction if wallet is slow
- **Nonce storage** — need to store all nonces to prevent replay (could become large)
- **Stellar.toml management** — must be updated and signed when rotating keys; manual process

### Mitigation

- **Challenge expiry tuning** — adjust 5 min window based on user feedback; log timeout frequency
- **Nonce TTL** — set nonce TTL to challenge expiry + 5 min; remove old nonces in background job
- **Stellar.toml automation** — integrate with CI/CD for key rotation; sign with deploy automation

## Related ADRs

- **ADR-001 (Stellar over Ethereum)** — why we chose Stellar as the base layer
- **ADR-003 (USDC over XLM)** — why we use USDC for payments
- **ADR-004 (Oracle design)** — how oracle bridge integrates with Stellar contracts
