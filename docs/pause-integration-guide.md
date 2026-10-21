# Client Application Pause Integration Guide

This guide is designed for frontend and backend engineers integrating with CarbonLedger who need to handle contract pauses gracefully.

---

## 1. Architectural Patterns: Polling vs WebSockets

To keep client applications synchronized with contract operational state, choose between two primary ingestion patterns:

### Option A: WebSocket Real-Time Subscription (Recommended for SPAs)
Subscribe to the CarbonLedger real-time event channel:
```typescript
import { io } from 'socket.io-client';

const socket = io('https://api.carbonledger.io/events', {
  transports: ['websocket'],
});

socket.on('contract.paused', (event) => {
  console.warn('Emergency pause activated:', event.reason);
  dispatch({ type: 'SET_CONTRACT_PAUSED', payload: event });
});

socket.on('contract.unpaused', (event) => {
  console.info('Contract operations resumed');
  dispatch({ type: 'SET_CONTRACT_OPERATIONAL', payload: event });
});
```

### Option B: HTTP Polling with Exponential Jitter
If WebSocket connections are not supported in your runtime (e.g. serverless functions or edge workers), poll the status endpoint:
```typescript
async function pollPauseStatus(intervalMs = 30000) {
  setInterval(async () => {
    try {
      const res = await fetch('https://api.carbonledger.io/api/v1/contract/status');
      const data = await res.json();
      updateLocalPauseState(data.isPaused, data.pauseUntil);
    } catch (err) {
      console.error('Failed to poll status', err);
    }
  }, intervalMs);
}
```

---

## 2. Defensive Pre-Flight Validation

Before initiating high-value transactions (such as retiring 10,000 tonnes of carbon credits or placing orders), check the local status cache to prevent unnecessary user gas expenditures:

```typescript
export async function executeRetirementWithGuard(
  userSigner: any,
  batchId: string,
  amount: number
) {
  const isPaused = checkCachedPauseStatus();
  if (isPaused) {
    throw new Error('Action Aborted: CarbonLedger contracts are currently paused.');
  }

  return submitRetirementTransaction(userSigner, batchId, amount);
}
```

---

## 3. Testing Strategies
- **Mocking Pause State in Unit Tests**: Set environment variable `MOCK_CONTRACT_PAUSED=true` or intercept `/api/v1/contract/status` responses with MSW (Mock Service Worker).
- **Testnet Verification**: Connect to testnet and use the testnet admin faucet to trigger temporary 1-hour pauses.

---

## 4. Common Issues & Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| UI shows active, but transaction reverts with error 29 | Stale local status cache | Ensure status cache TTL does not exceed 30 seconds, or listen for WebSocket notifications. |
| Automatic unpause did not occur | Expiration reached on-chain, but indexer hasn't processed latest ledger | Status API auto-calculates `now() >= pauseUntil` and resolves to operational even before next block. |
| Admin unable to unpause | Connected address is not the contract admin | Verify address matches `admin` field in contract data. |
