# Vintage Year Validation Specification

## Constants

| Constant | Value | Description |
|---|---:|---|
| `DEFAULT_MIN_VINTAGE_YEAR` | 1990 | Minimum acceptable vintage year unless governance overrides it. |
| `DEFAULT_MAX_VINTAGE_YEAR` | current ledger year | Maximum acceptable vintage year unless governance overrides it. |
| `MAX_VINTAGE_AGE_YEARS` | 30 | Credits older than 30 years are considered expired. |

Governance can override the active window with `set_vintage_year_bounds(min_year, max_year)` in both the credit and marketplace contracts. The bounds are stored on-chain and used by both mint/list validation and the bulk-purchase consistency check.

## Enforcement Points

### `mint_credits()`
Validates at issuance time:
```
min_year <= vintage_year <= max_year
```
where `min_year` defaults to 1990 and `max_year` defaults to the current ledger year. Returns `InvalidVintageYear` if outside this range.

### `transfer_credits()`
Enforces at transfer time:
```
current_year - vintage_year <= MAX_VINTAGE_AGE_YEARS (30)
```
Returns `InvalidVintageYear` if the batch is expired.

### `list_credits()` / `bulk_purchase()`
The marketplace validates listing vintage years with the same on-chain bounds and rejects a bulk purchase if the batch mixes multiple vintage years, preventing a buyer from combining distinct vintages into a single purchase flow.

**Rationale:** Preventing transfers of expired credits blocks them from
re-entering the market after their validity period has lapsed. A buyer
receiving expired credits cannot use them for ESG reporting.

### `retire_credits()`
Enforces at retirement time:
```
current_year - vintage_year <= MAX_VINTAGE_AGE_YEARS (30)
```
Returns `InvalidVintageYear` if the batch is expired.

**Rationale:** Retiring an expired credit would produce a certificate for a
vintage that regulators and standards bodies no longer recognise. The
contract therefore prevents this at the protocol level.

## Derived Field

`get_credit_batch_with_expiry(batch_id)` returns:
```rust
CreditBatchWithExpiry {
    batch: CreditBatch,  // full batch data
    is_expired: bool,    // computed at query time from vintage_year
}
```
This allows frontends and auditors to surface the expiry status without
having to recompute it client-side.

## Boundary Conditions

| Scenario                        | vintage_year | current_year | age | Result  |
|---------------------------------|-------------|-------------|-----|---------|
| age exactly 30                  | 1995        | 2025        | 30  | Valid   |
| age exactly 31                  | 1994        | 2025        | 31  | Expired |
| current year credits            | 2025        | 2025        | 0   | Valid   |
| next year credits               | 2026        | 2025        | -1  | Invalid (mint/list only) |
| far future (2 years ahead)      | 2027        | 2025        | -2  | Invalid (mint/list only) |
| pre-Kyoto                       | 1989        | any         | >35 | Invalid (mint/list only) |
