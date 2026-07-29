"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseHorizonTransactionFailure } from "../lib/horizon-transaction-error";
import { invalidateTransactionRelatedCaches } from "../lib/invalidate-transaction-caches";

export const TRANSACTION_POLL_INTERVAL_MS = 5_000;
export const TRANSACTION_MAX_POLLS = 120;

export type TransactionPollerTerminalState = "SUCCESS" | "FAILED" | "TIMED_OUT";
export type TransactionPollerState = "idle" | "polling" | TransactionPollerTerminalState;

export interface HorizonTransactionRecord {
  successful: boolean;
  result_xdr?: string;
  result_codes?: unknown;
}

export interface PollHorizonTransactionOptions {
  hash: string;
  fetchTransaction?: (hash: string) => Promise<HorizonTransactionRecord | null>;
  sleep?: (ms: number) => Promise<void>;
  maxPolls?: number;
  intervalMs?: number;
  onPoll?: (attempt: number) => void;
  invalidateCaches?: () => Promise<void>;
}

export interface PollHorizonTransactionResult {
  state: TransactionPollerTerminalState;
  polls: number;
  errorMessage?: string;
}

export function getHorizonTransactionUrl(hash: string): string {
  const base = process.env.NEXT_PUBLIC_HORIZON_URL!;
  return `${base}/transactions/${hash}`;
}

export async function fetchHorizonTransaction(
  hash: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HorizonTransactionRecord | null> {
  const res = await fetchImpl(getHorizonTransactionUrl(hash));
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Horizon request failed (${res.status})`);
  }
  return res.json() as Promise<HorizonTransactionRecord>;
}

export async function pollHorizonTransactionUntilTerminal(
  hash: string,
  options: Omit<PollHorizonTransactionOptions, "hash"> = {},
): Promise<PollHorizonTransactionResult> {
  const {
    fetchTransaction = fetchHorizonTransaction,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxPolls = TRANSACTION_MAX_POLLS,
    intervalMs = TRANSACTION_POLL_INTERVAL_MS,
    onPoll,
    invalidateCaches = invalidateTransactionRelatedCaches,
  } = options;

  for (let attempt = 1; attempt <= maxPolls; attempt++) {
    onPoll?.(attempt);
    const tx = await fetchTransaction(hash);

    if (tx?.successful === true) {
      await invalidateCaches();
      return { state: "SUCCESS", polls: attempt };
    }

    if (tx && tx.successful === false) {
      return {
        state: "FAILED",
        polls: attempt,
        errorMessage: parseHorizonTransactionFailure(tx),
      };
    }

    if (attempt < maxPolls) {
      await sleep(intervalMs);
    }
  }

  return { state: "TIMED_OUT", polls: maxPolls };
}

export interface UseTransactionPollerOptions {
  /** When set, polling starts automatically. Pass null to stay idle. */
  txHash?: string | null;
  enabled?: boolean;
}

export interface UseTransactionPollerReturn {
  state: TransactionPollerState;
  pollCount: number;
  errorMessage: string | null;
  reset: () => void;
  startPolling: (hash: string) => void;
}

export function useTransactionPoller(
  options: UseTransactionPollerOptions = {},
): UseTransactionPollerReturn {
  const { txHash: txHashProp = null, enabled = true } = options;

  const [activeHash, setActiveHash] = useState<string | null>(null);
  const [state, setState] = useState<TransactionPollerState>("idle");
  const [pollCount, setPollCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const runIdRef = useRef(0);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setActiveHash(null);
    setState("idle");
    setPollCount(0);
    setErrorMessage(null);
  }, []);

  const startPolling = useCallback((hash: string) => {
    runIdRef.current += 1;
    setActiveHash(hash);
    setState("polling");
    setPollCount(0);
    setErrorMessage(null);
  }, []);

  const hashToPoll = activeHash ?? (enabled ? txHashProp : null);

  useEffect(() => {
    if (!hashToPoll) {
      return;
    }

    const runId = ++runIdRef.current;
    setState("polling");
    setPollCount(0);
    setErrorMessage(null);

    let cancelled = false;

    (async () => {
      const result = await pollHorizonTransactionUntilTerminal(hashToPoll, {
        onPoll: (attempt) => {
          if (cancelled || runId !== runIdRef.current) return;
          setPollCount(attempt);
        },
      });

      if (cancelled || runId !== runIdRef.current) return;

      if (result.state === "SUCCESS") {
        setState("SUCCESS");
        setPollCount(result.polls);
        setErrorMessage(null);
      } else if (result.state === "FAILED") {
        setState("FAILED");
        setPollCount(result.polls);
        setErrorMessage(result.errorMessage ?? "Transaction failed on-chain");
      } else {
        setState("TIMED_OUT");
        setPollCount(result.polls);
        setErrorMessage(null);
      }
    })().catch((err: unknown) => {
      if (cancelled || runId !== runIdRef.current) return;
      setState("FAILED");
      setErrorMessage(err instanceof Error ? err.message : "Polling failed");
    });

    return () => {
      cancelled = true;
    };
  }, [hashToPoll]);

  return { state, pollCount, errorMessage, reset, startPolling };
}
