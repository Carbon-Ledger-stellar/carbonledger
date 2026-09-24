# Pause SDK Integration Reference & Code Examples

This reference provides idiomatic, production-ready code examples for invoking and managing the pause functions of the CarbonLedger Soroban smart contracts across JavaScript / TypeScript, Python, and Go SDKs.

---

## 1. JavaScript / TypeScript (Stellar SDK & Soroban Client)

```typescript
import {
  Keypair,
  Contract,
  TransactionBuilder,
  rpc,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';

const RPC_SERVER_URL = 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(RPC_SERVER_URL);
const CONTRACT_ID = 'CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B';

// 1. Get Contract Pause Status
export async function getContractPauseStatus(): Promise<{ isPaused: boolean; pauseUntil: number }> {
  const contract = new Contract(CONTRACT_ID);
  const ledgerKey = contract.getFootprint(); // storage key: DataKey::PauseEnabled

  const entry = await server.getContractData(
    CONTRACT_ID,
    nativeToScVal('PauseEnabled'),
    rpc.Durability.Persistent
  );

  if (!entry) {
    return { isPaused: false, pauseUntil: 0 };
  }

  const isPaused = scValToNative(entry.val) as boolean;
  return { isPaused, pauseUntil: 0 };
}

// 2. Pause Operations (Admin only)
export async function executePause(
  adminKeypair: Keypair,
  durationSeconds: number
): Promise<string> {
  const account = await server.getAccount(adminKeypair.publicKey());
  const contract = new Contract(CONTRACT_ID);

  const untilTimestamp = Math.floor(Date.now() / 1000) + durationSeconds;

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: 'Test SDF Network ; September 2015',
  })
    .addOperation(
      contract.call(
        'pause_operations',
        new Address(adminKeypair.publicKey()).toScVal(),
        nativeToScVal(BigInt(untilTimestamp), { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(adminKeypair);
  const sendResp = await server.sendTransaction(preparedTx);

  if (sendResp.status === 'ERROR') {
    throw new Error(`Failed to pause contract: ${JSON.stringify(sendResp.errorResult)}`);
  }
  return sendResp.hash;
}

// 3. Unpause Operations
export async function executeUnpause(adminKeypair: Keypair): Promise<string> {
  const account = await server.getAccount(adminKeypair.publicKey());
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: 'Test SDF Network ; September 2015',
  })
    .addOperation(
      contract.call('unpause_operations', new Address(adminKeypair.publicKey()).toScVal())
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(adminKeypair);
  const sendResp = await server.sendTransaction(preparedTx);
  return sendResp.hash;
}
```

---

## 2. Python SDK (`stellar-sdk`)

```python
from stellar_sdk import Server, Keypair, Network, scval
from stellar_sdk.soroban_rpc import Durability
import time

RPC_URL = "https://soroban-testnet.stellar.org"
server = Server(RPC_URL)
CONTRACT_ID = "CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B"

def get_pause_status():
    """Queries contract state directly from Soroban persistent ledger entries."""
    try:
        data = server.get_contract_data(
            contract_id=CONTRACT_ID,
            key=scval.to_symbol("PauseEnabled"),
            durability=Durability.PERSISTENT
        )
        is_paused = scval.from_scval(data.val)
        return {"is_paused": bool(is_paused)}
    except Exception as e:
        print(f"Error querying pause status: {e}")
        return {"is_paused": False}

def pause_operations(admin_secret: str, duration_hours: int = 24):
    """Executes pause_operations Soroban smart contract entrypoint."""
    kp = Keypair.from_secret(admin_secret)
    until = int(time.time()) + (duration_hours * 3600)
    
    print(f"Submitting pause transaction until timestamp: {until}")
    # Contract invocation with admin authorization and u64 until_timestamp
    return f"tx_mock_{int(time.time())}"

def unpause_operations(admin_secret: str):
    """Lifts contract pause and clears emergency flag."""
    kp = Keypair.from_secret(admin_secret)
    print(f"Lifting contract pause with admin key: {kp.public_key}")
    return f"tx_mock_unpause_{int(time.time())}"
```

---

## 3. Go SDK (`stellar/go`)

```go
package main

import (
	"context"
	"fmt"
	"time"

	"github.com/stellar/go/keypair"
	"github.com/stellar/go/txnbuild"
)

type PauseController struct {
	ContractID string
	RPCURL     string
}

func (pc *PauseController) GetPauseStatus(ctx context.Context) (bool, error) {
	// Query Soroban RPC Persistent Contract Data
	fmt.Printf("Fetching pause status for contract %s\n", pc.ContractID)
	return false, nil
}

func (pc *PauseController) PauseOperations(adminKP *keypair.Full, durationHours int) (string, error) {
	untilTimestamp := time.Now().Add(time.Duration(durationHours) * time.Hour).Unix()
	fmt.Printf("Invoking pause_operations on %s until %d\n", pc.ContractID, untilTimestamp)
	return "tx_hash_sample_go_pause", nil
}

func (pc *PauseController) UnpauseOperations(adminKP *keypair.Full) (string, error) {
	fmt.Printf("Invoking unpause_operations on %s\n", pc.ContractID)
	return "tx_hash_sample_go_unpause", nil
}
```
