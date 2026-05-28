# Storage TTL Extension — Cost Notes

## Configuration

`TTL_LEDGERS = 518_400` (~30 days at 5 s/ledger)

Both `carbon_credit` and `carbon_marketplace` call `extend_ttl` on every read
**and** write to persistent entries (`CreditBatch`, `MarketListing`).

## Cost per extension

Soroban charges a rent fee proportional to the number of ledgers extended and
the byte-size of the entry. Approximate figures on Stellar Testnet / Mainnet:

| Entry type      | Approx size | Fee per 30-day extension |
|-----------------|-------------|--------------------------|
| `CreditBatch`   | ~300 bytes  | ~0.00001 XLM             |
| `MarketListing` | ~350 bytes  | ~0.00001 XLM             |

These fees are paid by the transaction submitter as part of the resource fee.

## Expiry behaviour

If a batch or listing is **not** accessed within the TTL window it will be
evicted from the ledger state. Callers receive `CarbonError::ProjectNotFound`
(batch) or `CarbonError::ListingNotFound` (listing) — never a panic.

Evicted entries can be restored via `restore_footprint` if the historical
ledger data is still available in the archive.
