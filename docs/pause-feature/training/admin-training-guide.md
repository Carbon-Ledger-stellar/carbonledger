# Emergency Pause: Admin Training Guide

**Audience:** CarbonLedger admins who hold the admin key for the
`carbon_credit` or `carbon_marketplace` contract.

**Goal:** after this guide you can decide when to pause, pause and unpause
both contracts, check pause status, and avoid the common mistakes.

**Time:** about 30 minutes, including the testnet exercise at the end.

---

## 1. What the pause does

The emergency pause is a time-limited "stop" switch built into two
contracts. While a contract is paused, every state-changing function on it
fails with `EmergencyPaused`. Reads keep working, and nothing is lost or rolled back.

| | `carbon_credit` | `carbon_marketplace` |
|---|---|---|
| Pause | `pause_operations(admin, until_timestamp)` | `pause_operations(admin, until_timestamp)` |
| Unpause | `unpause_operations(admin)` | `unpause_operations(admin)` |
| Who may call | any address holding `Role::Admin` | the address set as admin at `initialize` |
| Error while paused | `EmergencyPaused` = **#29** | `EmergencyPaused` = **#27** |
| Bad window | `InvalidPauseWindow` = **#28** | `InvalidPauseWindow` = **#26** |
| Not an admin | `UnauthorizedVerifier` = **#7** | `UnauthorizedVerifier` = **#7** |

`carbon_registry` and `carbon_oracle` have **no** pause. To contain those,
use the steps in [contract-exploit.md](../../runbooks/contract-exploit.md),
such as suspending projects or freezing the oracle key.

### Blocked while paused

| `carbon_credit` | `carbon_marketplace` |
|---|---|
| `mint_credits` | `list_credits` |
| `retire_credits` | `delist_credits` |
| `transfer_credits` | `purchase_credits` |
| `undo_retire` | `bulk_purchase` |
| `set_oracle_contract` | `suspend_project` |
| `set_verified_periods` | `set_fee_rate` |
| `set_vintage_year_bounds` | `update_treasury` |
| `set_max_history_entries` | `set_vintage_year_bounds` |
| `migrate_serial_index` | `set_sweep_threshold` |
| `upgrade_contract` | `sweep_fees` |
| | `cleanup_expired_listings` |
| | `upgrade_contract` |

### Still available while paused

- All read-only `get_*` / query functions
- `pause_operations`, used to extend or shorten the window
- `unpause_operations`
- `grant_role` / `revoke_role` on `carbon_credit`, so you can remove a compromised admin while paused

### How the two contracts interact

- `purchase_credits` and `bulk_purchase` call `carbon_credit.transfer_credits`.
  **Pausing only the credit contract therefore also stops marketplace purchases.**
  The purchase fails as an aborted cross-contract call, not a clean `#27`/`#29`
  error, so it's harder to recognise. The whole transaction rolls back and the
  buyer is not charged. Listing and delisting still work.
- Pausing only the marketplace does **not** stop direct `transfer_credits` or
  `retire_credits` on the credit contract.
- To freeze all credit movement, pause **both**.

---

## 2. The time window

Every pause has an end time (`until_timestamp`, Unix seconds). The contract rejects it
with `InvalidPauseWindow` unless:

```
ledger_now < until_timestamp <= ledger_now + 72 hours
```

- **No indefinite pauses.** 72 hours is the maximum, so an admin can't
  freeze user funds forever.
- **Renew by pausing again.** Calling `pause_operations` while paused replaces
  the end time, which can extend or shorten the window. Each call can reach at
  most 72 h from *that* moment.
- **Expiry is automatic but lazy.** Once the end time passes, the next
  state-changing call succeeds and clears the pause. No one needs to call
  `unpause_operations`. Until that call happens, storage still says "paused",
  but the contract behaves as unpaused.
- **Use ledger time, not your laptop clock.** The contract compares against the
  ledger close time, which can differ from your clock by a few seconds. Leave a
  margin: request **71 h or less** for a "maximum" pause.

---

## 3. When to pause

Pause when **continuing to accept transactions could cause irreversible harm**,
and the harm is worse than a temporary outage for every user.

| Pause | Don't pause |
|---|---|
| Active or suspected exploit of credit or marketplace logic | A single failed transaction or user error |
| Credits minted or transferred that shouldn't exist (double counting, serial conflicts at abnormal rates) | Frontend or backend outage; the contracts are fine |
| Admin, treasury, or oracle key suspected compromised | Oracle price is stale (the marketplace circuit breaker handles price deviation) |
| Unexpected USDC outflows from the marketplace | A problem that only affects `carbon_registry` or `carbon_oracle` (they have no pause) |

**If in doubt during an active incident, pause for a short window (e.g. 1–2 h),
then extend if needed.** A short, renewable pause is cheaper than a long one.

