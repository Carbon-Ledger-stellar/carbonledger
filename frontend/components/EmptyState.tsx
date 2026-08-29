"use client";

import { colors } from "../styles/design-system";

interface EmptyStateProps {
  title?: string;
  description?: string;
}

/**
 * Generic placeholder shown wherever a list/collection has no items to
 * display (empty marketplace, empty project batches, empty search
 * results, etc).
 */
export function EmptyState({ title = "No data available", description }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "3rem 2rem",
        background: colors.surfaceAlt,
        borderRadius: "1rem",
        border: `1px solid ${colors.neutral[200]}`,
      }}
    >
      <p style={{ color: colors.neutral[900], fontWeight: 700, fontSize: "1.125rem", margin: description ? "0 0 0.5rem" : 0 }}>
        {title}
      </p>
      {description && (
        <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: 0 }}>{description}</p>
      )}
    </div>
  );
}
