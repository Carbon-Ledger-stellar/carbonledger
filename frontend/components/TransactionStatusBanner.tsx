"use client";

import { useEffect, useRef } from "react";
import type { TransactionStreamStatus } from "../hooks/useHorizonTransactionStream";
import { colors } from "../styles/design-system";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TransactionStatusBannerProps {
  status: TransactionStreamStatus;
  txHash?: string | null;
  errorMessage?: string | null;
  confirmedAt?: string | null;
  onDismiss?: () => void;
  /** Render a compact inline version (no dismiss, smaller text) */
  compact?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const HORIZON_EXPLORER_BASE =
  process.env.NEXT_PUBLIC_HORIZON_EXPLORER_URL ??
  "https://stellar.expert/explorer/testnet/tx";

const STATUS_CONFIG: Record<
  TransactionStreamStatus,
  {
    icon: string;
    label: string;
    detail: string;
    bg: string;
    border: string;
    textColor: string;
    ariaLive: "off" | "polite" | "assertive";
  }
> = {
  idle: {
    icon: "",
    label: "",
    detail: "",
    bg: "transparent",
    border: "transparent",
    textColor: colors.neutral[600],
    ariaLive: "off",
  },
  submitted: {
    icon: "⏳",
    label: "Transaction Submitted",
    detail: "Your transaction is in the queue. Awaiting confirmation…",
    bg: colors.primary[50],
    border: colors.primary[200],
    textColor: colors.primary[700],
    ariaLive: "polite",
  },
  pending: {
    icon: "🔄",
    label: "Transaction Pending",
    detail: "Processing on the Stellar network…",
    bg: "#fffbeb",
    border: "#fef3c7",
    textColor: "#92400e",
    ariaLive: "polite",
  },
  confirmed: {
    icon: "✅",
    label: "Transaction Confirmed",
    detail: "Your credits have been transferred. Portfolio updated.",
    bg: "#f0fdf4",
    border: "#bbf7d0",
    textColor: "#166534",
    ariaLive: "assertive",
  },
  failed: {
    icon: "❌",
    label: "Transaction Failed",
    detail: "The transaction was rejected. Your portfolio has been restored.",
    bg: "#fef2f2",
    border: "#fecaca",
    textColor: "#991b1b",
    ariaLive: "assertive",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <>
      <style>{`
        @keyframes txBannerSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .tx-banner-spinner {
          width: 1rem;
          height: 1rem;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: txBannerSpin 0.8s linear infinite;
          display: inline-block;
          flex-shrink: 0;
        }
      `}</style>
      <span className="tx-banner-spinner" aria-hidden="true" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function TransactionStatusBanner({
  status,
  txHash,
  errorMessage,
  confirmedAt,
  onDismiss,
  compact = false,
}: TransactionStatusBannerProps) {
  // Don't render anything for idle state
  if (status === "idle") return null;

  const cfg = STATUS_CONFIG[status];
  const isSpinning = status === "submitted" || status === "pending";
  const canDismiss = status === "confirmed" || status === "failed";

  const confirmedDate = confirmedAt
    ? new Date(confirmedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <>
      <style>{`
        @keyframes txBannerSlideIn {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .tx-banner-root {
          animation: txBannerSlideIn 0.2s ease-out forwards;
        }
        .tx-banner-dismiss:hover {
          opacity: 0.7;
        }
        .tx-banner-link:hover {
          text-decoration: underline;
        }
      `}</style>

      {/* ARIA live region for screen readers */}
      <div
        role="status"
        aria-live={cfg.ariaLive}
        aria-atomic="true"
        className="tx-banner-root"
        style={{
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          borderRadius: compact ? "0.5rem" : "0.75rem",
          padding: compact ? "0.5rem 0.75rem" : "0.875rem 1.25rem",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.75rem",
        }}
      >
        {/* Main content */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", flex: 1, minWidth: 0 }}>
          {/* Icon or spinner */}
          <div
            style={{
              color: cfg.textColor,
              flexShrink: 0,
              marginTop: "0.05rem",
            }}
            aria-hidden="true"
          >
            {isSpinning ? <Spinner /> : cfg.icon}
          </div>

          {/* Text */}
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: compact ? "0.8rem" : "0.875rem",
                fontWeight: 700,
                color: cfg.textColor,
                lineHeight: 1.3,
              }}
            >
              {cfg.label}
            </p>

            {!compact && (
              <p
                style={{
                  margin: "0.2rem 0 0",
                  fontSize: "0.8rem",
                  color: cfg.textColor,
                  opacity: 0.85,
                }}
              >
                {status === "failed" && errorMessage ? errorMessage : cfg.detail}
              </p>
            )}

            {/* TX Hash link */}
            {txHash && (
              <a
                href={`${HORIZON_EXPLORER_BASE}/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tx-banner-link"
                aria-label={`View transaction ${txHash} on Stellar Explorer`}
                style={{
                  display: "block",
                  marginTop: "0.2rem",
                  fontSize: "0.72rem",
                  fontFamily: "monospace",
                  color: cfg.textColor,
                  opacity: 0.75,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "32ch",
                  textDecoration: "none",
                }}
              >
                {txHash.slice(0, 12)}…{txHash.slice(-8)}
              </a>
            )}

            {/* Confirmed at */}
            {status === "confirmed" && confirmedDate && !compact && (
              <p
                style={{
                  margin: "0.15rem 0 0",
                  fontSize: "0.75rem",
                  color: cfg.textColor,
                  opacity: 0.7,
                }}
              >
                Confirmed at {confirmedDate}
              </p>
            )}
          </div>
        </div>

        {/* Dismiss button */}
        {canDismiss && onDismiss && (
          <button
            onClick={onDismiss}
            aria-label={`Dismiss ${cfg.label} notification`}
            className="tx-banner-dismiss"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: cfg.textColor,
              opacity: 0.6,
              fontSize: "1rem",
              padding: "0",
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status step progress bar (submitted → pending → confirmed / failed)
// ─────────────────────────────────────────────────────────────────────────────

const STEPS: Array<{ status: TransactionStreamStatus; label: string }> = [
  { status: "submitted", label: "Submitted" },
  { status: "pending", label: "Pending" },
  { status: "confirmed", label: "Confirmed" },
];

interface StepProgressProps {
  status: TransactionStreamStatus;
}

export function TransactionStepProgress({ status }: StepProgressProps) {
  if (status === "idle") return null;

  const isFailed = status === "failed";
  const activeIdx = isFailed
    ? 1 // stuck at pending when failed
    : STEPS.findIndex((s) => s.status === status);

  return (
    <>
      <style>{`
        @keyframes txPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .tx-step-active-dot {
          animation: txPulse 1.5s ease-in-out infinite;
        }
      `}</style>

      <div
        role="progressbar"
        aria-label="Transaction progress"
        aria-valuenow={activeIdx + 1}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0",
        }}
      >
        {STEPS.map((step, i) => {
          const isActive = i === activeIdx && !isFailed;
          const isCompleted = !isFailed && i < activeIdx;
          const isCurrent = i === activeIdx;

          return (
            <div
              key={step.status}
              style={{ display: "flex", alignItems: "center", flex: 1 }}
            >
              {/* Step dot */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.25rem",
                }}
              >
                <div
                  aria-current={isCurrent ? "step" : undefined}
                  className={isActive ? "tx-step-active-dot" : ""}
                  style={{
                    width: "0.875rem",
                    height: "0.875rem",
                    borderRadius: "50%",
                    background: isFailed && isCurrent
                      ? "#ef4444"
                      : isCompleted
                      ? "#16a34a"
                      : isActive
                      ? colors.primary[600]
                      : colors.neutral[300],
                    border: `2px solid ${
                      isFailed && isCurrent
                        ? "#ef4444"
                        : isCompleted
                        ? "#16a34a"
                        : isActive
                        ? colors.primary[600]
                        : colors.neutral[200]
                    }`,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: "0.65rem",
                    color: isActive || isCompleted ? colors.neutral[700] : colors.neutral[400],
                    fontWeight: isActive ? 700 : 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isFailed && isCurrent ? "Failed" : step.label}
                </span>
              </div>

              {/* Connector line */}
              {i < STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  style={{
                    flex: 1,
                    height: "2px",
                    background: isCompleted ? "#16a34a" : colors.neutral[200],
                    marginBottom: "1.1rem",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
