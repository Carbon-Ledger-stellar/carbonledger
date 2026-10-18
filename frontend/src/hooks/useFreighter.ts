import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isConnected as freighterIsConnected,
  getPublicKey,
  signTransaction,
} from '@stellar/freighter-api';

export type FreighterStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface FreighterState {
  publicKey: string | null;
  status: FreighterStatus;
  error: string | null;
}

export interface SignResult {
  signedXdr: string | null;
  error: string | null;
  disconnected: boolean;
}

const DISCONNECT_ERROR =
  'Freighter wallet was disconnected or locked during signing. Reconnect your wallet and try again.';

/**
 * Hook wrapping Freighter wallet connection and transaction signing.
 *
 * Detects wallet disconnect/lock events during signing so callers can move
 * out of an indefinite loading state into a recoverable error, then reconnect
 * and retry without losing form input.
 */
export function useFreighter() {
  const [state, setState] = useState<FreighterState>({
    publicKey: null,
    status: 'idle',
    error: null,
  });

  // Track whether a signing operation is in flight so disconnect events can be
  // surfaced as a recoverable signing error rather than a silent state change.
  const signingRef = useRef(false);

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'connecting', error: null }));
    try {
      const connected = await freighterIsConnected();
      if (!connected) {
        setState({ publicKey: null, status: 'disconnected', error: null });
        return null;
      }
      const publicKey = await getPublicKey();
      if (!publicKey) {
        setState({ publicKey: null, status: 'disconnected', error: null });
        return null;
      }
      setState({ publicKey, status: 'connected', error: null });
      return publicKey;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to connect to Freighter.';
      setState({ publicKey: null, status: 'error', error: message });
      return null;
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({ publicKey: null, status: 'disconnected', error: null });
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  /**
   * Sign a transaction XDR. Returns a structured result so callers can render a
   * recoverable error and retry without discarding form input.
   */
  const sign = useCallback(
    async (xdr: string, network?: string): Promise<SignResult> => {
      signingRef.current = true;
      try {
        // Verify the wallet is still connected before attempting to sign.
        const connected = await freighterIsConnected();
        if (!connected) {
          setState({
            publicKey: null,
            status: 'disconnected',
            error: DISCONNECT_ERROR,
          });
          return { signedXdr: null, error: DISCONNECT_ERROR, disconnected: true };
        }

        const signedXdr = await signTransaction(xdr, {
          network: network as never,
        });

        if (!signedXdr) {
          setState((prev) => ({ ...prev, error: DISCONNECT_ERROR }));
          return { signedXdr: null, error: DISCONNECT_ERROR, disconnected: true };
        }

        return { signedXdr, error: null, disconnected: false };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Transaction signing failed.';
        const disconnected = /disconnect|lock|not connected|no wallet/i.test(
          message,
        );
        setState((prev) => ({
          ...prev,
          status: disconnected ? 'disconnected' : prev.status,
          error: disconnected ? DISCONNECT_ERROR : message,
        }));
        return {
          signedXdr: null,
          error: disconnected ? DISCONNECT_ERROR : message,
          disconnected,
        };
      } finally {
        signingRef.current = false;
      }
    },
    [],
  );

  // Poll for disconnect/lock events while a signing operation is pending so the
  // UI can transition out of an indefinite loading state.
  useEffect(() => {
    if (state.status !== 'connected') return;

    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const connected = await freighterIsConnected();
        if (!connected && !cancelled) {
          setState({
            publicKey: null,
            status: 'disconnected',
            error: signingRef.current ? DISCONNECT_ERROR : null,
          });
        }
      } catch {
        // Ignore transient polling errors; signing path handles real failures.
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state.status]);

  return {
    ...state,
    isConnected: state.status === 'connected',
    connect,
    disconnect,
    sign,
    clearError,
  };
}
