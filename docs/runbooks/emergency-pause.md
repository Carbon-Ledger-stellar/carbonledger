# Runbook: Emergency Contract Pause

**Severity:** Critical  
**Contacts:** See [contacts.md](contacts.md) → Security  
**Escalation:** See [escalation.md](escalation.md)  
**Status:** This runbook documents the proposed pause mechanism. The pause feature is planned but not yet implemented — see [ISSUES.md](../ISSUES.md) for implementation scope.

---

## Decision Tree: When to Pause

Work through these questions in order. Stop at the first "YES" and execute the pause immediately.

```
1. Are credits being minted to addresses that are not the oracle or admin?
   YES → PAUSE NOW (unauthorized minting detected)
   NO  → continue ↓

2. Are serial number conflicts appearing at a rate > 1 per minute?
   YES → PAUSE NOW (serial range bypass attempt suspected)
   NO  → continue ↓

3. Is USDC leaving the marketplace to unexpected addresses?
   YES → PAUSE NOW (fund drain suspected)
   NO  → continue ↓

4. Has a researcher or community member provided a reproducible exploit PoC?
   YES → PAUSE NOW (confirmed vulnerability)
   NO  → continue ↓

5. Are DoubleCountingDetected (error 14) errors appearing in normal flow?
   YES → PAUSE NOW (serial range invariant being bypassed)
   NO  → continue ↓

6. Is there a spike in UnauthorizedOracle (error 8) followed immediately by 
   successful mints from the same address?
   YES → PAUSE NOW (authorization bypass suspected)
   NO  → DO NOT PAUSE — continue investigating with read-only queries
```

### When NOT to pause

- Price feed staleness or `CircuitBreakerTripped` (error 22) — use the oracle circuit breaker.
- Frontend or backend outages — these are off-chain; the contracts are unaffected.
- Suspected but unconfirmed issues — investigate first; pause is a last resort.
- Routine maintenance — Soroban contracts are immutable; there is no maintenance window.

---

## Emergency Pause Checklist

Execute these steps in order. Each step has a target completion time from incident detection.

### T+0 — Detection

- [ ] Record the UTC timestamp of detection.
- [ ] Open an incident channel (`#incident-YYYYMMDD-pause` or equivalent).
- [ ] Log: `[T+0] Incident detected by <name>. Suspected: <one-line description>.`
- [ ] Notify the on-call security contact (see [contacts.md](contacts.md)).

### T+5 minutes — Pause

- [ ] Locate the admin keypair (`ADMIN_SECRET_KEY`).
- [ ] Pause `carbon_credit`:

  ```bash
  stellar contract invoke \
    --id $CARBON_CREDIT_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network testnet \
    -- pause \
    --reason "<brief reason>"
  ```

- [ ] Pause `carbon_marketplace`:

  ```bash
  stellar contract invoke \
    --id $CARBON_MARKETPLACE_CONTRACT_ID \
    --source $ADMIN_SECRET_KEY \
    --network testnet \
    -- pause \
    --reason "<brief reason>"
  ```

- [ ] Verify both contracts report `is_paused() == true`.
- [ ] Log: `[T+5] Both contracts paused. Expiry: <UTC timestamp + 72h>. TX hashes: <hashes>.`

### T+10 minutes — Contain and notify

- [ ] Stop oracle services (prevents log flooding from failed submissions):

  ```bash
  # systemd
  sudo systemctl stop carbonledger-oracle-verification carbonledger-oracle-price carbonledger-oracle-satellite

  # Docker
  docker-compose stop oracle_verification oracle_price oracle_satellite
  ```

