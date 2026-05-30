"use client";

import { useState } from "react";
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

  return (
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
