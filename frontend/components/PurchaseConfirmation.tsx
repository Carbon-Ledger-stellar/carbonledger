"use client";

import { colors } from "../styles/design-system";

interface PurchaseConfirmationProps {
  /** Project the credits were purchased from. */
  projectName: string;
  /** Tonnes purchased, already formatted (e.g. "10 tCO₂e"). */
  tonnesLabel: string;
  /** Total USDC paid, already formatted (e.g. "$100.00 USDC"). */
  totalLabel: string;
  /** On-chain transaction hash (optional). */
  txHash?: string;
  /** Where the "View purchase history" link points (default: /dashboard). */
  historyHref?: string;
}

/**
 * PurchaseConfirmation — buy-flow usability test #1544 (finding F3).
 *
 * After a successful purchase the previous UI only showed a transient toast
 * ("{tonnes} acquired"), so buyers could not confirm what they bought or find
 * the record afterwards. This persistent confirmation card restates the
 * project name, amount, total cost, transaction hash, and links to the
 * purchase history.
 */
export default function PurchaseConfirmation({
  projectName,
  tonnesLabel,
  totalLabel,
  txHash,
  historyHref = "/dashboard",
}: PurchaseConfirmationProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Purchase confirmed"
      style={{
        background: colors.verified.bg,
        border: `1px solid ${colors.verified.border}`,
        borderRadius: "0.75rem",
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span aria-hidden="true" style={{ fontSize: "1.25rem" }}>
          ✅
        </span>
        <p
          style={{
            margin: 0,
            fontSize: "1rem",
            fontWeight: 700,
            color: colors.verified.text,
          }}
        >
          Purchase confirmed
        </p>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: "1rem",
          fontWeight: 700,
          color: colors.neutral[900],
        }}
      >
        {projectName}
      </p>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.75rem",
          borderTop: `1px solid ${colors.verified.border}`,
          paddingTop: "0.5rem",
        }}
      >
        <span style={{ fontSize: "0.875rem", color: colors.neutral[600] }}>
          {tonnesLabel}
        </span>
        <span
          style={{
            fontSize: "0.95rem",
            fontWeight: 700,
            color: colors.primary[700],
          }}
        >
          {totalLabel}
        </span>
      </div>

      {txHash && (
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            color: colors.neutral[500],
            fontFamily: "monospace",
            wordBreak: "break-all",
          }}
        >
          Tx {txHash.slice(0, 12)}…{txHash.slice(-12)}
        </p>
      )}

      <a
        href={historyHref}
        style={{
          fontSize: "0.875rem",
          color: colors.primary[600],
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        View purchase history →
      </a>
    </section>
  );
}
