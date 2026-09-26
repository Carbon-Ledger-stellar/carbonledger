# Disaster Recovery Plan

**Version:** 1.0  
**Last Updated:** August 28, 2026  
**Status:** Active

---

## Executive Summary

This document defines the Disaster Recovery (DR) procedures, Recovery Time Objective (RTO), and Recovery Point Objective (RPO) targets for the Carbon Ledger platform. The plan ensures business continuity with minimal service disruption and data loss in case of catastrophic infrastructure or data failures.

### Key Targets
- **RTO (Recovery Time Objective):** < 1 hour
- **RPO (Recovery Point Objective):** < 30 minutes
- **Annual Failure Test:** Quarterly
- **Target Availability:** 99.5% (uptime-based)

---

## 1. Infrastructure Overview

### Primary Infrastructure
- **Database:** PostgreSQL 15 (PgBouncer connection pooling)
- **Cache Layer:** Redis (session store, rate limiting, query cache)
- **API Server:** NestJS backend on Node.js
- **Frontend:** React application
- **File Storage:** IPFS for documents/certificates
- **Blockchain:** Stellar Network (public/testnet)
- **Queue:** Bull/Redis for async jobs (minting, retirement, oracle sync)
- **Monitoring:** OpenTelemetry tracing, structured logging

### Infrastructure Dependencies
- DNS (GitHub, Vercel, or self-managed)
- Docker container registry (GHCR)
- GitHub Actions CI/CD
- AWS/external cloud services (if any)

---

## 2. Recovery Time Objective (RTO) & Recovery Point Objective (RPO)

### RTO/RPO by Component

| Component | RTO | RPO | Strategy |
|-----------|-----|-----|----------|
| PostgreSQL Database | 15 minutes | 5 minutes | PITR backups, WAL archiving |
| Redis Cache | 2 minutes | None (non-critical) | Warm-up on demand |
| API Backend | 10 minutes | N/A | Blue-green deployment |
| Frontend | 5 minutes | N/A | CDN failover |
| DNS/Routing | 5 minutes | N/A | Failover configuration |
| Stellar Account Keys | 30 minutes | None | Secure vault recovery |
| IPFS Data | 30 minutes | < 1 hour | Pinning service with replication |

### Aggregate RTO/RPO
- **Database Recovery:** 15 min (RTO) + 5 min (RPO)
- **Full System Recovery:** < 1 hour (RTO) with < 30 min data loss (RPO)

---

## 3. Backup Strategy

### Database Backups

#### 3.1 Automated Backup Schedule
```
Backup Type       | Frequency    | Retention | Storage
─────────────────────────────────────────────────────────
Full Backup       | Daily (02:00 UTC) | 7 days | Primary cloud storage + cross-region backup
Incremental Backup| Every 4 hours | 24 hours | Primary storage
WAL Archive       | Continuous | 7 days | Primary + secondary storage
Point-in-Time     | Available up to 7 days back | Query-based recovery
```

#### 3.2 Backup Procedures

**Full Daily Backup:**
```bash
# Executed via scheduled job (2:00 UTC)
pg_dump --format=custom --compress=9 \
  --no-privileges --no-owner \
  -d postgresql://user:pass@localhost:5432/carbonledger \
  > /backup/daily/carbonledger_$(date +%Y%m%d).dump

# Cross-region replication
aws s3 cp /backup/daily/ s3://backup-bucket/db-backups/ --recursive
aws s3 sync s3://backup-bucket/db-backups/ \
  s3://backup-bucket-dr/db-backups/ --region us-west-2
```

**Continuous WAL Archiving:**
```
# Enable in PostgreSQL postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /backup/wal_archive/%f && cp %p /backup/wal_archive/%f'
archive_timeout = 300  # 5 minutes
```

**Point-in-Time Recovery (PITR):**
- Maintain last 7 days of WAL files
- Allow recovery to any second within the retention window
- Tested weekly via backup integrity verification

#### 3.3 Backup Validation

