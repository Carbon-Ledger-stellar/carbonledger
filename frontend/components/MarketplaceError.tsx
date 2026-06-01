"use client";

import { colors } from "../styles/design-system";

interface Props {
  error: Error;
  onRetry: () => void;
}

export default function MarketplaceError({ error, onRetry }: Props) {
  return (
    <div
      role="alert"
      style={{
        textAlign: "center",
        padding: "4rem 2rem",
        background: colors.surfaceAlt,
        borderRadius: "1rem",
        marginTop: "1.5rem",
        border: `1px solid ${colors.neutral[200]}`,
      }}
    >
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
      <p style={{ color: colors.neutral[900], fontWeight: 700, fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
        Unable to load listings
      </p>
      <p style={{ color: colors.neutral[500], fontSize: "0.875rem", marginBottom: "2rem" }}>
        We couldn&apos;t reach the marketplace right now. Please check your connection and try again.
      </p>
      <button
        onClick={onRetry}
        style={{
          padding: "0.75rem 1.5rem",
          border: "none",
          borderRadius: "0.5rem",
          background: colors.primary[600],
          color: "#fff",
          fontSize: "0.875rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Retry
      </button>
    </div>
  );
}
