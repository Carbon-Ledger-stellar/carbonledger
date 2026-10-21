# Emergency Pause: Troubleshooting

**Audience:** admins operating the pause, and support/on-call engineers
diagnosing errors reported by users.

Error codes differ per contract:

| Error | `carbon_credit` | `carbon_marketplace` |
|---|---|---|
| `UnauthorizedVerifier` (not an admin) | #7 | #7 |
| `InvalidPauseWindow` | #28 | #26 |
| `EmergencyPaused` | #29 | #27 |

---

## Pausing and unpausing

### `pause_operations` fails with #28 / #26 (`InvalidPauseWindow`)

The end time is outside `(ledger_now, ledger_now + 72h]`.

- **Seconds vs milliseconds.** `until_timestamp` is Unix **seconds**.
  `date +%s` is correct; JavaScript `Date.now()` is milliseconds (divide by 1000).
- **End time in the past.** Common when a command is copied from an earlier
  incident. Recompute `UNTIL`.
- **Exactly 72 h.** The ledger clock can lag your machine by a few seconds, so
  `now + 72h` from your clock can land just past the limit. Use 71 h or less.
- **Time-zone mistakes.** Check with `date -u -d "@$UNTIL"`.

### Pause or unpause fails with #7 (`UnauthorizedVerifier`)

The `--admin` address isn't an admin of that contract, or doesn't match the
signing key.

- **Marketplace:** only the single address passed to `initialize` as admin
  can pause.
- **Credit:** any address with `Role::Admin`. Check with the contract's
  `has_role` or `get_role` view, and grant with `grant_role` from an existing
  admin.
- **Mismatched key.** `--source` (the signing key) and `--admin` must be the
  same account. `require_auth` fails otherwise.

### Transaction fails with an auth / signature error before reaching the contract

`--source` has no authority for `--admin`, the account isn't funded, or you're
on the wrong network. Check `--network` / `--rpc-url` / `--network-passphrase`.
A testnet key won't work on mainnet.

### I paused, but users can still transact

- **Wrong contract.** Pausing the marketplace does not stop direct credit
  transfers or retirements. Pause `carbon_credit` too.
- **Wrong contract ID / network.** Compare `--id` with the deployed IDs in the
  environment config.
- **Window already over.** If `UNTIL` was only minutes ahead, the pause may
  have expired. Run the status check in
  [admin-training-guide.md §4.3](admin-training-guide.md#43-check-whether-a-contract-is-paused).
- **Registry/oracle actions.** `carbon_registry` and `carbon_oracle` can't be paused.

### The pause ended without anyone unpausing

Expected: pauses expire at `until_timestamp`. If the investigation isn't
finished, call `pause_operations` again with a new end time. It works whether
or not the contract is currently paused. Set a reminder before each expiry.

### Status check says "paused" after I unpaused

- You checked the other contract. Each is paused and unpaused separately.
- The unpause transaction failed. Check its result on a block explorer.
- You're simulating against a lagging RPC node. Wait a ledger (~5 s) and retry.

---

## While paused

### I need to upgrade the contract but it's paused

`upgrade_contract` is itself blocked while paused. Options:

1. **Upgrade first, then pause.** If the fix is ready, upgrade while the
   contract is live and pause right after if needed.
2. **Short unpause window.** Unpause, upgrade in the next transaction, and
   re-pause if required. Prepare all three commands in advance and run them
   back-to-back.
3. **Deploy new contracts.** For a severe exploit, follow Recovery in
   [contract-exploit.md](../../runbooks/contract-exploit.md) instead.

Also see [contract-upgrade.md](../../runbooks/contract-upgrade.md).

### I need to change fees, treasury, or suspend a project while paused

These admin setters are blocked while the marketplace is paused:
`set_fee_rate`, `update_treasury`, `suspend_project`, `set_sweep_threshold`,
`sweep_fees`.

- **Suspending a project?** Use `carbon_registry.suspend_project`. The
  registry has no pause.
- **Otherwise:** make the change during a planned short unpause, or right
  after the incident.

### An admin key may be compromised

Pausing does not stop an attacker who holds an admin key. They can unpause.

- **`carbon_credit`:** `grant_role` / `revoke_role` still work while paused.
  From a safe admin account, revoke the compromised address.
- **`carbon_marketplace`:** there is only one admin address, and changing it
  requires an upgrade.

Follow [key-compromise.md](../../runbooks/key-compromise.md).

---

## User-reported errors

### A user sees `Error(Contract, #27)` or `#29`

The marketplace (#27) or credit contract (#29) is paused.

1. Check whether a pause was announced.
2. **Announced:** point the user to the [user FAQ](user-faq.md). They weren't
   charged and can retry after the pause.
3. **Not announced:** treat it as a possible unauthorized pause and escalate
   to the on-call admin immediately.

The frontend has no friendly message for these codes yet
(`frontend/lib/carbon-error-codes.ts`), so users see the raw code.

### Marketplace purchases fail with an "abort" / failed cross-contract call

Most likely the **credit contract is paused while the marketplace is not**.
The marketplace's call to `carbon_credit.transfer_credits` fails, and the whole
transaction rolls back. The buyer isn't charged, but the error doesn't say
"paused". Confirm with the credit status check, then either announce the pause
or pause the marketplace too, so users get the clearer #27.

### Retries still fail after the unpause

- Only one contract was unpaused. Check both.
- The user's app has a stale error state or cached quote. Refresh.
- It's a different error. Look up the code in
  [error-codes.md](../../error-codes.md). Common post-pause cases:
  - an expired listing (the marketplace `ListingExpired`)
  - the listing's `expected_amount` changed (`StaleExpectedAmount`)

### A user asks whether their listing will expire during the pause

Listing expiry (90 days) keeps running during a pause. See the [FAQ](user-faq.md#will-my-listings-still-be-there).
