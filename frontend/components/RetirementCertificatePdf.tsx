"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCertificatePdfGenerator, CertificatePdfData } from "../hooks/useCertificatePdfGenerator";
import { colors } from "../styles/design-system";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Certificate data — all fields required for the PDF */
  data: CertificatePdfData;
  /**
   * Whether to render the full visual certificate UI.
   * Set to false to render just the download button.
   */
  showPreview?: boolean;
}

const STELLAR_EXPLORER_BASE =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL ??
  "https://stellar.expert/explorer/testnet/tx";

// ─────────────────────────────────────────────────────────────────────────────
// Detail row helper
// ─────────────────────────────────────────────────────────────────────────────

function DetailCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        borderLeft: `3px solid ${colors.primary[400]}`,
        paddingLeft: "0.75rem",
      }}
    >
      <dt
        style={{
          fontSize: "0.65rem",
          color: colors.neutral[500],
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          margin: 0,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          fontSize: "0.85rem",
          fontWeight: 600,
          color: colors.neutral[800],
          margin: "0.15rem 0 0",
          wordBreak: "break-word",
        }}
      >
        {value}
      </dd>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RetirementCertificatePdf({
  data,
  showPreview = true,
}: Props) {
  const { isGenerating, error, generatePdf } = useCertificatePdfGenerator();

  const details: Array<{ label: string; value: string }> = [
    { label: "Project", value: data.projectName },
    { label: "Vintage Year", value: String(data.vintageYear) },
    { label: "Methodology", value: data.methodology ?? "—" },
    { label: "Country", value: data.country ?? "—" },
    {
      label: "Serial Range",
      value: `${data.serialStart} — ${data.serialEnd}`,
    },
    { label: "Certificate ID", value: data.retirementId },
  ];

  return (
    <div data-testid="retirement-certificate-pdf">
      {/* Visual certificate preview */}
      {showPreview && (
        <div
          data-testid="certificate-preview"
          style={{
            background: "linear-gradient(160deg, #f0fdf4 0%, #ffffff 55%, #f0fdf4 100%)",
            border: `3px solid ${colors.primary[600]}`,
            borderRadius: "1rem",
            padding: "2.5rem 3rem",
            maxWidth: "760px",
            margin: "0 auto",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Accent bar */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "5px",
              background: `linear-gradient(90deg, ${colors.primary[600]}, ${colors.primary[400]}, ${colors.primary[600]})`,
            }}
          />

          {/* Watermark */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%) rotate(-35deg)",
              fontSize: "8rem",
              fontWeight: 900,
              color: `${colors.primary[600]}08`,
              pointerEvents: "none",
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            CARBONLEDGER
          </div>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "2rem", paddingTop: "0.5rem" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "0.75rem",
              }}
            >
              <span
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 800,
                  color: colors.primary[700],
                  letterSpacing: "0.18em",
                }}
              >
                🌿 CARBONLEDGER
              </span>
            </div>
            <h2
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: colors.neutral[900],
                margin: 0,
              }}
            >
              Certificate of Carbon Retirement
            </h2>
            <p
              style={{
                fontSize: "0.75rem",
                color: colors.neutral[500],
                margin: "0.25rem 0 0",
                letterSpacing: "0.08em",
              }}
            >
              ISSUED UNDER THE CARBONLEDGER PROTOCOL · STELLAR BLOCKCHAIN
            </p>
          </div>

          <hr
            style={{
              border: "none",
              borderTop: `1px solid ${colors.primary[200]}`,
              margin: "0 0 1.75rem",
            }}
          />

          {/* Beneficiary block */}
          <div
            style={{
              background: colors.primary[50],
              border: `1px solid ${colors.primary[200]}`,
              borderRadius: "0.75rem",
              padding: "1.75rem",
              textAlign: "center",
              marginBottom: "2rem",
            }}
          >
            <p
              style={{
                fontSize: "0.7rem",
                color: colors.neutral[500],
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                margin: "0 0 0.4rem",
              }}
            >
              This certifies that
            </p>
            <p
              style={{
                fontSize: "1.75rem",
                fontWeight: 800,
                color: colors.primary[800],
                margin: "0 0 0.5rem",
                lineHeight: 1.2,
              }}
            >
              {data.beneficiary}
            </p>
            <p
              style={{
                fontSize: "0.875rem",
                color: colors.neutral[600],
                margin: "0 0 0.25rem",
              }}
            >
              has permanently and irrevocably retired
            </p>
            <p
              style={{
                fontSize: "3rem",
                fontWeight: 900,
                color: colors.primary[700],
                margin: "0.25rem 0",
                lineHeight: 1,
              }}
            >
              {data.tonnes % 1 === 0
                ? data.tonnes.toFixed(0)
                : data.tonnes.toFixed(2)}{" "}
              tCO₂e
            </p>
            <p
              style={{
                fontSize: "0.8rem",
                color: colors.neutral[500],
                margin: "0.4rem 0 0",
              }}
            >
              Retired on{" "}
              {new Date(data.retiredAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>

          {/* Details grid */}
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "1.25rem 1.5rem",
              marginBottom: "2rem",
            }}
          >
            {details.map((d) => (
              <DetailCell key={d.label} label={d.label} value={d.value} />
            ))}
          </dl>

          {/* Footer: tx hash + QR */}
          <footer
            style={{
              borderTop: `1px solid ${colors.primary[200]}`,
              paddingTop: "1.25rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: "1.5rem",
            }}
          >
            <div>
              <p
                style={{
                  fontSize: "0.65rem",
                  color: colors.neutral[500],
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  margin: "0 0 0.3rem",
                }}
              >
                Stellar Transaction Hash
              </p>
              <p
                style={{
                  fontSize: "0.72rem",
                  fontFamily: "monospace",
                  color: colors.neutral[700],
                  margin: "0 0 0.3rem",
                  wordBreak: "break-all",
                }}
              >
                {data.txHash}
              </p>
              <a
                href={`${STELLAR_EXPLORER_BASE}/${data.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View this transaction on Stellar Explorer"
                style={{
                  fontSize: "0.72rem",
                  color: colors.primary[600],
                  textDecoration: "none",
                }}
              >
                View on Stellar Explorer →
              </a>
            </div>

            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <QRCodeSVG
                value={data.verificationUrl}
                size={88}
                fgColor={colors.primary[800]}
                aria-label={`Scan to verify certificate at ${data.verificationUrl}`}
              />
              <p
                style={{
                  fontSize: "0.6rem",
                  color: colors.neutral[400],
                  margin: "0.3rem 0 0",
                }}
              >
                Scan to verify
              </p>
            </div>
          </footer>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p
          role="alert"
          style={{
            color: "#dc2626",
            fontSize: "0.875rem",
            marginTop: "0.5rem",
            textAlign: "center",
          }}
        >
          PDF generation failed: {error}
        </p>
      )}

      {/* Actions */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          justifyContent: "center",
          flexWrap: "wrap",
          marginTop: "1.5rem",
        }}
      >
        <button
          type="button"
          onClick={() => generatePdf(data)}
          disabled={isGenerating}
          aria-label={`Download retirement certificate PDF for ${data.beneficiary}`}
          style={{
            background: isGenerating ? colors.neutral[300] : colors.primary[600],
            color: "#fff",
            border: "none",
            borderRadius: "0.5rem",
            padding: "0.75rem 2rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: isGenerating ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          {isGenerating ? (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: "1rem",
                  height: "1rem",
                  border: "2px solid #ffffff60",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }}
              />
              Generating PDF…
            </>
          ) : (
            <>⬇ Download PDF</>
          )}
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          aria-label="Print this retirement certificate"
          style={{
            background: "transparent",
            color: colors.primary[700],
            border: `1.5px solid ${colors.primary[300]}`,
            borderRadius: "0.5rem",
            padding: "0.75rem 2rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🖨️ Print
        </button>

        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(data.verificationUrl)}
          aria-label="Copy certificate verification link to clipboard"
          style={{
            background: "transparent",
            color: colors.primary[700],
            border: `1.5px solid ${colors.primary[300]}`,
            borderRadius: "0.5rem",
            padding: "0.75rem 2rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🔗 Copy Link
        </button>
      </div>
    </div>
  );
}
