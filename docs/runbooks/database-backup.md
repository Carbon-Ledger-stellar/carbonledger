# Runbook: Database Backup & Restoration

**Severity:** High  
**Contacts:** See [contacts.md](contacts.md) → Infrastructure  
**Escalation:** See [escalation.md](escalation.md)

---

## Overview

Daily `pg_dump` backups run at **02:00 UTC** via systemd timer. Backups are stored in the
`carbonledger-db-backups-<workspace>` S3 bucket under the `daily/` prefix in custom format
(`.dump`). The S3 lifecycle policy expires objects after **30 days**.

RDS automated backups are also retained for 30 days and can be used for point-in-time recovery.

---

## Verifying Backups

List recent backups:

```bash
aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ --recursive | sort | tail -10
```

Check the last backup timestamp on the server:

```bash
sudo journalctl -u carbonledger-backup.service --since "24 hours ago"
```

---

## Restoration Procedure

### Step 1 — Identify the target backup

```bash
# List all available backups
aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ | sort

# Example output:
# 2026-05-28T02:00:00Z.dump
# 2026-05-29T02:00:00Z.dump
```

Choose the most recent clean backup, or the last backup before the incident.

### Step 2 — Download the backup

```bash
BACKUP_KEY="daily/2026-05-29T02:00:00Z.dump"
aws s3 cp "s3://${BACKUP_S3_BUCKET}/${BACKUP_KEY}" /tmp/restore.dump
```

### Step 3 — Stop the backend to prevent writes

```bash
# Docker
docker stop carbonledger-backend

# Or scale to 0 in your orchestrator
```

### Step 4 — Drop and recreate the database

```bash
psql "${DATABASE_URL}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "${DATABASE_URL}" -c "GRANT ALL ON SCHEMA public TO carbonledger;"
```

### Step 5 — Restore from the dump

```bash
pg_restore --no-owner --role=carbonledger -d "${DATABASE_URL}" /tmp/restore.dump
```

### Step 6 — Re-apply any migrations newer than the backup

```bash
cd /opt/carbonledger/backend
npx prisma migrate deploy
```

### Step 7 — Reconcile with on-chain state

The Stellar ledger is the authoritative source for credit and retirement records. Re-index
any events that occurred after the backup timestamp:

```bash
# Replay events from Horizon from the backup timestamp onward
npx ts-node src/indexer.ts --from-ledger <ledger_at_backup_time>
```

### Step 8 — Verify integrity

```sql
-- Verify credit totals match on-chain
SELECT p."projectId", p."totalCreditsIssued", p."totalCreditsRetired",
       SUM(b.amount) AS batch_total
FROM "CarbonProject" p
JOIN "CreditBatch" b ON b."projectId" = p."projectId"
GROUP BY p."projectId", p."totalCreditsIssued", p."totalCreditsRetired";
```

### Step 9 — Bring the backend back online

```bash
docker start carbonledger-backend
```

### Step 10 — Clean up

```bash
rm /tmp/restore.dump
```

---

## RDS Point-in-Time Recovery (alternative)

If you need to recover to a specific minute rather than a daily snapshot:

1. In the AWS Console → RDS → Databases → select the instance → **Restore to point in time**.
2. Choose the target time (within the 30-day retention window).
3. This creates a **new** DB instance — update `DATABASE_URL` to point at it.
4. Run `npx prisma migrate deploy` to ensure the schema is current.

---

## Installing the Backup Timer (new server)

```bash
# Copy files
sudo cp /opt/carbonledger/scripts/backup-db.sh /opt/carbonledger/scripts/
sudo chmod +x /opt/carbonledger/scripts/backup-db.sh

sudo cp /opt/carbonledger/scripts/systemd/carbonledger-backup.service /etc/systemd/system/
sudo cp /opt/carbonledger/scripts/systemd/carbonledger-backup.timer   /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now carbonledger-backup.timer

# Verify
sudo systemctl list-timers carbonledger-backup.timer
```

Run a manual backup to confirm everything works:

```bash
sudo systemctl start carbonledger-backup.service
sudo journalctl -u carbonledger-backup.service -n 20
```

---

## Failure Alerts

If a backup fails, a webhook notification is sent to `ADMIN_ALERT_WEBHOOK` (Slack/Discord).
Check `/var/log/carbonledger/backup.log` for details.

Common failure causes:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `pg_dump failed` | DB unreachable or wrong `DATABASE_URL` | Check DB connectivity and env vars |
| `S3 upload failed` | Missing IAM permissions or wrong bucket name | Verify `BACKUP_S3_BUCKET` and IAM role |
| Timer not firing | systemd timer not enabled | `systemctl enable --now carbonledger-backup.timer` |
