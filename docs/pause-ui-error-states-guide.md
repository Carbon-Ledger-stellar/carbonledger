# Pause UI Error States & Resilience Specification

This document details error handling strategies, error classification, and recovery workflows across the CarbonLedger Pause UI components.

---

## Error Classification & Recovery Matrix

| Error Scenario | Technical Cause | User Display Message | Recovery Action |
| :--- | :--- | :--- | :--- |
| **Network Disruption** | RPC or HTTP 502/503 | "Unable to reach the Stellar RPC node or backend API." | Inline retry button with exponential backoff attempt counter. |
| **Permission Denied** | Connected wallet ≠ Admin address | "The connected account is not authorized to execute pause operations." | Prompt user to switch active wallet in Freighter extension. |
| **RPC Simulation Timeout** | Soroban horizon RPC latency > 10s | "The Soroban transaction simulation or submission took too long to complete." | Retries transaction status poll before re-invoking. |
| **Invalid State Transition** | Pause requested while already paused (or unpause while operational) | "The contract is already in the requested state." | Dashboard auto-refreshes to reflect current on-chain state. |
| **Exceeded Window** | Requested pause duration > 72 hours | "Invalid pause window: duration must be between 1 and 72 hours." | Input validation restricts dropdown to allowed values. |

---

## Resilience & Graceful Degradation Rules
1. **No Infinite Loops**: Retry buttons decrement a max attempts counter (default: 3) to prevent hammering RPC nodes.
2. **Read-Only Fallback**: If backend APIs fail, the frontend queries Soroban RPC directly to read contract storage keys (`DataKey::PauseEnabled`).
3. **Safe State Preservation**: If an error occurs during modal confirmation, user input (reason, duration) is preserved so the user does not need to retype their report.
