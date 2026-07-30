# CarbonLedger Error Code Reference

All four Soroban contracts share the `CarbonError` enum. When a contract call fails, Stellar returns the error as a `u32` value. This document maps every code to its cause and resolution.

> **Keeping this in sync:** The source of truth is the `CarbonError` enum in each contract's `src/lib.rs`. When a new variant is added, add a row here and update the [frontend mapping](#frontend-error-mapping).

---

## Error Code Table

| Code | Name | Contract(s) | When it occurs |
|------|------|-------------|----------------|
| 1 | `ProjectNotFound` | registry, credit, oracle | Project ID does not exist in storage, or a required string field is empty / too long |
| 2 | `ProjectNotVerified` | registry | Credit minting attempted on a project that is still `Pending` or `Rejected` |
| 3 | `ProjectSuspended` | registry, credit, marketplace | Operation attempted on a project or batch that has been suspended |
| 4 | `InsufficientCredits` | registry, credit | Retirement or transfer amount exceeds the active (non-retired) balance of the batch |
| 5 | `AlreadyRetired` | credit | Retirement or transfer attempted on a batch whose status is `FullyRetired` |
| 6 | `SerialNumberConflict` | credit | A batch with the same `batch_id` already exists in storage |
| 7 | `UnauthorizedVerifier` | registry, marketplace | Caller is not in the verifier list, or is not the contract admin |
| 8 | `UnauthorizedOracle` | registry, oracle | Caller is not the registered oracle address |
| 9 | `InvalidVintageYear` | registry, credit, marketplace, oracle | `vintage_year` is before 1990 or more than one year in the future |
| 10 | `ListingNotFound` | marketplace | Listing ID does not exist, or the listing is `Delisted` / `Sold` |
| 11 | `InsufficientLiquidity` | marketplace | Purchase amount exceeds `amount_available` on the listing |
| 12 | `PriceNotSet` | oracle | No benchmark price exists for the requested methodology + vintage combination, or the cached price has expired (TTL ~24 h) |
| 13 | `MonitoringDataStale` | oracle | `is_monitoring_current` returned false — no monitoring submission in the last 365 days |
| 14 | `DoubleCountingDetected` | credit | The proposed serial range overlaps an already-registered range in the serial registry |
| 15 | `RetirementIrreversible` | credit | An attempt was made to call `undo_retire` — retirements are permanently on-chain and cannot be reversed |
| 16 | `ZeroAmountNotAllowed` | registry, credit, marketplace, oracle | `amount`, `price_per_credit`, or `tonnes_verified` is zero or negative |
| 17 | `ProjectAlreadyExists` | registry | `register_project` called with a `project_id` that is already stored |
| 18 | `InvalidSerialRange` | credit, marketplace | `serial_start` is 0, `serial_end ≤ serial_start`, arithmetic overflow on issued counter, or `bulk_purchase` called with mismatched `listing_ids` / `amounts` lengths |
| 19 | `AlreadyInitialized` | registry, credit, marketplace, oracle | `initialize` called on a contract that has already been initialized |
| 20 | `MethodologyScoreLow` | registry | `methodology_score` is below the minimum of 70 |
| 21 | `UnauthorizedUpgrade` | registry, credit, marketplace, oracle | `upgrade` called by an address that is not the contract admin |
| 22 | `InvalidNonce` | oracle | The `nonce` supplied to a signed oracle call does not match the stored nonce |
| 23 | `InvalidSignature` | oracle | Reserved for future use; ed25519 verification failures currently panic at the host level |

---

## Detailed Reference

### 1 — ProjectNotFound

**When it occurs**
- `get_project`, `verify_project`, `reject_project`, `suspend_project`, or `update_project_status` called with a `project_id` that has never been registered.
- `get_retirement_certificate` called with an unknown `retirement_id`.
- `mint_credits` called with an empty or oversized `project_id`, `batch_id`, or `metadata_cid`.

**Resolution**
- Verify the `project_id` with `get_project` before calling write functions.
- Ensure string fields are non-empty and ≤ 64 characters (`project_id`, `batch_id`, `methodology`, `country`, `project_type`) or ≤ 128 characters (`name`, `metadata_cid`).

---

### 2 — ProjectNotVerified

**When it occurs**
- Credits cannot be minted for a project that is still `Pending` or has been `Rejected`.

