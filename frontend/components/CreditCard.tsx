"use client";

import { MarketListing } from "../lib/api";
import { formatStroops, formatTonnes, getCountryFlag } from "../lib/carbon-utils";
import { statusBadge, colors } from "../styles/design-system";

interface Props {
  listing: MarketListing;
  onAddToCart?: (listing: MarketListing) => void;
  onBuyNow?: (listing: MarketListing) => void;
}

const methodologyColors: Record<string, string> = {
  VCS:           "#16a34a",
  "Gold Standard": "#d97706",
  ACR:           "#2563eb",
  CAR:           "#7c3aed",
};

export default function CreditCard({ listing, onAddToCart, onBuyNow }: Props) {
  const badge = statusBadge(listing.status);
  const methodColor = methodologyColors[listing.methodology] ?? "#6b7280";
  const priceUSDC = formatStroops(listing.pricePerCredit);
  const projectLabel = listing.projectName || listing.projectId;

  return (
    <article aria-label={`${projectLabel} — ${listing.methodology} ${listing.vintageYear}`} style={{
      background: colors.surface,
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: "0.75rem",
      padding: "1.5rem",
      boxShadow: "0 1px 3px rgb(0 0 0 / 0.08)",
      display: "flex",
      flexDirection: "column",
      gap: "1rem",
      transition: "box-shadow 0.2s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: "0.75rem", color: colors.neutral[500], marginBottom: "0.25rem" }}>
            {getCountryFlag(listing.country)} {listing.country} · {listing.vintageYear} Vintage
          </p>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, color: colors.neutral[900], margin: 0 }}>
            {projectLabel}
          </h3>
        </div>
        <span style={{
          background: badge.bg,
          color: badge.text,
          border: `1px solid ${badge.border}`,
          borderRadius: "9999px",
          padding: "0.2rem 0.6rem",
          fontSize: "0.7rem",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}>
          {listing.status}
        </span>
      </div>

      {/* Methodology badge */}
      <span style={{
        display: "inline-block",
        background: `${methodColor}18`,
        color: methodColor,
        border: `1px solid ${methodColor}40`,
        borderRadius: "0.375rem",
        padding: "0.2rem 0.5rem",
        fontSize: "0.75rem",
        fontWeight: 600,
        width: "fit-content",
      }}>
        {listing.methodology}
      </span>

      {/* Oracle status badge */}
      {listing.oracleDaysSinceUpdate !== undefined && listing.oracleDaysSinceUpdate !== null && (
        <span style={{
          display: "inline-block",
          background: listing.oracleDaysSinceUpdate <= 300 ? colors.verified.bg : colors.suspended.bg,
          color: listing.oracleDaysSinceUpdate <= 300 ? colors.verified.text : colors.suspended.text,
          border: `1px solid ${listing.oracleDaysSinceUpdate <= 300 ? colors.verified.border : colors.suspended.border}`,
          borderRadius: "0.375rem",
          padding: "0.2rem 0.5rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          width: "fit-content",
        }}>
          {listing.oracleDaysSinceUpdate <= 300 ? "Verified" : "Stale Oracle"}
        </span>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div>
          <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: "0 0 0.2rem" }}>
            Available
          </p>
          <p style={{ fontSize: "0.95rem", fontWeight: 600, color: colors.neutral[800], margin: 0 }}>
            {formatTonnes(listing.amountAvailable)}
          </p>
        </div>
        <div>
          <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: "0 0 0.2rem" }}>
            Price per tonne
          </p>
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: colors.primary[700], margin: 0 }}>
            ${priceUSDC} USDC
          </p>
        </div>
      </div>

      {/* CTA */}
      {onBuy && listing.status === "Active" && (
        <button
          onClick={() => onBuy(listing)}
          aria-label={`Purchase carbon credits from ${projectLabel}`}
          style={{
            background: colors.primary[600],
            color: "#fff",
            border: "none",
            borderRadius: "0.5rem",
            padding: "0.6rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: "pointer",
            width: "100%",
          }}
        >
          Purchase Carbon Credits
        </button>
      )}
    </article>
  );
}
