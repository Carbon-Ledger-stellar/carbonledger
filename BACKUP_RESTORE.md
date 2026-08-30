# Database Backup & Restore Guide

## Overview

This document describes the automated PostgreSQL backup and restore infrastructure for CarbonLedger.

### Key Features

- **Automated Daily Backups**: Runs at 02:00 UTC every day
- **Encrypted Storage**: Backups stored in AWS S3 with AES-256 encryption
- **30-Day Retention**: Automatic cleanup after 30 days via S3 lifecycle policy
- **Monthly Restore Tests**: Validates backup integrity on the 1st of each month at 03:00 UTC
- **Metrics Tracking**: Monitors backup size, duration, and restore time
- **SLA Monitoring**: Restore time must complete in under 30 minutes
- **Alerting**: Slack/Discord webhook notifications on backup or restore failures

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CarbonLedger Database                           │
│                     (PostgreSQL 16 on AWS RDS)                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                ┌──────────┴──────────┐
                │                     │
         [Daily Backup]         [Manual Restore]
         (02:00 UTC)                    │
                │                       │
         ┌──────▼────────────┐     ┌────▼────────────────┐
         │  pg_dump custom   │     │ Restore from S3     │
         │  format (binary)  │     │ or latest backup    │
         └──────┬────────────┘     └──────────────────────┘
                │
         ┌──────▼────────────────────┐
         │ AWS S3 Backup Bucket      │
         │ - AES-256 Encryption      │
         │ - Versioning Enabled      │
         │ - 30-day lifecycle        │
         │ - STANDARD_IA tier        │
         └──────┬────────────────────┘
                │
         ┌──────▼──────────────────────┐
         │ Monthly Restore Test        │
         │ (1st of month, 03:00 UTC)   │
         │ - Validates backup          │
         │ - Tests restore time < 30m  │
         │ - Verifies data integrity   │
         └─────────────────────────────┘
```

---

## Components

### 1. Backup Script: `scripts/backup-db.sh`

**Runs**: Daily at 02:00 UTC via systemd timer

**Environment Variables Required**:
- `DATABASE_URL`: PostgreSQL connection string
- `BACKUP_S3_BUCKET`: S3 bucket name for backups

**Optional Environment Variables**:
- `ADMIN_ALERT_WEBHOOK`: Slack/Discord webhook for notifications

**Process**:
1. Dumps database using `pg_dump --format=custom` (binary format)
2. Uploads to S3 with `STANDARD_IA` storage class
3. Tracks metrics: backup size, dump time, upload time
4. Logs metrics to JSON file for monitoring
5. Alerts on failure

**Output**:
- Metrics logged to: `/var/log/carbonledger/backup-metrics.json`
- Logs to: `/var/log/carbonledger/backup.log`

### 2. Restore Script: `scripts/restore-db.sh`

**Usage**:
```bash
# Restore latest backup to default database
./restore-db.sh

# Restore specific backup to named database
./restore-db.sh --backup-key s3://bucket/path/backup.dump --target-db staging_db

