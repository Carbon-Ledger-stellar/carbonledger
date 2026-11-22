"use client";

import { useEffect, useState } from "react";
import { WalletStatus } from "../hooks/useWalletStatus";
import { colors, borderRadius, shadows, typography } from "../styles/design-system";
import { connectFreighter, checkNetwork } from "../lib/freighter";
import type { FreighterNetwork } from "../lib/freighter";
import { getWalletErrorMessage } from "../lib/wallet-errors";
import { getCurrentBrowserInstallUrl } from "../lib/browser-install-links";
import { useTranslations } from "next-intl";

// ─── What is a wallet? Explainer shown to new users ──────────────────────────

function WalletExplainer({ installUrl }: { installUrl: string }) {
  return (
    <details
      style={{
        marginBottom: "1.25rem",
        textAlign: "left",
        background: colors.primary[50],
        border: `1px solid ${colors.primary[100]}`,
        borderRadius: borderRadius.lg,
        padding: "0.75rem 1rem",
        fontSize: "0.8rem",
        color: colors.neutral[600],
        lineHeight: 1.55,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontWeight: 700,
          color: colors.primary[700],
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
        }}
      >
        <span aria-hidden="true">ℹ️</span> What is a wallet?
      </summary>
      <p style={{ margin: "0.6rem 0 0.4rem" }}>
        A <strong>crypto wallet</strong> is a browser extension that lets you sign
        transactions securely without sharing your private keys with any website.
        CarbonLedger uses <strong>Freighter</strong>, a free wallet for the{" "}
        <strong>Stellar</strong> network.
      </p>
      <p style={{ margin: "0 0 0.4rem" }}>
        Once installed, Freighter will appear as an icon in your browser toolbar.
        You create (or import) an account there — CarbonLedger never sees your
        seed phrase or private key.
      </p>
      <a
        href={installUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          fontWeight: 600,
          color: colors.primary[600],
          textDecoration: "underline",
        }}
        aria-label="Install Freighter wallet (opens in new tab)"
      >
        Install Freighter ↗
      </a>
    </details>
  );
}

interface WalletPromptProps {
  status: WalletStatus;
  onConnect: (address: string) => void;
  refresh: () => void;
  /**
   * When true, renders a contextual explanation that a Freighter Stellar wallet
   * is required to authorize the on-chain purchase, **before** the connection
   * prompt. Hidden automatically once the wallet is ready. (Issue #1598)
   */
  showContextualExplanation?: boolean;
}

const NETWORK_LABELS: Record<FreighterNetwork, string> = {
  TESTNET: "Testnet",
  PUBLIC: "Mainnet (Public)",
  FUTURENET: "Futurenet",
};

