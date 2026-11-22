"use client";

import { colors } from "../styles/design-system";

interface WalletRequiredNoticeProps {
  /** Render the notice. Hide it once a wallet is connected/ready. */
  visible: boolean;
  /** Accessible label for the notice region. */
  label?: string;
}

/**
 * WalletRequiredNotice — buy-flow usability test #1544 (finding F2).
 *
 * Surfaced at the top of the buy flow so a first-time buyer learns *before* the
 * wallet-connect step that a Stellar (Freighter) wallet is required to sign the
 * purchase. Previously the wallet prompt only appeared after the user had
 * already entered an amount and clicked "Preview purchase".
 */
export default function WalletRequiredNotice({
  visible,
  label = "Wallet required to complete this purchase",
}: WalletRequiredNoticeProps) {
  if (!visible) return null;

  return (
    <section
      role="note"
      aria-label={label}
      style={{
        display: "flex",
        gap: "0.6rem",
        alignItems: "flex-start",
        background: colors.primary[50],
        border: `1px solid ${colors.primary[200]}`,
        borderRadius: "0.5rem",
        padding: "0.75rem 1rem",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "1rem", lineHeight: 1.4 }}>
        🦊
      </span>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: "0.875rem",
            fontWeight: 700,
            color: colors.neutral[800],
          }}
        >
          A Stellar wallet is required to sign this purchase
        </p>
        <p
          style={{
            margin: "0.2rem 0 0",
            fontSize: "0.8rem",
            color: colors.neutral[600],
            lineHeight: 1.45,
          }}
        >
          You&apos;ll be asked to connect your Freighter wallet and approve the
          transaction before checkout. No payment leaves your account until you
          sign in your wallet.
        </p>
      </div>
    </section>
  );
}
