# Database Backup & Restore Guide

## Overview

This document describes the automated PostgreSQL backup and restore infrastructure for CarbonLedger.

### Key Features

- **Automated Daily Backups**: Runs at 02:00 UTC every day
- **Hourly Pause Events Backups**: Dedicated hourly backup of the `pause_events` audit table
- **Encrypted Storage**: Backups stored in AWS S3 with AES-256 encryption
- **30-Day Retention**: Automatic cleanup after 30 days via S3 lifecycle policy
- **1-Year Pause Events Retention**: `pause_events` backups retained for 365 days
- **Monthly Restore Tests**: Validates backup integrity on the 1st of each month at 03:00 UTC
- **Metrics Tracking**: Monitors backup size, duration, and restore time
- **SLA Monitoring**: Restore time must complete in under 30 minutes
- **Alerting**: Slack/Discord webhook notifications on backup or restore failures

---

## Pause Events Backup Strategy

The `pause_events` table is the immutable audit trail for all pause/unpause actions. To guarantee this audit trail is never lost, it has a dedicated backup strategy that is independent of the full-database backup.

### Requirements

| Requirement | Value |
|-------------|-------|
| Backup frequency | **Hourly** (top of every hour, `0 * * * *`) |
| Retention | **1 year (365 days)** |
| Scope | `pause_events` table only |
| Format | `pg_dump --format=custom --table=pause_events` |
| Storage | `s3://{BACKUP_S3_BUCKET}/pause-events/YYYY/MM/DD/pause_events-HH.dump` |
| Encryption | AES-256 server-side encryption |

### Why a separate strategy?

- The full-database backup runs daily and is retained for only 30 days, which is insufficient for audit requirements.
- Hourly granularity limits the maximum data-loss window for pause audit records to one hour.
- A table-scoped dump is small and cheap to store for a full year.

### Backup Script: `scripts/backup-pause-events.sh`

**Runs**: Hourly at minute 0 via systemd timer (`carbonledger-pause-events-backup.timer`)

**Environment Variables Required**:
- `DATABASE_URL`: PostgreSQL connection string
- `BACKUP_S3_BUCKET`: S3 bucket name for backups

**Optional Environment Variables**:
- `ADMIN_ALERT_WEBHOOK`: Slack/Discord webhook for notifications

**Process**:
1. Dumps only the `pause_events` table using `pg_dump --format=custom --table=pause_events`
2. Uploads to S3 under the `pause-events/` prefix with `STANDARD_IA` storage class
3. Records metrics (row count, size, dump time, upload time) in `backup_metrics`
4. Alerts on failure

**Retention**:
- A dedicated S3 lifecycle rule (`expire-pause-events-after-365-days`) expires objects under the `pause-events/` prefix after **365 days**.
- This rule is scoped to the `pause-events/` prefix so it does not affect the 30-day retention of full-database backups.

```terraform
rule {
  id     = "expire-pause-events-after-365-days"
  status = "Enabled"

  filter {
    prefix = "pause-events/"
  }

  expiration {
    days = 365
  }

  noncurrent_version_expiration {
    noncurrent_days = 365
  }
}
```

### Restoring Pause History

Pause history can be restored from any hourly `pause_events` backup, either into the live database or into a scratch database for inspection.

```bash
# Restore the most recent pause_events backup into the live database
./scripts/restore-pause-events.sh

# Restore a specific hourly backup into a scratch database
./scripts/restore-pause-events.sh \
  --backup-key s3://bucket/pause-events/2026/08/29/pause_events-14.dump \
  --target-db pause_events_restore

# Verify a backup without restoring
./scripts/restore-pause-events.sh \
  --backup-key s3://bucket/pause-events/2026/08/29/pause_events-14.dump \
  --verify-only
```

**Restore process**:
1. Downloads the selected `pause_events` dump from S3
2. Verifies integrity with `pg_restore --list`
3. Restores into the target database (or the live database with `--data-only --table=pause_events`)
4. Validates the restored row count against the recorded `backup_metrics` row count
5. Records restore metrics and alerts on failure

### Tested Restoration Process

The pause-events restore path is validated on a recurring schedule so the audit trail is provably recoverable:

- **Monthly restore test**: `scripts/test-restore-pause-events-monthly.sh` runs on the 1st of each month at 03:00 UTC.
- The test downloads the latest hourly `pause_events` backup, restores it into a temporary database, and asserts:
  - `pg_restore --list` succeeds (backup is not corrupt)
  - The restored `pause_events` row count matches the count recorded at backup time
  - The most recent `pause_events` row timestamp is within the expected hourly window
- A JSON report is written to `/tmp/pause-events-restore-test-report-TIMESTAMP.json` and a webhook notification is sent.

**Exit Codes**:
- `0`: Test passed
- `1`: Test failed (critical error)
- `2`: Test passed with warnings (e.g. row-count drift)

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

┌─────────────────────────────────────────────────────────────────────┐
│              Pause Events Audit Backup (Hourly)                     │
│                                                                     │
│  [Hourly Backup]  (0 * * * *, every hour)                           │
│         │                                                           │
│  ┌──────▼──────────────────────────┐                                │
│  │ pg_dump --table=pause_events    │                                │
│  │ custom format (binary)          │                                │
│  └──────┬──────────────────────────┘                                │
│         │                                                           │
│  ┌──────▼──────────────────────────┐                                │
│  │ S3 prefix: pause-events/        │                                │
│  │ - AES-256 Encryption            │                                │
│  │ - 365-day lifecycle retention   │                                │
│  └──────┬──────────────────────────┘                                │
│         │                                                           │
│  ┌──────▼──────────────────────────┐                                │
│  │ Monthly Pause Restore Test      │                                │
│  │ (1st of month, 03:00 UTC)       │                                │
│  │ - Verifies row count + recency  │                                │
│  └─────────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
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

### Pause Events Backup Timer

**File**: `scripts/systemd/carbonledger-pause-events-backup.service`
- Executes: `/opt/carbonledger/scripts/backup-pause-events.sh`
- User: `carbonledger`
- Environment: Loads from `/opt/carbonledger/.env`
- Output: Appended to `/var/log/carbonledger/pause-events-backup.log`

**File**: `scripts/systemd/carbonledger-pause-events-backup.timer`
- Schedule: `*-*-* *:00:00 UTC` (hourly at minute 0)
- Persistent: Yes

**Installation**:
```bash
sudo cp scripts/systemd/carbonledger-pause-events-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable carbonledger-pause-events-backup.timer
sudo systemctl start carbonledger-pause-events-backup.timer
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
  - Expires objects under the `pause-events/` prefix after 365 days
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

rule {
  id     = "expire-pause-events-after-365-days"
  status = "Enabled"

  filter {
    prefix = "pause-events/"
  }

  expiration {
    days = 365
  }

  noncurrent_version_expiration {
    noncurrent_days = 365
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

Metrics are logged to `/var/log/carbonledger/backup-metrics.json` in newline-delimited JSON format. Pause-events backups log to `/var/log/carbonledger/pause-events-backup-metrics.json` with the same schema, plus a `row_count` field for the `pause_events` table.

### Alerts

- **Backup failure**: Webhook alert if any hourly `pause_events` backup fails.
- **Missing backup**: Alert if no `pause_events` backup has been recorded in the last 2 hours.
- **Restore test failure**: Alert if the monthly pause-events restore test exits non-zero.
- **Retention drift**: Alert if the oldest `pause_events` backup in S3 is younger than 300 days (indicates retention misconfiguration).
