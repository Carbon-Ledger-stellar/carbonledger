"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useListing, purchaseCredits } from "../../lib/api";
import { formatStroops, formatTonnes, calculateCreditCost } from "../../lib/carbon-utils";
import { connectFreighter, getPublicKey } from "../../lib/freighter";
import { getWalletErrorMessage } from "../../lib/wallet-errors";
import { colors } from "../../styles/design-system";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import Toast, { useToast } from "../../components/Toast";
import { useWalletStatus } from "../../hooks/useWalletStatus";
import WalletPrompt from "../../components/WalletPrompt";

export default function BuyPage() {
  const searchParams = useSearchParams();
  const listingId    = searchParams.get("listing") ?? "";

  const { data: listing } = useListing(listingId);
  const [amount, setAmount]     = useState(1);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txHash, setTxHash]     = useState<string | null>(null);
  const [retireAfter, setRetireAfter] = useState(false);
  const { toasts, addToast, dismiss } = useToast();
  const { status: walletStatus, address: walletKey, refresh: refreshWallet } = useWalletStatus();

  const totalCost = listing
    ? calculateCreditCost(amount, BigInt(listing.pricePerCredit))
    : 0n;

  async function handleConnect(key: string) {
    addToast({ type: "success", title: "Wallet connected", message: key.slice(0, 8) + "…" });
  }

  async function handlePurchase() {
    if (!walletKey || !listing) return;
    setTxStatus("pending");
    try {
      setTxStatus("submitted");
      const result = await purchaseCredits(listing.listingId, amount, walletKey);
      setTxHash(result.txHash);
      setTxStatus("confirmed");
      addToast({ type: "success", title: "Purchase confirmed!", message: `${formatTonnes(amount)} acquired`, txHash: result.txHash });
      if (retireAfter) {
        window.location.href = `/retire?batch=${result.batchId}`;
      }
    } catch (e: any) {
      setTxStatus("failed");
      addToast({ type: "error", title: "Purchase failed", message: e.message });
    }
  }

  return (
    <ErrorBoundary>
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <a href="/marketplace" style={{ fontSize: "0.875rem", color: colors.primary[600], textDecoration: "none" }}>
        ← Back to Marketplace
      </a>

      <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "1rem 0 0.5rem" }}>
        Purchase Carbon Credits
      </h1>

      {!listing ? (
        <p style={{ color: colors.neutral[400] }}>Select a listing from the marketplace.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", marginTop: "1.5rem" }}>
          {/* Listing summary */}
          <div style={{
            background: colors.primary[50], border: `1px solid ${colors.primary[200]}`,
            borderRadius: "0.75rem", padding: "1.25rem",
          }}>
            <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: "0 0 0.25rem" }}>
              {listing.country} · {listing.vintageYear} Vintage · {listing.methodology}
            </p>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: colors.neutral[900], margin: "0 0 0.75rem" }}>
              {listing.projectName || listing.projectId}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: "0 0 0.1rem" }}>Available</p>
                <p style={{ fontWeight: 700, color: colors.neutral[800], margin: 0 }}>{formatTonnes(listing.amountAvailable)}</p>
              </div>
              <div>
                <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: "0 0 0.1rem" }}>Price per tonne</p>
                <p style={{ fontWeight: 700, color: colors.primary[700], margin: 0 }}>${formatStroops(listing.pricePerCredit)} USDC</p>
              </div>
            </div>
          </div>

          {/* Amount selector */}
          <div style={{
            background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.75rem", padding: "1.25rem",
          }}>
            <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.5rem" }}>
              Amount (tonnes CO₂e) — minimum 0.01 tCO₂e
            </label>
            <input
              id="buy-amount"
              type="number"
              min={0.01}
              max={listing.amountAvailable}
              step={0.01}
              value={amount}
              onChange={e => {
                const v = parseFloat(parseFloat(e.target.value).toFixed(2));
                setAmount(Math.max(0.01, Math.min(listing.amountAvailable, v || 0.01)));
              }}
              style={{
                width: "100%", border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.5rem", padding: "0.75rem 1rem",
                fontSize: "1.25rem", fontWeight: 700, color: colors.neutral[900],
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.75rem" }}>
              <span style={{ fontSize: "0.875rem", color: colors.neutral[500] }}>Total cost</span>
              <span id="buy-total-cost" style={{ fontSize: "1.25rem", fontWeight: 800, color: colors.primary[700] }}>
                ${formatStroops(totalCost)} USDC
              </span>
            </div>
          </div>

          {/* Retire at checkout option */}
          <label htmlFor="buy-retire-after" style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
            <input
              id="buy-retire-after"
              type="checkbox"
              checked={retireAfter}
              onChange={e => setRetireAfter(e.target.checked)}
              style={{ width: "1.1rem", height: "1.1rem", accentColor: colors.primary[600] }}
            />
            <span style={{ fontSize: "0.875rem", color: colors.neutral[700] }}>
              Retire immediately after purchase (for ESG reporting)
            </span>
          </label>

          {/* Transaction status */}
          {txStatus && (
            <TransactionStatus status={txStatus} txHash={txHash ?? undefined} />
          )}

          {/* CTA / Wallet Prompt */}
          {walletStatus !== "ready" ? (
            <WalletPrompt status={walletStatus} onConnect={handleConnect} refresh={refreshWallet} />
          ) : (
            <button
              type="button"
              onClick={handlePurchase}
              disabled={txStatus === "submitted" || txStatus === "pending"}
              aria-disabled={txStatus === "submitted" || txStatus === "pending"}
              style={{
                background: txStatus === "confirmed" ? colors.neutral[300] : colors.primary[600],
                color: "#fff", border: "none", borderRadius: "0.5rem",
                padding: "0.875rem", fontSize: "1rem", fontWeight: 700,
                cursor: txStatus === "submitted" ? "not-allowed" : "pointer",
              }}
            >
              {txStatus === "pending"   ? "Preparing…"   :
               txStatus === "submitted" ? "Confirming…"  :
               txStatus === "confirmed" ? "Purchase Complete ✓" :
               `Purchase ${formatTonnes(amount)} for $${formatStroops(totalCost)} USDC`}
            </button>
          )}
        </div>
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
    </ErrorBoundary>
  );
}
