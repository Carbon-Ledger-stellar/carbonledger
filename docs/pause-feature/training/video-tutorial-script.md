# Emergency Pause: Admin Video Tutorial (Script)

Recording script for a **~8-minute** screen-capture tutorial for admins. It
follows [admin-training-guide.md](admin-training-guide.md). Everything shown
runs against **testnet**.

## Production notes

- **Recording:** terminal (large font, ≥ 18 pt, dark theme) plus a browser tab
  on a testnet explorer (e.g. stellar.expert/explorer/testnet). 1080p.
- **Setup before recording:**
  - a testnet deployment of `carbon_credit` + `carbon_marketplace`
  - one minted batch and one active listing
  - a funded, non-admin "buyer" account with testnet USDC
- **Secrets:** use a throwaway testnet admin key, and never show a mainnet
  key. Export keys before recording so `S...` values never appear on screen.
- **Shell variables:** `NETWORK`, `ADMIN_PUBLIC_KEY`, `ADMIN_SECRET_KEY`,
  `BUYER_SECRET_KEY`, `BUYER_PUBLIC_KEY`, `CARBON_CREDIT_CONTRACT_ID`,
  `CARBON_MARKETPLACE_CONTRACT_ID`.
- **Captions:** export an `.srt` from the narration below. Publish the video
  next to this file, or link it from [README.md](README.md).

---

## Scene 1: Intro (0:00–0:40)

**On screen:** title card "Emergency Pause for CarbonLedger Admins".

**Narration:**
> CarbonLedger's credit and marketplace contracts have an emergency pause. It
> stops every state-changing action for a limited time while we deal with an
> incident, without touching anyone's credits or funds. In the next eight
> minutes you'll see when to use it, how to pause and unpause, how to check
> whether a contract is paused, and the two mistakes that catch people out.

## Scene 2: What a pause does (0:40–1:50)

**On screen:** the "Blocked while paused" table from the training guide.
Highlight each column as it's mentioned.

**Narration:**
> There are two separate switches: one on the credit contract and one on the
> marketplace. A paused credit contract blocks minting, retiring, and
> transferring. A paused marketplace blocks listing, delisting, and buying.
> Reads always keep working.
>
> A pause always has an end time, at most 72 hours ahead. When it passes, the
> contract unpauses on its own. You can renew a pause as many times as needed.
>
> Important: marketplace purchases call the credit contract. If you pause only
> the credit contract, purchases fail too, but with a confusing error. So when
> in doubt, pause both.

## Scene 3: When to pause (1:50–2:40)

**On screen:** the "Pause / Don't pause" table.

**Narration:**
> Pause when letting transactions continue could cause irreversible harm: a
> suspected exploit, credits that shouldn't exist, unexpected outflows, or a
> compromised key. Don't pause for a single failed transaction or a website
> outage. The contracts are fine then.
>
> If you're unsure during a live incident, pause for an hour or two. You can
> always extend.

## Scene 4: Pausing (2:40–4:10)

**On screen:** terminal.

```bash
UNTIL=$(( $(date +%s) + 2*3600 ))
date -u -d "@$UNTIL"
```

**Narration:**
> First, pick the end time in Unix seconds. Here it's two hours from now.
> Always check it in human-readable UTC before you submit.

```bash
stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  pause_operations --admin "$ADMIN_PUBLIC_KEY" --until_timestamp "$UNTIL"

stellar contract invoke --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  pause_operations --admin "$ADMIN_PUBLIC_KEY" --until_timestamp "$UNTIL"
```

**Narration:**
> Pause the marketplace, then the credit contract. Copy each transaction hash
> into the incident channel along with the time, the end time, and the reason.

**On screen:** open one transaction hash in the explorer and show it succeeded.

## Scene 5: Checking status and the user experience (4:10–5:20)

**On screen:** terminal.

```bash
stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" --send=no -- \
  cleanup_expired_listings --admin "$ADMIN_PUBLIC_KEY"
```

**Narration:**
> There's no "is paused" query, so we simulate a harmless admin call without
> sending it. Error 27 means the marketplace is paused. On the credit
> contract, we simulate `migrate_serial_index` with limit zero: 29 means
> paused, 16 means not paused.

```bash
stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$BUYER_SECRET_KEY" --network "$NETWORK" -- \
  purchase_credits --buyer "$BUYER_PUBLIC_KEY" --listing_id list-001 --amount 1
```

**Narration:**
> Here's what a buyer sees: the same error 27. Their USDC is untouched. A
> failed transaction isn't applied at all. Now's the time to post the user
> announcement; the template is in the training guide.

## Scene 6: Extending, and the 72-hour limit (5:20–6:10)

**On screen:** terminal.

```bash
UNTIL=$(( $(date +%s) + 73*3600 ))
stellar contract invoke ... pause_operations --admin "$ADMIN_PUBLIC_KEY" --until_timestamp "$UNTIL"
# → Error(Contract, #26)
```

**Narration:**
> To extend, just pause again with a new end time. It replaces the old one.
> But you can't go past 72 hours from now: that's error 26 on the
> marketplace, 28 on credit. For a maximum-length pause, use 71 hours to leave
> room for clock differences.

## Scene 7: The two common mistakes (6:10–7:00)

**On screen:** two bullet cards.

**Narration:**
> Mistake one: pausing only the credit contract and forgetting the
> marketplace. Purchases then fail with an unhelpful abort instead of a clear
> "paused" error. Pause both.
>
> Mistake two: pausing before you've planned your upgrade. Contract upgrades
> are blocked while paused. If you're going to deploy a fix, have the upgrade
> ready, then do a short unpause, upgrade, and re-pause back-to-back. See the
> troubleshooting guide.

## Scene 8: Unpausing (7:00–7:40)

**On screen:** terminal.

```bash
stellar contract invoke --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  unpause_operations --admin "$ADMIN_PUBLIC_KEY"

stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" -- \
  unpause_operations --admin "$ADMIN_PUBLIC_KEY"
```

Re-run the buyer purchase and show it succeeds.

**Narration:**
> When the issue is contained, unpause straight away. Don't wait for the
> timer. Credit first, then the marketplace. Check status, record the hashes,
> and post the "resolved" update.

## Scene 9: Wrap-up (7:40–8:00)

**On screen:** links to the training guide, troubleshooting, and FAQ.

**Narration:**
> That's the emergency pause. Before your first on-call shift, run the
> practice exercise at the end of the admin training guide on testnet. Thanks
> for watching.
