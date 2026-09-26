# Release Notes — Emergency Pause

> **Release:** _vX.Y.Z — fill in at release time_ · **Date:** _YYYY-MM-DD_
> **Networks:** Testnet _(contract IDs)_ · Mainnet _(contract IDs)_
> **Related:** [Specification](./SPECIFICATION.md) · [Testing checklist](./TESTING_CHECKLIST.md) · [Deployment checklist](./DEPLOYMENT_CHECKLIST.md)

## Overview

CarbonLedger's `carbon_credit` and `carbon_marketplace` contracts now include an **emergency pause**. If an incident happens, such as a suspected exploit, a bad oracle price or a serial-number conflict, an administrator can temporarily stop all state-changing operations on the affected contract while the team investigates.

Every pause is **time-limited to 72 hours at most** and lifts on its own when that time runs out. Read access to projects, credits, listings, certificates and the audit trail is never interrupted.

## Highlights

### For administrators

- **Stop an incident in minutes.** A single `pause_operations` call blocks minting, retiring, transferring, listing, purchasing and admin configuration changes on that contract.
- **Built-in safety net.** The pause window is checked on-chain (`now < until ≤ now + 72 h`), so a pause can never be left on forever by mistake.
- **Flexible control.** Call `pause_operations` again to extend or shorten a pause, or call `unpause_operations` to lift it early. Unpausing is idempotent and always available.
- **Key recovery stays open.** On `carbon_credit`, `grant_role` and `revoke_role` still work during a pause, so a compromised admin key can be rotated.
- **One switch for trading.** Pausing `carbon_credit` also stops marketplace purchases, because purchases transfer credits through that contract.

### For users

- **Your credits and funds are safe.** A pause only blocks new transactions. Nothing is moved, burned or frozen permanently.
- **Browsing keeps working.** You can still view projects, your portfolio, listings, retirement certificates and the public audit explorer.
- **Blocked actions** while a contract is paused:
  - Marketplace: buy, bulk buy, list, delist.
  - Credits: retire, transfer. (Issuance by admins is also blocked.)
- **Predictable end time.** Every pause has a fixed end time no more than 72 hours away, and normal service resumes on its own after that.
- Transactions attempted during a pause fail **before** any funds move, and you only pay the network fee.

## API changes

### Smart contracts (both `carbon_credit` and `carbon_marketplace`)

| Change | Details |
|---|---|
| **New** `pause_operations(admin: Address, until_timestamp: u64)` | Admin only. `until_timestamp` is a Unix time in seconds, later than now and no more than 259,200 s (72 h) ahead. |
| **New** `unpause_operations(admin: Address)` | Admin only. Idempotent. |
| **New error** `InvalidPauseWindow` | `carbon_credit` = **28**, `carbon_marketplace` = **26** |
| **New error** `EmergencyPaused` | `carbon_credit` = **29**, `carbon_marketplace` = **27** |
| **Behaviour change** | 10 functions on `carbon_credit` and 12 on `carbon_marketplace` now return `EmergencyPaused` while paused. See [spec §4.4](./SPECIFICATION.md#44-gated-functions) for the full list. |

> ⚠️ Error codes are **per contract**. Code 29 on the marketplace means `ListingExpired`, not a pause. Always decode errors using the contract that raised them.

Pause and unpause emit **no contract events** in this release, and there is no `pause_status()` view yet. Both are planned (spec §4.6).

### Backend REST API

There are no backend REST changes in this release. The pause status and admin endpoints in [spec §5](./SPECIFICATION.md#5-api-specification-proposed) are planned for a follow-up release. Until then, a write endpoint that hits a paused contract returns its existing contract-error response, containing the error code above.

## Migration instructions

### Operators

1. **No database migration is required.** Pause state is stored on-chain.
2. Existing deployments get the feature when they are upgraded with `upgrade_contract` to the release WASM. Follow the [contract-upgrade runbook](../runbooks/contract-upgrade.md). On a contract upgraded from before this release, the pause keys are missing at first and read as "not paused", so no initialization call is needed.
3. Check that the admin on each network is the intended multisig or governance account.
4. Rehearse the pause and unpause commands on testnet ([deployment checklist §7.1](./DEPLOYMENT_CHECKLIST.md#71-emergency-pause-reference-procedure)).
5. Remember that **`upgrade_contract` is blocked while paused**. To ship a fix during an incident, submit unpause → upgrade → pause back to back.

### Integrators and SDK users

1. Add the four new error codes to your error decoding, keyed by contract: `InvalidPauseWindow` and `EmergencyPaused` (credit 28/29, marketplace 26/27).
2. Treat `EmergencyPaused` as **retryable later**, not as a permanent failure. Do not auto-retry in a tight loop.
3. If you read contract storage directly, a contract is paused only when `PauseEnabled == true` **and** `PauseUntil > current ledger timestamp`. After expiry the flag can still read `true` until the next write clears it.

## Known issues and workarounds

| Issue | Impact | Workaround |
|---|---|---|
| No events on pause and unpause | The indexer, webhooks and dashboards cannot react to a pause automatically. | Monitor through a synthetic check that reads `PauseEnabled` and `PauseUntil` through RPC and applies the effective check. Follow the admin announcement channel. |
| No `pause_status()` view | Clients cannot ask directly whether a contract is paused. | Read the storage keys through RPC `getLedgerEntries`, or simulate a gated call and look for `EmergencyPaused`. |
| The frontend does not yet map the pause error codes | Users may see a generic error in place of a "temporarily paused" message. | Follow the status announcement. A frontend fix to `carbon-error-codes.ts` is planned. |
| `delist_credits` is also blocked | Sellers cannot withdraw listings during a pause. | Nobody can buy during a pause either, so a listing cannot be filled. Delist after the pause lifts. |
| `upgrade_contract` is blocked while paused | A hotfix upgrade needs a short unpause. | Submit unpause, upgrade and re-pause back to back (deployment checklist §7.2). |
| Pause-state leak in `update_treasury` and `suspend_project` (audit M-1) | A non-admin caller can tell from the error whether the contract is paused. | Low impact, because the state is public on-chain. A fix is tracked in spec §4.6. |
| Registry and oracle contracts cannot be paused | Project registration and oracle submissions continue during a pause. | Use `suspend_project` and `rotate_oracle`, and see the [oracle-failure runbook](../runbooks/oracle-failure.md). |
| No on-chain reason for a pause | The reason is visible only in announcements and off-chain logs. | Operators must record the reason in the incident channel and the audit log. |

## Support

| Need | Contact |
|---|---|
| General questions, integration help | Open a GitHub issue on [Carbon-Ledger-stellar/carbonledger](https://github.com/Carbon-Ledger-stellar/carbonledger/issues) |
| Security vulnerability (report privately) | **security@carbonledger.io**. See [SECURITY.md](../../SECURITY.md). |
| Active incident (internal) | Slack `#oncall` / PagerDuty: Contracts Lead + Security Lead. See [contacts.md](../runbooks/contacts.md). |
| Stellar or Soroban network issues | Stellar Developer Discord `#soroban-help`, support@stellar.org |
