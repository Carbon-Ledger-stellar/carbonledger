"use client";

import { useState, useRef, useEffect } from "react";
import { bulkPurchase } from "../lib/api";
import { useCartStore } from "../lib/use-cart-store";
import { connectFreighter } from "../lib/freighter";
import { getWalletErrorMessage } from "../lib/wallet-errors";
import { formatStroops, formatTonnes } from "../lib/carbon-utils";
import { colors } from "../styles/design-system";
import TransactionStatus, { TxStatus } from "./TransactionStatus";
import Toast, { useToast } from "./Toast";

export default function BulkPurchaseCart() {
  const { items, removeItem, clearCart, subtotalStroops, protocolFeeStroops, totalStroops, totalTonnes } = useCartStore();
  const [walletKey, setWalletKey] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const { toasts, addToast, dismiss } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  async function handleConnect() {
    try {
      const key = await connectFreighter();
      setWalletKey(key);
      addToast({ type: "success", title: "Wallet connected", message: key.slice(0, 8) + "…" });
    } catch (e) {
      addToast({ type: "error", title: "Wallet error", message: getWalletErrorMessage(e) });
    }
  }

  async function handlePurchase() {
    if (!walletKey || items.length === 0) return;
    setTxStatus("building");
    try {
      await new Promise(r => setTimeout(r, 600));
      setTxStatus("signing");
      await new Promise(r => setTimeout(r, 1000));
      setTxStatus("submitting");
      const result = await bulkPurchase(
        items.map(i => ({ listingId: i.listing.listingId, amount: i.amount })),
        walletKey,
      );
      setTxStatus("polling");
      await new Promise(r => setTimeout(r, 1500));
      setTxHash(result.txHash);
      setTxStatus("confirmed");
      clearCart();
      addToast({ type: "success", title: "Purchase confirmed!", message: `${formatTonnes(totalTonnes)} acquired`, txHash: result.txHash });
    } catch (e: any) {
      setTxStatus("failed");
      addToast({ type: "error", title: "Purchase failed", message: e.message });
    }
  }

  const busy = txStatus && !["confirmed", "failed"].includes(txStatus);

  // Handle touch events for swipe down to dismiss
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const currentTouch = e.touches[0].clientY;
    const diff = currentTouch - touchStart;
    if (diff > 100) { // Swipe down more than 100px
      setDrawerOpen(false);
      setTouchStart(null);
    }
  };

  const handleTouchEnd = () => {
    setTouchStart(null);
  };

  // Close drawer when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    };

    if (drawerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden'; // Prevent background scroll
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [drawerOpen]);

  return (
    <>
      <style>{`
        .bulk-cart-desktop {
          display: block;
        }
        .bulk-cart-mobile-fab {
          display: none;
        }
        .bulk-cart-mobile-drawer {
          display: none;
        }
        @media (max-width: 767px) {
          .bulk-cart-desktop {
            display: none;
          }
          .bulk-cart-mobile-fab {
            display: block;
            position: fixed;
            bottom: 1.5rem;
            right: 1.5rem;
            z-index: 1000;
            background: ${colors.primary[600]};
            color: #fff;
            border: none;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            font-size: 1.5rem;
            cursor: pointer;
            box-shadow: 0 4px 12px rgb(0 0 0 / 0.3);
            transition: transform 0.2s;
          }
          .bulk-cart-mobile-fab:hover {
            transform: scale(1.1);
          }
          .bulk-cart-mobile-fab-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            background: #dc2626;
            color: #fff;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            font-size: 0.75rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .bulk-cart-mobile-drawer {
            display: block;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 999;
            background: ${colors.surface};
            border-radius: 1rem 1rem 0 0;
            box-shadow: 0 -4px 20px rgb(0 0 0 / 0.2);
            max-height: 80vh;
            overflow-y: auto;
            transform: translateY(100%);
            transition: transform 0.3s ease-out;
          }
          .bulk-cart-mobile-drawer.open {
            transform: translateY(0);
          }
          .bulk-cart-mobile-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 998;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s;
          }
          .bulk-cart-mobile-backdrop.open {
            opacity: 1;
            pointer-events: auto;
          }
          .bulk-cart-mobile-header {
            position: sticky;
            top: 0;
            background: ${colors.surface};
            padding: 1rem 1.5rem;
            border-bottom: 1px solid ${colors.neutral[200]};
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 1;
          }
        }
      `}</style>

      {/* Desktop version (>=768px) */}
      <div className="bulk-cart-desktop">
        <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", padding: "1.5rem" }}>
      <h3 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[900], margin: "0 0 1rem" }}>
        Purchase Cart ({items.length} project{items.length !== 1 ? "s" : ""})
      </h3>

      {items.length === 0 ? (
        <p style={{ color: colors.neutral[400], fontSize: "0.875rem", textAlign: "center", padding: "2rem 0" }}>
          Add credits from the marketplace to build your portfolio
        </p>
      ) : (
        <>
          {/* Per-project breakdown */}
          {items.map(({ listing, amount }) => {
            const lineCost = BigInt(listing.pricePerCredit) * BigInt(amount);
            return (
              <div key={listing.listingId} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.75rem 0", borderBottom: `1px solid ${colors.neutral[100]}`,
              }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: "0.875rem", color: colors.neutral[800], margin: 0 }}>
                    {listing.projectName || listing.projectId}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: "0.1rem 0 0" }}>
                    {listing.methodology} · {listing.vintageYear} · {formatTonnes(amount)}
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontWeight: 700, color: colors.primary[700], fontSize: "0.9rem" }}>
                    ${formatStroops(lineCost)}
                  </span>
                  <button
                    onClick={() => removeItem(listing.listingId)}
                    disabled={!!busy}
                    aria-label="Remove"
                    style={{ background: "transparent", border: "none", color: colors.neutral[400], cursor: "pointer", fontSize: "1rem", padding: "0.2rem" }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          {/* Cost breakdown */}
          <div style={{ marginTop: "1rem", padding: "1rem", background: colors.primary[50], borderRadius: "0.5rem" }}>
            <Row label="Subtotal" value={`$${formatStroops(subtotalStroops)} USDC`} />
            <Row label="Protocol fee (1%)" value={`$${formatStroops(protocolFeeStroops)} USDC`} muted />
            <div style={{ borderTop: `1px solid ${colors.primary[200]}`, margin: "0.5rem 0" }} />
            <Row label={`Total · ${formatTonnes(totalTonnes)}`} value={`$${formatStroops(totalStroops)} USDC`} bold />
          </div>

          {/* Tx status */}
          {txStatus && (
            <div style={{ marginTop: "1rem" }}>
              <TransactionStatus status={txStatus} txHash={txHash ?? undefined} onRetry={txStatus === "failed" ? handlePurchase : undefined} />
            </div>
          )}

          {/* CTA */}
          <div style={{ marginTop: "1rem" }}>
            {!walletKey ? (
              <button onClick={handleConnect} style={btnStyle(colors.primary[600])}>
                Connect Wallet to Purchase
              </button>
            ) : (
              <button onClick={handlePurchase} disabled={!!busy || txStatus === "confirmed"} style={btnStyle(busy || txStatus === "confirmed" ? colors.neutral[300] : colors.primary[600], !!busy)}>
                {txStatus === "confirmed" ? "Purchase Complete ✓" :
                 busy ? "Processing…" :
                 `Purchase ${formatTonnes(totalTonnes)} for $${formatStroops(totalStroops)} USDC`}
              </button>
            )}
          </div>
        </>
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
      </div>

      {/* Mobile FAB (<768px) */}
      {items.length > 0 && (
        <button
          ref={fabRef}
          className="bulk-cart-mobile-fab"
          onClick={() => setDrawerOpen(true)}
          aria-label={`Open cart with ${items.length} items`}
        >
          🛒
          <span className="bulk-cart-mobile-fab-badge">{items.length}</span>
        </button>
      )}

      {/* Mobile Backdrop */}
      <div
        className={`bulk-cart-mobile-backdrop ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Mobile Drawer (<768px) */}
      <div
        ref={drawerRef}
        className={`bulk-cart-mobile-drawer ${drawerOpen ? 'open' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="bulk-cart-mobile-header">
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>
            Purchase Cart ({items.length} project{items.length !== 1 ? "s" : ""})
          </h3>
          <button
            onClick={() => setDrawerOpen(false)}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: colors.neutral[500],
              padding: "0.25rem",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "1.5rem" }}>
          {items.length === 0 ? (
            <p style={{ color: colors.neutral[400], fontSize: "0.875rem", textAlign: "center", padding: "2rem 0" }}>
              Add credits from the marketplace to build your portfolio
            </p>
          ) : (
            <>
              {/* Per-project breakdown */}
              {items.map(({ listing, amount }) => {
                const lineCost = BigInt(listing.pricePerCredit) * BigInt(amount);
                return (
                  <div key={listing.listingId} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.75rem 0", borderBottom: `1px solid ${colors.neutral[100]}`,
                  }}>
                    <div>
                      <p style={{ fontWeight: 600, fontSize: "0.875rem", color: colors.neutral[800], margin: 0 }}>
                        {listing.projectName || listing.projectId}
                      </p>
                      <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: "0.1rem 0 0" }}>
                        {listing.methodology} · {listing.vintageYear} · {formatTonnes(amount)}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span style={{ fontWeight: 700, color: colors.primary[700], fontSize: "0.9rem" }}>
                        ${formatStroops(lineCost)}
                      </span>
                      <button
                        onClick={() => removeItem(listing.listingId)}
                        disabled={!!busy}
                        aria-label="Remove"
                        style={{ background: "transparent", border: "none", color: colors.neutral[400], cursor: "pointer", fontSize: "1rem", padding: "0.2rem" }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Cost breakdown */}
              <div style={{ marginTop: "1rem", padding: "1rem", background: colors.primary[50], borderRadius: "0.5rem" }}>
                <Row label="Subtotal" value={`$${formatStroops(subtotalStroops)} USDC`} />
                <Row label="Protocol fee (1%)" value={`$${formatStroops(protocolFeeStroops)} USDC`} muted />
                <div style={{ borderTop: `1px solid ${colors.primary[200]}`, margin: "0.5rem 0" }} />
                <Row label={`Total · ${formatTonnes(totalTonnes)}`} value={`$${formatStroops(totalStroops)} USDC`} bold />
              </div>

              {/* Tx status */}
              {txStatus && (
                <div style={{ marginTop: "1rem" }}>
                  <TransactionStatus status={txStatus} txHash={txHash ?? undefined} onRetry={txStatus === "failed" ? handlePurchase : undefined} />
                </div>
              )}

              {/* CTA */}
              <div style={{ marginTop: "1rem" }}>
                {!walletKey ? (
                  <button onClick={handleConnect} style={btnStyle(colors.primary[600])}>
                    Connect Wallet to Purchase
                  </button>
                ) : (
                  <button onClick={handlePurchase} disabled={!!busy || txStatus === "confirmed"} style={btnStyle(busy || txStatus === "confirmed" ? colors.neutral[300] : colors.primary[600], !!busy)}>
                    {txStatus === "confirmed" ? "Purchase Complete ✓" :
                     busy ? "Processing…" :
                     `Purchase ${formatTonnes(totalTonnes)} for $${formatStroops(totalStroops)} USDC`}
                  </button>
                )}
              </div>
            </>
          )}

          <Toast toasts={toasts} onDismiss={dismiss} />
        </div>
      </div>
    </>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
      <span style={{ fontSize: "0.875rem", color: muted ? colors.neutral[400] : colors.neutral[600] }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: bold ? colors.primary[700] : colors.neutral[700], fontSize: bold ? "1rem" : "0.875rem" }}>{value}</span>
    </div>
  );
}

function btnStyle(bg: string, notAllowed = false): React.CSSProperties {
  return {
    background: bg, color: "#fff", border: "none", borderRadius: "0.5rem",
    padding: "0.75rem", fontSize: "0.9rem", fontWeight: 700,
    cursor: notAllowed ? "not-allowed" : "pointer", width: "100%",
  };
}