**Resolution**
- Call `verify_project` with an authorized verifier address before minting.
- Check `project.status` with `get_project` first.

---

### 3 — ProjectSuspended

**When it occurs**
- `retire_credits` or `transfer_credits` called on a batch whose status is `Suspended`.
- `list_credits` or `purchase_credits` called for a project that has been suspended in the marketplace.

**Resolution**
- Check `project.status` or the marketplace suspension flag before transacting.
- Contact the registry admin to lift the suspension if it was applied in error.

---

### 4 — InsufficientCredits

**When it occurs**
- `retire_credits` amount exceeds the active (non-retired) balance of the batch.
- `transfer_credits` amount exceeds the active balance.
- Registry-level `retire_credits` amount exceeds `total_credits_issued − total_credits_retired`.

**Resolution**
- Query `get_credit_batch` and check `amount` minus already-retired credits.
- Split the operation into smaller amounts.

---

### 5 — AlreadyRetired

**When it occurs**
- `retire_credits` or `transfer_credits` called on a batch with status `FullyRetired`.

**Resolution**
- Check `batch.status` before attempting retirement or transfer.
- Use `get_credit_batch` to confirm remaining active balance.

---

### 6 — SerialNumberConflict

**When it occurs**
- `mint_credits` called with a `batch_id` that already exists in storage.

**Resolution**
- Use a unique `batch_id` for every mint operation (e.g., `{project_id}-{vintage}-{sequence}`).

---

### 7 — UnauthorizedVerifier

**When it occurs**
- `verify_project` or `reject_project` called by an address not in the verifier list.
- `suspend_project`, `register_project`, `upgrade`, or admin-only marketplace functions called by a non-admin address.
- `transfer_credits` called by an address that is not the batch owner.

**Resolution**
- Confirm the caller's address is registered as a verifier via `get_verifiers`.
- Admin operations require the address passed to `initialize` as `admin`.
- For transfers, the `from` address must be the current `batch.owner`.

---

### 8 — UnauthorizedOracle

**When it occurs**
- `submit_monitoring_data`, `update_credit_price`, or `flag_project` called by an address that is not the registered oracle.
- `update_project_status` or `increment_issued` called by a non-oracle address.

**Resolution**
- Only the oracle service account (set during `initialize`) may call these functions.
- Use `rotate_oracle` (admin only) to update the oracle address if it has changed.

---

### 9 — InvalidVintageYear

**When it occurs**
- `vintage_year < 1990` or `vintage_year > current_year + 1` in `register_project`, `mint_credits`, `list_credits`, or `update_credit_price`.

**Resolution**
- Use a vintage year between 1990 and next calendar year (inclusive).
- The contract derives the current year from the ledger timestamp.

---

### 10 — ListingNotFound

**When it occurs**
- `purchase_credits` or `delist_credits` called with a `listing_id` that does not exist.
- `purchase_credits` called on a listing with status `Delisted` or `Sold`.

**Resolution**
- Verify the listing exists and is active with `get_listing` before purchasing.
- Refresh the listing state — it may have sold between your query and your transaction.

---

### 11 — InsufficientLiquidity

**When it occurs**
- `purchase_credits` or `bulk_purchase` amount exceeds `listing.amount_available`.

**Resolution**
- Query `get_listing` for the current `amount_available` immediately before purchasing.
- Reduce the purchase amount or split across multiple listings.

---

### 12 — PriceNotSet

**When it occurs**
- `get_benchmark_price` called for a methodology + vintage combination that has never been submitted, or whose cached price has expired (TTL ≈ 24 hours / 17,280 ledgers).

**Resolution**
- The oracle service must call `update_credit_price` to refresh the price.
- Treat a missing price as "price unavailable" in the UI rather than blocking the user.

---

### 13 — MonitoringDataStale

**When it occurs**
- `is_monitoring_current` returns `false` when no monitoring data has been submitted for a project in the last 365 days.

**Resolution**
- The oracle service must submit fresh monitoring data via `submit_monitoring_data`.
- Projects with stale monitoring should be flagged in the UI as "monitoring overdue."

---

### 14 — DoubleCountingDetected

**When it occurs**
- `mint_credits` called with a serial range (`serial_start`–`serial_end`) that overlaps any previously registered range.

