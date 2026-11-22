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

## carbon_registry_v1 vs carbon_registry_v2

Two historical builds of the registry contract are kept in the repository:
`carbon_registry_v1` and `carbon_registry_v2`. They are **not** interchangeable
and they are **not** the current contract. This section explains how they
differ and how to move state from v1 to v2.

### Versions and SDKs

| Artifact | Contract version | Soroban SDK |
| --- | --- | --- |
| `carbon_registry_v1` | `1.0.0` | `20.0.0` |
| `carbon_registry_v2` | `2.0.0` | `20.0.0` |
| `carbon_registry` (current) | `0.1.0` | `21.7.7` |

Both legacy crates were built against `soroban-sdk 20.0.0`. The current
`carbon_registry` crate is `0.1.0` on `soroban-sdk 21.7.7`. Treat v1 and v2 as
frozen reference implementations; new work targets the current crate.

### Behavioural and storage differences

| Area | `carbon_registry_v1` (1.0.0) | `carbon_registry_v2` (2.0.0) |
| --- | --- | --- |
| Public interface | Minimal: register/read project records only | Superset of v1: adds update, status transitions, and admin management entry points |
| `DataKey` layout | Original set of keys; no versioned wrapper | Adds new keys alongside the v1 keys; existing v1 keys keep their discriminant and serialized layout |
| Stored record shape | Base project record fields only | Base fields plus additional fields, encoded so legacy records still decode (new fields are optional / versioned) |
| Version tracking | No `ContractVersion` / `UpgradeHistory` entries | Writes `ContractVersion` and appends to `UpgradeHistory` on upgrade |
| Migration support | None | Provides an idempotent, admin-authorized migration path for v1 entries |
| Read compatibility | n/a | Reads unmigrated v1 entries until they are migrated |

The key guarantee is that v2 **extends** v1 storage rather than redefining it:
existing `DataKey` discriminants and serialized layouts are unchanged, and new
fields are added as optional or versioned records. This is the same rule set
described in [State migration strategy](#state-migration-strategy).

### Migration path: v1 → v2

1. **Deploy v2.** Build and upload the reviewed `carbon_registry_v2` WASM and
   invoke `upgrade_contract` with its hash, following the
   [Release procedure](#release-procedure). Execute on testnet first.
2. **Migrate state idempotently.** Run the v2 migration entry point (or rely on
   lazy migration on read/write) to bring v1 entries up to the v2 record shape.
   The migration must be safe to re-run and must never re-run initialization.
3. **Switch consumers.** Point clients, indexers, and downstream contracts at
   the v2 interface. Because v2 is a superset of v1, existing v1 calls continue
   to work during the transition.
4. **Verify.** Confirm `get_version()` reports `2.0.0`, inspect
   `get_upgrade_history()`, and read representative pre-existing project records
   to confirm they decode and reflect the migrated shape.

For the general rules that govern any storage change, see
[State migration strategy](#state-migration-strategy); for the operational
steps around uploading and invoking the upgrade, see
[Release procedure](#release-procedure).

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