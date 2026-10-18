# CarbonLedger Error Code Reference

All four Soroban contracts share the `CarbonError` enum. When a contract call fails, Stellar returns the error as a `u32` value. This document maps every code to its cause and resolution.

> **Keeping this in sync:** The source of truth is the `CarbonError` enum in each contract's `src/lib.rs`. When a new variant is added, add a row here and update the [frontend mapping](#frontend-error-mapping).

---

## HTTP Error Response Format

All backend controllers return errors through a single global exception filter. Every error response has the same JSON shape, regardless of which controller or service produced it:

```json
{
  "code": "PROJECT_NOT_FOUND",
  "message": "Project not found",
  "details": null,
  "requestId": "3f9c1a2e-8b7d-4c6e-9a1f-2d5e7b0c4a83"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | `string` | Stable, machine-readable error code (see table below). Clients should branch on this value, not on `message`. |
| `message` | `string` | Human-readable summary safe to display to end users. |
| `details` | `object \| array \| null` | Optional structured context (e.g. field-level validation errors). `null` when there is nothing to add. |
| `requestId` | `string` | Correlation ID for the request, echoed from the `X-Request-Id` header (or generated when absent). Include it in bug reports. |

### HTTP Error Codes

| Code | HTTP Status | When it occurs |
|------|-------------|----------------|
| `VALIDATION_ERROR` | 400 | Request body, query, or params failed validation. `details` contains the field errors. |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication credentials. |
| `FORBIDDEN` | 403 | Authenticated caller lacks permission for the resource. |
| `NOT_FOUND` | 404 | The requested resource does not exist. |
| `CONFLICT` | 409 | The request conflicts with current resource state (e.g. duplicate). |
| `RATE_LIMITED` | 429 | Too many requests; retry after the interval indicated by `Retry-After`. |
| `INTERNAL_ERROR` | 500 | Unexpected server error. `message` is generic; use `requestId` to trace logs. |
| `SERVICE_UNAVAILABLE` | 503 | A downstream dependency (e.g. Stellar RPC) is unavailable; safe to retry. |

---

## Contract Error Code Table

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
- `get_benchmark_price` called for a methodology + vintage combination that has no cached price, or whose cached price has expired.

**Resolution**
- Trigger a price update via the oracle service, then retry.
- Confirm the methodology + vintage pair is supported.