**Resolution**
- Call `verify_serial_range` before minting to confirm the range is free.
- Assign serial numbers sequentially from the last registered `serial_end + 1`.

---

### 15 — RetirementIrreversible

**When it occurs**
- Any attempt to call `undo_retire` on a retirement record.

**Resolution**
- Retirements are permanent by design. There is no resolution — this is the intended behavior.
- Display a clear confirmation dialog before submitting a retirement transaction.

---

### 16 — ZeroAmountNotAllowed

**When it occurs**
- `amount ≤ 0` in `mint_credits`, `retire_credits`, `transfer_credits`, `list_credits`, `purchase_credits`, or `bulk_purchase`.
- `price_per_credit ≤ 0` in `list_credits`.
- `tonnes_verified ≤ 0` in `submit_monitoring_data`.
- `price_usdc ≤ 0` in `update_credit_price`.

**Resolution**
- Validate all numeric inputs client-side before submitting a transaction.

---

### 17 — ProjectAlreadyExists

**When it occurs**
- `register_project` called with a `project_id` that is already stored.

**Resolution**
- Use `get_project` to check for existence before registering.
- Choose a unique `project_id` (e.g., include a registry prefix and sequence number).

---

### 18 — InvalidSerialRange

**When it occurs**
- `mint_credits` called with `serial_start == 0` or `serial_end ≤ serial_start`.
- `increment_issued` would overflow `i128`.
- `bulk_purchase` called with `listing_ids.len() != amounts.len()` or more than 10 entries.

**Resolution**
- Serial ranges must start at 1 and `serial_end` must be strictly greater than `serial_start`.
- For bulk purchases, ensure the two arrays have equal length and contain at most 10 items.

---

### 19 — AlreadyInitialized

**When it occurs**
- `initialize` called on a contract that already has an admin stored.

**Resolution**
- `initialize` is a one-time setup call. Do not call it again after deployment.

---

### 20 — MethodologyScoreLow

**When it occurs**
- `register_project` called with `methodology_score < 70`.

**Resolution**
- The minimum accepted methodology score is 70 out of 100.
- See [Carbon Methodology Reference](CARBON_METHODOLOGY_REFERENCE.md) for the scoring rubric.

---

### 21 — UnauthorizedUpgrade

**When it occurs**
- `upgrade` called by an address that is not the contract admin.

**Resolution**
- Only the admin address set during `initialize` may upgrade the contract WASM.

---

### 22 — InvalidNonce

**When it occurs**
- Oracle signed calls (`submit_monitoring_data`, `update_credit_price`, `flag_project`) submitted with a `nonce` that does not match the stored nonce counter.

**Resolution**
- Read the current nonce from contract storage before signing.
- Nonces increment by 1 after each successful call; replay attacks are rejected.
- After `rotate_oracle`, the nonce resets to 0.

---

### 23 — InvalidSignature

**When it occurs**
- Reserved. Ed25519 verification failures in the current implementation cause a host-level panic rather than returning this code.

**Resolution**
- Ensure the oracle signs the exact XDR-serialized payload with the registered Ed25519 key.

---

## Frontend Error Mapping

Map the raw `u32` error code from a failed Soroban invocation to a user-facing message:

