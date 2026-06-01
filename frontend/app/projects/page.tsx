"use client";

import { useState } from "react";
import { useProjects } from "../../lib/api";
import { formatTonnes } from "../../lib/carbon-utils";
import { colors, statusBadge } from "../../styles/design-system";
import LoadingSkeleton from "../../components/LoadingSkeleton";

const METHODOLOGIES = ["", "VCS", "Gold Standard", "ACR", "CAR"];
const COUNTRIES     = ["", "Brazil", "Indonesia", "Kenya", "India", "Colombia"];

export default function ProjectsPage() {
  const [methodology, setMethodology] = useState("");
  const [country, setCountry]         = useState("");
  const [vintage, setVintage]         = useState("");

  const { data: projects, isLoading } = useProjects({
    methodology: methodology || undefined,
    country:     country     || undefined,
    vintage:     vintage ? Number(vintage) : undefined,
  });

  const selectStyle: React.CSSProperties = {
    border: `1px solid ${colors.neutral[300]}`,
    borderRadius: "0.375rem",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    color: colors.neutral[700],
    background: colors.surface,
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
        Verified Carbon Projects
      </h1>
      <p style={{ color: colors.neutral[500], margin: "0 0 2rem" }}>
        Every project has been independently verified and is monitored by satellite data.
      </p>

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", flexWrap: "wrap" }}>
        <select style={selectStyle} value={methodology} onChange={e => setMethodology(e.target.value)}>
          {METHODOLOGIES.map(m => <option key={m} value={m}>{m || "All Methodologies"}</option>)}
        </select>
        <select style={selectStyle} value={country} onChange={e => setCountry(e.target.value)}>
          {COUNTRIES.map(c => <option key={c} value={c}>{c || "All Countries"}</option>)}
        </select>
        <select style={selectStyle} value={vintage} onChange={e => setVintage(e.target.value)}>
          <option value="">All Vintages</option>
          {["2020","2021","2022","2023","2024"].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
          {Array.from({ length: 6 }).map((_, i) => <LoadingSkeleton key={i} variant="ProjectCard" />)}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
          {(projects ?? []).map(p => {
            const badge = statusBadge(p.status);
            return (
              <a key={p.projectId} href={`/projects/${p.projectId}`} style={{ textDecoration: "none" }}>
                <div style={{
                  background: colors.surface,
                  border: `1px solid ${colors.neutral[200]}`,
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  height: "100%",
                  boxSizing: "border-box",
                  transition: "box-shadow 0.2s",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                    <span style={{ fontSize: "0.75rem", color: colors.neutral[500] }}>
                      {p.country} · {p.vintageYear}
                    </span>
                    <span style={{
                      background: badge.bg, color: badge.text, border: `1px solid ${badge.border}`,
                      borderRadius: "9999px", padding: "0.15rem 0.5rem", fontSize: "0.7rem", fontWeight: 600,
                    }}>
                      {p.status}
                    </span>
                  </div>
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
                    {p.name}
                  </h3>
                  <p style={{ fontSize: "0.8rem", color: colors.neutral[500], margin: "0 0 1rem" }}>
                    {p.methodology} · {p.projectType}
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: "0 0 0.1rem" }}>Score</p>
                      <p style={{ fontSize: "0.875rem", fontWeight: 700, color: p.methodologyScore >= 85 ? colors.primary[600] : colors.neutral[700], margin: 0 }}>
                        {p.methodologyScore}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: "0 0 0.1rem" }}>Issued</p>
                      <p style={{ fontSize: "0.875rem", fontWeight: 700, color: colors.primary[700], margin: 0 }}>
                        {formatTonnes(p.totalCreditsIssued)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: "0 0 0.1rem" }}>Retired</p>
                      <p style={{ fontSize: "0.875rem", fontWeight: 700, color: colors.neutral[700], margin: 0 }}>
                        {formatTonnes(p.totalCreditsRetired)}
                      </p>
                    </div>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
