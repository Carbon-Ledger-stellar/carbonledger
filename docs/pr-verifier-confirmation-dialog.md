# PR: Add Confirmation Dialog Before Irreversible Verifier Actions

**Branch:** `feat/verifier-confirmation-dialog` → `main`  
**Priority:** High | **Effort:** Small

---

## Problem

The Verifier Dashboard fired `approve` and `reject` API calls immediately on button click. Both actions write permanent on-chain attestations — a misclick could approve a fraudulent project or permanently block a legitimate one with no way to undo it.

## Solution

Intercept the button click with a confirmation modal before any network call is made.

- Clicking **Approve** or **Reject** now sets a `pending` state instead of calling the API
- A modal overlay renders with a summary of the project to be acted on
- The verifier must click **Confirm Approval** or **Confirm Rejection** to proceed
- **Cancel** dismisses the modal and returns to the list — no state is lost

## Changes

**`frontend/app/verifier/dashboard/page.tsx`**

- Added `PendingAction` interface `{ project, decision }`
- Added `pending` state; buttons call `setPending(...)` instead of the API directly
- Added `confirmReview()` — the only function that calls the API, invoked from the modal confirm button
- Added modal with project summary (name, ID, methodology, country, submitted date, action) and permanent-action warning
- Confirm buttons are `onClick` only — Enter key cannot accidentally trigger submission
- Removed unused `useEffect` import

## Acceptance Criteria

| Criteria | Status |
|---|---|
| Confirmation dialog shown before submitting | ✅ |
| Dialog displays a summary of the record | ✅ |
| Requires explicit confirmation click (not Enter) | ✅ |
| Cancellable without losing form data | ✅ |

## Testing

1. Load the Verifier Dashboard with a valid public key and JWT
2. Click **Approve** on any pending project — confirm the modal appears with correct project details
3. Click **Cancel** — confirm the modal closes and the project list is unchanged
4. Click **Approve** again, then **Confirm Approval** — confirm the API call fires and the project is removed from the list
5. Repeat steps 2–4 for **Reject**
