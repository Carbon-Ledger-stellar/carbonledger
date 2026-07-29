'use client';

import { colors } from '../styles/design-system';

interface Props {
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  onReset: () => void;
}

export function EsgDateRangeFilter({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  onReset,
}: Props) {
  return (
    <div
      aria-label="Date range filter for ESG dashboard"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      <div>
        <label
          htmlFor="esg-start-date"
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: colors.neutral[600],
            display: "block",
            marginBottom: "0.25rem",
          }}
        >
          Start Date
        </label>
        <input
          id="esg-start-date"
          type="date"
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
          aria-label="Filter start date"
          style={{
            padding: "0.5rem",
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            color: colors.neutral[900],
            background: colors.surface,
          }}
        />
      </div>
      <div>
        <label
          htmlFor="esg-end-date"
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: colors.neutral[600],
            display: "block",
            marginBottom: "0.25rem",
          }}
        >
          End Date
        </label>
        <input
          id="esg-end-date"
          type="date"
          value={endDate}
          onChange={(e) => onEndChange(e.target.value)}
          aria-label="Filter end date"
          style={{
            padding: "0.5rem",
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            color: colors.neutral[900],
            background: colors.surface,
          }}
        />
      </div>
      <button
        onClick={onReset}
        aria-label="Reset date range to default"
        style={{
          marginTop: "1.25rem",
          background: "transparent",
          color: colors.neutral[600],
          border: `1px solid ${colors.neutral[300]}`,
          borderRadius: "0.375rem",
          padding: "0.5rem 1rem",
          fontSize: "0.875rem",
          cursor: "pointer",
        }}
      >
        Reset
      </button>
    </div>
  );
}
