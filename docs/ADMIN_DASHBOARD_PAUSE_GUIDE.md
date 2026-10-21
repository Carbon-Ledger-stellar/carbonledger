# Admin Dashboard — Contract Pause & Resume Guide

> **Closes issue #1206**  
> Audience: CarbonLedger platform administrators  
> Last updated: 2026-09-26

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Navigating to the Admin Dashboard](#3-navigating-to-the-admin-dashboard)
4. [Dashboard UI Reference](#4-dashboard-ui-reference)
   - 4.1 [Pause Controls Panel](#41-pause-controls-panel)
   - 4.2 [Status Indicator](#42-status-indicator)
   - 4.3 [Emergency Pause Button](#43-emergency-pause-button)
   - 4.4 [Resume Operations Button](#44-resume-operations-button)
   - 4.5 [Confirmation Modal — Field-by-Field Reference](#45-confirmation-modal--field-by-field-reference)
5. [Step-by-Step: Initiating an Emergency Pause](#5-step-by-step-initiating-an-emergency-pause)
6. [Step-by-Step: Resuming Operations (Unpause)](#6-step-by-step-resuming-operations-unpause)
7. [Step-by-Step: Monitoring an Active Pause](#7-step-by-step-monitoring-an-active-pause)
8. [Step-by-Step: Viewing the Pause History / Audit Log](#8-step-by-step-viewing-the-pause-history--audit-log)
9. [Common Tasks](#9-common-tasks)
   - 9.1 [Routine Pause Drill](#91-routine-pause-drill)
   - 9.2 [Bulk Pause (Both Contracts Simultaneously)](#92-bulk-pause-both-contracts-simultaneously)
   - 9.3 [Checking Current Pause State via API](#93-checking-current-pause-state-via-api)
10. [Pause Behaviour Reference](#10-pause-behaviour-reference)
11. [Troubleshooting](#11-troubleshooting)
12. [Keyboard Shortcuts](#12-keyboard-shortcuts)
13. [Accessibility Notes](#13-accessibility-notes)
14. [Related Documentation](#14-related-documentation)

---

## 1. Overview

CarbonLedger exposes an **Emergency Pause** mechanism on two Soroban smart contracts:

| Contract | Purpose | What Pausing Prevents |
|---|---|---|
| `carbon_credit` | Minting, retiring, and transferring tokenized carbon credits | New mints, retirements, and transfers |
| `carbon_marketplace` | Credit listings, purchases, and bulk corporate buying | New listings, purchases, and bulk buys |

The pause mechanism is a circuit breaker designed for use during:

- Active security incidents or suspected exploits
- Critical bug discoveries before a patch is deployed
- Regulatory holds or legal freeze orders
- Scheduled maintenance that must block on-chain state changes
- Routine incident-response drills

A pause is **time-bounded** — the maximum window is **72 hours**. If the admin has not explicitly resumed operations by the end of the selected duration, the contracts automatically re-enable themselves. This prevents an accidental permanent freeze of the protocol.

Both contracts can be paused independently or simultaneously. Pausing `carbon_credit` does not automatically pause `carbon_marketplace`, and vice versa. During an incident, it is usually correct to pause both.

> **Important:** Pause and resume actions are on-chain transactions signed by an admin keypair. Every action is permanently recorded on the Stellar ledger and in the CarbonLedger audit log. There is no "undo" — a pause event, once submitted, cannot be removed from history.

---

## 2. Prerequisites

Before you can use the pause controls, verify that all of the following are true.

### 2.1 Admin Role

Your Stellar keypair must be registered as an admin in both contracts. Admin addresses are set at contract initialization and can only be changed by an existing admin. Contact the deployment team if you need your address added.

To verify your admin status, run:

```bash
stellar contract invoke \
  --id <CARBON_CREDIT_CONTRACT_ID> \
  --source YOUR_SECRET_KEY \
  --network testnet \
  -- is_admin \
  --address YOUR_PUBLIC_KEY
```

Expected response: `true`

### 2.2 Freighter Wallet Browser Extension

All admin operations require the [Freighter wallet](https://freighter.app) browser extension to sign Soroban transactions. Freighter is available for:

| Browser | Minimum Version | Download |
|---|---|---|
| Google Chrome | 90+ | Chrome Web Store |
| Mozilla Firefox | 90+ | Firefox Add-ons |
| Brave | Any current | Chrome Web Store |
| Microsoft Edge | 90+ | Chrome Web Store |

Safari is **not supported**. Mobile browsers are **not supported** for admin operations.

After installing Freighter:
1. Open the extension and create or import your admin wallet.
2. Go to **Settings → Network** and select **Testnet** (for development) or **Mainnet** (for production).
3. Ensure the account loaded in Freighter is your admin keypair.

### 2.3 XLM for Transaction Fees

Each pause or resume action submits one Soroban transaction per contract. Each transaction costs a small amount of XLM in network fees (typically < 0.01 XLM). Ensure your admin account holds at least **1 XLM** as a comfortable buffer.

### 2.4 Network Access

- The admin dashboard is served from the Next.js frontend (`localhost:3000` in development, or your production URL).
- The dashboard connects to Stellar's Soroban RPC via WebSocket for real-time status updates. Firewall rules must allow outbound WebSocket connections on port 443 to `soroban-testnet.stellar.org` or `soroban.stellar.org`.

---

## 3. Navigating to the Admin Dashboard

### Development

1. Start the frontend server:
   ```bash
   cd frontend
   npm run dev
   ```
2. Open your browser and navigate to:
   ```
   http://localhost:3000/admin/contracts
   ```
3. If you are not already authenticated, you will be redirected to the login page. Sign in with your admin credentials.
4. Connect Freighter when prompted by clicking **Connect Wallet** in the top-right corner of the navigation bar.

### Production

Navigate to your production domain:
```
https://your-domain.com/admin/contracts
```

The `/admin` path is protected by middleware that checks for a valid JWT session with `role: admin`. If you see a **403 Forbidden** page, your account does not have the admin role — contact your platform owner.

### What You Should See

After successful navigation and wallet connection, the page displays:

```
┌─────────────────────────────────────────────────────────────────┐
│  CarbonLedger Admin                          [wallet: GA...XYZ] │
├─────────────────────────────────────────────────────────────────┤
│  Contract Management                                            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  PAUSE CONTROLS                                [● LIVE] │    │
│  │                                                         │    │
│  │  ● carbon_credit       [OPERATIONAL]  [⏸ PAUSE]        │    │
│  │  ● carbon_marketplace  [OPERATIONAL]  [⏸ PAUSE]        │    │
│  │                                                         │    │
│  │  [⏸ PAUSE ALL CONTRACTS]                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Contract Details ▼                                             │
│  Audit Log ▼                                                    │
└─────────────────────────────────────────────────────────────────┘
```

If the Pause Controls panel is not visible, scroll to the top of the page. It is always rendered as the first section.

---

## 4. Dashboard UI Reference

### 4.1 Pause Controls Panel

The **Pause Controls** panel is a card at the top of the `/admin/contracts` page. It shows:

- The real-time operational status of each contract (updated via WebSocket).
- Pause and resume action buttons for each individual contract.
- A **Pause All Contracts** button for bulk operations.
- A live connection indicator in the top-right corner of the panel.

```
┌──────────────────────────────────────────────────────────────────────┐
│  PAUSE CONTROLS                                             [● LIVE] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Contract             Status           Actions                       │
│  ─────────────────────────────────────────────────────────────────   │
│  carbon_credit        ● OPERATIONAL    [⏸ Pause]                    │
│  carbon_marketplace   ● OPERATIONAL    [⏸ Pause]                    │
│                                                                      │
│  ────────────────────────────────────────────────────────────────    │
│  [⏸ PAUSE ALL CONTRACTS]                                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

When one contract is paused, the panel changes to reflect the mixed state:

```
┌──────────────────────────────────────────────────────────────────────┐
│  PAUSE CONTROLS                                             [● LIVE] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Contract             Status               Actions                   │
│  ─────────────────────────────────────────────────────────────────   │
│  carbon_credit        ⏸ PAUSED (47m left)  [▶ Resume]              │
│  carbon_marketplace   ● OPERATIONAL         [⏸ Pause]               │
│                                                                      │
│  ────────────────────────────────────────────────────────────────    │
│  [▶ RESUME ALL CONTRACTS]                                           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

When both contracts are paused, the bulk button switches to **Resume All Contracts**.

---

### 4.2 Status Indicator

Each contract row has a colored **Status Indicator** that shows the current operational state:

| Indicator | Colour | Meaning |
|---|---|---|
| `● OPERATIONAL` | Green | Contract is fully operational. All functions are callable. |
| `⏸ PAUSED (Xh Ym left)` | Amber/Orange | Contract is paused. The countdown shows the time remaining until auto-expiry. |
| `⏸ PAUSED (EXPIRED)` | Red | The pause window has expired. The contract has auto-resumed but the admin has not acknowledged the event. |
| `◌ UNKNOWN` | Grey | The dashboard cannot reach the Soroban RPC endpoint. Status is stale. |

The status indicator updates in real-time via a WebSocket subscription to the Stellar network. There is no need to refresh the page — changes propagate within approximately 5 seconds of the on-chain transaction being confirmed.

The `[● LIVE]` badge in the top-right of the panel confirms the WebSocket connection is healthy. If it shows `[◌ DISCONNECTED]`, the status displayed may be stale by up to the last successful poll interval (60 seconds). In this state, pause and resume actions are still possible but you will not see live feedback until the connection is restored.

---

### 4.3 Emergency Pause Button

The **⏸ Pause** button (or **⏸ Pause All Contracts** for the bulk action) is the entry point for initiating a pause. Clicking it opens the [Confirmation Modal](#45-confirmation-modal--field-by-field-reference).

**Visual state rules:**

- The button is **enabled** when the corresponding contract is `OPERATIONAL`.
- The button is **disabled** (greyed out, non-clickable) when the contract is already `PAUSED`.
- The button shows a **spinner** after you submit the confirmation modal while the transaction is being signed and confirmed.

```
Normal state:
┌───────────────┐
│  ⏸  Pause    │   ← Clickable, red border
└───────────────┘

Disabled state (contract already paused):
┌───────────────┐
│  ⏸  Pause    │   ← Grey, cursor: not-allowed
└───────────────┘

Loading state (transaction in flight):
┌───────────────┐
│  ⟳  Pausing…  │   ← Spinner, non-interactive
└───────────────┘
```

---

### 4.4 Resume Operations Button

The **▶ Resume** button appears in place of the Pause button when the contract is in the `PAUSED` state. Clicking it opens a simpler confirmation modal (no duration or reason field — only a confirmation checkbox).

```
Paused state — resume button visible:
┌──────────────────┐
│  ▶  Resume       │   ← Clickable, green border
└──────────────────┘
```

Resuming a contract before the auto-expiry timer is a manual override. The action is permanent and logged on-chain.

---

### 4.5 Confirmation Modal — Field-by-Field Reference

When you click **⏸ Pause**, a modal dialog appears overlaid on the dashboard. It contains the following fields:

```
┌──────────────────────────────────────────────────────────┐
│  ⚠  Pause Contract: carbon_credit                   [✕] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  This will halt all minting, retiring, and transferring  │
│  operations on carbon_credit. This action will be        │
│  recorded on the Stellar ledger.                         │
│                                                          │
│  Pause Duration                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  ○ 1 hour    ● 6 hours   ○ 24 hours  ○ 72 hours │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  Incident Reason                                         │
│  ┌──────────────────────────────────────────────────┐    │
│  │                                                  │    │
│  │  Describe the reason for this pause (required)   │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ☐  I understand this will halt on-chain operations      │
│     and is permanently logged in the audit trail.        │
│                                                          │
│  [Cancel]                          [⏸ Confirm Pause]    │
└──────────────────────────────────────────────────────────┘
```

#### Field: Pause Duration

| Option | Value | Recommended For |
|---|---|---|
| 1 hour | 3 600 seconds | Routine drills, brief maintenance windows |
| 6 hours | 21 600 seconds | Bug investigation requiring time to diagnose |
| 24 hours | 86 400 seconds | Security incidents under active investigation |
| 72 hours | 259 200 seconds | Severe exploits, legal freeze orders, awaiting patch deployment |

**Default:** 6 hours. This is pre-selected when the modal opens.

The duration begins from the moment the on-chain transaction is confirmed, not from when you click the button. On Stellar testnet, confirmation is typically within 5–10 seconds. On mainnet, allow up to 30 seconds.

When the timer expires, both contracts auto-resume without any admin action required. The auto-expiry event is logged in the audit trail.

> **Best practice:** Choose the shortest duration that gives your team sufficient time to investigate and resolve the incident. You can always resume early. You cannot extend an active pause — you must resume and re-pause with a new duration.

#### Field: Incident Reason

A required free-text field (maximum 500 characters). The text you enter here is:
- Stored in the CarbonLedger PostgreSQL `pause_events` table.
- Displayed in the in-app Audit Log.
- Emitted as a Soroban contract event on the Stellar ledger.

**Write clearly and factually.** This field is part of the permanent audit trail and may be reviewed by regulators, external auditors, or legal counsel. Avoid abbreviations and insider shorthand.

Good examples:
```
Suspected double-counting detected in batch #4821. Pausing credit contract while
investigating serial number range 10000–10500. Ref: Slack #incident-2026-09-26.

Scheduled maintenance window to upgrade Soroban runtime. Expected duration: 2h.
Approved by CTO on 2026-09-26.
```

Poor examples:
```
bug
test
idk something is wrong
```

#### Field: Confirmation Checkbox

You must check this box before the **Confirm Pause** button becomes active. The checkbox is a deliberate friction point — it prevents accidental pauses triggered by misclicks.

Text: *"I understand this will halt on-chain operations and is permanently logged in the audit trail."*

#### Button: Cancel

Closes the modal without submitting any transaction. Keyboard shortcut: **Esc**.

#### Button: Confirm Pause

Active only when both the Incident Reason field is non-empty and the confirmation checkbox is checked. Clicking it:
1. Calls the Freighter extension to request a transaction signature.
2. Submits the signed transaction to the Stellar network.
3. Waits for ledger confirmation.
4. Updates the status indicator on the dashboard in real-time.

If Freighter is not connected or the user rejects the signature request, the modal remains open and an error banner is shown. No transaction is submitted.

---

## 5. Step-by-Step: Initiating an Emergency Pause

Follow these steps exactly during an incident. If pausing both contracts, complete the full sequence for `carbon_credit` first, then repeat for `carbon_marketplace`.

### Step 1 — Verify Your Wallet is Connected

Check the top-right corner of the navigation bar. You should see:

```
  [GA...XYZ ▼]  ← Your admin public key (truncated)
```

If you see a **Connect Wallet** button instead, click it and approve the connection in the Freighter popup.

### Step 2 — Navigate to the Pause Controls Panel

Go to `http://localhost:3000/admin/contracts` (development) or your production URL. Scroll to the top of the page. Confirm you can see the **Pause Controls** panel with status indicators showing `● OPERATIONAL`.

### Step 3 — Click the Emergency Pause Button

Identify the contract you need to pause and click its **⏸ Pause** button. For a bulk pause, click **⏸ Pause All Contracts**.

The Confirmation Modal opens.

### Step 4 — Select a Pause Duration

Click the radio button corresponding to your chosen duration:

- Routine drill → **1 hour**
- Active investigation → **6 hours** or **24 hours**
- Severe incident / legal hold → **72 hours**

### Step 5 — Enter the Incident Reason

Click the **Incident Reason** text area and type a clear, factual description of why you are pausing. Include:

- What triggered the pause (observed behaviour, alert, report)
- Scope of the suspected issue (which contract, which function, which batch)
- Reference to any internal tracking ticket or Slack thread
- Your name or initials so the audit log has human context

### Step 6 — Check the Confirmation Checkbox

Click the checkbox: *"I understand this will halt on-chain operations and is permanently logged in the audit trail."*

The **Confirm Pause** button becomes active (turns from grey to the alert colour).

### Step 7 — Click Confirm Pause

Click **⏸ Confirm Pause**. Freighter will open a popup immediately.

```
┌──────────────────────────────────────┐
│  Freighter                           │
├──────────────────────────────────────┤
│  CarbonLedger is requesting you to   │
│  sign a transaction.                 │
│                                      │
│  Contract: CXXX...                   │
│  Function: pause                     │
│  Network:  Testnet                   │
│                                      │
│  [Decline]           [Approve]       │
└──────────────────────────────────────┘
```

Review the transaction details in Freighter. Confirm:
- The **Contract** address matches your deployed `carbon_credit` or `carbon_marketplace` contract ID (compare against your `.env` file).
- The **Function** shown is `pause`.
- The **Network** matches your intended network (Testnet or Mainnet — never cross them).

Click **Approve** in Freighter.

### Step 8 — Wait for Confirmation

The modal shows a spinner and the message *"Submitting transaction…"*. Do not close the browser tab.

On testnet, confirmation takes approximately 5–10 seconds. On mainnet, allow up to 30 seconds.

### Step 9 — Confirm Success

When the transaction is confirmed, the modal closes automatically and the dashboard updates:

```
  carbon_credit   ⏸ PAUSED (5h 59m left)   [▶ Resume]
```

An amber banner also appears at the top of the page:

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠  carbon_credit is now PAUSED. Auto-resumes in 6 hours.   │
│     Reason: [your incident reason text]               [✕]   │
└──────────────────────────────────────────────────────────────┘
```

The pause event is now permanently written to the Stellar ledger. Notify your team.

### Step 10 — Repeat for carbon_marketplace (if needed)

If the incident affects the marketplace as well, click **⏸ Pause** in the `carbon_marketplace` row and repeat steps 4–9 with the same incident reason (for audit consistency).

Alternatively, if you used **⏸ Pause All Contracts**, both contracts were paused in a single bulk operation and you do not need to repeat.

---

## 6. Step-by-Step: Resuming Operations (Unpause)

Resume only when you have confirmed the incident is resolved and it is safe to re-enable on-chain operations.

### Step 1 — Verify the Incident is Resolved

Before resuming, confirm with your team:
- The root cause of the pause has been identified.
- Any exploit or vulnerability has been patched or mitigated.
- A post-incident review (PIR) ticket has been opened (or will be opened within 24 hours).

Do not resume under pressure if the investigation is incomplete. The 72-hour maximum window exists for this reason.

### Step 2 — Navigate to the Pause Controls Panel

Open the admin dashboard. The paused contract(s) should show `⏸ PAUSED (Xh Ym left)` in their status indicator.

### Step 3 — Click Resume Operations

Click the **▶ Resume** button in the row of the contract you want to resume.

A simpler confirmation modal appears:

```
┌──────────────────────────────────────────────────────────┐
│  ▶  Resume Contract: carbon_credit                  [✕] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  This will re-enable all operations on carbon_credit.    │
│  The pause event and this resume event will both be      │
│  recorded on the Stellar ledger.                         │
│                                                          │
│  ☐  I confirm the incident has been resolved and it is   │
│     safe to resume on-chain operations.                  │
│                                                          │
│  [Cancel]                       [▶ Confirm Resume]      │
└──────────────────────────────────────────────────────────┘
```

### Step 4 — Check the Confirmation Checkbox

Check the box confirming the incident is resolved.

### Step 5 — Click Confirm Resume

Click **▶ Confirm Resume**. Freighter opens for signature. Verify:
- Contract address is correct.
- Function shown is `resume` (or `unpause`).
- Network is correct.

Click **Approve** in Freighter.

### Step 6 — Confirm Success

After confirmation:

```
  carbon_credit   ● OPERATIONAL   [⏸ Pause]
```

A green banner appears:

```
┌──────────────────────────────────────────────────────────────┐
│  ✓  carbon_credit has resumed normal operations.             │
│     Paused for: 1h 23m  [✕]                                 │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Step-by-Step: Monitoring an Active Pause

While a pause is active, the admin dashboard provides a real-time view of the pause state.

### Viewing the Countdown Timer

The status indicator for each paused contract displays a live countdown:

```
  ⏸ PAUSED (23h 41m left)
```

This timer is calculated from the pause expiry timestamp stored on-chain and updates every 60 seconds without a page refresh.

### The Active Pause Banner

A persistent amber banner at the top of every admin page shows the active pause state:

```
┌────────────────────────────────────────────────────────────────────┐
│  ⚠  ACTIVE PAUSE: carbon_credit — 23h 41m remaining               │
│     Reason: "Suspected double-counting in batch #4821..."          │
│     Paused by: GA...XYZ at 2026-09-26 22:03 UTC              [✕]  │
└────────────────────────────────────────────────────────────────────┘
```

The banner cannot be permanently dismissed — it reappears on page load while the pause is active. The `[✕]` only hides it for the current session.

### WebSocket Connection Health

The `[● LIVE]` badge in the Pause Controls panel confirms live status. If the badge turns to `[◌ DISCONNECTED]`:

1. Check your internet connection.
2. Verify the Soroban RPC endpoint is reachable: `wss://soroban-testnet.stellar.org` (testnet) or `wss://soroban.stellar.org` (mainnet).
3. Hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R).
4. The underlying pause state on-chain is unaffected by the WebSocket connection — the contract remains paused regardless.

---

## 8. Step-by-Step: Viewing the Pause History / Audit Log

Every pause and resume action is recorded in two places:
1. **On-chain:** As a Stellar contract event on the Soroban ledger (permanent, immutable).
2. **Off-chain:** In the CarbonLedger PostgreSQL `pause_events` table and in the in-app Audit Log.

### In-App Audit Log

1. On the `/admin/contracts` page, scroll past the Pause Controls panel.
2. Click the **Audit Log ▼** section to expand it.

```
┌─────────────────────────────────────────────────────────────────────┐
│  AUDIT LOG                                            [Export CSV]  │
├─────────────────────────────────────────────────────────────────────┤
│  Filter: [All Events ▼]  Contract: [All ▼]  Date: [Last 30 days ▼]  │
├─────────────────────────────────────────────────────────────────────┤
│  Timestamp (UTC)       Event        Contract           Admin         │
│  ─────────────────────────────────────────────────────────────────  │
│  2026-09-26 22:03:36   PAUSED       carbon_credit      GA...XYZ     │
│    Duration: 6h  Reason: "Suspected double-counting in batch #4821" │
│    Tx: xxxxxx...                                                     │
│                                                                     │
│  2026-09-25 14:22:11   RESUMED      carbon_credit      GA...XYZ     │
│    Paused for: 1h 3m  Tx: yyyyyy...                                 │
│                                                                     │
│  2026-09-25 13:19:04   PAUSED       carbon_credit      GA...XYZ     │
│    Duration: 1h  Reason: "Monthly drill — Q3 2026"                  │
│    Tx: zzzzzz...                                                     │
│                                                                     │
│  [Load more...]                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

Each row shows:
- **Timestamp** — UTC time the transaction was confirmed on-chain.
- **Event** — `PAUSED`, `RESUMED`, or `AUTO_EXPIRED`.
- **Contract** — which contract was affected.
- **Admin** — the Stellar public key that signed the transaction.
- **Tx** — the Stellar transaction hash (links to Stellar Expert or Horizon explorer).
- **Duration / Reason** — the values entered in the confirmation modal.

### Filtering the Audit Log

Use the filter controls above the table:

| Filter | Options |
|---|---|
| Event type | All Events, PAUSED, RESUMED, AUTO_EXPIRED |
| Contract | All, carbon_credit, carbon_marketplace |
| Date range | Last 24h, Last 7 days, Last 30 days, Custom range |

### Exporting the Audit Log

Click **Export CSV** to download the current filtered view as a CSV file. This is useful for:
- Regulatory reporting
- Post-incident review documentation
- External auditor requests

### On-Chain Verification

Every pause event emits a Soroban event that can be independently verified using the Stellar Horizon API:

```bash
# Fetch contract events for carbon_credit
curl "https://horizon-testnet.stellar.org/contracts/<CARBON_CREDIT_CONTRACT_ID>/events" \
  | jq '.records[] | select(.type == "contract") | {timestamp, body}'
```

The event body includes the pause duration, admin address, and incident reason as encoded XDR values. These records exist independently of the CarbonLedger database and cannot be modified or deleted.

---

## 9. Common Tasks

### 9.1 Routine Pause Drill

CarbonLedger's incident response playbook requires a monthly pause drill to verify the mechanism works correctly and the admin team is familiar with the process. Drills should be scheduled during low-traffic hours (typically early morning UTC on a weekday).

**Recommended procedure:**

1. Notify the team in advance via Slack (#ops-alerts) with the drill window.
2. Navigate to `/admin/contracts`.
3. Click **⏸ Pause** on `carbon_credit`.
4. Select **1 hour** duration.
5. Enter reason: `Monthly drill — [Month Year]. No incident. Ref: ops-playbook §3.2.`
6. Confirm and sign with Freighter.
7. Verify the status indicator updates to `⏸ PAUSED`.
8. Click **▶ Resume** immediately (no need to wait the full hour).
9. Verify the status indicator returns to `● OPERATIONAL`.
10. Repeat for `carbon_marketplace`.
11. Export the audit log entry and attach it to the monthly ops report.

> Drills do not need to pause `carbon_marketplace` unless the team wants to test the bulk flow. Pausing a single contract is sufficient to verify the mechanism.

---

### 9.2 Bulk Pause (Both Contracts Simultaneously)

For incidents that affect both contracts (e.g., a suspected protocol-level exploit), use the **⏸ Pause All Contracts** button to pause both in a single operation.

**How it works:**

The bulk pause submits two Soroban transactions in sequence: first `carbon_credit`, then `carbon_marketplace`. Both use the same duration and incident reason. The operation is atomic from a user perspective — if the first transaction fails, the second will not be submitted.

**Steps:**

1. Click **⏸ Pause All Contracts** in the Pause Controls panel.
2. The modal title shows **Pause All Contracts** and lists both contract names.
3. Select duration and enter incident reason (identical for both contracts).
4. Check the confirmation checkbox.
5. Click **Confirm Pause**.
6. Freighter will show **two** signature requests in sequence — approve both.
7. Wait for both transactions to confirm.
8. Verify both rows show `⏸ PAUSED`.

> If you approve the first Freighter request and decline the second, `carbon_credit` will be paused and `carbon_marketplace` will remain operational. The dashboard will reflect this mixed state. You can then pause `carbon_marketplace` individually.

---

### 9.3 Checking Current Pause State via API

If you need to check pause state programmatically (e.g., in a monitoring script), query the CarbonLedger backend API:

```bash
# Get current pause state for all contracts
curl -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  http://localhost:3001/admin/contracts/pause-state

# Expected response (both operational):
{
  "carbon_credit": {
    "paused": false,
    "expiry": null,
    "last_event": "RESUMED",
    "last_event_at": "2026-09-25T15:25:11Z"
  },
  "carbon_marketplace": {
    "paused": false,
    "expiry": null,
    "last_event": "RESUMED",
    "last_event_at": "2026-09-25T15:25:11Z"
  }
}

# Expected response (carbon_credit paused):
{
  "carbon_credit": {
    "paused": true,
    "expiry": "2026-09-27T04:03:36Z",
    "remaining_seconds": 21483,
    "reason": "Suspected double-counting in batch #4821",
    "paused_by": "GA...XYZ",
    "last_event": "PAUSED",
    "last_event_at": "2026-09-26T22:03:36Z"
  },
  "carbon_marketplace": {
    "paused": false,
    "expiry": null,
    "last_event": "RESUMED",
    "last_event_at": "2026-09-25T15:25:11Z"
  }
}
```

You can also query the Soroban contract directly (no JWT required — this is public state):

```bash
stellar contract invoke \
  --id <CARBON_CREDIT_CONTRACT_ID> \
  --source YOUR_SECRET_KEY \
  --network testnet \
  -- is_paused
```

Returns `true` or `false`.

---

## 10. Pause Behaviour Reference

Understanding exactly what stops when a contract is paused helps you decide which contract(s) to pause during an incident.

### carbon_credit — What is Blocked While Paused

| Function | Blocked? |
|---|---|
| `mint_credits()` | ✅ Yes |
| `retire_credits()` | ✅ Yes |
| `transfer_credits()` | ✅ Yes |
| `get_credit_batch()` | ❌ No (read-only, always available) |
| `get_retirement_certificate()` | ❌ No (read-only, always available) |
| `verify_serial_range()` | ❌ No (read-only, always available) |

### carbon_marketplace — What is Blocked While Paused

| Function | Blocked? |
|---|---|
| `list_credits()` | ✅ Yes |
| `delist_credits()` | ✅ Yes |
| `purchase_credits()` | ✅ Yes |
| `bulk_purchase()` | ✅ Yes |
| `get_active_listings()` | ❌ No (read-only, always available) |
| `get_listings_by_vintage()` | ❌ No (read-only, always available) |

### Auto-Expiry Behaviour

When the pause timer expires:
1. The Soroban contract automatically re-enables write functions.
2. A contract event is emitted with type `AUTO_EXPIRED`.
3. The CarbonLedger backend listener detects this event and updates the `pause_events` table.
4. The admin dashboard WebSocket subscription receives the update and the status indicator returns to `● OPERATIONAL`.
5. An email alert is sent to all admin-role users.

Auto-expiry does **not** require any admin action. However, best practice is to perform a manual resume with a documented reason once the incident is resolved — this provides a cleaner audit trail than an auto-expiry event.

---

## 11. Troubleshooting

### T1: Transaction Failed / Signature Rejected

**Symptom:** After clicking Confirm Pause and approving in Freighter, an error banner appears: *"Transaction failed. Please try again."*

**Causes and fixes:**

| Cause | Diagnosis | Fix |
|---|---|---|
| Insufficient XLM for fees | Check Freighter balance — should show < 1 XLM | Top up admin account with XLM from faucet (testnet) or exchange (mainnet) |
| Sequence number mismatch | Another transaction from your account was submitted concurrently | Wait 10 seconds and retry — Stellar sequence numbers update after each ledger |
| RPC node congestion | Horizon/Soroban RPC timeout | Retry after 30 seconds. If persistent, check Stellar network status at `status.stellar.org` |
| Contract ID in .env incorrect | The Freighter popup shows an unfamiliar contract address | Compare the contract address in Freighter with `CARBON_CREDIT_CONTRACT_ID` in your `.env` file |
| Account not funded | Account has 0 XLM (common on fresh testnet accounts) | Run `stellar keys fund <key_alias> --network testnet` |

---

### T2: Contract Already Paused

**Symptom:** Clicking **⏸ Pause** shows an error: *"Contract is already paused."*

**Cause:** Another admin paused the contract before you, or a previous pause attempt succeeded silently.

**Fix:**
1. Refresh the page — the WebSocket should update the status indicator to `⏸ PAUSED`.
2. Check the Audit Log for the most recent pause event to identify who paused it and the current expiry time.
3. If you need to extend the pause duration, you must first resume and then re-pause with the new duration. You cannot extend an active pause in-place.

---

### T3: Wallet Not Connecting

**Symptom:** Clicking **Connect Wallet** does nothing, or Freighter popup does not appear.

**Causes and fixes:**

| Cause | Fix |
|---|---|
| Freighter extension not installed | Install from [freighter.app](https://freighter.app) |
| Freighter extension disabled | Go to browser extension settings and enable Freighter |
| Browser popup blocker | Allow popups from `localhost:3000` (development) or your production domain |
| Freighter locked | Click the Freighter icon in the browser toolbar and unlock with your password |
| Freighter on wrong account | Switch to your admin account inside Freighter |
| Safari browser | Switch to Chrome, Firefox, Brave, or Edge |

After fixing, refresh the page and click **Connect Wallet** again.

---

### T4: Modal Not Appearing

**Symptom:** Clicking **⏸ Pause** does not open the confirmation modal.

**Causes and fixes:**

| Cause | Fix |
|---|---|
| JavaScript error blocking UI | Open browser DevTools (F12), check the Console tab for errors, and report them with the contract version to your engineering team |
| Button rendered but disabled | The contract may already be paused — check the status indicator |
| Browser extension conflict | Try disabling other extensions temporarily (some ad blockers interfere with modals) |
| Outdated frontend build | Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) to clear the module cache |
| Session expired | Log out and log back in — a stale auth token can cause silent failures |

---

### T5: Wrong Network

**Symptom:** Freighter shows **Mainnet** but you intended to operate on **Testnet**, or vice versa.

**Risk:** Pausing the wrong network can halt real user activity (mainnet) or waste time on a non-production environment (testnet).

**Fix:**
1. Click **Decline** (or close) in the Freighter signature popup immediately — do not approve.
2. Click the Freighter extension icon.
3. Go to **Settings → Network** and select the correct network.
4. Return to the dashboard and reconnect your wallet if needed.
5. Verify the network badge shown in the dashboard header matches your intention before retrying.

**Prevention:** The admin dashboard header shows a network badge:
```
  [TESTNET]   ← Orange badge in development
  [MAINNET]   ← Red badge in production
```

Always check this badge before initiating any pause operation.

---

### T6: Session Expiry During Pause Operation

**Symptom:** You opened the modal, filled in the fields, and by the time you clicked Confirm Pause, the page reloaded or showed an authentication error.

**Cause:** JWT sessions expire after a configurable period (default: 30 minutes of inactivity). Long-running incident response sessions may hit this timeout.

**Behaviour:** The frontend middleware detects a stale JWT and redirects to the login page. The in-progress pause operation is cancelled — no transaction was submitted.

**Fix:**
1. Log in again with your admin credentials.
2. Navigate back to `/admin/contracts`.
3. Reconnect your Freighter wallet.
4. Repeat the pause operation from the beginning.

**Prevention:** If you anticipate a long session (e.g., multi-hour incident), open the dashboard and perform a dummy page interaction every 20–25 minutes to reset the session timer. Alternatively, ask your engineering team to increase the JWT TTL in the backend `.env` for the duration of the incident.

---

### T7: Auto-Expiry Did Not Trigger Resume

**Symptom:** The countdown timer reached 0:00 but the status indicator still shows `⏸ PAUSED`.

**Cause:** The backend event listener that watches for `AUTO_EXPIRED` contract events may have been offline or delayed.

**Fix:**
1. Manually resume by clicking **▶ Resume**.
2. Note the timestamp of the manual resume in your incident notes.
3. After the incident, check the backend logs (`docker-compose logs -f backend`) for any WebSocket or event listener errors and create a bug report.

The underlying contract auto-expiry is enforced on-chain regardless of the dashboard display. Even if the UI shows `⏸ PAUSED` after the timer expires, on-chain write operations are **actually re-enabled** once the block timestamp exceeds the expiry. The dashboard display is cosmetic.

---

## 12. Keyboard Shortcuts

All keyboard shortcuts are active when the admin dashboard page is focused.

| Shortcut | Context | Action |
|---|---|---|
| `Esc` | Modal open | Close the confirmation modal without submitting |
| `Tab` | Modal open | Move focus to the next interactive field or button |
| `Shift` + `Tab` | Modal open | Move focus to the previous interactive field or button |
| `Space` | Checkbox focused | Toggle the confirmation checkbox |
| `Enter` | "Confirm" button focused | Submit the modal (pause or resume) |
| `Enter` | "Cancel" button focused | Cancel and close the modal |
| `1` | Pause modal, Duration row focused | Select 1 hour duration |
| `6` | Pause modal, Duration row focused | Select 6 hours duration |
| `2` | Pause modal, Duration row focused | Select 24 hours duration |
| `7` | Pause modal, Duration row focused | Select 72 hours duration |

**Note:** The number shortcut keys (`1`, `6`, `2`, `7`) are only active when keyboard focus is inside the Duration selection row. They do not trigger when typing in the Incident Reason text area.

Focus management follows WAI-ARIA modal dialog pattern: when the modal opens, focus is automatically moved to the first interactive element (the Duration radio group). When the modal closes, focus returns to the button that opened it.

---

## 13. Accessibility Notes

The admin dashboard pause controls are designed to meet WCAG 2.1 AA standards.

### Screen Reader Support

- The Pause Controls panel has `role="region"` and `aria-label="Pause Controls"`.
- Status indicators use `aria-live="polite"` so screen readers announce status changes without interrupting ongoing speech.
- The confirmation modal uses `role="dialog"` with `aria-modal="true"` and `aria-labelledby` pointing to the modal title.
- The confirmation checkbox has a `for`/`id` association with its label text.
- Buttons use descriptive `aria-label` attributes: e.g., `aria-label="Pause carbon_credit contract"`.

### Colour Independence

Status is never conveyed by colour alone:
- `● OPERATIONAL` uses both green colour and the filled circle character.
- `⏸ PAUSED` uses both amber colour and the pause icon character.
- `◌ UNKNOWN` uses both grey colour and the hollow circle character.

### High Contrast Mode

The UI adapts to Windows High Contrast mode and the `prefers-contrast: more` media query. Button borders and status badges increase in contrast when high contrast mode is detected.

### Reduced Motion

Spinner animations and transition effects are disabled when `prefers-reduced-motion: reduce` is set in the operating system or browser.

### Minimum Target Size

All interactive elements (buttons, checkboxes, radio buttons) meet the WCAG 2.5.5 minimum target size of 44×44 CSS pixels.

---

## 14. Related Documentation

| Document | Description |
|---|---|
| [docs/carbon-credit-lifecycle.md](carbon-credit-lifecycle.md) | Full lifecycle reference — actors, contract functions, error conditions, and sequence diagram |
| [docs/QUICK_REFERENCE.md](QUICK_REFERENCE.md) | One-page command reference for all admin operations |
| [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common setup and runtime issues |
| [docs/configuration.md](configuration.md) | Every environment variable explained, including contract IDs and JWT settings |
| [docs/adr/README.md](adr/README.md) | Architecture Decision Records — rationale behind contract design choices |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Development workflow and test guidelines |
| [SECURITY.md](../SECURITY.md) | Security policy, threat model, and responsible disclosure |
| [audit/pre-audit-checklist.md](../audit/) | Pre-audit security checklist covering the pause mechanism |

### External References

- [Stellar Soroban Documentation](https://soroban.stellar.org/docs) — Contract invocation and event subscriptions
- [Freighter Wallet](https://freighter.app) — Browser extension for signing Soroban transactions
- [Stellar Expert](https://stellar.expert) — Block explorer for verifying on-chain pause events
- [Stellar Network Status](https://status.stellar.org) — Real-time Stellar network health

---

*This guide was written to close [issue #1206](https://github.com/YOUR_USERNAME/carbonledger/issues/1206). If you find an error or gap in coverage, please open an issue or submit a pull request.*