**Weekly Backup Integrity Test:**
```bash
# Restore to isolated test database
pg_restore --clean --if-exists \
  --dbname=postgresql://test@localhost:5433/carbonledger_test \
  /backup/daily/carbonledger_latest.dump

# Verify data integrity
SELECT COUNT(*) FROM CarbonProject;
SELECT COUNT(*) FROM CreditBatch;
SELECT COUNT(*) FROM RetirementRecord;
-- Compare row counts against production

# Test PITR to specific timestamp
pg_basebackup -D /tmp/pitr_test -R
```

### Application Data Backups

#### Redis Backups
- **Backup Type:** RDB snapshots
- **Frequency:** Every 1 hour (automated by Redis)
- **Retention:** 24 hours
- **Recovery Impact:** Low (session data regenerated on demand)

#### IPFS/Certificate Backups
- **Strategy:** Multi-node pinning across 3+ providers
- **Replication Factor:** 3x minimum
- **Recovery:** Fetch from any available pinning node
- **Validation:** CID integrity check on restore

### Backup Storage

**Primary Storage:**
- On-premises NAS with RAID-6 (or equivalent cloud storage)
- Automatic snapshots every 6 hours
- Retention: 7 days

**Secondary/DR Storage:**
- Cross-region cloud replication (S3, GCS, Azure)
- Encrypted at rest with separate KMS keys
- Retention: 30 days

**Backup Encryption:**
- AES-256 encryption for all backups in transit
- KMS-managed keys (separate from production KMS)
- Key rotation: Every 90 days
- Backup key stored in secure vault (different from production)

---

## 4. Failover Procedures

### 4.1 Database Failover

**Trigger:** Database becomes unavailable for > 2 minutes

**Automatic Failover Steps:**

1. **Detection** (health check failures)
   ```bash
   # Health check every 10 seconds
   postgres://{readonly_replica}:5432/carbonledger?application_name=healthcheck
   ```

2. **Promote Read Replica to Primary**
   ```sql
   -- On standby server
   SELECT pg_promote();
   
   -- Verify promotion completed
   SELECT pg_is_in_recovery();  -- Should return false
   ```

3. **Verify Data Consistency**
   ```sql
   SELECT COUNT(*) FROM CarbonProject;
   SELECT COUNT(*) FROM RetirementRecord;
   -- Compare against expected counts
   ```

4. **Update Connection Strings**
   - Update DNS/connection pool to point to promoted replica
   - Update PgBouncer configuration
   - Restart affected services (with 0 downtime if configured properly)

5. **Replication Lag Check**
   ```sql
   SELECT slot_name, restart_lsn, confirmed_flush_lsn 
   FROM pg_replication_slots;
   ```

**Manual Failover (if automatic fails):**
- See Section 6: Failover Runbooks

### 4.2 Redis Failover

**Trigger:** Primary Redis becomes unavailable

**Failover Steps:**

1. **Automatic Detection**
   ```bash
   # Health check via PING command
   redis-cli PING
   ```

2. **Sentinel/Cluster Promotion**
   - If using Redis Sentinel:
     ```bash
     redis-cli -h sentinel:26379 sentinels redis-master
     # Manual promotion if needed:
     redis-cli -h sentinel:26379 sentinel failover redis-master
     ```

3. **Connection Failover**
   - Update `REDIS_URL` to point to new primary
   - Clear existing connections in connection pool

4. **Cache Invalidation**
   - Clear all query cache (if using Redis for caching)
   - Allow cache to rebuild on first access
   - Performance impact: Temporary (< 5 minutes)

**Recovery Impact:**
- Sessions: Require re-authentication if lost
- Rate Limits: Reset (minor risk of brief abuse window)
- Query Cache: Rebuilt from database (acceptable performance hit)

### 4.3 API Backend Failover

**Trigger:** Primary backend service becomes unresponsive

**Failover Steps:**

1. **Load Balancer Detection**
   - Health check: `GET /health` endpoint
   - Threshold: 3 consecutive failures within 30 seconds
   - Automatic removal from load balancer

2. **Traffic Reroute**
   - Remaining healthy instances absorb traffic
   - Scaled to 3+ instances for redundancy (horizontal scaling)