```typescript
// lib/contract-errors.ts

export const CONTRACT_ERRORS: Record<number, { title: string; message: string }> = {
  1:  { title: "Not Found",              message: "The requested project or credit batch does not exist." },
  2:  { title: "Project Not Verified",   message: "This project has not been verified yet. Credits cannot be issued." },
  3:  { title: "Project Suspended",      message: "This project is currently suspended. Transactions are paused." },
  4:  { title: "Insufficient Credits",   message: "Not enough active credits in this batch for the requested amount." },
  5:  { title: "Already Retired",        message: "These credits have already been fully retired." },
  6:  { title: "Batch ID Conflict",      message: "A credit batch with this ID already exists." },
  7:  { title: "Unauthorized",           message: "Your account is not authorized to perform this action." },
  8:  { title: "Unauthorized Oracle",    message: "Only the registered oracle may submit this data." },
  9:  { title: "Invalid Vintage Year",   message: "Vintage year must be between 1990 and next year." },
  10: { title: "Listing Not Found",      message: "This listing is no longer available." },
  11: { title: "Insufficient Liquidity", message: "Not enough credits available in this listing." },
  12: { title: "Price Unavailable",      message: "No benchmark price is set for this credit type. Try again later." },
  13: { title: "Monitoring Overdue",     message: "This project's monitoring data is more than 365 days old." },
  14: { title: "Double Counting",        message: "These serial numbers are already assigned to another batch." },
  15: { title: "Retirement Permanent",   message: "Retirements are irreversible on-chain and cannot be undone." },
  16: { title: "Invalid Amount",         message: "Amount and price must be greater than zero." },
  17: { title: "Project Already Exists", message: "A project with this ID is already registered." },
  18: { title: "Invalid Serial Range",   message: "Serial range is invalid, or bulk purchase arrays have mismatched lengths." },
  19: { title: "Already Initialized",    message: "This contract has already been set up." },
  20: { title: "Methodology Score Low",  message: "Methodology score must be at least 70 to register a project." },
  21: { title: "Unauthorized Upgrade",   message: "Only the contract admin may perform upgrades." },
  22: { title: "Invalid Nonce",          message: "Oracle nonce mismatch. Fetch the current nonce and retry." },
  23: { title: "Invalid Signature",      message: "Oracle signature verification failed." },
};

export function getContractError(code: number) {
  return CONTRACT_ERRORS[code] ?? {
    title: "Unknown Error",
    message: `Contract returned error code ${code}.`,
  };
}
```

**Usage in a transaction handler:**

```typescript
import { getContractError } from "@/lib/contract-errors";

try {
  await contract.retire_credits(...);
} catch (err) {
  // Soroban SDK surfaces the error code as err.code or inside err.message
  const code = parseContractErrorCode(err); // your SDK extraction helper
  const { title, message } = getContractError(code);
  toast.error(title, { description: message });
}
```

---

## API Response Examples

The backend wraps contract errors in a standard envelope. Each example shows the HTTP response a frontend receives.

### Error 1 — ProjectNotFound

```json
{
  "statusCode": 404,
  "error": "ProjectNotFound",
  "contractErrorCode": 1,
  "message": "Project 'proj-xyz' does not exist."
}
```

### Error 3 — ProjectSuspended

```json
{
  "statusCode": 403,
  "error": "ProjectSuspended",
  "contractErrorCode": 3,
  "message": "Project 'proj-001' is suspended. Contact the registry admin."
}
```

### Error 4 — InsufficientCredits

```json
{
  "statusCode": 422,
  "error": "InsufficientCredits",
  "contractErrorCode": 4,
  "message": "Requested 500 credits but only 200 are active in batch 'batch-001'."
}
```

### Error 10 — ListingNotFound

```json
{
  "statusCode": 404,
  "error": "ListingNotFound",
  "contractErrorCode": 10,
  "message": "Listing 'list-abc' is no longer available (sold or delisted)."
}
```

### Error 11 — InsufficientLiquidity

```json
{
  "statusCode": 422,
  "error": "InsufficientLiquidity",
  "contractErrorCode": 11,
  "message": "Requested 150 credits but listing 'list-001' only has 80 available."
}
```

### Error 14 — DoubleCountingDetected

```json
{
  "statusCode": 409,
  "error": "DoubleCountingDetected",
  "contractErrorCode": 14,
  "message": "Serial range 50–150 overlaps an existing batch. Minting rejected."
}
```

### Error 16 — ZeroAmountNotAllowed

```json
{
  "statusCode": 400,
  "error": "ZeroAmountNotAllowed",
  "contractErrorCode": 16,
  "message": "Amount must be greater than zero."
}
```

### Error 22 — InvalidNonce

```json
{
  "statusCode": 400,
  "error": "InvalidNonce",
  "contractErrorCode": 22,
  "message": "Oracle nonce 5 does not match expected nonce 3. Fetch current nonce and retry."
}
```

---

## Sync Checklist

When modifying the `CarbonError` enum in any contract:

1. Add or update the row in the [Error Code Table](#error-code-table).
2. Add or update the [Detailed Reference](#detailed-reference) section.
3. Add or update the entry in the [Frontend Error Mapping](#frontend-error-mapping) `CONTRACT_ERRORS` object.
4. Add an [API Response Example](#api-response-examples) if the error is user-facing.
5. Update the error count in the README contract table if the total changes.
