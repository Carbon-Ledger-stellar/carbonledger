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
    const { default: jsPDF }       = await import("jspdf");
    const { default: html2canvas } = await import("html2canvas");
    if (!certRef.current) return;
    const canvas  = await html2canvas(certRef.current, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const pdf     = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    // A4 portrait: 210 × 297 mm
    pdf.addImage(imgData, "PNG", 0, 0, 210, 297);
    pdf.save(`CarbonLedger-Certificate-${retirement.retirementId}.pdf`);
  }

  const details = [
    { label: "Project",          value: retirement.project?.name ?? retirement.projectName ?? retirement.projectId },
    { label: "Vintage Year",     value: `${retirement.vintageYear}` },
    { label: "Retirement Reason",value: retirement.retirementReason },
    { label: "Retirement Date",  value: new Date(retirement.retiredAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) },
    { label: "Serial Range",     value: `${retirement.serialNumbers[0]} – ${retirement.serialNumbers[retirement.serialNumbers.length - 1]}` },
    { label: "Certificate ID",   value: retirement.retirementId },
  ];

  return (
    <>
      {/* Print + layout styles */}
      <style>{`
        .cert-root {
          font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
        }
        .cert-page {
          background: linear-gradient(160deg, #f0fdf4 0%, #ffffff 55%, #f0fdf4 100%);
          border: 3px solid ${colors.primary[600]};
          border-radius: 1rem;
          padding: 3rem 3.5rem;
          max-width: 794px;          /* ~A4 width at 96 dpi */
          min-height: 1123px;        /* ~A4 height at 96 dpi */
          margin: 0 auto;
          position: relative;
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.18);
          display: flex;
          flex-direction: column;
        }
        .cert-watermark {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%) rotate(-35deg);
          font-size: 9rem;
          font-weight: 900;
          color: ${colors.primary[600]}0a;
          pointer-events: none;
          user-select: none;
          white-space: nowrap;
          letter-spacing: 0.2em;
        }
        /* Top accent bar */
        .cert-accent-bar {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 6px;
          background: linear-gradient(90deg, ${colors.primary[600]}, ${colors.primary[400]}, ${colors.primary[600]});
          border-radius: 1rem 1rem 0 0;
        }
        /* Logo / branding header */
        .cert-header {
          text-align: center;
          margin-bottom: 2rem;
          padding-top: 0.5rem;
        }
        .cert-logo-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
          margin-bottom: 0.75rem;
        }
        .cert-logo-icon {
          width: 40px;
          height: 40px;
          background: ${colors.primary[600]};
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.3rem;
          flex-shrink: 0;
        }
        .cert-logo-text {
          font-size: 1.25rem;
          font-weight: 800;
          color: ${colors.primary[700]};
          letter-spacing: 0.18em;
        }
        .cert-title {
          font-size: 1.6rem;
          font-weight: 800;
          color: ${colors.neutral[900]};
          margin: 0 0 0.3rem;
          letter-spacing: -0.01em;
        }
        .cert-subtitle {
          font-size: 0.8rem;
          color: ${colors.neutral[500]};
          margin: 0;
          letter-spacing: 0.05em;
        }
        /* Divider */
        .cert-divider {
          border: none;
          border-top: 1px solid ${colors.primary[200]};
          margin: 0 0 1.75rem;
        }
        /* Beneficiary block */
        .cert-beneficiary {
          text-align: center;
          background: ${colors.primary[50]};
          border: 1px solid ${colors.primary[200]};
          border-radius: 0.75rem;
          padding: 1.75rem 2rem;
          margin-bottom: 2rem;
        }
        .cert-certifies-label {
          font-size: 0.7rem;
          color: ${colors.neutral[500]};
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin: 0 0 0.4rem;
        }
        .cert-beneficiary-name {
          font-size: 1.9rem;
          font-weight: 800;
          color: ${colors.primary[800]};
          margin: 0 0 0.5rem;
          line-height: 1.15;
        }
        .cert-retired-label {
          font-size: 0.85rem;
          color: ${colors.neutral[600]};
          margin: 0 0 0.25rem;
        }
        .cert-amount {
          font-size: 3.25rem;
          font-weight: 900;
          color: ${colors.primary[700]};
          margin: 0.25rem 0;
          line-height: 1;
        }
        .cert-co2-note {
          font-size: 0.8rem;
          color: ${colors.neutral[500]};
          margin: 0.4rem 0 0;
        }
        /* Details grid */
        .cert-details-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 1.25rem 2rem;
          margin-bottom: 2rem;
        }
        .cert-detail-item {
          border-left: 3px solid ${colors.primary[300]};
          padding-left: 0.75rem;
        }
        .cert-detail-label {
          font-size: 0.65rem;
          color: ${colors.neutral[500]};
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin: 0 0 0.2rem;
        }
        .cert-detail-value {
          font-size: 0.82rem;
          font-weight: 600;
          color: ${colors.neutral[800]};
          margin: 0;
          word-break: break-word;
        }
        /* Footer: tx hash + QR */
        .cert-footer {
          margin-top: auto;
          border-top: 1px solid ${colors.primary[200]};
          padding-top: 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 2rem;
        }
        .cert-tx-label {
          font-size: 0.65rem;
          color: ${colors.neutral[500]};
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin: 0 0 0.3rem;
        }
        .cert-tx-hash {
          font-size: 0.72rem;
          font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
          color: ${colors.neutral[700]};
          margin: 0 0 0.3rem;
          word-break: break-all;
        }
        .cert-tx-link {
          font-size: 0.72rem;
          color: ${colors.primary[600]};
          text-decoration: none;
        }
        .cert-qr-block {
          text-align: center;
          flex-shrink: 0;
        }
        .cert-qr-caption {
          font-size: 0.6rem;
          color: ${colors.neutral[400]};
          margin: 0.3rem 0 0;
        }
        /* Seal badge */
        .cert-seal {
          position: absolute;
          bottom: 3.5rem;
          right: 3.5rem;
          width: 72px;
          height: 72px;
          border-radius: 50%;
          border: 3px solid ${colors.primary[400]};
          background: ${colors.primary[50]};
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-size: 0.45rem;
          font-weight: 700;
          color: ${colors.primary[700]};
          text-transform: uppercase;
          letter-spacing: 0.08em;
          text-align: center;
          line-height: 1.3;
        }
        /* Action buttons */
        .cert-actions {
          text-align: center;
          margin-top: 1.5rem;
          display: flex;
          gap: 1rem;
          justify-content: center;
          flex-wrap: wrap;
        }
        .cert-btn-primary {
          background: ${colors.primary[600]};
          color: #fff;
          border: none;
          border-radius: 0.5rem;
          padding: 0.75rem 2rem;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
        }
        .cert-btn-secondary {
          background: transparent;
          color: ${colors.primary[700]};
          border: 1.5px solid ${colors.primary[300]};
          border-radius: 0.5rem;
          padding: 0.75rem 2rem;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
        }
        /* Print styles — A4 portrait */
        @media print {
          body * { visibility: hidden; }
          .cert-page, .cert-page * { visibility: visible; }
          .cert-page {
            position: fixed;
            top: 0; left: 0;
            width: 210mm;
            min-height: 297mm;
            max-width: 210mm;
            margin: 0;
            padding: 18mm 20mm;
            border-radius: 0;
            box-shadow: none;
            border: none;
          }
          .cert-actions { display: none; }
          @page {
            size: A4 portrait;
            margin: 0;
          }
        }
      `}</style>

      <div className="cert-root">
        {/* Certificate page */}
        <div ref={certRef} className="cert-page" role="main" aria-label="Carbon Credit Retirement Certificate">
          <div className="cert-accent-bar" aria-hidden="true" />

          {/* Watermark */}
          <div className="cert-watermark" aria-hidden="true">RETIRED</div>

          {/* Branding header */}
          <header className="cert-header">
            <div className="cert-logo-row">
              <div className="cert-logo-icon" aria-hidden="true">🌿</div>
              <span className="cert-logo-text">CARBONLEDGER</span>
            </div>
            <h1 className="cert-title">Carbon Credit Retirement Certificate</h1>
            <p className="cert-subtitle">Permanent on-chain retirement · Verified and irreversible</p>
          </header>

          <hr className="cert-divider" />

          {/* Beneficiary */}
          <section className="cert-beneficiary" aria-label="Retirement details">
            <p className="cert-certifies-label">This certifies that</p>
            <h2 className="cert-beneficiary-name">{retirement.beneficiary}</h2>
            <p className="cert-retired-label">has permanently retired</p>
            <p className="cert-amount">{formatTonnes(retirement.amount)}</p>
            <p className="cert-co2-note">
              equivalent to removing {co2eq.cars.toLocaleString()} cars from the road for one year
            </p>
          </section>

          {/* Details grid */}
          <dl className="cert-details-grid">
            {details.map(({ label, value }) => (
              <div key={label} className="cert-detail-item">
                <dt className="cert-detail-label">{label}</dt>
                <dd className="cert-detail-value">{value}</dd>
              </div>
            ))}
          </dl>

          {/* Footer: tx hash + QR */}
          <footer className="cert-footer">
            <div>
              <p className="cert-tx-label">Stellar Transaction Hash</p>
              <p className="cert-tx-hash">{retirement.txHash}</p>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${retirement.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="cert-tx-link"
                aria-label="View retirement transaction on Stellar Explorer (opens in new tab)"
              >
                View on Stellar Explorer →
              </a>
            </div>
            <div className="cert-qr-block">
              <QRCodeSVG
                value={url}
                size={88}
                fgColor={colors.primary[800]}
                aria-label={`QR code to verify certificate at ${url}`}
              />
              <p className="cert-qr-caption">Scan to verify</p>
            </div>
          </footer>

          {/* Seal */}
          <div className="cert-seal" aria-hidden="true">
            <span>✓</span>
            <span>On-Chain</span>
            <span>Verified</span>
          </div>
        </div>

        {/* Action buttons — hidden on print */}
        <div className="cert-actions">
          <button
            type="button"
            className="cert-btn-primary"
            onClick={downloadPdf}
            aria-label={`Download PDF certificate for ${retirement.beneficiary}`}
          >
            Download PDF Certificate
          </button>
          <button
            type="button"
            className="cert-btn-secondary"
            onClick={() => window.print()}
            aria-label="Print certificate"
          >
            Print Certificate
          </button>
          <button
            type="button"
            className="cert-btn-secondary"
            onClick={() => navigator.clipboard.writeText(url)}
            aria-label="Copy shareable certificate link to clipboard"
          >
            Copy Shareable Link
          </button>
        </div>
      </div>
    </>
  );
}
