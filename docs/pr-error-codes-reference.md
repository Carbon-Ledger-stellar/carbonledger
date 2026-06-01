# docs: add contract error code reference

## Summary

Adds `docs/error-codes.md` — a complete reference for all 23 `CarbonError` contract error codes. Closes the gap where frontend developers and integrators had no documentation for handling contract errors, causing raw error numbers to be shown to users.

## Changes

- **`docs/error-codes.md`** (new) — covers all 23 error codes with:
  - Code number, name, and which contract(s) emit it
  - Exact conditions that trigger each error (sourced directly from contract source)
  - Resolution steps for each error
  - Ready-to-paste TypeScript `CONTRACT_ERRORS` mapping with usage example
  - API response JSON examples for the 8 most user-facing errors
  - Sync checklist for keeping the doc current when the enum changes
- **`docs/README.md`** — adds `error-codes.md` to the API Documentation table

## Acceptance Criteria

- [x] All 23 error codes documented with code number, name, when it occurs, and resolution steps
- [x] Documentation is in `docs/error-codes.md` and linked from the docs API reference
- [x] Frontend error mapping (error code → user-facing message) is documented
- [x] Examples of API responses containing each error are shown
- [x] Sync checklist included to keep the document in sync with the `CarbonError` enum

## Notes

The contracts define **23** error variants, not 18 as listed in the main README's error table. The five additional variants present in the actual contract code are `AlreadyInitialized` (19), `MethodologyScoreLow` (20), `UnauthorizedUpgrade` (21), `InvalidNonce` (22), and `InvalidSignature` (23). The README error table should be updated in a follow-up.

## Testing

Documentation only — no code changes.
