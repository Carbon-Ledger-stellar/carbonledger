"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSerialProvenance, SerialProvenanceResult } from "../../../lib/api";
import { ProvenanceTrail, ProvenanceEvent } from "../../../components/ProvenanceTrail";
import RetirementCertificatePdf from "../../../components/RetirementCertificatePdf";
import { colors } from "../../../styles/design-system";

// ─────────────────────────────────────────────────────────────────────────────
// CSV Export helper
// ─────────────────────────────────────────────────────────────────────────────

function exportProvenanceCSV(result: SerialProvenanceResult): void {
  const headers = [
    "Event Type",
    "Actor",
    "Transaction Hash",
    "Timestamp",
    "Description",
  ];

  const rows = result.provenance.map((ev) => [
    ev.eventType,
    ev.actor ?? "",
    ev.txHash,
    ev.timestamp,
    `${ev.eventType} — ${result.serialNumber}`,
  ]);

  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `provenance-${result.serialNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapt API provenance data to ProvenanceTrail component format
// ─────────────────────────────────────────────────────────────────────────────

function adaptProvenanceEvents(result: SerialProvenanceResult): ProvenanceEvent[] {
  const events: ProvenanceEvent[] = [];

  // Project registration (synthetic — from batch.issuedAt)
  events.push({
    type: "registered",
    label: "Project Registered",
    timestamp: result.batch.issuedAt,
    actor: result.project.projectId,
    actorRole: "developer",
    detail: `${result.project.name} · ${result.project.methodology} · ${result.project.country}`,
  });

  // Credit minting
  events.push({
    type: "minted",
    label: "Credits Minted",
    timestamp: result.batch.issuedAt,
    detail: `Batch ${result.batch.batchId} · ${result.batch.amount} tCO₂e · Vintage ${result.batch.vintageYear}`,
    metadata: {
      "serial range": `${result.batch.serialStart} — ${result.batch.serialEnd}`,
    },
  });

  // All chain events (transfers, etc.)
  result.provenance.forEach((ev) => {
    const typeMap: Record<
      string,
      ProvenanceEvent["type"]
    > = {
      minted: "minted",
      listed: "listed",
      purchased: "purchased",
      transferred: "transferred",
      retired: "retired",
    };

    const eventType: ProvenanceEvent["type"] =
      typeMap[ev.eventType.toLowerCase()] ?? "transferred";

    events.push({
      type: eventType,
      label: ev.eventType.charAt(0).toUpperCase() + ev.eventType.slice(1),
      timestamp: ev.timestamp,
      actor: ev.actor,
      txHash: ev.txHash,
    });
  });

  // Retirement details
  if (result.retirement) {
    events.push({
      type: "retired",
      label: "Credits Retired (Final)",
      timestamp: result.retirement.retiredAt,
      actor: result.retirement.retiredBy,
      actorRole: "beneficiary",
      txHash: result.retirement.txHash,
      detail: `Beneficiary: ${result.retirement.beneficiary} · Reason: ${result.retirement.retirementReason}`,
      metadata: {
        "beneficiary": result.retirement.beneficiary,
        "retirement reason": result.retirement.retirementReason,
      },
    });
  }

  // Sort chronologically
  return events.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "active" | "retired" }) {
  const isRetired = status === "retired";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.2rem 0.6rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 700,
        background: isRetired ? "#dcfce7" : "#dbeafe",
        color: isRetired ? "#166534" : "#1e40af",
        border: `1px solid ${isRetired ? "#bbf7d0" : "#bfdbfe"}`,
      }}
    >
      {isRetired ? "✔ Retired" : "◉ Active"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Result display
// ─────────────────────────────────────────────────────────────────────────────

function ProvenanceResult({ serial }: { serial: string }) {
  const { data, error, isLoading } = useSerialProvenance(serial);

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        style={{
          textAlign: "center",
          padding: "3rem",
          color: colors.neutral[400],
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "2rem",
            height: "2rem",
            border: `3px solid ${colors.primary[200]}`,
            borderTopColor: colors.primary[600],
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
            marginBottom: "0.75rem",
          }}
        />
        <p>Searching carbon credit records…</p>
      </div>
    );
  }

  if (error) {
    const isNotFound = error.message?.toLowerCase().includes("not found") ||
      error.message?.includes("404");

    return (
      <div
        role="alert"
        aria-live="polite"
        style={{
          textAlign: "center",
          padding: "3rem 1rem",
          border: `1px dashed ${colors.neutral[300]}`,
          borderRadius: "0.75rem",
          color: colors.neutral[400],
        }}
      >
        <p style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>
          {isNotFound ? "🔍" : "⚠️"}
        </p>
        <p
          style={{
            fontWeight: 600,
            color: colors.neutral[600],
            margin: "0 0 0.25rem",
          }}
        >
          {isNotFound ? "No records found" : "Search failed"}
        </p>
        <p style={{ fontSize: "0.875rem", margin: 0 }}>
          {isNotFound
            ? `No on-chain records match serial number "${serial}". Check for typos and try again.`
            : error.message}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const provenanceEvents = adaptProvenanceEvents(data);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Credit summary card */}
      <div
        data-testid="credit-summary"
        style={{
          background: colors.surface,
          border: `1px solid ${colors.neutral[200]}`,
          borderRadius: "0.75rem",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 800,
                color: colors.neutral[900],
                margin: "0 0 0.25rem",
              }}
            >
              {data.project.name}
            </h2>
            <p
              style={{
                fontSize: "0.875rem",
                color: colors.neutral[500],
                margin: 0,
                fontFamily: "monospace",
              }}
            >
              {data.serialNumber}
            </p>
          </div>
          <StatusBadge status={data.status} />
        </div>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "1rem",
            margin: 0,
          }}
        >
          {[
            { label: "Project ID", value: data.project.projectId },
            { label: "Methodology", value: data.project.methodology },
            { label: "Country", value: data.project.country },
            { label: "Vintage Year", value: String(data.project.vintageYear) },
            { label: "Batch", value: data.batch.batchId },
            {
              label: "Amount",
              value: `${data.batch.amount} tCO₂e`,
            },
          ].map(({ label, value }) => (
            <div key={label}>
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
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: colors.neutral[800],
                  margin: "0.15rem 0 0",
                }}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {/* CSV export */}
        <button
          onClick={() => exportProvenanceCSV(data)}
          aria-label="Export provenance data as CSV"
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            background: "transparent",
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.375rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            color: colors.neutral[600],
            cursor: "pointer",
          }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Provenance timeline */}
      <div
        data-testid="provenance-trail"
        style={{
          background: colors.surface,
          border: `1px solid ${colors.neutral[200]}`,
          borderRadius: "0.75rem",
          padding: "1.5rem",
        }}
      >
        <h3
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            color: colors.neutral[900],
            margin: "0 0 1.25rem",
          }}
        >
          Provenance Trail
        </h3>
        <ProvenanceTrail
          events={provenanceEvents}
          creditId={data.serialNumber}
          projectName={data.project.name}
        />
      </div>

      {/* Retirement certificate — only for retired credits */}
      {data.status === "retired" && data.retirement && (
        <div
          data-testid="retirement-certificate"
          style={{
            background: colors.surface,
            border: `1px solid ${colors.primary[200]}`,
            borderRadius: "0.75rem",
            padding: "1.5rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
              marginBottom: "1.25rem",
            }}
          >
            <h3
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: colors.neutral[900],
                margin: 0,
              }}
            >
              Retirement Certificate
            </h3>
            {data.retirement.certificateUrl && (
              <a
                href={data.retirement.certificateUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open permanent retirement certificate URL"
                style={{
                  fontSize: "0.8rem",
                  color: colors.primary[600],
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Permanent URL →
              </a>
            )}
          </div>

          <RetirementCertificatePdf
            data={{
              beneficiary: data.retirement.beneficiary,
              projectName: data.project.name,
              vintageYear: data.project.vintageYear,
              tonnes: data.batch.amount,
              serialStart: data.batch.serialStart,
              serialEnd: data.batch.serialEnd,
              txHash: data.retirement.txHash,
              retirementId: data.retirement.retirementId,
              methodology: data.project.methodology,
              country: data.project.country,
              retiredAt: data.retirement.retiredAt,
              verificationUrl: `${origin}/retire/${data.retirement.retirementId}`,
            }}
            showPreview={true}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main client component
// ─────────────────────────────────────────────────────────────────────────────

export default function AuditExplorerClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialSerial = searchParams.get("serial") ?? "";
  const [inputValue, setInputValue] = useState(initialSerial);
  const [activeSerial, setActiveSerial] = useState(initialSerial);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const serial = inputValue.trim();
      if (!serial) return;
      setActiveSerial(serial);
      // Update URL without full page reload
      router.replace(
        `/audit/explorer?serial=${encodeURIComponent(serial)}`,
        { scroll: false },
      );
    },
    [inputValue, router],
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.neutral[50],
        padding: "3rem 1.5rem",
      }}
    >
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 1rem",
              background: colors.primary[50],
              border: `1px solid ${colors.primary[200]}`,
              borderRadius: "9999px",
              fontSize: "0.8rem",
              color: colors.primary[700],
              fontWeight: 600,
              marginBottom: "1rem",
            }}
          >
            🔍 No wallet required
          </div>
          <h1
            style={{
              fontSize: "2.25rem",
              fontWeight: 800,
              color: colors.neutral[900],
              margin: "0 0 0.75rem",
              lineHeight: 1.2,
            }}
          >
            Carbon Credit Audit Explorer
          </h1>
          <p
            style={{
              fontSize: "1.125rem",
              color: colors.neutral[600],
              maxWidth: "600px",
              margin: "0 auto",
              lineHeight: 1.5,
            }}
          >
            Enter any credit serial number to see its complete provenance chain — from project
            registration through retirement. Publicly accessible to regulators, journalists, and
            the public.
          </p>
        </div>

        {/* Search form */}
        <form
          onSubmit={handleSearch}
          role="search"
          aria-label="Search by credit serial number"
          style={{ marginBottom: "2rem" }}
        >
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              background: colors.surface,
              border: `1px solid ${colors.neutral[300]}`,
              borderRadius: "0.75rem",
              padding: "0.5rem 0.5rem 0.5rem 1rem",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
          >
            <label
              htmlFor="serial-search-input"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clip: "rect(0,0,0,0)",
                whiteSpace: "nowrap",
              }}
            >
              Credit serial number
            </label>
            <input
              id="serial-search-input"
              ref={inputRef}
              type="search"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="e.g. CRB-2024-001-00001"
              aria-label="Enter credit serial number to search"
              autoComplete="off"
              spellCheck={false}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                fontSize: "1rem",
                color: colors.neutral[900],
                background: "transparent",
                fontFamily: "monospace",
              }}
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              style={{
                background: inputValue.trim()
                  ? colors.primary[600]
                  : colors.neutral[300],
                color: "#fff",
                border: "none",
                borderRadius: "0.5rem",
                padding: "0.75rem 1.5rem",
                fontSize: "0.9rem",
                fontWeight: 700,
                cursor: inputValue.trim() ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              Search
            </button>
          </div>

          <p
            style={{
              fontSize: "0.75rem",
              color: colors.neutral[400],
              marginTop: "0.5rem",
              marginLeft: "0.25rem",
            }}
          >
            Format: CRB-YYYY-NNN-NNNNN · Example: CRB-2024-001-00001
          </p>
        </form>

        {/* Results */}
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>

        {activeSerial ? (
          <ProvenanceResult serial={activeSerial} />
        ) : (
          /* Help cards */
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            {[
              {
                icon: "📋",
                title: "Project Registration",
                desc: "When and by whom the project was registered on CarbonLedger",
              },
              {
                icon: "✅",
                title: "Verifier Approval",
                desc: "Which accredited verifier approved the project for credit issuance",
              },
              {
                icon: "🛰️",
                title: "Oracle Monitoring",
                desc: "Satellite monitoring submissions proving the offsets occurred",
              },
              {
                icon: "🌱",
                title: "Credit Minting",
                desc: "Serial numbers, vintage year, and batch details at issuance",
              },
              {
                icon: "💼",
                title: "Transfers & Sales",
                desc: "Complete chain of custody from project to final buyer",
              },
              {
                icon: "🔒",
                title: "Retirement Certificate",
                desc: "Permanent on-chain proof of retirement with downloadable PDF",
              },
            ].map((card) => (
              <div
                key={card.title}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.neutral[200]}`,
                  borderRadius: "0.75rem",
                  padding: "1.25rem",
                }}
              >
                <p style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>
                  {card.icon}
                </p>
                <h3
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 700,
                    color: colors.neutral[800],
                    margin: "0 0 0.25rem",
                  }}
                >
                  {card.title}
                </h3>
                <p
                  style={{
                    fontSize: "0.8rem",
                    color: colors.neutral[500],
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {card.desc}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
