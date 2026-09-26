"use client";

import { colors } from "../styles/design-system";
import { getCarbonErrorMessage } from "../lib/carbon-errors";

export type TxStatus =
  | "building"
  | "signing"
  | "submitting"
  | "polling"
  | "confirmed"
  | "failed"
  | "timed_out"
  | "pending"
  | "submitted";

interface Props {
  status: TxStatus;
  txHash?: string;
  message?: string;
  pollProgress?: { current: number; max: number };
  onRetry?: () => void;
}

const STELLAR_EXPERT_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "public" : "testnet";

const config: Record<TxStatus, { icon: string; label: string; bg: string; text: string; border: string; spin?: boolean }> = {
  building:   { icon: "🏗️", label: "Building transaction…",  bg: "#f8fafc", text: "#475569", border: "#cbd5e1", spin: true },
  signing:    { icon: "✍️", label: "Waiting for signature…", bg: "#fff7ed", text: "#c2410c", border: "#fdba74", spin: true },
  submitting: { icon: "📡", label: "Submitting to network…", bg: "#f0f9ff", text: "#0369a1", border: "#7dd3fc", spin: true },
  polling:    { icon: "⏳", label: "Confirming on-chain…",   bg: "#f5f3ff", text: "#6d28d9", border: "#c4b5fd", spin: true },
  confirmed:  { icon: "✅", label: "Transaction confirmed",  bg: colors.verified.bg, text: colors.verified.text, border: colors.verified.border },
  failed:     { icon: "❌", label: "Transaction failed",     bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
  timed_out:  { icon: "⏰", label: "Still confirming",       bg: "#fffbeb", text: "#b45309", border: "#fcd34d" },
  // Backward compatibility
  pending:    { icon: "⏳", label: "Preparing transaction…", bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd", spin: true },
  submitted:  { icon: "📡", label: "Transaction submitted",  bg: colors.pending.bg, text: colors.pending.text, border: colors.pending.border, spin: true },
};

export default function TransactionStatus({ status, txHash, message, pollProgress, onRetry }: Props) {
  const cfg = config[status] || config.failed;
  const carbonError = status === "failed" ? getCarbonErrorMessage(message) : null;
  const timedOutMessage =
    status === "timed_out"
      ? message ?? "Check later — your transaction may still confirm on the network."
      : null;
  const displayMessage = carbonError || timedOutMessage || message;
  const explorerHref = txHash
    ? `https://stellar.expert/explorer/${STELLAR_EXPERT_NETWORK}/tx/${txHash}`
    : undefined;

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: "0.5rem",
      padding: "1rem 1.25rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.5rem",
    }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .tx-spinner {
          animation: spin 1s linear infinite;
          display: inline-block;
        }
      `}</style>
      
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.25rem" }} className={cfg.spin ? "tx-spinner" : ""} aria-hidden="true">
          {cfg.spin ? "🔄" : cfg.icon}
        </span>
        <div
          role={status === "failed" ? "alert" : "status"}
          aria-live={status === "failed" ? "assertive" : "polite"}
          aria-atomic="true"
          style={{ flex: 1 }}
        >
          <p style={{ fontWeight: 700, fontSize: "0.875rem", color: cfg.text, margin: 0 }}>
            {cfg.label}
          </p>
          {status === "polling" && pollProgress && (
            <p style={{ fontSize: "0.8rem", color: cfg.text, margin: "0.2rem 0 0", opacity: 0.8 }}>
              Checking Horizon… attempt {pollProgress.current} of {pollProgress.max}
            </p>
          )}
          {displayMessage && (
            <p style={{ fontSize: "0.8rem", color: cfg.text, margin: "0.2rem 0 0", opacity: 0.8 }}>
              {displayMessage}
            </p>
          )}
          {status === "timed_out" && explorerHref && (
            <a
              href={explorerHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: "0.8rem",
                color: cfg.text,
                margin: "0.35rem 0 0",
                display: "inline-block",
                textDecoration: "underline",
              }}
            >
              View transaction on Stellar Expert →
            </a>
          )}
        </div>
        {status === "failed" && onRetry && (
          <button
            onClick={onRetry}
            style={{
              background: "#fff",
              border: `1px solid ${cfg.border}`,
              borderRadius: "0.375rem",
              padding: "0.25rem 0.75rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: cfg.text,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        )}
      </div>

      {txHash && status !== "timed_out" && (
        <a
          href={explorerHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{ 
            fontSize: "0.75rem", 
            color: cfg.text, 
            fontFamily: "monospace", 
            display: "block", 
            paddingLeft: "2rem",
            textDecoration: "underline" 
          }}
        >
          {txHash.slice(0, 12)}...{txHash.slice(-12)} — View on Explorer →
        </a>
      )}
    </div>
  );
}
