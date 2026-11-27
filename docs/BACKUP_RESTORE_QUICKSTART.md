# Database Backup & Restore - Quick Start Guide

## Overview

Automated daily PostgreSQL backups to AWS S3 with monthly restore verification.

| Component | Schedule | Target |
|-----------|----------|--------|
| Daily Backup | 02:00 UTC | S3 (30-day retention) |
| Monthly Test | 1st month, 03:00 UTC | Staging DB |

## Quick Setup

### 1. Prerequisites

```bash
# Required tools
- AWS CLI v2+
- PostgreSQL client (psql, pg_dump, pg_restore)
- bash 4.0+
- AWS IAM permissions for S3

# Required environment variables
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
export BACKUP_S3_BUCKET="carbonledger-db-backups-production"
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."

# Optional: Slack/Discord notifications
export ADMIN_ALERT_WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK"
export RESTORE_TEST_WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK"
```

### 2. Install Systemd Timers

```bash
# Copy service files to systemd directory
sudo cp scripts/systemd/carbonledger-backup.* /etc/systemd/system/
sudo cp scripts/systemd/carbonledger-restore-test.* /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start timers
sudo systemctl enable carbonledger-backup.timer
sudo systemctl enable carbonledger-restore-test.timer
sudo systemctl start carbonledger-backup.timer
sudo systemctl start carbonledger-restore-test.timer

# Verify timers
sudo systemctl list-timers carbon*
```

### 3. Verify Setup

```bash
# Check backup is scheduled
sudo systemctl list-timers carbonledger-backup.timer

# Trigger manual test
bash scripts/backup-db.sh

# Check logs
sudo journalctl -u carbonledger-backup.service -f

# List backups in S3
aws s3 ls s3://carbonledger-db-backups-production/daily/ --recursive
```

## Common Tasks

### View Recent Backups

```bash
aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ --recursive --human-readable --summarize | \
  grep '.dump$' | sort | tail -10
```

### Restore Latest Backup

```bash
# To default database
./scripts/restore-db.sh

# To staging database
./scripts/restore-db.sh --target-db staging_carbonledger
```

### Test Backup Integrity

```bash
# Verify without restoring
./scripts/restore-db.sh --backup-key "s3://bucket/path/backup.dump" --verify-only
```

### Restore Specific Backup

```bash
./scripts/restore-db.sh \
  --backup-key "s3://carbonledger-db-backups-production/daily/2024-08-28T02:00:00Z.dump" \
  --target-db restore_test_db
```

### View Backup Metrics

```bash
# Last 5 backups
tail -5 /var/log/carbonledger/backup-metrics.json | jq .

# Backup size over time
cat /var/log/carbonledger/backup-metrics.json | \
  jq '{timestamp, size_mb: (.backup_size_bytes / 1048576 | round)}'
```

### Check Monthly Test Status

```bash
# Most recent test report
ls -lt /tmp/restore-test-report-*.json | head -1 | awk '{print $NF}' | xargs cat | jq .

# View test logs
tail -100 /var/log/carbonledger/restore-test.log
```

## Troubleshooting

### Backup Not Running

```bash
# Check timer status
sudo systemctl status carbonledger-backup.timer

# View next scheduled run
sudo systemctl list-timers carbonledger-backup.timer

# Check recent failures
sudo journalctl -u carbonledger-backup.service -n 50
```

### Restore SLA Exceeded

If restore takes > 30 minutes:

```bash
# 1. Check database size
psql "$DATABASE_URL" -c "SELECT pg_size_pretty(pg_database_size('carbonledger'));"

# 2. Review backup metrics
tail -1 /var/log/carbonledger/backup-metrics.json | jq .

# 3. Check RDS instance type
# Navigate to AWS Console > RDS > Databases > carbonledger > Instance class

# Solutions:
# - Increase RDS instance size
# - Run during low-traffic window
# - Consider incremental backups for very large databases
```

### S3 Permission Denied

```bash
# Verify AWS credentials
aws sts get-caller-identity

# Test S3 access
aws s3 ls s3://${BACKUP_S3_BUCKET}/ --recursive

# Check IAM policy allows:
# - s3:GetObject
# - s3:PutObject
# - s3:ListBucket
```

### Cannot Connect to Restored Database

```bash
# Verify restoration succeeded
psql "postgresql://user:pass@host/restore_test_db" -c "SELECT 1"

# Check restore log
tail -50 /var/log/carbonledger/restore-test.log

# Verify credentials
psql "postgresql://user:pass@host/postgres" -c "\list"
```

## Alert Handling

### Backup Failed

**Alert**: 🚨 CarbonLedger DB backup FAILED

**Actions**:
1. Check `/var/log/carbonledger/backup.log` for error
2. Verify DATABASE_URL and BACKUP_S3_BUCKET are set
3. Test AWS credentials: `aws sts get-caller-identity`
4. Run manual backup: `bash scripts/backup-db.sh`

### Restore Test Failed

**Alert**: 🚨 Monthly restore test failed

**Actions**:
1. Check restore test log: `tail -100 /var/log/carbonledger/restore-test.log`
2. Verify latest backup exists: `aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ --recursive`
3. Test backup integrity: `./scripts/restore-db.sh --verify-only`
4. Run manual test: `bash scripts/test-restore-monthly.sh`

### Restore SLA Exceeded

**Alert**: ⚠️ Restore time exceeded SLA (>30 minutes)

**Actions**:
1. Expected if database > 10GB
2. Consider upgrading RDS instance
3. Run restore at low-traffic time
4. Investigate slow disk I/O on RDS

## Monitoring

### Key Metrics to Track

```bash
# Backup size trend
cat /var/log/carbonledger/backup-metrics.json | \
  jq -s 'map({date: .timestamp | split("T")[0], size_mb: (.backup_size_bytes / 1048576 | floor)}) | group_by(.date) | map({date: .[0].date, avg_size_mb: (map(.size_mb) | add / length | floor)}) | sort_by(.date)'

# Backup success rate
grep -c '"status": "success"' /var/log/carbonledger/backup-metrics.json
grep -c '"status": "error"' /var/log/carbonledger/backup-metrics.json

# Total S3 storage used
aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ --recursive --summarize | grep "Total Size"
```

### Recommended Alerts (CloudWatch)

```
- Backup failure: 1+ failures in 24 hours → Page on-call
- SLA violation: Restore > 30 minutes → Alert engineering
- S3 cost: Projected monthly > $X → Notify ops
- Retention: Backups > 30 days old → Investigate lifecycle
```

## FAQ

**Q: How long are backups kept?**
A: 30 days (S3 lifecycle policy). Adjust `expiration.days` in `infra/main/storage.tf` to change.

**Q: Can I restore to a different database name?**
A: Yes, use `--target-db database_name` flag.

**Q: What's the backup file format?**
A: PostgreSQL `custom` format (compressed binary), optimized for pg_restore.

**Q: How often should backups be tested?**
A: Monthly (automated on 1st of month). Can also run manually anytime.

**Q: What if restore exceeds 30 minutes?**
A: Check database size and RDS instance type. This is expected for >10GB databases. Consider upgrading.

**Q: Are backups encrypted?**
A: Yes, AES-256 server-side encryption in S3. Transmitted via HTTPS.

**Q: Can I restore multiple backups simultaneously?**
A: Yes, use `--target-db` to restore to different database names.

**Q: Where are backup metrics stored?**
A: Both in `/var/log/carbonledger/backup-metrics.json` and `backup_metrics` table in database.

---

For full documentation, see [BACKUP_RESTORE.md](../BACKUP_RESTORE.md)
