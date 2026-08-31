# Incident Response Guide

**Version:** 1.0  
**Last Updated:** August 28, 2026

---

## Incident Response Workflow

### Phase 1: Detection & Alerting (0-5 min)

1. **Automatic Alert Triggered**
   - Health check failure detected
   - Alert sent to #critical-alerts Slack channel
   - PagerDuty page sent to on-call engineer
   - Status page updated to "Investigating"

2. **Initial Triage**
   - Check alert details: component, error code, affected region
   - Verify alert is not a false positive
   - Review related logs in last 5 minutes

3. **Initial Communication**
   ```
   Post to #incidents:
   🚨 INCIDENT DECLARED
   Service: [Component]
   Severity: [Critical/High/Medium]
   Impact: [Users affected, features down]
   On-Call: [Name]
   Time: [Timestamp]
   ```

### Phase 2: Investigation (5-15 min)

1. **Gather Information**
   - Logs: `kubectl logs <pod-name> --tail=100`
   - Metrics: Check CPU, memory, network, disk in monitoring dashboard
   - Dependencies: Verify database, Redis, Stellar connectivity
   - Error pattern: Full-text search logs for error codes

2. **Identify Scope**
   - Affected services: API, web, background jobs
   - Geographic impact: Region(s), CDN nodes
   - User impact: Percentage affected, critical functionality down

3. **Determine Category**
   - Infrastructure failure (database, cache, load balancer)
   - Application error (code bug, deployment issue)
   - Dependency failure (Stellar, third-party API)
   - Security incident (DDoS, intrusion attempt)

### Phase 3: Mitigation (Immediate)

**If Database Issue:**
1. Check replication lag: `SELECT now() - pg_last_xact_replay_timestamp();`
2. Check connection count: `SELECT count(*) FROM pg_stat_activity;`
3. Attempt graceful recovery: restart connection pool
4. If fails, initiate failover (see Failover Runbooks)

**If API Issue:**
1. Check logs for crash pattern
2. Kill unhealthy pods: `kubectl delete pod <pod-name>`
3. Monitor for auto-restart and recovery
4. If persistent, rollback last deployment

**If Cache Issue:**
1. Monitor without cache: confirm app functions
2. Restart Redis: `kubectl delete pod <redis-pod>`
3. Allow cache rebuild from database
4. Monitor performance recovery

