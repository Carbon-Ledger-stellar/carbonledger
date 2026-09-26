# Pause Error Codes & Remediation Reference

This document provides a comprehensive reference of all error codes associated with the CarbonLedger emergency circuit-breaker and pause mechanisms across smart contracts, backend APIs, and client SDKs.

---

## 1. Soroban Smart Contract Error Codes

When interacting directly with the Soroban smart contract, failures emit custom `CarbonError` enum values.

| Contract Error Name | Code (u32) | Trigger Condition | Remediation Step |
| :--- | :--- | :--- | :--- |
| `InvalidPauseWindow` | `28` | Admin specified duration of `0` or greater than `72 hours` (259,200 seconds) | Ensure `until_timestamp` is between `now + 60` and `now + 259200`. |
| `EmergencyPaused` | `29` | A user attempted a state-mutating operation (`transfer`, `mint_credits`, `retire_credits`, `list_credits`) while pause is active | Await administrative unpause or automatic expiration; check status via `/api/v1/contract/status`. |
| `Unauthorized` | `1` | A non-admin account attempted to invoke `pause_operations` or `unpause_operations` | Ensure the invoking account matches the designated admin address in contract persistent storage. |
| `AlreadyPaused` | `30` | `pause_operations` was invoked when contract is already active in a paused window | Review existing pause window or wait for expiration before renewing. |
| `NotPaused` | `31` | `unpause_operations` was invoked on a contract that is currently active | No unpause required; the contract is already operational. |

---

## 2. Backend REST API Error Responses

When invoking CarbonLedger REST endpoints, errors follow the standard RFC 7807 problem details specification.

### 409 Conflict: `CONTRACT_PAUSED`
Returned by write endpoints when a transaction cannot be accepted because the contract is paused.

**HTTP Status**: `409 Conflict`  
**Error Payload**:
```json
{
  "statusCode": 409,
  "errorCode": "CONTRACT_PAUSED",
  "message": "Transaction rejected: smart contract operations are currently suspended.",
  "details": {
    "contractId": "CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B",
    "pausedUntil": 1727295330,
    "reason": "Scheduled security inspection"
  },
  "timestamp": "2026-09-24T20:30:00.000Z",
  "path": "/api/v1/marketplace/purchase"
}
```
**Remediation**: Client applications should notify the user that trading is temporarily suspended and retry once the countdown reaches zero.

---

### 400 Bad Request: `INVALID_PAUSE_DURATION`
Returned when an administrator submits an invalid duration.

**HTTP Status**: `400 Bad Request`  
**Error Payload**:
```json
{
  "statusCode": 400,
  "errorCode": "INVALID_PAUSE_DURATION",
  "message": "Pause duration must be between 1 and 72 hours.",
  "timestamp": "2026-09-24T20:30:00.000Z",
  "path": "/api/v1/admin/pause"
}
```
**Remediation**: Adjust `durationHours` to a value between `1` and `72`.

---

### 403 Forbidden: `ADMIN_ROLE_REQUIRED`
Returned when an unprivileged user attempts an administrative pause or unpause.

**HTTP Status**: `403 Forbidden`  
**Error Payload**:
```json
{
  "statusCode": 403,
  "errorCode": "ADMIN_ROLE_REQUIRED",
  "message": "Only verified administrative signers are permitted to modify contract operational state.",
  "timestamp": "2026-09-24T20:30:00.000Z",
  "path": "/api/v1/admin/pause"
}
```
**Remediation**: Ensure the caller's JWT bears the `ROLE_SUPER_ADMIN` or `ROLE_COMPLIANCE_ADMIN` claim.

---

### 503 Service Unavailable: `SOROBAN_RPC_UNAVAILABLE`
Returned when the backend cannot query or broadcast transactions to the Stellar Horizon/Soroban RPC.

**HTTP Status**: `503 Service Unavailable`  
**Error Payload**:
```json
{
  "statusCode": 503,
  "errorCode": "SOROBAN_RPC_UNAVAILABLE",
  "message": "Unable to communicate with the Stellar network RPC node.",
  "timestamp": "2026-09-24T20:30:00.000Z",
  "path": "/api/v1/contract/status"
}
```
**Remediation**: Check network status at `https://dashboard.stellar.org` and retry with exponential backoff.
