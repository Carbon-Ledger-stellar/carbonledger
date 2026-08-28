'use client';

import { colors, typography, spacing, borderRadius, shadows, statusBadge } from '../../../styles/design-system';
import { VerifierActivity } from '../../../lib/admin-api';

interface Props {
  verifiers: VerifierActivity[];
  loading:   boolean;
}

function truncate(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function fmtLastActivity(iso: string): string {
  const d = daysSince(iso);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30)  return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)}y ago`;
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

export function VerifiersTable({ verifiers, loading }: Props) {
  return (
    <section>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing[4] }}>
        <h2 style={{
          fontFamily: typography.fontFamily.sans,
          fontSize:   typography.fontSize.lg,
          fontWeight: typography.fontWeight.semibold,
          color:      colors.neutral[900],
          margin:     0,
        }}>
          Verifier Activity
        </h2>
        {!loading && (
          <span style={{
            fontFamily: typography.fontFamily.sans,
            fontSize:   typography.fontSize.sm,
            color:      colors.neutral[500],
          }}>
            {verifiers.length} registered verifiers
          </span>
        )}
      </div>

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
                {['Verifier', 'Address', 'Projects Verified', 'Pending', 'Fees Earned (USDC)', 'Last Activity', 'Status'].map(h => (
                  <th key={h} style={TH_STYLE}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${colors.neutral[100]}` }}>
                      {[140, 120, 60, 50, 90, 80, 70].map((w, j) => (
                        <td key={j} style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          <div style={{
                            height:      '16px',
                            width:       `${w}px`,
                            background:  colors.neutral[100],
                            borderRadius:borderRadius.sm,
                            animation:   'cl-pulse 1.5s ease-in-out infinite',
                          }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : verifiers.map((v, i) => {
                    const badge    = statusBadge(v.status === 'active' ? 'Active' : 'Suspended');
                    const days     = daysSince(v.lastActivityDate);
                    const isStale  = days > 90;

                    return (
                      <tr
                        key={v.verifierAddress}
                        style={{
                          borderBottom: i < verifiers.length - 1 ? `1px solid ${colors.neutral[100]}` : 'none',
                          transition:   'background 0.1s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = colors.neutral[50]; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        {/* Name */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          <span style={{
                            fontFamily: typography.fontFamily.sans,
                            fontSize:   typography.fontSize.sm,
                            fontWeight: typography.fontWeight.medium,
                            color:      colors.neutral[900],
                          }}>
                            {v.verifierName}
                          </span>
                        </td>

                        {/* Address */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>
                          {truncate(v.verifierAddress)}
                        </td>

                        {/* Projects verified */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.sans, fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.neutral[800] }}>
                          {v.projectsVerified.toLocaleString()}
                        </td>

                        {/* Pending queue */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          {v.pendingQueue > 0 ? (
                            <span style={{
                              fontFamily:   typography.fontFamily.sans,
                              fontSize:     typography.fontSize.xs,
                              fontWeight:   typography.fontWeight.medium,
                              color:        colors.pending.text,
                              background:   colors.pending.bg,
                              border:       `1px solid ${colors.pending.border}`,
                              padding:      `${spacing[1]} ${spacing[2]}`,
                              borderRadius: borderRadius.full,
                            }}>
                              {v.pendingQueue} pending
                            </span>
                          ) : (
                            <span style={{ color: colors.neutral[400], fontSize: typography.fontSize.sm }}>—</span>
                          )}
                        </td>

                        {/* Fees earned */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm, color: colors.neutral[800] }}>
                          {new Intl.NumberFormat('en-US', {
                            style:    'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                          }).format(v.totalFeesEarned)}
                        </td>

                        {/* Last activity */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          <span style={{
                            fontFamily: typography.fontFamily.sans,
                            fontSize:   typography.fontSize.sm,
                            color:      isStale ? colors.suspended.text : colors.neutral[600],
                            fontWeight: isStale ? typography.fontWeight.medium : typography.fontWeight.normal,
                          }}>
                            {fmtLastActivity(v.lastActivityDate)}
                          </span>
                        </td>

                        {/* Status */}
                        <td style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                          <span style={{
                            display:      'inline-flex',
                            alignItems:   'center',
                            gap:          spacing[2],
                            fontFamily:   typography.fontFamily.sans,
                            fontSize:     typography.fontSize.xs,
                            fontWeight:   typography.fontWeight.medium,
                            color:        badge.text,
                            background:   badge.bg,
                            border:       `1px solid ${badge.border}`,
                            padding:      `${spacing[1]} ${spacing[3]}`,
                            borderRadius: borderRadius.full,
                          }}>
                            <span style={{
                              width:        '6px',
                              height:       '6px',
                              borderRadius: borderRadius.full,
                              background:   badge.text,
                              flexShrink:   0,
                            }} />
                            {v.status === 'active' ? 'Active' : 'Inactive'}
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
