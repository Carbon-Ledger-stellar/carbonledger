"use client";

import { colors } from "../styles/design-system";
import { PreviewState } from "../lib/transaction-preview-types";

interface Props {
  title: string;
  description: string;
  preview: PreviewState;
  disabled?: boolean;
  ctaLabel: string;
}

export default function TransactionPreview({ title, description, preview, disabled, ctaLabel }: Props) {
  return (
    <div
      style={{
        border: `1px solid ${preview.error ? "#fca5a5" : colors.primary[200]}`,
        borderRadius: "0.75rem",
        background: preview.error ? "#fef2f2" : colors.primary[50],
        padding: "1rem 1.1rem",
      }}
      aria-live="polite"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
        <div>
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>{title}</p>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[600], margin: "0.25rem 0 0" }}>{description}</p>
        </div>
        {preview.loading ? (
          <span style={{ fontSize: "0.8rem", color: colors.primary[700], fontWeight: 700 }}>Previewing…</span>
        ) : preview.ready ? (
          <span style={{ fontSize: "0.8rem", color: colors.primary[700], fontWeight: 700 }}>Ready</span>
        ) : null}
      </div>

      {preview.loading ? (
        <p style={{ margin: "0.8rem 0 0", fontSize: "0.85rem", color: colors.neutral[600] }}>
          Simulating the transaction with Soroban before the wallet prompt.
        </p>
      ) : preview.error ? (
        <p style={{ margin: "0.8rem 0 0", fontSize: "0.85rem", color: "#b91c1c", fontWeight: 600 }}>
          {preview.error}
        </p>
      ) : (
        <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.6rem" }}>
          {preview.effects.map((effect) => (
            <div key={effect.label} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
              <span style={{ fontSize: "0.85rem", color: colors.neutral[700] }}>{effect.label}</span>
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color: colors.neutral[900], textAlign: "right" }}>
                {effect.value}
              </span>
            </div>
          ))}
          {preview.feeEstimate ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", paddingTop: "0.25rem" }}>
              <span style={{ fontSize: "0.85rem", color: colors.neutral[700] }}>Estimated fee</span>
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color: colors.primary[700], textAlign: "right" }}>
                {preview.feeEstimate}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {disabled && !preview.loading ? (
        <p style={{ margin: "0.8rem 0 0", fontSize: "0.8rem", color: colors.neutral[600] }}>
          {ctaLabel} is unavailable until the preview succeeds.
        </p>
      ) : null}
    </div>
  );
}
