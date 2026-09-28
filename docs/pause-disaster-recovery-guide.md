# Pause Feature: Disaster Recovery Procedures

> **Closes:** #1208  
> **Last updated:** 2026-09-26  
> **See also:** [Pause Architecture](pause-architecture.md) | [Pause Operations Guide](PAUSE_OPERATIONS_GUIDE.md) | [Emergency Pause Runbook](runbooks/emergency-pause.md) | [Incident Response](INCIDENT_RESPONSE.md)

This document defines end-to-end disaster recovery (DR) procedures for the CarbonLedger pause feature. It covers backup procedures, restore procedures, backup testing, data consistency checks, rollback procedures, and recovery time objectives (RTO) for both the on-chain pause state and the off-chain systems that interact with it.

---

## Table of Contents

- [Recovery Objectives](#recovery-objectives)
- [Scope and Boundaries](#scope-and-boundaries)
- [Backup Procedures](#backup-procedures)
  - [On-Chain State Snapshot](#on-chain-state-snapshot)
  - [Off-Chain Database Backup](#off-chain-database-backup)
  - [Configuration Backup](#configuration-backup)
- [Restore Procedures](#restore-procedures)
  - [Restoring Pause State After Admin Key Loss](#restoring-pause-state-after-admin-key-loss)
  - [Restoring Off-Chain Database](#restoring-off-chain-database)
  - [Restoring Backend Services](#restoring-backend-services)
- [Testing Backups](#testing-backups)
  - [Weekly Restore Drill](#weekly-restore-drill)
  - [Monthly Full DR Test](#monthly-full-dr-test)
  - [Automated Backup Verification](#automated-backup-verification)
- [Data Consistency Checks](#data-consistency-checks)
  - [On-Chain vs Off-Chain Reconciliation](#on-chain-vs-off-chain-reconciliation)
  - [Pause State Integrity Checks](#pause-state-integrity-checks)
  - [Event Audit Trail Verification](#event-audit-trail-verification)
- [Rollback Procedures](#rollback-procedures)
  - [Rolling Back an Accidental Pause](#rolling-back-an-accidental-pause)
  - [Rolling Back a Failed Unpause](#rolling-back-a-failed-unpause)
  - [Rolling Back a Contract Upgrade Applied During Pause](#rolling-back-a-contract-upgrade-applied-during-pause)
- [Emergency Escalation Workflow](#emergency-escalation-workflow)
- [Post-Recovery Checklist](#post-recovery-checklist)
- [Related Documents](#related-documents)

---

## Recovery Objectives

| Objective | Target | Notes |
|-----------|--------|-------|
| **Recovery Point Objective (RPO)** | 0 transactions lost | All transactions committed before the pause ledger close are final and immutable on Stellar. No data can be lost on-chain. |
| **Recovery Time Objective (RTO) — Emergency pause execution** | < 5 minutes from incident declaration | Admin can execute pause via CLI even if dashboard is unavailable. See [Step-by-Step Pause Execution](#step-1-execute-emergency-pause). |
| **RTO — Off-chain backend quarantine** | < 10 minutes | Backend queue workers stopped, Redis cache set to read-only mode. |
| **RTO — Data consistency verification** | < 30 minutes | Automated reconciliation script compares on-chain storage with PostgreSQL. |
| **RTO — Full incident resolution and unpause** | < 24 hours (target); 72 hours (hard cap) | The contract auto-expires after 72 hours if not manually unpaused. |
| **RTO — Off-chain database restore from backup** | < 2 hours | Point-in-time restore from PostgreSQL backup to the last consistent snapshot. |

> The 72-hour auto-expiry cap is enforced in-contract. If the team cannot resolve an incident within 72 hours, an extension pause must be issued before the window closes. See [Pause Renewal](#rolling-back-an-accidental-pause).

---

## Scope and Boundaries

The pause mechanism covers two Soroban contracts:

| Contract | Pause applies to |
|----------|-----------------|
| `carbon_credit` | `mint_credits`, `retire_credits`, `transfer_credits` |
| `carbon_marketplace` | `purchase_credits`, `bulk_purchase`, `delist_credits` |

The following are **not** affected by pause and require separate DR procedures:

- `carbon_registry` — project registration always continues.
- `carbon_oracle` — monitoring and price submissions always continue.
- PostgreSQL database — off-chain data store, managed independently.
- IPFS / certificate storage — unaffected by contract pause.

---

## Backup Procedures

### On-Chain State Snapshot

Stellar's ledger is itself an immutable distributed record. Every committed transaction — including all pause activations and deactivations — is permanently archived. However, on-chain state (contract storage) can be read and exported for off-chain backup.

**Export current pause state (run before planned maintenance):**

```bash
#!/bin/bash
# scripts/backup-pause-state.sh
set -euo pipefail

NETWORK="${STELLAR_NETWORK:-testnet}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
OUTPUT_DIR="backups/pause-state/${TIMESTAMP}"
mkdir -p "$OUTPUT_DIR"

for CONTRACT_VAR in CARBON_CREDIT_CONTRACT_ID CARBON_MARKETPLACE_CONTRACT_ID; do
  CONTRACT_ID="${!CONTRACT_VAR}"
  CONTRACT_NAME=$(echo "$CONTRACT_VAR" | sed 's/_CONTRACT_ID//' | tr '[:upper:]' '[:lower:]')

  echo "Exporting pause state for $CONTRACT_NAME ($CONTRACT_ID)..."

  stellar contract read \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --key PauseEnabled \
    > "$OUTPUT_DIR/${CONTRACT_NAME}_PauseEnabled.json"

  stellar contract read \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --key PauseUntil \
    > "$OUTPUT_DIR/${CONTRACT_NAME}_PauseUntil.json"

  echo "  Saved to $OUTPUT_DIR/${CONTRACT_NAME}_Pause*.json"
done

# Export recent pause events for audit trail
stellar events \
  --network "$NETWORK" \
  --start-ledger "$(( $(stellar ledger --network "$NETWORK" | jq .sequence) - 10000 ))" \
  --contract-id "$CARBON_CREDIT_CONTRACT_ID" \
  --contract-id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  > "$OUTPUT_DIR/pause_events.json"

echo "Pause state snapshot saved to $OUTPUT_DIR"
```

**Schedule:** Run this script before every planned maintenance window and after every incident.

**Retention:** Keep on-chain state snapshots for 90 days in `backups/pause-state/`.

---

### Off-Chain Database Backup

The PostgreSQL database tracks:
- Pending and queued transaction records that reference paused contracts.
- The pause event ingestion table (`contract_events`) that mirrors on-chain events.
- User-facing state (listings, retirements, certificates) that must stay consistent with on-chain data.

**Automated daily backup (already configured in `scripts/db-backup.sh`):**

```bash
# scripts/db-backup.sh — existing script, runs via cron
pg_dump \
  --host="$DB_HOST" \
  --username="$DB_USER" \
  --dbname=carbonledger \
  --format=custom \
  --compress=9 \
  --file="backups/postgres/carbonledger_$(date -u +"%Y%m%d").dump"
```

**Pre-pause incremental backup (run immediately before executing a pause):**

```bash
#!/bin/bash
# scripts/backup-pre-pause.sh
set -euo pipefail

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_FILE="backups/postgres/pre_pause_${TIMESTAMP}.dump"

echo "Creating pre-pause database snapshot..."
pg_dump \
  --host="$DB_HOST" \
  --username="$DB_USER" \
  --dbname=carbonledger \
  --format=custom \
  --compress=9 \
  --file="$BACKUP_FILE"

echo "Pre-pause backup saved: $BACKUP_FILE"

# Also capture the current queue state
redis-cli --no-auth-warning \
  -u "redis://:${REDIS_PASSWORD}@${REDIS_HOST}:6379" \
  BGSAVE

echo "Redis background save triggered."
```

**Retention policy:**

| Backup type | Frequency | Retention |
|-------------|-----------|-----------|
| Daily full dump | Every 24 hours | 30 days |
| Pre-pause snapshot | Before every pause | 90 days |
| Weekly archive | Sunday 01:00 UTC | 1 year |

---

### Configuration Backup

Admin keys, contract IDs, and environment configuration must be backed up securely and separately from the codebase.

**What to back up:**

| Item | Location | Backup method |
|------|----------|---------------|
| Admin keypair (public key) | `.env` / Vault | Vault replication to secondary region |
| Contract IDs | `.env` / CI secrets | Stored in GitHub Secrets + encrypted offline copy |
| `ADMIN_ADDRESS` | `.env` | Encrypted backup in password manager |
| Stellar network config | `Stellar.toml` | Version-controlled in the repository |

**Important:** Never back up the **admin secret key** in a form that can be read by automated systems. It must be stored in a hardware security module (HSM) or multi-signature vault and accessible only via the key rotation procedure in [KEY_ROTATION_PROCEDURES.md](KEY_ROTATION_PROCEDURES.md).

---

## Restore Procedures

### Restoring Pause State After Admin Key Loss

The worst-case scenario for the pause feature is losing the admin key while the contract is paused. The contract will auto-expire after 72 hours in this case — **no manual intervention is required for auto-expiry**.

If the admin key is lost and the contract needs to be manually managed before expiry:

1. **Wait for auto-expiry** (preferred): If the incident timeline allows, simply wait for the `PauseUntil` timestamp to pass. The contract self-heals on the next write operation.

2. **Emergency key recovery** (if key was multi-sig): Follow the procedure in [KEY_ROTATION_PROCEDURES.md](KEY_ROTATION_PROCEDURES.md) to recover or rotate the admin key using the multi-signature scheme.

3. **Emergency contract upgrade** (last resort only): If a new admin key cannot be recovered and the pause must be lifted before auto-expiry, a contract upgrade with a new admin address can be executed by the upgrade governance multisig. See [UPGRADE_GUIDE.md](UPGRADE_GUIDE.md).

> **Note:** Never deploy an emergency upgrade without going through the full multi-sig approval process documented in [upgrade_governance/UPGRADE_GOVERNANCE.md](../contracts/upgrade_governance/UPGRADE_GOVERNANCE.md).

---

### Restoring Off-Chain Database

Use this procedure when the PostgreSQL database needs to be restored to a consistent state after an incident.

**Step 1: Identify the correct restore point**

```bash
# List available backups
ls -lht backups/postgres/ | head -20

# Identify the pre-pause backup if restoring to the moment before an incident
# Example output:
#   pre_pause_20260926T221010Z.dump  ← use this if restoring to before the incident
#   carbonledger_20260926.dump       ← daily backup
```

**Step 2: Stop all services that write to the database**

```bash
# Scale down backend workers
kubectl scale deployment backend-worker --replicas=0
kubectl scale deployment backend-api --replicas=0

# Verify no active connections
psql -h "$DB_HOST" -U "$DB_USER" -c "
  SELECT count(*) FROM pg_stat_activity
  WHERE datname = 'carbonledger' AND state = 'active';
"
```

**Step 3: Restore the database**

```bash
#!/bin/bash
# scripts/restore-db.sh <backup_file>
set -euo pipefail

BACKUP_FILE="${1:?Usage: restore-db.sh <backup_file>}"

echo "WARNING: This will OVERWRITE the current carbonledger database."
echo "Backup file: $BACKUP_FILE"
read -p "Type 'CONFIRM' to proceed: " CONFIRM
[[ "$CONFIRM" == "CONFIRM" ]] || { echo "Aborted."; exit 1; }

# Drop and recreate the database
psql -h "$DB_HOST" -U "$DB_USER" postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = 'carbonledger' AND pid <> pg_backend_pid();
  DROP DATABASE IF EXISTS carbonledger;
  CREATE DATABASE carbonledger;
"

# Restore from backup
pg_restore \
  --host="$DB_HOST" \
  --username="$DB_USER" \
  --dbname=carbonledger \
  --verbose \
  --no-owner \
  "$BACKUP_FILE"

echo "Database restored from $BACKUP_FILE"
```

**Step 4: Reconcile the restored database with on-chain state**

After a restore, the off-chain database may be ahead of or behind the on-chain state. Run the reconciliation script:

```bash
npm run script:verify-pause-consistency \
  --contract-id "$CARBON_CREDIT_CONTRACT_ID" \
  --contract-id "$CARBON_MARKETPLACE_CONTRACT_ID"
```

See [Data Consistency Checks](#data-consistency-checks) for interpretation.

**Step 5: Resume services**

```bash
kubectl scale deployment backend-api --replicas=2
kubectl scale deployment backend-worker --replicas=3
```

---

### Restoring Backend Services

If the NestJS backend or oracle services need to be restarted after a pause-related incident:

```bash
# Restart backend API (zero-downtime rolling restart)
kubectl rollout restart deployment/backend-api

# Restart backend workers
kubectl rollout restart deployment/backend-worker

# Restart oracle services
kubectl rollout restart deployment/oracle-verification
kubectl rollout restart deployment/oracle-price
kubectl rollout restart deployment/oracle-satellite

# Verify all pods are running
kubectl get pods -l app=carbonledger --watch
```

After restart, confirm that the frontend correctly reflects the current pause state:

```bash
curl -s "https://api.carbonledger.io/api/v1/contracts/pause-status" | jq .
# Expected when contracts are operational:
# {
#   "carbonCredit": { "paused": false, "until": null, "isEffective": false },
#   "carbonMarketplace": { "paused": false, "until": null, "isEffective": false }
# }
```

---

## Testing Backups

Untested backups are not backups. The following schedule ensures all backup and restore paths are exercised regularly.

### Weekly Restore Drill

**Frequency:** Every Sunday at 04:00 UTC (automated via `.github/workflows/dr-test.yml`)

**Scope:** Restore the most recent database backup to a staging environment and verify data integrity.

```bash
#!/bin/bash
# scripts/weekly-restore-drill.sh
set -euo pipefail

LATEST_BACKUP=$(ls -t backups/postgres/carbonledger_*.dump | head -1)
STAGING_DB="carbonledger_dr_test_$(date +%Y%m%d)"

echo "Weekly DR drill — restoring $LATEST_BACKUP to $STAGING_DB..."

# Create staging database
psql -h "$DB_HOST" -U "$DB_USER" postgres \
  -c "CREATE DATABASE $STAGING_DB;"

# Restore
pg_restore \
  --host="$DB_HOST" \
  --username="$DB_USER" \
  --dbname="$STAGING_DB" \
  --no-owner \
  "$LATEST_BACKUP"

# Run integrity checks against the restored database
DB_URL="postgresql://$DB_USER:$DB_PASS@$DB_HOST:5432/$STAGING_DB" \
  npm run script:verify-db-integrity

# Cleanup staging database
psql -h "$DB_HOST" -U "$DB_USER" postgres \
  -c "DROP DATABASE $STAGING_DB;"

echo "Weekly DR drill complete. Results logged to backups/dr-drill-results/"
```

**Pass criteria:**
- Restore completes without errors.
- Row counts in critical tables (`credit_batches`, `retirements`, `contract_events`) match the source backup manifest.
- No foreign key constraint violations detected.

---

### Monthly Full DR Test

**Frequency:** First Saturday of every month at 02:00 UTC

**Scope:** Full end-to-end test including contract state export, database restore, consistency reconciliation, and a simulated pause-and-unpause cycle in the staging environment.

**Procedure:**

1. Export current on-chain pause state to staging:
   ```bash
   NETWORK=testnet ./scripts/backup-pause-state.sh
   ```

2. Restore the latest weekly database backup to staging PostgreSQL.

3. Deploy staging contracts to testnet with known state:
   ```bash
   cd contracts
   ./scripts/deploy-staging.sh
   ```

4. Execute a simulated pause:
   ```bash
   stellar contract invoke \
     --id "$STAGING_CREDIT_CONTRACT_ID" \
     --source-account "$STAGING_ADMIN_KEY" \
     --network testnet \
     -- pause_operations \
     --admin "$STAGING_ADMIN_ADDRESS" \
     --until_timestamp $(($(date +%s) + 3600))
   ```

5. Verify consistency checks pass while paused:
   ```bash
   npm run script:verify-pause-consistency \
     --contract-id "$STAGING_CREDIT_CONTRACT_ID"
   ```

6. Execute unpause and re-verify:
   ```bash
   stellar contract invoke \
     --id "$STAGING_CREDIT_CONTRACT_ID" \
     --source-account "$STAGING_ADMIN_KEY" \
     --network testnet \
     -- unpause_operations \
     --admin "$STAGING_ADMIN_ADDRESS"
   ```

7. Confirm staging backend shows operational status.

**Document results** in `docs/DR_TESTING_SCHEDULE.md` after each drill.

---

### Automated Backup Verification

The CI pipeline runs a nightly backup verification job (see `.github/workflows/backup-verify.yml`):

```yaml
# .github/workflows/backup-verify.yml (excerpt)
- name: Verify latest backup is restorable
  run: |
    LATEST=$(ls -t backups/postgres/carbonledger_*.dump | head -1)
    pg_restore --list "$LATEST" > /dev/null
    echo "Backup $LATEST verified: table-of-contents readable"

- name: Check backup age
  run: |
    LATEST=$(ls -t backups/postgres/carbonledger_*.dump | head -1)
    AGE=$(( $(date +%s) - $(date -r "$LATEST" +%s) ))
    if [ "$AGE" -gt 90000 ]; then
      echo "ERROR: Latest backup is more than 25 hours old ($AGE seconds)"
      exit 1
    fi
    echo "Backup age: $AGE seconds (OK)"
```

---

## Data Consistency Checks

After any pause/unpause cycle, run the following checks before declaring the incident resolved and resuming normal operations.

### On-Chain vs Off-Chain Reconciliation

The `verify-pause-consistency` script compares the on-chain contract storage with the PostgreSQL database:

```bash
npm run script:verify-pause-consistency \
  --contract-id "$CARBON_CREDIT_CONTRACT_ID" \
  --contract-id "$CARBON_MARKETPLACE_CONTRACT_ID"
```

**What it checks:**

| Check | Pass condition |
|-------|---------------|
| `PauseEnabled` on-chain matches `contract_pause_state` table | Values equal |
| `PauseUntil` on-chain matches `contract_pause_state.until_timestamp` | Values within ±5 seconds |
| No credit minting events between pause start and unpause | Zero `credit_minted` rows in DB during pause window |
| No retirement events during pause window | Zero `retirement_completed` rows in DB during pause window |
| No marketplace purchases during pause window | Zero `purchase_completed` rows in DB during pause window |
| Pending transactions in queue are marked `suspended` | All queue entries created after pause start have `status = 'suspended'` |

**Interpreting results:**

```
[PASS] PauseEnabled: on-chain=false, DB=false ✓
[PASS] PauseUntil: on-chain=0, DB=null ✓
[PASS] No minting during pause window ✓
[PASS] No retirements during pause window ✓
[PASS] No purchases during pause window ✓
[WARN] 3 transactions in queue have status='pending' (expected 'suspended')
       → Re-run: npm run script:suspend-pending-queue
[PASS] 0 orphaned minting records ✓

Summary: 6/7 checks passed. 1 warning requires action.
```

---

### Pause State Integrity Checks

Run these manual checks if the automated script is unavailable:

**Check 1: Verify on-chain pause state**

```bash
# Check PauseEnabled
stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseEnabled
# Expected when unpaused: false

# Check PauseUntil
stellar contract read \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  --key PauseUntil
# Expected when unpaused: 0
```

**Check 2: Confirm no in-flight transactions were partially applied**

On Stellar, transactions are atomic — partial state is never written. However, verify that the queue has no stale pending items:

```bash
psql -h "$DB_HOST" -U "$DB_USER" carbonledger -c "
  SELECT status, count(*) FROM transaction_queue
  WHERE created_at > (
    SELECT start_timestamp FROM pause_history
    ORDER BY start_timestamp DESC LIMIT 1
  )
  GROUP BY status;
"
```

**Expected output after a clean unpause:**

```
 status     | count
------------+-------
 completed  |   0
 suspended  |   42   ← transactions queued during pause, now eligible for replay
 pending    |   0    ← should be 0; any remaining require manual review
```

**Check 3: Verify event audit trail**

Every pause and unpause must have a corresponding on-chain event. Fetch and verify:

```bash
stellar events \
  --network testnet \
  --start-ledger "$(( $(stellar ledger --network testnet | jq .sequence) - 50000 ))" \
  --contract-id "$CARBON_CREDIT_CONTRACT_ID" \
  | jq '[.[] | select(.topic[1] == "contract_paused" or .topic[1] == "contract_unpaused")]'
```

Every `contract_paused` event must have a corresponding `contract_unpaused` event (or the pause must still be active). An orphaned `contract_paused` event without a following `contract_unpaused` within 72 hours indicates the contract auto-expired — this is expected behavior and not an error.

---

### Event Audit Trail Verification

After an incident, export all pause-related events and cross-reference with the incident timeline:

```bash
#!/bin/bash
# scripts/verify-pause-audit-trail.sh
set -euo pipefail

NETWORK="${STELLAR_NETWORK:-testnet}"
START_LEDGER="${1:?Usage: verify-pause-audit-trail.sh <start_ledger>}"

echo "Fetching pause events from ledger $START_LEDGER..."

for CONTRACT_ID in "$CARBON_CREDIT_CONTRACT_ID" "$CARBON_MARKETPLACE_CONTRACT_ID"; do
  stellar events \
    --network "$NETWORK" \
    --start-ledger "$START_LEDGER" \
    --contract-id "$CONTRACT_ID" \
    | jq --arg cid "$CONTRACT_ID" '
        .[]
        | select(.topic[1] == "contract_paused" or .topic[1] == "contract_unpaused")
        | {
            contract: $cid,
            event:     .topic[1],
            admin:     .topic[2],
            ledger:    .ledger,
            timestamp: .ledgerClosedAt,
            data:      .value
          }
      '
done
```

Cross-reference the output with the incident timeline in your post-mortem to verify that every action was authorized and within the expected window.

---

## Rollback Procedures

### Rolling Back an Accidental Pause

If an admin accidentally pauses the contract (e.g., wrong environment, mis-click), **unpause immediately**:

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --network testnet \
  -- \
  unpause_operations \
  --admin "$ADMIN_ADDRESS"

stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --network testnet \
  -- \
  unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

**After unpause:**

1. Verify both contracts show `PauseEnabled = false`.
2. Resume backend workers if they were stopped:
   ```bash
   kubectl scale deployment backend-worker --replicas=3
   ```
3. Clear the Redis pause flag:
   ```bash
   redis-cli DEL carbonledger:contract_paused
   ```
4. Verify the frontend shows no pause banner (hard-refresh browser cache if needed).
5. File an incident report documenting the accidental pause, its duration, and any user impact.

**Note:** On-chain events are immutable. The `contract_paused` event remains in the ledger history forever. The `contract_unpaused` event will appear immediately after. Both events are part of the permanent audit trail.

---

### Rolling Back a Failed Unpause

If an unpause attempt fails (e.g., network error, Soroban fee issue):

**Step 1: Diagnose the failure**

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --network testnet \
  -- unpause_operations \
  --admin "$ADMIN_ADDRESS" \
  2>&1
# Common errors:
#   "auth required" → admin key not properly authorized
#   "insufficient fee" → increase base fee
#   "network error" → try again or use alternative RPC endpoint
```

**Step 2: Retry with increased fee**

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --network testnet \
  --fee 100000 \
  -- unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

**Step 3: Alternative RPC endpoint**

If the primary Soroban RPC is unavailable, retry against the backup RPC endpoint configured in `.env`:

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --rpc-url "$SOROBAN_RPC_BACKUP_URL" \
  --source-account "$ADMIN_KEY" \
  --network testnet \
  -- unpause_operations \
  --admin "$ADMIN_ADDRESS"
```

**Step 4: If all unpause attempts fail within 1 hour**

Escalate to the on-call lead and notify users via the status page that the pause window is extended. The contract will auto-expire after `PauseUntil` regardless. Document the failure mode for the post-mortem.

---

### Rolling Back a Contract Upgrade Applied During Pause

Upgrades applied while the contract is paused follow the standard upgrade governance process. If an upgrade must be rolled back after being applied:

1. Follow the full rollback procedure in [UPGRADE_GUIDE.md](UPGRADE_GUIDE.md).
2. Ensure pause state is consistent after rollback: check `PauseEnabled` and `PauseUntil` on the rolled-back contract — the storage keys persist through upgrades.
3. Re-run data consistency checks after the rollback.

---

## Emergency Escalation Workflow

```
[Anomaly Detected]
        │
        ▼
[On-Call Engineer Verifies] ──► Is it a confirmed exploit? ──No──► [Monitor & Log]
        │ Yes
        ▼
[Execute Emergency Pause] ←── < 5 minutes from declaration (RTO)
  • pause carbon_credit
  • pause carbon_marketplace
  • stop backend workers
  • set Redis read-only flag
        │
        ▼
[Notify Team & Users]
  • PagerDuty alert
  • Status page update
  • Slack #incidents channel
        │
        ▼
[Data Consistency Verification] ←── < 30 minutes (RTO)
  • Run verify-pause-consistency
  • Check for orphaned records
  • Review event audit trail
        │
        ▼
[Investigate & Mitigate]
  • Identify root cause
  • Patch deployed or exploit confirmed not exploitable
        │
        ▼
[Pre-Unpause Checklist] ←── See Post-Recovery Checklist below
        │
        ▼
[Multi-Sig Unpause] ←── Requires 2-of-3 admin signatures
        │
        ▼
[Resume Backend Workers]
        │
        ▼
[Verify Operational Status]
        │
        ▼
[Incident Post-Mortem] ←── Within 48 hours of resolution
```

**Pause execution commands (both contracts):**

```bash
for CONTRACT_ID in "$CARBON_CREDIT_CONTRACT_ID" "$CARBON_MARKETPLACE_CONTRACT_ID"; do
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$ADMIN_KEY" \
    --network "${STELLAR_NETWORK:-testnet}" \
    -- pause_operations \
    --admin "$ADMIN_ADDRESS" \
    --until_timestamp $(($(date +%s) + 86400))
done
```

> Set `until_timestamp` to `now + 86400` (24 hours) initially. Renew before expiry if the incident is not resolved. Maximum allowed value is `now + 259200` (72 hours) per the contract constraint.

---

## Post-Recovery Checklist

Use this checklist before declaring the incident resolved and lifting the pause.

### Pre-Unpause

- [ ] Root cause identified and documented.
- [ ] Fix deployed (contract upgrade, off-chain patch, or confirmation of no exploit).
- [ ] Pre-unpause database backup created (`scripts/backup-pre-pause.sh`).
- [ ] Data consistency check passed (`npm run script:verify-pause-consistency`).
- [ ] No orphaned minting or retirement records in the database during the pause window.
- [ ] Pending queue transactions reviewed; eligible items re-queued, ineligible items cancelled.
- [ ] At least 2 admins have reviewed and approved the unpause decision.
- [ ] Status page and Slack updated: "Preparing to resume operations."

### Unpause Execution

- [ ] Unpause `carbon_credit` contract.
- [ ] Verify `PauseEnabled = false` on `carbon_credit`.
- [ ] Unpause `carbon_marketplace` contract.
- [ ] Verify `PauseEnabled = false` on `carbon_marketplace`.
- [ ] Clear Redis `carbonledger:contract_paused` flag.
- [ ] Resume backend queue workers.
- [ ] Restart oracle services if they were halted.

### Post-Unpause Verification

- [ ] Backend `/api/v1/contracts/pause-status` returns `paused: false` for both contracts.
- [ ] Frontend shows no pause banner (verify in incognito/private browser).
- [ ] Submit a test transaction (mint or purchase on testnet) to confirm operations succeed.
- [ ] Check Grafana dashboard for error rate spike.
- [ ] Confirm oracle is submitting price updates normally.
- [ ] Re-run data consistency check post-unpause.
- [ ] Status page updated: "All systems operational."

### Post-Incident

- [ ] Export pause audit trail and attach to the incident report.
- [ ] File incident post-mortem within 48 hours.
- [ ] Update DR schedule if any procedure gaps were discovered.
- [ ] Review and update this document if the incident revealed missing steps.

---

## Related Documents

- [Pause Architecture](pause-architecture.md) — how the pause mechanism works in the contract layer
- [Pause Operations Guide](PAUSE_OPERATIONS_GUIDE.md) — step-by-step admin runbook for executing a pause
- [Emergency Pause Runbook](runbooks/emergency-pause.md) — decision tree for security incidents
- [Incident Response](INCIDENT_RESPONSE.md) — incident severity classification and escalation contacts
- [Key Rotation Procedures](KEY_ROTATION_PROCEDURES.md) — admin key recovery and rotation
- [Upgrade Guide](UPGRADE_GUIDE.md) — contract upgrade procedures (relevant for post-incident fixes)
- [Disaster Recovery Plan](DISASTER_RECOVERY_PLAN.md) — system-wide DR plan
- [DR Testing Schedule](DR_TESTING_SCHEDULE.md) — schedule and log of past DR drills
- [Pause Events Reference](PAUSE_EVENTS.md) — on-chain event structure for audit trail verification
- [Pause Testing Guide](PAUSE_TESTING_GUIDE.md) — testing the pause mechanism in development
