"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import OracleStatus from "../../../components/OracleStatus";
import { useVerifierAuth } from "../../../lib/use-verifier-auth";
import { usePendingVerifierProjects, type PendingVerifierProject } from "../../../lib/api";
import { colors } from "../../../styles/design-system";

type SortKey = "createdAt" | "methodology" | "country";
type SortDir = "asc" | "desc";

function projectDocCid(p: PendingVerifierProject): string | undefined {
  return p.documentCid ?? p.metadataCid;
}

export default function VerifierDashboardPage() {
  const { publicKey, token } = useVerifierAuth();
  const { data: projects = [], error, isLoading, mutate } = usePendingVerifierProjects(publicKey, token);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const list = [...projects];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        cmp = a[sortKey].localeCompare(b[sortKey]);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [projects, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  return (
    <main style={{ maxWidth: 960, margin: "3rem auto", padding: "0 1rem" }}>
      <h1 style={{ marginBottom: "0.35rem" }}>Verifier Dashboard</h1>
      <p style={{ color: colors.neutral[600], marginTop: 0 }}>
        Review projects pending your accreditation. Open a project to inspect documentation and submit an on-chain attestation.
      </p>

      {error && (
        <p role="alert" style={{ color: "#dc2626" }}>
          {error.message}
        </p>
      )}

      {isLoading && <p>Loading pending projects…</p>}

      {!isLoading && sorted.length === 0 && (
        <p style={{ color: "#666" }}>No projects pending your review.</p>
      )}

      {sorted.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: "1.5rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
                <th style={thStyle}>Project</th>
                <th style={thStyle}>
                  <button type="button" onClick={() => toggleSort("methodology")} style={sortBtnStyle}>
                    Methodology {sortIndicator("methodology")}
                  </button>
                </th>
                <th style={thStyle}>
                  <button type="button" onClick={() => toggleSort("country")} style={sortBtnStyle}>
                    Country {sortIndicator("country")}
                  </button>
                </th>
                <th style={thStyle}>Score</th>
                <th style={thStyle}>
                  <button type="button" onClick={() => toggleSort("createdAt")} style={sortBtnStyle}>
                    Submitted {sortIndicator("createdAt")}
                  </button>
                </th>
                <th style={thStyle}>Docs</th>
                <th style={thStyle}>Review</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={tdStyle}>
                    <strong>{p.name}</strong>
                    <br />
                    <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>{p.projectId}</span>
                  </td>
                  <td style={tdStyle}>{p.methodology}</td>
                  <td style={tdStyle}>{p.country}</td>
                  <td style={tdStyle}>{p.methodologyScore}/100</td>
                  <td style={tdStyle}>{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td style={tdStyle}>
                    {projectDocCid(p) ? (
                      <a
                        href={`https://ipfs.io/ipfs/${projectDocCid(p)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: colors.primary[700] }}
                      >
                        PDF ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={tdStyle}>
                    <Link href={`/verifier/projects/${p.id}`} style={reviewLinkStyle}>
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "2rem" }}>
        <button
          type="button"
          onClick={() => mutate()}
          style={{
            padding: "0.45rem 0.9rem",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Refresh list
        </button>
      </div>

      <hr style={{ margin: "2rem 0" }} />
      <OracleStatus />
    </main>
  );
}

const thStyle: React.CSSProperties = { padding: "0.65rem 0.5rem", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "0.75rem 0.5rem", verticalAlign: "top" };
const sortBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
};
const reviewLinkStyle: React.CSSProperties = {
  color: "#7C3AED",
  fontWeight: 600,
  textDecoration: "none",
};
