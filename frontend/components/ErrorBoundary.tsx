"use client";

import { Component, ReactNode, useState } from "react";
import { getContractErrorMessage, getWalletErrorMessage } from "../lib/wallet-errors";

// ─── Error Type Classification ────────────────────────────────────────────────

export type BoundaryErrorType =
  | "wallet"
  | "transaction"
  | "network"
  | "contract"
  | "insufficient_funds"
  | "generic";

export interface ClassifiedError {
  type: BoundaryErrorType;
  title: string;
  message: string;
  /** Suggested recovery action label */
  recoveryLabel: string;
  /** Secondary action label (optional) */
  secondaryLabel?: string;
  icon: string;
}

// Pattern matching helpers for each error type
const WALLET_PATTERNS = [
  /wallet/i,
  /freighter/i,
  /WALLET_NOT_INSTALLED/,
  /WALLET_PERMISSION_DENIED/,
  /WRONG_NETWORK/,
  /ACCOUNT_NOT_ACTIVATED/,
  /permission denied/i,
  /not installed/i,
  /not connected/i,
  /wallet connect/i,
];

const TRANSACTION_PATTERNS = [
  /TRANSACTION_REJECTED/,
  /transaction/i,
  /tx timeout/i,
  /timeout/i,
  /timed out/i,
  /submission failed/i,
  /broadcast/i,
  /sequence number/i,
];

const NETWORK_PATTERNS = [
  /network/i,
  /WRONG_NETWORK/,
  /fetch failed/i,
  /failed to fetch/i,
  /connection refused/i,
  /ECONNREFUSED/,
  /offline/i,
  /NetworkError/i,
  /horizon/i,
  /rpc/i,
];

