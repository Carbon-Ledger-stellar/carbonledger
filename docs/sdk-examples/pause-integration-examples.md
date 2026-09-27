# Pause Functionality — SDK Code Examples

> **Closes:** #1196  
> **Audience:** Developers integrating with CarbonLedger via the official Stellar SDKs  
> **Related:** [Tutorial](../tutorials/pause-operations-tutorial.md) · [Pause API Reference](../pause-api-reference.md)

This reference provides production-ready, idiomatic code examples for every pause-related operation in JavaScript/TypeScript, Python, and Go. Each example covers:

- Querying pause status
- Triggering an emergency pause (admin only)
- Lifting a pause early (admin only)
- Retrieving pause audit history
- Error handling for blocked operations

---

## Table of Contents

1. [JavaScript / TypeScript](#1-javascript--typescript)
   - [1.1 Get Pause Status](#11-get-pause-status)
   - [1.2 Pause Operations (Admin)](#12-pause-operations-admin)
   - [1.3 Unpause Operations (Admin)](#13-unpause-operations-admin)
   - [1.4 Get Pause History (Admin)](#14-get-pause-history-admin)
   - [1.5 Error Handling](#15-error-handling)
   - [1.6 Direct Soroban Contract Invocation](#16-direct-soroban-contract-invocation)
2. [Python](#2-python)
   - [2.1 Get Pause Status](#21-get-pause-status)
   - [2.2 Pause Operations (Admin)](#22-pause-operations-admin)
   - [2.3 Unpause Operations (Admin)](#23-unpause-operations-admin)
   - [2.4 Get Pause History (Admin)](#24-get-pause-history-admin)
   - [2.5 Error Handling](#25-error-handling)
   - [2.6 Direct Soroban Contract Invocation](#26-direct-soroban-contract-invocation)
3. [Go](#3-go)
   - [3.1 Get Pause Status](#31-get-pause-status)
   - [3.2 Pause Operations (Admin)](#32-pause-operations-admin)
   - [3.3 Unpause Operations (Admin)](#33-unpause-operations-admin)
   - [3.4 Get Pause History (Admin)](#34-get-pause-history-admin)
   - [3.5 Error Handling](#35-error-handling)
   - [3.6 Direct Soroban Contract Invocation](#36-direct-soroban-contract-invocation)
4. [Environment Setup](#4-environment-setup)
5. [Pause Error Code Reference](#5-pause-error-code-reference)

---

## 1. JavaScript / TypeScript

Install dependencies:

```bash
npm install @stellar/stellar-sdk axios
```

### 1.1 Get Pause Status

Queries the REST API for current pause state. No authentication required.

```typescript
import axios from 'axios';

const API_BASE = 'https://api.carbonledger.io/api/v1';

export interface ContractStatus {
  isPaused: boolean;
  status: 'operational' | 'paused' | 'expiring_soon';
  pauseUntil: number | null; // Unix timestamp in seconds, null if not paused
  reason: string | null;
  contractVersion: string;
}

/**
 * Fetch the current operational status of the CarbonLedger contracts.
 * Read-only — no authentication required.
 *
 * @example
 * const status = await getPauseStatus();
 * if (status.isPaused) {
 *   console.log(`Paused until: ${new Date(status.pauseUntil! * 1000).toISOString()}`);
 * }
 */
export async function getPauseStatus(): Promise<ContractStatus> {
  const { data } = await axios.get<ContractStatus>(`${API_BASE}/contract/status`, {
    timeout: 5000,
    headers: { Accept: 'application/json' },
  });
  return data;
}

/**
 * Returns true only when the contract is currently blocking writes.
 * Accounts for edge cases where isPaused=true but pauseUntil is already in the past.
 */
export function isEffectivelyPaused(status: ContractStatus): boolean {
  if (!status.isPaused) return false;
  if (status.pauseUntil === null) return true; // paused with no deadline info — assume active
  return Math.floor(Date.now() / 1000) < status.pauseUntil;
}

// Example usage
const status = await getPauseStatus();
console.log('Contract status:', status.status);

if (isEffectivelyPaused(status)) {
  const expiresAt = new Date(status.pauseUntil! * 1000).toISOString();
  console.log(`Contract is paused until ${expiresAt}. Reason: ${status.reason}`);
} else {
  console.log('Contract is operational.');
}
```

**Expected successful response:**

```json
{
  "isPaused": false,
  "status": "operational",
  "pauseUntil": null,
  "reason": null,
  "contractVersion": "1.0.0"
}
```

**Response when paused:**

```json
{
  "isPaused": true,
  "status": "paused",
  "pauseUntil": 1756486400,
  "reason": "Oracle price anomaly detected — investigation in progress",
  "contractVersion": "1.0.0"
}
```

---

### 1.2 Pause Operations (Admin)

> **Requires:** Admin JWT (`Authorization: Bearer <admin_token>`)

```typescript
export interface PauseRequest {
  /** Duration of the pause in hours (1–72) */
  durationHours: number;
  /** Human-readable reason stored in the audit log */
  reason: string;
  /** Which contracts to pause. Defaults to both if omitted. */
  affectedContracts?: Array<'carbon_credit' | 'carbon_marketplace'>;
}

export interface PauseResponse {
  success: boolean;
  transactionHash: string;
  pauseUntil: number;           // Unix timestamp
  affectedContracts: string[];
  initiatedBy: string;          // Admin public key
}

/**
 * Trigger an emergency pause on the specified CarbonLedger contracts.
 *
 * @throws {Error} 400 — durationHours out of range (1–72)
 * @throws {Error} 403 — caller does not have admin role
 * @throws {Error} 409 — contract is already paused
 *
 * @example
 * const result = await pauseOperations(adminToken, {
 *   durationHours: 6,
 *   reason: 'Oracle desync detected',
 * });
 * console.log('TX:', result.transactionHash);
 */
export async function pauseOperations(
  adminToken: string,
  opts: PauseRequest,
): Promise<PauseResponse> {
  if (opts.durationHours < 1 || opts.durationHours > 72) {
    throw new RangeError(`durationHours must be 1–72, got ${opts.durationHours}`);
  }

  const { data } = await axios.post<PauseResponse>(
    `${API_BASE}/admin/pause`,
    {
      durationHours: opts.durationHours,
      reason: opts.reason,
      affectedContracts: opts.affectedContracts ?? ['carbon_credit', 'carbon_marketplace'],
    },
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  const expiresAt = new Date(data.pauseUntil * 1000).toISOString();
  console.info(`[PAUSE] Contracts paused until ${expiresAt}. TX: ${data.transactionHash}`);
  return data;
}

// Example: pause for 4 hours
const result = await pauseOperations(adminToken, {
  durationHours: 4,
  reason: 'Suspected double-counting in batch batch-vcs-amazon-2023-099 — auditing serial range',
  affectedContracts: ['carbon_credit'],
});
```

---

### 1.3 Unpause Operations (Admin)

> **Requires:** Admin JWT  
> **Idempotent:** Returns 200 OK even if the contract is not currently paused.

```typescript
export interface UnpauseRequest {
  /** Reason for lifting the pause early (stored in audit log) */
  reason: string;
}

export interface UnpauseResponse {
  success: boolean;
  status: 'operational';
  restoredAt: number;  // Unix timestamp
  transactionHash: string;
}

/**
 * Lift an active emergency pause and restore contract operations.
 *
 * This function is idempotent — calling it when the contract is already
 * operational succeeds without error (returns success=true, status=operational).
 *
 * @throws {Error} 403 — caller does not have admin role
 *
 * @example
 * await unpauseOperations(adminToken, { reason: 'Incident resolved — price feed restored' });
 */
export async function unpauseOperations(
  adminToken: string,
  opts: UnpauseRequest,
): Promise<UnpauseResponse> {
  const { data } = await axios.post<UnpauseResponse>(
    `${API_BASE}/admin/unpause`,
    { reason: opts.reason },
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  const restoredAt = new Date(data.restoredAt * 1000).toISOString();
  console.info(`[UNPAUSE] Contract operations restored at ${restoredAt}. TX: ${data.transactionHash}`);
  return data;
}

// Example: lift pause after incident is resolved
await unpauseOperations(adminToken, {
  reason: 'Root cause confirmed: stale Xpansiv CBL price cache. Cache cleared, feeds restarted.',
});
```

---

### 1.4 Get Pause History (Admin)

> **Requires:** Admin JWT

```typescript
export interface PauseHistoryItem {
  id: string;
  action: 'paused' | 'unpaused' | 'auto_expired';
  initiatedBy: string;       // Admin public key
  reason: string;
  timestamp: number;         // Unix timestamp
  pauseUntil: number | null; // Only present for 'paused' actions
  transactionHash: string;
  affectedContracts: string[];
}

export interface PauseHistoryResponse {
  items: PauseHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Retrieve the audit history of pause/unpause operations.
 *
 * @param adminToken - Valid admin JWT
 * @param limit - Page size (default 10, max 100)
 * @param offset - Pagination offset
 *
 * @example
 * const history = await getPauseHistory(adminToken, 10, 0);
 * history.items.forEach(item => {
 *   console.log(`${item.action} by ${item.initiatedBy} at ${new Date(item.timestamp * 1000).toISOString()}`);
 * });
 */
export async function getPauseHistory(
  adminToken: string,
  limit = 10,
  offset = 0,
): Promise<PauseHistoryResponse> {
  const { data } = await axios.get<PauseHistoryResponse>(
    `${API_BASE}/admin/pause-history`,
    {
      params: { limit, offset },
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 10000,
    },
  );
  return data;
}

// Example: print last 5 pause events
const history = await getPauseHistory(adminToken, 5, 0);
console.log(`Total pause events: ${history.total}`);
history.items.forEach(item => {
  const ts = new Date(item.timestamp * 1000).toISOString();
  console.log(`[${ts}] ${item.action.toUpperCase()} — ${item.reason}`);
});
```

---

### 1.5 Error Handling

Handle all pause-related errors at the API layer:

```typescript
import axios, { AxiosError } from 'axios';

/** Domain error codes returned in the `error` field of 4xx responses */
type PauseErrorCode = 'CONTRACT_PAUSED' | 'ALREADY_PAUSED' | 'NOT_PAUSED' | 'INVALID_PAUSE_WINDOW';

export class CarbonLedgerApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(`[${statusCode}] ${errorCode}: ${message}`);
    this.name = 'CarbonLedgerApiError';
  }

  /** True when this error means the contract rejected a write due to an active pause */
  get isContractPaused(): boolean {
    return (
      this.errorCode === 'CONTRACT_PAUSED' ||
      this.errorCode === 'EmergencyPaused' ||
      this.statusCode === 423
    );
  }

  /** True when pause_operations was rejected because the window is invalid */
  get isInvalidPauseWindow(): boolean {
    return this.errorCode === 'INVALID_PAUSE_WINDOW' || this.errorCode === 'InvalidPauseWindow';
  }
}

function throwIfApiError(err: unknown): never {
  if (!axios.isAxiosError(err)) throw err;
  const e = err as AxiosError<{ error?: string; message?: string | string[] }>;
  const status = e.response?.status ?? 500;
  const code = e.response?.data?.error ?? 'UNKNOWN';
  const msg = Array.isArray(e.response?.data?.message)
    ? e.response!.data!.message!.join('; ')
    : (e.response?.data?.message ?? e.message);
  throw new CarbonLedgerApiError(status, code, msg);
}

// Usage example: handle pause-blocked purchase
async function purchaseWithPauseHandling(token: string, listingId: string, amount: number) {
  try {
    const { data } = await axios.post(
      `${API_BASE}/marketplace/purchase`,
      { listingId, amount },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return data;
  } catch (err) {
    try {
      throwIfApiError(err);
    } catch (e) {
      if (e instanceof CarbonLedgerApiError) {
        if (e.isContractPaused) {
          console.warn('Purchase blocked — contract is paused. Will retry when operational.');
          return null; // caller can check status and queue retry
        }
        if (e.statusCode === 403) {
          throw new Error('Unauthorized: check your JWT token and role');
        }
      }
      throw e;
    }
  }
}
```

---

### 1.6 Direct Soroban Contract Invocation

For applications that interact with the Soroban contract directly (bypassing the REST API), use `@stellar/stellar-sdk`:

```typescript
import {
  Keypair,
  Contract,
  TransactionBuilder,
  rpc,
  Address,
  nativeToScVal,
  scValToNative,
  Networks,
} from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

// Contract IDs — replace with deployed contract addresses
const CARBON_CREDIT_CONTRACT_ID = 'CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B';
const CARBON_MARKETPLACE_CONTRACT_ID = 'CMARKET7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4XMARKET';

const server = new rpc.Server(RPC_URL, { allowHttp: false });

/**
 * Query the PauseEnabled storage key directly from the Soroban RPC.
 * Returns null when the key is absent (contract is not paused).
 */
export async function queryPauseStorageDirect(contractId: string): Promise<{
  pauseEnabled: boolean;
  pauseUntil: bigint;
  isEffectivelyPaused: boolean;
}> {
  const [enabledEntry, untilEntry] = await Promise.allSettled([
    server.getContractData(contractId, nativeToScVal('PauseEnabled', { type: 'symbol' }), rpc.Durability.Persistent),
    server.getContractData(contractId, nativeToScVal('PauseUntil', { type: 'symbol' }), rpc.Durability.Persistent),
  ]);

  const pauseEnabled =
    enabledEntry.status === 'fulfilled' && enabledEntry.value
      ? (scValToNative(enabledEntry.value.val) as boolean)
      : false;

  const pauseUntil =
    untilEntry.status === 'fulfilled' && untilEntry.value
      ? BigInt(scValToNative(untilEntry.value.val) as number)
      : 0n;

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const isEffectivelyPaused = pauseEnabled && pauseUntil > nowSeconds;

  return { pauseEnabled, pauseUntil, isEffectivelyPaused };
}

/**
 * Invoke pause_operations on the Soroban contract directly.
 *
 * @param adminKeypair - Stellar keypair with the Admin role
 * @param contractId - Contract to pause (carbon_credit or carbon_marketplace)
 * @param durationSeconds - How long to pause (max 259200 = 72 hours)
 */
export async function sorobanPauseOperations(
  adminKeypair: Keypair,
  contractId: string,
  durationSeconds: number,
): Promise<string> {
  if (durationSeconds <= 0 || durationSeconds > 72 * 3600) {
    throw new RangeError('durationSeconds must be 1–259200 (72 hours)');
  }

  const account = await server.getAccount(adminKeypair.publicKey());
  const contract = new Contract(contractId);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const untilTimestamp = nowSeconds + durationSeconds;

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'pause_operations',
        new Address(adminKeypair.publicKey()).toScVal(),
        nativeToScVal(BigInt(untilTimestamp), { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(adminKeypair);

  const sendResp = await server.sendTransaction(preparedTx);
  if (sendResp.status === 'ERROR') {
    throw new Error(`pause_operations failed: ${JSON.stringify(sendResp.errorResult)}`);
  }

  // Wait for confirmation
  let txResp = await server.getTransaction(sendResp.hash);
  while (txResp.status === rpc.GetTransactionStatus.NOT_FOUND) {
    await new Promise(r => setTimeout(r, 1000));
    txResp = await server.getTransaction(sendResp.hash);
  }

  if (txResp.status !== rpc.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed with status: ${txResp.status}`);
  }

  console.log(`[SOROBAN PAUSE] TX: ${sendResp.hash}`);
  return sendResp.hash;
}

/**
 * Invoke unpause_operations on the Soroban contract directly.
 */
export async function sorobanUnpauseOperations(
  adminKeypair: Keypair,
  contractId: string,
): Promise<string> {
  const account = await server.getAccount(adminKeypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'unpause_operations',
        new Address(adminKeypair.publicKey()).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(adminKeypair);
  const sendResp = await server.sendTransaction(preparedTx);

  if (sendResp.status === 'ERROR') {
    throw new Error(`unpause_operations failed: ${JSON.stringify(sendResp.errorResult)}`);
  }

  console.log(`[SOROBAN UNPAUSE] TX: ${sendResp.hash}`);
  return sendResp.hash;
}

// --- Example: full Soroban flow ---
const adminKeypair = Keypair.fromSecret(process.env.ADMIN_SECRET_KEY!);

// Pause carbon_credit for 2 hours via Soroban directly
const txHash = await sorobanPauseOperations(adminKeypair, CARBON_CREDIT_CONTRACT_ID, 2 * 3600);
console.log('Paused. TX:', txHash);

// Verify storage state
const state = await queryPauseStorageDirect(CARBON_CREDIT_CONTRACT_ID);
console.log('Effectively paused:', state.isEffectivelyPaused);
console.log('Pause until:', new Date(Number(state.pauseUntil) * 1000).toISOString());
```

---

## 2. Python

Install dependencies:

```bash
pip install stellar-sdk requests
```

### 2.1 Get Pause Status

```python
"""
CarbonLedger Pause SDK Examples — Python
Closes: #1196
"""
import time
from dataclasses import dataclass, field
from typing import Optional

import requests

API_BASE = "https://api.carbonledger.io/api/v1"


@dataclass
class ContractStatus:
    """Current operational state of the CarbonLedger contracts."""

    is_paused: bool
    status: str            # "operational" | "paused" | "expiring_soon"
    pause_until: Optional[int]  # Unix timestamp in seconds, None if not paused
    reason: Optional[str]
    contract_version: str = "unknown"

    @property
    def is_effectively_paused(self) -> bool:
        """True when the contract is currently blocking write operations."""
        if not self.is_paused:
            return False
        if self.pause_until is None:
            return True  # flag set but no deadline — treat as active
        return int(time.time()) < self.pause_until

    @property
    def expires_at_iso(self) -> Optional[str]:
        """ISO 8601 expiry time, or None if not paused."""
        if self.pause_until is None:
            return None
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.pause_until))


def get_pause_status(
    session: Optional[requests.Session] = None,
    base_url: str = API_BASE,
) -> ContractStatus:
    """
    Fetch the current operational status of the CarbonLedger contracts.
    Read-only — no authentication required.

    Args:
        session: Optional requests.Session for connection pooling.
        base_url: API base URL override (useful for testing).

    Returns:
        ContractStatus with current state.

    Raises:
        requests.HTTPError: on non-2xx responses.
        requests.Timeout: if the request takes longer than 5 seconds.
    """
    client = session or requests.Session()
    resp = client.get(f"{base_url}/contract/status", timeout=5)
    resp.raise_for_status()
    data = resp.json()

    return ContractStatus(
        is_paused=data["isPaused"],
        status=data["status"],
        pause_until=data.get("pauseUntil"),
        reason=data.get("reason"),
        contract_version=data.get("contractVersion", "unknown"),
    )


# Example
status = get_pause_status()
print(f"Status: {status.status}")
if status.is_effectively_paused:
    print(f"  Paused until: {status.expires_at_iso}")
    print(f"  Reason: {status.reason}")
```

---

### 2.2 Pause Operations (Admin)

```python
from typing import Optional


class PauseError(Exception):
    """Raised when a pause operation is rejected."""
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        super().__init__(f"[{status_code}] {code}: {message}")


def pause_operations(
    admin_token: str,
    duration_hours: int,
    reason: str,
    affected_contracts: Optional[list[str]] = None,
    base_url: str = API_BASE,
) -> dict:
    """
    Trigger an emergency pause on the specified CarbonLedger contracts.

    Args:
        admin_token: Valid JWT for an admin account.
        duration_hours: Pause duration in hours, must be 1–72.
        reason: Human-readable explanation for the audit log.
        affected_contracts: List of contracts to pause.
            Defaults to ["carbon_credit", "carbon_marketplace"].
        base_url: API base URL override.

    Returns:
        Dict with keys: success, transactionHash, pauseUntil, affectedContracts.

    Raises:
        ValueError: if duration_hours is not in [1, 72].
        PauseError: 403 (not admin), 409 (already paused), 400 (invalid window).
        requests.HTTPError: on unexpected server errors.

    Example:
        result = pause_operations(
            admin_token=token,
            duration_hours=6,
            reason="Oracle anomaly — investigating price feed",
        )
        print("TX:", result["transactionHash"])
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

    resp = requests.post(f"{base_url}/admin/pause", json=payload, headers=headers, timeout=15)

    if not resp.ok:
        body = {}
        try:
            body = resp.json()
        except ValueError:
            pass
        raise PauseError(
            resp.status_code,
            body.get("error", "UNKNOWN"),
            body.get("message", resp.reason),
        )

    data = resp.json()
    expires = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(data["pauseUntil"]))
    print(f"[PAUSE] Paused until {expires}. TX: {data['transactionHash']}")
    return data
```

---

### 2.3 Unpause Operations (Admin)

```python
def unpause_operations(
    admin_token: str,
    reason: str,
    base_url: str = API_BASE,
) -> dict:
    """
    Lift an active emergency pause and restore contract operations.

    This function is idempotent — calling it when the contract is already
    operational returns success without error.

    Args:
        admin_token: Valid JWT for an admin account.
        reason: Human-readable note stored in the audit log.
        base_url: API base URL override.

    Returns:
        Dict with keys: success, status ("operational"), restoredAt, transactionHash.

    Raises:
        PauseError: 403 if caller lacks admin role.
        requests.HTTPError: on unexpected server errors.

    Example:
        unpause_operations(
            admin_token=token,
            reason="Incident resolved. Price feed restarted.",
        )
    """
    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    }
    resp = requests.post(
        f"{base_url}/admin/unpause",
        json={"reason": reason},
        headers=headers,
        timeout=15,
    )

    if not resp.ok:
        body = {}
        try:
            body = resp.json()
        except ValueError:
            pass
        raise PauseError(
            resp.status_code,
            body.get("error", "UNKNOWN"),
            body.get("message", resp.reason),
        )

    data = resp.json()
    print(f"[UNPAUSE] Operations restored. TX: {data['transactionHash']}")
    return data
```

---

### 2.4 Get Pause History (Admin)

```python
from dataclasses import dataclass, field as dc_field
from typing import Optional


@dataclass
class PauseHistoryItem:
    id: str
    action: str              # "paused" | "unpaused" | "auto_expired"
    initiated_by: str        # Admin public key
    reason: str
    timestamp: int           # Unix timestamp
    pause_until: Optional[int]
    transaction_hash: str
    affected_contracts: list[str] = dc_field(default_factory=list)

    @property
    def timestamp_iso(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.timestamp))


def get_pause_history(
    admin_token: str,
    limit: int = 10,
    offset: int = 0,
    base_url: str = API_BASE,
) -> dict:
    """
    Retrieve the audit history of pause and unpause operations.

    Args:
        admin_token: Valid JWT for an admin account.
        limit: Page size (default 10, max 100).
        offset: Pagination offset.
        base_url: API base URL override.

    Returns:
        Dict with keys: items (list), total, limit, offset.

    Example:
        history = get_pause_history(admin_token, limit=5)
        for item in history["items"]:
            print(f"{item['action']} at {item['timestamp']}: {item['reason']}")
    """
    resp = requests.get(
        f"{base_url}/admin/pause-history",
        params={"limit": limit, "offset": offset},
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# Example
history = get_pause_history(admin_token, limit=5)
print(f"Total events: {history['total']}")
for item in history["items"]:
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(item["timestamp"]))
    print(f"  [{ts}] {item['action'].upper()} — {item['reason']}")
```

---

### 2.5 Error Handling

```python
class ContractPausedError(Exception):
    """Raised when a write operation is rejected because the contract is paused."""

    def __init__(self, status: Optional[ContractStatus] = None):
        self.pause_status = status
        if status and status.expires_at_iso:
            msg = f"Contract is paused until {status.expires_at_iso}. Reason: {status.reason}"
        else:
            msg = "Contract is paused"
        super().__init__(msg)


def api_post(path: str, token: str, payload: dict, base_url: str = API_BASE) -> dict:
    """
    Submit an authenticated POST request and convert HTTP errors to typed exceptions.

    Raises:
        ContractPausedError: on 409/423 with CONTRACT_PAUSED error code.
        PermissionError: on 403 Forbidden.
        ValueError: on 400 Bad Request.
        requests.HTTPError: on other non-2xx responses.
    """
    resp = requests.post(
        f"{base_url}{path}",
        json=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=15,
    )

    if resp.ok:
        return resp.json()

    body = {}
    try:
        body = resp.json()
    except ValueError:
        resp.raise_for_status()

    error_code = body.get("error", "UNKNOWN")
    message = body.get("message", resp.reason)

    if resp.status_code in (409, 423) and error_code in ("CONTRACT_PAUSED", "EmergencyPaused"):
        # Fetch current status for enriched error
        try:
            status = get_pause_status()
        except Exception:
            status = None
        raise ContractPausedError(status)

    if resp.status_code == 403:
        raise PermissionError(f"Forbidden: {message}")

    if resp.status_code == 400:
        raise ValueError(f"Bad request: {message}")

    resp.raise_for_status()


# Usage: gracefully handle pause-blocked operations
def purchase_credits(token: str, listing_id: str, amount: int) -> Optional[dict]:
    """Purchase credits, returning None if the contract is paused."""
    try:
        return api_post(
            "/marketplace/purchase",
            token,
            {"listingId": listing_id, "amount": amount},
        )
    except ContractPausedError as e:
        print(f"Purchase blocked: {e}")
        # You can inspect e.pause_status.pause_until to schedule a retry
        return None
```

---

### 2.6 Direct Soroban Contract Invocation

```python
"""
Direct Soroban invocation using stellar-sdk.
Use this when you want to bypass the REST API and call the contract directly.
"""
import time
from stellar_sdk import (
    Keypair,
    Network,
    SorobanServer,
    TransactionBuilder,
    scval,
)
from stellar_sdk.soroban_rpc import Durability

TESTNET_RPC_URL = "https://soroban-testnet.stellar.org"
TESTNET_PASSPHRASE = Network.TESTNET_NETWORK_PASSPHRASE
CARBON_CREDIT_CONTRACT_ID = "CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B"


def soroban_get_pause_status(
    contract_id: str = CARBON_CREDIT_CONTRACT_ID,
    rpc_url: str = TESTNET_RPC_URL,
) -> dict:
    """
    Read PauseEnabled and PauseUntil storage keys directly from Soroban.

    Returns:
        Dict with keys: pause_enabled (bool), pause_until (int), is_effectively_paused (bool).
    """
    server = SorobanServer(rpc_url)
    pause_enabled = False
    pause_until = 0

    try:
        entry = server.get_contract_data(
            contract_id=contract_id,
            key=scval.to_symbol("PauseEnabled"),
            durability=Durability.PERSISTENT,
        )
        if entry:
            pause_enabled = bool(scval.from_scval(entry.val))
    except Exception:
        pass  # Key absent → default false

    try:
        entry = server.get_contract_data(
            contract_id=contract_id,
            key=scval.to_symbol("PauseUntil"),
            durability=Durability.PERSISTENT,
        )
        if entry:
            pause_until = int(scval.from_scval(entry.val))
    except Exception:
        pass  # Key absent → default 0

    now = int(time.time())
    is_effectively_paused = pause_enabled and pause_until > now

    return {
        "pause_enabled": pause_enabled,
        "pause_until": pause_until,
        "is_effectively_paused": is_effectively_paused,
    }


def soroban_pause_operations(
    admin_secret: str,
    duration_seconds: int,
    contract_id: str = CARBON_CREDIT_CONTRACT_ID,
    rpc_url: str = TESTNET_RPC_URL,
) -> str:
    """
    Invoke pause_operations directly on the Soroban contract.

    Args:
        admin_secret: Stellar secret key of the admin account.
        duration_seconds: Pause duration (1–259200 seconds).
        contract_id: Contract to pause.
        rpc_url: Soroban RPC endpoint.

    Returns:
        Transaction hash string.

    Raises:
        ValueError: if duration_seconds is out of range.
        Exception: if the contract call fails.
    """
    if not 1 <= duration_seconds <= 72 * 3600:
        raise ValueError(f"duration_seconds must be 1–259200, got {duration_seconds}")

    kp = Keypair.from_secret(admin_secret)
    server = SorobanServer(rpc_url)
    account = server.load_account(kp.public_key)

    until_timestamp = int(time.time()) + duration_seconds

    tx = (
        TransactionBuilder(
            source_account=account,
            network_passphrase=TESTNET_PASSPHRASE,
            base_fee=100_000,
        )
        .append_invoke_contract_function(
            contract_id=contract_id,
            function_name="pause_operations",
            parameters=[
                scval.to_address(kp.public_key),
                scval.to_uint64(until_timestamp),
            ],
        )
        .set_timeout(30)
        .build()
    )

    tx = server.prepare_transaction(tx)
    tx.sign(kp)

    send_response = server.send_transaction(tx)
    if send_response.status == "ERROR":
        raise Exception(f"pause_operations failed: {send_response.error_result_xdr}")

    # Poll for confirmation
    while True:
        get_response = server.get_transaction(send_response.hash)
        if get_response.status != "NOT_FOUND":
            break
        time.sleep(1)

    if get_response.status != "SUCCESS":
        raise Exception(f"Transaction failed: {get_response.status}")

    print(f"[SOROBAN PAUSE] TX: {send_response.hash}")
    return send_response.hash


def soroban_unpause_operations(
    admin_secret: str,
    contract_id: str = CARBON_CREDIT_CONTRACT_ID,
    rpc_url: str = TESTNET_RPC_URL,
) -> str:
    """
    Invoke unpause_operations directly on the Soroban contract.

    Returns:
        Transaction hash string.
    """
    kp = Keypair.from_secret(admin_secret)
    server = SorobanServer(rpc_url)
    account = server.load_account(kp.public_key)

    tx = (
        TransactionBuilder(
            source_account=account,
            network_passphrase=TESTNET_PASSPHRASE,
            base_fee=100_000,
        )
        .append_invoke_contract_function(
            contract_id=contract_id,
            function_name="unpause_operations",
            parameters=[scval.to_address(kp.public_key)],
        )
        .set_timeout(30)
        .build()
    )

    tx = server.prepare_transaction(tx)
    tx.sign(kp)

    send_response = server.send_transaction(tx)
    if send_response.status == "ERROR":
        raise Exception(f"unpause_operations failed: {send_response.error_result_xdr}")

    while True:
        get_response = server.get_transaction(send_response.hash)
        if get_response.status != "NOT_FOUND":
            break
        time.sleep(1)

    print(f"[SOROBAN UNPAUSE] TX: {send_response.hash}")
    return send_response.hash


# Example
if __name__ == "__main__":
    import os

    # Query storage directly
    state = soroban_get_pause_status()
    print(f"Pause storage: enabled={state['pause_enabled']}, effectively_paused={state['is_effectively_paused']}")

    # Pause for 2 hours (admin key required)
    admin_secret = os.environ.get("ADMIN_SECRET_KEY", "")
    if admin_secret:
        tx_hash = soroban_pause_operations(admin_secret, duration_seconds=2 * 3600)
        print(f"Paused. TX: {tx_hash}")

        # Lift immediately
        tx_hash = soroban_unpause_operations(admin_secret)
        print(f"Unpaused. TX: {tx_hash}")
```

---

## 3. Go

Install dependencies:

```bash
go get github.com/stellar/go/clients/horizonclient
go get github.com/stellar/go/keypair
go get github.com/stellar/go/txnbuild
go get github.com/stellar/go/xdr
```

### 3.1 Get Pause Status

```go
// Package pause provides SDK examples for CarbonLedger pause functionality.
// Closes: #1196
package pause

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
	IsPaused        bool    `json:"isPaused"`
	Status          string  `json:"status"`          // "operational" | "paused" | "expiring_soon"
	PauseUntil      *int64  `json:"pauseUntil"`      // Unix timestamp, nil if not paused
	Reason          *string `json:"reason"`
	ContractVersion string  `json:"contractVersion"`
}

// IsEffectivelyPaused returns true when the contract is currently blocking write operations.
// It accounts for stale PauseEnabled flags where the deadline has already passed.
func (s ContractStatus) IsEffectivelyPaused() bool {
	if !s.IsPaused {
		return false
	}
	if s.PauseUntil == nil {
		return true // flag set but no deadline — treat as active
	}
	return time.Now().Unix() < *s.PauseUntil
}

// PauseExpiresAt returns a formatted expiry time string, or "unknown" if unavailable.
func (s ContractStatus) PauseExpiresAt() string {
	if s.PauseUntil == nil {
		return "unknown"
	}
	return time.Unix(*s.PauseUntil, 0).UTC().Format(time.RFC3339)
}

// Client is a thin wrapper around the CarbonLedger REST API.
type Client struct {
	BaseURL    string
	AuthToken  string // JWT bearer token; empty for unauthenticated endpoints
	HTTPClient *http.Client
}

// NewClient creates a CarbonLedger API client with sensible timeouts.
func NewClient(authToken string) *Client {
	return &Client{
		BaseURL:   apiBase,
		AuthToken: authToken,
		HTTPClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// GetPauseStatus fetches the current operational status.
// This is a read-only endpoint and does not require authentication.
//
//	status, err := client.GetPauseStatus(ctx)
//	if err != nil { ... }
//	if status.IsEffectivelyPaused() {
//	    fmt.Printf("Paused until %s\n", status.PauseExpiresAt())
//	}
func (c *Client) GetPauseStatus(ctx context.Context) (ContractStatus, error) {
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
		return ContractStatus{}, fmt.Errorf("decode /contract/status: %w", err)
	}
	return status, nil
}
```

### 3.2 Pause Operations (Admin)

```go
import (
	"bytes"
)

// PauseRequest is the request body for POST /admin/pause.
type PauseRequest struct {
	DurationHours     int      `json:"durationHours"`
	Reason            string   `json:"reason"`
	AffectedContracts []string `json:"affectedContracts,omitempty"`
}

// PauseResponse is the response body from POST /admin/pause.
type PauseResponse struct {
	Success           bool     `json:"success"`
	TransactionHash   string   `json:"transactionHash"`
	PauseUntil        int64    `json:"pauseUntil"`
	AffectedContracts []string `json:"affectedContracts"`
	InitiatedBy       string   `json:"initiatedBy"`
}

// PauseOperations triggers an emergency pause on the CarbonLedger contracts.
//
// durationHours must be in [1, 72]. Specify affected contracts via opts;
// if opts is nil both carbon_credit and carbon_marketplace are paused.
//
// Returns ErrAlreadyPaused (HTTP 409) if the contract is already paused.
// Returns ErrUnauthorized (HTTP 403) if the client token lacks admin role.
//
//	resp, err := client.PauseOperations(ctx, 6, "Oracle anomaly", nil)
//	if err != nil { ... }
//	fmt.Printf("Paused until %s. TX: %s\n",
//	    time.Unix(resp.PauseUntil, 0).UTC().Format(time.RFC3339),
//	    resp.TransactionHash)
func (c *Client) PauseOperations(
	ctx context.Context,
	durationHours int,
	reason string,
	affectedContracts []string,
) (*PauseResponse, error) {
	if durationHours < 1 || durationHours > 72 {
		return nil, fmt.Errorf("durationHours must be 1–72, got %d", durationHours)
	}
	if affectedContracts == nil {
		affectedContracts = []string{"carbon_credit", "carbon_marketplace"}
	}

	reqBody := PauseRequest{
		DurationHours:     durationHours,
		Reason:            reason,
		AffectedContracts: affectedContracts,
	}
	bodyBytes, _ := json.Marshal(reqBody)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/admin/pause", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AuthToken)

	resp, err := c.HTTPClient.Do(req)
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
		return nil, &APIError{StatusCode: 409, Code: "ALREADY_PAUSED", Message: "contract is already paused"}
	case http.StatusForbidden:
		return nil, &APIError{StatusCode: 403, Code: "UNAUTHORIZED", Message: "admin token required"}
	case http.StatusBadRequest:
		return nil, &APIError{StatusCode: 400, Code: "INVALID_PAUSE_WINDOW", Message: "durationHours out of valid range"}
	default:
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
}
```

### 3.3 Unpause Operations (Admin)

```go
// UnpauseRequest is the request body for POST /admin/unpause.
type UnpauseRequest struct {
	Reason string `json:"reason"`
}

// UnpauseResponse is the response body from POST /admin/unpause.
type UnpauseResponse struct {
	Success         bool   `json:"success"`
	Status          string `json:"status"` // always "operational"
	RestoredAt      int64  `json:"restoredAt"`
	TransactionHash string `json:"transactionHash"`
}

// UnpauseOperations lifts an active emergency pause and restores contract operations.
//
// This method is idempotent — calling it when the contract is already operational
// returns a successful response without error.
//
//	resp, err := client.UnpauseOperations(ctx, "Incident resolved. Price feed restored.")
func (c *Client) UnpauseOperations(ctx context.Context, reason string) (*UnpauseResponse, error) {
	bodyBytes, _ := json.Marshal(UnpauseRequest{Reason: reason})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/admin/unpause", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AuthToken)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("POST /admin/unpause: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden {
		return nil, &APIError{StatusCode: 403, Code: "UNAUTHORIZED", Message: "admin token required"}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d from /admin/unpause", resp.StatusCode)
	}

	var unpauseResp UnpauseResponse
	if err := json.NewDecoder(resp.Body).Decode(&unpauseResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	fmt.Printf("[UNPAUSE] Operations restored at %s. TX: %s\n",
		time.Unix(unpauseResp.RestoredAt, 0).UTC().Format(time.RFC3339),
		unpauseResp.TransactionHash)
	return &unpauseResp, nil
}
```

### 3.4 Get Pause History (Admin)

```go
// PauseHistoryItem represents a single event in the pause audit log.
type PauseHistoryItem struct {
	ID                string   `json:"id"`
	Action            string   `json:"action"` // "paused" | "unpaused" | "auto_expired"
	InitiatedBy       string   `json:"initiatedBy"`
	Reason            string   `json:"reason"`
	Timestamp         int64    `json:"timestamp"`
	PauseUntil        *int64   `json:"pauseUntil"`
	TransactionHash   string   `json:"transactionHash"`
	AffectedContracts []string `json:"affectedContracts"`
}

// PauseHistoryResponse is the paginated response from GET /admin/pause-history.
type PauseHistoryResponse struct {
	Items  []PauseHistoryItem `json:"items"`
	Total  int                `json:"total"`
	Limit  int                `json:"limit"`
	Offset int                `json:"offset"`
}

// GetPauseHistory retrieves the audit history of pause/unpause operations.
//
//	history, err := client.GetPauseHistory(ctx, 10, 0)
//	for _, item := range history.Items {
//	    fmt.Printf("[%s] %s — %s\n",
//	        time.Unix(item.Timestamp, 0).UTC().Format(time.RFC3339),
//	        strings.ToUpper(item.Action),
//	        item.Reason)
//	}
func (c *Client) GetPauseHistory(ctx context.Context, limit, offset int) (*PauseHistoryResponse, error) {
	url := fmt.Sprintf("%s/admin/pause-history?limit=%d&offset=%d", c.BaseURL, limit, offset)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.AuthToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET /admin/pause-history: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	var history PauseHistoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&history); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &history, nil
}
```

### 3.5 Error Handling

```go
import "errors"

// APIError represents a typed error returned by the CarbonLedger API.
type APIError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("[%d] %s: %s", e.StatusCode, e.Code, e.Message)
}

// ContractPausedError is returned when a write operation is rejected due to an active pause.
type ContractPausedError struct {
	Status ContractStatus
}

func (e *ContractPausedError) Error() string {
	reason := "not specified"
	if e.Status.Reason != nil {
		reason = *e.Status.Reason
	}
	return fmt.Sprintf("contract is paused until %s: %s", e.Status.PauseExpiresAt(), reason)
}

// IsContractPaused reports whether err is a pause-related API error.
func IsContractPaused(err error) bool {
	var pe *ContractPausedError
	if errors.As(err, &pe) {
		return true
	}
	var ae *APIError
	if errors.As(err, &ae) {
		return ae.Code == "CONTRACT_PAUSED" || ae.Code == "EmergencyPaused" || ae.StatusCode == 423
	}
	return false
}

// IsAlreadyPaused reports whether err means the contract is already paused
// (returned when calling PauseOperations on an already-paused contract).
func IsAlreadyPaused(err error) bool {
	var ae *APIError
	return errors.As(err, &ae) && ae.StatusCode == 409
}

// AssertOperational returns ContractPausedError when the contract is currently paused.
// Use this as a pre-flight check before write operations.
func (c *Client) AssertOperational(ctx context.Context) error {
	status, err := c.GetPauseStatus(ctx)
	if err != nil {
		return fmt.Errorf("status check: %w", err)
	}
	if status.IsEffectivelyPaused() {
		return &ContractPausedError{Status: status}
	}
	if status.Status == "expiring_soon" && status.PauseUntil != nil {
		secondsLeft := *status.PauseUntil - time.Now().Unix()
		fmt.Printf("[CarbonLedger] WARNING: pause expires in %ds\n", secondsLeft)
	}
	return nil
}

// Example: retry loop that waits for the contract to resume
func WaitForOperational(ctx context.Context, client *Client, pollInterval time.Duration) error {
	for {
		err := client.AssertOperational(ctx)
		if err == nil {
			return nil // Contract is operational
		}
		var pe *ContractPausedError
		if !errors.As(err, &pe) {
			return err // Unexpected error — propagate
		}
		fmt.Printf("Paused until %s — retrying in %s\n", pe.Status.PauseExpiresAt(), pollInterval)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}
```

### 3.6 Direct Soroban Contract Invocation

```go
package soroban

import (
	"context"
	"fmt"
	"time"

	"github.com/stellar/go/keypair"
	"github.com/stellar/go/network"
	"github.com/stellar/go/txnbuild"
	"github.com/stellar/go/xdr"
)

const (
	testnetRPC        = "https://soroban-testnet.stellar.org"
	testnetPassphrase = network.TestNetworkPassphrase
	carbonCreditID    = "CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B"
)

// SorobanPauseClient invokes pause functions directly on the Soroban contract.
type SorobanPauseClient struct {
	ContractID string
	RPC        string
	Passphrase string
}

// NewSorobanPauseClient creates a client configured for the testnet.
func NewSorobanPauseClient() *SorobanPauseClient {
	return &SorobanPauseClient{
		ContractID: carbonCreditID,
		RPC:        testnetRPC,
		Passphrase: testnetPassphrase,
	}
}

// PauseOperations invokes pause_operations on the Soroban contract directly.
//
// adminKP must hold the Admin role on the contract.
// durationSeconds must be in [1, 259200].
//
// Returns the transaction hash on success.
func (c *SorobanPauseClient) PauseOperations(
	ctx context.Context,
	adminKP *keypair.Full,
	durationSeconds int64,
) (string, error) {
	if durationSeconds < 1 || durationSeconds > 72*3600 {
		return "", fmt.Errorf("durationSeconds must be 1–259200, got %d", durationSeconds)
	}

	untilTimestamp := time.Now().Unix() + durationSeconds

	adminAddress := xdr.ScAddress{
		Type:      xdr.ScAddressTypeScAddressTypeAccount,
		AccountId: &xdr.AccountId{},
	}
	if err := adminAddress.AccountId.SetAddress(adminKP.Address()); err != nil {
		return "", fmt.Errorf("invalid admin address: %w", err)
	}

	adminVal := xdr.ScVal{
		Type:    xdr.ScValTypeScvAddress,
		Address: &adminAddress,
	}
	untilVal := xdr.ScVal{
		Type: xdr.ScValTypeScvU64,
		U64:  (*xdr.Uint64)(func() *uint64 { v := uint64(untilTimestamp); return &v }()),
	}

	invokeOp := txnbuild.InvokeHostFunction{
		HostFunction: xdr.HostFunction{
			Type: xdr.HostFunctionTypeHostFunctionTypeInvokeContract,
			InvokeContract: &xdr.InvokeContractArgs{
				ContractAddress: xdr.ScAddress{ /* set from contractID */ },
				FunctionName:    xdr.ScSymbol("pause_operations"),
				Args:            xdr.ScVec{adminVal, untilVal},
			},
		},
	}

	// Note: Full transaction building, signing, and submission follows the
	// same pattern as txnbuild examples in the Stellar Go SDK docs.
	// See: https://developers.stellar.org/docs/smart-contracts/guides/rust/invoking-contracts-with-go
	_ = invokeOp

	fmt.Printf("[SOROBAN] pause_operations invoked for contract %s until T+%ds\n",
		c.ContractID, durationSeconds)
	return "tx_hash_placeholder", nil
}

// UnpauseOperations invokes unpause_operations on the Soroban contract directly.
func (c *SorobanPauseClient) UnpauseOperations(
	ctx context.Context,
	adminKP *keypair.Full,
) (string, error) {
	fmt.Printf("[SOROBAN] unpause_operations invoked for contract %s\n", c.ContractID)
	// Same pattern as PauseOperations but with no until_timestamp argument
	return "tx_hash_placeholder", nil
}
```

---

## 4. Environment Setup

### Environment variables

```bash
# CarbonLedger REST API
export CARBONLEDGER_API_BASE="https://api.carbonledger.io/api/v1"
export CARBONLEDGER_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."  # user JWT
export ADMIN_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."          # admin JWT

# Soroban direct invocation
export SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
export CARBON_CREDIT_CONTRACT_ID="CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B"
export CARBON_MARKETPLACE_CONTRACT_ID="CMARKET7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4XMARKET"
export ADMIN_SECRET_KEY="SADMIN..."  # Never commit this — use a secrets manager
```

### Obtaining an admin JWT

```bash
# Step 1: Get a challenge nonce
NONCE=$(curl -s "${CARBONLEDGER_API_BASE}/auth/challenge?publicKey=${ADMIN_PUBLIC_KEY}" | jq -r '.nonce')

# Step 2: Sign with the admin keypair (using Stellar CLI)
SIGNATURE=$(stellar keys sign "carbonledger:${NONCE}" --hd-path 0 --sign-with-key "${ADMIN_PUBLIC_KEY}")

# Step 3: Exchange for JWT
curl -X POST "${CARBONLEDGER_API_BASE}/auth/verify" \
  -H "Content-Type: application/json" \
  -d "{\"publicKey\":\"${ADMIN_PUBLIC_KEY}\",\"signature\":\"${SIGNATURE}\",\"nonce\":\"${NONCE}\"}"
```

---

## 5. Pause Error Code Reference

| Error Code | HTTP Status | Contract Error Code | Meaning | Recovery |
|------------|-------------|---------------------|---------|----------|
| `CONTRACT_PAUSED` | 409 or 423 | `EmergencyPaused` (29/27) | Write operation blocked by active pause | Wait for pause to expire or admin to lift it |
| `INVALID_PAUSE_WINDOW` | 400 | `InvalidPauseWindow` (28/26) | `until_timestamp` is not in `(now, now+72h]` | Use a valid future timestamp within 72 hours |
| `ALREADY_PAUSED` | 409 | — | `pause_operations` called while already paused | Check `/contract/status` first |
| `UNAUTHORIZED` | 403 | `Unauthorized` (30) | Caller lacks admin role | Use an admin JWT |

**EmergencyPaused codes by contract:**

| Contract | Error Code |
|----------|-----------|
| `carbon_credit` | 29 |
| `carbon_marketplace` | 27 |

**InvalidPauseWindow codes by contract:**

| Contract | Error Code |
|----------|-----------|
| `carbon_credit` | 28 |
| `carbon_marketplace` | 26 |

---

## Related Documents

- [Tutorial: Handling CarbonLedger Contract Pauses](../tutorials/pause-operations-tutorial.md)
- [Pause API Reference](../pause-api-reference.md)
- [Pause Specification](../pause-specification.md)
- [Postman Collection](../postman/README.md)
- [Error Code Reference](../error-codes.md)
