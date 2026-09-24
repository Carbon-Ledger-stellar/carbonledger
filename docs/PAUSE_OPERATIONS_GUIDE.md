# Pause Operations Guide

> **Audience:** Contract administrators with the designated admin keypair.  
> **Status:** This guide documents the proposed pause mechanism. The pause feature is planned but not yet implemented — see [ISSUES.md](ISSUES.md) for implementation scope.

## Table of Contents

- [When to Pause](#when-to-pause)
- [Prerequisites](#prerequisites)
- [Step-by-Step Pause Instructions](#step-by-step-pause-instructions)
- [Step-by-Step Unpause Instructions](#step-by-step-unpause-instructions)
- [Post-Pause Checklist](#post-pause-checklist)
- [Rollback Procedures](#rollback-procedures)
- [Communication Templates](#communication-templates)

---

## When to Pause

Pause the contract when you have confirmed evidence of an active security incident or integrity violation. Do **not** pause pre-emptively for suspected issues that are not yet confirmed — every pause disrupts real users and has a 72-hour expiry clock.

### Pause immediately if any of the following are true

- A wallet is minting credits without a valid `oracle` invocation (`UnauthorizedOracle` errors spiking in Horizon).
- Serial number conflicts are appearing at an abnormal rate (`SerialNumberConflict = 6` events).
- USDC is leaving the marketplace contract to unexpected addresses.
- A researcher or community member has reported a reproducible exploit path.
- `DoubleCountingDetected = 14` errors are appearing in normal transaction flow (indicates a serial number bypass attempt).

### Do not pause for

- Oracle price staleness — use the circuit breaker (`CircuitBreakerTripped = 22`) mechanism instead.
- Frontend bugs or API failures — these are off-chain and do not require a contract pause.
- Routine maintenance — contracts are immutable; there is no maintenance window concept.
- Suspected but unconfirmed issues — investigate first using read-only queries.

> For a full decision tree, see the [Emergency Pause Runbook](runbooks/emergency-pause.md).

---

## Prerequisites

Before pausing, confirm you have:

- [ ] The admin keypair (`ADMIN_SECRET_KEY`) available and unlocked.
- [ ] The Stellar CLI installed and configured for the correct network.
- [ ] The deployed contract IDs (`CARBON_CREDIT_CONTRACT_ID`, `CARBON_MARKETPLACE_CONTRACT_ID`) from your `.env`.
- [ ] An open incident channel (Slack, Discord, or equivalent) with UTC timestamps.
- [ ] At least one other team member notified and standing by.

```bash
# Verify your admin key is the correct one
stellar keys ls
# Confirm network configuration
stellar network ls
```

---

## Step-by-Step Pause Instructions

### 1 — Open the incident channel

Record the UTC timestamp immediately:

```bash
date -u "+Incident opened: %Y-%m-%dT%H:%M:%SZ"
# Example: Incident opened: 2026-09-24T13:18:50Z
```

Post in your incident channel: `[P0 STARTED] Contract pause initiated by <your-name> at <timestamp>. Reason: <one-line description>.`

### 2 — Pause `carbon_credit`

```bash
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- pause \
  --reason "Suspicious mint activity — serial range conflict detected"
```

Expected output:

```
Transaction hash: abc123...
Ledger: 54321099
Status: SUCCESS
```

If the command fails with `UnauthorizedAdmin`, you are using the wrong keypair. Do not retry with a different key without confirming the correct admin address on-chain first:

```bash
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- get_admin
```

### 3 — Pause `carbon_marketplace`

```bash
stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- pause \
  --reason "Pausing marketplace in response to credit contract incident"
```

### 4 — Verify both contracts are paused

```bash
# Verify carbon_credit
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- is_paused
# Expected: true

# Verify carbon_marketplace
stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- is_paused
# Expected: true
```

### 5 — Confirm pause events on Horizon

```bash
# Check that ContractPaused events appear in the event stream
curl "https://soroban-testnet.stellar.org" \
  -X POST \
  -H 'Content-Type: application/json' \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"getEvents\",
    \"params\": {
      \"startLedger\": <current_ledger - 10>,
      \"filters\": [{
        \"type\": \"contract\",
        \"contractIds\": [\"$CARBON_CREDIT_CONTRACT_ID\"],
        \"topics\": [[\"*\"],[\"$(stellar xdr encode --type SCSymbol --value contract_paused)\"]]
      }]
    }
  }" | jq '.result.events[]'
```

### 6 — Stop the oracle services

With the contracts paused, oracle submissions will fail. Stop the oracle services to avoid log flooding:

```bash
# If running as systemd services
sudo systemctl stop carbonledger-oracle-verification
sudo systemctl stop carbonledger-oracle-price
sudo systemctl stop carbonledger-oracle-satellite

# If running as Docker containers
docker-compose stop oracle_verification oracle_price oracle_satellite

# If running in the background
pkill -f "verification_listener.py"
pkill -f "price_oracle.py"
pkill -f "satellite_monitor.py"
```

### 7 — Log the pause details

Record in your incident channel:

```
[PAUSED] carbon_credit:     <tx hash> at ledger <ledger number>
[PAUSED] carbon_marketplace: <tx hash> at ledger <ledger number>
[EXPIRY] Pause expires at:  <timestamp + 72h>
[NEXT]   Renewal required by: <timestamp + 66h> (6 hours before expiry)
```

---

## Step-by-Step Unpause Instructions

Only unpause when the security team has confirmed the incident is resolved and it is safe to resume operations.

### 1 — Confirm resolution criteria are met

Before unpausing, all of the following must be true:

- [ ] The attack vector has been identified and confirmed closed (or confirmed to be a false positive).
- [ ] An audit of affected serial ranges has been completed.
- [ ] No further anomalous transactions have been observed in the last 30 minutes.
- [ ] At least two team members have reviewed and approved the decision to unpause.
- [ ] A post-incident review meeting has been scheduled.

### 2 — Unpause `carbon_marketplace` first

Marketplace first to allow users to see their balances before trading resumes:

```bash
stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- unpause \
  --note "Incident resolved. False positive confirmed — no credits affected."
```

### 3 — Unpause `carbon_credit`

```bash
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- unpause \
  --note "Incident resolved. Safe to resume minting and retirements."
```

### 4 — Verify both contracts are unpaused

```bash
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- is_paused
# Expected: false

stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- is_paused
# Expected: false
```

### 5 — Restart oracle services

```bash
# If running as systemd services
sudo systemctl start carbonledger-oracle-verification
sudo systemctl start carbonledger-oracle-price
sudo systemctl start carbonledger-oracle-satellite

# If running as Docker containers
docker-compose start oracle_verification oracle_price oracle_satellite
```

### 6 — Monitor for 30 minutes post-unpause

Watch the Horizon event stream and application logs for 30 minutes after resuming to confirm no anomalous activity recurs.

```bash
# Stream live operations on the credit contract
curl "https://horizon-testnet.stellar.org/accounts/$CARBON_CREDIT_CONTRACT_ID/operations?order=asc&cursor=now" \
  --header "Accept: text/event-stream"
```

---

## Post-Pause Checklist

Complete this checklist after every pause event, whether the contract was subsequently unpaused or is still paused.

### Immediate (within 15 minutes of pause)

- [ ] Incident channel open with timestamped log.
- [ ] Both contracts confirmed paused (`is_paused() == true`).
- [ ] Oracle services stopped.
- [ ] Stakeholders notified (see [Communication Templates](#communication-templates)).
- [ ] Pause expiry time noted and calendar reminder set.

### Within 1 hour

- [ ] Initial investigation underway — recent transactions reviewed.
- [ ] Attack vector hypothesis documented.
- [ ] Affected serial number ranges identified (if any).
- [ ] Stellar Development Foundation contacted if the exploit involves the Soroban runtime.

### Before pause expiry (≥ 6 hours before 72-hour expiry)

If the incident is still ongoing, renew the pause:

```bash
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- pause \
  --reason "Renewal: incident still under investigation"

stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- pause \
  --reason "Renewal: incident still under investigation"
```

Log the renewal in the incident channel.

### After unpausing

- [ ] Unpause events confirmed on Horizon.
- [ ] Oracle services restarted and producing valid data.
- [ ] 30-minute post-unpause monitoring completed with no anomalies.
- [ ] User-facing status page updated to "Operational".
- [ ] Post-incident review meeting scheduled.
- [ ] Incident channel archived with full timeline.

---

## Rollback Procedures

Soroban contracts are immutable — there is no rollback of on-chain state in the traditional sense. If a security incident resulted in illegitimate state changes (e.g., fraudulent mints), the recovery path is:

1. **Do not attempt to "undo" on-chain state** by issuing counter-transactions.
2. **Identify the affected serial ranges** — query all minted batches after the last known-good ledger.
3. **Engage a smart contract auditor** to review the exploit path before re-deploying.
4. **Deploy patched contracts** (new contract IDs) following the [Contract Upgrade Runbook](runbooks/contract-upgrade.md).
5. **Re-mint credits legitimately** from audited serial ranges only.
6. **Update contract IDs** in `.env`, frontend config, and the oracle configuration.

The pause mechanism prevents further damage but cannot reverse damage already done. Speed of detection and containment is the primary defense.

---

## Communication Templates

### Internal team notification (within 15 minutes)

Send to the `#carbonledger-incidents` channel or equivalent:

```
[P0 INCIDENT - CONTRACTS PAUSED]
Time: <UTC timestamp>
Who: <your name>
Affected: carbon_credit, carbon_marketplace (both paused)
Pause expiry: <UTC timestamp + 72h>

What we know:
- <one-paragraph description of the triggering event>

What we don't know yet:
- Whether any credits were illegitimately minted/transferred
- Exact attack vector

Immediate next steps:
- Reviewing transactions since ledger <number>
- <name> is investigating on-chain data
- Status update in 30 minutes

Incident channel: <link>
```

### User-facing status page update (within 30 minutes)

Post to your status page (e.g., status.carbonledger.io):

```
Investigating - Contract Operations Temporarily Suspended

We are currently investigating a reported issue affecting the CarbonLedger
marketplace and credit contracts. As a precautionary measure, all purchases,
retirements, and credit minting have been temporarily suspended.

Your existing credits and retirement certificates are safe and unaffected.
All read operations (viewing credits, browsing listings, certificate
verification) remain fully available.

We are actively investigating and will provide an update within 60 minutes.

Started: <UTC timestamp>
```

### User-facing status update — resolved

```
Resolved - Contract Operations Resumed

The issue affecting CarbonLedger contract operations has been resolved.
All marketplace and credit contract functions are now fully operational.

Summary: <one sentence describing what happened and that it is resolved>

Your credits and retirement certificates were not affected.

We will publish a full post-incident report within 48 hours.

Duration: <pause duration>
Resolved: <UTC timestamp>
```

### Stakeholder notification email

```
Subject: [CarbonLedger] Service Interruption - <date>

To: <project developers, corporate buyers affected>

We are writing to inform you that CarbonLedger's marketplace and credit
contract operations were temporarily suspended on <date> from <start time>
to <end time> UTC (<duration>) while we investigated a security concern.

What happened: <brief, non-technical description>

What was affected:
- Credit purchases and retirements were temporarily blocked
- Existing credits and certificates remain valid and unaffected
- All audit trail data is intact and publicly verifiable

What we did: <brief description of response>

What you should do:
- No action required. Any operations that failed during the suspension
  may be resubmitted.

If you have questions, please contact security@carbonledger.io.

The CarbonLedger Team
```

---

## Related Documentation

- [Emergency Pause Runbook](runbooks/emergency-pause.md) — decision tree and step-by-step emergency procedures
- [Pause Testing Guide](PAUSE_TESTING_GUIDE.md) — test suite for the pause mechanism
- [Pause Events Reference](PAUSE_EVENTS.md) — event structures emitted during pause/unpause
- [Contract Exploit Runbook](runbooks/contract-exploit.md) — broader incident response for exploits
- [Contract Upgrade Runbook](runbooks/contract-upgrade.md) — deploying patched contracts
- [Key Rotation Procedures](KEY_ROTATION_PROCEDURES.md) — admin key management
- [Contacts](runbooks/contacts.md) — on-call contacts for security incidents
