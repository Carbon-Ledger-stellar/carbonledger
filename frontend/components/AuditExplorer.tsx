"use client";

import { useState } from "react";
import { useRetirements, RetirementRecord } from "../lib/api";
import { formatTonnes } from "../lib/carbon-utils";
import { colors } from "../styles/design-system";

export default function AuditExplorer() {
  const [query, setQuery]   = useState("");
  const [filter, setFilter] = useState<"all" | "project" | "batch">("all");
  const { data: retirements, isLoading } = useRetirements(100);

  const filtered = (retirements ?? []).filter(r => {
    if (!query) return true;
    const q = query.toLowerCase();
    if (filter === "project") return r.projectId.toLowerCase().includes(q);
    if (filter === "batch")   return r.batchId.toLowerCase().includes(q);
    return (
      r.projectId.toLowerCase().includes(q) ||
      r.batchId.toLowerCase().includes(q) ||
      r.retirementId.toLowerCase().includes(q) ||
      r.beneficiary.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Search bar */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
        <label htmlFor="audit-search" className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}>
          Search audit trail
        </label>
        <input
          id="audit-search"
          type="search"
          aria-label="Search by project, batch, retirement ID, or beneficiary"
          placeholder="Search by project, batch, retirement ID, or beneficiary…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            flex: 1,
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.5rem",
            padding: "0.6rem 1rem",
            fontSize: "0.875rem",
            color: colors.neutral[800],
          }}
        />
        <label htmlFor="audit-filter" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}>
          Filter by field
        </label>
        <select
          id="audit-filter"
          aria-label="Filter search by field"
          value={filter}
          onChange={e => setFilter(e.target.value as typeof filter)}
          style={{
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.5rem",
            padding: "0.6rem 0.75rem",
            fontSize: "0.875rem",
            color: colors.neutral[700],
          }}
        >
          <option value="all">All fields</option>
          <option value="project">Project</option>
          <option value="batch">Batch</option>
        </select>
      </div>

      {/* Results */}
      {isLoading ? (
        <p style={{ color: colors.neutral[400], textAlign: "center", padding: "2rem" }}>Loading audit trail…</p>
      ) : (
        <>
          <p role="status" aria-live="polite" style={{ fontSize: "0.8rem", color: colors.neutral[500], marginBottom: "0.75rem" }}>
            {filtered.length} record{filtered.length !== 1 ? "s" : ""} found
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {filtered.length === 0 && (
              <p style={{ color: colors.neutral[400], textAlign: "center", padding: "2rem" }}>No records found</p>
            )}
            {filtered.map(r => (
              <div key={r.retirementId} style={{
                background: colors.surface,
                border: `1px solid ${colors.neutral[200]}`,
                borderRadius: "0.5rem",
                padding: "1rem",
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr auto",
                gap: "1rem",
                alignItems: "center",
              }}>
                <div>
                  <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: "0 0 0.2rem" }}>Project</p>
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[800], margin: 0 }}>{r.projectId}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: "0 0 0.2rem" }}>Beneficiary</p>
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[800], margin: 0 }}>{r.beneficiary}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: "0 0 0.2rem" }}>Amount</p>
                  <p style={{ fontSize: "0.875rem", fontWeight: 700, color: colors.primary[700], margin: 0 }}>
                    {formatTonnes(r.amount)}
                  </p>
                </div>
                <a
                  href={`/retire/${r.retirementId}`}
                  aria-label={`View certificate for ${r.beneficiary} — ${r.projectId}`}
                  style={{
                    background: colors.primary[50],
                    color: colors.primary[700],
                    border: `1px solid ${colors.primary[200]}`,
                    borderRadius: "0.375rem",
                    padding: "0.4rem 0.75rem",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  View Certificate
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
