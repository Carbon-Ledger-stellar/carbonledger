"use client";

import { useState } from "react";
import { colors } from "../styles/design-system";

interface Props {
  error: Error;
  onRetry: () => void | Promise<void>;
}

function isNetworkError(error: Error): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.name === "TypeError" ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("failed to fetch") ||
    message.includes("offline") ||
    message.includes("connection")
  );
}

export default function MarketplaceError({ error, onRetry }: Props) {
  const [isRetrying, setIsRetrying] = useState(false);
  const networkError = isNetworkError(error);

  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

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
        {networkError ? "Connection problem" : "Unable to load listings"}
      </p>
      <p style={{ color: colors.neutral[500], fontSize: "0.875rem", marginBottom: "2rem" }}>
        {networkError
          ? "We couldn&apos;t reach the marketplace. Please check your connection and try again."
          : "The marketplace ran into a server error. Please try again in a moment."}
      </p>
      <button
        onClick={handleRetry}
        disabled={isRetrying}
        aria-busy={isRetrying}
        style={{
          padding: "0.75rem 1.5rem",
          border: "none",
          borderRadius: "0.5rem",
          background: colors.primary[600],
          color: "#fff",
          fontSize: "0.875rem",
          fontWeight: 600,
          cursor: isRetrying ? "not-allowed" : "pointer",
          opacity: isRetrying ? 0.7 : 1,
        }}
      >
        {isRetrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
