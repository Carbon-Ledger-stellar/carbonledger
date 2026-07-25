/**
 * Freighter Wallet Connection State Machine
 *
 * States:
 *   disconnected → connecting → connected → (disconnected | error)
 *                               connected → network_switch (user prompted)
 *                               connected → account_changed (state invalidated)
 *   error        → connecting  (retry / recovery)
 *
 * All state transitions are explicit; there are no implicit/direct field mutations.
 */

import {
  connectFreighter,
  isFreighterInstalled,
  isFreighterConnected,
  isWrongNetwork,
  checkNetwork,
  FreighterNetwork,
} from "./freighter";
import { getWalletErrorMessage, WalletErrorCode } from "./wallet-errors";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "network_switch"   // connected but wrong network — user must act
  | "account_changed"; // connected address changed — re-verify

export interface WalletConnectionState {
  status: ConnectionStatus;
  publicKey: string | null;
  network: FreighterNetwork | null;
  /** Human-readable error message (non-null only when status === "error") */
  errorMessage: string | null;
  /** The raw error code, useful for programmatic handling */
  errorCode: WalletErrorCode | null;
  /** Timestamp of the last successful connection (ms since epoch) */
  connectedAt: number | null;
}

// ---------------------------------------------------------------------------
// Transition events
// ---------------------------------------------------------------------------

export type WalletEvent =
  | { type: "CONNECT" }
  | { type: "CONNECT_SUCCESS"; publicKey: string; network: FreighterNetwork }
  | { type: "CONNECT_FAILURE"; errorCode: WalletErrorCode; errorMessage: string }
  | { type: "DISCONNECT" }
  | { type: "NETWORK_CHANGED"; network: FreighterNetwork }
  | { type: "ACCOUNT_CHANGED"; publicKey: string }
  | { type: "RETRY" }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const INITIAL_STATE: WalletConnectionState = {
  status: "disconnected",
  publicKey: null,
  network: null,
  errorMessage: null,
  errorCode: null,
  connectedAt: null,
};

// ---------------------------------------------------------------------------
// Pure reducer — maps (state, event) → next state
// ---------------------------------------------------------------------------

export function walletReducer(
  state: WalletConnectionState,
  event: WalletEvent,
): WalletConnectionState {
  switch (event.type) {
    case "CONNECT": {
      // Only allow connecting from disconnected or error
      if (state.status === "disconnected" || state.status === "error") {
        return { ...INITIAL_STATE, status: "connecting" };
      }
      return state;
    }

    case "CONNECT_SUCCESS": {
      if (state.status === "connecting") {
        return {
          status: "connected",
          publicKey: event.publicKey,
          network: event.network,
          errorMessage: null,
          errorCode: null,
          connectedAt: Date.now(),
        };
      }
      return state;
    }

    case "CONNECT_FAILURE": {
      if (state.status === "connecting") {
        return {
          ...state,
          status: "error",
          errorMessage: event.errorMessage,
          errorCode: event.errorCode,
        };
      }
      return state;
    }

    case "DISCONNECT": {
      return { ...INITIAL_STATE, status: "disconnected" };
    }

    case "NETWORK_CHANGED": {
      if (state.status === "connected" || state.status === "network_switch") {
        // If the user has switched to the correct network, move back to connected
        if (event.network === "TESTNET") {
          return { ...state, status: "connected", network: event.network, errorMessage: null, errorCode: null };
        }
        // Wrong network — prompt the user
        return {
          ...state,
          status: "network_switch",
          network: event.network,
          errorMessage: getWalletErrorMessage("WRONG_NETWORK"),
          errorCode: "WRONG_NETWORK",
        };
      }
      return state;
    }

    case "ACCOUNT_CHANGED": {
      if (state.status === "connected" || state.status === "account_changed") {
        // Invalidate state — surface the new key but require re-validation
        return {
          ...state,
          status: "account_changed",
          publicKey: event.publicKey,
          errorMessage: "Wallet account changed. Please reconnect to continue.",
          errorCode: null,
          connectedAt: null,
        };
      }
      return state;
    }

    case "RETRY": {
      // Allow retry from error, network_switch, or account_changed
      if (
        state.status === "error" ||
        state.status === "network_switch" ||
        state.status === "account_changed"
      ) {
        return { ...INITIAL_STATE, status: "connecting" };
      }
      return state;
    }

    case "RESET": {
      return { ...INITIAL_STATE };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Guard helpers — check whether a transition is valid from a given state
// ---------------------------------------------------------------------------

export function canConnect(status: ConnectionStatus): boolean {
  return status === "disconnected" || status === "error";
}

export function canRetry(status: ConnectionStatus): boolean {
  return (
    status === "error" ||
    status === "network_switch" ||
    status === "account_changed"
  );
}

export function isTerminal(status: ConnectionStatus): boolean {
  return status === "disconnected";
}

// ---------------------------------------------------------------------------
// Async connection orchestrator
// Wraps the side-effectful Freighter API calls and fires reducer events.
// Returns the resulting state so callers can react synchronously.
// ---------------------------------------------------------------------------

export type Dispatch = (event: WalletEvent) => void;

export async function performConnect(dispatch: Dispatch): Promise<void> {
  dispatch({ type: "CONNECT" });

  try {
    const installed = await isFreighterInstalled();
    if (!installed) {
      dispatch({
        type: "CONNECT_FAILURE",
        errorCode: "WALLET_NOT_INSTALLED",
        errorMessage: getWalletErrorMessage("WALLET_NOT_INSTALLED"),
      });
      return;
    }

    const publicKey = await connectFreighter();

    let network: FreighterNetwork = "TESTNET";
    try {
      network = await checkNetwork();
    } catch {
      // checkNetwork failure is non-fatal at connect time; default to TESTNET
    }

    if (network !== "TESTNET") {
      // Connected but on wrong network — emit success first so publicKey is captured,
      // then immediately emit network change so the machine lands in network_switch.
      dispatch({ type: "CONNECT_SUCCESS", publicKey, network });
      dispatch({ type: "NETWORK_CHANGED", network });
      return;
    }

    dispatch({ type: "CONNECT_SUCCESS", publicKey, network });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const knownCodes: WalletErrorCode[] = [
      "WALLET_NOT_INSTALLED",
      "WALLET_PERMISSION_DENIED",
      "WRONG_NETWORK",
      "TRANSACTION_REJECTED",
      "INSUFFICIENT_XLM",
      "ACCOUNT_NOT_ACTIVATED",
    ];
    const code: WalletErrorCode = knownCodes.includes(msg as WalletErrorCode)
      ? (msg as WalletErrorCode)
      : "UNKNOWN";

    dispatch({
      type: "CONNECT_FAILURE",
      errorCode: code,
      errorMessage: getWalletErrorMessage(code),
    });
  }
}

export async function performDisconnect(dispatch: Dispatch): Promise<void> {
  dispatch({ type: "DISCONNECT" });
}

export async function performNetworkCheck(dispatch: Dispatch): Promise<void> {
  try {
    const wrong = await isWrongNetwork();
    const network = wrong ? "PUBLIC" : ("TESTNET" as FreighterNetwork);
    dispatch({ type: "NETWORK_CHANGED", network });
  } catch {
    // Swallow — network check failures are surfaced elsewhere
  }
}
