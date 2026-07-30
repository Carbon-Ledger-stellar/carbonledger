"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { retireCredits } from "../../lib/api";
import { formatTonnes } from "../../lib/carbon-utils";
import { connectFreighter } from "../../lib/freighter";
import { getWalletErrorMessage, getContractErrorMessage } from "../../lib/wallet-errors";
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

type Step = 1 | 2 | 3 | 4 | 5;

// ── Validation Constants ──────────────────────────────────────────────────────

const VALIDATION_LIMITS = {
  beneficiary: { min: 1, max: 100 },
  reason: { min: 1, max: 500 },
  amount: { min: 0.01, max: Number.MAX_SAFE_INTEGER },
} as const;

// ── Validation helpers ────────────────────────────────────────────────────────
// `t` is threaded through from useTranslations("retirePage") so validation
// messages are localized without turning these into hooks themselves.

type Translator = (key: string, values?: Record<string, string | number>) => string;

function validateBeneficiary(value: string, t: Translator): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return t("beneficiaryRequired");
  }
  if (trimmed.length > VALIDATION_LIMITS.beneficiary.max) {
    return t("beneficiaryTooLong", { max: VALIDATION_LIMITS.beneficiary.max });
  }
  return undefined;
}

function validateReason(value: string, t: Translator): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return t("reasonRequired");
  }
  if (trimmed.length > VALIDATION_LIMITS.reason.max) {
    return t("reasonTooLong", { max: VALIDATION_LIMITS.reason.max });
  }
  return undefined;
}

function validateAmount(value: number, t: Translator, userBalance?: number): string | undefined {
  if (value < VALIDATION_LIMITS.amount.min) {
    return t("amountTooSmall", { min: VALIDATION_LIMITS.amount.min });
  }
  if (!Number.isInteger(value * 100)) {
    return t("amountTooPrecise");
  }
  if (userBalance !== undefined && value > userBalance) {
    return t("amountExceedsBalance", { balance: userBalance });
  }
  return undefined;
}

function validateForm(form: RetireFormState, t: Translator, userBalance?: number): ValidationErrors {
  return {
    beneficiary: validateBeneficiary(form.beneficiary, t),
    reason: validateReason(form.reason, t),
    amount: validateAmount(form.amount, t, userBalance),
  };
}

function hasErrors(errors: ValidationErrors): boolean {
  return Object.values(errors).some(error => error !== undefined);
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
  border: `1px solid #dc2626`,
};

const errorTextStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#dc2626",
  margin: "0.3rem 0 0",
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RetirePage() {
  const t = useTranslations("retirePage");
  const searchParams = useSearchParams();
  const batchId      = searchParams.get("batch") ?? "";

  const [amount, setAmount]           = useState(1);
  const [beneficiary, setBeneficiary] = useState("");
  const [reason, setReason]         = useState("");
  const [txStatus, setTxStatus]     = useState<TxStatus | null>(null);
  const [txHash, setTxHash]         = useState<string | null>(null);
  const [pollHash, setPollHash]     = useState<string | null>(null);
  const { pollCount, state: pollState, errorMessage: pollError } = useTransactionPoller({
    txHash: pollHash,
  });
  const [retirementId, setRetirementId] = useState<string | null>(null);
  const [showModal, setShowModal]     = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState({ beneficiary: false, reason: false, amount: false });
  const { toasts, addToast, dismiss } = useToast();
  const { status: walletStatus, address: walletKey, refresh: refreshWallet } = useWalletStatus();

  async function handleConnect(key: string) {
    addToast({ type: "success", title: t("walletConnectedTitle"), message: key.slice(0, 8) + "…" });
  }

  const handleBlur = (field: 'beneficiary' | 'reason' | 'amount') => {
    setTouched(prev => ({ ...prev, [field]: true }));

    // Validate the specific field
    if (field === 'beneficiary') {
      const error = validateBeneficiary(beneficiary, t);
      setValidationErrors(prev => ({ ...prev, beneficiary: error }));
    } else if (field === 'reason') {
      const error = validateReason(reason, t);
      setValidationErrors(prev => ({ ...prev, reason: error }));
    } else if (field === 'amount') {
      const error = validateAmount(amount, t);
      setValidationErrors(prev => ({ ...prev, amount: error }));
    }
  };

  const handleFieldChange = (field: 'beneficiary' | 'reason', value: string) => {
    if (field === 'beneficiary') {
      setBeneficiary(value);
    } else if (field === 'reason') {
      setReason(value);
    }
    
    // Clear error when user starts typing
    if (touched[field]) {
      setValidationErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const handleAmountChange = (value: number) => {
    setAmount(value);
    
    // Clear error when user changes value
    if (touched.amount) {
      setValidationErrors(prev => ({ ...prev, amount: undefined }));
    }
  };

  const handleShowModal = () => {
    // Validate all fields before showing modal
    const errors = validateForm({ batchId, amount, beneficiary, reason }, t);

    setValidationErrors(errors);
    setTouched({ beneficiary: true, reason: true, amount: true });

    // Only show modal if no validation errors
    if (!hasErrors(errors)) {
      setShowModal(true);
    }
  };

  async function handleRetire() {
    if (!walletKey || !batchId || !beneficiary || !reason) return;

    // Final validation before signing
    const errors = validateForm({ batchId, amount, beneficiary, reason }, t);
    if (hasErrors(errors)) {
      addToast({
        type: "error",
        title: t("validationFailedTitle"),
        message: t("validationFailedMessage"),
      });
      return;
    }

    setTxStatus("building");
    try {
      await new Promise(r => setTimeout(r, 500));
      setTxStatus("signing");
      await new Promise(r => setTimeout(r, 1000));
      setTxStatus("submitting");
      const result = await retireCredits({
        batchId,
        amount,
        beneficiary,
        retirementReason: reason,
        holderPublicKey:  walletKey,
      });
      setTxStatus("polling");
      setTxHash(result.txHash);
      setRetirementId(result.retirementId);
      setPollHash(result.txHash);
    } catch (e: any) {
      setTxStatus("failed");
      setPollHash(null);
      addToast({ type: "error", title: t("retirementFailedTitle"), message: getContractErrorMessage(e) });
    }
  }

  useEffect(() => {
    if (!pollHash || pollState === "idle" || pollState === "polling") return;

    if (pollState === "SUCCESS") {
      setTxStatus("confirmed");
      addToast({
        type:    "success",
        title:   t("retiredSuccessTitle"),
        message: t("retiredSuccessMessage", { tonnes: formatTonnes(amount), beneficiary }),
        txHash:  pollHash,
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

  const busy = txStatus && !["confirmed", "failed", "timed_out"].includes(txStatus);
  const hasValidationErrors = hasErrors(validationErrors);
  const isDisabled = hasValidationErrors || !!busy || txStatus === "confirmed";
  
  const beneficiaryLength = beneficiary.length;
  const reasonLength = reason.length;
  const showBeneficiaryError = touched.beneficiary && validationErrors.beneficiary;
  const showReasonError = touched.reason && validationErrors.reason;
  const showAmountError = touched.amount && validationErrors.amount;

  return (
    <ErrorBoundary>
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
        {t("title")}
      </h1>
      <p style={{ color: colors.neutral[500], margin: "0 0 2rem" }}>
        {t("subtitle")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            {t("amountLabel")}
          </label>
          <input
            type="number" 
            min={0.01} 
            step={0.01} 
            value={amount}
            onChange={e => {
              const v = parseFloat(parseFloat(e.target.value).toFixed(2));
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

        <div>
          <label htmlFor="retire-beneficiary" style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            {t("beneficiaryLabel")} <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <input
            id="retire-beneficiary"
            type="text"
            placeholder={t("beneficiaryPlaceholder")}
            value={beneficiary}
            onChange={e => handleFieldChange("beneficiary", e.target.value)}
            onBlur={() => handleBlur("beneficiary")}
            maxLength={VALIDATION_LIMITS.beneficiary.max}
            style={showBeneficiaryError ? inputErrorStyle : inputStyle}
            aria-invalid={showBeneficiaryError ? "true" : "false"}
            aria-describedby={showBeneficiaryError ? "beneficiary-error-main" : undefined}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {showBeneficiaryError ? (
              <p id="beneficiary-error-main" style={errorTextStyle}>
                {validationErrors.beneficiary}
              </p>
            ) : (
              <p style={{ fontSize: "0.75rem", color: colors.neutral[400], margin: "0.3rem 0 0" }}>
                {t("appearsOnCertificate")}
              </p>
            )}
            <p style={{ 
              fontSize: "0.75rem", 
              color: beneficiaryLength > VALIDATION_LIMITS.beneficiary.max * 0.9 ? "#dc2626" : colors.neutral[400],
              margin: "0.3rem 0 0",
              fontWeight: beneficiaryLength > VALIDATION_LIMITS.beneficiary.max * 0.9 ? 600 : 400,
            }}>
              {beneficiaryLength}/{VALIDATION_LIMITS.beneficiary.max}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="retire-reason" style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            {t("reasonLabel")} <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <textarea
            id="retire-reason"
            placeholder={t("reasonPlaceholder")}
            value={reason}
            onChange={e => handleFieldChange("reason", e.target.value)}
            onBlur={() => handleBlur("reason")}
            maxLength={VALIDATION_LIMITS.reason.max}
            rows={3}
            style={{ 
              ...(showReasonError ? inputErrorStyle : inputStyle), 
              resize: "vertical" 
            }}
            aria-invalid={showReasonError ? "true" : "false"}
            aria-describedby={showReasonError ? "reason-error-main" : undefined}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {showReasonError && (
              <p id="reason-error-main" style={errorTextStyle}>
                {validationErrors.reason}
              </p>
            )}
            <p style={{ 
              fontSize: "0.75rem", 
              color: reasonLength > VALIDATION_LIMITS.reason.max * 0.9 ? "#dc2626" : colors.neutral[400],
              margin: "0.3rem 0 0",
              marginLeft: "auto",
              fontWeight: reasonLength > VALIDATION_LIMITS.reason.max * 0.9 ? 600 : 400,
            }}>
              {reasonLength}/{VALIDATION_LIMITS.reason.max}
            </p>
          </div>
        </div>

        {/* Warning */}
        <div
          id="retire-warning"
          role="note"
          style={{
            background: "#fef9c3", border: "1px solid #fde047",
            borderRadius: "0.5rem", padding: "0.875rem 1rem",
            display: "flex", gap: "0.75rem",
          }}
        >
          <span aria-hidden="true">⚠️</span>
          <p style={{ fontSize: "0.8rem", color: "#854d0e", margin: 0 }}>
            {t("irreversibleWarningPrefix")} <strong>{t("irreversibleWarningEmphasis")}</strong> {t("irreversibleWarningSuffix")}
          </p>
        </div>

        {txStatus && (
          <TransactionStatus
            status={txStatus}
            txHash={txHash ?? undefined}
            pollProgress={
              txStatus === "polling"
                ? { current: pollCount, max: TRANSACTION_MAX_POLLS }
                : undefined
            }
            message={txStatus === "failed" ? pollError ?? undefined : undefined}
            onRetry={txStatus === "failed" ? handleRetire : undefined}
          />
        )}

        {retirementId && txStatus === "confirmed" && (
          <a
            href={`/retire/${retirementId}`}
            style={{
              display: "block", textAlign: "center",
              background: colors.primary[50], color: colors.primary[700],
              border: `1px solid ${colors.primary[200]}`,
              borderRadius: "0.5rem", padding: "0.875rem",
              fontSize: "0.9rem", fontWeight: 700, textDecoration: "none",
            }}
          >
            {t("viewCertificate")}
          </a>
        )}

        {walletStatus !== "ready" ? (
          <WalletPrompt status={walletStatus} onConnect={handleConnect} refresh={refreshWallet} />
        ) : (
          <button
            type="button"
            onClick={handleShowModal}
            disabled={isDisabled}
            aria-disabled={isDisabled}
            aria-describedby="retire-warning"
            style={{
              background: isDisabled ? colors.neutral[300] : "#dc2626",
              color: "#fff", border: "none", borderRadius: "0.5rem",
              padding: "0.875rem", fontSize: "1rem", fontWeight: 700,
              cursor: isDisabled ? "not-allowed" : "pointer",
            }}
          >
            {txStatus === "confirmed" ? t("retiredCheck") :
             busy ? t("processing") :
             t("permanentlyRetire", { tonnes: formatTonnes(amount) })}
          </button>
        )}
      </div>

      {showModal && (
        <RetireConfirmModal
          amount={amount}
          beneficiary={beneficiary}
          reason={reason}
          onConfirm={() => { setShowModal(false); handleRetire(); }}
          onCancel={() => setShowModal(false)}
        />
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
    </ErrorBoundary>
  );
}

export default function RetirePage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}>Loading retirement flow…</div>}>
      <RetirePageContent />
    </Suspense>
  );
}
