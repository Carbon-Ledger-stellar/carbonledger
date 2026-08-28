'use client';

import { colors, typography, spacing, borderRadius, shadows } from '../../../styles/design-system';
import { OracleHealth } from '../../../lib/admin-api';

interface Props {
  oracles: OracleHealth[];
  loading: boolean;
}

type OracleStatus = 'healthy' | 'warning' | 'stale';

function getStatus(o: OracleHealth): OracleStatus {
  if (o.daysSinceUpdate >= 365) return 'stale';
  if (o.daysSinceUpdate >= 300) return 'warning';
  return 'healthy';
}

const STATUS_STYLE: Record<OracleStatus, { bg: string; text: string; border: string; label: string }> = {
  healthy: { ...colors.verified,  label: 'Healthy' },
  warning: { ...colors.pending,   label: 'Warning' },
  stale:   { ...colors.suspended, label: 'Stale'   },
};

function truncate(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing[4] }}>
      <h2 style={{
        fontFamily: typography.fontFamily.sans,
        fontSize:   typography.fontSize.lg,
        fontWeight: typography.fontWeight.semibold,
        color:      colors.neutral[900],
        margin:     0,
      }}>
        {title}
      </h2>
      {meta && (
        <span style={{
          fontFamily: typography.fontFamily.sans,
          fontSize:   typography.fontSize.sm,
          color:      colors.neutral[500],
        }}>
          {meta}
        </span>
      )}
    </div>
  );
}

const TH_STYLE: React.CSSProperties = {
  padding:      `${spacing[3]} ${spacing[4]}`,
  textAlign:    'left',
  fontFamily:   typography.fontFamily.sans,
  fontSize:     typography.fontSize.xs,
  fontWeight:   typography.fontWeight.semibold,
  color:        colors.neutral[500],
  letterSpacing:'0.05em',
  textTransform:'uppercase',
  background:   colors.neutral[50],
  borderBottom: `1px solid ${colors.neutral[200]}`,
  whiteSpace:   'nowrap',
};

export function OracleHealthGrid({ oracles, loading }: Props) {
  const counts = {
    healthy: oracles.filter(o => getStatus(o) === 'healthy').length,
    warning: oracles.filter(o => getStatus(o) === 'warning').length,
    stale:   oracles.filter(o => getStatus(o) === 'stale').length,
  };

  return (
    <section>
      <SectionHeader
        title="Oracle Health"
        meta={loading ? undefined : `${oracles.length} projects monitored`}
      />

      {/* Summary pills */}
      {!loading && oracles.length > 0 && (
        <div style={{ display: 'flex', gap: spacing[3], marginBottom: spacing[4] }}>
          {([ 'healthy', 'warning', 'stale' ] as OracleStatus[]).map(s => {
            const st = STATUS_STYLE[s];
            return (
              <span key={s} style={{
                fontFamily:   typography.fontFamily.sans,
                fontSize:     typography.fontSize.sm,
                fontWeight:   typography.fontWeight.medium,
                color:        st.text,
                background:   st.bg,
                border:       `1px solid ${st.border}`,
                padding:      `${spacing[1]} ${spacing[3]}`,
                borderRadius: borderRadius.full,
              }}>
                {counts[s]} {st.label}
              </span>
            );
          })}
        </div>
      )}

      <div style={{
        background:   colors.surface,
        border:       `1px solid ${colors.neutral[200]}`,
        borderRadius: borderRadius.xl,
        boxShadow:    shadows.sm,
        overflow:     'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Project', 'Methodology', 'Last Monitored', 'Days Since Update', 'Oracle Address', 'Status'].map(h => (
                  <th key={h} style={TH_STYLE}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${colors.neutral[100]}` }}>
                      {[120, 80, 100, 60, 140, 70].map((w, j) => (
                        <td key={j} style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          <div style={{
                            height:     '16px',
                            width:      `${w}px`,
                            background: colors.neutral[100],
                            borderRadius:borderRadius.sm,
                            animation:  'cl-pulse 1.5s ease-in-out infinite',
                          }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : oracles.map((o, i) => {
                    const status = getStatus(o);
                    const st     = STATUS_STYLE[status];
                    return (
                      <tr
                        key={o.projectId}
                        style={{
                          borderBottom: i < oracles.length - 1 ? `1px solid ${colors.neutral[100]}` : 'none',
                          transition:   'background 0.1s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = colors.neutral[50]; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        {/* Project */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.sans, fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colors.neutral[900] }}>
                          {o.projectName}
                        </td>

                        {/* Methodology */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          <span style={{
                            fontFamily:   typography.fontFamily.mono,
                            fontSize:     typography.fontSize.xs,
                            color:        colors.primary[700],
                            background:   colors.primary[50],
                            border:       `1px solid ${colors.primary[200]}`,
                            padding:      `${spacing[1]} ${spacing[2]}`,
                            borderRadius: borderRadius.sm,
                          }}>
                            {o.methodology}
                          </span>
                        </td>

                        {/* Last Monitored */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.sans, fontSize: typography.fontSize.sm, color: colors.neutral[600] }}>
                          {new Date(o.lastMonitored).toLocaleDateString('en-US', {
                            year: 'numeric', month: 'short', day: 'numeric',
                          })}
                        </td>

                        {/* Days Since Update */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          <span style={{
                            fontFamily:  typography.fontFamily.mono,
                            fontSize:    typography.fontSize.sm,
                            fontWeight:  typography.fontWeight.semibold,
                            color:       st.text,
                          }}>
                            {o.daysSinceUpdate}d
                          </span>
                        </td>

                        {/* Oracle Address */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>
                          {truncate(o.oracleAddress)}
                        </td>

                        {/* Status badge */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          <span style={{
                            display:      'inline-flex',
                            alignItems:   'center',
                            gap:          spacing[2],
                            fontFamily:   typography.fontFamily.sans,
                            fontSize:     typography.fontSize.xs,
                            fontWeight:   typography.fontWeight.medium,
                            color:        st.text,
                            background:   st.bg,
                            border:       `1px solid ${st.border}`,
                            padding:      `${spacing[1]} ${spacing[3]}`,
                            borderRadius: borderRadius.full,
                          }}>
                            <span style={{
                              width:        '6px',
                              height:       '6px',
                              borderRadius: borderRadius.full,
                              background:   st.text,
                              flexShrink:   0,
                            }} />
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
