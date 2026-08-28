"use client";

import Link from "next/link";
import { useState } from "react";
import { useVerifierAuth } from "../../../lib/use-verifier-auth";
import { useVerifierAttestationHistory } from "../../../lib/api";
import { colors } from "../../../styles/design-system";
import LoadingSkeleton from "../../../components/LoadingSkeleton";

export default function VerifierHistoryPage() {
  const { publicKey, token } = useVerifierAuth();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, error, isLoading } = useVerifierAttestationHistory(publicKey, token, cursor);

  return (
    <main style={{ maxWidth: 960, margin: "3rem auto", padding: "0 1rem" }}>
      <Link href="/verifier/dashboard" style={{ color: colors.primary[700], fontSize: "0.875rem" }}>
        ← Dashboard
      </Link>
      <h1 style={{ margin: "0.75rem 0 0.35rem" }}>Attestation history</h1>
      <p style={{ color: colors.neutral[600], marginTop: 0 }}>
        Projects you have already verified or rejected, with their subsequent credit issuance volume.
      </p>

      {error && <p role="alert" style={{ color: "#dc2626" }}>{error.message}</p>}
      {isLoading && (
        <div style={{ marginTop: "1.5rem" }} aria-label="Loading attestation history">
          <LoadingSkeleton variant="Table" columns={6} count={6} />
        </div>
      )}
      {!isLoading && data?.projects.length === 0 && (
        <p style={{ color: "#666" }}>No attestations recorded yet.</p>
      )}

      {data && data.projects.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: "1.5rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
                <th style={thStyle}>Project</th>
                <th style={thStyle}>Methodology</th>
                <th style={thStyle}>Decision</th>
                <th style={thStyle}>Credits issued</th>
                <th style={thStyle}>Credits retired</th>
                <th style={thStyle}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={tdStyle}>
                    <strong>{p.name}</strong>
                    <br />
                    <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>{p.projectId}</span>
                  </td>
                  <td style={tdStyle}>{p.methodology}</td>
                  <td style={tdStyle}>
                    <span style={{ color: p.status === "Verified" ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                      {p.status}
                    </span>
                  </td>
                  <td style={tdStyle}>{p.totalCreditsIssued}</td>
                  <td style={tdStyle}>{p.totalCreditsRetired}</td>
                  <td style={tdStyle}>{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
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
      </div>
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
