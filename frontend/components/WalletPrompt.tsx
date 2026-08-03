"use client";

import { useEffect, useState } from "react";
import { WalletStatus } from "../hooks/useWalletStatus";
import { colors, borderRadius, shadows, typography } from "../styles/design-system";
import { connectFreighter, checkNetwork, FreighterNetwork } from "../lib/freighter";
import { getWalletErrorMessage } from "../lib/wallet-errors";
import { getCurrentBrowserInstallUrl } from "../lib/browser-install-links";
import { useTranslations } from "next-intl";

interface WalletPromptProps {
  status: WalletStatus;
  onConnect: (address: string) => void;
  refresh: () => void;
}

const NETWORK_LABELS: Record<FreighterNetwork, string> = {
  TESTNET: "Testnet",
  PUBLIC: "Mainnet (Public)",
  FUTURENET: "Futurenet",
};

export default function WalletPrompt({ status, onConnect, refresh }: WalletPromptProps) {
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

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: borderRadius.xl,
        padding: "2rem",
        textAlign: "center",
        boxShadow: shadows.lg,
        maxWidth: "400px",
        margin: "2rem auto",
      }}
    >
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>{content.icon}</div>
      <h2 style={{ fontSize: typography.fontSize.xl, fontWeight: 700, color: colors.neutral[900], marginBottom: "0.75rem" }}>
        {content.title}
      </h2>
      <p style={{ color: colors.neutral[500], fontSize: typography.fontSize.sm, lineHeight: 1.5, marginBottom: "1.5rem" }}>
        {content.message}
      </p>
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
  );
}
