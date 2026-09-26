# Failover Checklist

Quick reference for operational failovers. Use this alongside `FAILOVER_RUNBOOKS.md` for detailed procedures.

---

## Pre-Failover (Always Verify First)

- [ ] Confirm alert is not a false positive
- [ ] Verify the primary component is actually down
- [ ] Check recent deployments/changes
- [ ] Declare incident to #incidents
- [ ] Get SRE lead approval before proceeding
- [ ] Notify stakeholders of potential downtime

---

## Database Failover Checklist

**Estimated Duration: 15 minutes**

### Verification
- [ ] Primary database unreachable (connection timeout, not error)
- [ ] Read replica exists and is healthy
- [ ] Backup is accessible and recent (< 1 hour old)
- [ ] Replication lag is acceptable (< 30 seconds)

### Promotion
- [ ] Execute `SELECT pg_promote()` on replica
- [ ] Verify promotion: `SELECT pg_is_in_recovery()` returns false
- [ ] Update PgBouncer configuration
- [ ] Restart PgBouncer pods

### Validation
- [ ] API can connect to new primary
- [ ] Health check passes: `GET /health`
- [ ] Sample queries return data
- [ ] No connection pool errors in logs
- [ ] API response times normal (< 500ms p95)

### Post-Failover
- [ ] Document failure timestamp and root cause
- [ ] Schedule RCA meeting within 24 hours
- [ ] Begin restoring primary database
- [ ] Re-establish replication

---

## Redis Cache Failover Checklist

**Estimated Duration: 2-5 minutes**

### Verification
- [ ] Primary Redis unreachable via network
- [ ] Secondary Redis node is healthy
- [ ] Can connect to secondary: `redis-cli -h <secondary> PING`

### Failover
- [ ] Trigger Sentinel failover (if using Sentinel)
- [ ] Or manually: `SLAVEOF NO ONE` on secondary
- [ ] Update REDIS_URL connection string
- [ ] Restart API pods with new Redis URL

### Validation
- [ ] API can connect to new Redis
- [ ] SET/GET operations work
- [ ] Cache operations resuming (cache warming)
- [ ] No "Connection refused" errors in logs

### Post-Failover
- [ ] Accept cache miss performance hit (temporary)
- [ ] Monitor cache rebuilding (5 minutes)
- [ ] Restore primary Redis instance

---

## API Backend Recovery Checklist

**Estimated Duration: 2-5 minutes**

### Verification
- [ ] API pod is CrashLoopBackOff or ImagePullBackOff
- [ ] Liveness probe failed
- [ ] Load balancer removed pod from rotation

### Recovery
- [ ] Check logs for error: `kubectl logs <pod>`
- [ ] Delete unhealthy pod: `kubectl delete pod <name>`
- [ ] Or rollback deployment: `kubectl rollout undo deployment/api`
- [ ] Verify new pod starts (Ready status)

### Validation
- [ ] Pod status is Running and Ready
- [ ] No crash loop (restart count stable)
- [ ] Health check passes: `GET /health`
- [ ] API accepting requests (no 503 errors)

### Post-Failure
- [ ] Document error from logs
- [ ] If deployment issue, fix and redeploy
- [ ] If persistent, escalate to engineering lead

---

## Frontend Failover Checklist

**Estimated Duration: 5-15 minutes**

### Verification
- [ ] Frontend pages not loading or returning 502/503
- [ ] CDN reports high error rate
- [ ] DNS shows CDN edge node down

### Failover
- [ ] Check CDN provider status page
- [ ] If entire region down, update DNS to secondary CDN
- [ ] Clear CDN cache if needed
- [ ] Verify DNS propagation (watch propagation sites)

### Validation
- [ ] Website loads from browser
- [ ] Static assets (JS, CSS, images) load
- [ ] API calls work (CORS headers present)
- [ ] Performance acceptable

---

## Stellar Account Key Failover Checklist

**Estimated Duration: 5-30 minutes**

### Immediate (First 5 minutes)
- [ ] Verify key compromise (unauthorized transaction)
- [ ] Switch to backup signing key
- [ ] Restart signing service: `kubectl rollout restart deployment/blockchain-signer`
- [ ] Stop any pending operations that use compromised key

### Revocation (Next 10 minutes)
- [ ] Build transaction to revoke compromised key
- [ ] Execute revocation from primary or backup key
- [ ] Verify revocation: query Stellar account signers
- [ ] Compromised key no longer listed

