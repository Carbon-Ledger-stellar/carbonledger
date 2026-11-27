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

## Automated Scheduling (CronJobs)

The backup and restore-test jobs are scheduled automatically. Two deployment options are supported; use whichever matches the environment.

### Option A: Kubernetes CronJobs

| CronJob | Schedule | Purpose |
|---------|----------|---------|
| `carbonledger-db-backup` | `0 2 * * *` (daily, 02:00 UTC) | Full-database `pg_dump` to object storage |
| `carbonledger-pause-events-backup` | `0 * * * *` (hourly) | `pause_events` table dump to object storage |
| `carbonledger-restore-test` | `0 3 1 * *` (monthly, 1st at 03:00 UTC) | Restore test against the latest backup |

Each CronJob runs the corresponding script from `scripts/` (see [Components](#components)) and inherits the same environment variables (`DATABASE_URL`, `BACKUP_S3_BUCKET`, optional `ADMIN_ALERT_WEBHOOK`).

### Option B: systemd Timers

On hosts without Kubernetes, the same schedules are provided by systemd timers:

- `carbonledger-db-backup.timer` — daily at 02:00 UTC
- `carbonledger-pause-events-backup.timer` — hourly at minute 0
- `carbonledger-restore-test.timer` — monthly on the 1st at 03:00 UTC

### Retention (30 days)

Full-database backups are retained for **30 days**. Retention is enforced by an S3 lifecycle rule scoped to the full-backup prefix, so it does not affect the 365-day `pause-events/` retention:

```terraform
rule {
  id     = "expire-full-backups-after-30-days"
  status = "Enabled"

  filter {
    prefix = "backups/"
  }

  expiration {
    days = 30
  }

  noncurrent_version_expiration {
    noncurrent_days = 30
  }
}
```

### Monthly Restore Test

The restore test runs on the 1st of each month at 03:00 UTC. It downloads the latest full-database backup, restores it into a scratch database, and asserts:

- `pg_restore --list` succeeds (backup is not corrupt)
- Core table row counts match the counts recorded at backup time
- Restore completes within the 30-minute SLA

A JSON report is written to `/tmp/restore-test-report-TIMESTAMP.json` and a webhook notification is sent on completion or failure.

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

**Environmen

/* … truncated 7359 chars — edit only what you need near the top … */
