# Contract Events

Every state-mutating Soroban contract function in `contracts/` publishes a
structured event so the backend and oracle services can track on-chain state
changes off-chain. This document is the source of truth for each event's
topic and data schema.

All events share the same first topic symbol, `c_ledger`, and are
distinguished by a second topic symbol specific to the action. Topics are
9-character-or-shorter `Symbol`s (Soroban's `symbol_short!` limit), so some
names are abbreviated.

A CI check (`scripts/check_event_docs_sync.py`, run via
`.github/workflows/ci.yml`) parses this table and cross-references it against
`(symbol_short!("c_ledger"), symbol_short!("..."))` occurrences in each
contract's `src/lib.rs` and the `tests/events.rs` assertions, failing the
build if a documented event has no matching test, a published event isn't
documented, or a documented event no longer exists in the source.

## `carbon_credit`

| Function | Topics | Data |
|---|---|---|
| `mint_credits` | `(c_ledger, minted)` | `CreditMintedEvent { batch_id, project_id, admin, amount, vintage_year, serial_start, serial_end, timestamp }` |
| `retire_credits` | `(c_ledger, retired)` | `CreditRetiredEvent { retirement_id, batch_id, project_id, amount, retired_by, beneficiary, timestamp }` |
| `transfer_credits` | `(c_ledger, transfer)` | `(batch_id: String, from: Address, to: Address, amount: i128)` |
| `upgrade` | `(c_ledger, upgraded)` | `(from_version: u32, to_version: u32, admin: Address)` |

## `carbon_marketplace`

| Function | Topics | Data |
|---|---|---|
| `list_credits` | `(c_ledger, listed)` | `ListingCreatedEvent { listing_id, seller, batch_id, amount, price_per_credit, timestamp }` |
| `delist_credits` | `(c_ledger, delisted)` | `(listing_id: String, seller: Address)` |
| `purchase_credits` | `(c_ledger, purchase)` | `PurchaseCompletedEvent { listing_id, buyer, seller, amount, total_cost, timestamp }` |
| `bulk_purchase` | `(c_ledger, bulk_buy)` | `PurchaseCompletedEvent { listing_id, buyer, seller, amount, total_cost, timestamp }` — published once per listing in the batch, in listing order |
| `suspend_project` | `(c_ledger, mkt_susp)` | `project_id: String` |
| `upgrade` | `(c_ledger, upgraded)` | `(from_version: u32, to_version: u32, admin: Address)` |

Note: `purchase_credits` and `bulk_purchase` cross-call
`carbon_credit::transfer_credits`, which publishes its own `c_ledger`/`transfer`
event (see the `carbon_credit` table above) on the *credit* contract's address
before the marketplace publishes `purchase`/`bulk_buy` on its own address.

## `carbon_registry`

| Function | Topics | Data |
|---|---|---|
| `register_project` | `(c_ledger, reg_proj)` | `(project_id: String, methodology: String, country: String, vintage_year: u32, methodology_score: u32)` |
| `verify_project` | `(c_ledger, verified)` | `(project_id: String, verifier_address: Address)` |
| `reject_project` | `(c_ledger, rejected)` | `(project_id: String, verifier_address: Address, reason: String)` |
| `update_project_status` | `(c_ledger, st_update)` | `(project_id: String, oracle_address: Address)` |
| `suspend_project` | `(c_ledger, suspended)` | `(project_id: String, admin: Address, reason: String)` |
| `oracle_suspend_project` | `(c_ledger, suspended)` | `(project_id: String, invoker: Address, reason: String)` — permissionless cross-contract entry point; `invoker` is `env.invoker()`, authenticated against the registered oracle address. Idempotent no-op (no event) if already suspended. |
| `retire_credits` | `(c_ledger, retired)` | `(project_id: String, amount: i128)` |
| `upgrade` | `(c_ledger, upgraded)` | `(from_version: u32, to_version: u32, admin: Address)` |

`increment_issued`, `add_verifier`, and `remove_verifier` mutate state but do
not publish events — they are internal bookkeeping operations invoked by the
oracle/admin and are not part of the backend's off-chain event-driven sync
surface.

## `carbon_oracle`

| Function | Topics | Data |
|---|---|---|
| `rotate_oracle` | `(c_ledger, ora_rot)` | `(admin: Address, new_oracle: Address)` |
| `submit_monitoring_data` | `(c_ledger, mon_data)` | `(project_id: String, period: String, tonnes_verified: i128, methodology_score: u32)` — always published on success |
| `submit_monitoring_data` (score < 70) | `(c_ledger, low_score)` | `(project_id: String, methodology_score: u32)` — published *before* `mon_data`, only when `methodology_score < 70` |
| `update_credit_price` | `(c_ledger, price_upd)` | `(methodology: String, vintage_year: u32, price_usdc: i128)` |
| `flag_project` | `(c_ledger, flagged)` | `(project_id: String, oracle_signer: Address, reason: String)` |
| `check_liveness` (stale) | `(c_ledger, liveness_flag)` | `(project_id: String, reason: String)` — published *after* the cross-contract call to `carbon_registry::oracle_suspend_project` (which itself publishes a `c_ledger`/`suspended` event on the registry contract — see the `carbon_registry` table above). No event when data is fresh, or the project is already flagged (idempotent). |
| `set_liveness_sla` | `(c_ledger, sla_upd)` | `(admin: Address, seconds: u64)` |
| `upgrade` | `(c_ledger, upgraded)` | `(from_version: u32, to_version: u32, admin: Address)` |

## `backend_indexing`

`EventIndexerService` (`backend/src/queue/event-indexer.service.ts`) polls the
Soroban RPC `/getEvents` endpoint and reconciles every `c_ledger` event into
Prisma. It runs on an interval (`EVENT_INDEXER_POLL_INTERVAL_MS`, default 15s),
scans at most `MAX_LEDGERS_PER_POLL` ledgers per poll, and only advances its
cursor after the whole page succeeds — a failed poll (network disconnect, RPC
outage, DB error) leaves the cursor untouched and the next poll retries the
same window, so no ledger range is skipped. On first boot with no cursor it
bootstraps from the last ~1000 ledgers instead of starting "now".

The last fully-processed ledger sequence is persisted in the **database**
config table `SyncMetadata` (singleton row, `lastIndexedLedger`), so the
cursor survives restarts and Redis flushes (#893).

| Contract event | Prisma update |
|---|---|
| `(c_ledger, minted)` | `CreditBatch` upsert (status `Active`) + `CarbonProject.totalCreditsIssued` increment inside a transaction |
| `(c_ledger, retired)` | `CarbonProject.totalCreditsRetired` increment + `CreditBatch.status` → `Retired` inside a transaction |
| `(c_ledger, transfer)` | Append-only `CreditEvent` row (`eventType: 'transfer'`, `actor` = sender, `newState` = `{ from, to, amount }`, `txHash` = RPC event id), HMAC-signed with the same scheme as `EventSourcingService` so the provenance log stays verifiable. Replays are skipped via an existence check on `(txHash, eventType)`. |
| `(c_ledger, reg_proj)` | `CarbonProject.status` → `Pending` |
| `(c_ledger, verified)` | `CarbonProject.status` → `Verified` |
| `(c_ledger, rejected)` | `CarbonProject.status` → `Rejected` |
| `(c_ledger, st_update)` / `(c_ledger, suspended)` / `(c_ledger, mkt_susp)` | `CarbonProject.status` → `Suspended` |

Every handler is idempotent, so replaying a ledger range (restart overlap,
error retry) converges to the same state.

## Testing conventions

- Each documented event has at least one assertion in the corresponding
  contract's `tests/events.rs`, asserting `env.events().all()` against the
  *exact* expected event list (topics + data), not just a containment check.
  This also verifies no extra or missing events are published on that path.
- Each contract's `tests/events.rs` includes one "happy path" test that runs
  a representative multi-step flow (e.g. mint → transfer → retire) and
  asserts the full, exact, in-order event sequence.
- `upgrade` is documented but intentionally excluded from the automated event
  tests across all four contracts: exercising a successful upgrade requires
  a real deployed Wasm binary (`env.deployer().upload_contract_wasm(..)`),
  which isn't available inside `cargo test` unit tests. This mirrors the
  existing test suite convention (see `test_upgrade_admin_only` in each
  contract), which only exercises the unauthorized-caller rejection path.
  The `upgraded` event schema above is verified by code review instead.