3. **Service Recovery**
   - Restart unhealthy pod/container
   - Kubernetes/Docker Swarm auto-restart with exponential backoff
   - Manual pod restart: `kubectl delete pod <pod-name>`

4. **Verification**
   ```bash
   # Verify /health endpoint
   curl https://api.carbonledger.io/health
   # Response should show all services "up"
   ```

### 4.4 Frontend Failover

**Trigger:** Web application becomes unavailable

**Failover Steps:**

1. **CDN Failover**
   - Primary CDN edge node failure detected
   - Automatic reroute to secondary CDN node or origin
   - No action needed (automatic)

2. **DNS Failover**
   - If entire CDN region fails:
     ```bash
     # Update DNS to secondary CDN
     example.com A record → secondary-cdn.example.com
     ```

3. **Cache Invalidation**
   - Clear CDN cache for affected assets
   ```bash
   curl -X PURGE https://cdn.example.com/app/*
   ```

### 4.5 Stellar Account/Key Failover

**Trigger:** Stellar signing key compromised or lost

**Recovery Steps:**

1. **Immediate Action:** Activate secondary signing key (pre-generated)
   ```javascript
   // Use secondary key for signing new transactions
   const backupKeyPair = Keypair.fromSecret(process.env.STELLAR_BACKUP_KEY);
   ```

2. **Revoke Compromised Key** (from Stellar account master key)
   ```javascript
   const transaction = new TransactionBuilder(account, {
     fee: BASE_FEE,
     networkPassphrase: Networks.TESTNET_NETWORK_PASSPHRASE
   })
     .addOperation(Operation.setOptions({
       signer: {
         ed25519PublicKey: compromisedPublicKey,
         weight: 0  // Remove signer
       }
     }))
     .setNetworkPassphrase(Networks.TESTNET_NETWORK_PASSPHRASE)
     .setTimeout(30)
     .build();
   ```

3. **Key Rotation Schedule:**
   - Primary key: Valid for 1 year
   - Backup key: Pre-generated, never stored in production
   - Tertiary key: Generated as needed
   - Quarterly key rotation recommended

---

## 5. Communication Plan

### Incident Severity Levels

| Level | Impact | Notification | Timeline |
|-------|--------|--------------|----------|
| **Critical** | Service down > 5 min | All stakeholders + status page | Immediate |
| **High** | Degraded performance | Internal team + customers | 15 minutes |
| **Medium** | Minor feature impact | Internal team | 1 hour |
| **Low** | Potential issue | Engineering team | Next business day |

### Notification Channels

1. **Status Page:** https://status.carbonledger.io
   - Update: Critical (immediately), High (15 min), Medium (1 hour)

2. **Slack Channels:**
   - **#incidents** - All incident alerts
   - **#critical-alerts** - Critical only (paged)
   - **#sre-on-call** - On-call rotation notifications

3. **Email:**
   - Critical incidents to incident-response@carbonledger.io
   - Stakeholders notified at incident.stakeholders@carbonledger.io

4. **SMS/Phone (Critical Only):**
   - Page on-call engineer via PagerDuty
   - Escalation after 15 minutes without response

### Communication Template

**Initial Notification (< 5 min):**
```
INCIDENT: [Service] Failure Detected
Severity: [Critical/High/Medium]
Started: [Timestamp]
Impact: [What's affected]
Status: Investigating
```

**Update (15-30 min intervals):**
```
UPDATE [#3]: [Status]
ETA for Resolution: [Time estimate]
Actions Taken: [List]
Next Update: [When]
```

**Resolution (Final):**
```
RESOLVED: [Service] is now fully operational
Duration: [Total time]
Affected Users: [Count]
RCA: [Root cause - full report within 24h]
Prevention: [Action items]
```

---

## 6. Testing & Validation

### Quarterly DR Testing Schedule

**Q1 (January-March):** Database Failover Test
- Simulate primary database failure
- Failover to read replica
- Verify RTO < 15 min, RPO < 5 min
- Validate backup restoration

**Q2 (April-June):** Full System Failover Test
- Comprehensive failover (DB + cache + API)
- Test from different region/availability zone
- Measure end-to-end RTO (target: < 1 hour)

