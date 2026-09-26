# Admin Dashboard Pause Controls User Guide

This guide covers operating the CarbonLedger administrative pause controls from the Web Admin Dashboard.

## Overview
The Pause System provides emergency circuit breaker controls allowing designated administrator keyholders to halt state-mutating actions on Soroban smart contracts (such as token minting, transfers, and carbon credit retirements).

## Dashboard Navigation
1. Navigate to `/admin/contracts` in your browser.
2. Connect your administrative wallet (Freighter wallet with admin credentials).
3. The **Emergency Controls & Pause** panel will be displayed at the top of the interface.

## UI Elements
- **Status Indicator**: Displays whether contracts are currently `Active` or `Paused`. Includes countdown if an automatic expiration window is active.
- **Emergency Pause Button**: Opens the confirmation modal to execute a pause.
- **Resume Operations Button**: Available when the contract is in a paused state to resume normal operations immediately.

## Initiating an Emergency Pause
1. Click **Emergency Pause**.
2. Select the **Pause Duration Window**:
   - `1 Hour`: Brief maintenance or testing.
   - `6 Hours`: Incident triage.
   - `24 Hours`: Standard investigation window.
   - `72 Hours`: Maximum allowed window (hard contract limit).
3. Enter a mandatory **Incident Reason**:
   - Must be descriptive (e.g. `Investigating duplicate transaction ID issue`).
   - This reason is emitted in the audit trail.
4. Acknowledge the confirmation checkbox.
5. Click **Execute Pause** and sign the transaction with your Freighter administrative wallet.

## Resuming Normal Operations
1. Click **Resume Operations**.
2. Review the incident summary and past reason.
3. Confirm unpause and sign the Soroban transaction.
4. Once confirmed on Stellar testnet/mainnet, the status indicator will transition back to `Contract Active`.

## Keyboard Shortcuts
- `Esc`: Closes any open confirmation dialog.
- `Tab`: Navigates between focusable elements within the modal.
- `Enter`: Submits the confirmation dialog when focus is on the action button.

## Troubleshooting
- **Transaction Failed / Signature Rejected**: Ensure the active connected wallet matches the admin address stored in contract storage.
- **Contract already paused**: If another administrator has paused the contract, the UI updates automatically via WebSocket events.
