'use client';

import { colors, typography, spacing, borderRadius, shadows } from '../../../styles/design-system';
import { AdminStats } from '../../../lib/admin-api';

interface Props {
  stats:   AdminStats | null;
  loading: boolean;
}

function fmtTonnes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtUsdc(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style:    'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

interface CardDef {
  label:   string;
  key:     keyof AdminStats;
  format:  (v: number) => string;
  unit:    string;
  iconBg:  string;
  iconColor: string;
  icon:    string;
  helpText: string;
}

const CARDS: CardDef[] = [
  {
    label:     'Total Projects',
    key:       'totalProjects',
    format:    n => n.toLocaleString(),
    unit:      'projects',
    iconBg:    colors.primary[100],
    iconColor: colors.primary[700],
    icon:      '◉',
    helpText:  'Registered on-chain',
  },
  {
    label:     'Tonnes Issued',
    key:       'totalTonnesIssued',
    format:    fmtTonnes,
    unit:      'tCO₂e',
    iconBg:    '#dbeafe',
    iconColor: '#1d4ed8',
    icon:      '▲',
    helpText:  'Minted across all batches',
  },
  {
    label:     'Tonnes Retired',
    key:       'totalTonnesRetired',
    format:    fmtTonnes,
    unit:      'tCO₂e',
    iconBg:    colors.primary[100],
    iconColor: colors.primary[800],
    icon:      '✦',
    helpText:  'Permanently retired on-chain',
  },
  {
    label:     'Protocol Fees',
    key:       'protocolFeesUsdc',
    format:    fmtUsdc,
    unit:      'USDC',
    iconBg:    '#dbeafe',
    iconColor: '#2775CA',
    icon:      '$',
    helpText:  '1% collected on purchases',
  },
];

export function SummaryCards({ stats, loading }: Props) {
  return (
    <section style={{
      display:             'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap:                 spacing[6],
    }}>
      {CARDS.map(({ label, key, format, unit, iconBg, iconColor, icon, helpText }) => {
        const value = stats?.[key] as number | undefined;

        return (
          <div
            key={key}
            style={{
              background:   colors.surface,
              border:       `1px solid ${colors.neutral[200]}`,
              borderRadius: borderRadius.xl,
              padding:      spacing[6],
              boxShadow:    shadows.sm,
              transition:   'box-shadow 0.15s, border-color 0.15s',
              cursor:       'default',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.boxShadow   = shadows.md;
              el.style.borderColor = colors.neutral[300];
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.boxShadow   = shadows.sm;
              el.style.borderColor = colors.neutral[200];
            }}
          >
            {/* Icon + Label row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[4] }}>
              <span style={{
                fontFamily:  typography.fontFamily.sans,
                fontSize:    typography.fontSize.sm,
                fontWeight:  typography.fontWeight.medium,
                color:       colors.neutral[600],
              }}>
                {label}
              </span>
              <span style={{
                display:      'flex',
                alignItems:   'center',
                justifyContent:'center',
                width:        '32px',
                height:       '32px',
                borderRadius: borderRadius.lg,
                background:   iconBg,
                color:        iconColor,
                fontSize:     '14px',
                fontWeight:   typography.fontWeight.bold,
              }}>
                {icon}
              </span>
            </div>

            {/* Value */}
            {loading || value === undefined ? (
              <>
                <div style={{
                  height:       '36px',
                  background:   colors.neutral[100],
                  borderRadius: borderRadius.md,
                  marginBottom: spacing[2],
                  animation:    'cl-pulse 1.5s ease-in-out infinite',
                }} />
                <div style={{
                  height:       '16px',
                  width:        '60%',
                  background:   colors.neutral[100],
                  borderRadius: borderRadius.md,
                  animation:    'cl-pulse 1.5s ease-in-out infinite',
                }} />
              </>
            ) : (
              <>
                <div style={{
                  fontFamily:  typography.fontFamily.sans,
                  fontSize:    typography.fontSize['3xl'],
                  fontWeight:  typography.fontWeight.bold,
                  color:       colors.neutral[900],
                  lineHeight:  1.1,
                  marginBottom:spacing[1],
                }}>
                  {format(value)}
                </div>
                <div style={{
                  display:    'flex',
                  alignItems: 'center',
                  gap:        spacing[2],
                }}>
                  <span style={{
                    fontFamily:  typography.fontFamily.mono,
                    fontSize:    typography.fontSize.xs,
                    fontWeight:  typography.fontWeight.medium,
                    color:       iconColor,
                    background:  iconBg,
                    padding:     `${spacing[1]} ${spacing[2]}`,
                    borderRadius:borderRadius.sm,
                  }}>
                    {unit}
                  </span>
                  <span style={{
                    fontFamily: typography.fontFamily.sans,
                    fontSize:   typography.fontSize.xs,
                    color:      colors.neutral[400],
                  }}>
                    {helpText}
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
