"use client";

/**
 * DelistConfirmDialog — confirmation modal shown before a seller removes
 * a listing from the marketplace. (#1512)
 *
 * Surfaces the listing summary (project name, available tonnes, price) so the
 * seller can confirm they're delisting the right credit. The destructive
 * action button is styled in red to signal irreversibility.
 *
 * Usage:
 *   const [pendingDelist, setPendingDelist] = useState<MarketListing | null>(null);
 *
 *   <button onClick={() => setPendingDelist(listing)}>Remove listing</button>
 *
 *   {pendingDelist && (
 *     <DelistConfirmDialog
 *       listing={pendingDelist}
 *       onConfirm={async () => { await delistListing(pendingDelist.listingId, walletKey); ... }}
 *       onCancel={() => setPendingDelist(null)}
 *     />
 *   )}
 */

import { useEffect, useRef, useState } from "react";
import { colors } from "../styles/design-system";
import { formatStroops, formatTonnes } from "../lib/carbon-utils";
import type { MarketListing } from "../lib/api";

interface Props {
  listing: MarketListing;
  /**
   * Called when the user confirms the delist. May be async — the dialog
   * shows a loading state while the promise is pending.
   */
  onConfirm: () => Promise<void> | void;
  /** Called when the user cancels or presses Escape. */
  onCancel: () => void;
}

export default function DelistConfirmDialog({ listing, onConfirm, onCancel }: Props) {
  const dialogRef = useRef(null as HTMLDivElement | null);
  const cancelRef = useRef(null as HTMLButtonElement | null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null as string | null);

  const projectLabel = listing.projectName || listing.projectId;

  // Focus cancel button on mount; trap Tab within the dialog.
  useEffect(() => {
    cancelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delist. Please try again.");
      setConfirming(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
      aria-hidden="false"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delist-dialog-title"
        aria-describedby="delist-dialog-desc"
        style={{
          background: "#fff",
          borderRadius: "0.75rem",
          padding: "2rem",
          maxWidth: "480px",
          width: "90%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        {/* Title */}
        <h2
          id="delist-dialog-title"
          style={{ margin: "0 0 0.5rem", fontSize: "1.125rem", fontWeight: 700, color: colors.neutral[900] }}
        >
          Remove listing from marketplace?
        </h2>
        <p
          id="delist-dialog-desc"
          style={{ margin: "0 0 1.25rem", fontSize: "0.875rem", color: colors.neutral[600] }}
        >
          This will immediately remove the listing. Buyers won&apos;t be able to purchase
          these credits until you re-list them.
        </p>

        {/* Listing summary */}
        <div
          style={{
            background: colors.neutral[50],
            border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          <Row label="Project" value={projectLabel} />
          <Row label="Methodology" value={listing.methodology} />
          <Row label="Vintage" value={String(listing.vintageYear)} />
          <Row label="Available" value={formatTonnes(listing.amountAvailable)} />
          <Row label="Price per tonne" value={`$${formatStroops(listing.pricePerCredit)} USDC`} />
        </div>

        {/* Error */}
        {error && (
          <p
            role="alert"
            style={{
              margin: "0 0 1rem",
              fontSize: "0.875rem",
              color: "#b91c1c",
              fontWeight: 600,
            }}
          >
            ⚠ {error}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={confirming}
            style={{
              background: "transparent",
              border: `1px solid ${colors.neutral[300]}`,
              borderRadius: "0.5rem",
              padding: "0.6rem 1.1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: colors.neutral[600],
              cursor: confirming ? "not-allowed" : "pointer",
              opacity: confirming ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming}
            aria-busy={confirming}
            style={{
              background: confirming ? "#fca5a5" : "#dc2626",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.6rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 700,
              color: "#fff",
              cursor: confirming ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              transition: "background 0.15s",
            }}
          >
            {confirming && (
              <span
                style={{
                  width: "0.875rem",
                  height: "0.875rem",
                  border: "2px solid #ffffff60",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }}
                aria-hidden="true"
              />
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            {confirming ? "Removing…" : "Remove listing"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
      <span style={{ fontSize: "0.8rem", color: colors.neutral[500] }}>{label}</span>
      <span style={{ fontSize: "0.8rem", fontWeight: 600, color: colors.neutral[800], textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
