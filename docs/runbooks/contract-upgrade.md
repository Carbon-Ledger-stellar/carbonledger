# Contract Upgrade Runbook

**Priority:** High  
**Effort:** Medium  
**Last Updated:** 2026-04-28  
**Applies to:** `carbon_registry`, `carbon_credit`, `carbon_marketplace`, `carbon_oracle`

---

## Overview

This runbook describes the standard operating procedure for upgrading the four CarbonLedger Soroban smart contracts on testnet and mainnet. All upgrades use Soroban's built-in WASM upgrade mechanism (`update_current_contract_wasm`), which replaces contract code while preserving all persistent and temporary storage.

---

## Principles

1. **Admin-gated only.** Only the stored `Admin` address may invoke `upgrade()`.
2. **Storage is preserved.** WASM upgrades do not touch ledger entries; all projects, credits, listings, monitoring data, and retirement certificates survive the upgrade.
3. **Retirement records are immutable.** No upgrade may contain code that decreases `total_credits_retired`, alters `RetirementCertificate` entries, or reverts a `FullyRetired` batch to `Active`.
4. **Testnet first.** Every upgrade must be executed and validated on Futurenet/Testnet before mainnet.
5. **Version tracking.** Each upgrade increments an on-chain `ContractVersion` counter and emits an `upgraded` event with `from_version`, `to_version`, `admin`, and `wasm_hash`.

---

## Pre-Upgrade Checklist

- [ ] New WASM has been compiled with `--release` and audited.
- [ ] New WASM hash has been computed (`stellar contract install ...`).
- [ ] Storage layout backward compatibility has been verified.
- [ ] No new functions can decrease retirement counters or alter retirement certificates.
- [ ] Upgrade has been executed successfully on **testnet**.
- [ ] Off-chain indexers have been notified of the upgrade block.
- [ ] Admin key is available and has sufficient XLM for transaction fees.
- [ ] Incident response channel is open in case of upgrade failure.

---

## Upgrade Procedure

### 1. Build and Install the New WASM

```bash
# Build the new contract
cd contracts/carbon_registry
cargo build --target wasm32-unknown-unknown --release

# Install WASM to the network (returns WASM hash)
stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm \
  --source <ADMIN_SECRET_KEY> \
  --network testnet
```

Repeat for `carbon_credit`, `carbon_marketplace`, and `carbon_oracle`.

### 2. Verify the WASM Hash

```bash
# Compute local hash and compare with on-chain returned hash
sha256sum target/wasm32-unknown-unknown/release/carbon_registry.wasm
```

Record the hash in the upgrade log.

### 3. Invoke the Upgrade Transaction

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_SECRET_KEY> \
  --network testnet \
  -- upgrade \
  --admin <ADMIN_ADDRESS> \
  --new_wasm_hash <WASM_HASH>
```

### 4. Post-Upgrade Validation

Run the following checks immediately after the transaction is confirmed:

| Check | Command / Action |
|---|---|
| Version incremented | `get_version()` should return `old + 1` |
| Upgrade history recorded | `get_upgrade_history()` should match the tx |
| Retired credits intact | `get_project(...).total_credits_retired` unchanged |
| Retirement certificates intact | `get_retirement_certificate(...)` returns same data |
| Listings intact | `get_listing(...)` returns same data |
| Monitoring data intact | `get_monitoring_data(...)` returns same data |

### 5. Mainnet Deployment

Repeat steps 1-4 on mainnet **only after** testnet validation is complete and signed off by at least two engineers.

---

## Rollback Policy

Soroban WASM upgrades are **one-way** at the protocol level. There is no native rollback. If a critical bug is discovered after upgrade:

1. **Do not panic.** Storage is safe.
2. Build a **new patched WASM** from the previous known-good source.
3. Execute another `upgrade()` to the patched WASM.
4. Document the incident and schedule a post-mortem.

---

## Event Reference

All contracts emit the same upgrade event shape:

```
Event topic: ("c_ledger", "upgraded")
Event data:  (from_version: u32, to_version: u32, upgraded_by: Address)
```

---

## Emergency Contacts

See [contacts.md](contacts.md) for on-call escalation paths.

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-04-28 | OpenCode | Initial runbook covering all four contracts |
