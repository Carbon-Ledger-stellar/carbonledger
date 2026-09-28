# Pause Event & Audit Backup Strategy

## 1. Overview
This document specifies the disaster recovery, backup schedule, and audit data retention strategy for the CarbonLedger emergency pause and unpause operations (#1311).

## 2. Backup Frequency & Retention
- **Hourly Delta Snapshots:** All `audit_logs` entries tagged with `action IN ('pause_contract', 'unpause_contract')` are extracted into compressed JSON Lines (`.jsonl.gz`) files.
- **Daily Full Archives:** Nightly dump of all contract state snapshots and hash-chained audit trails.
- **Retention:**
  - 30 days hot storage (local NVMe).
  - 365 days warm storage (AWS S3 Glacier Instant Retrieval with Object Lock / WORM compliance).
  - 7 years cold storage for regulatory compliance.

## 3. Automated Backup Pipeline
The backup script `scripts/backup-pause-events.sh` executes on cron every hour:
1. Connects to the PostgreSQL replica.
2. Exports audit records with verification checksums (SHA-256).
3. Synchronizes encrypted archives to offsite storage.
4. Alerts on failure via PagerDuty / Slack webhooks.

## 4. Disaster Recovery & Restoration Verification
- Run monthly automated restoration drills using `scripts/disaster_recovery_test.sh`.
- Validate SHA-256 integrity hash chains against on-chain transaction hashes.
