"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { retireCredits } from "../../lib/api";
import { formatTonnes } from "../../lib/carbon-utils";
import { getContractErrorMessage } from "../../lib/wallet-errors";
import { colors } from "../../styles/design-system";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import TransactionPreview from "../../components/TransactionPreview";
import { PreviewState } from "../../lib/transaction-preview-types";
import Toast, { useToast } from "../../components/Toast";
import { useWalletStatus } from "../../hooks/useWalletStatus";
import WalletPrompt from "../../components/WalletPrompt";
import ErrorBoundary from "../../components/ErrorBoundary";
import RetireConfirmModal from "../../components/RetireConfirmModal";
import {
  useTransactionPoller,
  TRANSACTION_MAX_POLLS,
} from "../../hooks/useTransactionPoller";
import { simulateRetirementPreview } from "../../lib/soroban";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RetireFormState {
  batchId: string;
  amount: number;
  beneficiary: string;
  reason: string;
}

interface ValidationErrors {
  beneficiary?: string;
  reason?: string;
  amount?: string;
}

// ── Validation Constants ──────────────────────────────────────────────────────

const VALIDATION_LIMITS = {
  beneficiary: { min: 1, max: 100 },
  reason: { min: 1, max: 500 },
  amount: { min: 0.01, max: Number.MAX_SAFE_INTEGER },
} as const;

// ── Validation helpers ────────────────────────────────────────────────────────

type Translator = (key: string, values?: Record<string, string | number>) => string;

function validateBeneficiary(value: string, t: Translator): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return t("beneficiaryRequired");
  if (trimmed.length > VALIDATION_LIMITS.beneficiary.max)
    return t("beneficiaryTooLong", { max: VALIDATION_LIMITS.beneficiary.max });
  return undefined;
}

function validateReason(value: string, t: Translator): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return t("reasonRequired");
  if (trimmed.length > VALIDATION_LIMITS.reason.max)
    return t("reasonTooLong", { max: VALIDATION_LIMITS.reason.max });
  return undefined;
}

function validateAmount(
  value: number,
  t: Translator,
  userBalance?: number,
): string | undefined {
  if (value < VALIDATION_LIMITS.amount.min)
    return t("amountTooSmall", { min: VALIDATION_LIMITS.amount.min });
  if (!Number.isInteger(value * 100)) return t("amountTooPrecise");
  if (userBalance !== undefined && value > userBalance)
    return t("amountExceedsBalance", { balance: userBalance });
  return undefined;
}

function validateForm(
  form: RetireFormState,
  t: Translator,
  userBalance?: number,
): ValidationErrors {
  return {
    beneficiary: validateBeneficiary(form.beneficiary, t),
    reason: validateReason(form.reason, t),
    amount: validateAmount(form.amount, t, userBalance),
  };
}

