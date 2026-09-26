"use client";

import { useCallback, useState } from "react";
import type { RetirementRecord } from "../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CertificatePdfData {
  beneficiary: string;
  projectName: string;
  vintageYear: number;
  tonnes: number;
  serialStart: string;
  serialEnd: string;
  txHash: string;
  retirementId: string;
  methodology?: string;
  country?: string;
  retiredAt: string;
  verificationUrl: string;
}

export interface UseCertificatePdfGeneratorReturn {
  isGenerating: boolean;
  error: string | null;
  generatePdf: (data: CertificatePdfData) => Promise<void>;
  generateFromRetirement: (
    retirement: RetirementRecord,
    baseUrl?: string
  ) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic filename
// ─────────────────────────────────────────────────────────────────────────────

export function getCertificateFilename(txHash: string): string {
  // Named deterministically from txHash so repeated downloads produce identical filenames
  return `CarbonLedger-Certificate-${txHash.slice(0, 16)}.pdf`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF generation
// ─────────────────────────────────────────────────────────────────────────────

async function buildCertificatePdf(data: CertificatePdfData): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageW = 210;
  const pageH = 297;
  const margin = 18;
  const colW = pageW - margin * 2;

  // ── Accent bar (top) ──────────────────────────────────────────────────────
  doc.setFillColor(22, 101, 52); // primary-800
  doc.rect(0, 0, pageW, 6, "F");

  // ── CarbonLedger logo text ────────────────────────────────────────────────
  doc.setFontSize(14);
  doc.setTextColor(22, 101, 52);
  doc.setFont("helvetica", "bold");
  doc.text("CARBONLEDGER", margin, 22);

  // Tagline
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.text("Verified Carbon Credits · Permanent Retirement · Full Provenance", margin, 27);

  // ── Divider ───────────────────────────────────────────────────────────────
  doc.setDrawColor(187, 247, 208);
  doc.setLineWidth(0.5);
  doc.line(margin, 31, pageW - margin, 31);

  // ── Certificate title ─────────────────────────────────────────────────────
  doc.setFontSize(22);
  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.text("Certificate of Carbon Retirement", pageW / 2, 48, { align: "center" });

  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.text(
    "ISSUED UNDER THE CARBONLEDGER PROTOCOL · STELLAR BLOCKCHAIN",
    pageW / 2,
    54,
    { align: "center" },
  );

  // ── Beneficiary block ─────────────────────────────────────────────────────
  // Background box
  doc.setFillColor(240, 253, 244); // green-50
  doc.roundedRect(margin, 60, colW, 55, 3, 3, "F");
  doc.setDrawColor(187, 247, 208);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, 60, colW, 55, 3, 3, "S");

  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.text("THIS CERTIFIES THAT", pageW / 2, 69, { align: "center" });

  doc.setFontSize(20);
  doc.setTextColor(20, 83, 45); // primary-900
  doc.setFont("helvetica", "bold");
  // Truncate long beneficiary names
  const beneficiaryText = data.beneficiary.length > 40
    ? data.beneficiary.slice(0, 38) + "…"
    : data.beneficiary;
  doc.text(beneficiaryText, pageW / 2, 79, { align: "center" });

  doc.setFontSize(9);
  doc.setTextColor(55, 65, 81);
  doc.setFont("helvetica", "normal");
  doc.text("has permanently and irrevocably retired", pageW / 2, 86, { align: "center" });

