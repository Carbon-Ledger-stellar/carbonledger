# Disaster Recovery Plan

**Issue:** [#1065](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/1065)  
**Status:** Active  
**Last Updated:** 2026-08-29  
**Owner:** Platform / Operations Team  
**Signed Off By:** _(pending leadership sign-off — see [Sign-off](#sign-off))_

---

## Table of Contents

1. [Objectives and Targets](#objectives-and-targets)
2. [Scope](#scope)
3. [Backup Locations](#backup-locations)
4. [Recovery Procedures](#recovery-procedures)
   - [Database Failure](#1-database-failure)
   - [Application Server Failure](#2-application-server-failure)
   - [Redis Failure](#3-redis-failure)
   - [Oracle Service Failure](#4-oracle-service-failure)
   - [Blockchain / Stellar Network Degradation](#5-blockchain--stellar-network-degradation)
   - [Full Region Failure](#6-full-region-failure)
   - [Security Incident / Key Compromise](#7-security-incident--key-compromise)
5. [Communication Plan](#communication-plan)
6. [Communication Templates](#communication-templates)
7. [Quarterly DR Testing](#quarterly-dr-testing)
8. [Sign-off](#sign-off)

---

## Objectives and Targets

| Metric | Target | Rationale |
|---|---|---|
| **RTO (Recovery Time Objective)** | < 1 hour | Critical transactions (retirements) are on-chain and immutable; backend is stateless and can be relaunched quickly |
| **RPO (Recovery Point Objective)** | < 15 minutes | Database backups are taken every 15 minutes via RDS automated snapshots; on-chain state is the authoritative source and can be re-indexed from genesis |

These targets apply to the core credit marketplace (project registration, purchases, retirements). Lower-priority systems (admin dashboards, ESG reports) may take up to 4 hours to restore.

---

## Scope

This plan covers the following system components:

| Component | Tier | Notes |
|---|---|---|
| PostgreSQL (RDS) | Critical | Primary off-chain data store |
| Redis (ElastiCache) | Critical | Job queue, rate limiting, JWT cache |
| NestJS Backend (EC2/ECS) | Critical | REST API |
| Next.js Frontend (EC2/ECS) | High | Read-only in degraded mode |
| Oracle Services (EC2) | High | Automated on-chain submissions |
| AWS Secrets Manager | Critical | Secrets; backed by AWS multi-AZ |
| Stellar Network | External | Handled by Stellar Foundation; see [section 5](#5-blockchain--stellar-network-degradation) |
| IPFS / Pinata | External | CIDs backed up to S3; see backup locations |

---

## Backup Locations

### Database Backups (PostgreSQL)

| Location | Type | Frequency | Retention | Region |
|---|---|---|---|---|
| RDS Automated Snapshots | Incremental | Every 15 min (point-in-time) | 7 days | `us-east-1` (primary) |
| S3 `carbonledger-db-backups-production` | `pg_dump` | Daily (via `scripts/backup-db.sh`) | 30 days | `us-east-1` |
| S3 `carbonledger-db-backups-dr` | Cross-region replica | Continuous replication | 30 days | `us-west-2` (DR region) |

> Cross-region replication to `carbonledger-db-backups-dr` is configured in `infra/main/storage-dr.tf`. It replicates every object written to the primary backup bucket within minutes.

### IPFS Content Backups

| Location | Type | Region |
|---|---|---|
| Pinata (primary) | Distributed IPFS pinning | Global |
| S3 `carbonledger-ipfs-backup-production` | CID-addressed S3 mirror | `us-east-1` |

### Stellar On-Chain State

The Stellar ledger is globally distributed across 100+ validators. There is no single backup needed — on-chain state is authoritative and always available unless the entire Stellar network is down (extremely rare; last major outage was 2021).

The PostgreSQL database is rebuilt from on-chain events when necessary using the indexer (`backend/src/indexer.ts`). See [Recovery Procedure 1](#1-database-failure).

### Secrets

AWS Secrets Manager is a multi-AZ, managed service. Secrets are replicated within the AWS region automatically. For DR purposes, critical secret values should also be stored in an air-gapped vault (1Password, physical safe) accessible to two or more senior engineers.

---

## Recovery Procedures

### 1. Database Failure

**Scenario:** RDS instance is unavailable, corrupted, or accidentally deleted.

**RTO Target:** 30 minutes | **RPO Target:** 15 minutes

**Step 1 — Assess the damage:**

```bash
# Check RDS instance status
aws rds describe-db-instances \
  --db-instance-identifier carbonledger-production \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address}'
```

**Step 2a — Point-in-time restore (preferred, RPO = 5 min):**

```bash
# Restore to the most recent available time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier carbonledger-production \
  --target-db-instance-identifier carbonledger-production-restored \
  --restore-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ) \
  --db-instance-class db.t3.small \
  --no-multi-az \
  --availability-zone us-east-1a

# Wait for the instance to become available (~15-20 min)
aws rds wait db-instance-available \
  --db-instance-identifier carbonledger-production-restored

# Get the new endpoint
aws rds describe-db-instances \
  --db-instance-identifier carbonledger-production-restored \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

**Step 2b — Restore from S3 pg_dump (fallback, RPO = daily backup age):**

```bash
# List available backups
aws s3 ls s3://carbonledger-db-backups-production/ --recursive | sort | tail -10

# Download most recent backup
aws s3 cp s3://carbonledger-db-backups-production/backup-$(date +%Y%m%d).sql.gz /tmp/

# Restore to a fresh RDS instance
gunzip -c /tmp/backup-$(date +%Y%m%d).sql.gz | \
  psql "postgresql://<user>:<pass>@<new-endpoint>:5432/carbonledger"
```

**Step 2c — Re-index from on-chain events (last resort, RPO = genesis):**

```bash
# Recreate schema on a fresh database
cd backend
DATABASE_URL="postgresql://<user>:<pass>@<endpoint>:5432/carbonledger" \
  npx prisma migrate deploy

# Run the indexer to replay all events from the Stellar ledger
DATABASE_URL="postgresql://<user>:<pass>@<endpoint>:5432/carbonledger" \
  npx ts-node src/indexer.ts
```

Indexing from genesis typically takes 10-45 minutes depending on ledger history.

**Step 3 — Update the database URL in Secrets Manager:**

```bash
aws secretsmanager put-secret-value \
  --secret-id carbonledger-production/postgres-credentials \
  --secret-string "{\"username\":\"carbonledger\",\"password\":\"<pass>\",\"host\":\"<new-endpoint>\",\"port\":5432,\"dbname\":\"carbonledger\"}"

# Send SIGHUP to the backend and oracle processes to pick up the new URL
kill -HUP <backend-pid>
kill -HUP <oracle-pid>
```

**Step 4 — Verify:**

```bash
curl https://api.carbonledger.io/health
# Should return: {"status":"ok","database":"healthy","redis":"healthy"}
```

---

### 2. Application Server Failure

**Scenario:** EC2 or ECS task running the NestJS backend is unresponsive or terminated.

**RTO Target:** 10 minutes

**Step 1 — Check instance health:**

```bash
aws ec2 describe-instance-status \
  --instance-ids <instance-id> \
  --query 'InstanceStatuses[0].InstanceStatus.Status'
```

**Step 2 — Relaunch or replace:**

For ECS:
```bash
# Force a new task deployment (ECS will launch a fresh container from the latest image)
aws ecs update-service \
  --cluster carbonledger-production \
  --service carbonledger-backend \
  --force-new-deployment
```

For EC2:
```bash
# Terminate the unhealthy instance (Auto Scaling Group will replace it)
aws ec2 terminate-instances --instance-ids <instance-id>
# The ASG will launch a replacement within 5 minutes.
```

**Step 3 — Verify:**

```bash
curl https://api.carbonledger.io/health
```

---

### 3. Redis Failure

**Scenario:** ElastiCache Redis cluster is unavailable.

**RTO Target:** 15 minutes

Redis is deployed with `enable_redis_sentinel = true` (3-node Sentinel HA, see `infra/main/redis.tf`). A single-node failure triggers automatic failover to a replica within 30-60 seconds — no manual action needed.

For a cluster-wide failure:

```bash
# Check cluster status
aws elasticache describe-replication-groups \
  --replication-group-id carbonledger-production \
  --query 'ReplicationGroups[0].{Status:Status,MemberClusters:MemberClusters}'

# If the cluster is truly unavailable, create a new one via Terraform
cd infra/main
terraform apply -target=aws_elasticache_replication_group.redis -var-file=production.tfvars
```

After restoration, the backend and oracle will reconnect automatically on the next request (the Redis client has built-in reconnection logic).

---

### 4. Oracle Service Failure

**Scenario:** One or more oracle services (verification listener, price oracle, satellite monitor) are down.

The oracle runs with a warm standby for each service (see `docs/oracle-disaster-recovery.md`). If the primary fails, the standby promotes itself within 120 seconds automatically.

For a full oracle host failure:

```bash
# SSH into the oracle host
ssh ubuntu@<oracle-ip>

# Check service status
sudo systemctl status carbonledger-verification-listener
sudo systemctl status carbonledger-price-oracle
sudo systemctl status carbonledger-satellite-monitor

# Restart all services
sudo systemctl restart carbonledger-verification-listener
sudo systemctl restart carbonledger-price-oracle
sudo systemctl restart carbonledger-satellite-monitor

# Check for errors
sudo journalctl -u carbonledger-verification-listener -n 50
```

For a full host replacement:

1. Launch a new EC2 instance from the oracle AMI (stored in AWS EC2 → AMIs → `carbonledger-oracle-*`).
2. Apply the environment file from Secrets Manager.
3. Start the oracle services with systemd.

---

### 5. Blockchain / Stellar Network Degradation

**Scenario:** The Stellar network is degraded or validators are not reaching consensus.

CarbonLedger is non-custodial — user funds are on-chain and cannot be lost by our infrastructure. During Stellar network degradation:

1. The backend's blockchain-facing endpoints will return `503 Service Temporarily Unavailable`.
2. Read-only operations (marketplace browsing, audit explorer) will continue working from the database.
3. The frontend will display a `NetworkStatusIndicator` banner (see `frontend/components/NetworkStatusIndicator.tsx`) automatically.

**Actions:**

```bash
# Monitor Stellar network status
curl https://horizon.stellar.org/ | jq .network_passphrase

# Check the Stellar status page
open https://status.stellar.org

# If using testnet: switch STELLAR_NETWORK=testnet and STELLAR_RPC_URL as needed
```

No data recovery is needed — on-chain state is preserved by Stellar validators. Resume normal operations once the Stellar network recovers.

---

### 6. Full Region Failure

**Scenario:** `us-east-1` (primary region) is completely unavailable.

**RTO Target:** < 1 hour

**Step 1 — Activate the DR region (`us-west-2`):**

The cross-region S3 replication has already synchronized database backups to `carbonledger-db-backups-dr` in `us-west-2`. See `infra/main/storage-dr.tf`.

```bash
# List the most recent DR backup in us-west-2
aws s3 ls s3://carbonledger-db-backups-dr/ \
  --region us-west-2 --recursive | sort | tail -5
```

**Step 2 — Provision DR infrastructure in `us-west-2`:**

```bash
cd infra/main
export AWS_REGION=us-west-2
terraform workspace new dr-us-west-2
terraform apply -var-file=production.tfvars \
  -var="aws_region=us-west-2" \
  -var="db_password=<from-air-gapped-vault>"
```

**Step 3 — Restore the database from the DR bucket:**

```bash
# Download latest backup from DR bucket
aws s3 cp s3://carbonledger-db-backups-dr/<latest>.sql.gz /tmp/ --region us-west-2

# Restore to the new RDS instance in us-west-2
gunzip -c /tmp/<latest>.sql.gz | \
  psql "postgresql://<user>:<pass>@<dr-rds-endpoint>:5432/carbonledger"
```

**Step 4 — Update DNS:**

Point the `api.carbonledger.io` and `app.carbonledger.io` DNS records (Route 53) to the DR region endpoints.

```bash
# Update Route 53 record
aws route53 change-resource-record-sets \
  --hosted-zone-id <zone-id> \
  --change-batch file://dr-dns-change.json
```

**Step 5 — Notify users** via the communication plan below.

---

### 7. Security Incident / Key Compromise

**Scenario:** An attacker gains access to a secret key, private key, or AWS credentials.

See `docs/runbooks/key-compromise.md` for the full runbook and `docs/secret-management-complete.md` → section "Emergency Procedures" for the step-by-step rotation procedure.

**Immediate actions (first 15 minutes):**

1. Revoke the compromised credential immediately.
2. For Stellar keypairs: if the oracle or admin key is compromised, call `POST /api/v1/key-rotation/oracle` or `/admin` immediately to register a new on-chain key.
3. For AWS credentials: disable the IAM access key in the AWS console.
4. For JWT secret: force-rotate via `aws secretsmanager rotate-secret --secret-id carbonledger-production/jwt-secret`.
5. Page the on-call engineer and the security lead.
6. Open a private security incident ticket.

---

## Communication Plan

### Roles and Responsibilities

| Role | Responsibility | Contact |
|---|---|---|
| **Incident Commander** | Declares the incident, coordinates response, owns external communication | On-call engineer (PagerDuty) |
| **Technical Lead** | Executes recovery procedures, reports status to IC | Platform team lead |
| **Customer Success** | Drafts user-facing communications, monitors support channels | CS lead |
| **Leadership** | Approves public communications, notifies affected enterprise clients | CTO / CEO |

### Escalation Path

```
PagerDuty alert
    ↓ 5 min
On-call engineer acknowledges
    ↓ 10 min (if not resolved)
Page Technical Lead
    ↓ 20 min (if P1 — data loss or full outage)
Page CTO / CEO
    ↓ 30 min (if outage > 30 min)
Post public status update (status.carbonledger.io)
```

### Severity Levels

| Level | Definition | Response Time |
|---|---|---|
| **P1** | Full service outage, data integrity risk, or security breach | Immediate; all hands |
| **P2** | Core feature unavailable (retirements, purchases), no data loss | 15 minutes |
| **P3** | Performance degradation, non-critical feature down | 1 hour |
| **P4** | Minor issue, cosmetic bug | Next business day |

### Communication Channels

- **Internal:** `#incidents` Slack channel, PagerDuty
- **External status:** `https://status.carbonledger.io` (hosted on StatusPage, separate infrastructure)
- **Enterprise clients:** Direct email from Customer Success lead
- **Regulatory notification:** Legal team notified for any incident involving credit data integrity

---

## Communication Templates

### Template 1 — Initial Incident Alert (Internal Slack)

```
🚨 INCIDENT DECLARED — [P1/P2/P3]
Incident: [Brief description, e.g. "RDS instance unreachable"]
Started: [HH:MM UTC]
Impact: [What is broken — e.g. "marketplace purchases failing, retirements unavailable"]
Incident Commander: [@name]
Technical Lead: [@name]
Next update in: 15 minutes
Bridge: [Zoom/Meet link]
```

---

### Template 2 — Status Page Update (Public)

**Subject:** Service Disruption — CarbonLedger Platform

```
We are currently experiencing [brief description of issue] affecting [affected features].

Impact: [e.g. Users may be unable to purchase or retire credits at this time.]

Our team is actively investigating. All on-chain credit records remain secure and unaffected.

We will provide an update by [time + timezone].

— CarbonLedger Engineering Team
```

---

### Template 3 — Resolution Notice (Public)

**Subject:** Service Restored — CarbonLedger Platform

```
The service disruption affecting [feature] has been resolved as of [HH:MM UTC].

All services are operating normally. No data was lost or compromised.

Summary:
- Duration: [X minutes/hours]
- Root cause: [brief, non-technical explanation]
- Impact: [what was affected]
- Resolution: [what was done]

We apologize for the inconvenience. A full post-incident report will be published within 5 business days.

— CarbonLedger Engineering Team
```

---

### Template 4 — Enterprise Client Notification (Email)

**Subject:** [Priority] CarbonLedger Service Notification — [Date]

```
Dear [Client Name],

We are writing to inform you of a service disruption that affected CarbonLedger from [start time] to [end time] UTC.

Incident summary:
- Start: [time UTC]
- End: [time UTC]
- Duration: [X minutes]
- Services affected: [list]
- Impact on your account: [specific impact or "none — your credit holdings and retirement records were unaffected"]

On-chain credit status:
All carbon credit retirements and balances are secured on the Stellar blockchain and were not affected by this incident. Your retirement certificates remain valid and verifiable.

Actions taken:
[Brief list of remediation steps]

Next steps:
We will provide a full root-cause analysis within 5 business days.

Please contact your account manager or [support@carbonledger.io] if you have any questions.

[Signature]
```

---

### Template 5 — Security Incident Notification (Regulatory)

```
Organization: CarbonLedger
Date of discovery: [date]
Nature of incident: [describe — e.g. unauthorized access to API key, no user data exposed]
Data affected: [list affected data types or "no user PII or credit data was exposed"]
Number of affected accounts: [number or "none"]
Remediation taken: [steps taken]
Regulatory contact: [name, title, contact info]

This notification is provided in accordance with [applicable regulation].
```

---

## Quarterly DR Testing

Recovery procedures must be tested quarterly to ensure they work before a real incident. Testing is done in the staging environment.

### Test Schedule

| Quarter | Test Type | Target Date |
|---|---|---|
| Q1 | Database point-in-time restore + RTO measurement | Mid-January |
| Q2 | Full re-index from on-chain events | Mid-April |
| Q3 | Cross-region failover simulation | Mid-July |
| Q4 | Security incident / key rotation dry run | Mid-October |

### Running the DR Test

```bash
# Full quarterly DR test
./scripts/dr-test-quarterly.sh

# The script covers:
# 1. Database backup integrity check
# 2. Point-in-time restore to staging (measures RTO)
# 3. Re-index from on-chain events (validates RPO via on-chain)
# 4. Cross-region backup availability check
# 5. Communication template dry-run (logs templates, does not send)
# Outputs a test report with pass/fail for each step and measured RTO/RPO.
```

See `scripts/dr-test-quarterly.sh` for the full implementation.

### DR Test Pass Criteria

| Criterion | Pass Condition |
|---|---|
| RTO | Full recovery completes in < 60 minutes |
| RPO | Maximum data loss = 1 backup interval (≤ 15 minutes) |
| Cross-region backup available | Most recent backup in `us-west-2` is < 30 minutes old |
| Re-index completeness | Indexed project and retirement counts match on-chain state |
| Alarm coverage | CloudWatch alarms fire correctly during simulated events |

### DR Test Log

| Date | Conducted By | Test Type | RTO Measured | RPO Measured | Pass/Fail | Notes |
|---|---|---|---|---|---|---|
| 2026-08-29 | Platform team | Initial setup | N/A | N/A | — | DR procedures documented; first test due Q4 2026 |

---

## Sign-off

This DR plan requires sign-off from CarbonLedger leadership before it is considered active.

| Role | Name | Signature | Date |
|---|---|---|---|
| CTO | _(pending)_ | | |
| Head of Engineering | _(pending)_ | | |
| Security Lead | _(pending)_ | | |

> Once signed, this document should be stored in both the git repository and a printed copy in the company's physical emergency binder, accessible outside of the production environment.