**Plan upgrades before you pause.** `upgrade_contract` is blocked while paused,
so a patched Wasm can't be deployed to a paused contract. See
[troubleshooting.md § Upgrading during a pause](troubleshooting.md#i-need-to-upgrade-the-contract-but-its-paused).

---

## 4. Procedures

The examples use the Stellar CLI and the variables from
[MAINNET_DEPLOYMENT.md](../../MAINNET_DEPLOYMENT.md):

```bash
export NETWORK=testnet            # or mainnet (also set --rpc-url / --network-passphrase)
export ADMIN_PUBLIC_KEY=G...
export ADMIN_SECRET_KEY=S...      # prefer a hardware wallet / secret manager
export CARBON_CREDIT_CONTRACT_ID=C...
export CARBON_MARKETPLACE_CONTRACT_ID=C...
```

### 4.1 Pause

```bash
# 1. Pick the end time (here: 2 hours from now)
UNTIL=$(( $(date +%s) + 2*3600 ))
date -u -d "@$UNTIL"               # sanity-check the human-readable time

# 2. Pause the marketplace
stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  pause_operations --admin "$ADMIN_PUBLIC_KEY" --until_timestamp "$UNTIL"

# 3. Pause the credit contract (if freezing all credit movement)
stellar contract invoke --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  pause_operations --admin "$ADMIN_PUBLIC_KEY" --until_timestamp "$UNTIL"
```

Then:

1. **Record** the transaction hashes, UTC time, `UNTIL`, contracts, and reason
   in the incident channel.
2. **Verify** with §4.3.
3. **Announce** to users through the status page or social channels. Use the
   template in §6.

### 4.2 Extend or shorten

Run the same `pause_operations` command with a new `UNTIL`. The new value
replaces the old one, and must be at most 72 h from now.

### 4.3 Check whether a contract is paused

There is no read-only "is paused" function. Instead, **simulate** a harmless
admin call without submitting it (`--send=no`):

```bash
# Credit contract: limit 0 is always rejected, but only after the pause check
stellar contract invoke --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" --send=no -- \
  migrate_serial_index --admin "$ADMIN_PUBLIC_KEY" --limit 0

# Marketplace: simulate the expired-listing cleanup
stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" --send=no -- \
  cleanup_expired_listings --admin "$ADMIN_PUBLIC_KEY"
```

| Contract | Paused | Not paused (or window expired) |
|---|---|---|
| credit | `Error(Contract, #29)` | `Error(Contract, #16)`: the pause check passed, then `limit 0` was rejected |
| marketplace | `Error(Contract, #27)` | a number: the listings that would be cleaned up |

Both checks are safe even if accidentally submitted. The credit call never
changes state, and the marketplace call is routine maintenance.

### 4.4 Unpause

Unpause as soon as the cause is contained and verified. **Don't wait for the
window to expire.**

```bash
stellar contract invoke --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  unpause_operations --admin "$ADMIN_PUBLIC_KEY"

stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  unpause_operations --admin "$ADMIN_PUBLIC_KEY"
```

Unpause the **credit contract first**. Marketplace purchases depend on it, so
this order avoids a window where listings reopen but purchases fail.

Then verify with §4.3, record the hashes, and post the "resolved" update.

---

## 5. Checklist

**Before pausing**
- [ ] The situation meets a "Pause" row in §3
- [ ] Decided which contract(s) to pause (see "How the two contracts interact")
- [ ] If a contract upgrade will be needed, planned it (upgrades are blocked while paused)
- [ ] Incident channel open, UTC time recorded

**Pausing**
- [ ] `UNTIL` computed and checked with `date -u`; at most 71 h ahead
- [ ] `pause_operations` submitted on each contract; tx hashes recorded
- [ ] Status verified with the simulation in §4.3
- [ ] Users notified

**While paused**
- [ ] Reminder set well before `UNTIL` to decide: extend, unpause, or let it expire
- [ ] Anyone with a compromised key has had their role revoked (`revoke_role` works while paused)

**Unpausing**
- [ ] Root cause contained and verified
- [ ] Credit contract unpaused first, then marketplace
- [ ] Status verified, tx hashes recorded, users notified
- [ ] Post-mortem scheduled

---

## 6. User announcement templates

**Paused**
> Trading on CarbonLedger is temporarily paused while we investigate
> [a technical issue / unusual activity]. Your credits and funds are safe and
> unchanged. Listings, purchases, transfers and retirements will resume by
> [UNTIL, UTC] at the latest. We'll post an update here by [time].

**Resumed**
> CarbonLedger is fully operational again. All actions are available. Any
> transaction that failed during the pause can be retried; it was never
> executed, so nothing was charged.

---

## 7. Practice exercise (testnet)

Do this once with a testnet deployment before you are on call:

1. Pause the marketplace for 10 minutes.
2. From a *non-admin* account, try `purchase_credits`. You should get `Error(Contract, #27)`.
3. Run the status check (§4.3). You should get #27.
4. Extend the pause to 20 minutes, then shorten it to 5 minutes.
5. Try pausing with `UNTIL = now + 73h`. You should get `Error(Contract, #26)`.
6. From a non-admin account, try `unpause_operations`. You should get `Error(Contract, #7)`.
7. Wait for the 5-minute window to pass without unpausing, then run the status check again. It should return a number: the pause expired on its own.
8. Pause the **credit** contract only, then try a marketplace purchase. It should fail as an aborted cross-contract call, and the buyer's USDC balance should be unchanged. Then create a listing: that still works.
9. Unpause everything and confirm a purchase succeeds.

Related: [troubleshooting.md](troubleshooting.md) ·
[user-faq.md](user-faq.md) ·
[contract-exploit.md](../../runbooks/contract-exploit.md) ·
[key-compromise.md](../../runbooks/key-compromise.md)
