"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useListing, purchaseCredits, useMarketplacePauseState } from "../../lib/api";
import { useBuyButton } from "../../lib/useBuyButton";
import ErrorBoundary from "../../components/ErrorBoundary";
import { formatTonnes, calculateCreditCost } from "../../lib/carbon-utils";
import { useLocaleFormatters } from "../../lib/i18n/format";
import { getContractErrorMessage, getActionablePurchaseError } from "../../lib/wallet-errors";
import { colors } from "../../styles/design-system";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import TransactionPreview from "../../components/TransactionPreview";
import { PreviewState } from "../../lib/transaction-preview-types";
import Toast, { useToast } from "../../components/Toast";
import { useWalletStatus } from "../../hooks/useWalletStatus";
import WalletPrompt from "../../components/WalletPrompt";
import { simulatePurchasePreview } from "../../lib/soroban";
import { usePauseWebSocket } from "../../lib/realtime/usePauseWebSocket";
import PausedOperationButton from "../../components/PausedOperationButton";

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
  const [purchaseError, setPurchaseError] = useState<{ message: string; nextStep: string } | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{
    projectName: string;
    tonnes: number;
    usdcTotal: bigint;
    txHash: string;
  } | null>(null);

  // Pause state — Issue #1254
  const { pauseState: pollingPauseState } = useMarketplacePauseState();
  const { isPaused, pauseState } = usePauseWebSocket({
    contract: "carbon_marketplace",
    pollingState: {
      isPaused: pollingPauseState.paused,
      pausedBy: pollingPauseState.pausedBy,
      reason: pollingPauseState.reason,
      pausedUntil: pollingPauseState.pausedUntil
        ? pollingPauseState.pausedUntil * 1000
        : undefined,
    },
  });

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
    setPurchaseError(null);
    setPurchaseSuccess(null);
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
      const projectName = listing.projectName || listing.projectId;
      setPurchaseSuccess({
        projectName,
        tonnes: amount,
        usdcTotal: totalCost,
        txHash: result.txHash,
      });
      addToast({
        type: "success",
        title: t("purchaseConfirmedTitle"),
        message: t("purchaseConfirmedMessage", {
          tonnes: formatTonnes(amount),
          project: projectName,
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
      const actionable = getActionablePurchaseError(buyError, "carbon_marketplace");
      setPurchaseError({ message: actionable.message, nextStep: actionable.nextStep });
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "2.5rem 1rem" }}>
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
                    inputMode="decimal"
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
                      minHeight: "48px",
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
                      aria-live="polite"
                      aria-atomic="true"
                      style={{
                        fontSize: "1.25rem",
                        fontWeight: 800,
                        color: colors.primary[700],
                      }}
                    >
                      ${formatCurrency(totalCost)}&nbsp;USDC&nbsp;for&nbsp;{formatTonnes(amount)}&nbsp;tCO₂e
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
              <>
                {/* Explicit payment summary at the top of the confirm step */}
                <div
                  style={{
                    background: colors.primary[50],
                    border: `1px solid ${colors.primary[200]}`,
                    borderRadius: "0.75rem",
                    padding: "1rem 1.25rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                  aria-label="Purchase summary"
                >
                  <span style={{ fontSize: "0.875rem", color: colors.neutral[600] }}>
                    You pay
                  </span>
                  <span
                    aria-live="polite"
                    aria-atomic="true"
                    style={{ fontSize: "1.125rem", fontWeight: 800, color: colors.primary[700] }}
                  >
                    ${formatCurrency(totalCost)}&nbsp;USDC&nbsp;for&nbsp;{formatTonnes(amount)}&nbsp;tCO₂e
                  </span>
                </div>

                <TransactionPreview
                  title="Transaction preview"
                  description="Review the effects below. The network simulation has been run — no fees charged until you sign."
                  preview={preview}
                  onConfirm={walletStatus === "ready" ? handlePurchase : undefined}
                  onCancel={handlePreviewCancel}
                  confirmLabel={t("buyCredits")}
                  confirming={confirming}
                />
              </>
            )}

            {/* Transaction status */}
            {txStatus && (
              <TransactionStatus
                status={txStatus}
                txHash={txHash ?? undefined}
                message={
                  txStatus === "failed"
                    ? (purchaseError?.message ?? getContractErrorMessage(buyError))
                    : undefined
                }
                onRetry={txStatus === "failed" ? handlePurchase : undefined}
              />
            )}

            {/* Actionable next-step hint on failure */}
            {txStatus === "failed" && purchaseError?.nextStep && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: "0.5rem",
                  padding: "0.75rem 1rem",
                  fontSize: "0.875rem",
                  color: "#b91c1c",
                }}
                role="note"
              >
                <strong>What to do:</strong> {purchaseError.nextStep}
              </div>
            )}

            {/* Detailed success confirmation — #1599 */}
            {txStatus === "confirmed" && purchaseSuccess && (
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #86efac",
                  borderRadius: "0.75rem",
                  padding: "1.25rem",
                }}
                role="region"
                aria-label="Purchase confirmation"
              >
                <p style={{ fontWeight: 700, fontSize: "1rem", color: "#15803d", margin: "0 0 0.75rem" }}>
                  ✅ Purchase confirmed
                </p>
                <div style={{ display: "grid", gap: "0.4rem", fontSize: "0.875rem", color: colors.neutral[700] }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Project</span>
                    <strong>{purchaseSuccess.projectName}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Credits purchased</span>
                    <strong>{formatTonnes(purchaseSuccess.tonnes)} tCO₂e</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Total paid</span>
                    <strong>${formatCurrency(purchaseSuccess.usdcTotal)} USDC</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span>Transaction</span>
                    <a
                      href={`https://stellar.expert/explorer/${process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "public" : "testnet"}/tx/${purchaseSuccess.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#15803d", textDecoration: "underline" }}
                    >
                      {purchaseSuccess.txHash.slice(0, 10)}…{purchaseSuccess.txHash.slice(-10)}
                    </a>
                  </div>
                </div>
                <div style={{ marginTop: "1rem" }}>
                  <a
                    href="/portfolio/transactions"
                    style={{
                      fontSize: "0.875rem",
                      color: "#15803d",
                      fontWeight: 600,
                      textDecoration: "underline",
                    }}
                  >
                    View purchase history →
                  </a>
                </div>
              </div>
            )}

            {/* Wallet prompt or "Preview purchase" CTA */}
            {walletStatus !== "ready" ? (
              <>
                {/* Contextual explanation shown before the wallet-connect step — #1598 */}
                <div
                  style={{
                    background: colors.primary[50],
                    border: `1px solid ${colors.primary[200]}`,
                    borderRadius: "0.75rem",
                    padding: "1rem 1.25rem",
                    fontSize: "0.875rem",
                    color: colors.neutral[700],
                  }}
                  role="note"
                  aria-label="Wallet required explanation"
                >
                  <p style={{ margin: "0 0 0.35rem", fontWeight: 700, color: colors.neutral[900] }}>
                    🔑 A Stellar wallet is required to complete this purchase
                  </p>
                  <p style={{ margin: 0, lineHeight: 1.5 }}>
                    CarbonLedger purchases are on-chain transactions on the Stellar network. You need the{" "}
                    <a href="https://freighter.app" target="_blank" rel="noopener noreferrer" style={{ color: colors.primary[700] }}>
                      Freighter
                    </a>{" "}
                    browser extension to authorize the transaction with your private key — your key never leaves your device.
                  </p>
                </div>
                <WalletPrompt
                  status={walletStatus}
                  onConnect={handleConnect}
                  refresh={refreshWallet}
                />
              </>
            ) : !showPreview ? (
              /* Before preview: show "Preview purchase" button */
              <PausedOperationButton isPaused={isPaused} pauseReason={pauseState.reason}>
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
              </PausedOperationButton>
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
