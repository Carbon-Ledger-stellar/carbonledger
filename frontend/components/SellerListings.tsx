"use client";

/**
 * SellerListings — displays a seller's active marketplace listings and
 * provides a guarded delist action for each. (#1512)
 *
 * Before removing a listing the user sees DelistConfirmDialog which
 * summarises the listing and requires explicit confirmation. No single-click
 * delist is possible.
 */

import { useState } from "react";
import { colors } from "../styles/design-system";
import { formatStroops, formatTonnes } from "../lib/carbon-utils";
import { delistListing } from "../lib/api";
import type { MarketListing } from "../lib/api";
import DelistConfirmDialog from "./DelistConfirmDialog";

interface Props {
  listings: MarketListing[];
  sellerPublicKey: string;
  onDelisted?: (listingId: string) => void;
}

export default function SellerListings({ listings, sellerPublicKey, onDelisted }: Props) {
  const [pendingDelist, setPendingDelist] = useState<MarketListing | null>(null);
  const [delistedIds, setDelistedIds] = useState<Set<string>>(new Set());

  const activeListings = listings.filter((l) => !delistedIds.has(l.listingId));

  async function handleConfirmDelist() {
    if (!pendingDelist) return;
    await delistListing(pendingDelist.listingId, sellerPublicKey);
    setDelistedIds((prev) => new Set([...prev, pendingDelist.listingId]));
    onDelisted?.(pendingDelist.listingId);
    setPendingDelist(null);
  }

  if (activeListings.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "3rem 1.5rem",
          background: colors.neutral[50],
          borderRadius: "0.75rem",
          color: colors.neutral[500],
        }}
      >
        <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>📋</p>
        <p style={{ margin: 0, fontWeight: 600 }}>No active listings</p>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
          Credits you list on the marketplace will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {activeListings.map((listing) => {
          const projectLabel = listing.projectName || listing.projectId;
          return (
            <div
              key={listing.listingId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                gap: "1rem",
                background: colors.surface,
                border: `1px solid ${colors.neutral[200]}`,
                borderRadius: "0.75rem",
                padding: "1rem 1.25rem",
              }}
            >
              {/* Info */}
              <div>
                <p
                  style={{
                    fontWeight: 700,
                    fontSize: "0.95rem",
                    color: colors.neutral[900],
                    margin: "0 0 0.25rem",
                  }}
                >
                  {projectLabel}
                </p>
                <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: 0 }}>
                  {listing.methodology} · {listing.vintageYear} ·{" "}
                  {formatTonnes(listing.amountAvailable)} ·{" "}
                  <strong style={{ color: colors.primary[700] }}>
                    ${formatStroops(listing.pricePerCredit)} USDC
                  </strong>
                </p>
              </div>

              {/* Delist button — opens confirmation dialog, not an immediate action */}
              <button
                type="button"
                onClick={() => setPendingDelist(listing)}
                aria-label={`Remove listing for ${projectLabel}`}
                style={{
                  background: "transparent",
                  border: `1px solid ${colors.neutral[300]}`,
                  borderRadius: "0.375rem",
                  padding: "0.4rem 0.75rem",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: colors.neutral[600],
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Remove listing
              </button>
            </div>
          );
        })}
      </div>

      {pendingDelist && (
        <DelistConfirmDialog
          listing={pendingDelist}
          onConfirm={handleConfirmDelist}
          onCancel={() => setPendingDelist(null)}
        />
      )}
    </>
  );
}