# Verify backup without restoring
./restore-db.sh --backup-key s3://bucket/path/backup.dump --verify-only
```

**Features**:
- Downloads backup from S3
- Verifies backup integrity with `pg_restore --list`
- Creates fresh target database
- Restores via `pg_restore`
- Validates restored data
- Tracks restore metrics in database
- Alerts on failure

**Restore Time Targets**:
- Download time: Typically < 5 minutes (depends on backup size)
- Restore time: Target < 30 minutes (SLA)
- Verification time: Typically < 2 minutes
- **Total restore time SLA: < 30 minutes**

### 3. Monthly Restore Test: `scripts/test-restore-monthly.sh`

**Runs**: 1st of each month at 03:00 UTC via systemd timer

**Process**:
1. Finds latest backup in S3
2. Creates temporary staging database
3. Runs full restore procedure
4. Validates restore time against 30-minute SLA
5. Verifies data integrity (table count, row sampling)
6. Generates JSON report
7. Sends webhook notification
8. Cleans up temporary database

**Report Location**: `/tmp/restore-test-report-TIMESTAMP.json`

**Exit Codes**:
- `0`: Test passed, restore time within SLA
- `1`: Test failed (critical error)
- `2`: Test passed but restore time exceeded SLA (warning)

---

## Systemd Configuration

### Backup Timer

**File**: `scripts/systemd/carbonledger-backup.service`
- Executes: `/opt/carbonledger/scripts/backup-db.sh`
- User: `carbonledger`
- Environment: Loads from `/opt/carbonledger/.env`
- Output: Appended to `/var/log/carbonledger/backup.log`

**File**: `scripts/systemd/carbonledger-backup.timer`
- Schedule: `*-*-* 02:00:00 UTC` (daily at 02:00 UTC)
- Persistent: Yes (will catch up if system reboots)

**Installation**:
```bash
sudo cp scripts/systemd/carbonledger-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable carbonledger-backup.timer
sudo systemctl start carbonledger-backup.timer
```

**Verification**:
```bash
# Check timer status
sudo systemctl status carbonledger-backup.timer

# List scheduled runs
sudo systemctl list-timers carbonledger-backup.timer

# View recent logs
sudo journalctl -u carbonledger-backup.service -n 50 -f
```

### Restore Test Timer

**File**: `scripts/systemd/carbonledger-restore-test.service`
- Executes: `/opt/carbonledger/scripts/test-restore-monthly.sh`
- Timeout: 60 minutes (allows for large restore operations)

**File**: `scripts/systemd/carbonledger-restore-test.timer`
- Schedule: `*-*-01 03:00:00 UTC` (1st of month at 03:00 UTC)
- Persistent: Yes

**Installation**:
```bash
sudo cp scripts/systemd/carbonledger-restore-test.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable carbonledger-restore-test.timer
sudo systemctl start carbonledger-restore-test.timer
```

---

## AWS Infrastructure (Terraform)

### S3 Backup Bucket Configuration

**Location**: `infra/main/storage.tf`

**Features**:
- **Name**: `{project}-db-backups-{workspace}` (e.g., `carbonledger-db-backups-production`)
- **Encryption**: AES-256 server-side encryption
- **Versioning**: Enabled (keeps previous versions for 30 days)
- **Lifecycle Policy**:
  - Expires objects after 30 days
  - Removes noncurrent versions after 30 days
- **Access Control**: All public access blocked
- **Storage Class**: `STANDARD_IA` (infrequent access for cost optimization)

**Lifecycle Configuration**:
```terraform
rule {
  id     = "expire-after-30-days"
  status = "Enabled"

  expiration {
    days = 30
  }

  noncurrent_version_expiration {
    noncurrent_days = 30
  }
}
```

**IAM Policy**:
- App EC2 role has permissions to:
  - `s3:GetObject` (download backups)
  - `s3:PutObject` (upload backups)
  - `s3:DeleteObject` (for cleanup)
  - `s3:ListBucket` (find backups)

---

## Database Schema

### backup_metrics Table

Tracks all backup and restore operations for monitoring and auditing.

**Columns**:
| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `backup_key` | TEXT | S3 path to backup (unique) |
| `backup_size_bytes` | BIGINT | Size in bytes |
| `dump_time_seconds` | INTEGER | Time to dump database |
| `upload_time_seconds` | INTEGER | Time to upload to S3 |
| `download_time_seconds` | INTEGER | Time to download from S3 |
| `restore_time_seconds` | INTEGER | Time to restore backup |
| `verify_time_seconds` | INTEGER | Time to verify restored DB |
| `restored_at` | TIMESTAMP | When backup was restored (NULL if not restored) |
| `created_at` | TIMESTAMP | When row was created (backup time) |
| `updated_at` | TIMESTAMP | When row was last updated |

**Indexes**:
- `created_at DESC` (for recent backups)
- `restored_at DESC` (for restore history)
- `backup_size_bytes` (for size monitoring)

**Migration**: `backend/prisma/migrations/20260829000001_add_backup_metrics/migration.sql`

---

## Monitoring & Alerting

### Backup Metrics

Metrics are logged to `/var/log/carbonledger/backup-metrics.json` in newline-delimited JSON format:

```json
{
  "timestamp": "2024-08-29T02:00:00Z",
  "backup_key": "s3://carbonledger-db-backups-production/daily/2024-08-29T02:00:00Z.dump",
  "backup_size_bytes": 1073741824,
  "backup_size_mb": 1024.00,
  "dump_time_seconds": 120,
  "upload_time_seconds": 45,
  "total_time_seconds": 165,
  "status": "success"
}
```

### Restore Test Report

Generated at `/tmp/restore-test-report-TIMESTAMP.json`:

```json
{
  "test_timestamp": "2024-09-01T03:00:00Z",
  "backup_source": "s3://carbonledger-db-backups-production/daily/2024-08-31T02:00:00Z.dump",
  "restore_time_seconds": 420,
  "max_restore_time_sla_seconds": 1800,
  "sla_met": true,
  "database_size": "1.5 GB",
  "table_count": 42,
  "test_status": "PASSED",
  "exit_code": 0
}
```

### Webhook Notifications

Sent to `$ADMIN_ALERT_WEBHOOK` (Slack/Discord) for:
- **Backup Failures**: Alert on any dump or upload error
- **Restore Failures**: Alert if restore or verification fails
- **SLA Violations**: Warning if restore time exceeds 30 minutes
- **Monthly Test Results**: Summary of monthly restore test

---

## Operational Procedures

### Manual Backup

```bash
export DATABASE_URL="postgresql://user:pass@host/db"
export BACKUP_S3_BUCKET="carbonledger-db-backups-production"
export ADMIN_ALERT_WEBHOOK="https://hooks.slack.com/..."