export default function WalletPrompt({ status, onConnect, refresh, showContextualExplanation = false }: WalletPromptProps) {
  const t = useTranslations("walletPrompt");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [detectedNetwork, setDetectedNetwork] = useState<FreighterNetwork | null>(null);

  useEffect(() => {
    if (status !== "wrong_network") {
      setDetectedNetwork(null);
      return;
    }
    checkNetwork()
      .then(setDetectedNetwork)
      .catch(() => setDetectedNetwork(null));
  }, [status]);

  if (status === "loading" || status === "ready") return null;

  const handleConnect = async () => {
    setConnectError(null);
    try {
      const address = await connectFreighter();
      onConnect(address);
    } catch (e) {
      setConnectError(getWalletErrorMessage(e));
    } finally {
      refresh();
    }
  };

  const networkLabel = detectedNetwork ? NETWORK_LABELS[detectedNetwork] : t("wrongNetworkUnknown");

  // ── Contextual explanation (Issue #1598) ─────────────────────────────────
  // Show a plain-language "why do I need a wallet?" banner before the action
  // prompt, so first-time users understand what is about to happen. Hidden
  // when the user has not_installed status (they need to install first, so
  // the main prompt is already self-explanatory) and when status is ready.
  const showExplanation =
    showContextualExplanation &&
    status !== "not_installed" &&
    status !== "loading" &&
    status !== "ready";

  const content = {
    not_installed: {
      title: t("notInstalledTitle"),
      message: t("notInstalledMessage"),
      buttonText: t("notInstalledButton"),
      action: () => window.open(getCurrentBrowserInstallUrl(), "_blank", "noopener,noreferrer"),
      icon: "🔌",
    },
    locked: {
      title: t("lockedTitle"),
      message: t("lockedMessage"),
      buttonText: t("lockedButton"),
      action: handleConnect,
      icon: "🔒",
    },
    not_connected: {
      title: t("notConnectedTitle"),
      message: t("notConnectedMessage"),
      buttonText: t("notConnectedButton"),
      action: handleConnect,
      icon: "🦊",
    },
    wrong_network: {
      title: t("wrongNetworkTitle"),
      message: t("wrongNetworkMessage", { network: networkLabel }),
      buttonText: t("wrongNetworkButton"),
      action: refresh,
      icon: "🌐",
    },
    session_expired: {
      title: t("sessionExpiredTitle"),
      message: t("sessionExpiredMessage"),
      buttonText: t("sessionExpiredButton"),
      action: handleConnect,
      icon: "⏳",
    },
  }[status as Exclude<WalletStatus, "loading" | "ready">];

  const installUrl = getCurrentBrowserInstallUrl();

  return (
    <>
      {showExplanation && (
        <div
          role="note"
          aria-label={t("walletRequiredExplanationTitle")}
          style={{
            background: colors.primary[50],
            border: `1px solid ${colors.primary[200]}`,
            borderRadius: borderRadius.lg,
            padding: "1rem 1.25rem",
            marginBottom: "0.75rem",
            maxWidth: "400px",
            margin: "2rem auto 0",
          }}
        >
          <p
            style={{
              fontSize: typography.fontSize.sm,
              fontWeight: 700,
              color: colors.primary[700],
              margin: "0 0 0.35rem",
            }}
          >
            {t("walletRequiredExplanationTitle")}
          </p>
          <p
            style={{
              fontSize: typography.fontSize.sm,
              color: colors.neutral[600],
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {t("walletRequiredExplanation")}
          </p>
        </div>
      )}
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: borderRadius.xl,
        padding: "2rem",
        textAlign: "center",
        boxShadow: shadows.lg,
        maxWidth: "420px",
        margin: "2rem auto",
      }}
    >
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>{content.icon}</div>
      <h2 style={{ fontSize: typography.fontSize.xl, fontWeight: 700, color: colors.neutral[900], marginBottom: "0.75rem" }}>
        {content.title}
      </h2>
      {/* Issue #1598 — contextual reason explaining why a wallet is needed */}
      {reason && (
        <p
          data-testid="wallet-reason"
          style={{
            color: colors.primary[700],
            fontSize: typography.fontSize.sm,
            lineHeight: 1.5,
            marginBottom: "0.75rem",
            background: colors.primary[50],
            border: `1px solid ${colors.primary[200]}`,
            borderRadius: borderRadius.md,
            padding: "0.6rem 0.9rem",
            textAlign: "left",
          }}
        >
          {reason}
        </p>
      )}
      <p style={{ color: colors.neutral[500], fontSize: typography.fontSize.sm, lineHeight: 1.5, marginBottom: "1.5rem" }}>
        {content.message}
      </p>

      {/* Wallet explainer — shown when Freighter isn't installed or when the
          user hasn't connected yet, so new users understand what a wallet is. */}
      {(status === "not_installed" || status === "not_connected") && (
        <WalletExplainer installUrl={installUrl} />
      )}

      {connectError && (
        <p role="alert" style={{ color: "#dc2626", fontSize: typography.fontSize.sm, marginBottom: "1rem" }}>
          {connectError}
        </p>
      )}
      <button
        onClick={content.action}
        style={{
          width: "100%",
          background: colors.primary[600],
          color: "#fff",
          border: "none",
          borderRadius: borderRadius.lg,
          padding: "0.875rem",
          fontSize: "1rem",
          fontWeight: 700,
          cursor: "pointer",
          transition: "background 0.2s",
        }}
        onMouseOver={(e) => (e.currentTarget.style.background = colors.primary[700])}
        onMouseOut={(e) => (e.currentTarget.style.background = colors.primary[600])}
      >
        {content.buttonText}
      </button>
      {status === "not_installed" && (
        <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: colors.neutral[400] }}>
          {t("alreadyInstalled")}{" "}
          <button onClick={refresh} style={{ background: "none", border: "none", color: colors.primary[600], cursor: "pointer", padding: 0, fontSize: "inherit", textDecoration: "underline" }}>
            {t("refreshLink")}
          </button>
        </p>
      )}
    </div>
    </>
  );
}
