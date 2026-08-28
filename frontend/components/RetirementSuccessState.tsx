"use client";

import { useState } from "react";
import { RetirementRecord } from "../lib/api";
import { formatTonnes } from "../lib/carbon-utils";
import { colors } from "../styles/design-system";

interface Props {
  retirement: RetirementRecord;
  onDownload: () => void;
}

export default function RetirementSuccessState({ retirement, onDownload }: Props) {
  const [copied, setCopied] = useState(false);
  const certUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/retire/${retirement.retirementId}`
      : `/retire/${retirement.retirementId}`;

  async function copyLink() {
    await navigator.clipboard.writeText(certUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.5rem",
        textAlign: "center",
        padding: "2.5rem 2rem",
        background: "linear-gradient(160deg, #f0fdf4 0%, #ffffff 60%, #f0fdf4 100%)",
        borderRadius: "1rem",
        border: `2px solid ${colors.primary[200]}`,
        maxWidth: "560px",
        margin: "0 auto",
      }}
    >
      {/* Celebratory icon */}
      <div style={{ fontSize: "4rem", lineHeight: 1 }} aria-hidden="true">🌿</div>

      <div>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            color: colors.primary[800],
            margin: "0 0 0.5rem",
          }}
        >
          {formatTonnes(retirement.amount)} Permanently Retired
        </h1>
        <p style={{ color: colors.neutral[500], margin: 0, fontSize: "0.95rem" }}>
          On behalf of <strong style={{ color: colors.neutral[800] }}>{retirement.beneficiary}</strong>.
          Your certificate has been permanently recorded on Stellar.
        </p>
      </div>

      {/* Certificate preview card */}
      <div
        style={{
          width: "100%",
          background: "#fff",
          borderRadius: "0.75rem",
          border: `1px solid ${colors.primary[200]}`,
          padding: "1.25rem 1.5rem",
          textAlign: "left",
          display: "flex",
          flexDirection: "column",
          gap: "0.625rem",
        }}
      >
        <p
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: colors.primary[600],
            margin: 0,
          }}
        >
          Certificate Preview
        </p>
        {([
          ["Project",        retirement.project?.name ?? retirement.projectName ?? retirement.projectId],
          ["Vintage Year",   String(retirement.vintageYear)],
          ["Beneficiary",    retirement.beneficiary],
          ["Amount",         formatTonnes(retirement.amount)],
          ["Certificate ID", retirement.retirementId],
          ["Date",           new Date(retirement.retiredAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <span style={{ fontSize: "0.8rem", color: colors.neutral[500], flexShrink: 0 }}>{label}</span>
            <span
              style={{
                fontSize: "0.8rem",
                fontWeight: 600,
                color: colors.neutral[800],
                textAlign: "right",
                wordBreak: "break-all",
                fontFamily: label === "Certificate ID" ? "monospace" : undefined,
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Primary action: Download */}
      <button
        onClick={onDownload}
        style={{
          width: "100%",
          padding: "0.875rem",
          borderRadius: "0.75rem",
          border: "none",
          background: colors.primary[600],
          color: "#fff",
          fontWeight: 700,
          fontSize: "1rem",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgb(22 163 74 / 0.3)",
        }}
      >
        ⬇ Download Certificate (PDF)
      </button>

      {/* Secondary actions */}
      <div style={{ display: "flex", gap: "0.75rem", width: "100%" }}>
        <button
          onClick={copyLink}
          aria-label="Copy shareable certificate link to clipboard"
          style={{
            flex: 1,
            padding: "0.75rem",
            borderRadius: "0.5rem",
            border: `1px solid ${colors.primary[300]}`,
            background: "#fff",
            color: colors.primary[700],
            fontWeight: 600,
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          {copied ? "✓ Copied!" : "🔗 Copy Link"}
        </button>

        <a
          href={`https://stellar.expert/explorer/testnet/tx/${retirement.txHash ?? ""}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1,
            padding: "0.75rem",
            borderRadius: "0.5rem",
            border: `1px solid ${colors.neutral[300]}`,
            color: colors.neutral[700],
            fontWeight: 600,
            fontSize: "0.875rem",
            textDecoration: "none",
            textAlign: "center",
          }}
        >
          View on Stellar →
        </a>
      </div>

      <a
        href="/dashboard"
        style={{ fontSize: "0.875rem", color: colors.neutral[400], textDecoration: "none" }}
      >
        ← Back to Dashboard
      </a>
    </div>
  );
}
