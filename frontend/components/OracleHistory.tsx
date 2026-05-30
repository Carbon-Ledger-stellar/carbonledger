"use client";

import { useOracleHistory } from "../lib/api";
import { colors } from "../styles/design-system";

interface OracleHistoryProps {
  projectId: string;
}

export default function OracleHistory({ projectId }: OracleHistoryProps) {
  const { data: history, isLoading } = useOracleHistory(projectId);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: '8px', height: '8px', background: colors.neutral[200], borderRadius: '50%' }} />
            <div style={{ width: '100px', height: '12px', background: colors.neutral[200], borderRadius: '4px' }} />
            <div style={{ width: '60px', height: '12px', background: colors.neutral[200], borderRadius: '4px' }} />
          </div>
        ))}
      </div>
    );
  }

  if (!history || history.length === 0) {
    return <p style={{ color: colors.neutral[500] }}>No monitoring history available.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {history.slice(0, 10).map((entry, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0' }}>
          <div style={{
            width: '8px',
            height: '8px',
            background: entry.score >= 70 ? colors.primary[500] : colors.neutral[400],
            borderRadius: '50%',
            flexShrink: 0
          }} />
          <span style={{ fontSize: '0.875rem', color: colors.neutral[700], flex: 1 }}>
            Score: {entry.score}/100
          </span>
          <span style={{ fontSize: '0.75rem', color: colors.neutral[500] }}>
            {new Date(entry.submittedAt).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
}