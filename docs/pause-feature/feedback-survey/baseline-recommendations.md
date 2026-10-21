# Pause Feature: Baseline Improvement Recommendations

Design and usability gaps found by reviewing the pause implementation in
`contracts/carbon_credit/src/lib.rs` and `contracts/carbon_marketplace/src/lib.rs`
**before** the survey. Each one maps to the survey question(s) that will
confirm or refute it, so the feedback report can show which ones admins
actually care about.

These are hypotheses from code review, not survey results.

| # | Finding (from code) | Impact | Recommendation | Validated by |
|---|---|---|---|---|
| B1 | No read-only view for the pause state. `PauseEnabled` / `PauseUntil` are private storage, and the only check is simulating a gated call. | Admins can't quickly confirm a pause took effect or has expired. Dashboards can't show it. | Add `is_paused()` and `paused_until()` views to both contracts. | q7, q12 `no_status_query` |
| B2 | No user-facing messages for `EmergencyPaused` (#27 / #29) or `InvalidPauseWindow` (#26 / #28) in `frontend/lib/carbon-error-codes.ts`. | Users see raw error codes during a pause, which drives support load. | Add messages for these codes, and a paused-state banner driven by B1. | q8, q12 `user_messaging` |
| B3 | With only `carbon_credit` paused, marketplace purchases fail inside `env.invoke_contract(transfer_credits)` as an aborted cross-contract call, not a contract error. | Confusing failures that are hard to diagnose. | Check the credit pause state in the marketplace before transferring, or document/tool a single "pause both" action. | q9, q12 `cross_contract_errors` |
| B4 | `upgrade_contract` calls `require_not_paused`. | A patched Wasm can't be deployed to a paused contract; admins must reopen it first. | Exempt `upgrade_contract` (already admin-gated) from the pause. | q11, q12 `upgrade_blocked` |
| B5 | Marketplace admin setters (`set_fee_rate`, `update_treasury`, `suspend_project`, `set_sweep_threshold`, `sweep_fees`) and `delist_credits` are blocked while paused. | Incident-response actions are unavailable exactly when needed. | Limit the pause to user value-moving calls; keep admin configuration available. | q12 `admin_setters_blocked` |
| B6 | `pause_operations` takes no reason and emits no event. | No audit trail of why or how often contracts were paused. | Emit `paused` / `unpaused` events and record reasons (in progress: #1324). | q12 `no_reason` |
| B7 | Marketplace pause authority is a single admin address set at `initialize`, and can only be changed by upgrade. | One compromised key can pause or unpause at will. | Role-based or multi-sig pause authority (see the 2-of-3 multi-sig item in [ISSUES.md](../../ISSUES.md)). | q12 `single_marketplace_admin`, q14 `multisig` |
| B8 | `until_timestamp` is raw Unix seconds, checked against ledger time. Exactly 72 h from a local clock can be rejected. | Easy to get wrong under pressure (ms vs s, time zones, edge of the limit). | Duration presets in tooling (1 h / 4 h / 24 h / 71 h), with the UTC time shown back for confirmation. | q5, q10 |
| B9 | Expiry is silent. The pause lapses at `until_timestamp` with no notification. | An investigation can be reopened to users unintentionally. | Alert admins before expiry (e.g. at 1 h and 15 min) and show expiry wherever status is shown. | q13 |

## Using this with the survey results

In the feedback report, add a column to this table:

- **Confirmed:** the related rule fired, or open answers raise it
- **Not confirmed:** respondents didn't flag it; keep it only if the code-level risk justifies it
- **Contradicted:** respondents explicitly prefer the current behaviour

Prioritise confirmed items that also carry security risk (B4, B7) first.
