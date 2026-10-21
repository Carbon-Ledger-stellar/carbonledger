# Tutorial: Handling CarbonLedger Contract Pauses

> **Audience:** Backend developers and platform integrators  
> **Closes:** #1195  
> **Related:** [Pause API Reference](../pause-api-reference.md) · [Pause Specification](../pause-specification.md)

This tutorial walks through the complete pause lifecycle from a client perspective — how to check whether a contract is paused, how to gracefully handle operations blocked by a pause, and (for admin users) how to trigger and lift an emergency pause.

---

## Table of Contents

1. [When Should a Contract Be Paused?](#1-when-should-a-contract-be-paused)
2. [Understanding Pause State](#2-understanding-pause-state)
3. [Checking Status Before Operations](#3-checking-status-before-operations)
4. [Handling Paused Errors at the API Layer](#4-handling-paused-errors-at-the-api-layer)
5. [Admin: Triggering an Emergency Pause](#5-admin-triggering-an-emergency-pause)
6. [Admin: Lifting a Pause Early](#6-admin-lifting-a-pause-early)
7. [Auto-Expiry and Idempotency](#7-auto-expiry-and-idempotency)
8. [Full Integration Scenario](#8-full-integration-scenario)

---

## 1. When Should a Contract Be Paused?

A contract pause is an **emergency circuit breaker**. It halts all state-mutating operations for a bounded window (up to 72 hours) while the root cause of an incident is investigated and resolved.

Common triggers that warrant a pause:

| Trigger | Reason |
|---------|--------|
| **Exploit or vulnerability** | An unexpected bug in contract math or logic is identified — pause prevents further damage while a fix is prepared. |
| **Oracle desynchronization** | Price feeds or carbon registry verification oracles report anomalous data that would cause incorrect credits to be minted or priced. |
| **Double-counting suspicion** | An off-chain audit detects a potential serial number overlap that needs on-chain investigation before new credits are minted. |
| **Ledger / database divergence** | Discrepancies between off-chain PostgreSQL state and Stellar ledger records require quarantine of write operations. |
| **Key compromise** | An admin or verifier key is believed to be compromised and write operations need to be halted while key rotation is coordinated. |

> **Important:** A pause is a blunt instrument. It blocks *all* write operations on the `carbon_credit` and `carbon_marketplace` contracts. Prefer targeted mitigations (e.g. suspending a single project via `suspend_project`) when the scope is narrower.

Read-only operations are **never blocked** by a pause. Users can still browse marketplace listings, look up credit batches, and retrieve retirement certificates while a pause is active.

---

## 2. Understanding Pause State

The CarbonLedger pause mechanism stores two values in Soroban persistent storage:

| Storage key | Type | Meaning |
|-------------|------|---------|
| `PauseEnabled` | `bool` | Whether the pause flag is set |
| `PauseUntil` | `u64` | Unix timestamp (seconds) when the pause auto-expires |

A contract is **effectively paused** only when both conditions are true:

```
is_effectively_paused = (PauseEnabled == true) AND (PauseUntil > current_ledger_timestamp)
```

If `PauseUntil` is in the past, the contract is no longer paused even if `PauseEnabled` is still `true` (a stale flag that will be cleared on the next write operation). When checking pause status from an off-chain client, always compare `pauseUntil` against the current time — do not rely on `isPaused` alone.

The REST API `/api/v1/contract/status` does this comparison for you and returns a single `isPaused` boolean that correctly accounts for expired pauses.

---

## 3. Checking Status Before Operations

For high-value or time-sensitive operations, check the contract status **before** submitting. This avoids wasting a transaction fee on a write that will be rejected.

### JavaScript / TypeScript

```typescript
import axios, { AxiosError } from 'axios';

const API_BASE = 'https://api.carbonledger.io/api/v1';

interface ContractStatus {
  isPaused: boolean;
  status: 'operational' | 'paused' | 'expiring_soon';
  pauseUntil: number | null; // Unix timestamp, null if not paused
  reason: string | null;
}

/**
 * Fetch current contract operational status.
 * This is a read-only endpoint — no auth required.
 */
async function getContractStatus(): Promise<ContractStatus> {
  const resp = await axios.get<ContractStatus>(`${API_BASE}/contract/status`, {
    timeout: 5000,
  });
  return resp.data;
}

/**
 * Check status before submitting a write operation.
 * Returns true if safe to proceed, false if paused.
 */
async function isContractOperational(): Promise<{ ok: boolean; reason?: string }> {
  const status = await getContractStatus();

  if (status.isPaused) {
    const expiresAt = status.pauseUntil
      ? new Date(status.pauseUntil * 1000).toISOString()
      : 'unknown';
    return {
      ok: false,
      reason: `Contract is paused until ${expiresAt}. Reason: ${status.reason ?? 'not specified'}`,
    };
  }

  // Warn if expiring soon (within 10 minutes) — in case we need to queue a follow-up
  if (status.status === 'expiring_soon' && status.pauseUntil) {
    const secondsLeft = status.pauseUntil - Math.floor(Date.now() / 1000);
    console.warn(`[CarbonLedger] Contract pause expires in ${secondsLeft}s`);
  }

  return { ok: true };
}

/**
 * Example: safely purchase credits with pre-flight status check.
 */
async function purchaseCreditsSafely(
  projectId: string,
  amount: number,
  authToken: string,
): Promise<{ success: boolean; data?: unknown; reason?: string }> {
  // Pre-flight: confirm contract is operational
  const { ok, reason } = await isContractOperational();
  if (!ok) {
    console.warn('[CarbonLedger] Purchase blocked —', reason);
    return { success: false, reason };
  }

  try {
    const resp = await axios.post(
      `${API_BASE}/marketplace/purchase`,
      { projectId, amount },
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    return { success: true, data: resp.data };
  } catch (err) {
    // Race condition: contract paused between our check and submission
    if (
      axios.isAxiosError(err) &&
      (err.response?.status === 409 || err.response?.status === 423)
    ) {
      const body = err.response.data as { error?: string };
      if (body.error === 'CONTRACT_PAUSED' || body.error === 'EmergencyPaused') {
        return { success: false, reason: 'Contract paused during submission — retry after pause lifts' };
      }
    }
    throw err;
  }
}
```

### Python (3.9+)

```python
import time
from dataclasses import dataclass
from typing import Optional

import requests

API_BASE = "https://api.carbonledger.io/api/v1"


@dataclass
class ContractStatus:
    is_paused: bool
    status: str          # "operational" | "paused" | "expiring_soon"
    pause_until: Optional[int]  # Unix timestamp or None
    reason: Optional[str]


class ContractPausedError(Exception):
    """Raised when an operation is rejected because the contract is paused."""

    def __init__(self, status: ContractStatus):
        self.status = status
        expires = (
            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(status.pause_until))
            if status.pause_until
            else "unknown"
        )
        super().__init__(
            f"Contract is paused until {expires}. Reason: {status.reason or 'not specified'}"
        )


def get_contract_status(session: Optional[requests.Session] = None) -> ContractStatus:
    """
    Fetch current contract operational status.
    Read-only — no auth required.
    """
    client = session or requests.Session()
    resp = client.get(f"{API_BASE}/contract/status", timeout=5)
    resp.raise_for_status()
    data = resp.json()

    return ContractStatus(
        is_paused=data["isPaused"],
        status=data["status"],
        pause_until=data.get("pauseUntil"),
        reason=data.get("reason"),
    )


def assert_contract_operational(session: Optional[requests.Session] = None) -> None:
    """
    Raise ContractPausedError if the contract is currently paused.
    Call this before any write operation.
    """
    status = get_contract_status(session)
    if status.is_paused:
        raise ContractPausedError(status)

    if status.status == "expiring_soon" and status.pause_until:
        seconds_left = status.pause_until - int(time.time())
        print(f"[CarbonLedger] WARNING: contract pause expires in {seconds_left}s")


def retire_credits_safely(
    token: str,
    batch_id: str,
    amount: int,
    beneficiary: str,
    session: Optional[requests.Session] = None,
) -> dict:
    """
    Retire credits with a pre-flight pause check.

    Raises:
        ContractPausedError: if the contract is paused before submission.
        requests.HTTPError: on unexpected HTTP errors.
    """
    client = session or requests.Session()

    # Pre-flight: confirm operational state
    assert_contract_operational(client)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "batchId": batch_id,
        "amount": amount,
        "beneficiary": beneficiary,
        "retirementReason": "Scope 1 emissions offset",
    }

    resp = client.post(
        f"{API_BASE}/credits/retire",
        json=payload,
        headers=headers,
        timeout=10,
    )

    # Handle race condition: pause activated between check and submission
    if resp.status_code in (409, 423):
        body = resp.json()
        if body.get("error") in ("CONTRACT_PAUSED", "EmergencyPaused"):
            # Re-fetch status to surface expiry info
            status = get_contract_status(client)
            raise ContractPausedError(status)

    resp.raise_for_status()
    return resp.json()


# Example usage
if __name__ == "__main__":
    import os

    token = os.environ["CARBONLEDGER_TOKEN"]
    try:
        result = retire_credits_safely(
            token=token,
            batch_id="batch-vcs-amazon-2023-001",
            amount=500,
            beneficiary="Acme Corp (ESG 2025)",
        )
        print("Retirement successful:", result["retirementId"])
    except ContractPausedError as e:
        print(f"Blocked: {e}")
        # Optionally queue for retry once pause lifts
```

### Go (1.21+)

```go
package carbonledger

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const apiBase = "https://api.carbonledger.io/api/v1"

// ContractStatus represents the current operational state of the CarbonLedger contracts.
type ContractStatus struct {
	IsPaused   bool    `json:"isPaused"`
	Status     string  `json:"status"`     // "operational" | "paused" | "expiring_soon"
	PauseUntil *int64  `json:"pauseUntil"` // Unix timestamp, nil if not paused
	Reason     *string `json:"reason"`
}

// IsEffectivelyPaused returns true when the contract is currently active-paused
// (i.e. the pause flag is set and the deadline has not yet passed).
func (s ContractStatus) IsEffectivelyPaused() bool {
	if !s.IsPaused {
		return false
	}
	if s.PauseUntil == nil {
		return true // paused with no expiry info — assume active
	}
	return time.Now().Unix() < *s.PauseUntil
}

// PauseExpiresAt returns a formatted expiry time, or "unknown" if unavailable.
func (s ContractStatus) PauseExpiresAt() string {
	if s.PauseUntil == nil {
		return "unknown"
	}
	return time.Unix(*s.PauseUntil, 0).UTC().Format(time.RFC3339)
}

// ContractPausedError is returned when an operation is rejected due to an active pause.
type ContractPausedError struct {
	Status ContractStatus
}

func (e *ContractPausedError) Error() string {
	reason := "not specified"
	if e.Status.Reason != nil {
		reason = *e.Status.Reason
	}
	return fmt.Sprintf("contract is paused until %s: %s",
		e.Status.PauseExpiresAt(), reason)
}

// Client is a thin wrapper around the CarbonLedger REST API.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	AuthToken  string // JWT bearer token (empty for unauthenticated calls)
}

// NewClient creates a CarbonLedger API client with sensible defaults.
func NewClient(authToken string) *Client {
	return &Client{
		BaseURL:   apiBase,
		AuthToken: authToken,
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// GetContractStatus fetches the current operational status.
// This is a read-only endpoint and does not require authentication.
func (c *Client) GetContractStatus(ctx context.Context) (ContractStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.BaseURL+"/contract/status", nil)
	if err != nil {
		return ContractStatus{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return ContractStatus{}, fmt.Errorf("GET /contract/status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ContractStatus{}, fmt.Errorf("unexpected status %d from /contract/status",
			resp.StatusCode)
	}

	var status ContractStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return ContractStatus{}, fmt.Errorf("decode response: %w", err)
	}
	return status, nil
}

// AssertOperational returns a *ContractPausedError if the contract is paused,
// or a transport/parse error if the status check itself fails.
func (c *Client) AssertOperational(ctx context.Context) error {
	status, err := c.GetContractStatus(ctx)
	if err != nil {
		return fmt.Errorf("status check failed: %w", err)
	}
	if status.IsEffectivelyPaused() {
		return &ContractPausedError{Status: status}
	}
	if status.Status == "expiring_soon" && status.PauseUntil != nil {
		secondsLeft := *status.PauseUntil - time.Now().Unix()
		fmt.Printf("[CarbonLedger] WARNING: contract pause expires in %ds\n", secondsLeft)
	}
	return nil
}

// RetireCreditsSafely checks operational status then retires credits.
// Returns *ContractPausedError if paused, or a wrapped HTTP/parse error otherwise.
func (c *Client) RetireCreditsSafely(ctx context.Context, batchID string, amount int,
	beneficiary, reason string) (map[string]interface{}, error) {

	// Pre-flight check
	if err := c.AssertOperational(ctx); err != nil {
		return nil, err
	}

	// Build request body
	body := map[string]interface{}{
		"batchId":         batchID,
		"amount":          amount,
		"beneficiary":     beneficiary,
		"retirementReason": reason,
	}
	// ... submit body via POST /api/v1/credits/retire and decode response
	// (full HTTP request omitted for brevity — follow the same pattern as GetContractStatus)
	_ = body
	return nil, nil
}
```

---

## 4. Handling Paused Errors at the API Layer

Even with a pre-flight check, a pause can be activated between your status check and your write request (race condition). Always handle pause errors defensively at the HTTP layer.

| HTTP Status | Error code in body | Meaning |
|-------------|-------------------|---------|
| `409 Conflict` | `CONTRACT_PAUSED` | Write operation rejected because the contract is paused |
| `423 Locked` | `CONTRACT_PAUSED` | Alternative status returned by some middleware configurations |

### JavaScript — Centralized error handler

```typescript
import axios, { AxiosError } from 'axios';

const API_BASE = 'https://api.carbonledger.io/api/v1';

type ApiErrorCode =
  | 'CONTRACT_PAUSED'
  | 'EmergencyPaused'
  | 'ALREADY_RETIRED'
  | 'INSUFFICIENT_CREDITS'
  | string;

class CarbonLedgerError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: ApiErrorCode,
    message: string,
  ) {
    super(`[${statusCode}] ${errorCode}: ${message}`);
    this.name = 'CarbonLedgerError';
  }

  get isPausedError(): boolean {
    return (
      this.errorCode === 'CONTRACT_PAUSED' ||
      this.errorCode === 'EmergencyPaused' ||
      this.statusCode === 423
    );
  }
}

function handleAxiosError(err: AxiosError): never {
  const status = err.response?.status ?? 500;
  const body = err.response?.data as Record<string, unknown>;
  const code = (body?.error as string) ?? 'UNKNOWN';
  const message = Array.isArray(body?.message)
    ? (body.message as string[]).join('; ')
    : (body?.message as string) ?? err.message;
  throw new CarbonLedgerError(status, code, message);
}

async function apiPost<T>(path: string, token: string, payload: unknown): Promise<T> {
  try {
    const resp = await axios.post<T>(`${API_BASE}${path}`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return resp.data;
  } catch (err) {
    if (axios.isAxiosError(err)) handleAxiosError(err);
    throw err;
  }
}

// Usage example
async function safeRetire(token: string, batchId: string, amount: number) {
  try {
    return await apiPost('/credits/retire', token, {
      batchId,
      amount,
      beneficiary: 'Acme Corp',
      retirementReason: 'ESG offset 2025',
    });
  } catch (err) {
    if (err instanceof CarbonLedgerError && err.isPausedError) {
      console.warn('Retirement blocked by contract pause. Will retry when operational.');
      // Schedule a retry, notify a queue, send a Slack alert, etc.
      return null;
    }
    throw err;
  }
}
```

### Python — Error handler with pause detection

```python
import requests


class CarbonLedgerError(Exception):
    def __init__(self, status_code: int, error_code: str, message):
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        super().__init__(f"[{status_code}] {error_code}: {message}")

    @property
    def is_paused_error(self) -> bool:
        return (
            self.error_code in ("CONTRACT_PAUSED", "EmergencyPaused")
            or self.status_code == 423
        )


def raise_for_carbon_error(resp: requests.Response) -> None:
    """
    Convert a non-2xx CarbonLedger response into a typed CarbonLedgerError.
    Call after every API request.
    """
    if resp.ok:
        return
    try:
        body = resp.json()
    except ValueError:
        resp.raise_for_status()

    error_code = body.get("error", "UNKNOWN")
    message = body.get("message", resp.reason)
    if isinstance(message, list):
        message = "; ".join(message)

    raise CarbonLedgerError(resp.status_code, error_code, message)


def retire_credits(token: str, batch_id: str, amount: int) -> dict:
    resp = requests.post(
        f"{API_BASE}/credits/retire",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "batchId": batch_id,
            "amount": amount,
            "beneficiary": "Acme Corp",
            "retirementReason": "ESG offset 2025",
        },
        timeout=10,
    )
    raise_for_carbon_error(resp)
    return resp.json()


# Usage
try:
    result = retire_credits(token, "batch-001", 100)
except CarbonLedgerError as e:
    if e.is_paused_error:
        print("Contract paused — queuing retirement for retry")
    else:
        raise
```

### Go — Typed error check

```go
import "errors"

// IsPausedError returns true when err is a ContractPausedError.
func IsPausedError(err error) bool {
    var pe *ContractPausedError
    return errors.As(err, &pe)
}

// Usage
_, err := client.RetireCreditsSafely(ctx, batchID, amount, beneficiary, reason)
if err != nil {
    if IsPausedError(err) {
        log.Printf("Contract paused — scheduling retry: %v", err)
        // enqueue retry job ...
        return nil
    }
    return fmt.Errorf("retire credits: %w", err)
}
```

---

## 5. Admin: Triggering an Emergency Pause

> **Required role:** `admin`  
> **Endpoint:** `POST /api/v1/admin/pause`

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `durationHours` | number | Yes | How many hours to pause (1–72) |
| `reason` | string | Yes | Human-readable explanation for the audit log |
| `affectedContracts` | string[] | No | Which contracts to pause: `["carbon_credit"]`, `["carbon_marketplace"]`, or both. Defaults to both. |

### JavaScript

```typescript
interface PauseRequest {
  durationHours: number;
  reason: string;
  affectedContracts?: Array<'carbon_credit' | 'carbon_marketplace'>;
}

interface PauseResponse {
  success: boolean;
  transactionHash: string;
  pauseUntil: number;  // Unix timestamp
  affectedContracts: string[];
}

async function triggerEmergencyPause(
  adminToken: string,
  opts: PauseRequest,
): Promise<PauseResponse> {
  if (opts.durationHours < 1 || opts.durationHours > 72) {
    throw new RangeError('durationHours must be between 1 and 72');
  }

  try {
    const resp = await axios.post<PauseResponse>(
      `${API_BASE}/admin/pause`,
      {
        durationHours: opts.durationHours,
        reason: opts.reason,
        affectedContracts: opts.affectedContracts ?? ['carbon_credit', 'carbon_marketplace'],
      },
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    console.log(`[PAUSE] Contracts paused until ${new Date(resp.data.pauseUntil * 1000).toISOString()}`);
    console.log(`[PAUSE] TX: ${resp.data.transactionHash}`);
    return resp.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 409) {
        console.warn('[PAUSE] Contract already paused — check /contract/status for current state');
      } else if (err.response?.status === 403) {
        throw new Error('Unauthorized: only admin accounts can pause the contract');
      }
    }
    throw err;
  }
}

// Example: pause for 6 hours due to oracle anomaly
await triggerEmergencyPause(adminToken, {
  durationHours: 6,
  reason: 'Oracle price feed reporting anomalous values — investigation in progress',
  affectedContracts: ['carbon_credit', 'carbon_marketplace'],
});
```

### Python

```python
import requests

def trigger_emergency_pause(
    admin_token: str,
    duration_hours: int,
    reason: str,
    affected_contracts: list[str] | None = None,
) -> dict:
    """
    Trigger an emergency pause of CarbonLedger contracts.

    Args:
        admin_token: Valid JWT for an admin account.
        duration_hours: Duration of the pause (1–72 hours).
        reason: Human-readable reason (stored in audit log).
        affected_contracts: Contracts to pause. Defaults to both.

    Returns:
        Dict with keys: success, transactionHash, pauseUntil, affectedContracts.

    Raises:
        ValueError: if duration_hours is out of range.
        requests.HTTPError: on HTTP errors (403 = not admin, 409 = already paused).
    """
    if not 1 <= duration_hours <= 72:
        raise ValueError(f"duration_hours must be 1–72, got {duration_hours}")

    payload = {
        "durationHours": duration_hours,
        "reason": reason,
        "affectedContracts": affected_contracts or ["carbon_credit", "carbon_marketplace"],
    }
    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    }

    resp = requests.post(
        f"{API_BASE}/admin/pause",
        json=payload,
        headers=headers,
        timeout=15,
    )

    if resp.status_code == 409:
        print("[PAUSE] Contract is already paused.")
        return resp.json()
    if resp.status_code == 403:
        raise PermissionError("Unauthorized: admin JWT required to pause the contract")

    resp.raise_for_status()
    data = resp.json()
    import time
    expires = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(data["pauseUntil"]))
    print(f"[PAUSE] Contracts paused until {expires}. TX: {data['transactionHash']}")
    return data


# Example
trigger_emergency_pause(
    admin_token=os.environ["ADMIN_TOKEN"],
    duration_hours=6,
    reason="Oracle price feed reporting anomalous values — investigation in progress",
)
```

### Go

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type PauseRequest struct {
	DurationHours     int      `json:"durationHours"`
	Reason            string   `json:"reason"`
	AffectedContracts []string `json:"affectedContracts,omitempty"`
}

type PauseResponse struct {
	Success           bool     `json:"success"`
	TransactionHash   string   `json:"transactionHash"`
	PauseUntil        int64    `json:"pauseUntil"`
	AffectedContracts []string `json:"affectedContracts"`
}

func TriggerEmergencyPause(
	ctx context.Context,
	adminToken string,
	durationHours int,
	reason string,
) (*PauseResponse, error) {
	if durationHours < 1 || durationHours > 72 {
		return nil, fmt.Errorf("durationHours must be 1–72, got %d", durationHours)
	}

	reqBody := PauseRequest{
		DurationHours:     durationHours,
		Reason:            reason,
		AffectedContracts: []string{"carbon_credit", "carbon_marketplace"},
	}
	bodyBytes, _ := json.Marshal(reqBody)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		apiBase+"/admin/pause", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("POST /admin/pause: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var pauseResp PauseResponse
		if err := json.NewDecoder(resp.Body).Decode(&pauseResp); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
		fmt.Printf("[PAUSE] Contracts paused until %s. TX: %s\n",
			time.Unix(pauseResp.PauseUntil, 0).UTC().Format(time.RFC3339),
			pauseResp.TransactionHash)
		return &pauseResp, nil
	case http.StatusConflict:
		return nil, fmt.Errorf("contract is already paused")
	case http.StatusForbidden:
		return nil, fmt.Errorf("unauthorized: admin token required")
	default:
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
}
```

---

## 6. Admin: Lifting a Pause Early

> **Required role:** `admin`  
> **Endpoint:** `POST /api/v1/admin/unpause`

The unpause operation is **idempotent** — calling it when the contract is already unpaused succeeds without error.

### JavaScript

```typescript
interface UnpauseResponse {
  success: boolean;
  status: 'operational';
  restoredAt: number; // Unix timestamp
}

async function liftEmergencyPause(adminToken: string, reason: string): Promise<UnpauseResponse> {
  const resp = await axios.post<UnpauseResponse>(
    `${API_BASE}/admin/unpause`,
    { reason },
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  console.log(`[UNPAUSE] Contract operations restored at ${new Date(resp.data.restoredAt * 1000).toISOString()}`);
  return resp.data;
}
```

### Python

```python
def lift_emergency_pause(admin_token: str, reason: str) -> dict:
    """
    Lift an active emergency pause and restore contract operations.
    This call is idempotent — safe to call even if not currently paused.
    """
    resp = requests.post(
        f"{API_BASE}/admin/unpause",
        json={"reason": reason},
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    print(f"[UNPAUSE] Contract operations restored.")
    return data
```

### Go

```go
func LiftEmergencyPause(ctx context.Context, adminToken, reason string) error {
    body, _ := json.Marshal(map[string]string{"reason": reason})
    req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
        apiBase+"/admin/unpause", bytes.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+adminToken)

    client := &http.Client{Timeout: 15 * time.Second}
    resp, err := client.Do(req)
    if err != nil {
        return fmt.Errorf("POST /admin/unpause: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("unpause failed with status %d", resp.StatusCode)
    }
    fmt.Println("[UNPAUSE] Contract operations restored.")
    return nil
}
```

---

## 7. Auto-Expiry and Idempotency

**Auto-expiry** means the contract automatically resumes operations when the `PauseUntil` timestamp passes — no admin action is required. The expiry is detected lazily: the first state-mutating call after the deadline will clear the pause flags and succeed.

**Implications for integrators:**
- Your retry loop can simply poll `/api/v1/contract/status` until `isPaused` is `false`, then resubmit.
- Do not hard-code a sleep for the full pause duration — the admin may lift the pause early.
- A 30-second polling interval is appropriate for most integrations; reduce to 5 seconds for time-sensitive systems.

**Idempotency:**
- `POST /admin/pause` returns `409 Conflict` if the contract is already paused.
- `POST /admin/unpause` always returns `200 OK` whether or not the contract was paused.

### Polling-based retry (JavaScript)

```typescript
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_WAIT_MS = 3 * 60 * 60 * 1000; // 3 hours max wait

async function retryWhenOperational<T>(
  operation: () => Promise<T>,
  label = 'operation',
): Promise<T> {
  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const { ok, reason } = await isContractOperational();
    if (ok) {
      return operation();
    }
    console.log(`[${label}] Paused — retrying in ${POLL_INTERVAL_MS / 1000}s. ${reason}`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`[${label}] Gave up waiting for contract to resume after 3 hours`);
}

// Usage
const result = await retryWhenOperational(
  () => purchaseCreditsSafely('proj-001', 100, token),
  'purchase',
);
```

---

## 8. Full Integration Scenario

This scenario walks through a complete pause incident as seen by both an admin and an end-user integrator.

### Timeline

```
T+0:00  Admin detects anomalous oracle prices — triggers 6-hour pause
T+0:01  All write operations on carbon_credit and carbon_marketplace start returning 409/423
T+0:01  Integrators' pre-flight checks detect isPaused=true and stop submissions
T+1:30  Root cause identified — stale price cache, not an exploit
T+1:31  Admin lifts pause early via POST /admin/unpause
T+1:31  isPaused flips to false; write operations resume immediately
T+1:32  Integrators' retry loops detect operational state and resubmit queued operations
```

### Admin script (Python)

```python
import os
import time
import requests

ADMIN_TOKEN = os.environ["ADMIN_TOKEN"]


def incident_pause(reason: str, duration_hours: int = 6) -> dict:
    """Pause contracts and log to incident response system."""
    data = trigger_emergency_pause(ADMIN_TOKEN, duration_hours, reason)
    # Log to PagerDuty, Slack, etc.
    print(f"INCIDENT: Contracts paused. TX={data['transactionHash']}")
    return data


def incident_resolve(resolution_note: str) -> None:
    """Lift pause and record resolution."""
    lift_emergency_pause(ADMIN_TOKEN, resolution_note)
    print(f"RESOLVED: Contract operations restored. Note: {resolution_note}")


# On-call admin response
incident_pause(
    reason="Oracle price anomaly detected at T+0 — pausing while investigating",
    duration_hours=6,
)

# ... investigate ...
time.sleep(5400)  # 90 minutes later

incident_resolve(
    "Root cause: stale Xpansiv CBL price cache. Cache cleared and price feed restarted."
)
```

### Integrator retry loop (Go)

```go
func main() {
    client := NewClient(os.Getenv("CARBONLEDGER_TOKEN"))
    ctx := context.Background()

    for {
        err := client.AssertOperational(ctx)
        if err == nil {
            break // Contract is operational — proceed with queued work
        }
        var pe *ContractPausedError
        if !errors.As(err, &pe) {
            log.Fatalf("Unexpected error checking status: %v", err)
        }
        log.Printf("Paused until %s — waiting 30s before retry", pe.Status.PauseExpiresAt())
        time.Sleep(30 * time.Second)
    }

    // Process queued retirements, purchases, etc.
    log.Println("Contract operational — processing queue")
}
```

---

## Related Documents

- [Pause API Reference](../pause-api-reference.md) — Complete function signatures and error codes
- [Pause Specification](../pause-specification.md) — Design decisions, state model, and rationale  
- [SDK Code Examples](../sdk-examples/pause-integration-examples.md) — Direct Soroban contract invocation examples
- [Postman Collection](../postman/README.md) — Import and test all 4 pause endpoints
- [Pause Operations Guide](../PAUSE_OPERATIONS_GUIDE.md) — Operator runbook for incident response
- [Error Code Reference](../error-codes.md) — All contract error codes
