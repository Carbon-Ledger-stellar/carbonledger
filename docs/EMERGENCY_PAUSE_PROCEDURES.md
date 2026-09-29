# Emergency Pause Procedures

> **CarbonLedger — Incident Response & Contract Pause Runbook**  
> Closes issue #1205  
> Last updated: 2026-09-26  
> Maintained by: Core Engineering Team  
> Review cadence: Every 90 days or after any P0/P1 incident

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Severity Classification](#2-severity-classification)
3. [Decision Tree: When to Pause](#3-decision-tree-when-to-pause)
4. [Emergency Pause Checklist](#4-emergency-pause-checklist)
5. [Off-Chain Containment Steps](#5-off-chain-containment-steps)
6. [On-Chain Verification Steps](#6-on-chain-verification-steps)
7. [Communication Plan](#7-communication-plan)
8. [Stakeholder Notification Templates](#8-stakeholder-notification-templates)
9. [Recovery Procedures](#9-recovery-procedures)
10. [Post-Incident Review Process](#10-post-incident-review-process)
11. [Quick Reference Card](#11-quick-reference-card)
12. [Related Documents](#12-related-documents)

---

## 1. Purpose and Scope

This runbook defines the procedures for emergency pausing of CarbonLedger smart contracts, the communication obligations that must be met, and the recovery paths available. It is the authoritative reference for anyone—on-call engineer, incident commander, or executive—responding to a live incident.

### Contracts Covered

| Contract | Contract ID env var | Functions affected by pause |
|---|---|---|
| `carbon_credit` | `CARBON_CREDIT_CONTRACT_ID` | `mint_credits`, `retire_credits`, `transfer_credits` |
| `carbon_marketplace` | `CARBON_MARKETPLACE_CONTRACT_ID` | `list_credits`, `purchase_credits`, `bulk_purchase` |

> `carbon_registry` and `carbon_oracle` do **not** have pause functions. Containment for those contracts relies on oracle shutdown and verifier key rotation (see section 5).

### What Pausing Does

- `pause()` sets an on-chain flag that causes all state-mutating functions in the paused contract to revert immediately.
- The pause automatically expires after **72 hours** regardless of manual action. This is a hard safety ceiling to prevent a pause becoming a permanent lockout.
- Read-only queries (`get_credit_batch`, `get_retirement_certificate`, `get_active_listings`, etc.) continue to work during a pause, so the public audit trail remains accessible.
- Events `ContractPausedEvent` and `ContractUnpausedEvent` are emitted on-chain and visible via Horizon.

### Who Can Pause

Any team member with access to `ADMIN_SECRET_KEY` can invoke `pause()`. The key is stored in the shared secrets manager (Vault / AWS Secrets Manager — see `docs/configuration.md`). **Do not share the key over Slack or email.** Retrieve it from the secrets manager at incident time.

---

## 2. Severity Classification

Use this table to classify an incident within the first 5 minutes of discovery. Severity drives response speed, who gets paged, and communication obligations.

### P0 — Critical (Pause Immediately)

An active exploit, confirmed fund drain, or confirmed double-counting event that is ongoing.

| Indicator | Example |
|---|---|
| Error code `DoubleCountingDetected` (14) appearing in production transactions | Credits with duplicate serial ranges being accepted |
| Confirmed exploit proof-of-concept circulating publicly or submitted to the team | Researcher demonstrates arbitrary `retire_credits` without ownership |
| Rapid unexplained drain of USDC from marketplace escrow | Escrow balance dropping >10% in a single block window |
| `SerialNumberConflict` (6) errors spiking in a pattern consistent with a replay attack | Dozens of `SerialNumberConflict` errors in <60 seconds from the same address |
| Unauthorized oracle feeding fraudulent monitoring data at scale | `UnauthorizedOracle` (8) errors + anomalous credit issuance |

**Response**: Pause both contracts immediately without waiting for root cause confirmation. Page incident commander and security lead simultaneously. Total time to first pause: ≤ 10 minutes.

### P1 — High (Pause Within 30 Minutes Unless Cleared)

A suspicious anomaly with potential for material harm that has not yet been confirmed as an exploit.

| Indicator | Example |
|---|---|
| Spike in `SerialNumberConflict` (6) errors from multiple distinct addresses | Could be buggy client or coordinated probe |
| `UnauthorizedVerifier` (7) errors from accounts that should be authorized | Possible key compromise or access control regression |
| `UnauthorizedOracle` (8) errors during a known oracle service window | Oracle key may have been rotated without updating the contract |
| Minting volume 5× above the 7-day rolling average with no corresponding verified projects | Could be an oracle misconfiguration or fraudulent issuance |
| Retirement certificate generation stalling or returning corrupt data | May indicate state corruption |

**Response**: Begin investigation immediately. If root cause is not identified and cleared within 30 minutes, escalate to P0 and pause. Do not wait for a full root cause analysis before pausing.

### P2 — Medium (Monitor, No Pause Required Yet)

Anomalies that warrant investigation but pose no immediate threat to funds or credit integrity.

| Indicator | Example |
|---|---|
| Oracle service restart loops (`verification_listener.py` crashing repeatedly) | May indicate misconfiguration or network issue |
| Frontend errors on marketplace pages with no on-chain anomalies | Application bug, not a contract issue |
| Single isolated `SerialNumberConflict` error | Could be a race condition in a legitimate client |
| Price feed deviation alert (>15% single update threshold from `carbon_oracle`) | May be a legitimate market move or stale feed |
| Backend API (port 3001) returning 5xx errors | Infrastructure issue |

**Response**: Assign an engineer to investigate. Monitor Horizon and application logs. Escalate to P1 if the anomaly persists or new indicators emerge. No pause required unless it escalates.

---

## 3. Decision Tree: When to Pause

Work through this tree top-to-bottom. Stop at the first matching node.

```
START: Anomaly detected
│
├─► Is there a confirmed public exploit PoC for either contract?
│   YES ──────────────────────────────────────────► PAUSE BOTH CONTRACTS NOW → Go to section 4
│   NO
│   │
├─► Is USDC escrow balance dropping faster than active purchase volume can explain?
│   YES ──────────────────────────────────────────► PAUSE MARKETPLACE NOW → Go to section 4
│   NO
│   │
├─► Are DoubleCountingDetected (14) errors appearing in confirmed transactions?
│   YES ──────────────────────────────────────────► PAUSE CREDIT CONTRACT NOW → Go to section 4
│   NO
│   │
├─► Are SerialNumberConflict (6) errors spiking? (>10 in 60 seconds)
│   │
│   ├─► Are they from a single address or many addresses?
│   │   SINGLE ─────────────────────────────────► Investigate that address; if exploit PoC
│   │                                              exists → PAUSE. Otherwise: P1, monitor 30 min.
│   │   MANY ───────────────────────────────────► PAUSE CREDIT CONTRACT NOW → Go to section 4
│   NO
│   │
├─► Are UnauthorizedOracle (8) or UnauthorizedVerifier (7) errors spiking
│   AND coinciding with anomalous minting or project approval activity?
│   YES ──────────────────────────────────────────► STOP ORACLE SERVICES FIRST (section 5.1)
│   │                                               Then investigate minting. If fraudulent
│   │                                               minting confirmed → PAUSE BOTH → section 4
│   NO
│   │
├─► Is minting volume >5× 7-day rolling average with no pending verified projects?
│   YES ──────────────────────────────────────────► P1: Investigate oracle. If root cause not
│   │                                               found in 30 min → PAUSE CREDIT CONTRACT
│   NO
│   │
├─► Is the anomaly isolated to the backend API or frontend (no on-chain evidence)?
│   YES ──────────────────────────────────────────► P2: Application issue. No pause. Investigate
│   │                                               backend logs. Restart services as needed.
│   NO
│   │
└─► Unknown anomaly, unclear scope
    └─────────────────────────────────────────────► Convene incident bridge immediately.
                                                    If no clarity in 15 minutes → PAUSE
                                                    both contracts as precaution (P1 escalation).
```

### Trigger Reference Table

| Error Code | Name | Pause? | Notes |
|---|---|---|---|
| 6 | `SerialNumberConflict` | Conditional | Pause if spiking or coordinated |
| 7 | `UnauthorizedVerifier` | Conditional | Pause if coincides with anomalous project approvals |
| 8 | `UnauthorizedOracle` | Stop oracles first | Pause if fraudulent minting confirmed |
| 14 | `DoubleCountingDetected` | YES — immediately | Any occurrence in prod is a P0 |
| 4 | `InsufficientCredits` | No | Normal error |
| 5 | `AlreadyRetired` | No | Normal error |
| 11 | `InsufficientLiquidity` | No | Normal error |

---

## 4. Emergency Pause Checklist

This checklist must be executed by the incident commander (IC) or their designated on-call engineer. Mark each step as it is completed. **Do not skip steps** — each one either prevents further harm or creates the evidence trail needed for recovery.

### Roles

| Role | Responsibility |
|---|---|
| **Incident Commander (IC)** | Owns the checklist. Makes the final call to pause or not pause. |
| **On-Call Engineer** | Executes CLI commands. Reports outputs back to IC. |
| **Communications Lead** | Sends all stakeholder notifications. Keeps status page updated. |
| **Security Lead** | Analyzes root cause. Advises IC on scope of compromise. |

---

### T+0 — Detection (0 minutes)

- [ ] Confirm the source of the alert (Grafana, Horizon, user report, security disclosure).
- [ ] Classify severity using Section 2. Write it down: **P0 / P1 / P2**.
- [ ] Page the Incident Commander if not already on the call.
- [ ] Create an incident channel: `#incident-YYYY-MM-DD-<short-description>` in Slack.
- [ ] Drop a timestamp and initial one-line description in the incident channel.
- [ ] **If P0**: Skip analysis. Go directly to T+5 and begin pausing.
- [ ] **If P1**: Begin investigation (section 3 decision tree). Set a 30-minute timer to escalate if not resolved.

---

### T+5 — Initial Containment (5 minutes)

#### 4.1 Retrieve Admin Credentials

```bash
# Retrieve admin key from secrets manager (do NOT paste key into Slack)
export ADMIN_SECRET_KEY=$(aws secretsmanager get-secret-value \
  --secret-id carbonledger/admin-secret-key \
  --query SecretString --output text | jq -r '.ADMIN_SECRET_KEY')

# Verify the key is set
echo "Key loaded: ${ADMIN_SECRET_KEY:0:4}...${ADMIN_SECRET_KEY: -4}"
```

- [ ] Admin key retrieved and loaded into shell environment.

#### 4.2 Verify Contract IDs

```bash
# Load from your .env or environment
export CARBON_CREDIT_CONTRACT_ID="${CARBON_CREDIT_CONTRACT_ID}"
export CARBON_MARKETPLACE_CONTRACT_ID="${CARBON_MARKETPLACE_CONTRACT_ID}"

echo "Credit contract:      $CARBON_CREDIT_CONTRACT_ID"
echo "Marketplace contract: $CARBON_MARKETPLACE_CONTRACT_ID"
```

- [ ] Contract IDs confirmed correct. Cross-check against `.env` and deployment records.

#### 4.3 Check Current Pause State

```bash
# Check credit contract
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- is_paused

# Check marketplace contract
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- is_paused
```

- [ ] Current pause state of both contracts recorded in incident channel.

---

### T+10 — Execute Pause (10 minutes)

> **Decision point**: IC confirms the pause decision. Record in the incident channel: "IC [name] authorizes pause at [timestamp] because [reason]."

#### 4.4 Pause `carbon_credit`

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- pause \
  --reason "Emergency pause: [brief reason] - incident #YYYY-MM-DD"
```

- [ ] `carbon_credit` pause command executed.
- [ ] Transaction hash recorded: `_________________________________`
- [ ] Verify pause took effect:
  ```bash
  stellar contract invoke \
    --id "$CARBON_CREDIT_CONTRACT_ID" \
    --source "$ADMIN_SECRET_KEY" \
    --network testnet \
    -- is_paused
  # Expected output: true
  ```
- [ ] `is_paused` returns `true` for `carbon_credit`.

#### 4.5 Pause `carbon_marketplace`

```bash
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- pause \
  --reason "Emergency pause: [brief reason] - incident #YYYY-MM-DD"
```

- [ ] `carbon_marketplace` pause command executed.
- [ ] Transaction hash recorded: `_________________________________`
- [ ] Verify:
  ```bash
  stellar contract invoke \
    --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
    --source "$ADMIN_SECRET_KEY" \
    --network testnet \
    -- is_paused
  # Expected output: true
  ```
- [ ] `is_paused` returns `true` for `carbon_marketplace`.

#### 4.6 Confirm Pause Events On-Chain

```bash
# Query ContractPausedEvent from Horizon
curl -s "https://horizon-testnet.stellar.org/accounts/$ADMIN_PUBLIC_KEY/operations?order=desc&limit=10" \
  | jq '.._embedded.records[] | select(.type == "invoke_host_function") | {id, created_at, transaction_hash}'
```

- [ ] `ContractPausedEvent` confirmed on Horizon for both contracts.
- [ ] Event timestamps match expected pause time (within 30 seconds).

---

### T+30 — Off-Chain Containment (30 minutes)

Execute the steps in section 5. Checklist items:

- [ ] Oracle services stopped (section 5.1).
- [ ] Backend queue workers halted (section 5.2).
- [ ] Redis read-only flag set (section 5.3).
- [ ] Frontend banner showing maintenance mode (section 5.4).
- [ ] Database writes frozen for affected tables (section 5.5, if state corruption suspected).
- [ ] First stakeholder notification sent (section 7).

---

### T+60 — Status Update and Investigation (60 minutes)

- [ ] Second status update sent to all stakeholders (see section 7 timeline).
- [ ] Root cause investigation underway. IC has a preliminary theory.
- [ ] Incident channel has a running timeline of all actions taken.
- [ ] Security lead has reviewed Horizon transaction history for the affected contract(s).
- [ ] Recovery path selected: **Path A / Path B / Path C** (see section 9).
- [ ] ETA for resolution communicated to stakeholders.
- [ ] If recovery will require >66 hours, plan for contract re-deploy before auto-expiry (see section 9.4).

---

### T+66h — Auto-Expiry Warning (66 hours after pause)

> The pause auto-expires at 72 hours. **If the system is not ready to resume, you must re-pause before expiry.** Set a calendar reminder at T+66h.

- [ ] Is the incident resolved and the system safe to unpause? 
  - YES → Proceed to section 9 recovery.
  - NO → Re-execute the pause commands (section 4.4 and 4.5) to reset the 72-hour window.
- [ ] Stakeholder notification sent explaining the re-pause if applicable.

---

## 5. Off-Chain Containment Steps

Pausing contracts stops on-chain state mutations, but the oracle services, backend queue workers, and frontend can still generate invalid state or confuse users. Complete these steps in parallel with section 4 or immediately after.

### 5.1 Stop Oracle Services

The oracle services can attempt to push monitoring data and price feeds even while contracts are paused. These calls will fail (and generate noise in logs), and in some scenarios a compromised oracle was the attack vector. Stop all three services immediately.

```bash
# If running as systemd services
sudo systemctl stop carbonledger-verification-listener
sudo systemctl stop carbonledger-price-oracle
sudo systemctl stop carbonledger-satellite-monitor

# If running as background processes (development/staging)
pkill -f "verification_listener.py"
pkill -f "price_oracle.py"
pkill -f "satellite_monitor.py"

# Confirm they are stopped
ps aux | grep -E "verification_listener|price_oracle|satellite_monitor" | grep -v grep
# Expected: no output
```

- [ ] All three oracle services stopped and confirmed not running.

If `UnauthorizedOracle` (8) was the trigger: additionally rotate the oracle signing key before restart.

```bash
# Generate new oracle keypair
stellar keys generate oracle-key-$(date +%Y%m%d) --network testnet

# Update the oracle authorized key in the contract
stellar contract invoke \
  --id "$CARBON_ORACLE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- set_oracle_key \
  --new_key "G<NEW_ORACLE_PUBLIC_KEY>"
```

### 5.2 Halt Backend Queue Workers

The NestJS backend has queue workers (Bull/Redis queues) that process credit issuance requests, marketplace events, and retirement certificate generation. During a pause, these workers should be halted to prevent them from queuing operations that will fail on-chain.

```bash
# Option A: Stop the backend service entirely
sudo systemctl stop carbonledger-backend
# or in Docker:
docker-compose stop backend

# Option B: Drain and pause queues (without stopping backend, preserves health checks)
# Connect to Redis and set the halt flag
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" SET carbonledger:queues:halted "1" EX 86400
# This flag is checked by the NestJS queue processors before picking up new jobs
# (requires the queue processors to implement this check — see docs/configuration.md)

# Verify Redis flag
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" GET carbonledger:queues:halted
# Expected: "1"
```

- [ ] Queue workers halted (service stopped or Redis halt flag set).

### 5.3 Set Redis Read-Only Mode for Frontend

Setting a well-known Redis key instructs the frontend API routes to return a maintenance response for any mutation operation, before they even attempt to hit the blockchain.

```bash
# Set the global maintenance flag
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" SET carbonledger:maintenance:active "1" EX 259200
# EX 259200 = 72 hours, matches the contract pause window

# Set a human-readable status message (used by the frontend banner)
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" SET carbonledger:maintenance:message \
  "CarbonLedger is temporarily in read-only mode due to a security investigation. Existing credits and retirement certificates are unaffected. We will provide an update within 60 minutes." \
  EX 259200

# Verify
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" GET carbonledger:maintenance:active
# Expected: "1"
```

- [ ] Redis maintenance flag set. Frontend now returns read-only mode for mutations.
- [ ] Maintenance message set and readable.

### 5.4 Verify Frontend Shows Maintenance Banner

```bash
# Check the frontend health endpoint
curl -s http://localhost:3000/api/health | jq .
# Expected to include: "maintenance": true

# Check that purchase endpoint returns maintenance response
curl -s -X POST http://localhost:3000/api/marketplace/purchase \
  -H "Content-Type: application/json" \
  -d '{"test": true}' | jq .
# Expected: 503 with maintenance message, not a 500 or blockchain error
```

- [ ] Frontend maintenance banner confirmed active.
- [ ] Mutation endpoints return 503 with maintenance message.

### 5.5 Freeze Database Writes (State Corruption Cases Only)

Only execute this step if there is evidence of **state corruption** (incorrect data in the PostgreSQL database that does not match on-chain state). If the issue is purely on-chain, skip this step.

```bash
# Connect to PostgreSQL
psql "$DATABASE_URL"

# Revoke write permissions from the application user on affected tables
REVOKE INSERT, UPDATE, DELETE ON credits FROM carbonledger_app;
REVOKE INSERT, UPDATE, DELETE ON retirements FROM carbonledger_app;
REVOKE INSERT, UPDATE, DELETE ON marketplace_listings FROM carbonledger_app;

-- Verify
\dp credits
```

- [ ] (If applicable) Database writes frozen on affected tables.
- [ ] Record which tables were frozen in the incident channel.

---

## 6. On-Chain Verification Steps

These steps collect evidence from Horizon to understand the scope and timeline of the incident.

### 6.1 Query Recent Contract Operations

```bash
# Get recent invocations on the credit contract (last 200 operations)
curl -s "https://horizon-testnet.stellar.org/accounts/$CARBON_CREDIT_CONTRACT_ID/operations?order=desc&limit=200" \
  | jq '._embedded.records[] | {id, created_at, type, transaction_successful, transaction_hash}' \
  > incident-credit-ops-$(date +%Y%m%d-%H%M%S).json

# Get recent invocations on the marketplace contract
curl -s "https://horizon-testnet.stellar.org/accounts/$CARBON_MARKETPLACE_CONTRACT_ID/operations?order=desc&limit=200" \
  | jq '._embedded.records[] | {id, created_at, type, transaction_successful, transaction_hash}' \
  > incident-marketplace-ops-$(date +%Y%m%d-%H%M%S).json

echo "Evidence files saved."
ls -la incident-*.json
```

- [ ] Recent operations exported for both contracts and saved as evidence.

### 6.2 Check for Anomalous Minting Events

```bash
# Look for mint_credits calls — filter on-chain events via Horizon
# Replace with the specific time window of the suspected incident
curl -s "https://horizon-testnet.stellar.org/accounts/$CARBON_CREDIT_CONTRACT_ID/operations?order=desc&limit=500" \
  | jq '[._embedded.records[] | select(.function == "mint_credits")]' \
  > incident-mint-events-$(date +%Y%m%d-%H%M%S).json

# Count minting events
jq 'length' incident-mint-events-*.json
```

- [ ] Minting events reviewed. Total count in last 24h: `_______`
- [ ] Any anomalous minting calls identified: YES / NO
- [ ] If YES: Transaction hashes of anomalous calls recorded: `_________________________________`

### 6.3 Check Serial Number Ranges

```bash
# Query a batch to verify serial numbers are unique and non-overlapping
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- verify_serial_range \
  --start_serial <SUSPECTED_START> \
  --end_serial <SUSPECTED_END>
# Expected: false (no conflict) or true (conflict confirmed)
```

- [ ] Serial number range check completed.
- [ ] Conflicts identified: YES / NO
- [ ] If YES: Ranges involved: `_________________________________`

### 6.4 Verify Pause Events Are On-Chain

```bash
# Query the specific pause transaction
curl -s "https://horizon-testnet.stellar.org/transactions/<PAUSE_TX_HASH>" \
  | jq '{id, successful, created_at, fee_charged}'
```

- [ ] Both pause transactions confirmed successful on Horizon.
- [ ] ContractPausedEvent visible in transaction results for both contracts.

### 6.5 Check USDC Escrow Balance

```bash
# Get the marketplace contract's USDC balance (use USDC contract ID from Stellar.toml)
stellar contract invoke \
  --id "$USDC_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- balance \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID"

# Compare with the expected balance from the database
psql "$DATABASE_URL" -c "SELECT SUM(total_price_usdc) FROM marketplace_listings WHERE status = 'active';"
```

- [ ] USDC escrow balance retrieved: `_______`
- [ ] Expected balance from database: `_______`
- [ ] Discrepancy: YES / NO
- [ ] If YES, amount and direction of discrepancy recorded in incident channel.

---

## 7. Communication Plan

### Timeline Table

Every stakeholder communication must be logged in the incident channel with timestamp and copy of message sent.

| Time | Audience | Channel | Message Type | Owner |
|---|---|---|---|---|
| T+0 | Internal engineering | `#incident-*` Slack channel | Alert: incident opened, severity, who is IC | IC |
| T+10 | Internal leadership (P0/P1 only) | `#leadership-alerts` + direct page | Brief: contracts paused, scope unknown, ETA TBD | IC |
| T+15 | All active users (P0/P1 only) | Status page (status.carbonledger.io) | Service degradation notice, no user data at risk | Comms Lead |
| T+30 | Corporate customers with active transactions | Email (from CRM) | Specific: transactions paused, no USDC at risk, ETA | Comms Lead |
| T+60 | All stakeholders | Status page + email | Update: investigation status, preliminary cause, new ETA | IC + Comms Lead |
| T+2h | All stakeholders | Status page | Update: root cause confirmed or still investigating | Comms Lead |
| T+4h (if unresolved) | Corporate customers | Email | Extended investigation notice, compensation info if relevant | Comms Lead |
| Resolution | All stakeholders | Status page + email + Slack | Resolved: what happened, what was done, what changes | IC |
| T+7 days | All stakeholders | Email + blog post | PIR summary: full timeline, root cause, improvements | Engineering Lead |

### Communication Principles

1. **Never speculate publicly about root cause** until it is confirmed. Use "we are investigating an anomaly" not "we found a bug."
2. **Never say user funds are safe unless you have verified it** (section 6.5). Say "we are verifying the status of all funds" until confirmed.
3. **Communicate early and often**. A message that says "we don't know yet but we're investigating" is better than silence.
4. **Keep the status page updated**. Users and regulators will check it. An outdated status page signals negligence.
5. **Do not delete or edit previous communications.** Post corrections as new messages.

---

## 8. Stakeholder Notification Templates

Copy these templates. Fill in the bracketed fields. **Do not improvise the public-facing messages** — use these to stay legally and reputationally safe.

---

### 8.1 Internal Incident Channel — Opening Message

```
🔴 INCIDENT OPENED — [P0 / P1]

Time: [UTC timestamp]
IC: [name]
On-call engineer: [name]
Security lead: [name]

Summary: [One sentence: what was observed, e.g. "Spike in SerialNumberConflict errors from multiple addresses suggesting coordinated replay attack"]

Actions taken:
- [T+0]: Alert received via [Grafana / user report / Horizon monitoring]
- [T+5]: Admin key retrieved
- [T+10]: carbon_credit paused (tx: [hash])
- [T+10]: carbon_marketplace paused (tx: [hash])

Current status: Contracts paused. Off-chain containment in progress. Investigation starting.

Next update: [T+60 or specific time]

Incident channel: #incident-[date]-[slug]
```

---

### 8.2 Internal Incident Channel — Hourly Update

```
📊 INCIDENT UPDATE — [P0 / P1] — T+[N]h

Time: [UTC timestamp]

Investigation findings:
- [Bullet point of each finding]

Current status: [Paused / Under investigation / Recovery in progress]

Root cause: [Confirmed: X | Still investigating | Not yet determined]

Recovery path: [Path A / B / C | Not yet selected]

ETA to resolution: [Time estimate or "unknown, next update in 1h"]

Actions since last update:
- [List]

Next update: [time]
```

---

### 8.3 Status Page — Initial Degradation Notice

> **Audience**: Public (users, regulators, press)

```
**Investigating — Marketplace and Credit Operations Temporarily Suspended**
[UTC timestamp]

We are currently investigating an anomaly affecting CarbonLedger marketplace 
and credit operations. As a precautionary measure, all credit minting, transfers, 
purchases, and retirements have been temporarily suspended while we investigate.

**What this means for you:**
- Your existing carbon credits and retirement certificates are unaffected
- The public audit trail remains fully accessible
- No user data or funds have been confirmed at risk (we are actively verifying)
- New purchases and retirements are not possible at this time

We will post an update within 60 minutes.

Status: **Investigating**
```

---

### 8.4 Status Page — Update (Root Cause Known)

```
**Update — Root Cause Identified, Recovery In Progress**
[UTC timestamp]

We have identified the cause of today's service suspension: [brief factual description, 
e.g., "an anomalous transaction pattern that triggered our double-counting detection 
safeguards"].

**Status:**
- Carbon credit minting and transfers: **Suspended** (precautionary)
- Marketplace purchases: **Suspended** (precautionary)  
- Audit trail and certificate lookups: **Operational**
- User funds and credit balances: **No impact confirmed**

We expect to restore full service by approximately [UTC time].

Status: **In Progress**
```

---

### 8.5 Status Page — Resolved

```
**Resolved — Full Service Restored**
[UTC timestamp]

All CarbonLedger services have been restored as of [UTC time].

**Summary of incident:**
- Duration: [X hours Y minutes]
- Impact: Marketplace purchases and credit operations were suspended
- Root cause: [1-2 sentence factual description]
- User impact: [e.g., "No user funds were affected. No credits were incorrectly issued or retired."]

**What we've done:**
- [Action 1: e.g., patched oracle key rotation procedure]
- [Action 2]
- [Action 3]

A full post-incident review will be published within 7 days.

Status: **Resolved**
```

---

### 8.6 Email — Corporate Customer Notification (Initial)

> **Subject**: `[CarbonLedger] Service notice — credit operations temporarily paused`

```
Dear [Customer Name],

We are writing to inform you that CarbonLedger has temporarily suspended credit 
operations as a precautionary measure while we investigate an anomaly.

What this means for you:

• Your existing carbon credit holdings are secure and unaffected
• Any pending purchase or retirement transactions have been paused and will be 
  completed once service is restored — no transactions have been lost
• Your retirement certificates remain accessible and valid
• The public audit trail for all your past retirements is fully operational

We expect to restore service by approximately [time]. We will contact you again 
once service is restored, or sooner if the timeline changes significantly.

If you have an urgent compliance deadline that depends on a pending transaction, 
please reply to this email and we will prioritize your case.

We apologize for this inconvenience and appreciate your patience.

[Your name]
CarbonLedger Engineering Team
support@carbonledger.io
```

---

### 8.7 Email — Corporate Customer Notification (Resolved)

> **Subject**: `[CarbonLedger] Service restored — full operations resumed`

```
Dear [Customer Name],

CarbonLedger services have been fully restored as of [UTC time today].

What happened:
[1-2 sentence plain-English explanation of the root cause, without jargon]

Impact to you:
[Specific to each customer — e.g., "Your pending retirement of 500 credits has been 
processed successfully. Your certificate is available at [URL]."]
OR
[e.g., "We confirmed no impact to your account. All your credits and certificates 
are exactly as they were before the incident."]

What we've changed:
• [Improvement 1]
• [Improvement 2]

A detailed post-incident report will be published on our status page within 7 days.

Thank you for your patience.

[Your name]
CarbonLedger Engineering Team
support@carbonledger.io
```

---

## 9. Recovery Procedures

Before executing any recovery path, confirm:
- [ ] Root cause has been identified (or a P0/P1 risk-based decision has been made).
- [ ] Security lead has signed off that it is safe to unpause.
- [ ] IC has documented the recovery decision in the incident channel.

### Path A: False Positive (No Exploit, No Corruption)

**Scenario**: Investigation reveals the anomaly was a false alarm — e.g., a buggy client generating `SerialNumberConflict` errors, or an oracle restart that briefly produced incorrect data that was rejected by the contract.

**Criteria to use Path A**:
- No fraudulent transactions confirmed on-chain.
- No serial number conflicts in committed state.
- USDC escrow balance matches database records.
- Root cause is a non-security defect (client bug, misconfiguration, transient network error).

**Steps**:

```bash
# 1. Clear the maintenance flag in Redis
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" DEL carbonledger:maintenance:active
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" DEL carbonledger:maintenance:message
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" DEL carbonledger:queues:halted

# 2. Unpause carbon_credit
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- unpause

# 3. Verify
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- is_paused
# Expected: false

# 4. Unpause carbon_marketplace
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- unpause

# 5. Verify
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- is_paused
# Expected: false

# 6. Restart oracle services
sudo systemctl start carbonledger-verification-listener
sudo systemctl start carbonledger-price-oracle
sudo systemctl start carbonledger-satellite-monitor

# 7. Restart backend if it was stopped
sudo systemctl start carbonledger-backend

# 8. Confirm health
curl -s http://localhost:3001/health | jq .
# Expected: { "status": "ok", "database": "connected", "redis": "connected" }
```

- [ ] Redis flags cleared.
- [ ] Both contracts unpaused and `is_paused` returns `false`.
- [ ] Oracle services restarted and healthy.
- [ ] Backend healthy.
- [ ] ContractUnpausedEvent confirmed on Horizon for both contracts.
- [ ] Resolution message posted to status page and incident channel.

---

### Path B: Exploit Confirmed, No State Corruption

**Scenario**: A real exploit was executed, but the on-chain state remains internally consistent (the exploit was caught before it could corrupt data, e.g., by the existing error codes or because it was a probe rather than a full attack). No credits were incorrectly issued or retired. No USDC was drained.

**Criteria to use Path B**:
- Exploit mechanism identified and understood.
- On-chain state verified clean (section 6 checks all pass).
- Fix has been developed, reviewed, and tested on a local environment.
- Security lead has confirmed the fix addresses the root cause.

**Steps**:

1. **Deploy patched contract** (do not unpause first — deploy while paused):

```bash
# Build the patched contract
cd contracts
cargo build --target wasm32-unknown-unknown --release

# Deploy patched carbon_credit (this creates a NEW contract ID)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_credit.wasm \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet
# Save new contract ID: NEW_CREDIT_CONTRACT_ID=C...

# Deploy patched carbon_marketplace
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_marketplace.wasm \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet
# Save new contract ID: NEW_MARKETPLACE_CONTRACT_ID=C...
```

2. **Update environment and backend with new contract IDs**:

```bash
# Update .env
sed -i "s/CARBON_CREDIT_CONTRACT_ID=.*/CARBON_CREDIT_CONTRACT_ID=$NEW_CREDIT_CONTRACT_ID/" .env
sed -i "s/CARBON_MARKETPLACE_CONTRACT_ID=.*/CARBON_MARKETPLACE_CONTRACT_ID=$NEW_MARKETPLACE_CONTRACT_ID/" .env

# Restart backend to pick up new IDs
sudo systemctl restart carbonledger-backend
```

3. **Clear Redis flags and restart oracles** (same as Path A steps 1, 6, 7).

4. **Verify end-to-end on testnet** before unpausing on mainnet (if applicable):

```bash
# Test a mint on the new contract
stellar contract invoke \
  --id "$NEW_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- mint_credits \
  --project_id "TEST-PROJECT-001" \
  --amount 1 \
  --vintage_year 2025

# Test a listing
stellar contract invoke \
  --id "$NEW_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- list_credits \
  --credit_batch_id "TEST-BATCH-001" \
  --amount 1 \
  --price_per_tonne 1000000
```

5. **Post resolution** (same as Path A steps 8 onwards).

- [ ] Patched contracts deployed with new contract IDs.
- [ ] Environment updated with new contract IDs.
- [ ] End-to-end test passed on patched contracts.
- [ ] Oracle services restarted pointing at new contract IDs.
- [ ] Resolution message posted. Full PIR scheduled.

---

### Path C: State Corruption Confirmed

**Scenario**: On-chain state or database state has been corrupted by the exploit. Credits were fraudulently issued, incorrectly retired, or USDC was drained. This is the most severe scenario and requires a coordinated response with potential regulatory notification.

**Criteria to use Path C**:
- Fraudulent transactions confirmed on-chain (duplicated serial numbers, unauthorized retirements, etc.).
- USDC escrow balance does not match expected balance.
- Database records are inconsistent with on-chain state.

> **This path requires executive sign-off before execution.**

**Steps**:

1. **Do not unpause contracts until full scope is known.** If the 72-hour window is approaching, re-pause.

2. **Preserve all evidence**:

```bash
# Export complete Horizon history for both contracts
curl -s "https://horizon-testnet.stellar.org/accounts/$CARBON_CREDIT_CONTRACT_ID/operations?order=asc&limit=1000" \
  > evidence-credit-full-history-$(date +%Y%m%d).json

# Export database snapshot
pg_dump "$DATABASE_URL" > evidence-db-snapshot-$(date +%Y%m%d-%H%M%S).sql

# Export Redis state
redis-cli -h localhost -p 6379 -a "$REDIS_PASSWORD" --rdb /tmp/evidence-redis-$(date +%Y%m%d).rdb

echo "Evidence preserved."
```

3. **Identify all affected accounts** — compile a list of every address that participated in fraudulent transactions.

4. **Quantify the impact** — calculate exact USDC drained and exact credits fraudulently issued or retired.

5. **Engage legal and compliance team** — if user funds are missing, regulatory notification may be required under applicable jurisdiction.

6. **Develop remediation plan** with security lead and legal:
   - If USDC was drained: determine if reserves can cover affected users and how restitution will be handled.
   - If credits were fraudulently minted: plan for invalidating those batches (may require contract logic changes).
   - If credits were fraudulently retired: those retirements are irreversible on-chain; the response must be an off-chain registry correction.

7. **Deploy patched and/or migrated contracts** following a full security audit (do not skip the audit for a mainnet deployment).

8. **Rehydrate database from verified on-chain state** if database was corrupted:

```bash
# Run the state reconciliation script (must be built for the specific incident)
cd scripts
node reconcile-state.js --from-horizon --contract-id $CARBON_CREDIT_CONTRACT_ID \
  --start-date YYYY-MM-DD --dry-run

# Review the reconciliation output, then run without dry-run:
node reconcile-state.js --from-horizon --contract-id $CARBON_CREDIT_CONTRACT_ID \
  --start-date YYYY-MM-DD
```

9. **Notify affected users directly** with specifics of how their account was affected and what remediation is being provided.

- [ ] Evidence preserved (Horizon history, DB snapshot, Redis dump).
- [ ] All affected accounts identified and impact quantified.
- [ ] Legal and compliance engaged.
- [ ] Executive sign-off on remediation plan obtained.
- [ ] Patched contracts deployed and audited.
- [ ] Database reconciled with on-chain state.
- [ ] All affected users directly notified.
- [ ] Regulatory notifications sent if required.
- [ ] Full PIR scheduled within 7 days.

---

### 9.4 Handling the 72-Hour Auto-Expiry

The contract pause auto-expires after 72 hours. If recovery will take longer:

```bash
# At T+66h (6 hours before expiry), if not ready to unpause:
# Re-execute the pause commands to reset the window

stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- pause \
  --reason "Extending emergency pause: ongoing investigation - incident #YYYY-MM-DD"

stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- pause \
  --reason "Extending emergency pause: ongoing investigation - incident #YYYY-MM-DD"
```

- Notify stakeholders any time the pause is extended.
- Document the extension reason in the incident channel.
- Each extension resets the 72-hour window.

---

## 10. Post-Incident Review Process

A Post-Incident Review (PIR) is required for **every P0 incident** and any P1 incident that lasted more than 2 hours or affected customer funds. For minor P1 and P2 incidents, a lightweight internal review is sufficient.

### 10.1 Scheduling

| Incident severity | PIR meeting | Published report |
|---|---|---|
| P0 | Within 48 hours of resolution | Within 7 days of resolution |
| P1 (>2h or fund impact) | Within 72 hours of resolution | Within 10 days of resolution |
| P1 (minor) | Within 1 week | Internal only |
| P2 | Optional; include in weekly engineering review | Internal only |

### 10.2 PIR Meeting Agenda (60 minutes)

**Participants**: IC, on-call engineer(s), security lead, engineering lead, product lead (for P0). Optionally: a customer representative for P0.

| Time | Topic |
|---|---|
| 0:00 – 0:05 | Framing: blameless post-mortem, focus on systems not people |
| 0:05 – 0:20 | Timeline walkthrough: IC presents the full incident timeline |
| 0:20 – 0:35 | Root cause analysis: what were the contributing factors? (use 5-whys) |
| 0:35 – 0:50 | What went well / what could have gone better |
| 0:50 – 0:60 | Action items: assign owners and due dates |

**Facilitation notes**:
- Record the meeting (with consent).
- One person takes notes in the PIR document in real time.
- All action items must have a named owner and a specific due date before the meeting ends.
- No blame. "The system allowed X" not "Engineer Y caused X."

### 10.3 PIR Report Template

```markdown
# Post-Incident Review: [Incident Title]

**Date of incident**: [YYYY-MM-DD]
**Date of PIR meeting**: [YYYY-MM-DD]
**Severity**: [P0 / P1]
**Duration**: [X hours Y minutes — from first alert to full resolution]
**IC**: [Name]
**Authors**: [Names]

## Summary

[2-3 sentence plain-English summary of what happened, what was impacted, and 
how it was resolved.]

## Impact

| Category | Details |
|---|---|
| User impact | [e.g., "500 users unable to purchase credits for 4h 23min"] |
| Financial impact | [e.g., "No USDC drained. Estimated $X in delayed transactions."] |
| Credit integrity | [e.g., "No fraudulent credits minted or retired."] |
| Regulatory | [e.g., "No regulatory notification required."] |

## Timeline

| Time (UTC) | Event |
|---|---|
| HH:MM | First alert received |
| HH:MM | IC paged |
| HH:MM | P0 declared |
| HH:MM | carbon_credit paused (tx: ...) |
| HH:MM | carbon_marketplace paused (tx: ...) |
| HH:MM | Oracle services stopped |
| HH:MM | Redis maintenance flag set |
| HH:MM | First stakeholder notification sent |
| HH:MM | Root cause identified |
| HH:MM | Recovery path selected (Path A / B / C) |
| HH:MM | Contracts unpaused |
| HH:MM | All services restored |
| HH:MM | Incident resolved |

## Root Cause Analysis

### Proximate cause
[What directly triggered the incident]

### Contributing factors
1. [Factor 1: e.g., "No rate limiting on the mint endpoint allowed the attack to scale"]
2. [Factor 2]
3. [Factor 3]

### 5-Whys
- Why did [symptom] occur?
  - Because [cause 1]
- Why did [cause 1] exist?
  - Because [cause 2]
- ... (continue until root cause is reached)

**Root cause**: [Final answer]

## What Went Well

- [e.g., "Pause mechanism worked as designed — contracts were halted within 8 minutes"]
- [e.g., "On-call engineer had admin key access within 3 minutes"]
- [e.g., "Status page was updated before most users noticed the outage"]

## What Could Have Gone Better

- [e.g., "Grafana alert threshold was too high — we should have been alerted 20 minutes earlier"]
- [e.g., "The PIR template was not available during the incident — responders had to improvise notifications"]
- [e.g., "The admin key retrieval took 4 minutes due to unclear Vault path documentation"]

## Action Items

| ID | Category | Description | Owner | Due Date |
|---|---|---|---|---|
| PIR-[DATE]-001 | Detection | Lower Grafana alert threshold for SerialNumberConflict to 5 errors/minute | [Name] | [Date] |
| PIR-[DATE]-002 | Runbook | Add Vault path to admin key retrieval step in section 4.1 | [Name] | [Date] |
| PIR-[DATE]-003 | Monitoring | Add Horizon escrow balance monitoring dashboard | [Name] | [Date] |
| PIR-[DATE]-004 | Testing | Add chaos test: simulate SerialNumberConflict spike and verify alert fires | [Name] | [Date] |

## Appendices

- A: Full Horizon transaction export (attached)
- B: Database snapshot (internal, access restricted)
- C: Full incident Slack thread (link)
- D: Grafana dashboard screenshots at time of incident (attached)
```

### 10.4 Action Item Categories

Use these categories when writing action items in the PIR. They help the team track systemic improvements over time.

| Category | What it covers | Examples |
|---|---|---|
| **Detection** | Improving how quickly we see problems | Alert thresholds, new monitors, Horizon event subscriptions |
| **Diagnosis** | Improving how quickly we understand problems | Better logging, trace IDs, Horizon query tooling |
| **Containment** | Improving how quickly we limit damage | Runbook clarity, credential retrieval speed, automated pause triggers |
| **Communication** | Improving stakeholder notifications | Template improvements, status page automation, notification timing |
| **Recovery** | Improving how quickly we restore service | Deployment automation, state reconciliation tooling, test coverage for recovery paths |
| **Prevention** | Fixing the root cause so it cannot recur | Code fixes, access control improvements, security audits |
| **Process** | Improving the incident response process itself | Runbook updates, PIR process changes, on-call rotation improvements |

### 10.5 Following Up on Action Items

- Action items from PIRs are tracked in the project issue tracker with label `pir-action-item`.
- The engineering lead reviews open PIR action items weekly until all are closed.
- Any PIR action item that misses its due date is escalated to the engineering lead within 24 hours.
- PIR reports are stored in `docs/pir/` with filename `YYYY-MM-DD-<slug>.md`.

---

## 11. Quick Reference Card

> Print or bookmark this section. During a live incident, go here first.

### The 3 Things to Do in the First 10 Minutes

```
1. CLASSIFY: P0, P1, or P2? (Section 2)
2. PAUSE: If P0 or unclear → pause both contracts immediately (Section 4.4 + 4.5)
3. PAGE: IC + Comms Lead + Security Lead
```

### Pause Commands (copy-paste)

```bash
# Pause carbon_credit
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- pause --reason "Emergency pause: [reason]"

# Pause carbon_marketplace
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- pause --reason "Emergency pause: [reason]"
```

### Unpause Commands (copy-paste)

```bash
# Unpause carbon_credit
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- unpause

# Unpause carbon_marketplace
stellar contract invoke \
  --id "$CARBON_MARKETPLACE_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network testnet \
  -- unpause
```

### Set/Clear Maintenance Mode (Redis)

```bash
# SET maintenance mode
redis-cli SET carbonledger:maintenance:active "1" EX 259200
redis-cli SET carbonledger:queues:halted "1" EX 259200

# CLEAR maintenance mode
redis-cli DEL carbonledger:maintenance:active
redis-cli DEL carbonledger:maintenance:message
redis-cli DEL carbonledger:queues:halted
```

### Stop/Start Oracle Services

```bash
# STOP
sudo systemctl stop carbonledger-verification-listener carbonledger-price-oracle carbonledger-satellite-monitor

# START
sudo systemctl start carbonledger-verification-listener carbonledger-price-oracle carbonledger-satellite-monitor
```

### Error Codes That Should Trigger Investigation

| Code | Name | Action |
|---|---|---|
| 6 | SerialNumberConflict | Investigate; pause if spiking |
| 7 | UnauthorizedVerifier | Investigate key compromise |
| 8 | UnauthorizedOracle | Stop oracle services immediately |
| 14 | DoubleCountingDetected | **PAUSE IMMEDIATELY — P0** |

### Key URLs

- Horizon (testnet): `https://horizon-testnet.stellar.org`
- Status page: `https://status.carbonledger.io`
- Backend health: `http://localhost:3001/health`
- Grafana: `http://localhost:3200`
- Incident channel naming: `#incident-YYYY-MM-DD-<slug>`

---

## 12. Related Documents

| Document | Location | What it covers |
|---|---|---|
| Credit Lifecycle | `docs/carbon-credit-lifecycle.md` | Full credit lifecycle, actors, error conditions |
| Configuration Guide | `docs/configuration.md` | Every environment variable, secrets manager paths |
| Troubleshooting | `docs/TROUBLESHOOTING.md` | Common issues and fixes |
| ADR Index | `docs/adr/README.md` | Architectural decisions including pause mechanism design |
| Quick Reference | `docs/QUICK_REFERENCE.md` | One-page command reference |
| Security Policy | `SECURITY.md` | Responsible disclosure, threat model |
| Contributing | `CONTRIBUTING.md` | Development workflow |
| Folder Structure | `docs/folder-structure.md` | Where everything lives |
| PIR Archive | `docs/pir/` | Past post-incident reviews |

---

## Appendix A: Incident Severity Decision Matrix

Use this as a secondary check if the Section 2 table is ambiguous.

```
                       ┌──────────────────────────────────────┐
                       │         USER IMPACT                  │
                       │  None  │  Limited  │  Widespread     │
              ┌────────┼────────┼───────────┼─────────────────┤
              │  None  │   P2   │    P2     │      P1         │
  FINANCIAL   ├────────┼────────┼───────────┼─────────────────┤
  / CREDIT    │ Poten- │   P1   │    P1     │      P0         │
  INTEGRITY   │  tial  │        │           │                 │
  RISK        ├────────┼────────┼───────────┼─────────────────┤
              │Confirm-│   P0   │    P0     │      P0         │
              │  ed    │        │           │                 │
              └────────┴────────┴───────────┴─────────────────┘
```

---

## Appendix B: On-Call Rotation

The on-call rotation schedule and contact information is maintained in the internal team calendar and PagerDuty. Do not hardcode contact information in this document — it will go stale. Reference the PagerDuty schedule directly.

For incidents outside business hours:
- P0: Page IC immediately, no threshold.
- P1: Page IC if not resolved within 30 minutes.
- P2: Log in issue tracker; address next business day.

---

## Appendix C: Regulatory Considerations

CarbonLedger operates in the voluntary carbon market and may be subject to regulatory scrutiny in some jurisdictions. For any P0 incident:

1. Preserve all evidence before taking any recovery action (section 9, Path C, step 2).
2. Notify the legal team within 2 hours of a P0 declaration.
3. Do not communicate publicly about confirmed exploits or fund losses until legal has reviewed the message.
4. Retain all incident records (Slack, logs, Horizon exports, PIR) for a minimum of 7 years.

---

*This document is maintained by the CarbonLedger core engineering team. For corrections or updates, open a PR targeting `main` with the label `docs:runbook`. Changes to this document require review from the security lead and engineering lead before merge.*

*Closes issue #1205.*