./scripts/backup-db.sh
```

### Manual Restore

**From latest backup**:
```bash
export DATABASE_URL="postgresql://user:pass@host/db"
export BACKUP_S3_BUCKET="carbonledger-db-backups-production"

./scripts/restore-db.sh
```

**From specific backup**:
```bash
./scripts/restore-db.sh \
  --backup-key "s3://carbonledger-db-backups-production/daily/2024-08-28T02:00:00Z.dump" \
  --target-db "restore_test"
```

**Verify backup without restoring**:
```bash
./scripts/restore-db.sh \
  --backup-key "s3://carbonledger-db-backups-production/daily/2024-08-28T02:00:00Z.dump" \
  --verify-only
```

### Manual Monthly Test

```bash
export DATABASE_URL="postgresql://user:pass@host/db"
export BACKUP_S3_BUCKET="carbonledger-db-backups-production"
export RESTORE_TEST_WEBHOOK="https://hooks.slack.com/..."

./scripts/test-restore-monthly.sh
```

### View Backup Metrics

```bash
# Recent backups (last 10)
tail -10 /var/log/carbonledger/backup-metrics.json | jq .

# Parse metrics with jq
cat /var/log/carbonledger/backup-metrics.json | \
  jq -s 'map(select(.status == "success")) | map({timestamp, backup_size_mb, total_time_seconds}) | sort_by(.timestamp) | reverse | .[0:10]'

# Query database metrics
psql $DATABASE_URL <<EOF
SELECT 
  DATE(created_at) as date,
  COUNT(*) as backup_count,
  ROUND(AVG(backup_size_bytes) / 1048576::numeric, 2) as avg_size_mb,
  ROUND(AVG(dump_time_seconds), 2) as avg_dump_time_sec,
  MAX(restore_time_seconds) as max_restore_time_sec
