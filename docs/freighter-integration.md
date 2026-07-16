# Freighter Wallet Integration

> **File:** `frontend/lib/freighter.ts`  
> **Dependency:** `@stellar/freighter-api`

Freighter is a browser extension wallet for Stellar. CarbonLedger uses it to connect user accounts, sign purchase transactions, and sign retirement transactions — all without the app ever touching a private key.

---

## Connection Flow

```
isConnected()
    │
    ├─ false → throw WALLET_NOT_INSTALLED
    │
    └─ true
         │
         isAllowed()
             │
             ├─ false → setAllowed()
             │              │
             │              ├─ denied → throw WALLET_PERMISSION_DENIED
             │              └─ granted ──┐
             │                           │
             └─ true ────────────────────┘
                                         │
                                    getPublicKey()
                                         │
                                    returns publicKey (G...)
```

**Functions involved:**

| Step | Function | Description |
|------|----------|-------------|
| 1 | `isFreighterInstalled()` | Checks if the extension is present |
| 2 | `isFreighterConnected()` | Checks if the site is already allowed |
| 3 | `connectFreighter()` | Runs the full flow above, returns public key |
| 4 | `getPublicKey()` | Fetches the active account's public key |

---

## Transaction Signing Flow

All on-chain actions (purchase, retirement) follow the same pattern:

```
Backend / Soroban SDK
        │
        │  builds unsigned XDR transaction
        ▼
  signTransaction(xdr, network)
        │
        │  Freighter shows approval popup to user
        │
        ├─ User rejects → throw TRANSACTION_REJECTED
        │
        └─ User approves
                │
                returns signedTxXdr
                │
        Submit to Stellar network via stellar-sdk
```

### Purchase flow

```
1. User clicks "Buy Credits"
2. Backend builds XDR: marketplace.purchase_credits(listing_id, amount, usdc_amount)
3. signTransaction(xdr, "TESTNET") → Freighter popup
4. User sees: "Approve transfer of X USDC to seller"
5. Signed XDR submitted → credits transferred to buyer
```

### Retirement flow

```
1. User clicks "Retire Credits"
2. Backend builds XDR: carbon_credit.retire_credits(batch_id, amount, beneficiary, reason)
3. signTransaction(xdr, "TESTNET") → Freighter popup
4. User sees: "Approve permanent retirement of X carbon credits"
5. Signed XDR submitted → credits permanently retired, certificate issued
```

> **Note for corporate buyers:** Retirement is irreversible on-chain. Once you approve the Freighter popup, the credits cannot be un-retired. The certificate is issued immediately after the transaction confirms.

---

## Error Codes

Errors thrown by `freighter.ts` use string codes that map to user-facing messages in `lib/wallet-errors.ts`.

| Error Code | When it occurs | User-facing message |
|------------|---------------|---------------------|
| `WALLET_NOT_INSTALLED` | Freighter extension not detected | "Freighter wallet is not installed. Please install it from freighter.app to continue." |
| `WALLET_PERMISSION_DENIED` | User dismissed the connection popup | "Permission denied. Please allow CarbonLedger to connect to your Freighter wallet." |
| `WRONG_NETWORK` | Wallet is on mainnet but app expects testnet (or vice versa) | "Your wallet is connected to the wrong network. Please switch to Stellar Testnet in Freighter." |
| `TRANSACTION_REJECTED` | User clicked Reject in the signing popup | "Transaction was rejected. Please try again or contact support if the issue persists." |
| `INSUFFICIENT_XLM` | Account has no XLM for fees | "Insufficient XLM balance to cover transaction fees. Please add XLM to your account." |
| `ACCOUNT_NOT_ACTIVATED` | Account has never been funded | "Your Stellar account is not activated. You need a minimum of 1 XLM to activate it." |
| `UNKNOWN` | Any other Freighter API error | "An unexpected error occurred. Please try again." |

Use `getWalletErrorMessage(error)` to convert any caught error into a display string, and `isWalletError(error, code)` to branch on a specific code.

---

## Testnet vs Mainnet

`checkNetwork()` reads the network passphrase from Freighter and returns `"TESTNET"` or `"PUBLIC"`.

| Passphrase contains | Returned value |
|---------------------|---------------|
| `"Test SDF"` | `"TESTNET"` |
| anything else | `"PUBLIC"` |

`switchToTestnet()` throws `WRONG_NETWORK` if the wallet is not already on testnet — it does not switch automatically, because Freighter requires the user to change networks manually in the extension settings.

**To switch networks in Freighter:**
1. Open the Freighter extension
2. Click the network name in the top-right corner
3. Select **Test SDF Network / Testnet**

All `signTransaction()` calls pass the expected network explicitly. If the wallet's active network does not match, Freighter will reject the signing request.

---

## `WatchWalletChanges`

Re-exported from `@stellar/freighter-api`. Use this to subscribe to account or network changes so the UI can react when the user switches accounts or networks inside Freighter without reloading the page.

```ts
import { WatchWalletChanges } from "@/lib/freighter";

WatchWalletChanges(3000).watch(({ address, network }) => {
  // update app state when wallet changes
});
```