function hasErrors(errors: ValidationErrors): boolean {
  return Object.values(errors).some((error) => error !== undefined);
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${colors.neutral[300]}`,
  borderRadius: "0.5rem",
  padding: "0.75rem 1rem",
  fontSize: "0.9rem",
  color: colors.neutral[900],
  boxSizing: "border-box",
};

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  border: "1px solid #dc2626",
};

const errorTextStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#dc2626",
  margin: "0.3rem 0 0",
};

// ── Inner page component ──────────────────────────────────────────────────────

function RetirePageContent() {
  const t = useTranslations("retirePage");
  const searchParams = useSearchParams();
  const batchId = searchParams.get("batch") ?? "";

  const [amount, setAmount] = useState(1);
  const [beneficiary, setBeneficiary] = useState("");
  const [reason, setReason] = useState("");
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pollHash, setPollHash] = useState<string | null>(null);
  const {
    pollCount,
    state: pollState,
    errorMessage: pollError,
  } = useTransactionPoller({ txHash: pollHash });
  const [retirementId, setRetirementId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState({
    beneficiary: false,
    reason: false,
    amount: false,
  });
  const { toasts, addToast, dismiss } = useToast();
  const { status: walletStatus, address: walletKey, refresh: refreshWallet } =
    useWalletStatus();

  // ── Simulation state ─────────────────────────────────────────────────────────
  const [preview, setPreview] = useState<PreviewState>({
    loading: false,
    ready: false,
    effects: [],
  });
  const [showPreview, setShowPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // ── Simulation ────────────────────────────────────────────────────────────────

  const runSimulation = useCallback(async () => {
    if (!walletKey || !batchId) return;

    const contractId = process.env.NEXT_PUBLIC_CREDIT_CONTRACT_ID;
    if (!contractId) {
      // No contract configured; skip simulation and allow retirement directly
      setPreview({ loading: false, ready: true, effects: [] });
      return;
    }

    setPreview({ loading: true, ready: false, effects: [] });
    const result = await simulateRetirementPreview({
      contractId,
      sourcePublicKey: walletKey,
      batchId,
      amount,
      beneficiary: beneficiary || "preview",
      reason: reason || "preview",
    });
    setPreview(result);
  }, [walletKey, batchId, amount, beneficiary, reason]);

  // Run simulation when preview step becomes visible
  useEffect(() => {
    if (showPreview) {
      runSimulation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview]);

  // ── Wallet connection handler ─────────────────────────────────────────────────

  function handleConnect(key: string) {
    addToast({
      type: "success",
      title: t("walletConnectedTitle"),
      message: key.slice(0, 8) + "…",
    });
  }

  // ── Field change / validation handlers ───────────────────────────────────────

  const handleBlur = (field: "beneficiary" | "reason" | "amount") => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (field === "beneficiary") {
      setValidationErrors((prev) => ({
        ...prev,
        beneficiary: validateBeneficiary(beneficiary, t),
      }));
    } else if (field === "reason") {
      setValidationErrors((prev) => ({
        ...prev,
        reason: validateReason(reason, t),
      }));
    } else if (field === "amount") {
      setValidationErrors((prev) => ({
        ...prev,
        amount: validateAmount(amount, t),
      }));
    }
  };

  const handleFieldChange = (field: "beneficiary" | "reason", value: string) => {
    if (field === "beneficiary") setBeneficiary(value);
    else setReason(value);
    if (touched[field]) {
      setValidationErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleAmountChange = (value: number) => {
    setAmount(value);
    if (touched.amount) {
      setValidationErrors((prev) => ({ ...prev, amount: undefined }));
    }
  };

  // ── Show preview (validate first) ────────────────────────────────────────────

  const handleShowPreview = () => {
    const errors = validateForm({ batchId, amount, beneficiary, reason }, t);
    setValidationErrors(errors);
    setTouched({ beneficiary: true, reason: true, amount: true });
    if (!hasErrors(errors)) {
      setShowPreview(true);
    }
  };

  const handlePreviewCancel = () => {
    setShowPreview(false);
    setPreview({ loading: false, ready: false, effects: [] });
  };

  // ── Confirm (opens the safety modal, then retires) ────────────────────────────

  const handlePreviewConfirm = () => {
    setShowModal(true);
  };

  async function handleRetire() {
    if (!walletKey || !batchId || !beneficiary || !reason) return;

    const errors = validateForm({ batchId, amount, beneficiary, reason }, t);
    if (hasErrors(errors)) {
      addToast({
        type: "error",
        title: t("validationFailedTitle"),
        message: t("validationFailedMessage"),
      });
      return;
    }

    setConfirming(true);
    setTxStatus("building");
    try {
      await new Promise((r) => setTimeout(r, 500));
      setTxStatus("signing");
      await new Promise((r) => setTimeout(r, 1000));
      setTxStatus("submitting");
      const result = await retireCredits({
        batchId,
        amount,
        beneficiary,
        retirementReason: reason,
        holderPublicKey: walletKey,
      });
      setTxStatus("polling");
      setTxHash(result.txHash);
      setRetirementId(result.retirementId);
      setPollHash(result.txHash);
    } catch (e: any) {
      setTxStatus("failed");
      setPollHash(null);
      addToast({
        type: "error",
        title: t("retirementFailedTitle"),
        message: getContractErrorMessage(e),
      });
    } finally {
      setConfirming(false);
    }
  }

  // ── Poll state effect ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pollHash || pollState === "idle" || pollState === "polling") return;
    if (pollState === "SUCCESS") {
      setTxStatus("confirmed");
      addToast({
        type: "success",
        title: t("retiredSuccessTitle"),
        message: t("retiredSuccessMessage", {
          tonnes: formatTonnes(amount),
          beneficiary,
        }),
        txHash: pollHash,
      });
      setPollHash(null);
    } else if (pollState === "FAILED") {
      setTxStatus("failed");
      addToast({
        type: "error",
        title: t("retirementFailedTitle"),
        message: pollError ?? t("transactionFailedOnChain"),
      });
      setPollHash(null);
    } else if (pollState === "TIMED_OUT") {
      setTxStatus("timed_out");
      setPollHash(null);
    }
  }, [pollState, pollHash, pollError, addToast, amount, beneficiary, t]);

  // ── Derived state ─────────────────────────────────────────────────────────────

  const busy =
    txStatus && !["confirmed", "failed", "timed_out"].includes(txStatus);
  const hasValidationErrors = hasErrors(validationErrors);
  const isDisabled = hasValidationErrors || !!busy || txStatus === "confirmed";

  const beneficiaryLength = beneficiary.length;
  const reasonLength = reason.length;
  const showBeneficiaryError = touched.beneficiary && validationErrors.beneficiary;
  const showReasonError = touched.reason && validationErrors.reason;
  const showAmountError = touched.amount && validationErrors.amount;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2.5rem 2rem" }}>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 800,
            color: colors.neutral[900],
            margin: "0 0 0.5rem",
          }}
        >
          {t("title")}
        </h1>
        <p style={{ color: colors.neutral[500], margin: "0 0 2rem" }}>
          {t("subtitle")}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Form fields — hidden once preview step is active */}
          {!showPreview && (
            <>
              {/* Amount */}
              <div>
                <label
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: colors.neutral[700],
                    display: "block",
                    marginBottom: "0.4rem",
                  }}
                >
                  {t("amountLabel")}
                </label>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={amount}
                  onChange={(e) => {
                    const v = parseFloat(
                      parseFloat(e.target.value).toFixed(2),
                    );
                    handleAmountChange(Math.max(0.01, v || 0.01));
                  }}
                  onBlur={() => handleBlur("amount")}
                  style={showAmountError ? inputErrorStyle : inputStyle}
                  aria-invalid={showAmountError ? "true" : "false"}
                  aria-describedby={showAmountError ? "amount-error" : undefined}
                />
                {showAmountError && (
                  <p id="amount-error" style={errorTextStyle}>
                    {validationErrors.amount}
                  </p>
                )}
              </div>

              {/* Beneficiary */}
              <div>
                <label
                  htmlFor="retire-beneficiary"
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: colors.neutral[700],
                    display: "block",
                    marginBottom: "0.4rem",
                  }}
                >
                  {t("beneficiaryLabel")}{" "}
                  <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <input
                  id="retire-beneficiary"
                  type="text"
                  placeholder={t("beneficiaryPlaceholder")}
                  value={beneficiary}
                  onChange={(e) =>
                    handleFieldChange("beneficiary", e.target.value)
                  }
                  onBlur={() => handleBlur("beneficiary")}
                  maxLength={VALIDATION_LIMITS.beneficiary.max}
                  style={showBeneficiaryError ? inputErrorStyle : inputStyle}
                  aria-invalid={showBeneficiaryError ? "true" : "false"}
                  aria-describedby={
                    showBeneficiaryError
                      ? "beneficiary-error-main"
                      : undefined
                  }
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  {showBeneficiaryError ? (
                    <p id="beneficiary-error-main" style={errorTextStyle}>
                      {validationErrors.beneficiary}
                    </p>
                  ) : (
                    <p
                      style={{
                        fontSize: "0.75rem",
                        color: colors.neutral[400],
                        margin: "0.3rem 0 0",
                      }}
                    >
                      {t("appearsOnCertificate")}
                    </p>
                  )}
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color:
                        beneficiaryLength >
                        VALIDATION_LIMITS.beneficiary.max * 0.9
                          ? "#dc2626"
                          : colors.neutral[400],
                      margin: "0.3rem 0 0",
                      fontWeight:
                        beneficiaryLength >
                        VALIDATION_LIMITS.beneficiary.max * 0.9
                          ? 600
                          : 400,
                    }}
                  >
                    {beneficiaryLength}/{VALIDATION_LIMITS.beneficiary.max}
                  </p>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label
                  htmlFor="retire-reason"
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: colors.neutral[700],
                    display: "block",
                    marginBottom: "0.4rem",
                  }}
                >
                  {t("reasonLabel")}{" "}
                  <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <textarea
                  id="retire-reason"
                  placeholder={t("reasonPlaceholder")}
                  value={reason}
                  onChange={(e) => handleFieldChange("reason", e.target.value)}
                  onBlur={() => handleBlur("reason")}
                  maxLength={VALIDATION_LIMITS.reason.max}
                  rows={3}
                  style={{
                    ...(showReasonError ? inputErrorStyle : inputStyle),
                    resize: "vertical",
                  }}
                  aria-invalid={showReasonError ? "true" : "false"}
                  aria-describedby={
                    showReasonError ? "reason-error-main" : undefined
                  }
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  {showReasonError && (
                    <p id="reason-error-main" style={errorTextStyle}>
                      {validationErrors.reason}
                    </p>
                  )}
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color:
                        reasonLength > VALIDATION_LIMITS.reason.max * 0.9
                          ? "#dc2626"
                          : colors.neutral[400],
                      margin: "0.3rem 0 0",
                      marginLeft: "auto",
                      fontWeight:
                        reasonLength > VALIDATION_LIMITS.reason.max * 0.9
                          ? 600
                          : 400,
                    }}
                  >
                    {reasonLength}/{VALIDATION_LIMITS.reason.max}
                  </p>
                </div>
              </div>

              {/* Irreversibility warning */}
              <div
                id="retire-warning"
                role="note"
                style={{
                  background: "#fef9c3",
                  border: "1px solid #fde047",
                  borderRadius: "0.5rem",
                  padding: "0.875rem 1rem",
                  display: "flex",
                  gap: "0.75rem",
                }}
              >
                <span aria-hidden="true">⚠️</span>
                <p style={{ fontSize: "0.8rem", color: "#854d0e", margin: 0 }}>
                  {t("irreversibleWarningPrefix")}{" "}
                  <strong>{t("irreversibleWarningEmphasis")}</strong>{" "}
                  {t("irreversibleWarningSuffix")}
                </p>
              </div>
            </>
          )}

          {/* ── Preview step ────────────────────────────────────────────────── */}
          {showPreview && (
            <TransactionPreview
              title="Retirement preview"
              description="Review the effects below before permanently retiring these credits."
              preview={preview}
              onConfirm={
                walletStatus === "ready" ? handlePreviewConfirm : undefined
              }
              onCancel={handlePreviewCancel}
              confirmLabel={t("permanentlyRetire", {
                tonnes: formatTonnes(amount),
              })}
              confirming={confirming}
            />
          )}

          {/* Transaction status */}
          {txStatus && (
            <TransactionStatus
              status={txStatus}
              txHash={txHash ?? undefined}
              pollProgress={
                txStatus === "polling"
                  ? { current: pollCount, max: TRANSACTION_MAX_POLLS }
                  : undefined
              }
              message={
                txStatus === "failed" ? pollError ?? undefined : undefined
              }
              onRetry={txStatus === "failed" ? handleRetire : undefined}
            />
          )}

          {/* View certificate link after success */}
          {retirementId && txStatus === "confirmed" && (
            <a
              href={`/retire/${retirementId}`}
              style={{
                display: "block",
                textAlign: "center",
                background: colors.primary[50],
                color: colors.primary[700],
                border: `1px solid ${colors.primary[200]}`,
                borderRadius: "0.5rem",
                padding: "0.875rem",
                fontSize: "0.9rem",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              {t("viewCertificate")}
            </a>
          )}

          {/* Wallet prompt or CTA */}
          {walletStatus !== "ready" ? (
            <WalletPrompt
              status={walletStatus}
              onConnect={handleConnect}
              refresh={refreshWallet}
            />
          ) : !showPreview ? (
            /* Before preview: "Review & Preview" CTA */
            <button
              type="button"
              onClick={handleShowPreview}
              disabled={isDisabled}
              aria-disabled={isDisabled}
              aria-describedby="retire-warning"
              style={{
                background: isDisabled ? colors.neutral[300] : "#dc2626",
                color: "#fff",
                border: "none",
                borderRadius: "0.5rem",
                padding: "0.875rem",
                fontSize: "1rem",
                fontWeight: 700,
                cursor: isDisabled ? "not-allowed" : "pointer",
              }}
            >
              {txStatus === "confirmed"
                ? t("retiredCheck")
                : busy
                  ? t("processing")
                  : "Review retirement →"}
            </button>
          ) : null}
        </div>

        {/* Safety confirmation modal (shown after Confirm in preview) */}
        {showModal && (
          <RetireConfirmModal
            amount={amount}
            beneficiary={beneficiary}
            reason={reason}
            onConfirm={() => {
              setShowModal(false);
              handleRetire();
            }}
            onCancel={() => setShowModal(false)}
          />
        )}

        <Toast toasts={toasts} onDismiss={dismiss} />
      </div>
    </ErrorBoundary>
  );
}

// ── Page export ────────────────────────────────────────────────────────────────

export default function RetirePage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "2rem" }}>Loading retirement flow…</div>
      }
    >
      <RetirePageContent />
    </Suspense>
  );
}

export default function RetirePage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}>Loading retirement flow…</div>}>
      <RetirePageContent />
    </Suspense>
  );
}

export default function RetirePage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}>Loading retirement flow…</div>}>
      <RetirePageContent />
    </Suspense>
  );
}
