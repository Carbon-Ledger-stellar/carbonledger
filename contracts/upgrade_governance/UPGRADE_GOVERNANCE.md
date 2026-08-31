# Contract Upgrade Governance

> **Security model:** 3-of-5 multi-sig approval + 48-hour timelock.  
> No contract upgrade can execute without 3 out of 5 signers explicitly approving
> and a public 48-hour observation window.

---

## Overview

The `upgrade_governance` Soroban contract enforces the following invariants for
every CarbonLedger smart contract upgrade:

| Property | Value |
|----------|-------|
| Required approvals | **3 of 5** registered signers |
| Timelock duration | **48 hours** (172,800 ledger seconds) |
| Public visibility | Proposal event emitted on-chain immediately |
| Cancellable | Yes — any signer can cancel before execution |

---

## Upgrade Lifecycle

```
Signer A: propose(target, wasm_hash, description_cid)
                │
                ▼
         Proposal created (status: Pending)
         ┌─────────────────────────────────────────────────┐
         │ Event: gov/proposed                              │
         │ → Community can review, raise concerns           │
         └─────────────────────────────────────────────────┘
                │
Signer B: approve(proposal_id)   ← 2nd approval
Signer C: approve(proposal_id)   ← 3rd approval → QUORUM REACHED
                │
                ▼
         Timelock starts (status: TimelockStarted)
         ┌─────────────────────────────────────────────────┐
         │ Event: gov/timelock                              │
         │ → 48-hour window: community can raise concerns   │
         │ → Any signer can cancel() during this window     │
         └─────────────────────────────────────────────────┘
                │
                │  [48 hours elapse]
                │
Any Signer: execute(proposal_id)
                │
                ▼
         Returns approved wasm_hash (status: Executed)
                │
                ▼
         Admin calls target_contract.upgrade(wasm_hash)
```

---

## Step-by-Step Upgrade Procedure

### 1. Build the new WASM

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release -p carbon_registry
```

### 2. Get the WASM hash

```bash
stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source SIGNER_SECRET_KEY \
  --network testnet
# Returns: <wasm_hash_hex>
```

### 3. Propose the upgrade (any signer)

```bash
stellar contract invoke \
  --id UPGRADE_GOVERNANCE_CONTRACT_ID \
  --source SIGNER_A_SECRET_KEY \
  --network testnet \
  -- propose \
  --proposer SIGNER_A_PUBLIC_KEY \
  --target_contract CARBON_REGISTRY_CONTRACT_ID \
  --new_wasm_hash <wasm_hash_hex> \
  --description_cid "ipfs://Qm<changelog_cid>"
# Returns: proposal_id (e.g. 1)
```

> Pin the changelog / diff to IPFS and use the CID as `description_cid` so it is
> permanently linked to the on-chain proposal.

### 4. Collect approvals (2 more signers)

```bash
stellar contract invoke \
  --id UPGRADE_GOVERNANCE_CONTRACT_ID \
  --source SIGNER_B_SECRET_KEY \
  --network testnet \
  -- approve \
  --signer SIGNER_B_PUBLIC_KEY \
  --proposal_id 1

stellar contract invoke \
  --id UPGRADE_GOVERNANCE_CONTRACT_ID \
  --source SIGNER_C_SECRET_KEY \
  --network testnet \
  -- approve \
  --signer SIGNER_C_PUBLIC_KEY \
  --proposal_id 1
```

After the 3rd approval the timelock starts. Verify:

```bash
stellar contract invoke \
  --id UPGRADE_GOVERNANCE_CONTRACT_ID \
  --source SIGNER_A_SECRET_KEY \
  --network testnet \
  -- timelock_remaining \
  --proposal_id 1
# Returns: remaining seconds (172800 at quorum)
```

### 5. Wait 48 hours

Monitor the Stellar explorer for the `gov/timelock` event. Announce the pending
upgrade in the project Discord / community channels.

### 6. Execute after timelock

```bash
stellar contract invoke \
  --id UPGRADE_GOVERNANCE_CONTRACT_ID \
  --source SIGNER_A_SECRET_KEY \
  --network testnet \
  -- execute \
  --executor SIGNER_A_PUBLIC_KEY \
  --proposal_id 1
# Returns: approved wasm_hash
```

### 7. Apply the upgrade to the target contract

```bash
stellar contract invoke \
  --id CARBON_REGISTRY_CONTRACT_ID \
  --source ADMIN_SECRET_KEY \
  --network testnet \
  -- upgrade \
  --admin ADMIN_PUBLIC_KEY \
  --new_wasm_hash <approved_wasm_hash>
```

---

## Cancellation

Any signer can cancel a proposal at **any point before execution**:

```bash
stellar contract invoke \
  --id UPGRADE_GOVERNANCE_CONTRACT_ID \
  --source SIGNER_SECRET_KEY \
  --network testnet \
  -- cancel \
  --signer SIGNER_PUBLIC_KEY \
  --proposal_id 1
```

Reasons to cancel:
- Security vulnerability discovered in the new WASM
- Community objection raised during the 48-hour window
- Incorrect `wasm_hash` submitted

---

## Rollback Plan

Soroban contract upgrades are **not automatically reversible** — a rollback
requires a new upgrade proposal going through the same 3-of-5 + 48h process.

### Rollback procedure

1. **Identify the previous WASM hash** from the `UpgradeRecord` stored on-chain:
   ```bash
   stellar contract invoke \
     --id CARBON_REGISTRY_CONTRACT_ID \
     --source ANY_SECRET_KEY \
     --network testnet \
     -- get_upgrade_history
   ```

2. **If previous WASM is already installed** on the network (it was installed
   in an earlier `stellar contract install` call), its hash is reusable directly.

3. **Submit a rollback proposal** using the previous WASM hash as `new_wasm_hash`
   and a description that references the incident:
   ```bash
   stellar contract invoke ... -- propose \
     --new_wasm_hash <previous_wasm_hash> \
     --description_cid "ipfs://Qm<incident_report_cid>"
   ```

4. **Emergency fast-track**: In a confirmed security exploit, the 5 signers may
   coordinate to approve + execute the rollback in under 48 hours by all 5
   approving (allowing the timelock to be considered a formality). The timelock
   **cannot be bypassed** by the contract itself — schedule accordingly.

5. **Suspend the contract** (mitigate while rollback is pending) using the
   existing `suspend_project()` mechanism on the registry to halt new credit
   issuance without requiring a contract upgrade.

---

## Signer Key Management

- Signer keys should be held in hardware wallets (Ledger) or multi-party custody.
- Rotate signer keys via a new governance proposal that calls a future
  `update_signers()` function (to be added in a subsequent governance upgrade).
- Never store signer keys in CI/CD secrets — use a separate cold-key process.

---

## Security Considerations

| Risk | Mitigation |
|------|-----------|
| Compromised single signer key | 3-of-5 threshold; one key alone cannot approve |
| Malicious WASM submitted | 48-hour public window for community review |
| All 5 signers compromised | Stellar account freeze via SEP-0030 recovery |
| Timelock bypass attempt | Timelock enforced at contract level — cannot be skipped |
| WASM hash mismatch | `execute()` returns the exact approved hash; admin must use it |

---

## Contract Address (fill after deployment)

```
UPGRADE_GOVERNANCE_CONTRACT_ID=
```

Add to `.env` and reference in upgrade scripts.
