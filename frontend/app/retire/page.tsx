"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { retireCredits } from "../../lib/api";
import { formatTonnes } from "../../lib/carbon-utils";
import { connectFreighter } from "../../lib/freighter";
import { getWalletErrorMessage } from "../../lib/wallet-errors";
import { colors } from "../../styles/design-system";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import Toast, { useToast } from "../../components/Toast";
import { useWalletStatus } from "../../hooks/useWalletStatus";
import WalletPrompt from "../../components/WalletPrompt";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RetireFormState {
  batchId: string;
  amount: number;
  beneficiary: string;
  reason: string;
}

type Step = 1 | 2 | 3 | 4 | 5;

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

const labelStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
  color: colors.neutral[700],
  display: "block",
  marginBottom: "0.4rem",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? colors.neutral[300] : colors.primary[600],
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    padding: "0.875rem",
    fontSize: "1rem",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    width: "100%",
  };
}

const secondaryBtn: React.CSSProperties = {
  background: "transparent",
  color: colors.neutral[600],
  border: `1px solid ${colors.neutral[300]}`,
  borderRadius: "0.5rem",
  padding: "0.875rem 1.25rem",
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer",
};

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ["Select Credits", "Details", "Review", "Sign", "Done"];

function StepIndicator({ current }: { current: Step }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "2rem" }}>
      {STEPS.map((label, i) => {
        const n = (i + 1) as Step;
        const done   = n < current;
        const active = n === current;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
              <div style={{
                width: "2rem", height: "2rem", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.8rem", fontWeight: 700,
                background: done || active ? colors.primary[600] : colors.neutral[200],
                color: done || active ? "#fff" : colors.neutral[500],
              }}>
                {done ? "✓" : n}
              </div>
              <span style={{
                fontSize: "0.65rem", fontWeight: active ? 700 : 400,
                color: active ? colors.primary[700] : colors.neutral[400],
                whiteSpace: "nowrap",
              }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: "2px", margin: "0 0.25rem",
                marginBottom: "1.25rem",
                background: done ? colors.primary[400] : colors.neutral[200],
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Select credits ────────────────────────────────────────────────────

function Step1({
  form, onChange, onNext,
}: {
  form: RetireFormState;
  onChange: (k: keyof RetireFormState, v: string | number) => void;
  onNext: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <label style={labelStyle}>Batch ID</label>
        <input
          type="text"
          placeholder="e.g. batch-proj-2023-0001"
          value={form.batchId}
          onChange={e => onChange("batchId", e.target.value)}
          style={inputStyle}
        />
        <p style={{ fontSize: "0.75rem", color: colors.neutral[400], margin: "0.3rem 0 0" }}>
          Find your batch ID in your dashboard or from a marketplace purchase.
        </p>
      </div>
      <div>
        <label style={labelStyle}>Amount to Retire (tCO₂e) — minimum 0.01</label>
        <input
          type="number"
          min={0.01}
          step={0.01}
          value={form.amount}
          onChange={e => {
            const v = parseFloat(parseFloat(e.target.value).toFixed(2));
            onChange("amount", Math.max(0.01, v || 0.01));
          }}
          style={inputStyle}
        />
      </div>
      <button onClick={onNext} disabled={!form.batchId} style={primaryBtn(!form.batchId)}>
        Continue →
      </button>
    </div>
  );
}

// ── Step 2: Beneficiary + reason ──────────────────────────────────────────────

function Step2({
  form, onChange, onBack, onNext,
}: {
  form: RetireFormState;
  onChange: (k: keyof RetireFormState, v: string | number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const canProceed = form.beneficiary.trim().length > 0 && form.reason.trim().length > 0;
  const showError  = !canProceed && (form.beneficiary.length > 0 || form.reason.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <label style={labelStyle}>
          Beneficiary Name <span style={{ color: "#dc2626" }}>*</span>
        </label>
        <input
          type="text"
          placeholder="e.g. Acme Corporation"
          value={form.beneficiary}
          onChange={e => onChange("beneficiary", e.target.value)}
          style={inputStyle}
        />
        <p style={{ fontSize: "0.75rem", color: colors.neutral[400], margin: "0.3rem 0 0" }}>
          This name appears on the retirement certificate.
        </p>
      </div>
      <div>
        <label style={labelStyle}>
          Retirement Reason <span style={{ color: "#dc2626" }}>*</span>
        </label>
        <textarea
          placeholder="e.g. Offsetting 2023 Scope 1 and 2 emissions"
          value={form.reason}
          onChange={e => onChange("reason", e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>
      {showError && (
        <p style={{ fontSize: "0.8rem", color: "#dc2626", margin: 0 }}>
          Both beneficiary name and retirement reason are required to proceed.
        </p>
      )}
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button onClick={onBack} style={secondaryBtn}>← Back</button>
        <button onClick={onNext} disabled={!canProceed} style={{ ...primaryBtn(!canProceed), flex: 1 }}>
          Review →
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Review ────────────────────────────────────────────────────────────

function Step3({
  form, walletKey, onConnect, onBack, onNext,
}: {
  form: RetireFormState;
  walletKey: string | null;
  onConnect: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const serialStart = `${form.batchId}-0001`;
  const serialEnd   = `${form.batchId}-${String(Math.ceil(form.amount)).padStart(4, "0")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Summary card */}
      <div style={{
        background: colors.primary[50],
        border: `1px solid ${colors.primary[200]}`,
        borderRadius: "0.75rem",
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: colors.primary[800] }}>
          Retirement Summary
        </h3>
        {([
          ["Batch ID",     form.batchId],
          ["Amount",       formatTonnes(form.amount)],
          ["Beneficiary",  form.beneficiary],
          ["Reason",       form.reason],
          ["Serial Range", `${serialStart} – ${serialEnd}`],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <span style={{ fontSize: "0.8rem", color: colors.neutral[500], flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: colors.neutral[800], textAlign: "right", wordBreak: "break-all" }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Irreversibility warning */}
      <div style={{
        background: "#fef9c3", border: "1px solid #fde047",
        borderRadius: "0.5rem", padding: "0.875rem 1rem",
        display: "flex", gap: "0.75rem",
      }}>
        <span>⚠️</span>
        <p style={{ fontSize: "0.8rem", color: "#854d0e", margin: 0 }}>
          Retirement is <strong>permanent and irreversible</strong>. Once retired, these credits cannot be transferred, resold, or retired again.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button onClick={onBack} style={secondaryBtn}>← Back</button>
        {!walletKey ? (
          <button onClick={onConnect} style={{ ...primaryBtn(false), flex: 1 }}>
            Connect Wallet to Sign
          </button>
        ) : (
          <button onClick={onNext} style={{ ...primaryBtn(false), flex: 1, background: "#dc2626" }}>
            Sign &amp; Retire Permanently
          </button>
        )}
      </div>

      {walletKey && (
        <p style={{ fontSize: "0.75rem", color: colors.neutral[400], textAlign: "center", margin: 0 }}>
          Signing as {walletKey.slice(0, 8)}…{walletKey.slice(-8)}
        </p>
      )}
    </div>
  );
}

// ── Step 4: Signing / submitting ──────────────────────────────────────────────

function Step4({ txStatus, txHash }: { txStatus: TxStatus | null; txHash: string | null }) {
  const icon =
    txStatus === "confirmed" ? "✅" :
    txStatus === "failed"    ? "❌" : "⏳";

  const message =
    txStatus === "pending"   ? "Preparing transaction…"       :
    txStatus === "submitted" ? "Waiting for confirmation…"    :
    txStatus === "confirmed" ? "Credits retired successfully!" :
    txStatus === "failed"    ? "Transaction failed"           : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", alignItems: "center", padding: "1rem 0" }}>
      <div style={{ fontSize: "3rem" }}>{icon}</div>
      <p style={{ fontWeight: 700, fontSize: "1.1rem", color: colors.neutral[800], margin: 0, textAlign: "center" }}>
        {message}
      </p>
      {txStatus && <TransactionStatus status={txStatus} txHash={txHash ?? undefined} />}
    </div>
  );
}

// ── Step 5: Confirmation ──────────────────────────────────────────────────────

function Step5({
  retirementId, txHash, beneficiary, amount,
}: {
  retirementId: string;
  txHash: string;
  beneficiary: string;
  amount: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", alignItems: "center", textAlign: "center" }}>
      <div style={{ fontSize: "4rem" }}>🌿</div>
      <div>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: colors.primary[800], margin: "0 0 0.5rem" }}>
          {formatTonnes(amount)} Permanently Retired
        </h2>
        <p style={{ color: colors.neutral[500], margin: 0 }}>
          On behalf of <strong>{beneficiary}</strong>. A verifiable certificate has been issued.
        </p>
      </div>

      {/* Certificate link — prominent per AC */}
      <a
        href={`/retire/${retirementId}`}
        style={{
          display: "block", width: "100%",
          background: colors.primary[600], color: "#fff",
          borderRadius: "0.75rem", padding: "1rem",
          fontSize: "1rem", fontWeight: 700, textDecoration: "none",
          boxShadow: "0 4px 12px rgb(22 163 74 / 0.3)",
        }}
      >
        🏆 View &amp; Download Certificate →
      </a>

      <div style={{ display: "flex", gap: "0.75rem", width: "100%" }}>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, textAlign: "center",
            color: colors.primary[700],
            border: `1px solid ${colors.primary[300]}`,
            borderRadius: "0.5rem", padding: "0.75rem",
            fontSize: "0.875rem", fontWeight: 600, textDecoration: "none",
          }}
        >
          View on Stellar →
        </a>
        <a
          href="/dashboard"
          style={{
            flex: 1, textAlign: "center",
            color: colors.neutral[600],
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.5rem", padding: "0.75rem",
            fontSize: "0.875rem", fontWeight: 600, textDecoration: "none",
          }}
        >
          Back to Dashboard
        </a>
      </div>

      <p style={{ fontSize: "0.75rem", color: colors.neutral[400], margin: 0 }}>
        Retirement ID: <code style={{ fontFamily: "monospace" }}>{retirementId}</code>
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RetirePage() {
  const searchParams = useSearchParams();
  const batchId      = searchParams.get("batch") ?? "";

  const [amount, setAmount]         = useState(1);
  const [beneficiary, setBeneficiary] = useState("");
  const [reason, setReason]         = useState("");
  const [txStatus, setTxStatus]     = useState<TxStatus | null>(null);
  const [txHash, setTxHash]         = useState<string | null>(null);
  const [retirementId, setRetirementId] = useState<string | null>(null);
  const { toasts, addToast, dismiss } = useToast();
  const { status: walletStatus, address: walletKey, refresh: refreshWallet } = useWalletStatus();

  async function handleConnect(key: string) {
    addToast({ type: "success", title: "Wallet connected", message: key.slice(0, 8) + "…" });
  }

  async function handleRetire() {
    if (!walletKey || !batchId || !beneficiary || !reason) return;
    setTxStatus("building");
    try {
      await new Promise(r => setTimeout(r, 500));
      setTxStatus("signing");
      await new Promise(r => setTimeout(r, 1000));
      setTxStatus("submitting");
      const result = await retireCredits({
        batchId:          form.batchId,
        amount:           form.amount,
        beneficiary:      form.beneficiary,
        retirementReason: form.reason,
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
        message: `${formatTonnes(form.amount)} retired on behalf of ${form.beneficiary}`,
        txHash:  result.txHash,
      });
      // Brief pause so user sees confirmed state before step 5
      setTimeout(() => setStep(5), 1200);
    } catch (e: any) {
      setTxStatus("failed");
      addToast({ type: "error", title: "Retirement failed", message: e.message });
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: `1px solid ${colors.neutral[300]}`,
    borderRadius: "0.5rem", padding: "0.75rem 1rem",
    fontSize: "0.9rem", color: colors.neutral[900],
    boxSizing: "border-box",
  };

  const busy = txStatus && !["confirmed", "failed"].includes(txStatus);
  const isDisabled = !beneficiary || !reason || !!busy || txStatus === "confirmed";

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
            type="number" min={0.01} step={0.01} value={amount}
            onChange={e => {
              const v = parseFloat(parseFloat(e.target.value).toFixed(2));
              setAmount(Math.max(0.01, v || 0.01));
            }}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="retire-beneficiary" style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            Beneficiary Name (appears on certificate)
          </label>
          <input
            id="retire-beneficiary"
            type="text"
            placeholder="e.g. Acme Corporation"
            value={beneficiary}
            onChange={e => setBeneficiary(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="retire-reason" style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.4rem" }}>
            Retirement Reason
          </label>
          <textarea
            id="retire-reason"
            placeholder="e.g. Offsetting 2023 Scope 1 and 2 emissions"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
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
            View & Download Certificate →
          </a>
        )}

        {walletStatus !== "ready" ? (
          <WalletPrompt status={walletStatus} onConnect={handleConnect} refresh={refreshWallet} />
        ) : (
          <button
            type="button"
            onClick={handleRetire}
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

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
    </ErrorBoundary>
  );
}
