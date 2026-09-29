# Pause Feature — Pre-Deployment Checklist

> **Related:** [Specification](./SPECIFICATION.md) · [Testing checklist](./TESTING_CHECKLIST.md) · [Release notes](./RELEASE_NOTES.md) · [Mainnet deployment](../MAINNET_DEPLOYMENT.md) · [Contract upgrade runbook](../runbooks/contract-upgrade.md)

Complete this checklist **before** releasing the pause feature to testnet or mainnet. A release is blocked until every item is ✅ or has a documented N/A and the release owner has signed off at the bottom.

Items marked *(proposed layer)* apply only if that part of the [specification](./SPECIFICATION.md) ships in this release.

---

## 1. Contract tested

- [ ] Every item in [Testing checklist §1](./TESTING_CHECKLIST.md#1-contract-testing-15-items) (C-01 … C-15) passes on the release commit.
- [ ] `cargo test --workspace` in `contracts/` is green in CI, including `adversarial_tests`.
- [ ] `cargo clippy --all-targets -- -D warnings` is clean.
- [ ] The WASM builds reproducibly (`stellar contract build`), and the recorded hashes for `carbon_credit` and `carbon_marketplace` match CI artifacts.
- [ ] The gated-function list in spec §4.4 matches the code: `grep -n 'require_not_paused(' contracts/carbon_{credit,marketplace}/src/lib.rs`.
- [ ] The error codes in spec §4.5 match the `CarbonError` enums (credit 28/29, marketplace 26/27).
- [ ] Testnet dress rehearsal: pause → gated call fails → unpause → gated call succeeds, on the release WASM. Record the transaction hashes.
- [ ] The admin address on the target network is the intended multisig or governance account (`upgrade_governance`), not a developer key.

## 2. API ready *(proposed layer)*

- [ ] Every item in [Testing checklist §2](./TESTING_CHECKLIST.md#2-api-testing-20-items--proposed-layer) passes.
- [ ] The new routes are in the exported OpenAPI spec, and the public API docs are regenerated.
- [ ] Environment config includes the contract IDs for `carbon_credit` and `carbon_marketplace` on the target network (see [configuration.md](../configuration.md)).
- [ ] The Redis TTL for the pause status key is set to 30 s.
- [ ] The `EmergencyPaused` → `503 ContractPaused` mapping is enabled on every write endpoint.
- [ ] Rate limits on the admin prepare and submit endpoints are configured.
- [ ] A staging smoke test (`smoke-tests/`) of `GET /status/pause` passes.

## 3. Frontend ready *(proposed layer)*

- [ ] Every item in [Testing checklist §3](./TESTING_CHECKLIST.md#3-frontend-testing-15-items--proposed-layer) passes.
- [ ] `carbon-error-codes.ts` includes the pause codes for both contracts. *This is needed even without the rest of the UI layer.*
- [ ] Banner copy has been reviewed by product and translated for every locale.
- [ ] Admin console controls are behind the admin role and a feature flag.
- [ ] Playwright e2e and visual regression suites pass on staging.

## 4. Database migrations ready

- [ ] **Contract-only release:** no migration is needed. Pause state lives on-chain. Mark the rest of this section N/A.
- [ ] *(proposed layer)* The `contract_pause_events` migration is additive only and reviewed against [database-migration-policy.md](../database-migration-policy.md).
- [ ] *(proposed layer)* The migration has been applied to staging, and `prisma migrate status` is clean.
- [ ] *(proposed layer)* A down or rollback migration is written and tested, dropping the table without touching other data.
- [ ] *(proposed layer)* A backup was taken before the migration ([database-backup runbook](../runbooks/database-backup.md)).
- [ ] No change is needed to `audit_logs`. Pause entries use the existing `AuditLogEntry` columns.

## 5. Monitoring configured

- [ ] **Alert:** any contract becomes paused → page Contracts Lead and Security Lead. Until events exist (spec §4.6), drive this from a synthetic check that simulates a gated read or reads `PauseEnabled`/`PauseUntil` through RPC `getLedgerEntries` and applies the effective check.
- [ ] **Alert:** a pause lasts more than 48 h, as a warning ahead of the 72 h auto-expiry.
- [ ] **Alert:** more than 3 re-pauses within 7 days, which could mean a compromised admin key or a denial of service.
- [ ] **Dashboard:** a Grafana panel shows each contract's pause state, `until` countdown and `EmergencyPaused` error rate ([OBSERVABILITY_GUIDE.md](../OBSERVABILITY_GUIDE.md)).
- [ ] **Metric:** the backend emits `contract_paused{contract=…}` (gauge) and `contract_paused_rejections_total` (counter) *(proposed layer)*.
- [ ] **Tracing:** 503 `ContractPaused` responses carry the OpenTelemetry trace ID.
- [ ] Synthetic monitoring ([runbook](../runbooks/synthetic-monitoring.md)) knows that purchase and retire probes are *expected* to fail during a declared pause, and suppresses those alerts.

## 6. Documentation complete

- [ ] The [specification](./SPECIFICATION.md) matches the shipped code, and each Implemented or Proposed tag is up to date.
- [ ] The [release notes](./RELEASE_NOTES.md) are finalised with the version, date and contract IDs.
- [ ] [contract-exploit runbook](../runbooks/contract-exploit.md) is updated: its line "no pause function" is now wrong for credit and marketplace, so add the pause procedure below.
- [ ] [RUNBOOKS.md](../RUNBOOKS.md) "Pause affected contract" uses Stellar CLI commands, not the EVM `web3` example.
- [ ] [error-codes.md](../error-codes.md) lists `InvalidPauseWindow` and `EmergencyPaused` for both contracts.
- [ ] [contract-events.md](../contract-events.md) is updated if pause events ship.
- [ ] `CHANGELOG.md` has an entry.

## 7. Rollback procedures defined

### 7.1 Emergency pause (reference procedure)

```bash
# Pause for 6 hours. UNTIL must be ≤ now + 259200 (72 h).
UNTIL=$(( $(date +%s) + 6*3600 ))
stellar contract invoke --id "$CARBON_MARKETPLACE_ID" --source admin --network mainnet \
  -- pause_operations --admin "$ADMIN_ADDRESS" --until_timestamp "$UNTIL"

# Lift the pause early
stellar contract invoke --id "$CARBON_MARKETPLACE_ID" --source admin --network mainnet \
  -- unpause_operations --admin "$ADMIN_ADDRESS"
```

To stop marketplace purchases **and** credit operations, pause `carbon_credit` as well. Pausing credit alone already blocks purchases (spec §3.1).

### 7.2 Rollback scenarios

| Scenario | Action |
|---|---|
| Stuck in a pause you did not intend | `unpause_operations`. It is never gated and is idempotent. If the admin key is unavailable, the pause lifts on its own at `until` (≤ 72 h). |
| Contract bug needs a WASM fix while paused | `upgrade_contract` is gated. Prepare the upgrade transaction in advance, then submit **unpause → upgrade → pause** back to back, and verify `get_version`. Follow the [contract-upgrade runbook](../runbooks/contract-upgrade.md). |
| Admin key suspected compromised | On credit, `grant_role` a new admin and `revoke_role` the old one (both ungated), then re-pause with the new key. Follow the [key-compromise runbook](../runbooks/key-compromise.md). |
| Backend pause API misbehaving *(proposed layer)* | Turn off the admin console feature flag, redeploy the previous backend image, and use the CLI procedure in §7.1. On-chain state is unaffected. |
| Frontend banner stuck or wrong *(proposed layer)* | Clear the Redis pause-status key, and turn off the banner flag if needed. Users can still transact if the chain is unpaused. |
| `contract_pause_events` migration failed *(proposed layer)* | Run the down migration. No other tables depend on it. |

- [ ] The rollback owner and a backup are named in [contacts.md](../runbooks/contacts.md).
- [ ] The §7.1 commands were rehearsed on testnet in the last 30 days, with transaction hashes recorded.
- [ ] Pre-signed or pre-prepared unpause and upgrade transactions exist for the multisig, if the governance setup allows it.

---

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Contracts Lead | | | |
| Backend Lead | | | |
| Frontend Lead | | | |
| Security Lead | | | |
| Release owner | | | |
