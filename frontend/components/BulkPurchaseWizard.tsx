"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { MarketListing, bulkPurchase } from "../lib/api";
import { connectFreighter } from "../lib/freighter";
import { getWalletErrorMessage } from "../lib/wallet-errors";
import { formatStroops, formatTonnes } from "../lib/carbon-utils";
import { colors } from "../styles/design-system";
import TransactionStatus, { TxStatus } from "./TransactionStatus";
import TransactionPreview from "./TransactionPreview";
import { PreviewState } from "../lib/transaction-preview-types";
import Toast, { useToast } from "./Toast";
import {
  useTransactionPoller,
  TRANSACTION_MAX_POLLS,
} from "../hooks/useTransactionPoller";
import { simulateBulkPurchasePreview } from "../lib/soroban";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WizardCartItem {
  listing: MarketListing;
  amount: number;
}

interface CSVRow {
  listingId: string;
  amount: number;
  error?: string;
}

type WizardStep = "selection" | "preview" | "confirm";

interface PortfolioMetrics {
  totalTonnes: number;
  weightedAvgVintage: number;
  methodologyBreakdown: Record<string, number>;
  costBreakdown: {
    subtotal: bigint;
    protocolFee: bigint;
    total: bigint;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  // Skip header row if it looks like a header
  const start = lines[0].toLowerCase().includes("listing") ? 1 : 0;
  const rows: CSVRow[] = [];

  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < 2) {
      rows.push({ listingId: "", amount: 0, error: `Row ${i + 1}: Invalid format` });
      continue;
    }

    const listingId = cols[0];
    const amount = parseFloat(cols[1]);

    if (!listingId || listingId.length === 0) {
      rows.push({ listingId: "", amount, error: `Row ${i + 1}: Missing listing ID` });
    } else if (isNaN(amount) || amount <= 0) {
      rows.push({ listingId, amount: 0, error: `Row ${i + 1}: Invalid amount "${cols[1]}"` });
    } else {
      rows.push({ listingId, amount });
    }
  }

  return rows;
}

