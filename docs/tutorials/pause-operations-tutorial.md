# API Tutorial: Integrating and Handling Contract Pauses

This tutorial guides backend developers and platform integrators on handling the CarbonLedger circuit-breaker and pause features in client applications.

---

## When Should a Contract Be Paused?
A contract pause is an emergency operational measure designed to halt state transitions when:
1. **Critical Exploits or Vulnerabilities**: An unexpected bug is identified in smart contract math or logic.
2. **Oracle Desynchronization**: Price feeds or carbon registry verification oracles report anomalous data.
3. **Database or Ledger Forking**: Discrepancies between off-chain database state and Stellar ledger records require quarantine.

---

## Handling the Paused State in Client Applications

When operations are paused:
- Read endpoints (`GET /projects`, `GET /retirements`) continue functioning normally.
- Write endpoints (`POST /orders/buy`, `POST /retirements/create`) return HTTP `409 Conflict` or HTTP `423 Locked` with error code `CONTRACT_PAUSED`.

---

## Code Examples Across 3 Languages

### 1. TypeScript / JavaScript
```typescript
import axios, { AxiosError } from 'axios';

const API_BASE = 'https://api.carbonledger.io/api/v1';

async function purchaseCreditsSafely(projectId: string, amount: number, authToken: string) {
  try {
    // 1. Check status first (recommended before high-value trades)
    const statusResp = await axios.get(`${API_BASE}/contract/status`);
    if (statusResp.data.isPaused) {
      console.warn(`[Blocked] CarbonLedger contract is paused until ${new Date(statusResp.data.pauseUntil * 1000).toISOString()}`);
      return { success: false, reason: 'CONTRACT_PAUSED', details: statusResp.data };
    }

    // 2. Attempt purchase
    const resp = await axios.post(
      `${API_BASE}/marketplace/purchase`,
      { projectId, amount },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    return { success: true, data: resp.data };
  } catch (err: any) {
    if (axios.isAxiosError(err) && (err.response?.status === 409 || err.response?.status === 423)) {
      console.error('[Error] Transaction rejected: contract emergency pause is active.');
      return { success: false, reason: 'CONTRACT_PAUSED_DURING_SUBMISSION' };
    }
    throw err;
  }
}
```

### 2. Python (3.9+)
```python
import requests
import sys

API_BASE = "https://api.carbonledger.io/api/v1"

def check_and_execute_retirement(user_token: str, certificate_id: str, amount: int):
    # Step 1: Pre-flight operational check
    status_resp = requests.get(f"{API_BASE}/contract/status", timeout=5)
    status_resp.raise_for_status()
    status_data = status_resp.json()

    if status_data.get("isPaused"):
        print(f"Cannot retire credits: contract is paused (Reason: {status_data.get('reason')})")
        return {"error": "CONTRACT_PAUSED", "status": status_data}

    # Step 2: Submit retirement request
    headers = {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}
    payload = {"certificateId": certificate_id, "amount": amount}

    resp = requests.post(f"{API_BASE}/retirements/execute", json=payload, headers=headers)
    if resp.status_code in (409, 423):
        print("Retirement failed: smart contract paused during submission window.")
        return {"error": "CONTRACT_PAUSED"}
    
    resp.raise_for_status()
    return resp.json()
```

### 3. Go (Golang 1.20+)
```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type ContractStatus struct {
	IsPaused   bool   `json:"isPaused"`
	Status     string `json:"status"`
	PauseUntil int64  `json:"pauseUntil"`
	Reason     string `json:"reason"`
}

func CheckContractStatus(apiBase string) (*ContractStatus, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(apiBase + "/api/v1/contract/status")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var status ContractStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, err
	}
	return &status, nil
}

func SubmitOrderWithPauseGuard(apiBase, token, projectId string, amount int) error {
	status, err := CheckContractStatus(apiBase)
	if err != nil {
		return fmt.Errorf("pre-flight check failed: %w", err)
	}

	if status.IsPaused {
		return fmt.Errorf("contract is paused until timestamp %d: %s", status.PauseUntil, status.Reason)
	}

	// Proceed with order submission...
	fmt.Println("Contract active. Submitting order for project", projectId)
	return nil
}
```
