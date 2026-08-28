'use client';

/**
 * WalletContext — wraps useWalletConnection and exposes wallet state + actions
 * to the React tree.
 *
 * The context retains backward-compatible fields (isConnected, publicKey, network,
 * error) while also exposing the richer ConnectionStatus from the state machine.
 */

import React, { createContext, useContext } from 'react';
import { useWalletConnection, WalletConnectionState } from '../../hooks/useWalletConnection';
import { ConnectionStatus } from '../wallet-state-machine';
import { isSigningCancellation } from '../wallet-errors';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface WalletContextValue {
  // --- State machine fields ---
  /** Current state machine status */
  connectionStatus: ConnectionStatus;
  /** Full state machine state (useful for advanced consumers) */
  connectionState: WalletConnectionState;

  // --- Convenience / backward-compat fields ---
  isConnected: boolean;
  publicKey: string | null;
  network: string | null;
  /** Human-readable error, null when no error */
  error: string | null;

  // --- Actions ---
  connect: () => Promise<{ success: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  /** Retry after error / wrong network / account change */
  retry: () => Promise<void>;
  /** Hard-reset to disconnected — use on logout */
  reset: () => void;
  /** Re-check network manually */
  refreshNetwork: () => Promise<void>;

  // --- Legacy compat (kept so existing callers don't break) ---
  /** @deprecated Use connectionStatus === 'connected' instead */
  checkNetwork: () => Promise<{ isCorrect: boolean; currentNetwork: string | null }>;
  /** @deprecated Signing is outside wallet connection scope; use signTransaction from freighter.ts */
  signTransaction: (xdr: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { state, connect, disconnect, retry, reset, refreshNetwork } =
    useWalletConnection();

  // Legacy shim: checkNetwork (preserves interface for old callers)
  const checkNetwork = async (): Promise<{
    isCorrect: boolean;
    currentNetwork: string | null;
  }> => {
    await refreshNetwork();
    return {
      isCorrect: state.network === 'TESTNET',
      currentNetwork: state.network,
    };
  };

  // Legacy shim: signTransaction — callers should import signTransaction from
  // lib/freighter.ts directly, but we keep the method here so existing code compiles.
  const signTransaction = async (xdr: string): Promise<string | null> => {
    if (state.status !== 'connected') {
      console.warn('[WalletContext] signTransaction called while not connected');
      return null;
    }
    try {
      const { signTransaction: freighterSign } = await import('../freighter');
      return await freighterSign(xdr, state.network === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
    } catch (err) {
      // The user closing/declining the signing prompt is an expected action,
      // not a failure — return to the previous state without logging or
      // surfacing an error (see ErrorBoundary.getDerivedStateFromError).
      if (isSigningCancellation(err)) return null;
      console.error('[WalletContext] signTransaction error', err);
      return null;
    }
  };

  const connectWithResult = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await connect();
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connect failed";
      return { success: false, error: message };
    }
  };

  const value: WalletContextValue = {
    // State machine
    connectionStatus: state.status,
    connectionState: state,

    // Convenience fields
    isConnected: state.status === 'connected',
    publicKey: state.publicKey,
    network: state.network,
    error: state.errorMessage,

    // Actions
    connect: connectWithResult,
    disconnect,
    retry,
    reset,
    refreshNetwork,

    // Legacy
    checkNetwork,
    signTransaction,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
