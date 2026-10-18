# Pause Feature — User Flow Diagrams

> **Audience**: Frontend engineers, product designers, QA engineers  
> **Scope**: Mermaid sequence diagrams covering every pause-related user journey  
> **Related**: [Pause UX Guide](pause-ux-guide.md) · [Pause Feature Specification](pause-feature/SPECIFICATION.md) · [Emergency Pause Procedures](EMERGENCY_PAUSE_PROCEDURES.md) · [Pause Architecture](pause-architecture.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Flow 1 — Admin Pause Activation](#2-flow-1--admin-pause-activation)
3. [Flow 2 — User Encounters a Paused Contract](#3-flow-2--user-encounters-a-paused-contract)
4. [Flow 3 — Pause Expiry and Auto-Lift](#4-flow-3--pause-expiry-and-auto-lift)
5. [Flow 4 — Admin Manual Unpause](#5-flow-4--admin-manual-unpause)
6. [Flow 5 — Emergency Escalation](#6-flow-5--emergency-escalation)
7. [State Diagram — Contract Pause Lifecycle](#7-state-diagram--contract-pause-lifecycle)
8. [Cross-Contract Interaction Map](#8-cross-contract-interaction-map)

---

## 1. Overview

The CarbonLedger pause feature involves four distinct actors communicating across multiple system layers:

| Actor | Role |
|-------|------|
| **Admin** | Initiates and lifts pauses from the admin dashboard or CLI |
| **User** | Corporate buyer, trader, or auditor interacting with the marketplace |
| **Frontend** | Next.js application — renders UI state, polls status, gates buttons |
| **Backend** | NestJS API — validates requests, caches status, writes audit log |
| **Soroban Contract** | `carbon_credit` or `carbon_marketplace` — enforces pause on-chain |
| **Stellar Network** | Submits and confirms transactions |

The diagrams in this document trace the full journey through all layers for each major scenario. They are intended to be used:
- As a **reference for frontend engineers** implementing or modifying pause UI
- As a **test specification** for QA writing end-to-end tests
- As a **communication tool** for design reviews and incident post-mortems

---

## 2. Flow 1 — Admin Pause Activation

This is the primary operational flow: an administrator detects an incident and issues a pause within the 5-minute SLA.

```mermaid
sequenceDiagram
    actor Admin
    participant Dashboard as Admin Dashboard<br/>(Next.js)
    participant Modal as PauseConfirmModal
    participant Hook as useContractPauseStatus
    participant Backend as Backend API<br/>(NestJS)
    participant Cache as Redis Cache
    participant Contract as Soroban Contract<br/>(carbon_credit)
    participant Network as Stellar Network

    Admin->>Dashboard: Navigates to Contract Controls panel
    Dashboard->>Hook: Subscribe to pause status (poll every 30s)
    Hook->>Backend: GET /api/v1/contract/status
    Backend->>Cache: Read cached pause status
    Cache-->>Backend: { isPaused: false, ... }
    Backend-->>Hook: 200 { isPaused: false }
    Hook-->>Dashboard: status = "active"
    Dashboard-->>Admin: PauseStatusIndicator shows "Active ●"

    Admin->>Dashboard: Clicks "Emergency Pause" button
    Dashboard->>Modal: Open PauseConfirmModal
    Modal-->>Admin: Focus moves to Cancel button<br/>aria-live: "Dialog: Confirm Emergency Pause"

    Admin->>Modal: Selects duration (e.g. 6 hours)
    Admin->>Modal: Types incident reason
    Admin->>Modal: Clicks "Pause Contract"

    Modal->>Backend: POST /api/v1/admin/pause<br/>{ duration: 21600, reason: "Incident: ..." }
    Backend->>Backend: Validate admin role (JWT + wallet address)
    Backend->>Contract: Build pause_operations XDR<br/>(pause_until = now + duration)
    Backend->>Network: Submit signed transaction
    Network-->>Backend: Transaction confirmed (ledger sequence)
    Backend->>Cache: Invalidate pause status cache
    Backend->>Backend: Write audit_log entry<br/>(admin, reason, duration, tx_hash)
    Backend-->>Modal: 200 { success: true, pausedUntil: "..." }

    Modal->>Dashboard: Close modal, restore focus to trigger button
    Dashboard->>Hook: Trigger immediate status refresh
    Hook->>Backend: GET /api/v1/contract/status
    Backend->>Contract: Simulate pause_status()
    Contract-->>Backend: { paused: true, pauseUntil: <timestamp> }
    Backend->>Cache: Update cache (TTL 30s)
    Backend-->>Hook: 200 { isPaused: true, pausedUntil: "..." }
    Hook-->>Dashboard: status = "paused"

    Dashboard-->>Admin: PauseStatusIndicator → "Paused ●"<br/>PauseBanner renders site-wide<br/>All write buttons disabled
    Note over Dashboard,Admin: aria-live "assertive" announces banner content
```

### Error Variants — Pause Activation

```mermaid
sequenceDiagram
    actor Admin
    participant Modal as PauseConfirmModal
    participant Backend as Backend API
    participant Contract as Soroban Contract

    Note over Admin,Contract: Error Variant A: Not Authorized
    Admin->>Modal: Clicks "Pause Contract"
    Modal->>Backend: POST /api/v1/admin/pause
    Backend->>Backend: Validate admin role — FAIL<br/>(wallet address ≠ contract admin)
    Backend-->>Modal: 403 { error: "PermissionDenied" }
    Modal-->>Admin: Inline error: "The connected account is not<br/>authorized to execute pause operations."
    Note over Modal,Admin: Input state preserved. "Switch Wallet" button shown.

    Note over Admin,Contract: Error Variant B: Already Paused
    Admin->>Modal: Clicks "Pause Contract"
    Modal->>Backend: POST /api/v1/admin/pause
    Backend->>Contract: Build XDR and submit
    Contract-->>Backend: Error: contract already paused
    Backend-->>Modal: 409 { error: "AlreadyPaused" }
    Modal-->>Admin: Toast: "The contract is already in the requested state."
    Modal->>Modal: Close modal
    Dashboard->>Dashboard: Auto-refresh to show current state

    Note over Admin,Contract: Error Variant C: Network Failure (retry flow)
    Admin->>Modal: Clicks "Pause Contract"
    Modal->>Backend: POST /api/v1/admin/pause
    Backend-->>Modal: 503 { error: "NetworkError" }
    Modal-->>Admin: Error: "Unable to reach the network. Retry 1 of 3."
    Note over Modal: Input state preserved (duration, reason)
    Admin->>Modal: Clicks Retry
    Modal->>Backend: POST /api/v1/admin/pause (retry 1)
    Backend-->>Modal: 503 (still failing)
    Modal-->>Admin: "Retry 2 of 3..."
    Admin->>Modal: Clicks Retry
    Modal->>Backend: POST /api/v1/admin/pause (retry 2)
    Backend-->>Modal: 200 { success: true }
    Modal-->>Admin: Success — proceeds as normal flow
```

---

## 3. Flow 2 — User Encounters a Paused Contract

This flow covers the most common user-facing scenario: a buyer or trader arrives at the marketplace while it is paused.

```mermaid
sequenceDiagram
    actor User as User (Trader / Buyer)
    participant Page as Marketplace Page<br/>(Next.js)
    participant Shell as ApplicationShell
    participant Hook as useContractPauseStatus
    participant Backend as Backend API
    participant Contract as Soroban Contract

    User->>Page: Navigate to /marketplace
    Page->>Shell: Mount ApplicationShell
    Shell->>Hook: Subscribe to pause status
    Hook->>Backend: GET /api/v1/contract/status
    Backend-->>Hook: 200 { isPaused: true,<br/>reason: "Security incident under investigation",<br/>pausedUntil: "2026-10-16T06:00:00Z" }
    Hook-->>Shell: isPaused = true

    Shell-->>User: PauseBanner renders:<br/>"⚠ Contract operations are temporarily paused.<br/>Reason: Security incident under investigation.<br/>Resumes in: 4h 23m | View Status ↗"
    Note over Shell,User: role="alert" aria-live="assertive"<br/>Screen reader announces banner immediately

    User->>Page: Browses credit listings (read-only — works normally)
    Page->>Backend: GET /api/v1/credits (read-only endpoint)
    Backend-->>Page: 200 { listings: [...] }
    Page-->>User: Credit listings render normally

    User->>Page: Clicks "Purchase" on a listing
    Note over Page,User: Button is disabled (aria-disabled="true")
    Page-->>User: Tooltip on hover/focus:<br/>"Contract paused for emergency maintenance.<br/>Estimated resume in 4h 22m."
    Note over User: No network request made — disabled button prevents submission

    User->>Page: Clicks "View Status ↗" in banner
    Page->>Page: window.open('https://status.carbonledger.io', '_blank')
    Note over User: Status page opens in new tab

    Note over Hook,Backend: 30 second polling continues in background
    Hook->>Backend: GET /api/v1/contract/status (poll interval)
    Backend-->>Hook: 200 { isPaused: true, ... }
    Note over Hook: No state change — UI unchanged
```

### Sub-flow: User Submits Transaction During Race Condition

A rare but important edge case: the pause is activated after the user loads the page but before they submit a transaction.

```mermaid
sequenceDiagram
    actor User as User (Trader / Buyer)
    participant Page as Marketplace Page
    participant Hook as useContractPauseStatus
    participant Backend as Backend API
    participant Contract as Soroban Contract

    Note over User,Contract: User loads page while contract is active
    Hook->>Backend: GET /api/v1/contract/status
    Backend-->>Hook: 200 { isPaused: false }
    Note over User: Buttons are enabled, no banner shown

    Note over Backend,Contract: [Admin activates pause — race condition window]

    User->>Page: Clicks "Purchase" (button still enabled on client)
    Page->>Backend: POST /api/v1/marketplace/purchase
    Backend->>Contract: Simulate purchase transaction
    Contract-->>Backend: Error: EmergencyPaused (code 29)
    Backend-->>Page: 423 { error: "EmergencyPaused",<br/>message: "Contract is paused" }

    Page->>Hook: Trigger immediate status refresh
    Hook->>Backend: GET /api/v1/contract/status
    Backend-->>Hook: 200 { isPaused: true, ... }
    Hook-->>Page: isPaused = true

    Page-->>User: PauseBanner appears (assertive live region)
    Page-->>User: Toast: "This action is currently unavailable —<br/>the contract is paused for maintenance."
    Page-->>User: Purchase button disables
    Note over User: User sees banner and understands the situation
```

---

## 4. Flow 3 — Pause Expiry and Auto-Lift

The Soroban contract enforces a hard maximum of 72 hours. When the expiry timestamp is reached, the pause lifts automatically at the contract level. This flow shows how the frontend detects and reflects that change.

```mermaid
sequenceDiagram
    participant Contract as Soroban Contract<br/>(carbon_credit)
    participant Ledger as Stellar Ledger
    participant Cache as Redis Cache
    participant Backend as Backend API
    participant Hook as useContractPauseStatus (all sessions)
    participant Indexer as Event Indexer (proposed)
    participant Shell as ApplicationShell (all users)

    Note over Contract,Ledger: Pause deadline approaches
    Note over Contract: pause_until = T (ledger timestamp)

    Ledger->>Ledger: Ledger time reaches T
    Note over Contract,Ledger: Contract pause auto-expires.<br/>Next call to any gated function succeeds.
    Note over Indexer: Indexer detects PauseExpired event (proposed feature, FR-8)
    Indexer->>Backend: POST /internal/pause-event { type: "expired", contract: "carbon_credit" }
    Backend->>Cache: Invalidate pause status cache immediately

    Note over Hook,Backend: Standard 30-second polling — all active user sessions
    Hook->>Backend: GET /api/v1/contract/status
    Backend->>Contract: Simulate pause_status()
    Contract-->>Backend: { paused: false }
    Backend->>Cache: Update cache { isPaused: false }
    Backend-->>Hook: 200 { isPaused: false }

    Hook-->>Shell: isPaused = false (all active sessions)
    Shell-->>Shell: PauseBanner dismisses (animated slide-up)
    Shell-->>Shell: All write buttons re-enable
    Shell-->>Shell: Polite live region announces:<br/>"Contract operations have resumed.<br/>All transactions are now available."

    Note over Shell: Users who were waiting can now transact
```

### Timeline Notes

- Maximum detection lag = 30 seconds (polling interval).
- If the event indexer (FR-8) is implemented, detection lag drops to < 5 seconds.
- Until the indexer is live, all sessions rely on the 30-second poll.
- The 30-second poll is acceptable per NFR-3 ("off-chain pause status is at most 30s stale").

---

## 5. Flow 4 — Admin Manual Unpause

When an incident is resolved before the pause deadline, the admin can lift the pause early.

```mermaid
sequenceDiagram
    actor Admin
    participant Dashboard as Admin Dashboard<br/>(Next.js)
    participant StatusPanel as Contract Status Panel
    participant ConfirmModal as Unpause Confirmation Modal
    participant Backend as Backend API
    participant Cache as Redis Cache
    participant Contract as Soroban Contract
    participant Network as Stellar Network
    participant AllSessions as All Active User Sessions

    Admin->>Dashboard: Incident resolved — navigates to Contract Controls
    Dashboard-->>Admin: PauseStatusIndicator: "Paused ● 3h 41m remaining"
    Dashboard-->>Admin: "Resume Operations" button visible (emerald green)

    Admin->>StatusPanel: Clicks "Resume Operations"
    StatusPanel->>ConfirmModal: Open confirmation modal
    ConfirmModal-->>Admin: Focus moves to Cancel button
    ConfirmModal-->>Admin: "Immediately resume all blocked transactions.<br/>This cannot be undone."

    Admin->>ConfirmModal: Clicks "Resume Operations" / presses Enter
    ConfirmModal->>Backend: POST /api/v1/admin/unpause
    Backend->>Backend: Validate admin role (JWT + wallet)
    Backend->>Contract: Build unpause_operations XDR
    Backend->>Network: Submit signed transaction
    Network-->>Backend: Transaction confirmed
    Backend->>Cache: Invalidate pause status cache
    Backend->>Backend: Write audit_log entry<br/>(admin, "manual_unpause", tx_hash)
    Backend-->>ConfirmModal: 200 { success: true }

    ConfirmModal->>Dashboard: Close modal, return focus to "Resume Operations" button
    Dashboard->>Dashboard: Trigger immediate status refresh
    Dashboard-->>Admin: PauseStatusIndicator → "Active ●"
    Dashboard-->>Admin: "Resume Operations" button hidden<br/>"Emergency Pause" button shown

    Note over AllSessions: Next 30-second poll for all active sessions
    AllSessions->>Backend: GET /api/v1/contract/status
    Backend-->>AllSessions: 200 { isPaused: false }
    AllSessions-->>AllSessions: PauseBanner dismisses<br/>Buttons re-enable<br/>"Operations resumed" announced via aria-live
```

### Idempotency

```mermaid
sequenceDiagram
    actor Admin
    participant Dashboard as Admin Dashboard
    participant Backend as Backend API
    participant Contract as Soroban Contract

    Note over Admin,Contract: Admin attempts to unpause when already active
    Admin->>Dashboard: Clicks "Resume Operations" (stale UI state)
    Dashboard->>Backend: POST /api/v1/admin/unpause
    Backend->>Contract: Build unpause_operations XDR and submit
    Contract-->>Backend: Unpause is idempotent — succeeds (no error)
    Backend->>Backend: Audit log: "unpause_noop — contract was already active"
    Backend-->>Dashboard: 200 { success: true, note: "already_active" }
    Dashboard->>Dashboard: Trigger status refresh
    Dashboard-->>Admin: PauseStatusIndicator confirms "Active ●"
    Note over Admin: No confusing error. Dashboard reflects truth.
```

---

## 6. Flow 5 — Emergency Escalation

When a pause alone is insufficient — for example, if the pause expiry is approaching and the incident is not resolved, or if the admin key itself may be compromised — the escalation protocol activates.

```mermaid
sequenceDiagram
    actor Admin as Admin (On-Call)
    actor Security as Security Lead
    actor StellarSDF as Stellar SDF Support (external)
    participant Dashboard as Admin Dashboard
    participant Backend as Backend API
    participant Contract as Soroban Contract
    participant Runbook as Emergency Runbook

    Note over Admin,Contract: T=0: Pause activated (maximum 72 hours)
    Admin->>Contract: pause_operations(pause_until = T+72h)

    Note over Admin,Contract: T+48h: Incident not resolved, 24h remaining
    Admin->>Dashboard: Review pause status: "24h remaining"
    Admin->>Security: Escalate — incident requires extension beyond 72h

    Security->>Runbook: Consult docs/runbooks/emergency-pause.md
    Security->>Admin: Decision: issue new pause before current one expires

    Note over Admin,Contract: T+71h: Issue a new 72-hour pause before expiry
    Admin->>Backend: POST /api/v1/admin/pause<br/>{ duration: 72h, reason: "Incident extension: ..." }
    Backend->>Contract: pause_operations(pause_until = now + 72h)
    Contract-->>Backend: Success (new pause deadline set)
    Backend->>Backend: Audit log: "pause_extension"
    Dashboard-->>Admin: Countdown resets to 72h

    Note over Admin,Contract: Alternate escalation: Admin key compromise suspected
    Security->>Contract: grant_role(new_admin_key)<br/>(role management stays available while paused — FR-7)
    Contract-->>Security: New admin key granted
    Security->>Contract: revoke_role(old_admin_key)
    Contract-->>Security: Old key revoked
    Security->>Backend: POST /api/v1/admin/unpause (using new key)
    Backend->>Contract: unpause_operations (new key)
    Contract-->>Backend: Success

    Note over Admin,StellarSDF: Last resort: Stellar SDF escalation
    Security->>StellarSDF: Report on-chain incident via Stellar Discord / HackerOne
    StellarSDF-->>Security: Guidance on network-level interventions (rare, exceptional)
```

---

## 7. State Diagram — Contract Pause Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active : Contract deployed / initialized

    Active --> Paused : Admin calls pause_operations(pause_until)\nMax 72 hours from now
    Paused --> Active : Ledger time ≥ pause_until\n(auto-expiry, no transaction needed)
    Paused --> Active : Admin calls unpause_operations()\n(early manual lift, idempotent)
    Active --> Active : Admin calls unpause_operations()\n(idempotent — no state change)
    Paused --> Paused : Admin calls pause_operations() while paused\n(Error: already paused)\n[current behavior — see FR-8 for proposed extension behavior]

    state Active {
        [*] --> AllFunctionsEnabled
        AllFunctionsEnabled --> AllFunctionsEnabled : Normal operations\n(mint, transfer, retire, purchase)
    }

    state Paused {
        [*] --> WriteFunctionsBlocked
        WriteFunctionsBlocked --> WriteFunctionsBlocked : Gated calls fail with EmergencyPaused(29)
        note right of WriteFunctionsBlocked
            Still available while paused:
            - get_credit_batch()
            - get_retirement_certificate()
            - get_active_listings()
            - pause_status()
            - grant_role() / revoke_role()
        end note
    }
```

---

## 8. Cross-Contract Interaction Map

`carbon_marketplace` calls `carbon_credit` internally during purchases. Both contracts are independently pausable, and a pause on either blocks the cross-contract call chain.

```mermaid
flowchart TD
    subgraph User["User Action"]
        U1([User clicks Purchase])
    end

    subgraph Frontend["Frontend (Next.js)"]
        F1[Check carbon_marketplace pause status]
        F2{Marketplace paused?}
        F3[Disable Purchase button]
        F4[Build purchase transaction XDR]
        F5[Submit to Soroban RPC]
    end

    subgraph Marketplace["carbon_marketplace contract"]
        M1[purchase_credits() entry]
        M2{check_not_paused}
        M3[Validate listing, price, buyer balance]
        M4[Call carbon_credit.transfer_credits()]
        M5[Transfer USDC to seller]
        M6[Emit PurchaseCompleted event]
    end

    subgraph Credit["carbon_credit contract"]
        C1[transfer_credits() entry]
        C2{check_not_paused}
        C3[Execute credit transfer]
    end

    U1 --> F1
    F1 --> F2
    F2 --> |Yes| F3
    F2 --> |No| F4
    F4 --> F5
    F5 --> M1
    M1 --> M2
    M2 --> |Paused| E1[Error: EmergencyPaused 29\nreturned to frontend]
    M2 --> |Not paused| M3
    M3 --> M4
    M4 --> C1
    C1 --> C2
    C2 --> |Paused| E2[Error: EmergencyPaused 29\npropagated back through marketplace]
    C2 --> |Not paused| C3
    C3 --> M5
    M5 --> M6
    M6 --> SUCCESS([Transaction complete])

    E1 --> HANDLE[Frontend maps to pause banner + toast]
    E2 --> HANDLE

    style E1 fill:#fee2e2,stroke:#ef4444
    style E2 fill:#fee2e2,stroke:#ef4444
    style F3 fill:#fef3c7,stroke:#f59e0b
    style SUCCESS fill:#d1fae5,stroke:#10b981
```

### Key observation

Both `carbon_credit` and `carbon_marketplace` must be unpaused for a purchase to succeed. If only one is paused, the cross-contract call will still fail. The frontend should check both statuses independently and show a combined banner that clarifies which contract(s) are affected:

> "⚠ `carbon_marketplace` is paused for maintenance. Purchases are currently unavailable."

vs.

> "⚠ Both `carbon_credit` and `carbon_marketplace` are paused. All transactions are unavailable."

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [Pause UX Guide](pause-ux-guide.md) | Interaction patterns, error handling, accessibility, and mobile guidelines |
| [Pause Feature Specification](pause-feature/SPECIFICATION.md) | Contract-level requirements, state model, and architecture |
| [Pause Architecture](pause-architecture.md) | System architecture diagrams and data flow |
| [Emergency Pause Procedures](EMERGENCY_PAUSE_PROCEDURES.md) | Step-by-step incident response runbook |
| [Pause API Reference](pause-api-reference.md) | Backend endpoints and contract function signatures |
| [Pause Security Analysis](pause-security-analysis.md) | Threat model and attack surface for the pause mechanism |
| [ADR-013: Emergency Pause](adr/ADR-013-emergency-pause.md) | Architecture decision record for the pause design |

---

*Last updated: October 2026 · Issue #1269*
