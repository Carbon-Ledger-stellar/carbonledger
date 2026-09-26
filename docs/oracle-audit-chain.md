# Oracle Submission Audit Chain

Every submission the oracle bridge makes to a Soroban contract is appended to a
hash-linked, append-only log in PostgreSQL (`oracle_audit_chain`). An
independent auditor can replay that log from genesis and prove the oracle's
submission history has not been retroactively altered.

- **Writer:** [oracle/audit_chain.py](../oracle/audit_chain.py)
- **Verifier:** [oracle/verify_audit_chain.py](../oracle/verify_audit_chain.py)
- **Schema:** `backend/prisma/migrations/20260807000000_add_oracle_audit_chain/`

---

## The chain

Each record stores the SHA-256 digest of the one before it:

```
entry_hash[n] = SHA256( canonical_fields[n] || entry_hash[n-1] )
```

`canonical_fields` is the pipe-joined ordering

```
sequence | recorded_at | service | contract_id | function_name
         | payload_hash | tx_hash | status | previous_hash
```

and `payload_hash` is SHA-256 over the canonical JSON of the submitted payload
(sorted keys, no insignificant whitespace — so key ordering can never change
the digest). This mirrors the convention already used for the backend
`AuditLog` chain in [backend/src/audit/audit.service.ts](../backend/src/audit/audit.service.ts).

`sequence` is contiguous from 1 and independent of the primary key, which is
what makes deletion detectable on its own.

### What each tampering mode looks like

| Attack | Detected as | Why |
|---|---|---|
| Edit a record's fields | `hash_mismatch` at that sequence | Its stored `entry_hash` no longer recomputes |
| Edit a record **and** recompute its `entry_hash` | `broken_link` at the **next** sequence | The successor still stores the old `previous_hash` |
| Delete a record | `gap` **and** `broken_link` at the next sequence | The sequence skips and the link no longer resolves |
| Delete the genesis record | `gap` (chain starts above 1) | Sequence numbering is absolute, not relative |
| Insert a record | `broken_link` / `gap` | A valid insert requires re-deriving every later hash |
| Forge a predecessor for genesis | `genesis_mismatch` | Genesis must have `previous_hash = NULL` |

### Known limitation: tail truncation

Deleting the **newest** records leaves a valid prefix, which the chain alone
cannot detect — the remainder is internally consistent. Detecting this needs an
external checkpoint of the head hash. Two practical options:

- Compare the head hash against the last value recorded by a scheduled
  verification run (`--json` output includes `head_hash`).
- Cross-check the record count against on-chain submissions via
  [oracle/reconciliation.py](../oracle/reconciliation.py), which independently
  walks the ledger.

This is called out explicitly in the test suite
(`test_truncated_tail_is_not_a_gap`) so the boundary of the guarantee stays
documented rather than assumed.

---

## Verifying the chain

Point the CLI at a read-only replica — verification needs no write access:

```bash
# full chain, from genesis
python3 oracle/verify_audit_chain.py --database-url "$REPLICA_URL"

# resume from a known-good checkpoint (much cheaper on a long chain)
python3 oracle/verify_audit_chain.py --from-sequence 250000

# machine-readable, for a scheduled job
python3 oracle/verify_audit_chain.py --json
```

Exit codes:

| Code | Meaning |
|---|---|
| `0` | Chain intact |
| `1` | Chain broken — gaps and/or hash mismatches, listed on stdout |
| `2` | Check could not run (no `DATABASE_URL`, connection failure, bad arguments) |

Sample failure output:

```
Oracle audit chain — verified from genesis to latest
  records checked : 5
  sequence range  : 1 … 6
  failures        : 2

  ❌ CHAIN BROKEN
     - [gap] sequence 5: expected sequence 4, found 5 (1 record(s) missing)
     - [broken_link] sequence 5: previous_hash is 9f2c…, expected 41ab…
```

---

## What gets recorded

| Service | Function | Recorded on |
|---|---|---|
| `satellite_monitor` | `submit_monitoring_data` | success and failure |
| `satellite_monitor` | `flag_project` | success and failure |
| `verification_listener` | `submit_monitoring_data` | success and failure |
| `price_oracle` | `update_credit_price` | one record per (methodology, vintage year) |

Failed attempts are recorded with `status = 'failed'`: an auditor needs to see
what the oracle *tried* to submit, not only what landed on chain.

Appending is best-effort — a database failure logs an error but never aborts the
submission it was recording. The hole that leaves is itself detectable as a
`gap`, which is the correct trade: a missing audit record must not become a
missing carbon-credit submission.

---

## Operational notes

- **Append-only.** Nothing in the application updates or deletes from this
  table. `UPDATE`/`DELETE` against it is exactly what the verifier is designed
  to catch, so treat any such statement in a migration as a red flag.
- **Concurrency.** Appends take a transaction-scoped advisory lock before
  reading the chain tail. Without it two writers could read the same head and
  fork the chain.
- **Cost.** The head hash is deliberately *not* published on chain — per the
  issue scope, on-chain storage of the chain is too expensive — and the log is
  not exposed publicly in real time.
- **Scheduling.** Run the verifier on a schedule against a replica and alert on
  a non-zero exit. Record the reported `head_hash` each run so tail truncation
  between runs becomes detectable.
