"use client";

import Link from "next/link";
import { useMemo } from "react";
import OracleStatus from "../../../components/OracleStatus";
import { useVerifierAuth } from "../../../lib/use-verifier-auth";
import { usePendingVerifierProjects, type PendingVerifierProject } from "../../../lib/api";
import { colors } from "../../../styles/design-system";
import AccessibleDataGrid, { type Column } from "../../../components/AccessibleDataGrid";

function projectDocCid(p: PendingVerifierProject): string | undefined {
  return p.documentCid ?? p.metadataCid;
}

export default function VerifierDashboardPage() {
  const { publicKey, token } = useVerifierAuth();
  const { data: projects = [], error, isLoading, mutate } = usePendingVerifierProjects(publicKey, token);

  const columns: Column<PendingVerifierProject>[] = useMemo(() => [
    {
      key: "name",
      label: "Project",
      sortable: true,
      render: (p) => (
        <>
          <strong>{p.name}</strong>
          <br />
          <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>{p.projectId}</span>
        </>
      ),
    },
    {
      key: "methodology",
      label: "Methodology",
      sortable: true,
      render: (p) => p.methodology,
    },
    {
      key: "country",
      label: "Country",
      sortable: true,
      render: (p) => p.country,
    },
    {
      key: "methodologyScore",
      label: "Score",
      render: (p) => `${p.methodologyScore}/100`,
    },
    {
      key: "createdAt",
      label: "Submitted",
      sortable: true,
      render: (p) => new Date(p.createdAt).toLocaleDateString(),
    },
    {
      key: "docs",
      label: "Docs",
      render: (p) =>
        projectDocCid(p) ? (
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
        ),
    },
    {
      key: "review",
      label: "Review",
      render: (p) => (
        <Link href={`/verifier/projects/${p.id}`} style={{ color: "#7C3AED", fontWeight: 600, textDecoration: "none" }}>
          Review →
        </Link>
      ),
    },
  ], []);

  return (
    <main style={{ maxWidth: 960, margin: "3rem auto", padding: "0 1rem" }}>
      <h1 style={{ marginBottom: "0.35rem" }}>Verifier Dashboard</h1>
      <p style={{ color: colors.neutral[600], marginTop: 0 }}>
        Review projects pending your accreditation. Open a project to inspect documentation and submit an on-chain attestation.
      </p>

      <div style={{ display: "flex", gap: "1.25rem", marginBottom: "1rem" }}>
        <Link href="/verifier/history" style={{ fontSize: "0.875rem", color: colors.primary[700] }}>
          Attestation history →
        </Link>
        <Link href="/verifier/fees" style={{ fontSize: "0.875rem", color: colors.primary[700] }}>
          Fee tracker →
        </Link>
      </div>

      {error && (
        <p role="alert" style={{ color: "#dc2626" }}>
          {error.message}
        </p>
      )}

      <AccessibleDataGrid
        data={projects}
        columns={columns}
        rowId={(p) => p.id}
        defaultSortKey="createdAt"
        defaultSortDir="desc"
        pageSize={25}
        rowHeight={52}
        maxHeight={480}
        loading={isLoading}
        emptyMessage="No projects pending your review."
        onRowActivate={(p) => window.open(`/verifier/projects/${p.id}`, "_self")}
      />

      <div style={{ marginTop: "1rem" }}>
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