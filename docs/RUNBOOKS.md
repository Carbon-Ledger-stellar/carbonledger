# Production Incident Runbooks

Critical procedures for responding to production incidents in CarbonLedger. All incidents must follow the communication plan and include post-incident review.

## Table of Contents
- [High Load Incident](#high-load-incident)
- [Database Down Incident](#database-down-incident)
- [Smart Contract Bug Incident](#smart-contract-bug-incident)
- [Root Cause Analysis Template](#root-cause-analysis-template)
- [Communication Plan](#communication-plan)
- [Rollback Procedures](#rollback-procedures)
- [Post-Incident Review Process](#post-incident-review-process)

---

## High Load Incident

### Detection Indicators
- Response time > 5 seconds (p99)
- Error rate > 2%
- CPU utilization > 85%
- Memory utilization > 90%
- Active connection pool near limit
- Queue depth increasing

### Immediate Actions (First 5 minutes)
1. **Declare incident** - Notify on-call team immediately
2. **Assess scope** - Check which endpoints are affected
3. **Enable degraded mode** - Activate circuit breakers if configured
4. **Scale resources**
   ```bash
   # For Kubernetes deployments
   kubectl scale deployment carbonledger-api --replicas=5 -n production
   
   # For AWS Auto Scaling
   aws autoscaling set-desired-capacity --auto-scaling-group-name carbonledger-asg --desired-capacity 8
   ```
5. **Activate traffic mitigation**
   - Rate limit non-critical endpoints (10 req/s per client)
   - Route heavy analytics queries to read replicas only
   - Pause non-critical background jobs

### Investigation Steps (5-30 minutes)
1. **Check metrics dashboard**
   ```bash
   # Query Prometheus for current metrics
   # Dashboard: Grafana > CarbonLedger > Production Dashboard
   ```
2. **Review logs for anomalies**
   ```bash
   # Check for errors
   kubectl logs -l app=carbonledger -n production --tail=500 | grep ERROR
   
   # Check database slow queries
   mysql> SELECT * FROM mysql.slow_log ORDER BY query_time DESC LIMIT 20;
   ```
3. **Identify spike cause**
   - Analyze request patterns (geographic, user segment, endpoint)
   - Check for data import jobs running
   - Verify third-party integrations (blockchain sync, oracle calls)
4. **Monitor connection pool**
   ```bash
   # Check Prisma connection pool status
   curl -s http://localhost:3001/health | jq '.database.connections'
   ```

### Mitigation Strategies

**Strategy 1: Query Optimization (10 min)**
- Disable full-text search temporarily
- Increase cache TTL for project listings
- Route reports to cached results

**Strategy 2: Resource Scaling (15 min)**
- Add 3+ additional API instances
- Enable read replicas if available
- Scale worker processes

**Strategy 3: Traffic Shedding (5 min)**
- Redirect 50% of analytics traffic to maintenance page
- Queue retirement requests (SLA: 30 min processing)
- Drop non-critical logging (keep audit logs)

### Recovery (30+ minutes)
1. Monitor metrics during scaling
2. Gradually restore services as load decreases
3. Document what triggered the spike
4. Create post-incident review (see [Post-Incident Review](#post-incident-review-process))

### Prevention for Next Time
- Implement load testing (1M+ concurrent users)
- Add horizontal autoscaling triggers
- Review slow query logs
- Optimize N+1 queries in hot paths

---

## Database Down Incident

### Detection Indicators
- Database connection refused (ECONNREFUSED)
- All database queries timing out
- Connection pool exhausted
- Replication lag critical
- Binary log issues

### Immediate Actions (First 2 minutes)
1. **Declare critical incident** - All hands on deck
2. **Check database status**
   ```bash
   # SSH to database server
   ssh db-primary.prod
   
   # Check MySQL status
   mysql -u root -p -e "SHOW SLAVE STATUS\G"
   mysql -u root -p -e "SELECT @@version, @@datadir, @@log_bin;"
   ```
3. **Switch to read-only mode** (if partial outage)
   ```bash
   # Set application to read-only
   # This prevents inconsistent writes
   export READONLY_MODE=true
   ```
4. **Notify on-call DBA immediately**
5. **Failover to replica** (if primary is corrupted)
   ```bash
   # Promote replica to primary
   mysql -u root -p -h replica.prod << EOF
   STOP SLAVE;
   RESET MASTER;
   SHOW MASTER STATUS;
   EOF
   
   # Update connection strings in all services
   # Update Kubernetes secrets
   kubectl patch secret db-credentials -p '{"data":{"DB_HOST":"'$(echo -n 'new-primary.prod' | base64)'"}}' -n production
   ```

### Investigation Steps (2-10 minutes)
1. **Check disk space**
   ```bash
   df -h
   du -sh /var/lib/mysql/*
   ```
2. **Review error logs**
   ```bash
   tail -f /var/log/mysql/error.log
   ```
3. **Check for locks**
   ```bash
   mysql> SHOW PROCESSLIST;
   mysql> SHOW OPEN TABLES WHERE In_use > 0;
   ```
4. **Verify replication**
   ```bash
   mysql> SHOW REPLICA STATUS\G
   # Check: Replica_IO_Running, Replica_SQL_Running
   ```

### Recovery Options

**Option A: Restart Database (5-10 min)**
```bash
# Stop MySQL gracefully
sudo systemctl stop mysql

# Wait for clean shutdown
sleep 30

# Restart
sudo systemctl start mysql

# Verify
mysql -e "SELECT 1;"
```

**Option B: Fix Corrupted Table (15-30 min)**
```bash
# Find corrupted tables
mysql> CHECK TABLE database_name.table_name;

# Repair if needed
mysql> REPAIR TABLE database_name.table_name;

# Or restore from backup
mysqldump -u backup -p backup-file.sql | mysql -u root -p
```

**Option C: Full Failover (20-30 min)**
1. Stop all application instances
2. Promote replica to primary
3. Update DNS/connection strings
4. Restart applications with new connection
5. Verify data integrity

### Post-Database Recovery
```bash
# Verify all tables
mysql> CHECK TABLE app_db.* FOR UPGRADE;

# Check replication lag on new replica
mysql> SHOW SLAVE STATUS\G

# Monitor for errors
tail -f /var/log/mysql/error.log &
```

---

## Smart Contract Bug Incident

### Detection Indicators
- Contract calls reverting unexpectedly
- State transitions failing
- Emission events not firing
- Gas estimation errors
- Oracle data inconsistencies

### Immediate Actions (First 5 minutes)
1. **Declare incident** - Contact smart contract team lead
2. **Pause affected contract** (if pausable)
   ```bash
   # Check if contract has pause mechanism
   web3 eth call 0xContractAddress "paused()" | grep true
   
   # If yes, execute pause (from multi-sig wallet)
   web3 contract execute pause --network mainnet --gas 100000
   ```
3. **Stop emissions** - Halt new retirement requests
   ```bash
   # Update backend to reject retire requests
   export CIRCUIT_BREAKER_RETIRE=enabled
   ```
4. **Notify users** - Post incident alert
5. **Capture contract state**
   ```bash
   # Export current state for analysis
   web3 account export-state 0xContractAddress > contract-state-backup.json
   ```

### Investigation Steps (5-20 minutes)
1. **Analyze failing transactions**
   ```bash
   # Get recent failed txns
   curl -s "https://etherscan.io/api?module=account&action=txlistinternal&address=0xContractAddress&sort=desc&apikey=YOUR_KEY" | jq '.result[] | select(.isError == "1")'
   
   # Check revert reason
   web3 debug trace transaction 0xTxHash
   ```
2. **Review contract code**
   - Compare on-chain bytecode to local version
   - Look for state inconsistencies
   - Check oracle data feeds
3. **Identify bug type**
   - Logic error (incorrect calculations)
   - State corruption (invalid storage values)
   - External call failure (oracle, token transfers)
   - Gas limit issue

### Mitigation Strategies

**Strategy 1: Temporary Contract Pause (5 min)**
- If contract is pausable, pause immediately
- Prevents new bad state
- No financial loss, but blocks users

**Strategy 2: Emergency Circuit Breaker (10 min)**
- Reduce transaction size limits
- Lower gas allowance temporarily
- Route high-risk operations to safe path
- Example configuration:
  ```solidity
  // Emergency mode configuration
  emit CircuitBreakerActivated(reason: "BUG_DETECTED");
  maxRetirementSize = 1 tonne; // reduced from 1000
  pausedFunctions = ["retire", "transfer"];
  ```

**Strategy 3: Rollback Deployment (30-60 min)**
- If contract uses proxy pattern:
  ```bash
  # Rollback to previous implementation
  web3 contract call ProxyAddress \
    upgradeTo(previousImplementation) \
    --from multisig \
    --network mainnet
  ```
- If permanent contract:
  - No direct rollback possible
  - Proceed to full bug fix + redeploy
  - Coordinate multi-sig vote

### Bug Fix Process (1-4 hours)
1. **Create fix branch**
   ```bash
   git checkout -b hotfix/contract-bug-#{issue_number}
   ```
2. **Write and unit test fix**
3. **Full test suite including edge cases**
4. **Get code review from 2+ senior engineers**
5. **Prepare upgrade transaction**
6. **Multi-sig vote and execution**
7. **Verify on-chain bytecode matches**

### Post-Contract Fix
```bash
# Verify fixed state
web3 contract call 0xNewAddress "getRetirementBalance()" --address userAddress

# Monitor for similar issues
grep -r "similarPattern" contracts/ --include="*.sol"

# Update tests to catch regression
# Update documentation with root cause
```

---

## Root Cause Analysis Template

Use this template for all post-incident reviews. Complete within 24 hours of incident resolution.

### Incident Details
- **Incident ID**: INC-YYYY-MM-DD-NNN
- **Date/Time Started**: YYYY-MM-DD HH:MM UTC
- **Date/Time Resolved**: YYYY-MM-DD HH:MM UTC
- **Total Duration**: X hours Y minutes
- **Impact Severity**: Critical / High / Medium / Low
- **Users Affected**: ~X% / Approximate number
- **Financial Impact**: $X (if any)

### Incident Summary
[2-3 sentence overview of what happened]

### Timeline

| Time | Event |
|------|-------|
| HH:MM | Detection: [How was it noticed?] |
| HH:MM | Initial investigation: [What was checked?] |
| HH:MM | Root cause identified: [What was wrong?] |
| HH:MM | Mitigation started: [What action was taken?] |
| HH:MM | Service recovered: [How was it fixed?] |
| HH:MM | Post-incident steps: [Validation & cleanup] |

### Root Cause Analysis

#### Primary Cause
[Specific technical root cause - be precise]

Example:
- Query lacked index on (userId, timestamp), causing full table scan on 50M rows
- Not: "Database was slow"
- Not: "High load"

#### Contributing Factors
1. [Factor that made problem worse]
2. [Factor that delayed detection]
3. [Factor that prevented earlier prevention]

Example:
- Monitoring alert threshold was 90% CPU instead of 80%
- Load test used only 10k concurrent users, not realistic peak
- No automated failover configured

#### Why We Didn't Catch This
[Prevention opportunity we missed]

Example:
- Load testing didn't include realistic data volume
- Code review didn't flag N+1 query
- Staging environment specs were 1/10th of production

### What Went Well
- Incident detected in X minutes
- Team responded immediately
- Clear communication maintained
- [Positive action taken]

### What We Can Improve
- [Specific improvement]
- [Specific improvement]
- [Specific improvement]

### Corrective Actions

| Action | Owner | Target Date | Status |
|--------|-------|-------------|--------|
| [Action description] | Name | YYYY-MM-DD | Open |
| [Action description] | Name | YYYY-MM-DD | Open |
| [Action description] | Name | YYYY-MM-DD | Open |

**Definition of Done for each action:**
- Code merged and tested
- Deployed to staging and production
- Monitoring added if applicable
- Documentation updated

---

## Communication Plan

### Phase 1: Initial Detection (T+0 minutes)
**Action**: Declare incident severity level
- **Critical**: Production down, data loss risk, security breach
- **High**: Major features unavailable, significant performance degradation
- **Medium**: Limited feature set affected, workarounds exist
- **Low**: Minor issues, no user impact

**Internal Notification** (within 2 minutes):
```
#incident-response Slack channel:
🚨 INCIDENT DECLARED: [Title]
- Severity: [CRITICAL/HIGH/MEDIUM/LOW]
- Service: [API/Database/Blockchain/etc]
- Status: INVESTIGATING
- Lead: @name
```

### Phase 2: Investigation (T+5-30 minutes)
**Status Updates** (every 10 minutes):
```
#incident-response
⏱️ UPDATE at [HH:MM] UTC
- Current Status: Investigating / Mitigating / Recovering
- Root Cause: [If known] / Under investigation
- ETA to Resolution: [If estimated] / Unknown
- Next Update: [Time]
```

### Phase 3: External Communication (if needed)
**For customer-facing issues** (T+10 minutes after detection):

**Email to affected customers**:
```
Subject: [Service] - Incident Alert

We're currently experiencing issues with [specific feature].
Severity: [Level]
Impact: [What's affected]
ETA: [Estimated recovery time or "being determined"]
Status Page: status.carbonledger.io

We'll update you every 30 minutes.
```

**Update status page** (status.carbonledger.io):
- Set components to "Degraded" or "Down"
- Post incident message
- Set update frequency

### Phase 4: Resolution (T+resolution)
**All-Clear Message**:
```
#incident-response
✅ RESOLVED at [HH:MM] UTC
- Service: Back to normal
- Root Cause: [Brief description]
- Post-incident review: Scheduled for [date]
- Incident report: Will be shared after RCA

Thank you for your patience.
```

**Customer notification**:
```
Email Subject: [Service] - Incident Resolved

The incident affecting [feature] has been resolved as of [time].
Service is operating normally.

Root cause: [Simple explanation]
We apologize for the inconvenience and appreciate your patience.
```

---

## Rollback Procedures

### Backend API Rollback

```bash
# 1. Identify current and previous versions
kubectl describe deployment carbonledger-api -n production | grep "Image:"
# Current: carbonledger:v1.23.4
# Previous: carbonledger:v1.23.3

# 2. Rollback to previous version
kubectl rollout undo deployment/carbonledger-api -n production

# 3. Verify rollback
kubectl rollout status deployment/carbonledger-api -n production

# 4. Confirm via health check
curl -s https://api.prod/health | jq '.version'
# Should show: v1.23.3

# 5. Monitor for issues
kubectl logs -f -l app=carbonledger -n production --tail=100
```

### Database Migration Rollback

```bash
# 1. Check migration history
npx prisma migrate status

# 2. Identify rollback target
# Migrations are numbered: 20260729000000_feature_name

# 3. Rollback specific number of steps
# WARNING: This can cause data loss. Coordinate with DBA.
# npx prisma migrate resolve --rolled-back 20260729000000_feature_name

# 4. Manual rollback (preferred for critical data)
# Restore from backup taken before migration
mysql backup_db < backup-20260729-before-migration.sql
```

### Smart Contract Rollback

```bash
# 1. For proxy contracts: downgrade implementation
web3 contract call ProxyAddress \
  upgradeTo(previousImplementationAddress) \
  --from multisig.eth \
  --network mainnet

# 2. Verify downgrade
web3 contract call ProxyAddress "implementation()" \
  --network mainnet

# 3. For non-upgradeable contracts: redeploy new contract
# (Requires user migration - not a true rollback)
```

---

## Post-Incident Review Process

### Timing
- **Severity Critical**: RCA within 24 hours, full review within 1 week
- **Severity High**: RCA within 48 hours, full review within 2 weeks
- **Severity Medium/Low**: RCA within 1 week

### Meeting Agenda (60 minutes)
1. **Timeline Review** (15 min)
   - What time did it start?
   - When was it detected?
   - When was it resolved?
   
2. **Root Cause Analysis** (20 min)
   - Primary cause
   - Contributing factors
   - Why detection was delayed?
   
3. **Impact Assessment** (10 min)
   - Users affected
   - Data affected
   - Financial impact
   
4. **Action Items** (10 min)
   - 3-5 specific, measurable actions
   - Assign owners
   - Set target dates
   
5. **Next Steps** (5 min)
   - Public incident report
   - Customer communication
   - Follow-up meeting date

### Deliverables
1. **Incident Report** - Shared with all stakeholders within 2 days
2. **Action Item Tracking** - Updated weekly until all items closed
3. **Public Statement** (if needed) - Posted to status page

### Escalation
If multiple similar incidents occur within 30 days:
- Escalate to architecture team
- Plan dedicated 1-week "incident prevention" sprint
- Review monitoring, testing, and deployment practices

---

## Contacts and Resources

**On-Call Rotation**: See https://calendar.carbonledger.io/oncall
**Incident Channel**: #incident-response on Slack
**Status Page**: https://status.carbonledger.io
**Runbook Repo**: https://github.com/carbonledger/runbooks
**Monitoring**: https://grafana.carbonledger.io (prod credentials in 1Password)
