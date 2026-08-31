"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useVerifierAuth } from "../../../lib/use-verifier-auth";
import { useVerifierFeeHistory, exportVerifierFeesCsv } from "../../../lib/api";
import { colors } from "../../../styles/design-system";
import LoadingSkeleton from "../../../components/LoadingSkeleton";

function stroopsToXlm(stroops: string): string {
  return (Number(stroops) / 10_000_000).toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
}

export default function VerifierFeesPage() {
  const { publicKey, token } = useVerifierAuth();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, error, isLoading } = useVerifierFeeHistory(publicKey, token, cursor);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const totalXlm = useMemo(
    () => (data?.fees ?? []).reduce((sum, f) => sum + Number(f.feeStroops), 0) / 10_000_000,
    [data],
  );

  async function handleExport() {
    if (!publicKey || !token) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportVerifierFeesCsv(publicKey, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `verifier-fees-${publicKey.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: "3rem auto", padding: "0 1rem" }}>
      <Link href="/verifier/dashboard" style={{ color: colors.primary[700], fontSize: "0.875rem" }}>
        ← Dashboard
      </Link>
      <h1 style={{ margin: "0.75rem 0 0.35rem" }}>Attestation fee tracker</h1>
      <p style={{ color: colors.neutral[600], marginTop: 0 }}>
        Fees accrued for on-chain attestations, linked to their settlement transaction.
      </p>

      {error && <p role="alert" style={{ color: "#dc2626" }}>{error.message}</p>}
      {isLoading && (
        <div style={{ marginTop: "1.5rem" }} aria-label="Loading fee history">
          <LoadingSkeleton variant="Table" columns={5} count={6} />
        </div>
      )}

      {data && (
        <p style={{ fontWeight: 700, fontSize: "1.05rem", margin: "1rem 0" }}>
          Total this page: {totalXlm} XLM ({data.total} attestation{data.total === 1 ? "" : "s"} total)
        </p>
      )}

      {!isLoading && data?.fees.length === 0 && (
        <p style={{ color: "#666" }}>No attestation fees recorded yet.</p>
      )}

      {data && data.fees.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: "1rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
                <th style={thStyle}>Project</th>
                <th style={thStyle}>Decision</th>
                <th style={thStyle}>Fee (XLM)</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {data.fees.map(f => (
                <tr key={f.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={tdStyle}>{f.projectId}</td>
                  <td style={tdStyle}>{f.decision}</td>
                  <td style={tdStyle}>{stroopsToXlm(f.feeStroops)}</td>
                  <td style={tdStyle}>{new Date(f.createdAt).toLocaleDateString()}</td>
                  <td style={tdStyle}>
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${f.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: "monospace", fontSize: "0.75rem", color: colors.primary[700] }}
                    >
                      {f.txHash.slice(0, 10)}…
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {cursor && (
          <button type="button" onClick={() => setCursor(undefined)} style={pageBtnStyle}>
            ← First page
          </button>
        )}
        {data?.hasMore && (
          <button type="button" onClick={() => setCursor(data.nextCursor)} style={pageBtnStyle}>
            Next page →
          </button>
        )}
        <button type="button" onClick={handleExport} disabled={exporting} style={{ ...pageBtnStyle, marginLeft: "auto" }}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      {exportError && <p role="alert" style={{ color: "#dc2626", fontSize: "0.8rem" }}>{exportError}</p>}
    </main>
  );
}

const thStyle: React.CSSProperties = { padding: "0.65rem 0.5rem", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "0.75rem 0.5rem", verticalAlign: "top" };
const pageBtnStyle: React.CSSProperties = {
  padding: "0.45rem 0.9rem",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  background: "#fff",
  cursor: "pointer",
};