**Q3 (July-September):** Data Integrity & PITR Test
- Restore from point-in-time backup
- Verify no data corruption
- Test incremental recovery scenarios

**Q4 (October-December):** Full Production Simulation
- Complete failover on cloned production environment
- Test incident response procedures
- Communication and coordination drills
- Annual comprehensive audit

### Test Execution Procedure

1. **Pre-Test Checklist**
   - [ ] Backup verified and accessible
   - [ ] Failover infrastructure ready
   - [ ] Monitoring systems recording
   - [ ] Team assembled and notified
   - [ ] Test window scheduled (low-traffic period)

2. **Test Execution**
   - [ ] Document start time
   - [ ] Simulate failure scenario
   - [ ] Initiate failover procedures
   - [ ] Record RTO/RPO metrics
   - [ ] Verify data integrity
   - [ ] Validate application functionality

3. **Post-Test Validation**
   - [ ] Data consistency checks
   - [ ] Performance baseline verification
   - [ ] Log review for errors
   - [ ] Documentation of lessons learned
   - [ ] Update procedures if needed

4. **Reporting**
   - [ ] Test results documented within 48 hours
   - [ ] Metrics: RTO achieved, RPO achieved, data loss (if any)
   - [ ] Issues identified and prioritized
   - [ ] Corrective actions assigned
   - [ ] Report shared with stakeholders

### Metrics to Track

```
Metric                    | Target    | Acceptable | Unacceptable
──────────────────────────────────────────────────────────────
Actual RTO                | < 1 hour  | < 1.5 hour | > 1.5 hour
Actual RPO                | < 30 min  | < 45 min   | > 45 min
Backup Integrity (Pass %) | 100%      | > 95%      | < 95%
Recovery Attempt Success  | 100%      | > 90%      | < 90%
Data Consistency Score    | 100%      | > 99%      | < 99%
```

---

## 7. Key Contact Information

### On-Call Rotation
- **Primary On-Call:** [SRE Team]
- **Escalation:** [Engineering Manager]
- **Executive Escalation:** [CTO/VP Engineering]
- **Backup Contact:** [Designated backup on-call]

### External Contacts
- **Cloud Provider Support:** [Account manager + technical support]
- **Database Vendor Support:** [PostgreSQL Enterprise support contract]
- **DNS Provider Support:** [Registrar + DNS service provider]

### Communication Lists
- **Incident Response Team:** incident-response@carbonledger.io
- **Stakeholders:** stakeholders@carbonledger.io
- **Status Page:** status.carbonledger.io

---

## 8. Maintenance & Updates

### Regular Review Schedule
- **Monthly:** Review incident logs, update contact list
- **Quarterly:** Execute DR test, update procedures based on findings
- **Annually:** Comprehensive DR plan audit, update RTO/RPO targets

### Version Control
- Store this plan in Git with change tracking
- Require approval for procedure changes
- Tag releases with version numbers
- Maintain audit trail of all updates

---

## Appendices

### Appendix A: Backup Validation Checklist

- [ ] Database backup file exists and is valid
- [ ] Backup size is within expected range (±20%)
- [ ] Backup timestamp is recent (within 24 hours)
- [ ] WAL files are continuous and complete
- [ ] IPFS pinning status confirmed (all hashes pinned)
- [ ] Cross-region replication verified
- [ ] Encryption validation passed
- [ ] Test restore completed successfully

### Appendix B: Recovery Runbooks Location

- Full runbooks: See `docs/FAILOVER_RUNBOOKS.md`
- Quick reference: See `docs/FAILOVER_CHECKLIST.md`
- Post-incident: See `docs/INCIDENT_RESPONSE.md`

### Appendix C: Disaster Recovery Metrics Dashboard

Monitor the following metrics in real-time:
- Backup completion status
- Replication lag
- RPO drift
- RTO simulation results
- Test execution history
- Mean time to recovery (MTTR)

---

## Document Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Document Owner | [SRE Lead] | | [Date] |
| Technical Review | [Database Admin] | | [Date] |
| Management Approval | [VP Engineering] | | [Date] |

---

**Next Review Date:** August 28, 2027