### Recovery (Next 15 minutes)
- [ ] Generate new key pair (secure environment)
- [ ] Add new key as signer to account
- [ ] Test signing with new key
- [ ] Update environment with new key
- [ ] Restart services with new key

### Validation
- [ ] New key is accepting transactions
- [ ] Stellar account balance unchanged
- [ ] No transaction queue backlog
- [ ] Monitoring shows successful signs with new key

---

## Network Failover Checklist

**Estimated Duration: 5-15 minutes**

### Verification
- [ ] Network route down or unreachable
- [ ] BGP not advertising prefix
- [ ] ISP circuit down

### Failover (BGP)
- [ ] Verify secondary ISP connection is up
- [ ] Remove primary prefix from BGP advertisement
- [ ] Add secondary prefix to BGP advertisement
- [ ] Monitor BGP convergence (typically < 1 minute)

### Failover (DNS)
- [ ] Update DNS A record to secondary ISP IP
- [ ] Check TTL (ideally < 60 seconds)
- [ ] Monitor DNS propagation across resolvers

### Validation
- [ ] Network connectivity restored
- [ ] DNS resolves to secondary address
- [ ] Latency acceptable from affected regions
- [ ] No packet loss (< 0.1%)
- [ ] API responding normally

---

## Post-Failover (Every Failover)

**Timeline: Immediately**

- [ ] Declare incident resolved (status page)
- [ ] Send resolution notification to stakeholders
- [ ] Stop incident timer
- [ ] Begin RCA process

**Timeline: 24 hours**

- [ ] Complete RCA document
- [ ] Identify root cause
- [ ] List action items
- [ ] Schedule team retrospective

**Timeline: 1 week**

- [ ] Execute action items
- [ ] Update procedures based on findings
- [ ] Schedule training if needed
- [ ] Close RCA

---

## Escalation Matrix

| Problem | On-Call | On-Call + 15min | Manager | Director |
|---------|---------|-----------------|---------|----------|
| Single pod down | Investigate | Escalate if not resolved | Notify | Notify |
| Database failover | Execute runbook | Escalate if fails | Notify | Notify if > 30min |
| Multi-component | Execute runbooks | Coordinate recovery | Involved | Involved if > 1hr |
| Security incident | Isolate | Investigate | Lead | Involved |

---

## Common Issues & Quick Fixes

### Issue: "Connection refused"
```bash
# Check service is running
kubectl get pods -l app=<service>

# Check port
netstat -ltn | grep <port>

# Restart service
kubectl rollout restart deployment/<service>
```

### Issue: "DNS not resolving"
```bash
# Check DNS records
dig <hostname> +short

# Clear local DNS cache (if applicable)
sudo systemctl restart systemd-resolved

# Check DNS propagation
nslookup <hostname> 8.8.8.8
```

### Issue: "Memory pressure"
```bash
# Check memory usage
kubectl top nodes
kubectl top pods

# Evict unnecessary pods
kubectl get pods --sort-by=.spec.containers[0].resources.requests.memory

# Increase resource limits if needed
```

### Issue: "High latency"
```bash
# Check database connections
SELECT count(*) FROM pg_stat_activity;

# Monitor network
kubectl exec <pod> -- ping -c 5 <remote-host>

# Check logs for slow queries
kubectl logs <pod> | grep SLOW
```

---

## Emergency Contacts

**Operational** (Maintenance operations)
- [ ] Primary On-Call: [Phone]
- [ ] Backup On-Call: [Phone]

**Escalation** (Multiple component failure)
- [ ] SRE Lead: [Phone]
- [ ] Engineering Manager: [Phone]

**Executive** (> 1 hour downtime)
- [ ] VP Engineering: [Phone]
- [ ] CTO: [Phone]

**External** (Vendor issues)
- [ ] AWS Support: [Account ID]
- [ ] Database Support: [Contract #]

---

## Pre-Failover Test

Run quarterly to validate procedures:

```bash
# 1. Schedule test window (low traffic period)
# 2. Notify team of test
# 3. Execute failover procedure
# 4. Measure RTO/RPO
# 5. Document findings
# 6. Restore original setup
# 7. Review lessons learned
```

---

## Key Principles

1. **Always verify first** - Don't assume failure
2. **Document everything** - Timestamps, actions, results
3. **Communicate updates** - Every 15 minutes during incident
4. **Safety first** - Better to be slow than make things worse
5. **Post-mortem focus** - Learn and improve, not blame

---

**Last Updated:** August 28, 2026  
**Next Review:** August 28, 2027