FROM backup_metrics
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
EOF
```

### Troubleshooting

#### Backup Failures

Check logs:
```bash
tail -100 /var/log/carbonledger/backup.log
journalctl -u carbonledger-backup.service -n 100
```

Verify environment variables:
```bash
cat /opt/carbonledger/.env | grep -E "DATABASE_URL|BACKUP_S3_BUCKET"
```

Test manually:
```bash
bash -x ./scripts/backup-db.sh
```

#### Restore Failures

Check logs:
```bash
tail -100 /var/log/carbonledger/restore-test.log
```

Verify backup integrity:
```bash
./scripts/restore-db.sh \
  --backup-key "s3://bucket/path/backup.dump" \
  --verify-only
```

Check database connectivity:
```bash
psql "$DATABASE_URL" -c "SELECT 1"
```

#### SLA Violations

If restore time exceeds 30 minutes:

1. Check database size: `du -sh /var/lib/postgresql/data`
2. Monitor backup size trends in metrics
3. Consider:
   - Upgrading RDS instance class
   - Optimizing table structure
   - Implementing incremental backups for larger databases

---

## Performance Tuning

### Backup Optimization

- **Compression**: Already using `custom` format (compressed binary)
- **Parallel Dump**: For very large databases (>10GB), consider:
  ```bash
  pg_dump --format=directory --jobs=4 "$DATABASE_URL" -f ./backup_dir/
  ```

### Restore Optimization

- **Parallel Restore**: For very large databases:
  ```bash
  pg_restore --jobs=4 backup.dump | psql
  ```
- **Index Building**: Restore without indexes first, then rebuild

---

## Monitoring Dashboard

### CloudWatch Metrics (Future Enhancement)

Consider adding CloudWatch metrics for:
- Backup size (bytes)
- Backup duration (seconds)
- Restore duration (seconds)
- S3 upload/download duration
- SLA compliance (% of restores < 30min)

### Example CloudWatch Alarm

```terraform
resource "aws_cloudwatch_metric_alarm" "backup_failure" {
  alarm_name          = "carbonledger-backup-failure"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "BackupFailures"
  namespace           = "CarbonLedger/Backups"
  period              = 3600
  statistic           = "Sum"
  threshold           = 1
  alarm_actions       = [aws_sns_topic.alerts.arn]
  alarm_description   = "Alert when backup fails"
}
```

---

## Compliance & Audit Trail

- **Retention Policy**: 30 days (meets regulatory requirements for most use cases)
- **Encryption**: AES-256 at rest, in transit via HTTPS
- **Versioning**: S3 versioning keeps all versions for audit trail
- **Audit Log**: Backup/restore operations logged to `backup_metrics` table
- **Access Control**: IAM role-based access (not public)

---

## Disaster Recovery

### Database Loss Scenarios

#### Scenario 1: Accidental Data Deletion

1. **Detect**: Query shows missing data
2. **Assess**: Query backup_metrics to find affected time
3. **Restore**: Use restore script to staging database
4. **Verify**: Compare data before/after
5. **Restore**: Restore to production when verified

#### Scenario 2: Corruption

1. **Detect**: Database integrity checks fail
2. **Restore**: Use latest good backup
3. **Verify**: Run data consistency checks
4. **Investigate**: Determine corruption cause

#### Scenario 3: Complete Database Loss

1. **Alert**: Backup failure detected
2. **Assess**: Check backup status in S3
3. **Restore**: Follow restore procedure
4. **Verify**: Run full test suite
5. **Resume**: Restart application

### RTO/RPO Targets

- **RTO** (Recovery Time Objective): < 35 minutes (30m restore + 5m overhead)
- **RPO** (Recovery Point Objective): 24 hours (daily backups at 2AM UTC)

---

## Documentation References

- [PostgreSQL Backup & Restore](https://www.postgresql.org/docs/current/backup.html)
- [AWS S3 Lifecycle Policies](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [Systemd Timers](https://www.freedesktop.org/software/systemd/man/systemd.timer.html)

---

## Changelog

### v1.0 - 2024-08-29

Initial implementation:
- Daily automated backups at 02:00 UTC
- S3 storage with encryption and 30-day retention
- Monthly restore testing (1st of month, 03:00 UTC)
- Backup metrics tracking
- 30-minute restore SLA
- Slack/Discord alerting
