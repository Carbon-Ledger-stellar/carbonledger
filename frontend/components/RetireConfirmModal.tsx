"use client";

import { colors } from "../styles/design-system";
import { formatTonnes } from "../lib/carbon-utils";

interface Props {
  amount: number;
  beneficiary: string;
  reason: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function RetireConfirmModal({ amount, beneficiary, reason, onConfirm, onCancel }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="retire-modal-title"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div style={{
        background: "#fff", borderRadius: "0.75rem",
        padding: "2rem", maxWidth: "480px", width: "90%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
      }}>
        <h2 id="retire-modal-title" style={{ fontSize: "1.25rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
          Confirm Retirement
        </h2>
        <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: "0 0 1.5rem" }}>
          This action is <strong>permanent and irreversible</strong> on the Stellar blockchain.
        </p>

        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem", margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
          <dt style={{ color: colors.neutral[500], fontWeight: 600 }}>Amount</dt>
          <dd style={{ color: colors.neutral[900], margin: 0, fontWeight: 700 }}>{formatTonnes(amount)}</dd>

          <dt style={{ color: colors.neutral[500], fontWeight: 600 }}>Beneficiary</dt>
          <dd style={{ color: colors.neutral[900], margin: 0 }}>{beneficiary}</dd>

          <dt style={{ color: colors.neutral[500], fontWeight: 600 }}>Reason</dt>
          <dd style={{ color: colors.neutral[900], margin: 0 }}>{reason}</dd>
        </dl>

        <div style={{
          background: "#fef9c3", border: "1px solid #fde047",
          borderRadius: "0.5rem", padding: "0.75rem 1rem",
          fontSize: "0.8rem", color: "#854d0e", marginBottom: "1.5rem",
        }}>
          ⚠️ You will be prompted to sign this transaction in Freighter. Once signed, retirement cannot be undone.
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: "0.75rem", borderRadius: "0.5rem",
              border: `1px solid ${colors.neutral[300]}`, background: "#fff",
              color: colors.neutral[700], fontWeight: 600, cursor: "pointer", fontSize: "0.9rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            data-testid="confirm-retire-btn"
            style={{
              flex: 1, padding: "0.75rem", borderRadius: "0.5rem",
              border: "none", background: "#dc2626",
              color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem",
            }}
          >
            Retire Permanently
          </button>
        </div>
      </div>
    </div>
  );
}