**If Stellar Connectivity:**
1. Verify network connectivity: `curl https://horizon-testnet.stellar.org`
2. Check IP allowlist (if any)
3. Switch to backup Horizon URL (if configured)
4. Queue operations (don't fail user requests)

### Phase 4: Recovery & Verification (15-60 min)

1. **Health Checks**
   ```bash
   # API health
   curl https://api.carbonledger.io/health | jq
   
   # Database connectivity
   kubectl exec <pod> -- npm run health:db
   
   # Sample transactions
   curl https://api.carbonledger.io/projects?limit=1
   ```

2. **Functionality Verification**
   - Test registration flow (if impacted)
   - Test credit operations (if impacted)
   - Test retirement flow (if impacted)
   - Verify no data corruption

3. **Performance Baseline**
   - Response times normalize
   - CPU/memory return to baseline
   - No error rate spike

### Phase 5: Communication & Closure (60+ min)

1. **Final Update**
   ```
   ✅ RESOLVED
   Service: [Component]
   Duration: [Total time]
   Root Cause: [Brief description]
   Impact: [Final tally - users affected, data affected]
   Timeline:
   - [Time] Initial detection
   - [Time] Mitigation started
   - [Time] Service recovered
   Next: RCA scheduled for [time]
   ```

2. **Schedule Post-Mortem**
   - Within 24 hours for critical incidents
   - Within 48 hours for high severity
   - Format: 1 hour meeting with engineering team
   - Output: Written RCA document

3. **Status Page**
   - Resolve incident on status.carbonledger.io
   - Post final timeline and resolution
   - Link to public RCA (if applicable)

---

## Incident Categories & Response Times

### Critical Incidents
- **Definition:** Service completely down (API, database, auth)
- **SLO:** Acknowledge within 5 min, mitigation within 15 min
- **Response:** Page on-call + escalate to manager
- **Communication:** Every 15 minutes until resolved

### High Severity Incidents
- **Definition:** Major feature unavailable, performance degraded > 50%
- **SLO:** Acknowledge within 15 min, mitigation within 30 min
- **Response:** Contact on-call team
- **Communication:** Every 30 minutes

### Medium Severity Incidents
- **Definition:** Minor feature impact, degradation < 50%
- **SLO:** Acknowledge within 1 hour
- **Response:** Internal engineering team
- **Communication:** Once resolved

---

## Common Incidents & Quick Fixes

### Issue: High Database Connection Count

**Detection:**
```
Alert: "Database connection pool exhausted (45/50)"
```

**Quick Fix:**
```bash
# 1. Check active queries
kubectl exec <db-pod> -- psql -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"

# 2. Kill idle connections older than 10 minutes
kubectl exec <db-pod> -- psql -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
   WHERE state = 'idle' AND now() - pg_stat_activity.query_start > interval '10 minutes';"

# 3. Restart connection pooler
kubectl rollout restart deployment/pgbouncer

# 4. Monitor recovery
kubectl get pods -l app=pgbouncer -w
```

### Issue: Memory Leak in API

**Detection:**
```
Alert: "API memory usage 85% (6GB/8GB)"
Pattern: Memory increases 2-3% every 5 minutes
```

**Quick Fix:**
```bash
# 1. Trigger graceful shutdown
kubectl exec <api-pod> -- kill -SIGTERM 1

# 2. Let pod restart (auto-replacement)
kubectl get pod <api-pod> --watch

# 3. If recurs, identify which request
kubectl logs <api-pod> --since=10m | grep -E "POST|PUT|DELETE"

# 4. Rollback if recent deployment
git revert <commit-hash>
git push
# Wait for CI/CD deployment
```

### Issue: Stellar Network Unavailable

**Detection:**
```
Error: "Failed to connect to Horizon: timeout"
```

**Quick Fix:**
```bash
# 1. Check connectivity
curl -v https://horizon-testnet.stellar.org/

# 2. If Horizon is down, check status
# https://stellar.statuspage.io/

# 3. Switch to backup Horizon (if configured)
kubectl set env deployment/api \
  STELLAR_HORIZON_URL=https://horizon-backup.example.com

# 4. Re-queue failed operations (after 5 min)
kubectl exec <queue-pod> -- npm run queue:reprocess
```

### Issue: Redis Replication Lag

**Detection:**
```
Alert: "Redis replication lag 30 seconds"
```

**Quick Fix:**
```bash
# 1. Check replication status
redis-cli info replication

# 2. If slave connection broken
redis-cli slaveof [master-ip] 6379

# 3. Monitor lag recovery
watch -n 1 "redis-cli info replication | grep offset"

# 4. If lag grows, restart slave
kubectl delete pod <redis-slave-pod>
```

### Issue: IPFS Node Connectivity

**Detection:**
```
Error: "IPFS gateway timeout"
```

**Quick Fix:**
```bash
# 1. Check node health
curl http://ipfs.local:5001/api/v0/id

# 2. Check pinned content
curl http://ipfs.local:5001/api/v0/pin/ls

# 3. Restart node if stuck
kubectl rollout restart deployment/ipfs

# 4. Check for pin queue backup
kubectl logs <ipfs-pod> | tail -50
```

---

## Escalation Matrix

```
Severity    │ 5 min           │ 15 min          │ 30 min        │ 60 min
────────────┼─────────────────┼─────────────────┼───────────────┼─────────
Critical    │ On-call Page    │ Escalate to     │ Manager       │ Director
            │                 │ Tech Lead       │ Notified      │ Notified
────────────┼─────────────────┼─────────────────┼───────────────┼─────────
High        │ Alert sent      │ Team contacted  │ Manager opt   │ Escalate
            │                 │                 │               │
────────────┼─────────────────┼─────────────────┼───────────────┼─────────
Medium      │ Logged          │ Team aware      │ Plan response │ Assign
            │                 │                 │               │
```

---

## Post-Incident Process

### 1. Immediate (Day 1)

- [ ] Incident severity confirmed
- [ ] Stakeholders notified
- [ ] Preliminary root cause identified
- [ ] Workaround or fix applied
- [ ] RCA meeting scheduled

### 2. RCA Meeting (Within 24 hours)

**Attendees:** On-call engineer, engineer who deployed, manager

**Agenda:**
- Timeline of events
- Root cause analysis (5 whys)
- How was it detected?
- What mitigation was applied?
- Why wasn't this caught in testing?

**Output:**
- Written RCA document (1-2 pages)
- Action items with assigned owners
- Timeline for fixes

### 3. Action Items

**Categories:**
1. **Preventative:** Changes to prevent recurrence
2. **Detective:** Improvements to catch earlier
3. **Responsive:** Faster mitigation procedures

**Examples:**
- Add new alerting threshold
- Implement feature flag for fast rollback
- Add integration test for scenario
- Update runbook procedures
- Schedule training session

### 4. Public Communication

**If customer-facing:**
- Post to status page with timeline
- Send email to affected customers
- Include prevention measures taken
- Link to public RCA (if sharing)

**If internal only:**
- Post summary to #incidents
- Share lessons learned email
- Track metrics (MTTR, recovery success)

---

## Incident Metrics & Tracking

### Metrics to Log

```json
{
  "incident_id": "INC-2026-08-001",
  "service": "api",
  "severity": "critical",
  "detection_time": "2026-08-28T14:30:00Z",
  "mitigation_time": "2026-08-28T14:42:00Z",
  "resolution_time": "2026-08-28T15:15:00Z",
  "mttr_minutes": 45,
  "root_cause": "Connection pool exhaustion",
  "user_impact": "500 users affected for 45 minutes",
  "data_loss": "none",
  "prevention_items": 3
}
```

### KPIs

- **Mean Time to Detection (MTTD):** < 5 minutes
- **Mean Time to Mitigation (MTTM):** < 15 minutes
- **Mean Time to Resolution (MTTR):** < 1 hour
- **Mean Time Between Failures (MTBF):** > 30 days
- **Incident recurrence rate:** < 5% same-root-cause within 30 days

---

## Tools & Resources

### Monitoring & Logs
- **Monitoring Dashboard:** [Link to Grafana/DataDog]
- **Log Aggregation:** [Link to ELK/Datadog]
- **APM Tracing:** [Link to Jaeger/Datadog APM]
- **On-Call Schedule:** [Link to PagerDuty]

### Runbooks & Procedures
- **Database Failover:** `docs/FAILOVER_RUNBOOKS.md#database-failover`
- **API Recovery:** `docs/FAILOVER_RUNBOOKS.md#api-recovery`
- **Network Troubleshooting:** `scripts/network-troubleshooting.sh`
- **Emergency Rollback:** `scripts/emergency-rollback.sh`

### Communication
- **Status Page:** status.carbonledger.io
- **Slack Channels:** #incidents, #critical-alerts, #sre-on-call
- **Email Lists:** incident-response@, stakeholders@
- **Escalation:** [Phone numbers in secure vault]

---

**Next Review:** August 28, 2027

