# CarbonLedger — Admin Pause Operations Guide

> **Closes:** Issue #1204  
> **Audience:** Contract administrators holding the designated admin keypair.  
> **Scope:** Definitive reference for pausing and unpausing `carbon_credit` and `carbon_marketplace` contracts in response to active security incidents.  
> **See also:** [PAUSE_OPERATIONS_GUIDE.md](PAUSE_OPERATIONS_GUIDE.md) — overview reference; this guide is the authoritative step-by-step admin runbook.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
   - 2.1 [Required access and tooling](#21-required-access-and-tooling)
   - 2.2 [Verification commands](#22-verification-commands)
   - 2.3 [Environment setup](#23-environment-setup)
3. [When to Pause](#3-when-to-pause)
   - 3.1 [Pause immediately — confirmed incidents](#31-pause-immediately--confirmed-incidents)
   - 3.2 [Do not pause — non-qualifying events](#32-do-not-pause--non-qualifying-events)
   - 3.3 [Decision checklist](#33-decision-checklist)
4. [Step-by-Step Pause Instructions](#4-step-by-step-pause-instructions)
   - 4.1 [Open the incident channel](#41-open-the-incident-channel)
   - 4.2 [Pause carbon_credit](#42-pause-carbon_credit)
   - 4.3 [Pause carbon_marketplace](#43-pause-carbon_marketplace)
   - 4.4 [Verify both contracts are paused](#44-verify-both-contracts-are-paused)
   - 4.5 [Confirm pause events on Horizon / Soroban RPC](#45-confirm-pause-events-on-horizon--soroban-rpc)
   - 4.6 [Stop oracle services](#46-stop-oracle-services)
   - 4.7 [Log the pause details](#47-log-the-pause-details)
5. [Step-by-Step Unpause Instructions](#5-step-by-step-unpause-instructions)
   - 5.1 [Resolution criteria — all must be met](#51-resolution-criteria--all-must-be-met)
   - 5.2 [Unpause carbon_marketplace first](#52-unpause-carbon_marketplace-first)
   - 5.3 [Unpause carbon_credit](#53-unpause-carbon_credit)
   - 5.4 [Verify both contracts are unpaused](#54-verify-both-contracts-are-unpaused)
   - 5.5 [Restart oracle services](#55-restart-oracle-services)
   - 5.6 [Post-unpause monitoring](#56-post-unpause-monitoring)
6. [Pause Renewal Procedure](#6-pause-renewal-procedure)
   - 6.1 [When to renew](#61-when-to-renew)
   - 6.2 [Renewal commands](#62-renewal-commands)
   - 6.3 [Renewal logging](#63-renewal-logging)
7. [Post-Pause Checklist](#7-post-pause-checklist)
   - 7.1 [Immediate — within 15 minutes](#71-immediate--within-15-minutes)
   - 7.2 [Within 1 hour](#72-within-1-hour)
   - 7.3 [Before pause expiry — at least 6 hours before 72-hour mark](#73-before-pause-expiry--at-least-6-hours-before-72-hour-mark)
   - 7.4 [After unpausing](#74-after-unpausing)
8. [Rollback Procedures](#8-rollback-procedures)
   - 8.1 [What "rollback" means on Soroban](#81-what-rollback-means-on-soroban)
   - 8.2 [Path A — Confirmed false positive, no state damage](#82-path-a--confirmed-false-positive-no-state-damage)
   - 8.3 [Path B — Real incident, limited state damage](#83-path-b--real-incident-limited-state-damage)
   - 8.4 [Path C — Catastrophic state compromise, redeploy required](#84-path-c--catastrophic-state-compromise-redeploy-required)
9. [Communication Templates](#9-communication-templates)
   - 9.1 [Internal incident channel — initial notification](#91-internal-incident-channel--initial-notification)
   - 9.2 [Internal incident channel — 30-minute update](#92-internal-incident-channel--30-minute-update)
   - 9.3 [Internal incident channel — resolution](#93-internal-incident-channel--resolution)
   - 9.4 [User-facing status page — incident open](#94-user-facing-status-page--incident-open)
   - 9.5 [User-facing status page — update while paused](#95-user-facing-status-page--update-while-paused)
   - 9.6 [User-facing status page — resolved](#96-user-facing-status-page--resolved)
   - 9.7 [Stakeholder email — notification during pause](#97-stakeholder-email--notification-during-pause)
   - 9.8 [Stakeholder email — post-resolution summary](#98-stakeholder-email--post-resolution-summary)
10. [Error Reference](#10-error-reference)
11. [Related Documentation](#11-related-documentation)

---

## 1. Overview

The `carbon_credit` and `carbon_marketplace` Soroban contracts expose a **pause mechanism** that allows an authorized administrator to halt all state-mutating operations without re-deploying the contract. The pause is designed for emergency incident response — not routine maintenance.

Key constraints to keep in mind before proceeding:

| Property | Value |
|---|---|
| Maximum pause window | **72 hours** — the contract auto-expires the pause after this |
| Renewal | You must re-invoke `pause` before expiry to extend (no auto-renewal) |
| Renewal safety margin | Renew at least **6 hours before expiry** to account for incident overhead |
| Admin authority | Only the keypair that matches the on-chain admin address may call `pause` / `unpause` |
| Event emitted on pause | `ContractPausedEvent` |
| Event emitted on unpause | `ContractUnpausedEvent` |
| Contracts with pause | `carbon_credit`, `carbon_marketplace` |
| Contracts without pause | `carbon_registry`, `carbon_oracle` (these do not expose `pause`) |

Pausing the credit contract halts: `mint_credits`, `retire_credits`, `transfer_credits`.  
Pausing the marketplace contract halts: `list_credits`, `delist_credits`, `purchase_credits`, `bulk_purchase`.  
Read-only operations (`get_credit_batch`, `get_retirement_certificate`, `get_active_listings`, etc.) remain available during a pause.

---

## 2. Prerequisites

### 2.1 Required access and tooling

Before you can pause either contract you must have:

- **Admin keypair** — the secret key (`ADMIN_SECRET_KEY`) whose corresponding public key is registered as the admin address in each deployed contract. This is **not** the deployer key unless they are the same.
- **Stellar CLI** — version 21.0.0 or higher, installed and on your PATH.
- **Contract IDs** — `CARBON_CREDIT_CONTRACT_ID` and `CARBON_MARKETPLACE_CONTRACT_ID` from the deployed environment.
- **Network access** — connectivity to `soroban-testnet.stellar.org` (testnet) or `soroban.stellar.org` (mainnet).
- **A second team member** — on-call or available on the incident channel. All pause decisions require two-person awareness.
- **Incident channel access** — Slack `#carbonledger-incidents`, Discord `#incident-response`, or equivalent, with your current UTC time.

### 2.2 Verification commands

Run these immediately before executing any pause — do not skip this step, especially when operating under time pressure.

```bash
# 1. Confirm the Stellar CLI version
stellar --version
# Expected: stellar 21.x.x or higher

# 2. List known keys and confirm your admin key alias is present
stellar keys ls
# Expected: the alias you use for ADMIN_SECRET_KEY should appear

# 3. Confirm the network is correctly configured
stellar network ls
# Expected: testnet or mainnet entry matching your target environment

# 4. Confirm your admin key has the correct public address
stellar keys address <your-admin-key-alias>
# Note this address — confirm it matches the on-chain admin

# 5. Confirm contract IDs are set in your shell
echo "Credit:      $CARBON_CREDIT_CONTRACT_ID"
echo "Marketplace: $CARBON_MARKETPLACE_CONTRACT_ID"
# Both must be non-empty

# 6. Query the on-chain admin for each contract and confirm your key matches
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- get_admin
# Expected: the public key matching `stellar keys address <your-admin-key-alias>`

stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- get_admin
# Expected: same admin public key

# 7. Confirm current pause state before starting
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- is_paused
# Expected: false (if you are about to pause)

stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- is_paused
# Expected: false (if you are about to pause)
```

If any of these checks fail, **stop and resolve the prerequisite** before proceeding. A failed `UnauthorizedAdmin` during a live incident will cost critical minutes.

### 2.3 Environment setup

If you are running from a fresh terminal session, load your environment first:

```bash
# Load from project .env file
set -a && source /path/to/carbonledger/.env && set +a

# Or export individually (prefer the .env approach to avoid typos)
export ADMIN_SECRET_KEY="S..."         # your admin secret key
export CARBON_CREDIT_CONTRACT_ID="C..."
export CARBON_MARKETPLACE_CONTRACT_ID="C..."
export STELLAR_NETWORK="testnet"       # or "public" for mainnet

# Shortcut alias to avoid repeating network and source flags
# (optional — add to .bashrc or .zshrc for incident readiness)
alias stellar-admin='stellar contract invoke \
  --source $ADMIN_SECRET_KEY \
  --network $STELLAR_NETWORK'
```

---

## 3. When to Pause

The pause mechanism is a **last-resort containment tool** for active security incidents with confirmed on-chain impact. It is not a maintenance mode. Every pause disrupts real users and starts the 72-hour expiry clock — use it deliberately.

### 3.1 Pause immediately — confirmed incidents

Pause both contracts without delay if any of the following conditions are confirmed:

| Trigger | Evidence | Error Code |
|---|---|---|
| Unauthorized credit minting | `mint_credits` calls from non-project addresses; credits appearing without a corresponding oracle invocation | `UnauthorizedOracle` |
| Serial number conflict attack | Abnormal spike in `SerialNumberConflict` errors in live Horizon transaction stream | `SerialNumberConflict = 6` |
| Double-counting bypass | `DoubleCountingDetected = 14` errors appearing in normal transaction flow, or confirmed duplicate serial ranges in on-chain data | `DoubleCountingDetected = 14` |
| USDC drain | USDC balance of the marketplace contract declining without corresponding purchases; USDC flowing to addresses outside known sellers | — |
| Admin key compromise | Any evidence that the admin secret key has been exfiltrated (exposed in logs, reported by team member, detected by monitoring) | — |
| Reproducible exploit reported | A researcher or community member provides a verified proof-of-concept that exploits a contract function | — |
| Unauthorized retirement | Credits being permanently retired from wallets that do not own them | `AlreadyRetired = 5` misuse |

When in doubt: **if you can see active on-chain harm occurring, pause first and investigate second.** The cost of a brief pause is far lower than the cost of additional fraudulent transactions.

### 3.2 Do not pause — non-qualifying events

The following situations do not warrant a contract pause:

- **Oracle price staleness** — the `MonitoringDataStale = 13` error and `is_monitoring_current()` returning false are expected conditions handled by the oracle circuit breaker. Use that mechanism instead.
- **Frontend bugs or API errors** — all frontend and NestJS backend failures are off-chain. Users see errors but no on-chain state is corrupted. Fix the off-chain component.
- **High transaction volume or congestion** — Soroban handles queue management at the protocol level. A pause will not help.
- **Routine planned maintenance** — Soroban contracts are immutable. There is no upgrade window requiring a pause.
- **Unconfirmed security reports** — if you received a report but cannot reproduce or observe the issue on-chain, investigate first. Use read-only queries (`is_paused`, `get_credit_batch`, `verify_serial_range`) to gather evidence before pausing.
- **Oracle services being down** — oracle downtime means new monitoring data is not submitted, but it does not corrupt existing on-chain state. Restart the oracle services; do not pause contracts.
- **Failed test transactions on testnet** — test environment anomalies do not warrant a production/mainnet pause.

### 3.3 Decision checklist

Before initiating a pause, answer every question:

- [ ] **Is there confirmed, active on-chain harm occurring right now, or in the last 30 minutes?**
- [ ] **Can I cite a specific transaction hash, error code, or event that confirms the incident?**
- [ ] **Is the harm attributable to the credit or marketplace contract (not the frontend, oracle, or backend)?**
- [ ] **Have I notified at least one other team member?**

If you cannot answer yes to the first three questions, do not pause. Document your investigation and continue with read-only monitoring.

---

## 4. Step-by-Step Pause Instructions

Work through these steps in order. Do not skip steps, even under time pressure.

### 4.1 Open the incident channel

Record the exact UTC timestamp at the moment you decide to pause:

```bash
date -u "+%Y-%m-%dT%H:%M:%SZ"
# Example output: 2026-09-26T22:03:36Z
```

Post immediately to `#carbonledger-incidents` (or equivalent):

```
[P0 INCIDENT STARTED]
Time:    2026-09-26T22:03:36Z
Admin:   <your name / key alias>
Trigger: <one-sentence description, e.g. "Spike in SerialNumberConflict errors from address GXXXXXX">
Status:  Initiating pause of carbon_credit and carbon_marketplace
Expiry:  2026-09-29T22:03:36Z (72h from now — RENEW BEFORE 2026-09-29T16:00:00Z)
```

Compute the expiry time now and write it down. Set a calendar or timer alert for **6 hours before expiry**.

### 4.2 Pause `carbon_credit`

```bash
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- pause \
  --reason "P0 incident: <one-line description>"
```

**Expected output:**

```
Transaction hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
Ledger: 54321099
Status: SUCCESS
```

**If the command fails:**

| Error | Cause | Action |
|---|---|---|
| `UnauthorizedAdmin` | Wrong keypair or env var not loaded | Run `stellar keys address <alias>` and compare to on-chain `get_admin`. Do not retry with a different key without confirmation. |
| `ContractNotFound` | Wrong contract ID | Check `$CARBON_CREDIT_CONTRACT_ID` against your `.env`. Verify with `stellar contract info --id $CARBON_CREDIT_CONTRACT_ID`. |
| `AlreadyPaused` | Contract is already paused | Proceed to step 4.3 — this contract is already protected. |
| Network timeout | RPC endpoint unreachable | Switch to the backup RPC: `--rpc-url https://soroban-testnet.stellar.org`. |

Record the transaction hash and ledger number in the incident channel.

### 4.3 Pause `carbon_marketplace`

```bash
stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- pause \
  --reason "P0 incident: marketplace paused in coordination with credit contract — <same description>"
```

**Expected output:**

```
Transaction hash: b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3
Ledger: 54321107
Status: SUCCESS
```

Record the transaction hash and ledger number. Both contracts are now paused.

> **Why pause both?** The marketplace calls `carbon_credit` for credit transfers during purchases. If only the credit contract is paused, marketplace calls will fail mid-transaction with confusing errors. Pausing both provides a clean, predictable user experience and ensures no partial state is written.

### 4.4 Verify both contracts are paused

Do not skip this step. A failed `pause` invocation that returned a network error may not have committed.

```bash
# Verify carbon_credit
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- is_paused
```

Expected: `true`

```bash
# Verify carbon_marketplace
stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- is_paused
```

Expected: `true`

If either returns `false`, repeat the `pause` command for that contract. Do not proceed to step 4.5 until both return `true`.

### 4.5 Confirm pause events on Horizon / Soroban RPC

Confirm that `ContractPausedEvent` events were emitted for both contracts. This gives you the on-chain ledger proof of the pause.

```bash
# Replace <PAUSE_LEDGER> with the ledger number returned in step 4.2
# Query ContractPausedEvent for carbon_credit
curl -s "https://soroban-testnet.stellar.org" \
  -X POST \
  -H 'Content-Type: application/json' \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"getEvents\",
    \"params\": {
      \"startLedger\": $((PAUSE_LEDGER - 5)),
      \"filters\": [{
        \"type\": \"contract\",
        \"contractIds\": [\"$CARBON_CREDIT_CONTRACT_ID\"]
      }]
    }
  }" | jq '.result.events[] | select(.topic[0] | contains("paused"))'
```

```bash
# Query ContractPausedEvent for carbon_marketplace
curl -s "https://soroban-testnet.stellar.org" \
  -X POST \
  -H 'Content-Type: application/json' \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"getEvents\",
    \"params\": {
      \"startLedger\": $((PAUSE_LEDGER - 5)),
      \"filters\": [{
        \"type\": \"contract\",
        \"contractIds\": [\"$CARBON_MARKETPLACE_CONTRACT_ID\"]
      }]
    }
  }" | jq '.result.events[] | select(.topic[0] | contains("paused"))'
```

You can also use the Stellar Expert block explorer to verify:
- Testnet: `https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>`
- Mainnet: `https://stellar.expert/explorer/public/contract/<CONTRACT_ID>`

### 4.6 Stop oracle services

With both contracts paused, oracle submissions (which call `submit_monitoring_data` and `update_credit_price`) will succeed at the oracle layer but the underlying credit operations will be blocked. Stop oracle services to avoid confusing error logs and unnecessary XLM spend on failed transactions.

```bash
# If running as systemd services
sudo systemctl stop carbonledger-oracle-verification
sudo systemctl stop carbonledger-oracle-price
sudo systemctl stop carbonledger-oracle-satellite

# Confirm they have stopped
sudo systemctl status carbonledger-oracle-verification --no-pager
sudo systemctl status carbonledger-oracle-price --no-pager
sudo systemctl status carbonledger-oracle-satellite --no-pager
```

```bash
# If running as Docker Compose services
docker-compose stop oracle_verification oracle_price oracle_satellite

# Confirm
docker-compose ps oracle_verification oracle_price oracle_satellite
```

```bash
# If running as background processes
pkill -f "verification_listener.py" && echo "verification_listener stopped"
pkill -f "price_oracle.py"          && echo "price_oracle stopped"
pkill -f "satellite_monitor.py"     && echo "satellite_monitor stopped"

# Confirm no processes remain
pgrep -fa "verification_listener.py\|price_oracle.py\|satellite_monitor.py" \
  && echo "WARNING: some oracle processes still running" \
  || echo "All oracle processes stopped"
```

> **Note:** `carbon_oracle` does not have a pause function. Oracle contract state remains readable. Only the off-chain oracle services need to be stopped.

### 4.7 Log the pause details

Post a structured log entry to the incident channel:

```
[PAUSED — CONFIRMED]
carbon_credit tx:      <tx hash from step 4.2>  ledger: <number>
carbon_marketplace tx: <tx hash from step 4.3>  ledger: <number>
Events confirmed:      YES (ContractPausedEvent on Horizon)
Oracle services:       STOPPED
Pause expires at:      <start UTC + 72h>
Renewal deadline:      <start UTC + 66h>  ← SET TIMER NOW
Next update:           30 minutes from now (<UTC timestamp>)
```

---

## 5. Step-by-Step Unpause Instructions

Only begin this section after the security team has completed an investigation and formally approved resuming operations. The decision to unpause must never be made by a single person.

### 5.1 Resolution criteria — all must be met

All of the following must be confirmed true and documented in the incident channel before unpausing:

- [ ] **Root cause identified** — the exact mechanism of the incident has been determined and documented.
- [ ] **Attack vector closed** — either the issue was a false positive, or a remediation has been applied (see [Section 8 — Rollback Procedures](#8-rollback-procedures) for the available recovery paths).
- [ ] **Affected serial ranges audited** — if any credits were minted during or related to the incident, their serial ranges have been reviewed and the legitimacy confirmed or the fraudulent batches identified.
- [ ] **No anomalous activity in last 30 minutes** — the Horizon event stream has been monitored for 30 minutes with no further suspect transactions.
- [ ] **Two-person approval** — at least two named team members have reviewed the above and agreed in writing (incident channel message) that it is safe to unpause.
- [ ] **Post-incident review scheduled** — a meeting has been put on the calendar (can be after unpausing).

### 5.2 Unpause `carbon_marketplace` first

Unpause the marketplace before the credit contract so that users can see their credit balances and listing states before any new trading activity can be initiated.

```bash
stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- unpause \
  --note "Incident resolved: <one-sentence resolution summary>"
```

**Expected output:**

```
Transaction hash: c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
Ledger: 54329001
Status: SUCCESS
```

### 5.3 Unpause `carbon_credit`

```bash
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- unpause \
  --note "Incident resolved: safe to resume minting, transfers, and retirements"
```

**Expected output:**

```
Transaction hash: d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5
Ledger: 54329008
Status: SUCCESS
```

### 5.4 Verify both contracts are unpaused

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

If either returns `true`, do not restart oracle services. Re-attempt the `unpause` command for that contract.

Confirm `ContractUnpausedEvent` events on Horizon using the same query pattern from [step 4.5](#45-confirm-pause-events-on-horizon--soroban-rpc), substituting "unpaused" for the topic filter.

### 5.5 Restart oracle services

```bash
# systemd
sudo systemctl start carbonledger-oracle-verification
sudo systemctl start carbonledger-oracle-price
sudo systemctl start carbonledger-oracle-satellite

# Confirm healthy start
sudo systemctl status carbonledger-oracle-verification --no-pager | grep -E "Active|Main PID"
sudo systemctl status carbonledger-oracle-price --no-pager        | grep -E "Active|Main PID"
sudo systemctl status carbonledger-oracle-satellite --no-pager    | grep -E "Active|Main PID"
```

```bash
# Docker Compose
docker-compose start oracle_verification oracle_price oracle_satellite
docker-compose ps oracle_verification oracle_price oracle_satellite
```

```bash
# Background processes
cd /path/to/carbonledger/oracle
nohup python3 verification_listener.py > logs/verification.log 2>&1 &
nohup python3 price_oracle.py          > logs/price.log 2>&1 &
nohup python3 satellite_monitor.py     > logs/satellite.log 2>&1 &
echo "Oracle PIDs: $(pgrep -f 'verification_listener\|price_oracle\|satellite_monitor' | tr '\n' ' ')"
```

Allow 5 minutes for the oracle services to complete their first poll cycle and confirm they are emitting valid data to the contract.

### 5.6 Post-unpause monitoring

Monitor the Horizon event stream and application logs for **at least 30 minutes** after resuming to confirm no anomalous activity recurs.

```bash
# Stream live contract events (Soroban RPC — long-poll approach)
# Get the current ledger number first
CURRENT_LEDGER=$(curl -s "https://soroban-testnet.stellar.org" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger","params":{}}' \
  | jq '.result.sequence')
echo "Monitoring from ledger: $CURRENT_LEDGER"

# Poll for events every 30 seconds
while true; do
  curl -s "https://soroban-testnet.stellar.org" \
    -X POST -H 'Content-Type: application/json' \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": 1,
      \"method\": \"getEvents\",
      \"params\": {
        \"startLedger\": $CURRENT_LEDGER,
        \"filters\": [{
          \"type\": \"contract\",
          \"contractIds\": [
            \"$CARBON_CREDIT_CONTRACT_ID\",
            \"$CARBON_MARKETPLACE_CONTRACT_ID\"
          ]
        }]
      }
    }" | jq '.result.events[] | {ledger: .ledger, topic: .topic[0], data: .value}'
  sleep 30
done
```

Watch specifically for recurrence of the triggering error pattern. If you see it again, pause immediately (return to [Section 4](#4-step-by-step-pause-instructions)) and escalate.

---

## 6. Pause Renewal Procedure

### 6.1 When to renew

The pause auto-expires after **72 hours**. If the incident has not been fully resolved, you must renew the pause before it expires. Renew with a minimum **6-hour safety margin** — if you wait until the last minute and a team member is unavailable, the contracts will auto-unpause.

Recommended renewal schedule:

| Elapsed time | Action |
|---|---|
| T+0 | Pause initiated (step 4.2–4.3) |
| T+6h | First renewal check-in — is the incident likely to resolve within 66h? |
| T+24h | Document status update in incident channel |
| T+48h | Assess if the incident can be resolved before expiry; escalate if not |
| T+66h | **Mandatory renewal if still paused** — do not wait past this point |

### 6.2 Renewal commands

```bash
# Record the renewal timestamp
date -u "+Renewal at: %Y-%m-%dT%H:%M:%SZ"

# Renew carbon_credit pause
stellar contract invoke \
  --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- pause \
  --reason "Renewal #<N>: incident still under investigation — <brief status>"

# Renew carbon_marketplace pause
stellar contract invoke \
  --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- pause \
  --reason "Renewal #<N>: marketplace pause renewed — <brief status>"
```

Verify after renewal:

```bash
stellar contract invoke --id $CARBON_CREDIT_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY --network testnet -- is_paused
# Expected: true

stellar contract invoke --id $CARBON_MARKETPLACE_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY --network testnet -- is_paused
# Expected: true
```

### 6.3 Renewal logging

Post in the incident channel after each renewal:

```
[PAUSE RENEWED — Renewal #<N>]
Time:           <UTC timestamp>
New expiry:     <UTC timestamp + 72h>
New renewal by: <UTC timestamp + 66h>  ← RESET YOUR TIMER
Status:         <one-sentence investigation status>
ETA to resolve: <estimate or "unknown">
```

If you are on renewal #3 or beyond, trigger the escalation path defined in [docs/runbooks/escalation.md](runbooks/escalation.md). Extended pauses require CTO or equivalent sign-off.

---

## 7. Post-Pause Checklist

Complete every checkbox in every applicable section. Use this checklist as a running log in the incident channel.

### 7.1 Immediate — within 15 minutes

- [ ] Incident channel opened with UTC timestamp.
- [ ] Both contracts confirmed paused (`is_paused() == true` — verified with CLI).
- [ ] `ContractPausedEvent` confirmed on Horizon for both contracts.
- [ ] Oracle services stopped (systemd / Docker / process).
- [ ] At least one other team member notified and responding.
- [ ] Pause expiry time calculated and written down.
- [ ] Renewal deadline timer set (expiry minus 6 hours).
- [ ] User-facing status page updated (see [Section 9.4](#94-user-facing-status-page--incident-open)).
- [ ] Initial internal notification posted (see [Section 9.1](#91-internal-incident-channel--initial-notification)).

### 7.2 Within 1 hour

- [ ] Triggering transaction(s) identified and hash(es) recorded.
- [ ] Affected contract(s) and function(s) scoped.
- [ ] Affected serial number ranges identified (run `verify_serial_range` for suspect batches).
- [ ] Attack vector hypothesis written up in the incident channel (even if unconfirmed).
- [ ] Assessment made: is this a false positive, limited damage, or catastrophic? (See [Section 8](#8-rollback-procedures) for recovery paths.)
- [ ] Stellar Development Foundation notified if the exploit may be a Soroban runtime issue (contact via [SDF Discord](https://discord.gg/stellardev) or security@stellar.org).
- [ ] Legal / compliance team notified if user funds (USDC) may have been affected.
- [ ] 30-minute status update posted to the incident channel (see [Section 9.2](#92-internal-incident-channel--30-minute-update)).

### 7.3 Before pause expiry — at least 6 hours before 72-hour mark

- [ ] Incident status reviewed: resolved, active, or uncertain?
- [ ] If resolved: proceed to unpause ([Section 5](#5-step-by-step-unpause-instructions)).
- [ ] If still active: renew the pause ([Section 6](#6-pause-renewal-procedure)).
- [ ] Renewal logged with updated expiry time.
- [ ] All team members with renewal authority reminded of the new expiry.

### 7.4 After unpausing

- [ ] `is_paused()` returns `false` for both contracts — confirmed with CLI.
- [ ] `ContractUnpausedEvent` confirmed on Horizon for both contracts.
- [ ] Oracle services restarted and producing data (check logs after 5 minutes).
- [ ] 30-minute post-unpause monitoring completed with no anomalies.
- [ ] User-facing status page updated to "Operational" (see [Section 9.6](#96-user-facing-status-page--resolved)).
- [ ] Stakeholder email sent (see [Section 9.8](#98-stakeholder-email--post-resolution-summary)).
- [ ] Post-incident review meeting scheduled (within 48 hours of resolution).
- [ ] Incident channel archived with full timeline, all tx hashes, and decision log.
- [ ] Incident report drafted — template in [docs/INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
- [ ] Any identified improvements to monitoring, alerting, or contract behavior filed as GitHub issues.

---

## 8. Rollback Procedures

### 8.1 What "rollback" means on Soroban

Soroban smart contracts are **immutable and append-only**. There is no mechanism to:

- Reverse a committed transaction.
- Rewind contract storage to a prior ledger.
- Modify on-chain retirement records or serial number assignments.

"Rollback" in a CarbonLedger incident context means one of three things, chosen based on the severity of the damage:

- **Path A** — No on-chain damage; contracts can simply be unpaused.
- **Path B** — Limited on-chain damage; off-chain records are corrected and users are compensated, but contracts continue operating.
- **Path C** — Catastrophic damage to on-chain state; patched contracts must be deployed to new addresses.

Determine which path applies before unpausing.

---

### 8.2 Path A — Confirmed false positive, no state damage

Use this path when the investigation confirms the triggering event was benign (e.g., a monitoring alert threshold was set too low, or a legitimate batch operation generated a burst of `SerialNumberConflict` queries that were not exploits).

1. Document the false positive determination in the incident channel with supporting evidence (transaction hashes, on-chain data, team sign-off).
2. Verify that no illegitimate credits were minted or transferred during the pause window.
3. Unpause both contracts following [Section 5](#5-step-by-step-unpause-instructions).
4. Restart oracle services following [Section 5.5](#55-restart-oracle-services).
5. File a GitHub issue to improve the monitoring rule that triggered the false positive.

**Time to recovery:** 30 minutes to 2 hours after investigation completion.

---

### 8.3 Path B — Real incident, limited state damage

Use this path when the investigation confirms an exploit occurred but the on-chain damage is limited and contained (e.g., a small number of fraudulent credits were minted, but the attack vector has been confirmed closed by a contract-level guard already in place, or the attacker's wallet is known and the credits have not been sold).

1. **Identify the exact set of affected batches** using `get_credit_batch` for each batch minted after the last known-good ledger:

   ```bash
   stellar contract invoke \
     --id $CARBON_CREDIT_CONTRACT_ID \
     --source $ADMIN_SECRET_KEY \
     --network testnet \
     -- get_credit_batch \
     --batch_id <BATCH_ID>
   ```

2. **Do not attempt to burn or transfer credits by force.** Soroban has no admin override for credit ownership. Document the fraudulent batch IDs.

3. **Mark the affected batches as invalid in the off-chain database.** Use the NestJS admin API or direct Prisma update to flag the batch records and prevent them from appearing in the marketplace. This is an off-chain guardrail only — it does not change on-chain state.

   ```bash
   # Example: flag a fraudulent batch in the backend DB
   cd backend
   npx prisma studio  # Use the GUI to update batch status
   # Or via API:
   curl -X PATCH http://localhost:3001/admin/batches/<BATCH_ID>/status \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"status": "FRAUDULENT", "reason": "P0 incident <date> — illegitimate mint"}'
   ```

4. **File a criminal or registry report** if user USDC was stolen. Contact legal.

5. **Unpause** following [Section 5](#5-step-by-step-unpause-instructions).

6. **Notify affected users** individually with the stakeholder email template ([Section 9.8](#98-stakeholder-email--post-resolution-summary)).

7. **Engage a smart contract auditor** to review whether the exploit can recur. Even if the immediate vector is closed, an independent audit validates the assessment.

8. **If the attack vector relies on a contract bug:** plan a contract replacement (Path C) even if immediate damage is limited, because the vulnerability persists in the immutable on-chain bytecode.

**Time to recovery:** Hours to days depending on audit requirements.

---

### 8.4 Path C — Catastrophic state compromise, redeploy required

Use this path when the on-chain state of `carbon_credit` or `carbon_marketplace` is fundamentally compromised and cannot be trusted — for example, serial number assignment tables are corrupted, or large-scale fraudulent minting has occurred.

> **Warning:** Path C is irreversible and disruptive. It creates new contract addresses, invalidates existing bookmarked contract IDs, and requires coordinated migration of all integrations. Only proceed with CTO-level approval.

**Step C1 — Engage auditors before deploying anything.**

Do not deploy new contracts until an independent auditor has reviewed the patch. Deploying a second vulnerable contract is worse than leaving the system paused.

**Step C2 — Identify the last known-good ledger.**

Find the last ledger before the first fraudulent transaction. All credit batches minted after this ledger must be treated as suspect until individually verified.

```bash
# Query Horizon for the first anomalous transaction
curl "https://horizon-testnet.stellar.org/accounts/$ATTACKER_ADDRESS/operations?order=asc&cursor=0&limit=200" \
  | jq '.._embedded.records[] | {id: .id, type: .type, created_at: .created_at}'
```

**Step C3 — Deploy patched contracts to new addresses.**

```bash
cd contracts
# Apply and peer-review the patch to the affected contract
# Then rebuild:
cargo build --target wasm32-unknown-unknown --release

# Deploy to new addresses — DO NOT reuse old contract IDs
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_credit.wasm \
  --source $ADMIN_SECRET_KEY \
  --network testnet
# Save the new contract ID: CARBON_CREDIT_CONTRACT_ID_V2=...

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_marketplace.wasm \
  --source $ADMIN_SECRET_KEY \
  --network testnet
# Save the new contract ID: CARBON_MARKETPLACE_CONTRACT_ID_V2=...
```

**Step C4 — Initialize the new contracts.**

The new contracts start with empty state. Re-initialize with the admin address and any required configuration before migrating data.

**Step C5 — Re-mint legitimate credits from audited batches.**

Using the last known-good ledger as a cutoff:

- Re-mint all legitimate credit batches from the last known-good ledger and earlier, with their original serial numbers.
- Do not re-mint any batches created after the last known-good ledger without individual verification.

**Step C6 — Update all configuration to the new contract IDs.**

```bash
# Update .env
sed -i "s|CARBON_CREDIT_CONTRACT_ID=.*|CARBON_CREDIT_CONTRACT_ID=$CARBON_CREDIT_CONTRACT_ID_V2|" .env
sed -i "s|CARBON_MARKETPLACE_CONTRACT_ID=.*|CARBON_MARKETPLACE_CONTRACT_ID=$CARBON_MARKETPLACE_CONTRACT_ID_V2|" .env

# Redeploy backend with updated env
cd backend && npm run build && pm2 restart carbonledger-backend

# Redeploy frontend with updated env
cd frontend && npm run build && pm2 restart carbonledger-frontend

# Update oracle config
sed -i "s|CARBON_CREDIT_CONTRACT_ID=.*|CARBON_CREDIT_CONTRACT_ID=$CARBON_CREDIT_CONTRACT_ID_V2|" oracle/.env
```

**Step C7 — Announce the migration.**

Publish a post-incident report explaining the new contract addresses, why the migration was necessary, and the steps taken to restore data integrity. Users with bookmarked contract IDs or direct integrations will need to update.

See [docs/runbooks/contract-upgrade.md](runbooks/contract-upgrade.md) for the full contract upgrade runbook.

**Time to recovery:** Days to weeks. This path should be avoided by catching incidents early.

---

## 9. Communication Templates

Copy and adapt these templates. Replace all `<angle bracket>` placeholders before sending. Do not send templates with placeholders visible to external audiences.

---

### 9.1 Internal incident channel — initial notification

Send within 15 minutes of initiating the pause.

```
[P0 INCIDENT — CONTRACTS PAUSED]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Time:          <UTC timestamp>
Admin:         <your name>
Affected:      carbon_credit ✓ paused | carbon_marketplace ✓ paused
Pause expiry:  <UTC timestamp + 72h>
Renewal by:    <UTC timestamp + 66h>

WHAT WE KNOW:
<Two to four sentences describing the triggering event, the specific error
code or transaction, and what function or contract is involved.>

WHAT WE DON'T KNOW YET:
- Whether any credits were illegitimately minted, transferred, or retired
- The full attack vector
- Whether any USDC was misrouted

IMMEDIATE ACTIONS UNDERWAY:
- Reviewing transactions from ledger <N> onward
- <Name> is querying serial number ranges
- Oracle services stopped
- Status page updated

NEXT UPDATE: <UTC timestamp + 30 minutes>

Incident thread starts here. All updates in this thread only. ⬇
```

---

### 9.2 Internal incident channel — 30-minute update

Post at T+30 minutes.

```
[UPDATE — T+30min]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Time: <UTC timestamp>

FINDINGS SO FAR:
<Summary of investigation to date. What transactions were reviewed?
What serial ranges checked? What was found / not found?>

CURRENT ASSESSMENT: <false positive | limited damage | catastrophic>

RECOVERY PATH: <Path A | B | C — see ADMIN_PAUSE_OPERATIONS_GUIDE.md>

ACTIONS IN PROGRESS:
- <Who> is doing <what>
- <Who> is doing <what>

BLOCKERS:
- <Anything slowing investigation? Missing access? Unclear contract state?>

ETA TO RESOLVE: <estimate or "unknown">

NEXT UPDATE: <UTC timestamp + 60 minutes or earlier if resolved>
```

---

### 9.3 Internal incident channel — resolution

Post when unpausing is approved and complete.

```
[RESOLVED — CONTRACTS UNPAUSED]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Time resolved: <UTC timestamp>
Duration:      <elapsed time from pause to unpause>

ROOT CAUSE: <Concise technical description>

IMPACT:
- Credits minted illegitimately: <number or "none">
- USDC misrouted: <amount or "none">
- Users affected: <number or "none">

RECOVERY PATH TAKEN: <A | B | C>

ACTIONS TAKEN:
1. <Action taken>
2. <Action taken>
3. <Action taken>

MONITORING: 30-minute post-unpause watch started at <timestamp>

POST-INCIDENT REVIEW: <meeting link> at <UTC timestamp>

Approved by: <name 1>, <name 2>

This incident is closed. Archive this thread after the review.
```

---

### 9.4 User-facing status page — incident open

Post within 30 minutes of pausing.

```
Investigating — Contract Operations Temporarily Suspended

We are currently investigating a reported issue affecting the
CarbonLedger credit and marketplace contracts. As a precautionary
measure, the following operations are temporarily suspended:

  • Credit purchases
  • Credit retirements
  • Credit minting (project developers)
  • Marketplace listings and delistings

The following remain fully operational:

  • Viewing your existing credits and retirement certificates
  • Browsing marketplace listings (read-only)
  • Verifying retirement certificates via permanent public URLs
  • The public audit explorer

Your existing credits and retirement certificates are safe,
valid, and unaffected.

We are actively investigating and will provide an update by
<UTC timestamp + 60 minutes>.

Incident started: <UTC timestamp>
```

---

### 9.5 User-facing status page — update while paused

Post every 60 minutes if the pause extends beyond 1 hour.

```
Update — Contract Operations Remain Suspended

We continue to investigate the issue affecting CarbonLedger
contract operations. Our team is working toward resolution.

What we know: <brief non-technical description of the issue>
What we are doing: <brief non-technical description of the response>

We expect to provide our next update by <UTC timestamp + 60 minutes>,
or sooner if the situation changes.

Incident started: <UTC start timestamp>
Last updated:     <UTC current timestamp>
```

---

### 9.6 User-facing status page — resolved

Post immediately after unpausing and confirming both contracts are operational.

```
Resolved — Contract Operations Fully Restored

The issue affecting CarbonLedger contract operations has been
resolved. All marketplace and credit contract functions are now
fully operational.

What happened: <One to two sentences, non-technical, describing
what occurred and confirming it is resolved.>

What was affected:
  • Credit purchases, retirements, and listings were temporarily
    blocked during our investigation.
  • Existing credits and retirement certificates were not affected.
  • All audit trail data is intact and publicly verifiable.

Any operations that failed during the suspension can be
resubmitted — they were not charged or partially applied.

We will publish a full post-incident report within 48 hours.

Duration: <pause duration>
Resolved: <UTC timestamp>
```

---

### 9.7 Stakeholder email — notification during pause

Send to project developers and corporate buyers affected by the pause within 1 hour of initiating it.

```
Subject: [CarbonLedger] Temporary Service Interruption — Action May Be Required

Dear <name / "CarbonLedger User">,

We are writing to inform you that CarbonLedger's marketplace and credit
contract operations are temporarily suspended as of <UTC start timestamp>
while we investigate a security concern.

What is affected:
  • New credit purchases and bulk orders
  • Credit retirements and certificate generation
  • Credit minting (project developers)
  • New marketplace listings

What is NOT affected:
  • Your existing credits — they remain valid and in your wallet
  • Your existing retirement certificates — they are permanent and
    publicly verifiable at their certificate URLs
  • Read access to listings, credit details, and the audit explorer

What you should do now:
  • If you have a time-sensitive operation, please hold it until we
    confirm operations have resumed. We will notify you when they do.
  • If any of your transactions failed with an error during this
    period, do not retry. We will confirm when it is safe to resubmit.

We expect to provide an update by <UTC timestamp>.

If you have any questions, please reply to this email or contact us at
support@carbonledger.io.

We apologize for the inconvenience and appreciate your patience.

The CarbonLedger Team
```

---

### 9.8 Stakeholder email — post-resolution summary

Send within 24 hours of resolution to all stakeholders who received the initial notification.

```
Subject: [CarbonLedger] Service Restored — Post-Incident Summary

Dear <name / "CarbonLedger User">,

We are writing to follow up on our earlier notification regarding
the temporary suspension of CarbonLedger contract operations.

Service has been fully restored as of <UTC resolution timestamp>.

Summary of events:
  Started:   <UTC start timestamp>
  Resolved:  <UTC resolution timestamp>
  Duration:  <elapsed time>

What happened:
<Two to three sentences, non-technical, describing the root cause
and resolution. Focus on what the user experienced and that it is
now fully resolved. Avoid technical jargon.>

Impact on your account:
<If no impact:>
  No credits, retirement certificates, or USDC in your account were
  affected. Your account is in its normal state.

<If credits were affected (Path B or C):>
  We identified that <N> credits from batch <ID> were affected.
  <Describe remediation — e.g., off-chain correction, credit replacement,
  or refund issued.> No action is required from you unless we have
  contacted you individually with specific instructions.

What you should do:
  • Operations that failed during the suspension may now be resubmitted.
  • If you experience any unexpected issues with your account, please
    contact us at support@carbonledger.io with your wallet address.

We are conducting a thorough post-incident review and will publish a
public incident report within 48 hours at <link to status page / blog>.

We appreciate your patience and trust.

The CarbonLedger Team
```

---

## 10. Error Reference

Quick reference for error codes you may encounter during a pause incident.

| Code | Name | Description | Action |
|---|---|---|---|
| — | `UnauthorizedAdmin` | The invoking keypair is not the registered contract admin | Verify your key with `get_admin`; do not retry with a different key without confirming |
| 4 | `InsufficientCredits` | Transfer or retirement attempted on insufficient balance | Not a security issue on its own; investigate if occurring from unexpected addresses |
| 5 | `AlreadyRetired` | Retirement attempted on a credit that is already retired | Investigate if fired repeatedly from the same address — may indicate a replay attempt |
| 6 | `SerialNumberConflict` | A batch was submitted with a serial range already in use | **Pause trigger** if appearing abnormally; indicates a double-minting attempt |
| 7 | `UnauthorizedVerifier` | A verifier function was called by a non-authorized address | Investigate promptly; verifier privilege escalation |
| 8 | `UnauthorizedOracle` | An oracle function was called by a non-oracle address | Investigate; could indicate oracle key compromise |
| 13 | `MonitoringDataStale` | Oracle data is older than 365 days | Not a pause trigger; use oracle circuit breaker |
| 14 | `DoubleCountingDetected` | A serial number was detected in more than one batch | **Pause trigger**; indicates active double-counting bypass attempt |
| 15 | `RetirementIrreversible` | Attempt to reverse a retirement | Expected; retirements are by design permanent |
| 17 | `ProjectAlreadyExists` | Duplicate project registration attempted | Low severity; investigate if systematic |
| 18 | `InvalidSerialRange` | Serial range is malformed (start > end, or zero-length) | Investigate if from unexpected addresses |

For the full error code reference, see [docs/error-codes.md](error-codes.md).

---

## 11. Related Documentation

| Document | Purpose |
|---|---|
| [PAUSE_OPERATIONS_GUIDE.md](PAUSE_OPERATIONS_GUIDE.md) | Overview reference for the pause mechanism — start here for background |
| [docs/pause-specification.md](pause-specification.md) | Technical specification of the pause feature design |
| [docs/pause-architecture.md](pause-architecture.md) | Architectural context and design decisions for the pause mechanism |
| [docs/PAUSE_EVENTS.md](PAUSE_EVENTS.md) | Full reference for `ContractPausedEvent` and `ContractUnpausedEvent` structures |
| [docs/PAUSE_TESTING_GUIDE.md](PAUSE_TESTING_GUIDE.md) | Test suite for the pause mechanism — run before any production pause |
| [docs/pause-api-reference.md](pause-api-reference.md) | API reference for `pause()`, `unpause()`, `is_paused()` |
| [docs/pause-monitoring-guide.md](pause-monitoring-guide.md) | Grafana dashboards and alert rules for pause-related metrics |
| [docs/pause-security-analysis.md](pause-security-analysis.md) | Security analysis of the pause mechanism itself |
| [docs/error-codes.md](error-codes.md) | Complete error code reference for all contracts |
| [docs/INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | Broader incident response procedures including non-pause scenarios |
| [docs/runbooks/emergency-pause.md](runbooks/emergency-pause.md) | Emergency pause decision tree and rapid-response steps |
| [docs/runbooks/contract-exploit.md](runbooks/contract-exploit.md) | Full incident response runbook for contract exploits |
| [docs/runbooks/contract-upgrade.md](runbooks/contract-upgrade.md) | Deploying patched contracts (Path C recovery) |
| [docs/runbooks/key-compromise.md](runbooks/key-compromise.md) | Admin key compromise response |
| [docs/runbooks/escalation.md](runbooks/escalation.md) | Escalation contacts and thresholds |
| [docs/runbooks/contacts.md](runbooks/contacts.md) | On-call contacts for security incidents |
| [docs/KEY_ROTATION_PROCEDURES.md](KEY_ROTATION_PROCEDURES.md) | Admin key rotation after a potential key compromise |
| [docs/adr/ADR-013-emergency-pause.md](adr/ADR-013-emergency-pause.md) | Architecture Decision Record for the emergency pause feature |
| [docs/pause-feature/SPECIFICATION.md](pause-feature/SPECIFICATION.md) | Complete feature specification |
| [docs/pause-disaster-recovery-guide.md](pause-disaster-recovery-guide.md) | Disaster recovery scenarios involving the pause mechanism |

---

*This guide closes issue #1204. Last updated: 2026-09-26. Maintained by the CarbonLedger security team — open a PR against this file to propose improvements.*
