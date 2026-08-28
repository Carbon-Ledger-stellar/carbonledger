"use client";

import { useOracleStatus } from "../lib/api";
import { colors } from "../styles/design-system";
import Tooltip from "./Tooltip";

interface ProjectOracleStatusProps {
  projectId: string;
}

const ACTIVE_TOOLTIP   = "Healthy — monitoring data is within the last 365 days.\nNew credit issuance is not affected.";
const INACTIVE_TOOLTIP = "Offline — no oracle monitoring data available.\nNew credit issuance is blocked until data is submitted.";

export default function ProjectOracleStatus({ projectId }: ProjectOracleStatusProps) {
  const { data: status, isLoading } = useOracleStatus(projectId);

  if (isLoading) {
    return (
      <div>
        <div style={{ width: "100px", height: "16px", background: colors.neutral[100], borderRadius: "4px", marginBottom: "0.5rem" }} />
        <div style={{ width: "150px", height: "20px", background: colors.neutral[100], borderRadius: "4px" }} />
      </div>
    );
  }

  if (!status) {
    return <p style={{ color: colors.neutral[500] }}>No oracle data available.</p>;
  }

  const isCurrent  = status.isCurrent;
  const lastUpdate = status.lastSubmittedAt ? new Date(status.lastSubmittedAt).toLocaleDateString() : "Never";
  const tooltip    = isCurrent ? ACTIVE_TOOLTIP : INACTIVE_TOOLTIP;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <Tooltip content={tooltip}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "default" }}>
            <span style={{
              width: "8px",
              height: "8px",
              background: isCurrent ? colors.primary[500] : colors.neutral[400],
              borderRadius: "50%",
              display: "inline-block",
            }} />
            <span style={{ fontSize: "0.875rem", color: colors.neutral[700] }}>
              {isCurrent ? "Active" : "Inactive"}
            </span>
          </span>
        </Tooltip>
      </div>
      <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: 0 }}>
        Last update: {lastUpdate}
      </p>
      {status.latestScore !== null && (
        <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: "0.25rem 0 0" }}>
          Latest score: {status.latestScore}/100
        </p>
      )}
    </div>
  );
}
