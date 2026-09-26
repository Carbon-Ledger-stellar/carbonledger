"use client";

import { colors } from "../styles/design-system";
import { EmptyState } from "./EmptyState";
import type { MarketListing } from "../lib/api";

interface MarketplaceProps {
  listings?: MarketListing[];
}

/**
 * Renders a grid of marketplace listing cards, or an empty-state message
 * when there are none to show (including when `listings` is undefined,
 * e.g. before the first fetch resolves).
 */
export function Marketplace({ listings }: MarketplaceProps) {
  if (!listings || listings.length === 0) {
    return (
      <EmptyState
        title="No listings available"
        description="Check back soon, or try adjusting your search filters."
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {listings.map((listing) => (
        <div
          key={listing.id}
          data-testid="listing-card"
          style={{
            padding: "1.25rem",
            background: colors.surface,
            borderRadius: "0.75rem",
            border: `1px solid ${colors.neutral[200]}`,
          }}
        >
          <p style={{ color: colors.neutral[900], fontWeight: 700, margin: "0 0 0.25rem" }}>
            {listing.projectName}
          </p>
          <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: 0 }}>
            {listing.methodology} · {listing.vintageYear} · {listing.amountAvailable} tCO₂e available
          </p>
        </div>
      ))}
    </div>
  );
}