const CONTRACT_PATTERNS = [
  /contract/i,
  /Error\(Contract/,
  /contract error/i,
  /soroban/i,
  /simulation/i,
  /invoke/i,
  /wasm/i,
];

const INSUFFICIENT_FUNDS_PATTERNS = [
  /INSUFFICIENT_XLM/,
  /insufficient/i,
  /not enough/i,
  /balance/i,
  /funds/i,
  /xlm/i,
  /usdc/i,
  /InsufficientCredits/i,
];

/**
 * Classify an error into one of our granular error types.
 * Order matters: more specific patterns first.
 */
export function classifyError(error: Error | null): ClassifiedError {
  const msg = error?.message ?? "";
  const stack = error?.stack ?? "";
  const combined = `${msg} ${stack}`;

  const test = (patterns: RegExp[]) => patterns.some((p) => p.test(combined));

  if (test(INSUFFICIENT_FUNDS_PATTERNS)) {
    return {
      type: "insufficient_funds",
      title: "Insufficient Funds",
      message: getWalletErrorMessage(error) || "You don't have enough balance to complete this transaction.",
      recoveryLabel: "View Account Balance",
      secondaryLabel: "Contact Support",
      icon: "💳",
    };
  }

  if (test(WALLET_PATTERNS)) {
    const isMissing = /not installed|WALLET_NOT_INSTALLED/i.test(combined);
    return {
      type: "wallet",
      title: isMissing ? "Wallet Not Found" : "Wallet Connection Lost",
      message: getWalletErrorMessage(error) ||
        (isMissing
          ? "Freighter wallet is not installed. Install it to connect to the Stellar network."
          : "Your wallet connection was lost. Please reconnect your Freighter wallet to continue."),
      recoveryLabel: isMissing ? "Install Freighter" : "Reconnect Wallet",
      secondaryLabel: "Learn More",
      icon: "🔐",
    };
  }

  if (test(CONTRACT_PATTERNS)) {
    return {
      type: "contract",
      title: "Smart Contract Error",
      message: getContractErrorMessage(error) ||
        "The on-chain transaction could not be completed. Please verify your inputs and try again.",
      recoveryLabel: "Try Again",
      secondaryLabel: "Contact Support",
      icon: "📜",
    };
  }

  if (test(TRANSACTION_PATTERNS)) {
    const isTimeout = /timeout|timed out/i.test(combined);
    return {
      type: "transaction",
      title: isTimeout ? "Transaction Timed Out" : "Transaction Failed",
      message: isTimeout
        ? "The transaction took too long to confirm. It may still be processing on the network."
        : getWalletErrorMessage(error) || "Your transaction could not be submitted. Please try again.",
      recoveryLabel: "Retry Transaction",
      secondaryLabel: "Check Transaction Status",
      icon: "⏳",
    };
  }

  if (test(NETWORK_PATTERNS)) {
    const isOffline = /offline|failed to fetch|fetch failed/i.test(combined);
    return {
      type: "network",
      title: isOffline ? "You're Offline" : "Network Error",
      message: isOffline
        ? "No internet connection detected. Please check your network and try again."
        : "Unable to connect to the Stellar network. The service may be temporarily unavailable.",
      recoveryLabel: "Retry",
      secondaryLabel: "Check Network Status",
      icon: "🌐",
    };
  }

  return {
    type: "generic",
    title: "Something Went Wrong",
    message: error?.message || "An unexpected error occurred. Please try again.",
    recoveryLabel: "Try Again",
    secondaryLabel: "Contact Support",
    icon: "⚠️",
  };
}

// ─── Recovery Action Handlers ─────────────────────────────────────────────────

function getRecoveryHref(type: BoundaryErrorType, isPrimary: boolean): string | undefined {
  if (!isPrimary) {
    // Secondary actions
    switch (type) {
      case "wallet":       return "https://freighter.app";
      case "insufficient_funds":
      case "contract":
      case "transaction":
      case "generic":
        return "mailto:support@carbonledger.io";
      case "network":
        return "https://status.stellar.org";
    }
  }
  // Primary actions that are external links
  switch (type) {
    case "wallet": return undefined; // handled by onClick (install = external, reconnect = retry)
    case "network": return undefined; // handled by retry
    default: return undefined;
  }
}

// ─── Dev Panel Component ──────────────────────────────────────────────────────

interface DevPanelProps {
  error: Error | null;
  componentStack: string;
}

function DevPanel({ error, componentStack }: DevPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: "1rem" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="error-dev-panel"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          background: "transparent",
          border: "1px solid #374151",
          borderRadius: "0.375rem",
          color: "#9ca3af",
          fontSize: "0.75rem",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          padding: "0.375rem 0.75rem",
          cursor: "pointer",
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <span>🛠 Dev Details</span>
        <span style={{ fontSize: "0.625rem" }}>{open ? "▲ collapse" : "▼ expand"}</span>
      </button>

      {open && (
        <div
          id="error-dev-panel"
          style={{
            marginTop: "0.5rem",
            background: "#0f172a",
            border: "1px solid #1e293b",
            borderRadius: "0.375rem",
            padding: "0.875rem",
            textAlign: "left",
            overflowX: "auto",
          }}
        >
          <p style={{ color: "#f87171", fontSize: "0.75rem", fontWeight: 700, margin: "0 0 0.25rem", fontFamily: "monospace" }}>
            {error?.name ?? "Error"}: {error?.message ?? "Unknown"}
          </p>

          {error?.stack && (
            <>
              <p style={{ color: "#64748b", fontSize: "0.625rem", margin: "0.75rem 0 0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Stack Trace
              </p>
              <pre
                style={{
                  color: "#94a3b8",
                  fontSize: "0.6875rem",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  lineHeight: 1.5,
                }}
              >
                {error.stack}
              </pre>
            </>
          )}

          {componentStack && (
            <>
              <p style={{ color: "#64748b", fontSize: "0.625rem", margin: "0.75rem 0 0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Component Stack
              </p>
              <pre
                style={{
                  color: "#64748b",
                  fontSize: "0.6875rem",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  lineHeight: 1.5,
                }}
              >
                {componentStack}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Error UI Component ───────────────────────────────────────────────────────

interface ErrorUIProps {
  classified: ClassifiedError;
  error: Error | null;
  componentStack: string;
  onRetry: () => void;
  isDev: boolean;
}

// Type-specific colour schemes
const TYPE_STYLES: Record<
  BoundaryErrorType,
  { bg: string; border: string; titleColor: string; textColor: string; primaryBg: string; primaryHover: string }
> = {
  wallet: {
    bg: "#faf5ff",
    border: "#d8b4fe",
    titleColor: "#6b21a8",
    textColor: "#7e22ce",
    primaryBg: "#7c3aed",
    primaryHover: "#6d28d9",
  },
  transaction: {
    bg: "#fffbeb",
    border: "#fcd34d",
    titleColor: "#92400e",
    textColor: "#78350f",
    primaryBg: "#d97706",
    primaryHover: "#b45309",
  },
  network: {
    bg: "#eff6ff",
    border: "#93c5fd",
    titleColor: "#1e40af",
    textColor: "#1d4ed8",
    primaryBg: "#2563eb",
    primaryHover: "#1d4ed8",
  },
  contract: {
    bg: "#fff7ed",
    border: "#fdba74",
    titleColor: "#9a3412",
    textColor: "#7c2d12",
    primaryBg: "#ea580c",
    primaryHover: "#c2410c",
  },
  insufficient_funds: {
    bg: "#fef2f2",
    border: "#fca5a5",
    titleColor: "#991b1b",
    textColor: "#7f1d1d",
    primaryBg: "#dc2626",
    primaryHover: "#b91c1c",
  },
  generic: {
    bg: "#fee2e2",
    border: "#fca5a5",
    titleColor: "#991b1b",
    textColor: "#7f1d1d",
    primaryBg: "#dc2626",
    primaryHover: "#b91c1c",
  },
};

function ErrorUI({ classified, error, componentStack, onRetry, isDev }: ErrorUIProps) {
  const style = TYPE_STYLES[classified.type];
  const secondaryHref = getRecoveryHref(classified.type, false);

  // Primary action: for wallet-not-installed, open freighter.app; otherwise retry
  const isPrimaryExternal = classified.type === "wallet" && /not found|not installed/i.test(classified.title);
  const primaryHref = isPrimaryExternal ? "https://freighter.app" : undefined;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: "0.75rem",
        padding: "clamp(1.25rem, 4vw, 2rem)",
        textAlign: "center",
        width: "100%",
        boxSizing: "border-box",
        maxWidth: "100%",
      }}
    >
      {/* Icon */}
      <p style={{ fontSize: "clamp(1.75rem, 6vw, 2.5rem)", margin: "0 0 0.75rem", lineHeight: 1 }} aria-hidden="true">
        {classified.icon}
      </p>

      {/* Title */}
      <h3
        style={{
          fontWeight: 700,
          color: style.titleColor,
          margin: "0 0 0.5rem",
          fontSize: "clamp(1rem, 3vw, 1.25rem)",
          lineHeight: 1.3,
        }}
      >
        {classified.title}
      </h3>

      {/* Message */}
      <p
        style={{
          fontSize: "clamp(0.8125rem, 2.5vw, 0.9375rem)",
          color: style.textColor,
          margin: "0 0 1.5rem",
          lineHeight: 1.6,
          maxWidth: "36rem",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {classified.message}
      </p>

      {/* Recovery Actions */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {/* Primary action */}
        {primaryHref ? (
          <a
            href={primaryHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: style.primaryBg,
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.625rem 1.5rem",
              fontSize: "clamp(0.8125rem, 2.5vw, 0.9375rem)",
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-block",
              whiteSpace: "nowrap",
            }}
          >
            {classified.recoveryLabel}
          </a>
        ) : (
          <button
            onClick={onRetry}
            style={{
              background: style.primaryBg,
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.625rem 1.5rem",
              fontSize: "clamp(0.8125rem, 2.5vw, 0.9375rem)",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {classified.recoveryLabel}
          </button>
        )}

        {/* Secondary action */}
        {classified.secondaryLabel && secondaryHref && (
          <a
            href={secondaryHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: "transparent",
              color: style.titleColor,
              border: `1px solid ${style.border}`,
              borderRadius: "0.5rem",
              padding: "0.625rem 1.5rem",
              fontSize: "clamp(0.8125rem, 2.5vw, 0.9375rem)",
              fontWeight: 500,
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-block",
              whiteSpace: "nowrap",
            }}
          >
            {classified.secondaryLabel}
          </a>
        )}
      </div>

      {/* Dev mode panel */}
      {isDev && <DevPanel error={error} componentStack={componentStack} />}
    </div>
  );
}

// ─── ErrorBoundary Class Component ───────────────────────────────────────────

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Override dev mode detection (useful in tests) */
  devMode?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: "" };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Capture component stack for dev panel
    this.setState({ componentStack: info.componentStack });

    console.error("ErrorBoundary caught:", error, info);
    import("../lib/logger").then(({ clientLogger }) => {
      clientLogger.error(error.message, {
        stack: error.stack,
        component_stack: info.componentStack,
        error_type: classifyError(error).type,
      });
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, componentStack: "" });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isDev =
        this.props.devMode !== undefined
          ? this.props.devMode
          : process.env.NODE_ENV === "development";

      const classified = classifyError(this.state.error);

      return (
        <ErrorUI
          classified={classified}
          error={this.state.error}
          componentStack={this.state.componentStack}
          onRetry={this.handleRetry}
          isDev={isDev}
        />
      );
    }

    return this.props.children;
  }
}
