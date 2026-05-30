"use client";

import { useState } from "react";
import { connectFreighter } from "../../lib/freighter";
import { getWalletErrorMessage } from "../../lib/wallet-errors";
import { colors } from "../../styles/design-system";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import Toast, { useToast } from "../../components/Toast";
import { useWalletStatus } from "../../hooks/useWalletStatus";
import WalletPrompt from "../../components/WalletPrompt";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export default function VerifyPage() {
  const [projectId, setProjectId] = useState("");
  const [action, setAction]       = useState<"approve" | "reject">("approve");
  const [reason, setReason]       = useState("");
  const [txStatus, setTxStatus]   = useState<TxStatus | null>(null);
  const [txHash, setTxHash]       = useState<string | null>(null);
  const { toasts, addToast, dismiss } = useToast();
  const { status: walletStatus, address: walletKey, refresh: refreshWallet } = useWalletStatus();

  async function handleConnect(key: string) {
    addToast({ type: "success", title: "Wallet connected", message: key.slice(0, 8) + "…" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletKey || !projectId) return;
    
    setTxStatus("building");
    try {
      // Simulate building phase
      await new Promise(r => setTimeout(r, 800));
      
      setTxStatus("signing");
      // In a real app, we would sign with Freighter here
      await new Promise(r => setTimeout(r, 1200));

      setTxStatus("submitting");
      const endpoint = action === "approve" ? "verify" : "reject";
      const res = await fetch(`${API_URL}/projects/${projectId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifierPublicKey: walletKey, reason }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const data = await res.json();
      
      setTxStatus("polling");
      await new Promise(r => setTimeout(r, 2000));

      setTxHash(data.txHash);
      setTxStatus("confirmed");
      addToast({ type: "success", title: `Project ${action === "approve" ? "verified" : "rejected"}`, txHash: data.txHash });
    } catch (e: any) {
      setTxStatus("failed");
      addToast({ type: "error", title: "Submission failed", message: e.message });
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: `1px solid ${colors.neutral[300]}`,
    borderRadius: "0.5rem", padding: "0.75rem 1rem",
    fontSize: "0.9rem", color: colors.neutral[900], boxSizing: "border-box",
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
        Verifier Portal
      </h1>
      <p style={{ color: colors.neutral[500], margin: "0 0 2rem" }}>
        Accredited verifiers can approve or reject carbon projects. All actions are recorded on-chain.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            Project ID
          </label>
          <input
            type="text" placeholder="proj-001" value={projectId}
            onChange={e => setProjectId(e.target.value)}
            style={inputStyle} required
          />
        </div>

        <div>
          <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            Action
          </label>
          <div style={{ display: "flex", gap: "1rem" }}>
            {(["approve", "reject"] as const).map(a => (
              <label key={a} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="radio" name="action" value={a}
                  checked={action === a} onChange={() => setAction(a)}
                  style={{ accentColor: a === "approve" ? colors.primary[600] : "#dc2626" }}
                />
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: a === "approve" ? colors.primary[700] : "#dc2626" }}>
                  {a === "approve" ? "✅ Approve Project" : "❌ Reject Project"}
                </span>
              </label>
            ))}
          </div>
        </div>

        {action === "reject" && (
          <div>
            <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
              Rejection Reason
            </label>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)}
              rows={3} style={{ ...inputStyle, resize: "vertical" }}
              placeholder="Describe why this project is being rejected…"
              required
            />
          </div>
        )}

        {txStatus && <TransactionStatus status={txStatus} txHash={txHash ?? undefined} />}

        {walletStatus !== "ready" ? (
          <WalletPrompt status={walletStatus} onConnect={handleConnect} refresh={refreshWallet} />
        ) : (
          <button type="submit" style={{
            background: action === "approve" ? colors.primary[600] : "#dc2626",
            color: "#fff", border: "none", borderRadius: "0.5rem",
            padding: "0.875rem", fontSize: "1rem", fontWeight: 700, cursor: "pointer",
          }}>
            Submit On-Chain Attestation
          </button>
        )}
      </form>

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
