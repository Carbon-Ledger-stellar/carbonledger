"use client";

import { colors } from "../styles/design-system";
import { getCarbonErrorMessage } from "../lib/carbon-errors";

export type TxStatus = "building" | "signing" | "submitting" | "polling" | "confirmed" | "failed" | "pending" | "submitted";

interface Props {
  status: TxStatus;
  txHash?: string;
  message?: string;
  onRetry?: () => void;
}

const config: Record<TxStatus, { icon: string; label: string; bg: string; text: string; border: string; spin?: boolean }> = {
  building:   { icon: "🏗️", label: "Building transaction…",  bg: "#f8fafc", text: "#475569", border: "#cbd5e1", spin: true },
  signing:    { icon: "✍️", label: "Waiting for signature…", bg: "#fff7ed", text: "#c2410c", border: "#fdba74", spin: true },
  submitting: { icon: "📡", label: "Submitting to network…", bg: "#f0f9ff", text: "#0369a1", border: "#7dd3fc", spin: true },
  polling:    { icon: "⏳", label: "Confirming on-chain…",   bg: "#f5f3ff", text: "#6d28d9", border: "#c4b5fd", spin: true },
  confirmed:  { icon: "✅", label: "Transaction confirmed",  bg: colors.verified.bg, text: colors.verified.text, border: colors.verified.border },
  failed:     { icon: "❌", label: "Transaction failed",     bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
  // Backward compatibility
  pending:    { icon: "⏳", label: "Preparing transaction…", bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd", spin: true },
  submitted:  { icon: "📡", label: "Transaction submitted",  bg: colors.pending.bg, text: colors.pending.text, border: colors.pending.border, spin: true },
};

export default function TransactionStatus({ status, txHash, message, onRetry }: Props) {
  const cfg = config[status] || config.failed;
  const carbonError = status === "failed" ? getCarbonErrorMessage(message) : null;
  const displayMessage = carbonError || message;

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
        <span style={{ fontSize: "1.25rem" }} className={cfg.spin ? "tx-spinner" : ""}>
          {cfg.spin ? "🔄" : cfg.icon}
        </span>
        <div style={{ flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: "0.875rem", color: cfg.text, margin: 0 }}>
            {cfg.label}
          </p>
          {displayMessage && (
            <p style={{ fontSize: "0.8rem", color: cfg.text, margin: "0.2rem 0 0", opacity: 0.8 }}>
              {displayMessage}
            </p>
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

      {txHash && (
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
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
