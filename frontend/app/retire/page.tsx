"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { retireCredits } from "../../lib/api";
import { formatTonnes } from "../../lib/carbon-utils";
import { connectFreighter } from "../../lib/freighter";
import { getWalletErrorMessage, getContractErrorMessage } from "../../lib/wallet-errors";
import { colors } from "../../styles/design-system";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import Toast, { useToast } from "../../components/Toast";
import { useWalletStatus } from "../../hooks/useWalletStatus";
import WalletPrompt from "../../components/WalletPrompt";
import ErrorBoundary from "../../components/ErrorBoundary";
import RetireConfirmModal from "../../components/RetireConfirmModal";
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

function validateBeneficiary(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Beneficiary name is required";
  }
  if (trimmed.length > VALIDATION_LIMITS.beneficiary.max) {
    return `Beneficiary name must not exceed ${VALIDATION_LIMITS.beneficiary.max} characters`;
  }
  return undefined;
}

function validateReason(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Retirement reason is required";
  }
  if (trimmed.length > VALIDATION_LIMITS.reason.max) {
    return `Retirement reason must not exceed ${VALIDATION_LIMITS.reason.max} characters`;
  }
  return undefined;
}

function validateAmount(value: number, userBalance?: number): string | undefined {
  if (value < VALIDATION_LIMITS.amount.min) {
    return `Amount must be at least ${VALIDATION_LIMITS.amount.min} tCO₂e`;
  }
  if (!Number.isInteger(value * 100)) {
    return "Amount must have at most 2 decimal places";
  }
  if (userBalance !== undefined && value > userBalance) {
    return `Amount cannot exceed your balance of ${userBalance} tCO₂e`;
  }
  return undefined;
}

function validateForm(form: RetireFormState, userBalance?: number): ValidationErrors {
  return {
    beneficiary: validateBeneficiary(form.beneficiary),
    reason: validateReason(form.reason),
    amount: validateAmount(form.amount, userBalance),
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
  const searchParams = useSearchParams();
  const batchId      = searchParams.get("batch") ?? "";

  const [amount, setAmount]           = useState(1);
  const [beneficiary, setBeneficiary] = useState("");
  const [reason, setReason]         = useState("");
  const [txStatus, setTxStatus]     = useState<TxStatus | null>(null);
  const [txHash, setTxHash]         = useState<string | null>(null);
  const [retirementId, setRetirementId] = useState<string | null>(null);
  const [showModal, setShowModal]     = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState({ beneficiary: false, reason: false, amount: false });
  const { toasts, addToast, dismiss } = useToast();
  const { status: walletStatus, address: walletKey, refresh: refreshWallet } = useWalletStatus();

  async function handleConnect(key: string) {
    addToast({ type: "success", title: "Wallet connected", message: key.slice(0, 8) + "…" });
  }

  const handleBlur = (field: 'beneficiary' | 'reason' | 'amount') => {
    setTouched(prev => ({ ...prev, [field]: true }));
    
    // Validate the specific field
    if (field === 'beneficiary') {
      const error = validateBeneficiary(beneficiary);
      setValidationErrors(prev => ({ ...prev, beneficiary: error }));
    } else if (field === 'reason') {
      const error = validateReason(reason);
      setValidationErrors(prev => ({ ...prev, reason: error }));
    } else if (field === 'amount') {
      const error = validateAmount(amount);
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
    const errors = validateForm({ batchId, amount, beneficiary, reason });
    
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
    const errors = validateForm({ batchId, amount, beneficiary, reason });
    if (hasErrors(errors)) {
      addToast({ 
        type: "error", 
        title: "Validation failed", 
        message: "Please correct the form errors before proceeding" 
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
      await new Promise(r => setTimeout(r, 2000));
      setTxHash(result.txHash);
      setRetirementId(result.retirementId);
      setTxStatus("confirmed");
      addToast({
        type:    "success",
        title:   "Credits permanently retired",
        message: `${formatTonnes(amount)} retired on behalf of ${beneficiary}`,
        txHash:  result.txHash,
      });
    } catch (e: any) {
      setTxStatus("failed");
      addToast({ type: "error", title: "Retirement failed", message: getContractErrorMessage(e) });
    }
  }

  const busy = txStatus && !["confirmed", "failed"].includes(txStatus);
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
        Retire Carbon Credits
      </h1>
      <p style={{ color: colors.neutral[500], margin: "0 0 2rem" }}>
        Retirement is permanent and irreversible. A verifiable certificate will be issued for ESG reporting.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            Amount to Retire (tonnes CO₂e) — minimum 0.01 tCO₂e
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
            Beneficiary Name <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <input
            id="retire-beneficiary"
            type="text"
            placeholder="e.g. Acme Corporation"
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
                Appears on certificate
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
            Retirement Reason <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <textarea
            id="retire-reason"
            placeholder="e.g. Offsetting 2023 Scope 1 and 2 emissions"
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
            Retirement is <strong>permanent and irreversible</strong>. Once retired, these credits cannot be transferred, resold, or retired again.
          </p>
        </div>

        {txStatus && <TransactionStatus status={txStatus} txHash={txHash ?? undefined} onRetry={txStatus === "failed" ? handleRetire : undefined} />}

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
            View &amp; Download Certificate →
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
            {txStatus === "confirmed" ? "Retired ✓" :
             busy ? "Processing…" :
             `Permanently Retire ${formatTonnes(amount)}`}
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
