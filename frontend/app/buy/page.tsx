"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useListing, purchaseCredits } from "../../lib/api";
import { useBuyButton } from "../../lib/useBuyButton";
import ErrorBoundary from "../../components/ErrorBoundary";
import { formatTonnes, calculateCreditCost } from "../../lib/carbon-utils";
import { useLocaleFormatters } from "../../lib/i18n/format";
import { getContractErrorMessage } from "../../lib/wallet-errors";
import { colors } from "../../styles/design-system";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import TransactionPreview from "../../components/TransactionPreview";
import { PreviewState } from "../../lib/transaction-preview-types";
import Toast, { useToast } from "../../components/Toast";
import { useWalletStatus } from "../../hooks/useWalletStatus";
import WalletPrompt from "../../components/WalletPrompt";
import { simulatePurchasePreview } from "../../lib/soroban";

// ── Inner component (wrapped in Suspense so useSearchParams is safe) ─────────

function BuyPageContent() {
  const t = useTranslations("buyPage");
  const { formatCurrency } = useLocaleFormatters();
  const searchParams = useSearchParams();
  const listingId = searchParams.get("listing") ?? "";

  const { data: listing } = useListing(listingId);
  const [amount, setAmount] = useState(1);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [retireAfter, setRetireAfter] = useState(false);

  // Simulation state: starts idle; set to loading when amount/listing changes
  const [preview, setPreview] = useState<PreviewState>({
    loading: false,
    ready: false,
    effects: [],
  });
  // Whether the user has confirmed the preview and Freighter is being prompted
  const [confirming, setConfirming] = useState(false);
  // Whether the preview step is showing (true) or the form is still being filled
  const [showPreview, setShowPreview] = useState(false);

  const { toasts, addToast, dismiss } = useToast();
  const { state: buyState, errorMsg: buyError, run: runBuy } = useBuyButton();
  const { status: walletStatus, address: walletKey, refresh: refreshWallet } =
    useWalletStatus();

  const totalCost = listing
    ? calculateCreditCost(amount, BigInt(listing.pricePerCredit))
    : 0n;

  // ── Simulation ──────────────────────────────────────────────────────────────

  const runSimulation = useCallback(async () => {
    if (!listing || !walletKey) return;

    const contractId = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID;
    if (!contractId) {
      // No contract configured; skip simulation and allow purchase directly
      setPreview({ loading: false, ready: true, effects: [] });
      return;
    }

    setPreview({ loading: true, ready: false, effects: [] });
    const result = await simulatePurchasePreview({
      contractId,
      sourcePublicKey: walletKey,
      listingId: listing.listingId,
      amount,
      pricePerCredit: listing.pricePerCredit.toString(),
    });
    setPreview(result);
  }, [listing, walletKey, amount]);

  // Re-run simulation when the user enters the preview step
  useEffect(() => {
    if (showPreview) {
      runSimulation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview]);

  // Re-run simulation when amount changes while preview is visible
  useEffect(() => {
    if (!showPreview) return;
    // Debounce by 400 ms so simulation isn't spammed while the user types
    const timer = setTimeout(() => {
      runSimulation();
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, showPreview]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleConnect(key: string) {
    addToast({
      type: "success",
      title: t("walletConnectedTitle"),
      message: key.slice(0, 8) + "…",
    });
  }

  function handlePreviewRequest() {
    setShowPreview(true);
  }

  function handlePreviewCancel() {
    setShowPreview(false);
    setPreview({ loading: false, ready: false, effects: [] });
  }

  async function handlePurchase() {
    if (!walletKey || !listing) return;
    setConfirming(true);
    let succeeded = false;
    await runBuy(async () => {
      setTxStatus("pending");
      setTxStatus("submitted");
      const result = await purchaseCredits(
        listing.listingId,
        amount,
        walletKey,
      );
      setTxHash(result.txHash);
      setTxStatus("confirmed");
      succeeded = true;
      addToast({
        type: "success",
        title: t("purchaseConfirmedTitle"),
        message: t("purchaseConfirmedMessage", {
          tonnes: formatTonnes(amount),
        }),
        txHash: result.txHash,
      });
      if (retireAfter) {
        window.location.href = `/retire?batch=${result.batchId}`;
      }
    });
    setConfirming(false);
    if (!succeeded) {
      setTxStatus("failed");
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "2.5rem 2rem" }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <a
          href="/marketplace"
          style={{
            fontSize: "0.875rem",
            color: colors.primary[600],
            textDecoration: "none",
          }}
        >
          {t("backToMarketplace")}
        </a>

        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 800,
            color: colors.neutral[900],
            margin: "1rem 0 0.5rem",
          }}
        >
          {t("title")}
        </h1>

        {!listing ? (
          <p style={{ color: colors.neutral[400] }}>{t("selectListing")}</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
              marginTop: "1.5rem",
            }}
          >
            {/* Listing summary */}
            <div
              style={{
                background: colors.primary[50],
                border: `1px solid ${colors.primary[200]}`,
                borderRadius: "0.75rem",
                padding: "1.25rem",
              }}
            >
              <p
                style={{
                  fontSize: "0.75rem",
                  color: colors.neutral[500],
                  margin: "0 0 0.25rem",
                }}
              >
                {listing.country} · {t("vintageLabel", { year: listing.vintageYear })} ·{" "}
                {listing.methodology}
              </p>
              <h2
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: colors.neutral[900],
                  margin: "0 0 0.75rem",
                }}
              >
                {listing.projectName || listing.projectId}
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.75rem",
                }}
              >
                <div>
                  <p
                    style={{
                      fontSize: "0.7rem",
                      color: colors.neutral[500],
                      margin: "0 0 0.1rem",
                    }}
                  >
                    {t("available")}
                  </p>
                  <p
                    style={{
                      fontWeight: 700,
                      color: colors.neutral[800],
                      margin: 0,
                    }}
                  >
                    {formatTonnes(listing.amountAvailable)}
                  </p>
                </div>
                <div>
                  <p
                    style={{
                      fontSize: "0.7rem",
                      color: colors.neutral[500],
                      margin: "0 0 0.1rem",
                    }}
                  >
                    {t("pricePerTonne")}
                  </p>
                  <p
                    style={{
                      fontWeight: 700,
                      color: colors.primary[700],
                      margin: 0,
                    }}
                  >
                    ${formatCurrency(listing.pricePerCredit)} USDC
                  </p>
                </div>
              </div>
            </div>

            {/* Amount selector — only visible before preview step */}
            {!showPreview && (
              <>
                <div
                  style={{
                    background: colors.surface,
                    border: `1px solid ${colors.neutral[200]}`,
                    borderRadius: "0.75rem",
                    padding: "1.25rem",
                  }}
                >
                  <label
                    htmlFor="buy-amount"
                    style={{
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: colors.neutral[700],
                      display: "block",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {t("amountLabel")}
                  </label>
                  <input
                    id="buy-amount"
                    type="number"
                    min={0.01}
                    max={listing.amountAvailable}
                    step={0.01}
                    value={amount}
                    onChange={(e) => {
                      const v = parseFloat(
                        parseFloat(e.target.value).toFixed(2),
                      );
                      setAmount(
                        Math.max(
                          0.01,
                          Math.min(listing.amountAvailable, v || 0.01),
                        ),
                      );
                    }}
                    style={{
                      width: "100%",
                      border: `1px solid ${colors.neutral[300]}`,
                      borderRadius: "0.5rem",
                      padding: "0.75rem 1rem",
                      fontSize: "1.25rem",
                      fontWeight: 700,
                      color: colors.neutral[900],
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: "0.75rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.875rem",
                        color: colors.neutral[500],
                      }}
                    >
                      {t("totalCost")}
                    </span>
                    <span
                      id="buy-total-cost"
                      style={{
                        fontSize: "1.25rem",
                        fontWeight: 800,
                        color: colors.primary[700],
                      }}
                    >
                      ${formatCurrency(totalCost)} USDC
                    </span>
                  </div>
                </div>

                {/* Retire at checkout option */}
                <label
                  htmlFor="buy-retire-after"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  <input
                    id="buy-retire-after"
                    type="checkbox"
                    checked={retireAfter}
                    onChange={(e) => setRetireAfter(e.target.checked)}
                    style={{
                      width: "1.1rem",
                      height: "1.1rem",
                      accentColor: colors.primary[600],
                    }}
                  />
                  <span
                    style={{ fontSize: "0.875rem", color: colors.neutral[700] }}
                  >
                    {t("retireAfterPurchase")}
                  </span>
                </label>
              </>
            )}

            {/* ── Preview step ────────────────────────────────────────────── */}
            {showPreview && (
              <TransactionPreview
                title="Transaction preview"
                description="Review the effects below. The network simulation has been run — no fees charged until you sign."
                preview={preview}
                onConfirm={walletStatus === "ready" ? handlePurchase : undefined}
                onCancel={handlePreviewCancel}
                confirmLabel={t("buyCredits")}
                confirming={confirming}
              />
            )}

            {/* Transaction status */}
            {txStatus && (
              <TransactionStatus
                status={txStatus}
                txHash={txHash ?? undefined}
                message={
                  txStatus === "failed"
                    ? getContractErrorMessage(buyError)
                    : undefined
                }
                onRetry={txStatus === "failed" ? handlePurchase : undefined}
              />
            )}

            {/* Wallet prompt or "Preview purchase" CTA */}
            {walletStatus !== "ready" ? (
              <WalletPrompt
                status={walletStatus}
                onConnect={handleConnect}
                refresh={refreshWallet}
              />
            ) : !showPreview ? (
              /* Before preview: show "Preview purchase" button */
              <button
                type="button"
                onClick={handlePreviewRequest}
                disabled={
                  txStatus === "submitted" || txStatus === "pending"
                }
                aria-disabled={
                  txStatus === "submitted" || txStatus === "pending"
                }
                style={{
                  background: colors.primary[600],
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.5rem",
                  padding: "0.875rem",
                  fontSize: "1rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
              >
                Preview purchase →
              </button>
            ) : null}
          </div>
        )}

        <Toast toasts={toasts} onDismiss={dismiss} />
      </div>
    </ErrorBoundary>
  );
}

// ── Page export (wrapped in Suspense for useSearchParams) ─────────────────────

export default function BuyPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "2rem" }}>Loading purchase flow…</div>
      }
    >
      <BuyPageContent />
    </Suspense>
  );
}
