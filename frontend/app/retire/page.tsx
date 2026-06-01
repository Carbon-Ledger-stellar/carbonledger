"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { retireCredits } from "../../lib/api";
import { formatTonnes } from "../../lib/carbon-utils";
import { connectFreighter } from "../../lib/freighter";
import { getWalletErrorMessage, getContractErrorMessage } from "../../lib/wallet-errors";
import { colors } from "../../styles/design-system";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import Toast, { useToast } from "../../components/Toast";
import RetireConfirmModal from "../../components/RetireConfirmModal";

export default function RetirePage() {
  const searchParams = useSearchParams();
  const batchId      = searchParams.get("batch") ?? "";

  const [amount, setAmount]           = useState(1);
  const [beneficiary, setBeneficiary] = useState("");
  const [reason, setReason]           = useState("");
  const [walletKey, setWalletKey]     = useState<string | null>(null);
  const [txStatus, setTxStatus]       = useState<TxStatus | null>(null);
  const [txHash, setTxHash]           = useState<string | null>(null);
  const [retirementId, setRetirementId] = useState<string | null>(null);
  const [showModal, setShowModal]     = useState(false);
  const { toasts, addToast, dismiss } = useToast();

  async function handleConnect() {
    try {
      const key = await connectFreighter();
      setWalletKey(key);
    } catch (e) {
      addToast({ type: "error", title: "Wallet error", message: getWalletErrorMessage(e) });
    }
  }

  async function handleRetire() {
    if (!walletKey || !batchId || !beneficiary || !reason) return;
    setShowModal(false);
    setTxStatus("pending");
    try {
      setTxStatus("submitted");
      const result = await retireCredits({
        batchId,
        amount,
        beneficiary,
        retirementReason: reason,
        holderPublicKey: walletKey,
      });
      setTxHash(result.txHash);
      setRetirementId(result.retirementId);
      setTxStatus("confirmed");
      addToast({
        type: "success",
        title: "Credits permanently retired",
        message: `${formatTonnes(amount)} retired on behalf of ${beneficiary}`,
        txHash: result.txHash,
      });
    } catch (e: any) {
      setTxStatus("failed");
      addToast({ type: "error", title: "Retirement failed", message: getContractErrorMessage(e) });
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: `1px solid ${colors.neutral[300]}`,
    borderRadius: "0.5rem", padding: "0.75rem 1rem",
    fontSize: "0.9rem", color: colors.neutral[900],
    boxSizing: "border-box",
  };

  const canRetire = !!walletKey && !!beneficiary && !!reason
    && txStatus !== "submitted" && txStatus !== "confirmed";

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
        Retire Carbon Credits
      </h1>
      <p style={{ color: colors.neutral[500], margin: "0 0 2rem" }}>
        Retirement is permanent and irreversible. A verifiable certificate will be issued for ESG reporting.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            Amount to Retire (tonnes CO₂e)
          </label>
          <input
            type="number" min={1} value={amount}
            onChange={e => setAmount(Math.max(1, Number(e.target.value)))}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            Beneficiary Name (appears on certificate)
          </label>
          <input
            type="text"
            placeholder="e.g. Acme Corporation"
            value={beneficiary}
            onChange={e => setBeneficiary(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            Retirement Reason
          </label>
          <textarea
            placeholder="e.g. Offsetting 2023 Scope 1 and 2 emissions"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        <div style={{
          background: "#fef9c3", border: "1px solid #fde047",
          borderRadius: "0.5rem", padding: "0.875rem 1rem",
          display: "flex", gap: "0.75rem",
        }}>
          <span>⚠️</span>
          <p style={{ fontSize: "0.8rem", color: "#854d0e", margin: 0 }}>
            Retirement is <strong>permanent and irreversible</strong>. Once retired, these credits cannot be transferred, resold, or retired again.
          </p>
        </div>

        {txStatus && <TransactionStatus status={txStatus} txHash={txHash ?? undefined} />}

        {retirementId && txStatus === "confirmed" && (
          <a
            href={`/retire/${retirementId}`}
            style={{
              display: "block", textAlign: "center",
              background: colors.primary[50], color: colors.primary[700],
              border: `1px solid ${colors.primary[200]}`,
              borderRadius: "0.5rem", padding: "0.875rem",
              fontSize: "0.9rem", fontWeight: 700, textDecoration: "none",
            }}
          >
            View &amp; Download Certificate →
          </a>
        )}

        {!walletKey ? (
          <button onClick={handleConnect} style={{
            background: colors.primary[600], color: "#fff",
            border: "none", borderRadius: "0.5rem",
            padding: "0.875rem", fontSize: "1rem", fontWeight: 700, cursor: "pointer",
          }}>
            Connect Wallet
          </button>
        ) : (
          <button
            onClick={() => setShowModal(true)}
            disabled={!canRetire}
            style={{
              background: !canRetire ? colors.neutral[300] : "#dc2626",
              color: "#fff", border: "none", borderRadius: "0.5rem",
              padding: "0.875rem", fontSize: "1rem", fontWeight: 700,
              cursor: !canRetire ? "not-allowed" : "pointer",
            }}
          >
            {txStatus === "pending"   ? "Preparing…"   :
             txStatus === "submitted" ? "Confirming…"  :
             txStatus === "confirmed" ? "Retired ✓"    :
             `Permanently Retire ${formatTonnes(amount)}`}
          </button>
        )}
      </div>

      {showModal && (
        <RetireConfirmModal
          amount={amount}
          beneficiary={beneficiary}
          reason={reason}
          onConfirm={handleRetire}
          onCancel={() => setShowModal(false)}
        />
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
