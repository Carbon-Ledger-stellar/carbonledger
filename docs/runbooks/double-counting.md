# Runbook: Double-Counting Alert

**Severity:** Critical  
**Contacts:** See [contacts.md](contacts.md) → Registry Integrity  
**Escalation:** See [escalation.md](escalation.md)

---

## Detection

Double-counting means the same tonne of CO₂ has been credited more than once. Triggers:

- `DoubleCountingDetected = 14` error emitted by `carbon_credit.verify_serial_range()` — this is the primary on-chain guard.
- `SerialNumberConflict = 6` on a `mint_credits()` call — serial range overlaps an existing batch.
- Off-chain audit query finds duplicate serial numbers across `CreditBatch` records:
  ```sql
  SELECT serial_start, serial_end, COUNT(*) 
  FROM "CreditBatch" 
  GROUP BY serial_start, serial_end 
  HAVING COUNT(*) > 1;
  ```
- External registry (Verra VCS, Gold Standard) reports the same project/vintage already registered elsewhere.
- Community or verifier report of suspicious issuance.

---

## Containment

1. **Suspend the affected project immediately:**
   ```bash
   stellar contract invoke --id $CARBON_REGISTRY_CONTRACT_ID \
     --source $ADMIN_SECRET_KEY --network testnet \
     -- suspend_project --project_id <id>
   ```
   This blocks further minting from the project while investigation proceeds.

2. **Identify the duplicate batches** — query both on-chain and off-chain:
   ```bash
   # On-chain: fetch all batches for the project
   stellar contract invoke --id $CARBON_CREDIT_CONTRACT_ID \
     --source $ADMIN_SECRET_KEY --network testnet \
     -- get_credit_batch --batch_id <id>
   ```
   ```sql
   -- Off-chain: find overlapping serial ranges for the project
   SELECT * FROM "CreditBatch" WHERE "projectId" = '<id>' ORDER BY "serialStart";
   ```

3. **Flag the project in the oracle:**
   ```bash
   stellar contract invoke --id $CARBON_ORACLE_CONTRACT_ID \
     --source $ORACLE_SECRET_KEY --network testnet \
     -- flag_project --project_id <id> --reason "double-counting investigation"
   ```

4. **Delist any marketplace listings** from the affected batches to prevent further sales.

5. **Notify the project developer and verifier** — do not accuse; request documentation for the disputed issuance.

---

## Recovery

1. **Determine which batch is legitimate** — compare against verifier attestations, satellite monitoring CIDs, and methodology documentation.

2. **If one batch is fraudulent:**
   - Mark the fraudulent batch as `Retired` with a zero-beneficiary retirement record to neutralise it on-chain (credits cannot be deleted, but retiring them removes them from circulation).
   - Reject the project via `carbon_registry.reject_project()` if fraud is confirmed.
   - Notify buyers who hold credits from the fraudulent batch and arrange remediation (replacement credits or refund).

3. **If both batches are legitimate** (e.g., same project registered in two registries):
   - Work with the external registry to establish which registration takes precedence.
   - Retire the duplicate batch on CarbonLedger.

4. **Unsuspend the project** only after the duplicate is resolved and a verifier re-attests.

5. **Patch the serial range validation** if the on-chain guard failed to catch the conflict — file a bug and deploy a patched contract.

---

## Automated Serial Range Reconciliation Report

The `/api/v1/admin/reconciliation/serial-ranges` endpoint replaces the manual cross-referencing procedure. It:

1. Fetches all `CreditBatch` records from PostgreSQL, sorted by `serialStart` (numeric).
2. Fetches all `(serialStart, serialEnd)` pairs from the on-chain Soroban `SerialRegistry`.
3. Computes three discrepancy categories:
   - **DB-only batches** — exist in Postgres but not on-chain.
   - **On-chain-only ranges** — present in the Soroban registry but not in Postgres.
   - **Overlapping ranges** — two or more DB batches whose serial ranges intersect (primary double-counting signal).
4. Returns a structured `ReconciliationReport` JSON.

### Triggering the report

```bash
# 1. Enqueue the reconciliation job (returns jobId)
curl -X POST https://api.carbonledger.io/api/v1/admin/reconciliation/serial-ranges \
  -H "Authorization: Bearer $ADMIN_JWT"

# Response:
# { "jobId": "abc123", "message": "Reconciliation job enqueued..." }

# 2. Poll for completion
curl https://api.carbonledger.io/api/v1/admin/reconciliation/abc123 \
  -H "Authorization: Bearer $ADMIN_JWT"

# Response when complete:
# { "jobId": "abc123", "status": "completed", "report": { ... } }

# 3. Download as CSV
curl https://api.carbonledger.io/api/v1/admin/reconciliation/abc123/export \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -o reconciliation-report.csv
```

### Report JSON structure

```json
{
  "generatedAt": "2026-08-28T00:00:00.000Z",
  "totalBatchesChecked": 1500,
  "totalOnChainRangesChecked": 1498,
  "discrepanciesFound": 3,
  "dbOnlyBatches": [
    { "batchId": "batch-xyz", "serialStart": "10000", "serialEnd": "19999", "conflictType": "db_only" }
  ],
  "onChainOnlyRanges": [],
  "overlappingRanges": [
    {
      "batchId": "batch-abc",
      "serialStart": "5000",
      "serialEnd": "9999",
      "conflictType": "overlap",
      "overlappingWith": "batch-def",
      "overlapStart": "5000",
      "overlapEnd": "7500"
    }
  ]
}
```

### Nightly automated run

A `@Cron(EVERY_DAY_AT_MIDNIGHT)` job runs the reconciliation automatically. If
`discrepanciesFound > 0`, an `ERROR`-level log is emitted with the full summary.
Wire this log to your alerting pipeline (PagerDuty, Slack, etc.) to get paged
immediately on any discrepancy.

---

## Post-mortem

- How did the duplicate serial range pass `verify_serial_range()`?
- Was this a contract bug, an oracle submission error, or deliberate fraud?
- How many credits were sold from the duplicate batch?
- Buyer notification and remediation plan.
- Add the specific overlap scenario as a contract unit test.
- Review the automated reconciliation report for the affected time window.
