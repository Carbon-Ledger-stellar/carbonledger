"use client";

import { useVerifierAuth } from "../../../lib/use-verifier-auth";
import WalletPrompt from "../../../components/WalletPrompt";
import { useWalletStatus } from "../../hooks/useWalletStatus";

export default function VerifierLayout({ children }: { children: React.ReactNode }) {
  const { state } = useVerifierAuth();
  const { status: walletStatus, refresh: refreshWallet } = useWalletStatus();

  if (state === "loading" || state === "redirecting") {
    return (
      <main style={{ maxWidth: 960, margin: "4rem auto", padding: "0 1rem" }}>
        <p>Checking verifier access…</p>
      </main>
    );
  }

  if (state === "needs_wallet") {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Verifier access</h1>
        <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
          Connect an accredited verifier wallet to review pending projects.
        </p>
        <WalletPrompt status={walletStatus} onConnect={() => refreshWallet()} refresh={refreshWallet} />
      </main>
    );
  }

  return <>{children}</>;
}
