"use client";

import { useProject, useRetirements, useCreditBatches } from "../../../lib/api";
import { formatTonnes } from "../../../lib/carbon-utils";
import { colors, statusBadge } from "../../../styles/design-system";
import OracleStatus from "../../../components/OracleStatus";
import OracleHistory from "../../../components/OracleHistory";
import ProjectMap from "../../../components/ProjectMap";
import ProjectOracleStatus from "../../../components/ProjectOracleStatus";
import ProvenanceTrail from "../../../components/ProvenanceTrail";
import LoadingSkeleton from "../../../components/LoadingSkeleton";

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { data: project, isLoading } = useProject(params.id);
  const { data: retirements } = useRetirements(50);
  const { data: creditBatches } = useCreditBatches(params.id);

  const projectRetirements = (retirements ?? []).filter(r => r.projectId === params.id);

  if (isLoading) return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      {/* Header Skeleton */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ width: "100px", height: "14px", background: colors.neutral[100], borderRadius: "4px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
              <div style={{ width: "40%", height: "32px", background: colors.neutral[100], borderRadius: "4px" }} />
              <div style={{ width: "60%", height: "16px", background: colors.neutral[100], borderRadius: "4px" }} />
            </div>
            <div style={{ width: "80px", height: "24px", background: colors.neutral[100], borderRadius: "9999px" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "2rem" }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Stats Skeleton */}
          <div style={{
            background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.75rem", padding: "1.5rem",
          }}>
            <div style={{ width: "120px", height: "16px", background: colors.neutral[100], borderRadius: "4px", marginBottom: "1rem" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" }}>
              {[1, 2, 3, 4].map(i => (
                <div key={i}>
                  <div style={{ width: "60px", height: "10px", background: colors.neutral[100], borderRadius: "4px", marginBottom: "0.4rem" }} />
                  <div style={{ width: "80px", height: "24px", background: colors.neutral[100], borderRadius: "4px" }} />
                </div>
              ))}
            </div>
          </div>

          {/* Provenance Skeleton */}
          <div style={{
            background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.75rem", padding: "1.5rem",
          }}>
            <div style={{ width: "120px", height: "16px", background: colors.neutral[100], borderRadius: "4px", marginBottom: "1.5rem" }} />
            <LoadingSkeleton variant="ProvenanceTrail" count={1} />
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div style={{
            background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.75rem", padding: "1.5rem",
          }}>
            <div style={{ width: "150px", height: "16px", background: colors.neutral[100], borderRadius: "4px", marginBottom: "1rem" }} />
            <div style={{ width: "100%", height: "40px", background: colors.neutral[100], borderRadius: "4px" }} />
          </div>
          <div style={{ width: "100%", height: "48px", background: colors.neutral[100], borderRadius: "8px" }} />
        </div>
      </div>
    </div>
  );

  if (!project) return (
    <div style={{ textAlign: "center", padding: "4rem" }}>
      <p style={{ color: colors.neutral[500] }}>Project not found.</p>
    </div>
  );

  const badge = statusBadge(project.status);
  const retiredPct = project.totalCreditsIssued > 0
    ? Math.round((project.totalCreditsRetired / project.totalCreditsIssued) * 100)
    : 0;

  const provenanceEvents = [
    { type: "registered" as const, label: "Project Registered", timestamp: project.createdAt, detail: `${project.methodology} · ${project.country} · Score: ${project.methodologyScore}` },
    ...(project.status !== "Pending" ? [{ type: "verified" as const, label: "Project Verified", timestamp: project.createdAt, detail: "Independently verified by accredited verifier" }] : []),
    ...(project.totalCreditsIssued > 0 ? [{ type: "minted" as const, label: "Credits Issued", timestamp: project.createdAt, detail: `${formatTonnes(project.totalCreditsIssued)} issued with unique serial numbers` }] : []),
  ];

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <a href="/projects" style={{ fontSize: "0.875rem", color: colors.primary[600], textDecoration: "none" }}>
          ← All Projects
        </a>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "1rem" }}>
            <div>
              <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
                {project.name}
              </h1>
              <p style={{ color: colors.neutral[500], margin: 0 }}>
                {project.methodology} · {project.projectType} · {project.country} · {project.vintageYear} Vintage · Score {project.methodologyScore}/100
              </p>
            </div>
          <span style={{
            background: badge.bg, color: badge.text, border: `1px solid ${badge.border}`,
            borderRadius: "9999px", padding: "0.3rem 0.75rem", fontSize: "0.8rem", fontWeight: 700,
          }}>
            {project.status}
          </span>
        </div>
      </div>

      {/* Map */}
      {project.latitude && project.longitude && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: colors.neutral[900], marginBottom: "1rem" }}>
            Project Location
          </h2>
          <ProjectMap latitude={project.latitude} longitude={project.longitude} projectName={project.name} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "2rem" }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Stats */}
          <div style={{
            background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.75rem", padding: "1.5rem",
          }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[800], margin: "0 0 1rem" }}>
              Credit Summary
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" }}>
              {[
                { label: "Total Issued",   value: formatTonnes(project.totalCreditsIssued),   color: colors.primary[700] },
                { label: "Total Retired",  value: formatTonnes(project.totalCreditsRetired),  color: colors.neutral[700] },
                { label: "Retirement Rate", value: `${retiredPct}%`,                          color: retiredPct > 50 ? colors.primary[600] : colors.neutral[600] },
                { label: "Methodology Score", value: `${project.methodologyScore}/100`, color: project.methodologyScore >= 70 ? colors.primary[600] : colors.neutral[600] },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: "0 0 0.2rem" }}>{label}</p>
                  <p style={{ fontSize: "1.25rem", fontWeight: 800, color, margin: 0 }}>{value}</p>
                </div>
              ))}
            </div>
            {/* Progress bar */}
            <div style={{ marginTop: "1rem" }}>
              <div style={{ background: colors.neutral[100], borderRadius: "9999px", height: "8px", overflow: "hidden" }}>
                <div style={{
                  background: colors.primary[500], height: "100%",
                  width: `${retiredPct}%`, borderRadius: "9999px",
                  transition: "width 0.5s",
                }} />
              </div>
              <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: "0.3rem 0 0" }}>
                {retiredPct}% of issued credits have been permanently retired
              </p>
            </div>
          </div>

          {/* Credit Batches */}
          {creditBatches && creditBatches.length > 0 && (
            <div style={{
              background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
              borderRadius: "0.75rem", padding: "1.5rem",
            }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[800], margin: "0 0 1rem" }}>
                Credit Batches
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {creditBatches.map(batch => (
                  <div key={batch.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.75rem", background: colors.neutral[50], borderRadius: "0.5rem",
                  }}>
                    <div>
                      <p style={{ fontWeight: 600, fontSize: "0.875rem", color: colors.neutral[800], margin: 0 }}>
                        Batch {batch.batchId}
                      </p>
                      <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: "0.1rem 0 0" }}>
                        Serial: {batch.serialStart} - {batch.serialEnd}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontWeight: 700, color: colors.primary[700], margin: 0 }}>
                        {formatTonnes(batch.amount)}
                      </p>
                      <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: "0.1rem 0 0" }}>
                        {batch.vintageYear}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Provenance */}
          <div style={{
            background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.75rem", padding: "1.5rem",
          }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[800], margin: "0 0 1.25rem" }}>
              Audit Trail
            </h2>
            <ProvenanceTrail events={provenanceEvents} />
          </div>

          {/* Recent retirements */}
          {projectRetirements.length > 0 && (
            <div style={{
              background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
              borderRadius: "0.75rem", padding: "1.5rem",
            }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[800], margin: "0 0 1rem" }}>
                Recent Retirements
              </h2>
              {projectRetirements.slice(0, 5).map(r => (
                <div key={r.retirementId} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.75rem 0", borderBottom: `1px solid ${colors.neutral[100]}`,
                }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "0.875rem", color: colors.neutral[800], margin: 0 }}>{r.beneficiary}</p>
                    <p style={{ fontSize: "0.75rem", color: colors.neutral[400], margin: "0.1rem 0 0" }}>{r.retirementReason}</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontWeight: 700, color: colors.primary[700], margin: 0 }}>{formatTonnes(r.amount)}</p>
                    <a href={`/retire/${r.retirementId}`} style={{ fontSize: "0.75rem", color: colors.primary[600] }}>
                      Certificate →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Oracle Monitoring */}
          <div style={{
            background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.75rem", padding: "1.5rem",
          }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[800], margin: "0 0 1rem" }}>
              Oracle Monitoring
            </h2>
            <ProjectOracleStatus projectId={project.projectId} />
            <div style={{ marginTop: "1.5rem" }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], margin: "0 0 0.75rem" }}>
                Monitoring History
              </h3>
              <OracleHistory projectId={project.projectId} />
            </div>
          </div>

          {/* IPFS docs */}
          {project.metadataCid && (
            <div style={{
              background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
              borderRadius: "0.75rem", padding: "1.25rem",
            }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: colors.neutral[800], margin: "0 0 0.75rem" }}>
                Project Documents
              </h3>
              <a
                href={`https://gateway.pinata.cloud/ipfs/${project.metadataCid}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  fontSize: "0.8rem", color: colors.primary[600], textDecoration: "none",
                }}
              >
                <span>📄</span> View on IPFS →
              </a>
            </div>
          )}

          <a href={`/marketplace?project=${project.projectId}`} style={{
            display: "block",
            background: colors.primary[600], color: "#fff",
            borderRadius: "0.5rem", padding: "0.875rem",
            fontSize: "0.9rem", fontWeight: 700, textDecoration: "none", textAlign: "center",
          }}>
            Buy Credits from This Project
          </a>
        </div>
      </div>
    </div>
  );
}
