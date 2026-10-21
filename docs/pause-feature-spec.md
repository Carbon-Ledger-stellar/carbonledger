# Pause Feature — Comprehensive Specification

> **Closes:** #1210  
> **Status:** Contract layer implemented · Backend, database, and frontend layers proposed  
> **Last updated:** 2026-09-27  
> **Related:** [Pause FAQ](pause-faq.md) · [Pause Contract API](pause-contract-api.md) · [Pause Security Review](pause-security-review.md) · [ADR-013](adr/ADR-013-emergency-pause.md)

This document is the authoritative cross-stack specification for the CarbonLedger emergency pause feature. It covers every layer of the system: Soroban contracts, backend API, database schema, frontend UI/UX, security model, and performance requirements.

Sections are tagged:
- **[Implemented]** — code is on `main` today.
- **[Proposed]** — designed but not yet built; requires its own issue and PR.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
   - [Functional Requirements](#21-functional-requirements)
   - [Non-Functional Requirements](#22-non-functional-requirements)
3. [Architecture](#3-architecture)
4. [Contract Layer](#4-contract-layer)
5. [API Specifications](#5-api-specifications)
6. [Database Schema](#6-database-schema)
7. [UI/UX Requirements](#7-uiux-requirements)
8. [Security Considerations](#8-security-considerations)
9. [Performance Requirements](#9-performance-requirements)
10. [Testing Requirements](#10-testing-requirements)
11. [Rollout Plan](#11-rollout-plan)
12. [Related Documents](#12-related-documents)

---

## 1. Overview

The **emergency pause** is a time-bounded circuit breaker. An administrator uses it to halt all state-changing operations on a Soroban contract during an incident — for example, a suspected exploit, a manipulated oracle price feed, or a serial-number conflict — without disrupting read access or permanently locking funds.

### Key Properties

| Property | Value |
|----------|-------|
| Scope | Per-contract (`carbon_credit` and `carbon_marketplace` independently) |
| Maximum duration | 72 hours per pause activation |
| Auto-expiry | Pause lifts automatically when the deadline passes |
| Write protection | All state-mutating functions blocked while paused |
| Read access | All query functions remain fully accessible |
| Authorization | Admin role required; both Soroban auth + role check enforced |
| Contracts covered | `carbon_credit`, `carbon_marketplace` |
| Contracts not covered | `carbon_registry`, `carbon_oracle`, `carbon_zk_verifier` |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Stack | Status |
|----|-------------|-------|--------|
| FR-1 | An admin can pause a contract until a given ledger timestamp. | Contract | ✅ Implemented |
| FR-2 | The pause deadline must be strictly after the current ledger time and no more than 72 hours ahead. | Contract | ✅ Implemented |
| FR-3 | While paused, all state-mutating functions fail with `EmergencyPaused`. | Contract | ✅ Implemented |
| FR-4 | The pause lifts automatically once `ledger.timestamp() ≥ PauseUntil`. | Contract | ✅ Implemented |
| FR-5 | An admin can unpause early at any time. Unpausing is idempotent. | Contract | ✅ Implemented |
| FR-6 | Read-only query functions are never blocked by the pause. | Contract | ✅ Implemented |
| FR-7 | Role management (`grant_role` / `revoke_role`) stays available while paused, to allow key rotation during an incident. | Contract | ✅ Implemented |
| FR-8 | `pause_operations` and `unpause_operations` emit contract events consumable by the indexer. | Contract | 🟡 Proposed |
| FR-9 | Each pausable contract exposes a public read-only `get_pause_status()` function. | Contract | 🟡 Proposed |
| FR-10 | The backend exposes REST endpoints for querying pause status and (with admin auth) activating/deactivating the pause. | Backend | 🟡 Proposed |
| FR-11 | The backend persists a pause audit log: every activation and deactivation with reason, actor, timestamp, and deadline. | Backend/DB | 🟡 Proposed |
| FR-12 | The frontend displays a dismissible banner when a pause is active, visible to all users. | Frontend | 🟡 Proposed |
| FR-13 | The frontend shows a user-friendly error message when an operation fails with `EmergencyPaused`. | Frontend | 🟡 Proposed |
| FR-14 | The admin dashboard includes a pause control panel with status, activate/deactivate controls, and audit log. | Frontend | 🟡 Proposed |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Checking the pause adds no more than 2 persistent storage reads to each gated call. |
| NFR-2 | An operator can activate the pause within 5 minutes of deciding to act. |
| NFR-3 | Off-chain pause status displayed by the frontend is at most 30 seconds stale. |
| NFR-4 | A pause never permanently locks funds: the 72-hour cap and admin unpause guarantee recovery. |
| NFR-5 | The pause mechanism must not add latency exceeding 10 ms to any contract call under normal (unpaused) conditions. |
| NFR-6 | The backend pause status endpoint must respond in under 200 ms (p99). |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ADMIN OPERATOR                         │
│  Stellar CLI  /  Admin Dashboard  /  Emergency Script       │
└──────────────────────────┬──────────────────────────────────┘
                           │ Stellar transaction (signed)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   SOROBAN CONTRACTS                         │
│                                                             │
│  carbon_credit                carbon_marketplace            │
│  ┌─────────────────────┐     ┌─────────────────────┐       │
│  │ pause_operations()  │     │ pause_operations()  │       │
│  │ unpause_operations()│     │ unpause_operations()│       │
│  │ require_not_paused()│     │ require_not_paused()│       │
│  │ PauseEnabled: bool  │     │ PauseEnabled: bool  │       │
│  │ PauseUntil: u64     │     │ PauseUntil: u64     │       │
│  └─────────────────────┘     └─────────────────────┘       │
└──────────────────────────┬──────────────────────────────────┘
                           │ Events + storage reads
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              BACKEND (NestJS) [Proposed]                    │
│                                                             │
│  PauseService                PauseAuditRepository          │
│  ├── getPauseStatus()        ├── logPauseEvent()           │
│  ├── activatePause()         └── getAuditLog()             │
│  └── deactivatePause()                                      │
│                                                             │
│  REST API                                                   │
│  GET  /api/v1/pause/status                                  │
│  POST /api/v1/pause/activate    (admin only)                │
│  POST /api/v1/pause/deactivate  (admin only)                │
│  GET  /api/v1/pause/audit-log   (admin only)                │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP polling / WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              FRONTEND (Next.js 14) [Proposed]               │
│                                                             │
│  PauseBanner (all users)   AdminPausePanel (admins only)   │
│  PausedErrorMessage        PauseAuditLog                   │
│  usePauseStatus() hook     PauseControls                   │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow: Pause Activation

```
1. Admin calls pause_operations(admin, until_timestamp)
2. Soroban validates: admin.require_auth() + require_role(Admin)
3. Validates: now < until_timestamp ≤ now + 72h
4. Writes: PauseEnabled=true, PauseUntil=until_timestamp
5. Emits event: ("c_ledger", "paused") → (admin, until_timestamp, now)
6. Backend event listener receives event, writes to pause_audit_log
7. Backend cache for GET /pause/status is invalidated
8. Frontend polls /pause/status, receives updated status
9. PauseBanner appears for all users
```

### Data Flow: Blocked Transaction

```
1. User submits transaction to a state-mutating function
2. Contract calls require_not_paused()
3. Reads PauseEnabled=true, PauseUntil > now
4. Returns Err(CarbonError::EmergencyPaused) → ContractError(29 or 27)
5. Stellar network rejects transaction (no state change, network fee charged)
6. Frontend receives error, displays PausedErrorMessage
```

---

## 4. Contract Layer

### 4.1 Implemented Functions

#### `pause_operations` [Implemented]

```rust
pub fn pause_operations(
    env: Env,
    admin: Address,
    until_timestamp: u64,
) -> Result<(), CarbonError>
```

Sets `PauseEnabled = true` and `PauseUntil = until_timestamp` in persistent storage. Emits a `paused` event.

**Guards:** `admin.require_auth()`, admin role check, `now < until_timestamp ≤ now + 259200`.

#### `unpause_operations` [Implemented]

```rust
pub fn unpause_operations(
    env: Env,
    admin: Address,
) -> Result<(), CarbonError>
```

Sets `PauseEnabled = false` and `PauseUntil = 0`. Idempotent. Emits an `unpaused` event.

**Guards:** `admin.require_auth()`, admin role check.

#### `require_not_paused` (internal) [Implemented]

```rust
fn require_not_paused(env: &Env) -> Result<(), CarbonError>
```

Called at the start of every state-mutating function. Returns `Err(EmergencyPaused)` if active. Auto-clears stale flags after deadline passes.

### 4.2 Proposed Functions

#### `get_pause_status` [Proposed]

```rust
pub fn get_pause_status(env: Env) -> PauseStatus
```

A public, authorization-free read-only function returning effective pause state.

```rust
#[contracttype]
pub struct PauseStatus {
    /// Whether the PauseEnabled flag is set in storage
    pub paused: bool,
    /// Epoch timestamp when pause expires (0 if not paused)
    pub until_timestamp: u64,
    /// Whether the pause is currently effective: paused && until > now
    pub is_active: bool,
    /// Seconds remaining until pause expires (0 if not active)
    pub seconds_remaining: u64,
}
```

### 4.3 Storage Model

| Key | Type | Persistence | Default |
|-----|------|-------------|---------|
| `DataKey::PauseEnabled` | `bool` | Persistent | `false` |
| `DataKey::PauseUntil` | `u64` | Persistent | `0` |

Persistent storage survives ledger entry TTL cycles. The pause state will not be lost due to ledger entry expiry.

### 4.4 Error Codes

| Error | `carbon_credit` | `carbon_marketplace` | Cause |
|-------|----------------|---------------------|-------|
| `EmergencyPaused` | 29 | 27 | State-mutating call while paused |
| `InvalidPauseWindow` | 28 | 26 | `until_timestamp` outside `(now, now+72h]` |

### 4.5 Gated Functions

#### `carbon_credit`

`mint_credits`, `retire_credits`, `transfer_credits`, `set_verified_periods`, `set_vintage_year_bounds`

#### `carbon_marketplace`

`list_credits`, `delist_credits`, `purchase_credits`, `bulk_purchase`, `set_vintage_year_bounds`

### 4.6 Functions NOT Gated

`pause_operations`, `unpause_operations`, `grant_role`, `revoke_role`, all `get_*` and `verify_*` read functions, `initialize`.

---

## 5. API Specifications

> All endpoints below are **Proposed**. They describe the intended NestJS backend REST API.

### Base URL

```
/api/v1/pause
```

### 5.1 GET `/api/v1/pause/status`

Returns the current effective pause status for both contracts. Public endpoint — no authentication required.

**Response 200:**

```json
{
  "carbon_credit": {
    "is_active": true,
    "paused_flag": true,
    "until_timestamp": 1790000000,
    "until_iso": "2026-09-28T14:00:00Z",
    "seconds_remaining": 14400
  },
  "carbon_marketplace": {
    "is_active": false,
    "paused_flag": false,
    "until_timestamp": 0,
    "until_iso": null,
    "seconds_remaining": 0
  },
  "last_updated": "2026-09-27T10:00:00Z"
}
```

**Caching:** Response is cached for up to 30 seconds. Cache is invalidated on incoming pause/unpause events.

### 5.2 POST `/api/v1/pause/activate`

Activates the pause on one or both contracts. Requires JWT with admin scope.

**Request body:**

```json
{
  "contracts": ["carbon_credit", "carbon_marketplace"],
  "duration_hours": 6,
  "reason": "Suspected exploit in mint_credits — investigating serial number anomaly"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contracts` | `string[]` | Yes | One or both of `"carbon_credit"`, `"carbon_marketplace"` |
| `duration_hours` | `number` | Yes | Pause duration in hours. Must be between 0.016 (1 minute) and 72. |
| `reason` | `string` | Yes | Human-readable reason for the pause. Stored in the audit log. |

**Response 200:**

```json
{
  "success": true,
  "paused_contracts": ["carbon_credit", "carbon_marketplace"],
  "until_timestamp": 1790000000,
  "until_iso": "2026-09-28T14:00:00Z",
  "transaction_hashes": {
    "carbon_credit": "abc123...",
    "carbon_marketplace": "def456..."
  }
}
```

**Response 400:** Invalid `duration_hours` or unknown contract name.

**Response 401:** Missing or invalid JWT.

**Response 403:** JWT does not have admin scope.

### 5.3 POST `/api/v1/pause/deactivate`

Deactivates the pause on one or both contracts early. Requires JWT with admin scope.

**Request body:**

```json
{
  "contracts": ["carbon_credit"],
  "reason": "Investigation complete — no exploit confirmed"
}
```

**Response 200:**

```json
{
  "success": true,
  "unpaused_contracts": ["carbon_credit"],
  "transaction_hashes": {
    "carbon_credit": "ghi789..."
  }
}
```

### 5.4 GET `/api/v1/pause/audit-log`

Returns the full audit log of all pause activations and deactivations. Requires JWT with admin scope.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `contract` | `string` | all | Filter by contract name |
| `limit` | `number` | 50 | Max records per page |
| `offset` | `number` | 0 | Pagination offset |
| `from` | `ISO 8601` | – | Filter entries after this date |
| `to` | `ISO 8601` | – | Filter entries before this date |

**Response 200:**

```json
{
  "total": 12,
  "entries": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "event": "pause_activated",
      "contract": "carbon_credit",
      "admin_address": "GADMIN...",
      "reason": "Suspected exploit in mint_credits",
      "until_timestamp": 1790000000,
      "until_iso": "2026-09-28T14:00:00Z",
      "stellar_tx_hash": "abc123...",
      "created_at": "2026-09-27T08:00:00Z"
    }
  ]
}
```

---

## 6. Database Schema

> **Proposed.** Requires a new Prisma migration.

### 6.1 `pause_audit_log` Table

```sql
CREATE TABLE pause_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event           TEXT        NOT NULL CHECK (event IN ('pause_activated', 'pause_deactivated', 'pause_expired')),
  contract        TEXT        NOT NULL CHECK (contract IN ('carbon_credit', 'carbon_marketplace')),
  admin_address   TEXT        NOT NULL,
  reason          TEXT        NOT NULL,
  until_timestamp BIGINT,             -- NULL for deactivation and expiry events
  stellar_tx_hash TEXT        UNIQUE,  -- NULL for expiry (no explicit tx)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pal_contract    ON pause_audit_log(contract);
CREATE INDEX idx_pal_event       ON pause_audit_log(event);
CREATE INDEX idx_pal_created_at  ON pause_audit_log(created_at DESC);
```

### 6.2 Prisma Model

```prisma
model PauseAuditLog {
  id             String   @id @default(uuid())
  event          String   // "pause_activated" | "pause_deactivated" | "pause_expired"
  contract       String   // "carbon_credit" | "carbon_marketplace"
  adminAddress   String
  reason         String
  untilTimestamp BigInt?
  stellarTxHash  String?  @unique
  createdAt      DateTime @default(now())

  @@index([contract])
  @@index([event])
  @@index([createdAt(sort: Desc)])
  @@map("pause_audit_log")
}
```

---

## 7. UI/UX Requirements

> All UI components below are **Proposed**.

### 7.1 Pause Banner (All Users)

- Display a prominent, dismissible banner at the top of all pages when any contract is paused.
- Banner color: amber/warning (not red — red is for errors, not pauses).
- Content: which contracts are paused, expected resume time, link to status page.
- Dismissing the banner should not suppress it permanently — it should reappear on next page load or if the pause status changes.
- The banner should be screen-reader accessible (ARIA role `alert`).

**Example banner content:**

> ⚠️ **Credit contract operations temporarily paused** — Purchases, transfers, and retirements are unavailable until approximately 28 Sep 2026 14:00 UTC. [View status](#)

### 7.2 Paused Error Message (All Users)

- When a transaction fails with `ContractError(27)` or `ContractError(29)`, display a user-friendly error message instead of the raw contract error.
- Do not display "EmergencyPaused" or raw error codes to end users.
- Message should explain that operations are temporarily paused, confirm no funds were charged, and advise when to retry.

**Example message:**

> **Transactions temporarily unavailable.** The marketplace is undergoing maintenance. Your funds were not charged. Please try again once normal operations resume.

### 7.3 Admin Pause Control Panel (Admins Only)

- Located in the admin dashboard, gated by admin role.
- Displays:
  - Current pause status for each contract (with time remaining if active)
  - Activate pause form: contract selection, duration selector (1h / 6h / 12h / 24h / custom), reason text field
  - Deactivate button (with confirmation dialog)
  - Audit log table (paginated)
- The activate button requires a confirmation dialog with a summary of what will be paused and for how long.
- All actions should show a loading state and surface API errors clearly.

### 7.4 Accessibility Requirements

- All pause UI components must meet WCAG 2.1 AA.
- Banner uses `role="alert"` for screen reader announcement.
- Pause control panel is fully keyboard-navigable.
- Color is not the sole indicator of status (use icons and text alongside color).
- Focus management in confirmation dialogs follows ARIA authoring practices.

---

## 8. Security Considerations

### 8.1 Access Control

The pause is a privileged operation restricted to the **Admin** role. The authorization chain:

1. `admin.require_auth()` — Soroban protocol-level signature verification (cannot be bypassed).
2. Role check — `require_role(Admin)` in `carbon_credit` / `require_admin` in `carbon_marketplace` (second line of defense).

No other role can activate or deactivate the pause.

### 8.2 Bounded Duration

The 72-hour hard cap is enforced by the contract itself. No administrator — including a malicious one with valid credentials — can set a pause that exceeds this window without making a new call after the window expires. This guarantees that the platform can always recover within a bounded time.

### 8.3 Pause Cannot Block Pause

`pause_operations` and `unpause_operations` do not call `require_not_paused`. A paused contract can always be unpaused, and a running contract can always be paused — these operations are never mutually blocked.

### 8.4 Denial-of-Service Risk

A single-admin model creates a risk that a compromised key is used to continuously pause the contract. Mitigations:

- Monitoring and alerting on all pause invocations (see [Pause Security Review](pause-security-review.md)).
- Key rotation procedures documented in [KEY_ROTATION_PROCEDURES.md](KEY_ROTATION_PROCEDURES.md).
- Multisig governance recommended before mainnet (see [ADR-013](adr/ADR-013-emergency-pause.md)).

### 8.5 On-Chain Transparency

Every pause and unpause is a publicly visible Stellar transaction. There is no ability to pause secretly — all activations are permanently recorded on-chain and can be independently verified by any party.

For the full security analysis, see [Pause Security Review](pause-security-review.md).

---

## 9. Performance Requirements

### 9.1 Contract Layer

| Metric | Requirement |
|--------|-------------|
| Storage reads per gated call | ≤ 2 (PauseEnabled + PauseUntil) |
| Added latency per gated call | < 10 ms (unpaused path) |
| Gas overhead (unpaused) | 2 persistent reads = minimal fee increase |
| Gas overhead (auto-expiry clear) | 2 additional writes on first post-deadline call |

### 9.2 Backend API

| Endpoint | p50 | p99 |
|----------|-----|-----|
| GET /pause/status | < 30 ms | < 200 ms |
| POST /pause/activate | < 10 s | < 30 s |
| POST /pause/deactivate | < 10 s | < 30 s |
| GET /pause/audit-log | < 50 ms | < 300 ms |

The `/pause/status` response is cached for 30 seconds. Cache invalidation on event receipt reduces the stale window below 30 seconds in practice.

### 9.3 Frontend

| Metric | Requirement |
|--------|-------------|
| Time for banner to appear after pause activation | < 60 seconds |
| PauseStatus polling interval | 30 seconds (or WebSocket event-driven) |
| Admin panel load time | < 500 ms |

---

## 10. Testing Requirements

### 10.1 Contract Tests

| Test category | Scenarios |
|---------------|-----------|
| Unit: pause activation | Valid pause window, deadline at boundary, deadline too far, deadline in past, unauthorized caller |
| Unit: unpause | Early unpause, unpause of unpaused contract (idempotent), unauthorized caller |
| Unit: auto-expiry | Verify gated function succeeds after deadline, stale flag cleared |
| Unit: gated functions | Each gated function blocked while paused, each allowed when not paused |
| Integration | Both contracts independently paused and unpaused |

See [PAUSE_TESTING_GUIDE.md](PAUSE_TESTING_GUIDE.md) for the complete test matrix.

### 10.2 Backend Tests (Proposed)

- Unit tests for `PauseService` methods
- Integration tests for REST endpoints (including auth failure cases)
- Database tests for `PauseAuditLog` CRUD operations

### 10.3 Frontend Tests (Proposed)

- `PauseBanner` renders when pause is active, hidden when not active
- `PausedErrorMessage` displays on `ContractError(27)` and `ContractError(29)`
- Admin control panel renders correct state, confirmation dialog flow

### 10.4 End-to-End Tests (Proposed)

- Admin activates pause via UI, user receives paused error, admin deactivates, user retries successfully
- Pause auto-expires; banner disappears; operations resume

---

## 11. Rollout Plan

### Phase 1 — Contract Layer (Completed)

- [x] `pause_operations` and `unpause_operations` implemented in `carbon_credit` and `carbon_marketplace`
- [x] `require_not_paused` guard on all state-mutating functions
- [x] Unit and adversarial tests

### Phase 2 — Observability (Proposed)

- [ ] Contract events on pause/unpause (`FR-8`)
- [ ] `get_pause_status` public function (`FR-9`)
- [ ] Backend event listener for pause events

### Phase 3 — Backend API (Proposed)

- [ ] `PauseService` and REST endpoints (`FR-10`)
- [ ] `pause_audit_log` database table and migrations (`FR-11`)
- [ ] Admin JWT-gated pause/unpause endpoints

### Phase 4 — Frontend (Proposed)

- [ ] `PauseBanner` component (`FR-12`)
- [ ] `PausedErrorMessage` for failed transactions (`FR-13`)
- [ ] Admin pause control panel (`FR-14`)
- [ ] Accessibility audit

---

## 12. Related Documents

- [Pause FAQ](pause-faq.md) — Common questions for admins and users
- [Pause Contract API Reference](pause-contract-api.md) — Function signatures, parameters, and errors
- [Pause Security Review](pause-security-review.md) — Threat model and risk analysis
- [Pause Operations Guide](PAUSE_OPERATIONS_GUIDE.md) — Admin step-by-step runbook
- [Emergency Pause Runbook](runbooks/emergency-pause.md) — Incident response procedures
- [ADR-013: Emergency Pause Mechanism](adr/ADR-013-emergency-pause.md) — Architecture decision record
- [Pause Testing Guide](PAUSE_TESTING_GUIDE.md) — Test matrix and procedures
- [Pause Events](PAUSE_EVENTS.md) — Event definitions and indexer schema
- [Error Codes Reference](error-codes.md) — All contract error codes