function validateCSVRows(
  rows: CSVRow[],
  allListings: Map<string, MarketListing>
): CSVRow[] {
  return rows.map((row) => {
    if (row.error) return row;
    const listing = allListings.get(row.listingId);
    if (!listing) {
      return { ...row, error: `Listing "${row.listingId}" not found` };
    }
    if (row.amount > listing.amountAvailable) {
      return {
        ...row,
        error: `Amount ${row.amount} exceeds available ${listing.amountAvailable}`,
      };
    }
    return row;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Metrics Calculator
// ─────────────────────────────────────────────────────────────────────────────

function calculatePortfolioMetrics(items: WizardCartItem[]): PortfolioMetrics {
  const totalTonnes = items.reduce((sum, i) => sum + i.amount, 0);

  // Weighted average vintage
  let vintageSum = 0;
  items.forEach((i) => {
    vintageSum += i.listing.vintageYear * i.amount;
  });
  const weightedAvgVintage = totalTonnes > 0 ? Math.round(vintageSum / totalTonnes) : 0;

  // Methodology breakdown
  const methodologyBreakdown: Record<string, number> = {};
  items.forEach((i) => {
    const m = i.listing.methodology;
    methodologyBreakdown[m] = (methodologyBreakdown[m] || 0) + i.amount;
  });

  // Cost breakdown
  const subtotal = items.reduce(
    (sum, i) => sum + BigInt(i.listing.pricePerCredit) * BigInt(Math.floor(i.amount * 100)) / 100n,
    0n
  );
  const protocolFee = subtotal / 100n; // 1%
  const total = subtotal + protocolFee;

  return {
    totalTonnes,
    weightedAvgVintage,
    methodologyBreakdown,
    costBreakdown: { subtotal, protocolFee, total },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  availableListings: MarketListing[];
  onComplete?: () => void;
}

export default function BulkPurchaseWizard({ availableListings, onComplete }: Props) {
  const t = useTranslations("bulkPurchaseWizard");
  const [step, setStep] = useState<WizardStep>("selection");
  const [items, setItems] = useState<WizardCartItem[]>([]);
  const [amountErrors, setAmountErrors] = useState<Record<string, string>>({});
  const amountErrorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [walletKey, setWalletKey] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pollHash, setPollHash] = useState<string | null>(null);
  const { pollCount, state: pollState, errorMessage: pollError } = useTransactionPoller({
    txHash: pollHash,
  });
  const { toasts, addToast, dismiss } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Simulation state ───────────────────────────────────────────────────────
  const [preview, setPreview] = useState<PreviewState>({
    loading: false,
    ready: false,
    effects: [],
  });
  const [confirming, setConfirming] = useState(false);

  const listingMap = useMemo(() => {
    const map = new Map<string, MarketListing>();
    availableListings.forEach((l) => map.set(l.listingId, l));
    return map;
  }, [availableListings]);

  const metrics = useMemo(() => calculatePortfolioMetrics(items), [items]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const addItem = useCallback(
    (listingId: string, amount: number) => {
      const listing = listingMap.get(listingId);
      if (!listing) return;

      setItems((prev) => {
        const idx = prev.findIndex((i) => i.listing.listingId === listingId);
        if (idx >= 0) {
          return prev.map((item, i) => (i === idx ? { ...item, amount } : item));
        }
        return [...prev, { listing, amount }];
      });
    },
    [listingMap]
  );

  const removeItem = useCallback((listingId: string) => {
    setItems((prev) => prev.filter((i) => i.listing.listingId !== listingId));
  }, []);

  const clearItems = useCallback(() => {
    setItems([]);
  }, []);

  // ── Amount validation ──────────────────────────────────────────────────────

  const validateAmount = useCallback((listing: MarketListing, amount: number): string | null => {
    if (Number.isNaN(amount) || amount <= 0) {
      return "Amount must be greater than 0";
    }
    if (amount > listing.amountAvailable) {
      return `Amount exceeds available ${formatTonnes(listing.amountAvailable)}`;
    }
    return null;
  }, []);

  const handleAmountChange = useCallback(
    (listing: MarketListing, raw: string) => {
      const amount = parseFloat(raw);
      // Keep the raw draft in cart until it parses to a valid number
      addItem(listing.listingId, amount || 0.01);
      // Debounced real-time validation
      if (amountErrorTimers.current[listing.listingId]) {
        clearTimeout(amountErrorTimers.current[listing.listingId]);
      }
      amountErrorTimers.current[listing.listingId] = setTimeout(() => {
        const error = validateAmount(listing, amount);
        setAmountErrors((prev) => {
          const next = { ...prev };
          if (error) next[listing.listingId] = error;
          else delete next[listing.listingId];
          return next;
        });
        delete amountErrorTimers.current[listing.listingId];
      }, 300);
    },
    [addItem, validateAmount]
  );

  const handleAmountBlur = useCallback(
    (listing: MarketListing, amount: number) => {
      const error = validateAmount(listing, amount);
      setAmountErrors((prev) => {
        const next = { ...prev };
        if (error) next[listing.listingId] = error;
        else delete next[listing.listingId];
        return next;
      });
    },
    [validateAmount]
  );

  async function handleConnect() {
    try {
      const key = await connectFreighter();
      setWalletKey(key);
      addToast({
        type: "success",
        title: t("walletConnected"),
        message: key.slice(0, 8) + "…",
      });
    } catch (e) {
      addToast({
        type: "error",
        title: t("walletError"),
        message: getWalletErrorMessage(e),
      });
    }
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  const runSimulation = useCallback(async () => {
    if (!walletKey || items.length === 0) return;

    const contractId = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID;
    if (!contractId) {
      // No contract configured; skip simulation, allow purchase directly
      setPreview({ loading: false, ready: true, effects: [] });
      return;
    }

    setPreview({ loading: true, ready: false, effects: [] });
    const result = await simulateBulkPurchasePreview({
      contractId,
      sourcePublicKey: walletKey,
      items: items.map((i) => ({
        listingId: i.listing.listingId,
        amount: i.amount,
        pricePerCredit: i.listing.pricePerCredit.toString(),
      })),
    });
    setPreview(result);
  }, [walletKey, items]);

  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const rows = parseCSV(text);
    const validated = validateCSVRows(rows, listingMap);

    const errors = validated.filter((r) => r.error);
    if (errors.length > 0) {
      addToast({
        type: "error",
        title: t("csvErrors"),
        message: `${errors.length} row(s) have errors. Review below.`,
      });
      // Show first 3 errors
      errors.slice(0, 3).forEach((err) => {
        addToast({ type: "error", title: "CSV Error", message: err.error! });
      });
      return;
    }

    // Add validated rows to cart
    validated.forEach((row) => {
      if (!row.error) {
        addItem(row.listingId, row.amount);
      }
    });

    addToast({
      type: "success",
      title: t("csvImported"),
      message: `${validated.length} listing(s) added`,
    });
  }

  async function handlePurchase() {
    if (!walletKey || items.length === 0) return;

    setConfirming(true);
    setTxStatus("building");
    try {
      await new Promise((r) => setTimeout(r, 600));
      setTxStatus("signing");
      await new Promise((r) => setTimeout(r, 1000));
      setTxStatus("submitting");

      const listingIds = items.map((i) => i.listing.listingId);
      const amounts = items.map((i) => i.amount);

      const result = await bulkPurchase(
        listingIds.map((id, idx) => ({ listingId: id, amount: amounts[idx] })),
        walletKey
      );

      setTxStatus("polling");
      setTxHash(result.txHash);
      setPollHash(result.txHash);
    } catch (e: unknown) {
      setTxStatus("failed");
      setPollHash(null);
      const message = e instanceof Error ? e.message : String(e);
      addToast({ type: "error", title: t("purchaseFailed"), message });
    } finally {
      setConfirming(false);
    }
  }

  // Run simulation when the preview step becomes visible
  useEffect(() => {
    if (step === "preview") {
      runSimulation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Poll state effect
  useEffect(() => {
    if (!pollHash || pollState === "idle" || pollState === "polling") return;

    if (pollState === "SUCCESS") {
      setTxStatus("confirmed");
      clearItems();
      addToast({
        type: "success",
        title: t("purchaseConfirmed"),
        message: t("purchaseSuccess", { tonnes: formatTonnes(metrics.totalTonnes) }),
        txHash: pollHash,
      });
      setPollHash(null);
      if (onComplete) onComplete();
    } else if (pollState === "FAILED") {
      setTxStatus("failed");
      addToast({
        type: "error",
        title: t("purchaseFailed"),
        message: pollError ?? t("purchaseFailedOnChain"),
      });
      setPollHash(null);
    } else if (pollState === "TIMED_OUT") {
      setTxStatus("timed_out");
      setPollHash(null);
    }
  }, [pollState, pollHash, pollError, clearItems, addToast, metrics.totalTonnes, onComplete, t]);

  const busy = txStatus && !["confirmed", "failed", "timed_out"].includes(txStatus);
  const hasAmountErrors = Object.keys(amountErrors).length > 0;
  const canProceed = items.length > 0 && items.length <= 10 && !hasAmountErrors;

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Step 1 - Selection
  // ─────────────────────────────────────────────────────────────────────────

  if (step === "selection") {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem" }}>
        <h2 style={{ fontSize: "1.75rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 1rem" }}>
          {t("step1Title")}
        </h2>
        <p style={{ fontSize: "0.875rem", color: colors.neutral[600], marginBottom: "1.5rem" }}>
          {t("step1Description")}
        </p>

        {/* CSV Import */}
        <div
          style={{
            background: colors.primary[50],
            border: `1px dashed ${colors.primary[300]}`,
            borderRadius: "0.75rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
            textAlign: "center",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            style={{ display: "none" }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: colors.primary[600],
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            📄 {t("importCSV")}
          </button>
          <p style={{ fontSize: "0.75rem", color: colors.neutral[500], marginTop: "0.5rem" }}>
            {t("csvFormat")}
          </p>
        </div>

        {/* Manual Selection */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label
            htmlFor="listing-select"
            style={{
              display: "block",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: colors.neutral[700],
              marginBottom: "0.5rem",
            }}
          >
            {t("selectListing")}
          </label>
          <select
            id="listing-select"
            onChange={(e) => {
              const listingId = e.target.value;
              if (listingId) addItem(listingId, 1);
              e.target.value = "";
            }}
            style={{
              width: "100%",
              border: `1px solid ${colors.neutral[300]}`,
              borderRadius: "0.5rem",
              padding: "0.75rem",
              fontSize: "0.875rem",
            }}
          >
            <option value="">{t("chooseProject")}</option>
            {availableListings.map((l) => (
              <option key={l.listingId} value={l.listingId}>
                {l.projectName || l.projectId} — {l.methodology} ({formatTonnes(l.amountAvailable)} available)
              </option>
            ))}
          </select>
        </div>

        {/* Selected Items */}
        {items.length > 0 && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>
              {t("selectedProjects")} ({items.length}/10)
            </h3>
            {items.map(({ listing, amount }) => (
              <div
                key={listing.listingId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  padding: "0.75rem",
                  background: colors.surface,
                  border: `1px solid ${amountErrors[listing.listingId] ? colors.suspended.border : colors.neutral[200]}`,
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "0.875rem", margin: 0 }}>
                      {listing.projectName || listing.projectId}
                    </p>
                    <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: "0.1rem 0 0" }}>
                      {listing.methodology} · {listing.vintageYear}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <input
                      type="number"
                      min={0.01}
                      max={listing.amountAvailable}
                      step={0.01}
                      value={amount}
                      onChange={(e) => handleAmountChange(listing, e.target.value)}
                      onBlur={() => handleAmountBlur(listing, amount)}
                      style={{
                        width: "80px",
                        border: `1px solid ${amountErrors[listing.listingId] ? colors.suspended.border : colors.neutral[300]}`,
                        borderRadius: "0.375rem",
                        padding: "0.4rem 0.5rem",
                        fontSize: "0.875rem",
                      }}
                    />
                  <button
                    onClick={() => removeItem(listing.listingId)}
                    aria-label={t("remove")}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: colors.neutral[400],
                      cursor: "pointer",
                      fontSize: "1rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
                {amountErrors[listing.listingId] && (
                  <p style={{ fontSize: "0.75rem", color: colors.suspended.text, margin: "0.4rem 0 0" }}>
                    {amountErrors[listing.listingId]}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
          <button
            onClick={() => setStep("preview")}
            disabled={!canProceed}
            style={{
              background: canProceed ? colors.primary[600] : colors.neutral[300],
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: canProceed ? "pointer" : "not-allowed",
            }}
          >
            {t("nextStep")} →
          </button>
        </div>

        <Toast toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Step 2 - Preview
  // ─────────────────────────────────────────────────────────────────────────

  if (step === "preview") {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem" }}>
        <h2 style={{ fontSize: "1.75rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 1rem" }}>
          {t("step2Title")}
        </h2>
        <p style={{ fontSize: "0.875rem", color: colors.neutral[600], marginBottom: "1.5rem" }}>
          {t("step2Description")}
        </p>

        {/* Portfolio Metrics */}
        <div
          style={{
            background: colors.primary[50],
            border: `1px solid ${colors.primary[200]}`,
            borderRadius: "0.75rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" }}>
            {t("portfolioMetrics")}
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: 0 }}>{t("totalTonnes")}</p>
              <p style={{ fontSize: "1.5rem", fontWeight: 800, color: colors.primary[700], margin: "0.25rem 0 0" }}>
                {formatTonnes(metrics.totalTonnes)}
              </p>
            </div>
            <div>
              <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: 0 }}>{t("avgVintage")}</p>
              <p style={{ fontSize: "1.5rem", fontWeight: 800, color: colors.neutral[800], margin: "0.25rem 0 0" }}>
                {metrics.weightedAvgVintage}
              </p>
            </div>
            <div>
              <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: 0 }}>{t("totalCost")}</p>
              <p style={{ fontSize: "1.5rem", fontWeight: 800, color: colors.neutral[800], margin: "0.25rem 0 0" }}>
                ${formatStroops(metrics.costBreakdown.total)}
              </p>
            </div>
          </div>

          {/* Methodology Breakdown */}
          <div>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t("methodologyBreakdown")}</p>
            {Object.entries(metrics.methodologyBreakdown).map(([method, tonnes]) => {
              const pct = ((tonnes / metrics.totalTonnes) * 100).toFixed(1);
              return (
                <div key={method} style={{ marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.2rem" }}>
                    <span style={{ color: colors.neutral[700] }}>{method}</span>
                    <span style={{ fontWeight: 600, color: colors.neutral[800] }}>
                      {formatTonnes(tonnes)} ({pct}%)
                    </span>
                  </div>
                  <div
                    style={{
                      height: "6px",
                      background: colors.neutral[200],
                      borderRadius: "3px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: colors.primary[600],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cost Breakdown */}
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.75rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>{t("costBreakdown")}</h3>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.875rem", color: colors.neutral[600] }}>{t("subtotal")}</span>
            <span style={{ fontWeight: 600 }}>${formatStroops(metrics.costBreakdown.subtotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.875rem", color: colors.neutral[600] }}>{t("protocolFee")}</span>
            <span style={{ fontWeight: 600 }}>${formatStroops(metrics.costBreakdown.protocolFee)}</span>
          </div>
          <div
            style={{
              borderTop: `1px solid ${colors.neutral[200]}`,
              paddingTop: "0.5rem",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: "1rem", fontWeight: 700 }}>{t("total")}</span>
            <span style={{ fontSize: "1.25rem", fontWeight: 800, color: colors.primary[700] }}>
              ${formatStroops(metrics.costBreakdown.total)} USDC
            </span>
          </div>
        </div>

        {/* Soroban simulation preview card */}
        <TransactionPreview
          title="Bulk purchase preview"
          description="Soroban simulation of the bulk_purchase transaction. Review the effects before signing."
          preview={preview}
          onConfirm={walletKey ? () => setStep("confirm") : undefined}
          onCancel={() => setStep("selection")}
          confirmLabel={t("confirm") + " →"}
          confirming={confirming}
        />

        {/* Back button (kept for wallets not yet connected) */}
        {!walletKey && (
          <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-start", marginTop: "0.5rem" }}>
            <button
              onClick={() => setStep("selection")}
              style={{
                background: "transparent",
                color: colors.neutral[600],
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.5rem",
                padding: "0.75rem 1.5rem",
                fontSize: "0.9rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ← {t("back")}
            </button>
          </div>
        )}

        <Toast toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Step 3 - Confirm
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem" }}>
      <h2 style={{ fontSize: "1.75rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 1rem" }}>
        {t("step3Title")}
      </h2>
      <p style={{ fontSize: "0.875rem", color: colors.neutral[600], marginBottom: "1.5rem" }}>
        {t("step3Description")}
      </p>

      {/* Transaction Status */}
      {txStatus && (
        <div style={{ marginBottom: "1.5rem" }}>
          <TransactionStatus
            status={txStatus}
            txHash={txHash ?? undefined}
            pollProgress={
              txStatus === "polling" ? { current: pollCount, max: TRANSACTION_MAX_POLLS } : undefined
            }
            message={txStatus === "failed" ? pollError ?? undefined : undefined}
            onRetry={txStatus === "failed" ? handlePurchase : undefined}
          />
        </div>
      )}

      {/* Summary */}
      <div
        style={{
          background: colors.primary[50],
          border: `1px solid ${colors.primary[200]}`,
          borderRadius: "0.75rem",
          padding: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <p style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          {t("purchaseSummary")}
        </p>
        <p style={{ fontSize: "0.875rem", color: colors.neutral[600] }}>
          {items.length} {t("projects")} · {formatTonnes(metrics.totalTonnes)} · $
          {formatStroops(metrics.costBreakdown.total)} USDC
        </p>
      </div>

      {/* CTA */}
      <div style={{ display: "flex", gap: "1rem", justifyContent: "space-between" }}>
        <button
          onClick={() => setStep("preview")}
          disabled={!!busy}
          style={{
            background: "transparent",
            color: colors.neutral[600],
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.5rem",
            padding: "0.75rem 1.5rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          ← {t("back")}
        </button>

        {!walletKey ? (
          <button
            onClick={handleConnect}
            style={{
              background: colors.primary[600],
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("connectWallet")}
          </button>
        ) : (
          <button
            onClick={handlePurchase}
            disabled={!!busy || txStatus === "confirmed"}
            style={{
              background: busy || txStatus === "confirmed" ? colors.neutral[300] : colors.primary[600],
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: busy || txStatus === "confirmed" ? "not-allowed" : "pointer",
            }}
          >
            {txStatus === "confirmed"
              ? t("purchaseComplete")
              : busy
              ? t("processing")
              : t("executePurchase")}
          </button>
        )}
      </div>

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
