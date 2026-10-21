# Pause Feature Migration Guide

Closes #1329.

This guide covers moving an existing `carbon_credit` or `carbon_marketplace`
deployment that predates the emergency pause feature onto a build that has it.
It also covers enabling the backend pause endpoints and tracing.

Audience: operators running testnet or mainnet upgrades. Read
[`docs/UPGRADE_GUIDE.md`](../UPGRADE_GUIDE.md) first. This guide adds only the
pause-specific steps.

---

## 1. What changes

| Layer | Change |
| --- | --- |
| Contract storage | Two new persistent keys: `DataKey::PauseEnabled` (`bool`) and `DataKey::PauseUntil` (`u64`) |
| Contract API | `pause_operations(admin, until_timestamp)` and `unpause_operations(admin)` (admin only, pause window ≤ 72h) |
| Contract behaviour | State-changing entry points call `require_not_paused` and return `EmergencyPaused` (credit: 29, marketplace: 27) while paused. A pause expires on its own once `until_timestamp` passes. |
| Contract errors | New `InvalidPauseWindow` (credit: 28, marketplace: 26) and `EmergencyPaused` |
| Backend | `GET/POST /admin/contracts/:contract/pause`, `POST /admin/contracts/:contract/unpause`, traced by `PauseService` |
| Database | No schema migration. Pause state is mirrored in the existing `AdminConfig` table (`<contract>_paused`, `<contract>_paused_until`), and actions go to `AuditLog`. |
| Webhooks | New subscribable events `contract.paused` and `contract.unpaused` |

### Why no data migration is required

`require_not_paused` reads both keys with `unwrap_or(false)` / `unwrap_or(0)`. A
contract upgraded in place, whose storage has never held the keys, therefore
behaves as **unpaused**. There is nothing to backfill on-chain.

`initialize` writes both keys explicitly. Only fresh deployments get them at
init time. Upgraded deployments get them on their first `pause_operations`
call.

## 2. Pre-migration checklist

- [ ] Confirm the deployed contract version (`get_version`) and record it in the change ticket.
- [ ] Confirm the target WASM contains the pause feature:
  `stellar contract inspect --wasm <file> | grep -E "pause_operations|unpause_operations"`.
- [ ] Confirm the admin signing key that will call `upgrade_contract` holds
  `Role::Admin` on the contract.
- [ ] Check the new error-code numbers against the frontend and SDK error maps
  (`docs/error-codes.md`). Codes 26–29 must not collide with codes the clients
  already interpret.
- [ ] Run the contract suite, which includes paused-state tests:
  `cd contracts && cargo test -p carbon_credit -p carbon_marketplace`.
- [ ] Run the upgrade path test: `scripts/test_upgrade_path.sh`.
- [ ] Snapshot state for rollback comparison (section 4): current WASM hash,
  total supply, retired total, active listing count.
- [ ] Deploy to testnet with the same procedure first
  (`docs/TESTNET_DEPLOYMENT_RUNBOOK.md`).

## 3. Migration steps

### 3.1 Upload and upgrade the contracts

```bash
# 1. Build and upload the new WASM
cd contracts
stellar contract build
NEW_HASH=$(stellar contract upload --network $NETWORK --source $ADMIN_KEY \
  --wasm target/wasm32-unknown-unknown/release/carbon_credit.wasm)

# 2. Upgrade in place; storage is retained
stellar contract invoke --network $NETWORK --source $ADMIN_KEY \
  --id $CARBON_CREDIT_CONTRACT_ID -- upgrade_contract \
  --admin $ADMIN_ADDRESS --new_wasm_hash $NEW_HASH
```

Repeat for `carbon_marketplace` with `CARBON_MARKETPLACE_CONTRACT_ID`.

> ⚠️ `upgrade_contract` itself calls `require_not_paused`. Once a contract has
> the pause feature, you **cannot upgrade it while it is paused**. Unpause
> first, or wait for the pause window to expire. Plan incident-driven hotfixes
> with that in mind: pause, prepare the fix, unpause, then upgrade immediately.

Use the canary flow (`scripts/canary-rollout.js`) on mainnet if the release
also contains other behaviour changes.

### 3.2 Backend

