# Contract Upgrade Guide

This guide covers the Soroban WASM upgrade path for the four core contracts:
`carbon_registry`, `carbon_credit`, `carbon_marketplace`, and `carbon_oracle`.

## Security boundary

Each contract exposes the same administrative endpoint:

```text
upgrade_contract(admin: Address, new_wasm_hash: BytesN<32>)
```

The endpoint first requires an authorization from `admin`, then verifies that it
is the address stored as the contract administrator. The supplied hash must
refer to WASM already uploaded to Soroban. The upgrade is atomic: if the call
fails, neither the executable nor upgrade metadata changes.

Only deploy WASM built from a reviewed and tagged commit. Do not accept a WASM
hash from an untrusted channel, and use the production administrative signing
procedure for every invocation.

## State migration strategy

Soroban replaces only the contract executable. Persistent and temporary ledger
entries at the existing contract address remain in place. This preserves credit
batches and active balances, project records, marketplace listings, oracle
monitoring data, and retirement certificates.

Upgraded code must remain able to decode every existing value. Follow these
rules for any storage evolution:

1. Never change the discriminant or serialized layout of an existing `DataKey`
   or stored contract type.
2. Add new keys and fields as a new schema version; use `Option<T>` or a
   separate versioned record for absent legacy values.
3. Make migrations idempotent and run them lazily on read/write, or through an
   explicitly admin-authorized migration endpoint. Never re-run initialization.
4. Keep old reads working until all affected entries have been migrated.
5. Increment and inspect `ContractVersion` and `UpgradeHistory` as part of
   post-upgrade verification.

## Release procedure

1. Run the contract test suite and build release WASM:

   ```powershell
   cd contracts
   cargo test --workspace
   cargo build --target wasm32-unknown-unknown --release --workspace
   ```

2. Upload the reviewed WASM and record its SHA-256 hash.
3. Invoke `upgrade_contract` from the stored admin account with that uploaded
   hash. Execute on testnet before mainnet.
4. Confirm `get_version()` advanced exactly once and inspect
   `get_upgrade_history()`.
5. Read representative pre-existing state. At minimum, verify an active credit
   batch and its owner/balance, plus any contract-specific records affected by
   the release.

## Rollback

Soroban upgrades are not a pointer flip. To remediate a bad release, build and
review a corrective WASM, upload it, and perform a new `upgrade_contract` call.
The corrective binary must preserve the same storage compatibility guarantees.

For the operational checklist and CLI examples, see
[the contract-upgrade runbook](runbooks/contract-upgrade.md).
