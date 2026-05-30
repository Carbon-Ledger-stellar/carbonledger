"use client";

import { useOracleStatus } from "../lib/api";
import { colors } from "../styles/design-system";

interface ProjectOracleStatusProps {
  projectId: string;
}

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

  const isCurrent = status.isCurrent;
  const lastUpdate = status.lastSubmittedAt ? new Date(status.lastSubmittedAt).toLocaleDateString() : 'Never';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <div style={{
          width: '8px',
          height: '8px',
          background: isCurrent ? colors.primary[500] : colors.neutral[400],
          borderRadius: '50%'
        }} />
        <span style={{ fontSize: '0.875rem', color: colors.neutral[700] }}>
          {isCurrent ? 'Active' : 'Inactive'}
        </span>
      </div>
      <p style={{ fontSize: '0.75rem', color: colors.neutral[500], margin: 0 }}>
        Last update: {lastUpdate}
      </p>
      {status.latestScore !== null && (
        <p style={{ fontSize: '0.75rem', color: colors.neutral[500], margin: '0.25rem 0 0' }}>
          Latest score: {status.latestScore}/100
        </p>
      )}
    </div>
  );
}