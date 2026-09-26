# ADR-011: Soroban Smart Contract Architecture and Patterns

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-08-28 |
| Deciders | Smart Contract Team, Blockchain Architects |

## Context

CarbonLedger runs four Soroban contracts in Rust: carbon_registry, carbon_credit, carbon_marketplace, and carbon_oracle. These contracts must interoperate with an off-chain backend while maintaining security, testability, and upgrade paths.

**Design challenges:**
1. **State synchronization** — off-chain database and on-chain state can drift; how to keep them in sync?
2. **Cross-contract calls** — registry enumerates issued credits; credit contract must be callable by registry
3. **Event indexing** — backend needs to know when mints, transfers, retirements occur
4. **Upgrade path** — old contract instances may need to be replaced without data loss
5. **Oracle integration** — external bridge must submit verified data to oracle contract

## Decision

Adopt the following architecture patterns:

### 1. Dual-Ledger Pattern

**On-chain state:** Immutable proofs (serial numbers, ownership, transaction hashes)  
**Off-chain state:** Full transaction history, user metadata, IPFS content hashes  

**Rationale:**
- Blockchain storage is expensive and slow; not suitable for application-level history
- Off-chain allows flexible querying (search, filter, pagination) without custom indexing contracts
- Registry of truth: on-chain state is authoritative for ownership/serial numbers; off-chain mirrors for performance

### 2. Event-Driven Sync

**Contract emits events for every state change:**
```rust
env.emit_event(ContractEvent {
    action: "mint",
    projectId: project_id,
    batchId: batch_id,
    amount: amount_stroops,
    serialStart: serial_start,
    serialEnd: serial_end,
});
```

**Backend indexes events via SorobanRpc.Server::get_events():**
```typescript
// Poll contract events every 5 seconds
const events = await sorobanRpc.getEvents({
    startLedger: lastIndexedLedger,
    filters: [{ type: 'contract', contractId: creditContractId }],
});
// Insert into database, update off-chain balances
```

**Rationale:**
- Events are the source of truth for what happened on-chain
- Indexing is pull-based (backend controls retry/backoff) not push-based
- Events are immutable and can be replayed for data recovery

### 3. Cross-Contract Calls

**Registry contract calls Credit contract:**
```rust
// In carbon_registry::issue_credits()
let credit_client = CreditContractClient::new(&env, &CREDIT_CONTRACT_ID);
credit_client.mint(
    project_id: String,
    batch_id: String,
    amount: i128,
    serial_numbers: Vec<String>,
);
```

**Credit contract validation:**
```rust
// Verify caller is registry (prevents unauthorized mints)
let registry_address = env.invoke_contract::<_, String>(
    &REGISTRY_CONTRACT_ID,
    &symbol_short!("get_registry"),
    vec![],
);
require!(env.current_contract_address() == registry_address, Error::UnauthorizedCaller);
```

**Rationale:**
- Registry is source of truth for project verification; only registry can trigger credit mints
- Cross-contract calls are synchronous and can fail atomically
- Authorization is enforced in the credit contract, not the caller

### 4. Upgrade Path

**V1 → V2 migration:**
1. Deploy V2 contract alongside V1 (new contract ID)
2. Backend switches to indexing V2 events
3. Off-chain migration: copy existing balances to V2 via data import
4. Decommission V1 (set pause flag in V1; clients notified)

**State preservation:**
- Serialized state is copied to V2 via a one-time initialization transaction
- No on-chain state loss; old contract ID remains queryable for historical proofs

**Rationale:**
- Immutable contract IDs guarantee that old transactions remain verifiable
- No forced migration of users; old contract can coexist until deprecation date
- Auditors can verify the full chain of custody across contract versions

### 5. Oracle Integration

**Oracle bridge (Python) submits signed updates:**
```
POST /api/v1/oracle/ingest/monitoring
{
  "projectId": "proj-123",
  "period": "2026-Q3",
  "tonnesVerified": 1000,
  "signature": "hex_ed25519_signature",
  "nonce": 1
}
```

**Backend guard validates signature:**
```typescript
@UseGuards(OracleGuard)
@Post('ingest/monitoring')
async ingestMonitoring(payload: MonitoringPayload) {
  // Verify Ed25519 signature against oracle's public key
  // Ensure nonce has not been seen before (replay protection)
  // Submit to Soroban oracle contract
}
```

**Oracle contract stores verified data:**
```rust
pub struct VerificationRecord {
    project_id: String,
    period: String,
    tonnes_verified: i128,
    submitted_at: u64,
    nonce: u64,
}
```

**Rationale:**
- Off-chain oracle provides data; on-chain contract records immutable proof
- Signature verification ensures only authorized oracle can submit
- Nonce prevents replay attacks (same data submitted twice)

## Consequences

### Positive

- **Separation of concerns** — contracts focus on logic; backend handles history/UX
- **Event-driven** — backend can react to on-chain events in real time
- **Testable** — contracts can be unit tested with `soroban_sdk::testutils::Env`
- **Upgradeable** — new contract versions coexist with old; graceful migration path
- **Auditable** — all on-chain state changes are recorded as events

### Negative

- **Synchronization lag** — event indexing is eventually consistent (5-10s delay typical)
- **State mismatch** — if backend crashes during indexing, on-chain and off-chain can diverge
- **Complexity** — dual-ledger pattern requires careful data reconciliation

### Mitigation

- **Event reconciliation job** — periodically compare on-chain balances with off-chain state; alert if divergence detected
- **Dead-letter queue** — failed indexing attempts go to DLQ for manual recovery
- **Audit trail** — CreditEvent table is append-only; every mutation is logged with HMAC signature

## Related ADRs

- **ADR-001 (Stellar over Ethereum)** — why Soroban instead of EVM
- **ADR-002 (Soroban over Stellar Classic)** — why Soroban over classic payment operations
- **ADR-004 (Oracle design)** — how oracle bridge submits verified data to contracts
- **ADR-005 (Off-chain storage)** — PostgreSQL stores application state; Soroban stores immutable proofs
