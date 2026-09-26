---
marp: true
theme: default
paginate: true
title: Emergency Pause — Admin & Support Training
---

<!--
Render with Marp:
  npx @marp-team/marp-cli docs/pause-feature/training/slides.md -o pause-training.pdf
  npx @marp-team/marp-cli docs/pause-feature/training/slides.md -o pause-training.pptx
Speaker notes are in HTML comments on each slide.
-->

# Emergency Pause

### Admin & support training

CarbonLedger · `carbon_credit` + `carbon_marketplace`

<!-- 20-minute session. Admins: the whole deck. Support staff: slides 1–4, 9–10. -->

---

## What it is

- A **time-limited stop switch** on two contracts
- Blocks every **state-changing** call → `EmergencyPaused`
- **Reads keep working**, nothing is lost or rolled back
- Max **72 hours**, then it **expires on its own**
- `carbon_registry` and `carbon_oracle` have **no** pause

<!-- Stress: a pause is reversible and doesn't change data. It's a brake, not a rollback. -->

---

## What's blocked

| Credit contract (#29) | Marketplace (#27) |
|---|---|
| mint · retire · transfer · undo_retire | list · delist · purchase · bulk_purchase |
| admin setters · upgrade | suspend_project · fees · treasury · sweep · upgrade |

**Still works:** reads · pause/unpause · `grant_role`/`revoke_role` (credit)

<!-- Upgrade being blocked is the surprise for most people. We come back to it on slide 8. -->

---

## The two contracts depend on each other

- Purchases call `carbon_credit.transfer_credits`
- Pause **credit only** → purchases fail with an **abort**, not #27
- Pause **marketplace only** → direct transfers/retirements still work
- **Freeze everything → pause both**

<!-- Verified on testnet: the buyer's USDC is untouched in the credit-only case, but the error is confusing. -->

---

## When to pause

| Pause ✅ | Don't pause ❌ |
|---|---|
| Suspected exploit | One failed transaction |
| Credits that shouldn't exist | Website / API outage |
| Unexpected USDC outflows | Stale oracle price |
| Compromised key | Registry/oracle-only issue |

**Unsure mid-incident?** Pause 1–2 h and extend.

---

## Pausing

```bash
UNTIL=$(( $(date +%s) + 2*3600 )); date -u -d "@$UNTIL"

stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  pause_operations --admin "$ADMIN_PUBLIC_KEY" --until_timestamp "$UNTIL"
```

Repeat for `$CARBON_CREDIT_CONTRACT_ID` · record tx hashes · announce

<!-- until_timestamp is Unix SECONDS. Always check it with date -u. -->

---

## The time window

- `now < until ≤ now + 72h`, otherwise `InvalidPauseWindow` (#28 / #26)
- **Renew:** pause again, and the new end time replaces the old one
- **Maximum pause:** request **71 h** (ledger clock vs your clock)
- **Expiry is lazy:** the next call after `until` succeeds and clears it

---

## Checking status & upgrading

No "is paused" query, so **simulate** with `--send=no`:

| | Paused | Not paused |
|---|---|---|
| credit `migrate_serial_index --limit 0` | #29 | #16 |
| marketplace `cleanup_expired_listings` | #27 | a number |

**`upgrade_contract` is blocked while paused.** Upgrade first, or do
unpause → upgrade → re-pause back-to-back.

---

## Unpausing

1. Root cause contained and verified
2. `unpause_operations`: **credit first**, then marketplace
3. Status check → record hashes → "resolved" announcement
4. Schedule the post-mortem

Don't wait for the timer.

---

## What users see

- `Error(Contract, #27)` / `#29`, not a friendly message (yet)
- **Not charged:** a failed transaction isn't applied
- Balances, listings, certificates unchanged; just **retry** afterwards
- Listing 90-day expiry **keeps running** during a pause

<!-- Support: an error #27/#29 with no announced pause → escalate immediately (possible unauthorized pause). -->

---

## Security

- Only configured admins can pause (#7 otherwise)
- A pause does **not** stop an attacker holding an admin key: they can unpause
- Credit: `revoke_role` still works while paused
- Marketplace admin can only change via upgrade → see the key-compromise runbook

---

## Before your first on-call shift

1. Read the **admin training guide**
2. Watch the **video tutorial**
3. Do the **testnet practice exercise** (9 steps)
4. Bookmark **troubleshooting** and the **user FAQ**

`docs/pause-feature/training/`

<!-- Q&A -->
