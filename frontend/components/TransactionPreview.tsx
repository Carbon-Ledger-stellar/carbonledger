"use client";

import { colors } from "../styles/design-system";
import { PreviewState } from "../lib/transaction-preview-types";

interface Props {
  /** Short heading displayed above the effect list, e.g. "Transaction preview". */
  title?: string;
  /** One-line description below the heading. */
  description?: string;
  /** Simulation result state managed by the parent. */
  preview: PreviewState;
  /**
   * Called when the user clicks "Confirm". The parent is responsible for
   * triggering the Freighter signing prompt inside this callback.
   * Not rendered while preview.loading is true or when preview has an error.
   */
  onConfirm?: () => void;
  /**
   * Called when the user clicks "Cancel". The parent can use this to reset
   * the form or navigate away.
   */
  onCancel?: () => void;
  /** Label for the confirm button (default: "Confirm & Sign"). */
  confirmLabel?: string;
  /** Label for the cancel button (default: "Cancel"). */
  cancelLabel?: string;
  /**
   * When true the Confirm button is rendered in a loading / busy state and
   * cannot be clicked (e.g. the Freighter prompt is already open).
   */
  confirming?: boolean;
}

/**
 * TransactionPreview — reusable pre-signing preview card.
 *
 * Usage:
 *  1. Parent runs simulatePurchasePreview / simulateRetirementPreview and
 *     puts the result into local state as `preview`.
 *  2. Parent renders <TransactionPreview preview={preview} onConfirm={…} onCancel={…} />.
 *  3. User reviews the effect list and either confirms (triggers Freighter) or
 *     cancels.
 *
 * The Confirm button is disabled while preview.loading is true or while
 * preview.ready is false (simulation error). This ensures the user cannot
 * sign a transaction whose effects could not be validated.
 */
export default function TransactionPreview({
  title = "Transaction preview",
  description = "Review the effects below before signing with your wallet.",
  preview,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm & Sign",
  cancelLabel = "Cancel",
  confirming = false,
}: Props) {
  const hasError = !preview.loading && !!preview.error;
  const canConfirm = !preview.loading && preview.ready && !hasError && !confirming;

  const containerStyle: React.CSSProperties = {
    border: `1px solid ${hasError ? "#fca5a5" : colors.primary[200]}`,
    borderRadius: "0.75rem",
    background: hasError ? "#fef2f2" : colors.primary[50],
    padding: "1rem 1.1rem",
  };

  return (
    <div style={containerStyle} role="region" aria-label="Transaction preview" aria-live="polite">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
        <div>
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>
            {title}
          </p>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[600], margin: "0.25rem 0 0" }}>
            {description}
          </p>
        </div>
        {preview.loading ? (
          <span
            style={{ fontSize: "0.8rem", color: colors.primary[700], fontWeight: 700 }}
            aria-label="Simulating transaction…"
          >
            Simulating…
          </span>
        ) : preview.ready ? (
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#15803d",
              background: "#dcfce7",
              border: "1px solid #86efac",
              borderRadius: "0.375rem",
              padding: "0.2rem 0.5rem",
            }}
            aria-label="Simulation ready"
          >
            ✓ Ready
          </span>
        ) : null}
      </div>

      {/* Body */}
      {preview.loading ? (
        /* Loading skeleton */
        <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.6rem" }} aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: "1.2rem",
                background: colors.primary[100],
                borderRadius: "0.25rem",
                opacity: 0.6 + i * 0.1,
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
          <style>{`@keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }`}</style>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: colors.neutral[500] }}>
            Simulating the transaction with Soroban. This takes a few seconds…
          </p>
        </div>
      ) : hasError ? (
        /* Error state */
        <div style={{ marginTop: "0.8rem" }}>
          <p
            id="tx-preview-error"
            style={{ margin: 0, fontSize: "0.875rem", color: "#b91c1c", fontWeight: 600 }}
            role="alert"
          >
            ⚠ {preview.error}
          </p>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: colors.neutral[600] }}>
            The {confirmLabel} button is disabled. Resolve the issue above and try again.
          </p>
        </div>
      ) : (
        /* Effects list */
        <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.5rem" }}>
          {preview.effects.map((effect) => (
            <div
              key={effect.label}
              style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "baseline" }}
            >
              <span style={{ fontSize: "0.85rem", color: colors.neutral[700] }}>{effect.label}</span>
              <span
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  color: colors.neutral[900],
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {effect.value}
              </span>
            </div>
          ))}

          {/* Separator before fee (already included in effects, but show accent) */}
          {preview.feeEstimate && (
            <div
              style={{
                borderTop: `1px dashed ${colors.primary[200]}`,
                paddingTop: "0.4rem",
                display: "flex",
                justifyContent: "space-between",
                gap: "0.75rem",
                alignItems: "baseline",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: colors.neutral[500] }}>
                Estimated total fee
              </span>
              <span
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: colors.primary[700],
                  textAlign: "right",
                }}
              >
                {preview.feeEstimate}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Confirm / Cancel row — only rendered when callbacks are provided */}
      {(onConfirm || onCancel) && (
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "flex-end",
            marginTop: "1rem",
            paddingTop: "0.75rem",
            borderTop: `1px solid ${hasError ? "#fecaca" : colors.primary[200]}`,
          }}
        >
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={confirming}
              aria-disabled={confirming}
              style={{
                background: "transparent",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.5rem",
                padding: "0.55rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                color: colors.neutral[600],
                cursor: confirming ? "not-allowed" : "pointer",
                opacity: confirming ? 0.5 : 1,
              }}
            >
              {cancelLabel}
            </button>
          )}

          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm}
              aria-disabled={!canConfirm}
              aria-describedby={hasError ? "tx-preview-error" : undefined}
              style={{
                background: canConfirm ? colors.primary[600] : colors.neutral[300],
                border: "none",
                borderRadius: "0.5rem",
                padding: "0.55rem 1.25rem",
                fontSize: "0.875rem",
                fontWeight: 700,
                color: "#fff",
                cursor: canConfirm ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                transition: "background 0.15s",
              }}
            >
              {confirming && (
                <span
                  style={{
                    width: "0.875rem",
                    height: "0.875rem",
                    border: "2px solid #ffffff60",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin 0.7s linear infinite",
                  }}
                  aria-hidden="true"
                />
              )}
              {confirming ? "Signing…" : confirmLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
