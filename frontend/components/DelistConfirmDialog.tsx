"use client";

import { MarketListing } from "../lib/api";
import { colors } from "../styles/design-system";

interface Props {
  listing: MarketListing;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Set true while the delist API call is in-flight */
  isDelisting?: boolean;
}

const formatPrice = (pricePerCredit: string): string =>
  (Number(pricePerCredit) / 1e7).toFixed(2);

export default function DelistConfirmDialog({
  listing,
  isOpen,
  onConfirm,
  onCancel,
  isDelisting = false,
}: Props) {
  if (!isOpen) return null;

  const projectLabel = listing.projectName || listing.projectId;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delist-dialog-title"
        style={{
          maxWidth: 480,
          width: "calc(100% - 2rem)",
          background: "white",
          borderRadius: "1rem",
          padding: "1.5rem",
          boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
        }}
      >
        {/* Warning icon */}
        <div
          style={{
            textAlign: "center",
            marginBottom: "1rem",
            fontSize: "2.5rem",
          }}
        >
          ⚠️
        </div>

        {/* Title */}
        <h2
          id="delist-dialog-title"
          style={{
            color: colors.neutral[900],
            fontSize: "1.25rem",
            fontWeight: 700,
            margin: "0 0 1rem",
          }}
        >
          Remove this listing?
        </h2>

        {/* Listing summary card */}
        <div
          style={{
            background: colors.neutral[50],
            border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          {/* Project name */}
          <p
            style={{
              fontWeight: 700,
              color: colors.neutral[900],
              margin: "0 0 0.25rem",
              fontSize: "0.9375rem",
            }}
          >
            {projectLabel}
          </p>

          {/* Methodology and vintage year */}
          <p
            style={{
              color: colors.neutral[500],
              fontSize: "0.875rem",
              margin: "0 0 0.25rem",
            }}
          >
            {listing.methodology} · {listing.vintageYear}
          </p>

          {/* Amount and price */}
          <p
            style={{
              color: colors.neutral[500],
              fontSize: "0.875rem",
              margin: 0,
            }}
          >
            {listing.amountAvailable} tCO₂e available · ${formatPrice(listing.pricePerCredit)} USDC / credit
          </p>
        </div>

        {/* Warning paragraph */}
        <p
          style={{
            color: colors.suspended.text || "#b91c1c",
            fontSize: "0.875rem",
            margin: "0 0 0",
            lineHeight: 1.5,
          }}
        >
          This action will remove the listing from the marketplace. Buyers will no longer be able to
          purchase these credits. This cannot be undone on-chain.
        </p>

        {/* Button row */}
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            marginTop: "1.5rem",
          }}
        >
          {/* Cancel */}
          <button
            onClick={onCancel}
            disabled={isDelisting}
            style={{
              background: "transparent",
              border: `1px solid ${colors.neutral[300]}`,
              color: colors.neutral[700],
              flex: 1,
              padding: "0.75rem",
              borderRadius: "0.5rem",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: isDelisting ? "not-allowed" : "pointer",
              opacity: isDelisting ? 0.6 : 1,
            }}
          >
            Cancel
          </button>

          {/* Confirm delist */}
          <button
            onClick={onConfirm}
            disabled={isDelisting}
            style={{
              background: "#dc2626",
              color: "white",
              border: "none",
              flex: 1,
              padding: "0.75rem",
              borderRadius: "0.5rem",
              fontWeight: 700,
              fontSize: "0.875rem",
              cursor: isDelisting ? "not-allowed" : "pointer",
              opacity: isDelisting ? 0.75 : 1,
            }}
          >
            {isDelisting ? "Delisting…" : "Remove listing"}
          </button>
        </div>
      </div>
    </div>
  );
}

// A button that opens the DelistConfirmDialog when clicked
export function DelistButton({
  listing,
  onDelist,
}: {
  listing: MarketListing;
  onDelist: () => void;
}) {
  return (
    <button
      onClick={onDelist}
      style={{
        color: "#dc2626",
        border: "1px solid #dc2626",
        background: "transparent",
        borderRadius: "0.5rem",
        padding: "0.5rem 1rem",
        fontSize: "0.875rem",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Remove listing
    </button>
  );
}
