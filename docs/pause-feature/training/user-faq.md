# Emergency Pause: User FAQ

**Audience:** buyers, sellers, project developers, and support staff answering
their questions.

---

### What is an emergency pause?

A safety switch that lets CarbonLedger temporarily stop activity on the
credit and/or marketplace smart contracts, for example while a suspected
security issue is investigated. Nothing is deleted or reversed; activity is
simply put on hold.

### Are my credits and funds safe?

Yes. A pause only **stops new transactions**. Your credit balances, retirement
certificates, listings, and USDC stay exactly as they were, and everything is
still visible on-chain and in the app.

### What can't I do during a pause?

| If the **marketplace** is paused | If the **credit contract** is paused |
|---|---|
| Buy credits (single or bulk) | Buy credits on the marketplace |
| Create or remove listings | Transfer credits to another account |
| | Retire credits |
| | Receive newly issued credits |

You can still **view** everything: projects, balances, listings, retirement
certificates, and history.

### I tried to buy or retire and got an error. Was I charged?

**No.** On Stellar, a transaction that fails is not applied at all. This
includes a purchase whose USDC payment step would have run before the failure.
You only pay the small network fee for submitting the transaction.

### What does the error look like?

The app may show a generic contract error rather than a friendly "paused"
message. Look for:

| You see | Meaning |
|---|---|
| `Error(Contract, #27)` | The marketplace is paused |
| `Error(Contract, #29)` | The credit contract is paused |
| A failed purchase that mentions a cross-contract call or "abort" | Probably the credit contract is paused while the marketplace is open |

If you see one of these, check the CarbonLedger status page or announcements
before contacting support.

### How long will it last?

**At most 72 hours** from when an admin last set it; the contract enforces this
limit. Admins usually pause for much less and lift the pause as soon as the
issue is resolved. The announcement will say when trading is expected to resume.

Admins can renew a pause while an investigation continues. Each renewal is
again capped at 72 hours and should be announced.

### Do I need to do anything when it ends?

No. Just **retry** what you were doing. Nothing you attempted during the pause
went through, so there is nothing to cancel and nothing will run twice.

### Will my listings still be there?

Yes. Listings stay in place with the same price and amount. However, listings
expire 90 days after creation, and **that clock keeps running during a pause**.
If your listing was close to expiring, check it after the pause.

### Can a pause change prices or my balances?

No. A pause changes no data except the pause flag itself.

### Who can pause, and why should I trust it?

Only the configured admin address(es) of each contract can pause. The
72-hour limit is enforced by the contract itself, so no admin can freeze the
platform indefinitely. Every pause and unpause is a public, on-chain
transaction that anyone can verify.

### Does a pause affect project registration or verification?

No. `carbon_registry` (projects and verification) and `carbon_oracle` (prices
and monitoring data) have no pause switch and keep working. Credits can't be
**issued** while the credit contract is paused, though.

### Where do I get updates?

The CarbonLedger status page and official announcement channels. Support can
tell you whether a pause is active but can't lift it early.

---

**For support staff:** if a user reports errors #27 or #29 and there is **no**
announced pause, escalate to the on-call admin. An unexpected pause may mean
the admin key was used without authorization; see
[key-compromise.md](../../runbooks/key-compromise.md). For troubleshooting,
see [troubleshooting.md](troubleshooting.md).
