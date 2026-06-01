"use client";

import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RetirementRecord } from "../lib/api";
import { formatTonnes, calculateCO2Equivalent } from "../lib/carbon-utils";
import { colors } from "../styles/design-system";

interface Props {
  retirement: RetirementRecord;
  publicUrl?: string;
}

export default function RetirementCertificate({ retirement, publicUrl }: Props) {
  const certRef = useRef<HTMLDivElement>(null);
  const co2eq   = calculateCO2Equivalent(retirement.amount);
  const url     = publicUrl ?? `${typeof window !== "undefined" ? window.location.origin : ""}/retire/${retirement.retirementId}`;

  async function downloadPdf() {
    const { default: jsPDF }      = await import("jspdf");
    const { default: html2canvas } = await import("html2canvas");
    if (!certRef.current) return;
    const canvas = await html2canvas(certRef.current, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    pdf.addImage(imgData, "PNG", 0, 0, 297, 210);
    pdf.save(`CarbonLedger-Certificate-${retirement.retirementId}.pdf`);
  }

  return (
    <div>
      {/* Certificate */}
      <div ref={certRef} style={{
        background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 50%, #f0fdf4 100%)",
        border: `3px solid ${colors.primary[600]}`,
        borderRadius: "1rem",
        padding: "3rem",
        maxWidth: "900px",
        margin: "0 auto",
        fontFamily: "'Inter', sans-serif",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Watermark — decorative, hidden from AT */}
        <div aria-hidden="true" style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%) rotate(-30deg)",
          fontSize: "8rem", fontWeight: 900, color: `${colors.primary[600]}08`,
          pointerEvents: "none", userSelect: "none", whiteSpace: "nowrap",
        }}>
          RETIRED
        </div>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <span aria-hidden="true" style={{ fontSize: "2rem" }}>🌿</span>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: colors.primary[700], letterSpacing: "0.15em" }}>
              CARBONLEDGER
            </span>
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.25rem" }}>
            Carbon Credit Retirement Certificate
          </h1>
          <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: 0 }}>
            Permanent on-chain retirement · Verified and irreversible
          </p>
        </div>

        {/* Beneficiary */}
        <div style={{ textAlign: "center", marginBottom: "2rem", padding: "1.5rem", background: colors.primary[50], borderRadius: "0.75rem" }}>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[500], margin: "0 0 0.5rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            This certifies that
          </p>
          <h2 style={{ fontSize: "2rem", fontWeight: 800, color: colors.primary[800], margin: "0 0 0.5rem" }}>
            {retirement.beneficiary}
          </h2>
          <p style={{ fontSize: "0.9rem", color: colors.neutral[600], margin: 0 }}>
            has permanently retired
          </p>
          <p style={{ fontSize: "3rem", fontWeight: 900, color: colors.primary[700], margin: "0.5rem 0", lineHeight: 1 }}>
            {formatTonnes(retirement.amount)}
          </p>
          <p style={{ fontSize: "0.85rem", color: colors.neutral[500], margin: 0 }}>
            equivalent to removing {co2eq.cars.toLocaleString()} cars from the road for one year
          </p>
        </div>

        {/* Details grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.5rem", marginBottom: "2rem" }}>
          {[
            { label: "Project", value: retirement.project?.name ?? retirement.projectName ?? retirement.projectId },
            { label: "Vintage Year", value: `${retirement.vintageYear}` },
            { label: "Retirement Reason", value: retirement.retirementReason },
            { label: "Retirement Date", value: new Date(retirement.retiredAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) },
            { label: "Serial Range", value: `${retirement.serialNumbers[0]} – ${retirement.serialNumbers[retirement.serialNumbers.length - 1]}` },
            { label: "Certificate ID", value: retirement.retirementId },
          ].map(({ label, value }) => (
            <div key={label} style={{ borderLeft: `3px solid ${colors.primary[300]}`, paddingLeft: "0.75rem" }}>
              <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: "0 0 0.2rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {label}
              </p>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, color: colors.neutral[800], margin: 0, wordBreak: "break-all" }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Transaction hash + QR */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: `1px solid ${colors.primary[200]}`, paddingTop: "1.5rem" }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.7rem", color: colors.neutral[500], margin: "0 0 0.25rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Stellar Transaction Hash
            </p>
            <p style={{ fontSize: "0.75rem", fontFamily: "monospace", color: colors.neutral[700], margin: 0, wordBreak: "break-all" }}>
              {retirement.txHash}
            </p>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${retirement.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View retirement transaction on Stellar Explorer (opens in new tab)"
              style={{ fontSize: "0.75rem", color: colors.primary[600], textDecoration: "none" }}
            >
              View on Stellar Explorer →
            </a>
          </div>
          <div style={{ textAlign: "center", marginLeft: "2rem" }}>
            <QRCodeSVG
              value={url}
              size={80}
              fgColor={colors.primary[800]}
              aria-label={`QR code to verify certificate at ${url}`}
            />
            <p style={{ fontSize: "0.65rem", color: colors.neutral[400], margin: "0.25rem 0 0" }}>
              Verify online
            </p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
        <button
          type="button"
          onClick={downloadPdf}
          aria-label={`Download PDF certificate for ${retirement.beneficiary}`}
          style={{
            background: colors.primary[600],
            color: "#fff",
            border: "none",
            borderRadius: "0.5rem",
            padding: "0.75rem 2rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
            marginRight: "1rem",
          }}
        >
          Download PDF Certificate
        </button>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(url)}
          aria-label="Copy shareable certificate link to clipboard"
          style={{
            background: "transparent",
            color: colors.primary[700],
            border: `1px solid ${colors.primary[300]}`,
            borderRadius: "0.5rem",
            padding: "0.75rem 2rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Copy Shareable Link
        </button>
      </div>
    </div>
  );
}
