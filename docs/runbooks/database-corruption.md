# Runbook: Database Corruption

**Severity:** High  
**Contacts:** See [contacts.md](contacts.md) → Infrastructure  
**Escalation:** See [escalation.md](escalation.md)

---

## Detection

- Backend API returns 500 errors with Prisma error codes `P1001` (unreachable), `P1002` (timeout), `P2002` (unique constraint), or `P2034` (transaction conflict) at elevated rates.
- PostgreSQL logs show `ERROR: invalid page in block`, `FATAL: database file appears to be corrupted`, or `could not read block`.
- `pg_dump` fails with checksum errors.
- Off-chain records diverge from on-chain state (e.g., `CreditBatch.amount` doesn't match `carbon_credit.get_credit_batch()` result).
- Monitoring alert on DB error rate or replication lag.

---

## Containment

1. **Take the backend API offline** to prevent further writes to a corrupted state:
   ```bash
   # Docker
   docker stop carbonledger-backend
   # or scale to 0 in your orchestrator
   ```

2. **Do not restart PostgreSQL** until you have a snapshot — a restart may overwrite WAL needed for recovery.

3. **Take an immediate filesystem snapshot** of the PostgreSQL data directory (EBS snapshot, LVM snapshot, etc.).

4. **Check PostgreSQL logs** for the first corruption error and its timestamp:
   ```bash
   tail -n 500 /var/log/postgresql/postgresql-*.log | grep -E "ERROR|FATAL|corrupt"
   ```

5. **Run `pg_dump` to a null sink** to identify which tables/rows are unreadable:
   ```bash
   pg_dump $DATABASE_URL --no-password -Fc -f /dev/null 2>&1 | grep error
   ```

6. **Notify stakeholders** that the API is offline and provide an ETA for recovery.

---

## Recovery

### Option A — Restore from backup (preferred)

1. Identify the most recent clean backup (daily snapshot or continuous WAL archiving).
2. Restore to a new PostgreSQL instance:
   ```bash
   pg_restore -d $DATABASE_URL_NEW /path/to/backup.dump
   ```
3. **Reconcile with on-chain state** — the blockchain is the source of truth for credit and retirement records. Re-sync any records that are newer than the backup:
   ```bash
   # Re-index retirements from Stellar Horizon
   # (use the oracle/verification_listener pattern to replay events)
   ```
4. Bring the backend back online pointing at the restored DB.
5. Run a full integrity check:
   ```sql
   -- Verify credit totals match on-chain
   SELECT p."projectId", p."totalCreditsIssued", p."totalCreditsRetired",
          SUM(b.amount) AS batch_total
   FROM "CarbonProject" p
   JOIN "CreditBatch" b ON b."projectId" = p."projectId"
   GROUP BY p."projectId", p."totalCreditsIssued", p."totalCreditsRetired";
   ```

### Option B — In-place repair (if corruption is isolated)

1. Use `pg_filedump` or `zero_damaged_pages = on` (last resort) to skip corrupted blocks.
2. Export all readable data, drop and recreate the affected table, re-import.
3. Re-sync missing rows from on-chain state via Horizon API.

### Option C — Rebuild from on-chain state (if no backup)

The Stellar ledger is the authoritative source. All `CreditBatch`, `RetirementRecord`, and `MarketListing` data can be reconstructed by replaying contract events from Horizon. This is slow but complete.

---

## Post-mortem

- Root cause: hardware failure, runaway migration, OOM kill, disk full?
- How much data was lost (rows, time window)?
- Was the backup current enough? Adjust backup frequency if not.
- Add DB health check to the `/health` endpoint.
- Consider enabling PostgreSQL checksums (`initdb --data-checksums`) if not already on.
