# Runbook: Reconciliation Mismatch Alert

## Alert

`ReconciliationMismatch` — fires when the reconciliation job reports one or more
mismatches between the database and on-chain state.

- Metric: `reconciliation_mismatches_total`
- Condition: `increase(reconciliation_mismatches_total[15m]) > 0`

## Impact

A mismatch means the database and the chain disagree about some record (e.g. a
balance, status, or ownership). This can indicate a missed event, a reorg, a
failed write, or a bug in the reconciliation logic. Treat any mismatch as
potentially user-impacting until proven otherwise.

## Triage

1. Open the reconciliation job logs and locate the mismatch entries emitted
   alongside the metric increment. Each entry should identify the affected
   record and the DB vs. chain values.
2. Determine the direction of the drift:
   - DB ahead of chain: a write happened that the chain did not confirm.
   - Chain ahead of DB: an event was missed or not yet processed.
3. Check recent deploys, indexer/worker restarts, and chain reorgs around the
   time the metric first increased.
4. Confirm whether the mismatch is transient (self-heals on the next run) or
   persistent (count keeps increasing).

## Remediation

- Transient / single record: allow the next reconciliation run to correct it and
  verify the metric stops increasing.
- Persistent drift: re-run the reconciliation job for the affected range, or
  replay the missed events from the indexer.
- If the mismatch cannot be explained by missed events or reorgs, escalate to
  the backend on-call with the affected record IDs and log excerpts.

## Verification

- `reconciliation_mismatches_total` stops increasing across at least two
  consecutive reconciliation runs.
- Spot-check the affected records against the chain directly.

## Escalation

If mismatches persist after replay/re-run, page the backend on-call and open an
incident referencing this runbook.