1. Deploy the backend build that contains `PauseService`. No `prisma migrate`
   step is needed for this feature.
2. Make sure `CARBON_CREDIT_CONTRACT_ID` and `CARBON_MARKETPLACE_CONTRACT_ID`
   are set. The pause endpoints return `400` for a contract whose id is not
   configured.
3. Tracing: set `OTEL_EXPORTER_OTLP_ENDPOINT` to Jaeger or the collector (see
   `backend/docs/DISTRIBUTED_TRACING.md`).
4. Subscribe incident channels and partners to `contract.paused` /
   `contract.unpaused` webhooks.

### 3.3 Frontend and SDK

- Map error codes `EmergencyPaused` and `InvalidPauseWindow` to user-facing
  messages ("Trading is temporarily paused") rather than generic failures.
- Optionally read `GET /admin/contracts/:contract/pause` in the admin dashboard.

## 4. Testing before and after migration

| # | Test | Before upgrade | After upgrade |
| --- | --- | --- | --- |
| 1 | Invoke `pause_operations` | Fails: function not found | Succeeds for admin |
| 2 | `pause_operations` from a non-admin | n/a | Fails the admin role check |
| 3 | `pause_operations` with `until` > now + 72h, or ≤ now | n/a | Fails `InvalidPauseWindow` |
| 4 | Mint / retire / transfer / list / buy while paused | n/a | Fails `EmergencyPaused` |
| 5 | Same operations after `unpause_operations` | Succeed | Succeed |
| 6 | Same operations after the pause window expires with no unpause | n/a | Succeed (auto-expiry) |
| 7 | Read-only calls while paused | Succeed | Still succeed |
| 8 | Total supply, retired total, listings, balances | Record | **Unchanged** vs. snapshot |
| 9 | `POST /admin/contracts/carbon_credit/pause` | 404 | 200 with `txHash` and `traceId` |
| 10 | Trace `pause.pause_contract` in Jaeger has `contract_call`, `db_update`, `event_emit` children | n/a | Present |
| 11 | `AuditLog` row with action `contract.pause` and `metadata.traceId` | n/a | Present |

Run tests 1–7 and 9–11 on testnet. On mainnet, run only 8 and the non-mutating
checks. If a live pause test on mainnet is required, schedule it in a
maintenance window with the shortest practical window (e.g. `now + 300`), then
unpause.

## 5. Rollback procedures

Pick the least invasive option that resolves the problem.

1. **Pause stuck on (backend path broken).** Call the contract directly:
   `stellar contract invoke ... -- unpause_operations --admin $ADMIN_ADDRESS`.
   The worst case is waiting for automatic expiry (≤ 72h).
2. **Backend regression.** Redeploy the previous backend image. The contract
   pause feature keeps working through the CLI. `AdminConfig` pause keys are
   ignored by older builds. No database rollback is needed.
3. **Contract regression.** Unpause (upgrade is blocked while paused), then
   call `upgrade_contract` with the **previous** WASM hash recorded in step 2.
   The pause keys stay in storage and are harmless to the old code, which never
   reads them.
4. After any rollback, re-run test 8 against the pre-migration snapshot and
   file an incident note.

Rollback never needs data deletion. Do not try to remove the `PauseEnabled` /
`PauseUntil` storage entries.

## 6. Validation checklist

Sign off each item in the change ticket.

- [ ] Both contracts report the expected new WASM hash, and `get_version` returns the previous version + 1.
- [ ] An `UpgradeRecord` for this upgrade is appended to each contract's upgrade history.
- [ ] Contract is not paused after migration (`PauseEnabled` absent or `false`).
- [ ] State invariants unchanged: supply, retired total, balances, active listings.
- [ ] Testnet run of section 4 passed and results are attached.
- [ ] Backend pause endpoints respond for admins and return `403` for non-admins.
- [ ] A test pause on testnet shows a full trace in Jaeger and a matching `AuditLog` entry.
- [ ] `contract.paused` webhook received by at least one subscriber on testnet.
- [ ] Frontend shows the paused message for `EmergencyPaused`.
- [ ] `docs/runbooks/contract-exploit.md` updated to reference the pause
  endpoints for this deployment.
- [ ] Compliance checklist (`docs/pause-feature/compliance-checklist.md`) reviewed.