- [ ] Post to user-facing status page: "Investigating — contract operations suspended." (see [Communication Templates](#communication-plan-and-stakeholder-notification) below).
- [ ] Notify all team members via `#carbonledger-team`.
- [ ] Log: `[T+10] Oracle stopped. Status page updated. Team notified.`

### T+30 minutes — Investigate

- [ ] Pull the last 200 operations on both contracts:

  ```bash
  curl "https://horizon-testnet.stellar.org/accounts/$CARBON_CREDIT_CONTRACT_ID/operations?limit=200&order=desc" \
    | jq '._embedded.records[] | {type, created_at, source_account}'
  ```

- [ ] Identify the first anomalous transaction (ledger number and timestamp).
- [ ] Document the attack vector hypothesis.
- [ ] Identify affected serial number ranges (if any).
- [ ] Escalate to SDF if the vulnerability appears to be in the Soroban runtime: `security@stellar.org`.
- [ ] Log: `[T+30] Investigation update: <findings>.`

### T+60 minutes — Status update

- [ ] Post a second update to the status page with current status.
- [ ] Send stakeholder notification email (see [Communication Templates](#communication-plan-and-stakeholder-notification)).
- [ ] Confirm pause renewal is not needed yet (pause expires at T+72h).
- [ ] Log: `[T+60] Status update issued.`

### T+66 hours — Renewal check

If the incident is still ongoing, the pause must be renewed before it expires at T+72h:

- [ ] Renew pause on both contracts:

  ```bash
  stellar contract invoke --id $CARBON_CREDIT_CONTRACT_ID --source $ADMIN_SECRET_KEY \
    --network testnet -- pause --reason "Renewal: investigation ongoing"

  stellar contract invoke --id $CARBON_MARKETPLACE_CONTRACT_ID --source $ADMIN_SECRET_KEY \
    --network testnet -- pause --reason "Renewal: investigation ongoing"
  ```

- [ ] Log: `[T+66h] Pause renewed. New expiry: <UTC timestamp + 72h>.`

---

## Communication Plan and Stakeholder Notification

### Notification timeline

| T+ | Channel | Audience | Message |
|---|---|---|---|
| 0 min | Incident channel | On-call team | Incident opened, investigation started |
| 5 min | Incident channel | On-call team | Contracts paused, TX hashes |
| 15 min | Status page | Public | "Investigating — operations suspended" |
| 30 min | `#carbonledger-team` | Full team | Incident summary, current status |
| 60 min | Email | Affected stakeholders | Formal notification (see template below) |
| Post-resolution | Status page | Public | Resolved, summary |
| 48 h post-resolution | Blog/email | All users | Full post-incident report |

### Stakeholder notification template

```
Subject: [CarbonLedger Security Incident] Contract Operations Suspended — <date>

Dear <name / "CarbonLedger User">,

We are writing to inform you of a security incident that required us to
temporarily suspend marketplace and credit contract operations.

INCIDENT SUMMARY
- Started: <UTC timestamp>
- Status: <Under investigation / Resolved>
- Affected: carbon_credit, carbon_marketplace contracts

IMPACT TO YOU
- Purchases and retirements were temporarily blocked
- Your existing credits are safe and verifiable on-chain
- Your retirement certificates remain valid at their permanent URLs
- No action is required on your part

WHAT WE'RE DOING
<Brief description of investigation and remediation steps>

WHEN WILL OPERATIONS RESUME
<Estimated timeline or "We will update within X hours">

If you have questions or concerns, please contact:
  security@carbonledger.io

We apologize for the disruption and appreciate your patience.

The CarbonLedger Security Team
```

### Internal incident channel template

```
[P0 INCIDENT] Contract pause executed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Time (UTC):     <timestamp>
Initiated by:   <name>
Contracts:      carbon_credit, carbon_marketplace
Pause expiry:   <timestamp + 72h>
TX hashes:
  credit:       <hash>
  marketplace:  <hash>

Trigger:        <description>
Known impact:   <what is blocked / what is safe>
Investigation:  <name> is lead, <name> is backup

Next update:    T+30 minutes
Renewal needed: <timestamp - 6h>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Recovery Procedures

### Pre-recovery gates

All of the following must be true before unpausing:

1. The attack vector is identified and confirmed closed (or confirmed false positive).
2. An audit of all transactions since the last known-good ledger is complete.
3. Affected serial number ranges are documented and verified.
4. At least two senior team members have reviewed and approved the unpause.
5. If any legitimate state was corrupted, a recovery plan is in place.

### Recovery path A — False positive (no exploit)

If the investigation confirms no exploit occurred:

1. Document the false positive trigger and why it was a false alarm.
2. Unpause both contracts (see [Pause Operations Guide](../PAUSE_OPERATIONS_GUIDE.md) — Unpause instructions).
3. Restart oracle services.
4. Monitor for 30 minutes post-unpause.
5. Update status page: "Resolved — false alarm confirmed."
6. Schedule a post-incident review to improve detection accuracy.

### Recovery path B — Exploit with no state corruption

If an exploit path was confirmed but no fraudulent state was written (the pause blocked it in time):

1. Verify on-chain: no unexpected mints, transfers, or retirements after the last known-good ledger.
2. Engage a smart contract auditor to review the exploit path.
3. Deploy a patched contract with a new address (see [Contract Upgrade Runbook](contract-upgrade.md)).
4. Update contract IDs in `.env` and all configuration.
5. Unpause the old contracts (to allow read access) or leave paused if the patch is imminent.
6. Communicate the patch deployment to users.

### Recovery path C — Exploit with state corruption

If fraudulent state was written (illegitimate mints, transfers, or retirements):

1. **Do not attempt to reverse on-chain state.** Stellar ledger entries are immutable.
2. Document every affected serial number range and transaction.
3. Engage a smart contract auditor before any redeployment.
4. Deploy patched contracts at new addresses.
5. Re-mint credits legitimately for affected projects using audited serial ranges only.
6. Notify all affected buyers individually with details of affected credits.
7. Provide replacement credits or USDC refunds as appropriate.
8. File a public disclosure report within 7 days of resolution.

### Oracle restart checklist

After contracts are unpaused and stable:

```bash
# Verify contracts are unpaused
stellar contract invoke --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY --network testnet -- is_paused
# Expected: false

# Restart oracle services
sudo systemctl start carbonledger-oracle-verification
sudo systemctl start carbonledger-oracle-price
sudo systemctl start carbonledger-oracle-satellite

# Check oracle logs for successful submission
sudo journalctl -u carbonledger-oracle-verification -n 50 --follow
```

---

## Post-Incident Review Process

A post-incident review (PIR) must be completed within 48 hours of every pause event, regardless of whether an exploit was confirmed.

### Review meeting agenda

1. **Timeline reconstruction** (15 min) — walk through the full timeline from first signal to resolution, using the incident channel log.
2. **Root cause analysis** (20 min) — what was the underlying cause? Was it a contract bug, an external attack, or a false positive?
3. **Impact assessment** (10 min) — how many users were affected? What was the estimated USDC value at risk?
4. **Detection review** (10 min) — how was the incident detected? How long did detection take? Could it have been faster?
5. **Response review** (10 min) — was the response playbook followed? What slowed the team down?
6. **Action items** (15 min) — concrete improvements with owners and deadlines.

### PIR report template

```markdown
# Post-Incident Review: <date>

## Summary
One-paragraph description of what happened and the outcome.

## Timeline
| Time (UTC) | Event |
|---|---|
| T+0  | <event> |
| T+5  | <event> |
| ...  | ... |

## Root Cause
<Detailed technical description of the root cause.>

## Impact
- Users affected: <count>
- Operations blocked: <count and type>
- Credits at risk: <serial ranges>
- USDC at risk: <amount>
- Duration: <pause duration>

## What Went Well
- <item>

## What Could Be Improved
- <item>

## Action Items
| # | Action | Owner | Due Date | Status |
|---|---|---|---|---|
| 1 | <action> | <name> | <date> | Open |

## Prevention
<Describe what changes (tests, monitoring, contract changes, process) would have prevented or reduced the impact of this incident.>
```

### Action item categories

Common action items from past incidents:

- **Test coverage** — add the missed edge case as a unit or fuzz test.
- **Monitoring** — add a Grafana alert for the anomalous pattern that triggered the incident.
- **Documentation** — update this runbook with any steps that were missing or unclear.
- **Process** — adjust the decision tree if the pause threshold was miscalibrated (too sensitive or not sensitive enough).
- **Contract changes** — note any invariants that should be added when the contract is next patched.

---

## Related Documentation

- [Pause Operations Guide](../PAUSE_OPERATIONS_GUIDE.md) — detailed CLI commands for pause and unpause
- [Pause Testing Guide](../PAUSE_TESTING_GUIDE.md) — how to verify the pause mechanism works
- [Pause Events Reference](../PAUSE_EVENTS.md) — events emitted during pause/unpause
- [Contract Exploit Runbook](contract-exploit.md) — broader incident response for exploit scenarios
- [Contract Upgrade Runbook](contract-upgrade.md) — deploying patched contracts post-incident
- [Key Compromise Runbook](key-compromise.md) — if the admin keypair is compromised
- [Contacts](contacts.md) — on-call contacts for security incidents
- [Escalation](escalation.md) — escalation path and SLA thresholds
