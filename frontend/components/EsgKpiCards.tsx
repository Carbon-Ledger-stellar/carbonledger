'use client';

import { colors, typography, borderRadius, shadows } from '../styles/design-system';
import { KpiData } from '../lib/esg-aggregation';
import { formatTonnes } from '../lib/carbon-utils';

interface Props {
  kpi: KpiData;
}

export function EsgKpiCards({ kpi }: Props) {
  const cards = [
    {
      label: "Total Tonnes Retired (Lifetime)",
      value: formatTonnes(kpi.totalTonnesLifetime),
      iconBg: colors.primary[100],
      iconColor: colors.primary[700],
      icon: "✦",
      helpText: "All-time retirement total",
    },
    {
      label: "Tonnes Retired This Year",
      value: formatTonnes(kpi.totalTonnesThisYear),
      iconBg: "#dbeafe",
      iconColor: "#1d4ed8",
      icon: "▲",
      helpText: `${new Date().getFullYear()} YTD`,
    },
    {
      label: "Pending Certificates",
      value: kpi.pendingCertificates.toLocaleString(),
      iconBg: "#fef3c7",
      iconColor: "#b45309",
      icon: "⏳",
      helpText: "Awaiting finalization",
    },
  ];

  return (
    <section
      aria-label="ESG Key Performance Indicators"
      className="esg-kpi-grid"
    >
      {cards.map(({ label, value, iconBg, iconColor, icon, helpText }) => (
        <div
          key={label}
          style={{
            background: colors.surface,
            border: `1px solid ${colors.neutral[200]}`,
            borderRadius: borderRadius.xl,
            padding: "1.5rem",
            boxShadow: shadows.sm,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "1rem",
            }}
          >
            <span
              style={{
                fontFamily: typography.fontFamily.sans,
                fontSize: typography.fontSize.sm,
                fontWeight: typography.fontWeight.medium,
                color: colors.neutral[600],
              }}
            >
              {label}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "32px",
                borderRadius: borderRadius.lg,
                background: iconBg,
                color: iconColor,
                fontSize: "14px",
                fontWeight: typography.fontWeight.bold,
              }}
            >
              {icon}
            </span>
          </div>
          <div
            style={{
              fontFamily: typography.fontFamily.sans,
              fontSize: typography.fontSize["3xl"],
              fontWeight: typography.fontWeight.bold,
              color: colors.neutral[900],
              lineHeight: 1.1,
              marginBottom: "0.25rem",
            }}
          >
            {value}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span
              style={{
                fontFamily: typography.fontFamily.mono,
                fontSize: typography.fontSize.xs,
                fontWeight: typography.fontWeight.medium,
                color: iconColor,
                background: iconBg,
                padding: "0.125rem 0.5rem",
                borderRadius: borderRadius.sm,
              }}
            >
              {label.includes("This Year") ? "tCO₂e" : label.includes("Lifetime") ? "tCO₂e" : "count"}
            </span>
            <span
              style={{
                fontFamily: typography.fontFamily.sans,
                fontSize: typography.fontSize.xs,
                color: colors.neutral[400],
              }}
            >
              {helpText}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
