# Failover Runbooks

**Version:** 1.0  
**Last Updated:** August 28, 2026  
**Purpose:** Step-by-step procedures for recovering from specific failure scenarios

---

## Table of Contents

1. [Database Failover](#database-failover)
2. [Redis Cache Failover](#redis-cache-failover)
3. [API Backend Recovery](#api-backend-recovery)
4. [Frontend Failover](#frontend-failover)
5. [Stellar Account Recovery](#stellar-account-recovery)
6. [Network Failover](#network-failover)

---

## Database Failover

### Prerequisites
- [ ] Verify read replica exists and is healthy
- [ ] Confirm backup is accessible
- [ ] Verify DNS failover is configured
- [ ] Notify team via #incidents

### Automatic Failover Procedure

**Estimated Time: 10-15 minutes**

#### Step 1: Verify Primary Database is Down

```bash
# Attempt connection to primary
kubectl exec <api-pod> -- psql \
  postgresql://user:pass@db-primary.default.svc.cluster.local:5432/carbonledger \
  -c "SELECT 1;"

# Expected: Connection timeout or "server closed the connection unexpectedly"
# If connection succeeds, it's NOT a database failure - investigate further
```

#### Step 2: Confirm Read Replica Status

```bash
# Check replica health
kubectl exec <api-pod> -- psql \
  postgresql://user:pass@db-replica.default.svc.cluster.local:5432/carbonledger \
  -c "SELECT now(), pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();"

# Expected output:
# now              │ pg_last_wal_receive_lsn │ pg_last_wal_replay_lsn
# ─────────────────┼────────────────────────┼──────────────────────
# [recent timestamp] │ [recent LSN]          │ [recent LSN]
```

**If replica is lagged > 10 seconds:**
- Wait up to 30 seconds for replication to catch up
- If lag persists, proceed with potentially stale data (data loss possible)

#### Step 3: Promote Read Replica to Primary

```bash
# SSH or kubectl into replica pod
kubectl exec <db-replica-pod> -- bash

# Run promotion command
psql -U postgres -c "SELECT pg_promote();"

# Verify promotion (should show false for pg_is_in_recovery)
psql -U postgres -c "SELECT pg_is_in_recovery();"

# Expected: f (false - not in recovery = is now primary)

# Exit pod
exit
```

#### Step 4: Update PgBouncer Configuration

```bash
# Edit PgBouncer config
kubectl edit configmap pgbouncer-config

# Change primary database connection string:
# FROM: host=db-primary.default.svc.cluster.local
# TO:   host=db-replica.default.svc.cluster.local

# Save (Ctrl+X in vim)

# Restart PgBouncer
kubectl rollout restart deployment/pgbouncer

# Wait for pods to be ready
kubectl wait --for=condition=ready pod \
  -l app=pgbouncer --timeout=60s
```

#### Step 5: Verify Connection Pool

```bash
# Test connection through updated pool
kubectl exec <api-pod> -- npm run health:db

# Expected: "Database: OK"
# If failed, check logs: kubectl logs <pgbouncer-pod>
```

#### Step 6: Monitor API Recovery

```bash
# Watch API pod restarts
kubectl get pods -l app=api --watch

# Check API logs for connection recovery
kubectl logs <api-pod> --tail=50 -f

# Expected: No connection errors, API accepting requests
```

#### Step 7: Verify Data Integrity

```bash
# Connect to new primary (former replica)
kubectl exec <db-replica-pod> -- psql \
  postgresql://user:pass@localhost:5432/carbonledger -c \
  "SELECT table_name, n_live_tup FROM pg_stat_user_tables 
   ORDER BY n_live_tup DESC LIMIT 10;"

# Compare row counts against documented baselines
# Example baseline:
# CarbonProject: ~5,000
# CreditBatch: ~50,000
# RetirementRecord: ~100,000

# Verify recent transaction
psql -c "SELECT COUNT(*) FROM RetirementRecord 
         WHERE createdAt > now() - interval '1 hour';"
```

#### Step 8: Validate Application Functionality

```bash
# Test critical flows
curl https://api.carbonledger.io/projects?limit=1
# Expected: 200 OK with project list

curl https://api.carbonledger.io/retirements \
  -H "Authorization: Bearer <token>"
# Expected: 200 OK with retirements

# Monitor error rate for 5 minutes
# Expected: < 0.1% 5xx errors
```

### Manual Failover (Standalone Database)

If promotion from replica fails:

#### Restore from Full Backup

```bash
# Stop API servers (prevent writes)
kubectl scale deployment api --replicas=0

# Get latest backup
aws s3 ls s3://backup-bucket/db-backups/ | sort | tail -1
# Copy to local: aws s3 cp s3://backup-bucket/db-backups/carbonledger_20260828.dump .

# Create new database (on failover host)
createdb -U postgres carbonledger_restore

# Restore from backup
pg_restore --clean --if-exists \
  --dbname=postgresql://user:pass@failover-db:5432/carbonledger_restore \
  carbonledger_20260828.dump

# Verify restore completed
psql -c "SELECT COUNT(*) FROM CarbonProject;"

# Point PgBouncer to new database
# (Update connection string as in Step 4)

# Restart API servers
kubectl scale deployment api --replicas=3

# Acknowledge potential data loss (see RPO target)
```

#### Restore to Point-in-Time (PITR)

```bash
# If backup is recent and WAL archive is available
# Target time: YYYY-MM-DD HH:MM:SS in UTC

# Create new database
createdb -U postgres carbonledger_pitr

# Restore with recovery target
pg_basebackup -D /tmp/pitr_restore -R -X stream

# Edit recovery configuration
# In recovery.conf:
recovery_target_timeline = 'latest'
recovery_target_type = 'time'
recovery_target_time = '2026-08-28 14:30:00'  # Adjust to desired time
recovery_target_action = 'promote'

# Start recovery
pg_ctl -D /tmp/pitr_restore start

# Monitor recovery progress
tail -f /tmp/pitr_restore/log/postgresql.log | grep "recovery"

# When complete, switch PgBouncer
# (Update connection string as in Step 4)
```

### Validation Checklist

- [ ] Read replica promoted successfully
- [ ] PgBouncer points to new primary
- [ ] API pods restarted and healthy
- [ ] Data row counts match baseline
- [ ] No recent transaction data lost (within RPO)
- [ ] Error rate < 0.1% for 5 minutes
- [ ] Team notified of successful failover
- [ ] Begin replication setup for new standby

---

## Redis Cache Failover

### Prerequisites
- [ ] Redis Sentinel configured (or manual failover ready)
- [ ] Backup Redis node(s) available
- [ ] API can tolerate cache miss (graceful degradation)

### Automatic Failover (Sentinel)

**Estimated Time: 2-5 minutes**

```bash
# Check Sentinel status
redis-cli -h sentinel.default.svc.cluster.local -p 26379 \
  sentinel masters

# Expected: master_status: ok, slave connected (if replication healthy)

# If master is down, Sentinel will automatically:
# 1. Detect failure (after 3 missed pings)
# 2. Trigger election
# 3. Promote slave to master
# 4. Reconfigure other slaves

# Monitor the election (this takes 10-30 seconds)
watch -n 1 "redis-cli -h sentinel.default.svc.cluster.local -p 26379 sentinel masters"

# When election completes, master will change to new node
# Connected clients will be redirected automatically (if using redis-cli with Sentinel)
```

### Manual Failover (No Sentinel)

```bash
# Verify primary is down
redis-cli -h redis-primary:6379 PING
# Expected: Error connecting

# Connect to healthy replica
redis-cli -h redis-replica:6379

# Promote replica to master
SLAVEOF NO ONE

# Verify promotion
INFO replication
# Expected: role: master

# Exit
exit

# Update Redis connection string in API
kubectl set env deployment/api \
  REDIS_URL=redis://redis-replica:6379

# Restart API to pick up new connection
kubectl rollout restart deployment/api

# Monitor cache warming
# (Cache will miss on first request, then hit on subsequent)
kubectl logs <api-pod> -f | grep "cache"
```

### Validation Checklist

- [ ] New Redis master is accepting writes
- [ ] PING succeeds
- [ ] API can connect and set/get keys
- [ ] Cache hit rate recovers within 5 minutes
- [ ] Sessions are still valid (if session store)
- [ ] Rate limiting state is rebuilt

### Recovery Impact
- **Sessions**: Lose if Redis completely lost (users must re-authenticate)
- **Rate Limits**: Reset (brief window of potential abuse)
- **Query Cache**: Rebuilt on first request (temporary performance impact)

---

## API Backend Recovery

### Prerequisites
- [ ] Multiple API replicas running (minimum 3)
- [ ] Liveness & readiness probes configured
- [ ] Blue-green or canary deployment setup ready

### Automatic Pod Recovery

**Estimated Time: 2-5 minutes**

```bash
# Kubernetes automatically restarts unhealthy pods
# Check pod status
kubectl get pods -l app=api

# Expected: CrashLoopBackOff or ImagePullBackOff for unhealthy pods
# Kubernetes will restart with exponential backoff

# Monitor pod recovery
kubectl get pods -l app=api --watch

# Expected: Pod restarts, becomes Ready after 30-60 seconds
```

### Manual Pod Restart

```bash
# If auto-restart not working, manually delete pod
kubectl delete pod <api-pod-name>

# Kubernetes replica controller will spawn new pod
kubectl get pods -l app=api --watch

# Verify new pod becomes Ready
# Check logs for errors
kubectl logs <api-pod-name> --tail=100
```

### Rollback Failed Deployment

```bash
# View rollout history
kubectl rollout history deployment/api

# Identify problematic revision
# Look at timestamps and descriptions

# Rollback to previous version
kubectl rollout undo deployment/api

# Verify rollback
kubectl get pods -l app=api --watch

# Watch for errors in logs
kubectl logs <api-pod-name> -f | grep -i error
```

### Emergency Rollback (Feature Flag)

```bash
# If full rollback takes too long, disable new feature via flag
kubectl set env deployment/api \
  FEATURE_FLAG_NEW_ENDPOINT=false

# Restart pods to pick up flag
kubectl rollout restart deployment/api

# Verify service recovery
curl https://api.carbonledger.io/health
```

### Validation Checklist

- [ ] All API pods are Ready and Running
- [ ] `/health` endpoint returns 200 OK
- [ ] Error rate < 0.1% for 5 minutes
- [ ] Response time baseline returned
- [ ] Database connections established
- [ ] Queue jobs resuming normally

---

## Frontend Failover

### Prerequisites
- [ ] Frontend on CDN with failover configured
- [ ] Multiple CDN providers or regions available
- [ ] DNS failover configuration ready

### CDN Failover

**Estimated Time: 5-15 minutes (DNS propagation)**

```bash
# Check current CDN status
dig frontend.carbonledger.io +short
# Expected: current CDN IP

# If CDN edge node fails:
# 1. CDN provider automatically reroutes to healthy edge
# 2. Users redirected to secondary region (automatic)

# To manually failover to secondary CDN:

# Update DNS record
# Via DNS provider UI or CLI:
# frontend.carbonledger.io A record → secondary-cdn.example.com

# Purge CDN cache (if needed)
curl -X PURGE https://secondary-cdn.example.com/*

# Verify DNS propagation
dig frontend.carbonledger.io +short
# Expected: secondary CDN IP

# Wait for propagation (TTL: 300 seconds = 5 min)
# Watch propagation: https://whatsmydns.net/?d=frontend.carbonledger.io
```

### Browser Cache Invalidation

```bash
# If users have stale cache, force refresh
# Add cache-busting query parameter to CDN cache control header

# Update CDN cache-control policy:
# Cache-Control: public, max-age=300, must-revalidate
# (Reduced from 3600 to 300 seconds)

# Purge entire cache
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/*"

# Alternative: Purge specific paths
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/app/*" "/assets/*"
```

### Validation Checklist

- [ ] Frontend loads from secondary CDN
- [ ] No mixed content warnings (HTTPS working)
- [ ] Static assets load (JS, CSS, images)
- [ ] API integration working (CORS headers OK)
- [ ] Performance metrics acceptable

---

## Stellar Account Recovery

### Prerequisites
- [ ] Secondary signing key pre-generated and stored in secure vault
- [ ] Backup signing key never used in production
- [ ] Stellar account transaction capacity: 4+ signers

### Immediate Response (Key Compromise)

**Estimated Time: 5-30 minutes**

```bash
# STEP 1: Switch to backup key immediately
# Update environment variables (in secure way)
export STELLAR_SIGNING_KEY=<BACKUP_KEY_SECRET>

# Restart services that use signing key
kubectl rollout restart deployment/blockchain-signer
kubectl rollout restart deployment/oracle-worker

# STEP 2: Revoke compromised key from Stellar account
# (Use master key or existing multi-sig setup)

# Build transaction to remove signer
npm run stellar:revoke-signer -- \
  --compromised-key=<COMPROMISED_PUBLIC_KEY> \
  --signing-key=<MASTER_OR_BACKUP_KEY>

# Expected output: Transaction XDR hash and confirmation

# STEP 3: Verify key is revoked
curl https://horizon-testnet.stellar.org/accounts/<ACCOUNT_ID> | \
  jq '.signers[] | select(.public_key == "<COMPROMISED_KEY>")'

# Expected: Empty result (key no longer listed)

# STEP 4: Rotate to new key pair
# Generate new key securely
npm run stellar:generate-keypair --output=secure

# Store in vault (separate from production)
# Add as signer to account:
npm run stellar:add-signer -- \
  --new-key=<NEW_PUBLIC_KEY> \
  --signing-key=<BACKUP_KEY>

# STEP 5: Post-Incident
# - Update backup key as "secondary"
# - Designate new key as backup
# - Document timeline
```

### Key Rotation Schedule

```bash
# Recommended: Quarterly key rotation

# STEP 1: Generate new keypair (offline, secure environment)
stellar-core --gen-seed | tee new_key.secret

# STEP 2: Add new key as signer to account
npm run stellar:add-signer -- \
  --new-key=<NEW_PUBLIC_KEY> \
  --signing-key=<CURRENT_KEY>

# STEP 3: Verify new key is functional
npm run stellar:test-signer -- --key=<NEW_PUBLIC_KEY>

# STEP 4: Update environment to use new key
# (blue-green deployment or feature flag)
kubectl set env deployment/blockchain-signer \
  STELLAR_SIGNING_KEY=<NEW_KEY_SECRET>

# STEP 5: Monitor transactions with new key
kubectl logs <pod> -f | grep "signature"

# STEP 6: Remove old key (after verification)
npm run stellar:revoke-signer -- \
  --compromised-key=<OLD_PUBLIC_KEY> \
  --signing-key=<NEW_KEY>

# STEP 7: Store old key for historical record (encrypted)
```

### Validation Checklist

- [ ] Backup key is being used for signatures
- [ ] Compromised key is no longer accepting transactions
- [ ] New transactions are processing normally
- [ ] Stellar account balance unchanged
- [ ] No transaction queue backlog
- [ ] Monitoring shows no signing errors

---

## Network Failover

### Prerequisites
- [ ] Backup network providers configured (ISP, VPN, etc.)
- [ ] Multi-region setup available
- [ ] BGP/DNS failover configured

### BGP Failover (If on-premises)

```bash
# Monitor BGP status
show ip bgp summary

# If primary prefix is not advertised:
# 1. Check router status
# 2. Verify prefix is configured
# 3. Check BGP neighbor status

# Manual failover to secondary ISP:
! Disable primary route
router bgp <ASN>
  no aggregate-address <PRIMARY_PREFIX>

! Enable secondary route
router bgp <ASN>
  aggregate-address <SECONDARY_PREFIX>

# Verify announcement
show ip bgp summary
show ip bgp advertised-summary
```

### DNS Failover

```bash
# Check current DNS resolution
dig api.carbonledger.io +short @8.8.8.8
# Expected: current region IP

# Update DNS to failover IP
# Via DNS provider:
# api.carbonledger.io A record → backup-region-ip

# Verify propagation
dig api.carbonledger.io +short @8.8.8.8
dig api.carbonledger.io +short @1.1.1.1
dig api.carbonledger.io +short @208.67.222.222

# Wait for TTL expiration and propagation
# (TTL: 60 seconds typically)
```

### Validation Checklist

- [ ] Network connectivity restored
- [ ] DNS resolving to failover address
- [ ] Latency acceptable from affected regions
- [ ] No packet loss detected
- [ ] API responding normally
- [ ] External services (Stellar, IPFS) reachable

---

## Post-Failover Actions

### Immediately After (First Hour)

1. **Verify Everything**
   - [ ] All health checks passing
   - [ ] No errors in logs
   - [ ] Performance metrics baseline
   - [ ] User reports coming in (monitor support channels)

2. **Communicate**
   - [ ] Update status page: "Resolved"
   - [ ] Post final incident summary
   - [ ] Notify stakeholders

3. **Begin RCA**
   - [ ] Collect logs and metrics
   - [ ] Document timeline
   - [ ] Schedule RCA meeting within 24 hours

### Within 24 Hours

1. **Service Restoration**
   - [ ] Restore failed primary component
   - [ ] Rebuild replication setup
   - [ ] Verify new standby is healthy

2. **Data Reconciliation**
   - [ ] Compare production to backup data
   - [ ] Identify any data loss
   - [ ] Reconcile customer records if affected

3. **Capacity Planning**
   - [ ] Evaluate need for additional replicas
   - [ ] Review monitoring thresholds
   - [ ] Plan infrastructure improvements

---

**Next Review:** August 28, 2027