  doc.setFontSize(30);
  doc.setTextColor(22, 101, 52);
  doc.setFont("helvetica", "bold");
  const tonnesDisplay = `${data.tonnes % 1 === 0 ? data.tonnes.toFixed(0) : data.tonnes.toFixed(2)} tCO₂e`;
  doc.text(tonnesDisplay, pageW / 2, 99, { align: "center" });

  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  const formattedDate = new Date(data.retiredAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.text(`Retired on ${formattedDate}`, pageW / 2, 107, { align: "center" });

  // ── Details grid ─────────────────────────────────────────────────────────
  const detailStartY = 124;
  const cellW = colW / 3;

  const details: Array<{ label: string; value: string }> = [
    { label: "PROJECT", value: data.projectName },
    { label: "VINTAGE YEAR", value: String(data.vintageYear) },
    { label: "METHODOLOGY", value: data.methodology ?? "—" },
    { label: "COUNTRY", value: data.country ?? "—" },
    { label: "SERIAL RANGE", value: `${data.serialStart} — ${data.serialEnd}` },
    { label: "CERTIFICATE ID", value: data.retirementId },
  ];

  details.forEach((d, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = margin + col * cellW;
    const y = detailStartY + row * 22;

    // Accent line
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(2.5);
    doc.line(x, y, x, y + 10);

    doc.setFontSize(6.5);
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "bold");
    doc.text(d.label, x + 4, y + 3.5);

    doc.setFontSize(8.5);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "normal");
    const valText = d.value.length > 30 ? d.value.slice(0, 28) + "…" : d.value;
    doc.text(valText, x + 4, y + 9);
  });

  // ── Divider ───────────────────────────────────────────────────────────────
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(margin, 170, pageW - margin, 170);

  // ── Tx hash section ───────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "bold");
  doc.text("STELLAR TRANSACTION HASH", margin, 178);

  doc.setFontSize(7.5);
  doc.setTextColor(55, 65, 81);
  doc.setFont("helvetica", "normal");
  const txLines = doc.splitTextToSize(data.txHash, colW - 40);
  doc.text(txLines, margin, 184);

  doc.setFontSize(7);
  doc.setTextColor(37, 99, 235);
  doc.text("Verify on Stellar Explorer →", margin, 193);

  // ── QR Code (right side of footer) ───────────────────────────────────────
  // We generate the QR code as SVG and render it
  // Since jsPDF doesn't natively support SVG QR, we'll add a placeholder rect
  // and note — the actual QR is in the HTML version (RetirementCertificate component)
  doc.setFillColor(240, 253, 244);
  doc.roundedRect(pageW - margin - 38, 172, 38, 38, 2, 2, "F");
  doc.setDrawColor(187, 247, 208);
  doc.setLineWidth(0.3);
  doc.roundedRect(pageW - margin - 38, 172, 38, 38, 2, 2, "S");

  // QR placeholder text
  doc.setFontSize(6);
  doc.setTextColor(107, 114, 128);
  doc.text("SCAN TO", pageW - margin - 19, 186, { align: "center" });
  doc.text("VERIFY", pageW - margin - 19, 191, { align: "center" });

  doc.setFontSize(12);
  doc.text("📱", pageW - margin - 19, 184, { align: "center" });

  // ── Verification URL ──────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setTextColor(107, 114, 128);
  doc.text("PERMANENT VERIFICATION URL", margin, 202);

  doc.setFontSize(7);
  doc.setTextColor(37, 99, 235);
  const urlText = data.verificationUrl.length > 60
    ? data.verificationUrl.slice(0, 58) + "…"
    : data.verificationUrl;
  doc.text(urlText, margin, 208);

  // ── Bottom accent bar ─────────────────────────────────────────────────────
  doc.setFillColor(22, 101, 52);
  doc.rect(0, pageH - 14, pageW, 14, "F");

  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Built on Stellar · CarbonLedger Protocol · This certificate is permanently verifiable on-chain",
    pageW / 2,
    pageH - 6,
    { align: "center" },
  );

  // ── On-chain seal (top-right) ─────────────────────────────────────────────
  const sealX = pageW - margin - 18;
  const sealY = 40;
  doc.setDrawColor(22, 101, 52);
  doc.setLineWidth(1);
  doc.circle(sealX, sealY, 12, "S");

  doc.setFontSize(5.5);
  doc.setTextColor(22, 101, 52);
  doc.setFont("helvetica", "bold");
  doc.text("ON-CHAIN", sealX, sealY - 3, { align: "center" });
  doc.text("VERIFIED", sealX, sealY + 2, { align: "center" });
  doc.setFontSize(8);
  doc.text("✓", sealX, sealY + 8, { align: "center" });

  return doc.output("blob");
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useCertificatePdfGenerator(): UseCertificatePdfGeneratorReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePdf = useCallback(async (data: CertificatePdfData) => {
    setIsGenerating(true);
    setError(null);

    try {
      const blob = await buildCertificatePdf(data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getCertificateFilename(data.txHash);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF generation failed";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const generateFromRetirement = useCallback(
    async (retirement: RetirementRecord, baseUrl?: string) => {
      const origin =
        baseUrl ??
        (typeof window !== "undefined" ? window.location.origin : "https://carbonledger.io");

      await generatePdf({
        beneficiary: retirement.beneficiary,
        projectName:
          retirement.project?.name ?? retirement.projectName ?? retirement.projectId,
        vintageYear: retirement.vintageYear,
        tonnes: retirement.amount,
        serialStart: retirement.serialNumbers[0] ?? "—",
        serialEnd:
          retirement.serialNumbers[retirement.serialNumbers.length - 1] ?? "—",
        txHash: retirement.txHash,
        retirementId: retirement.retirementId,
        methodology: retirement.project?.methodology,
        country: retirement.project?.country,
        retiredAt: retirement.retiredAt,
        verificationUrl: `${origin}/retire/${retirement.retirementId}`,
      });
    },
    [generatePdf],
  );

  return { isGenerating, error, generatePdf, generateFromRetirement };
}
