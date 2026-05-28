"use client";

import { WalletStatus } from "../hooks/useWalletStatus";
import { colors, borderRadius, shadows, typography } from "../styles/design-system";
import { connectFreighter } from "../lib/freighter";

interface WalletPromptProps {
  status: WalletStatus;
  onConnect: (address: string) => void;
  refresh: () => void;
}

export default function WalletPrompt({ status, onConnect, refresh }: WalletPromptProps) {
  if (status === "loading" || status === "ready") return null;

  const handleConnect = async () => {
    try {
      const address = await connectFreighter();
      onConnect(address);
      refresh();
    } catch (e) {
      console.error("Connection failed", e);
    }
  };

  const handleSwitchNetwork = () => {
    // Since we can't trigger a switch via API, we prompt the user to check their wallet
    // and then we refresh the status.
    alert("Please open your Freighter extension and switch to the Testnet.");
    refresh();
  };

  const content = {
    not_installed: {
      title: "Wallet Required",
      message: "To securely purchase and retire carbon credits, you'll need the Freighter wallet extension.",
      buttonText: "Install Freighter",
      action: () => window.open("https://www.freighter.app/", "_blank"),
      icon: "🔌",
    },
    not_connected: {
      title: "Connect Your Wallet",
      message: "Connect your Freighter wallet to authorize this transaction on the Stellar network.",
      buttonText: "Connect Wallet",
      action: handleConnect,
      icon: "🦊",
    },
    wrong_network: {
      title: "Switch to Testnet",
      message: "CarbonLedger currently operates on the Stellar Testnet. Please switch your wallet network to continue.",
      buttonText: "Refresh Connection",
      action: handleSwitchNetwork,
      icon: "🌐",
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
          Already installed? <button onClick={refresh} style={{ background: "none", border: "none", color: colors.primary[600], cursor: "pointer", padding: 0, fontSize: "inherit", textDecoration: "underline" }}>Click here to refresh</button>
        </p>
      )}
    </div>
  );
}
