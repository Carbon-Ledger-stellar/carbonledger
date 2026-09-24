# Pause Feature Disaster Recovery & Incident Response Guide

This document defines disaster recovery (DR) procedures, rollback protocols, and state synchronization for the CarbonLedger pause feature.

## 1. Disaster Recovery Overview
When an emergency or exploit is detected, the contract pause mechanism acts as the primary containment lever to protect user assets and ledger integrity.

- **Recovery Point Objective (RPO)**: 0 transactions lost (all valid transactions prior to pause ledger close are final).
- **Recovery Time Objective (RTO)**: Emergency pause executed within < 5 minutes of incident declaration; full post-incident verification & unpause completed within 24 hours.

## 2. Emergency Escalation Workflow
```
[Anomaly Detected] ──> [On-Call Engineer Verifies] ──> [Executes Pause]
                                                               │
[Verify Contract & Indexer Consistency] <─────────────────────┘
         │
         ▼
[Patch Deployed / Exploit Mitigated] ──> [Multi-Sig Unpause] ──> [Post-Mortem]
```

## 3. Execution Procedures

### Step 1: Execute Emergency Pause
If UI dashboard is unavailable, execute via CLI using Soroban CLI:
```bash
soroban contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --network testnet \
  -- \
  pause_operations \
  --admin "$ADMIN_ADDRESS" \
  --until_timestamp $(($(date +%s) + 86400))
```

### Step 2: Off-Chain Indexer Quarantine
1. Halt queue workers from submitting outgoing batch transactions:
   ```bash
   kubectl scale deployment backend-worker --replicas=0
   ```
2. Set Redis cache status flag to force frontend read-only mode:
   ```bash
   redis-cli SET carbonledger:contract_paused 1
   ```

### Step 3: Data Consistency Verification
Run consistency check comparing on-chain storage with PostgreSQL database:
```bash
npm run script:verify-pause-consistency -- --contract-id "$CARBON_CREDIT_CONTRACT_ID"
```
Ensure:
- No orphaned token minting records exist.
- Pending retirements are marked as suspended or queued.

### Step 4: Resuming Operations
Once the mitigation has been verified:
1. Lift contract pause:
   ```bash
   soroban contract invoke \
     --id "$CARBON_CREDIT_CONTRACT_ID" \
     --source-account "$ADMIN_KEY" \
     --network testnet \
     -- \
     unpause_operations \
     --admin "$ADMIN_ADDRESS"
   ```
2. Resume backend queue workers:
   ```bash
   kubectl scale deployment backend-worker --replicas=3
   ```
3. Announce operational recovery on the status page.
