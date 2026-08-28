'use client';

import { useState } from 'react';
import {
  colors, typography, spacing, borderRadius, shadows, statusBadge,
} from '../../../styles/design-system';
import { AdminProject, suspendProject } from '../../../lib/admin-api';

interface Props {
  projects:    AdminProject[];
  loading:     boolean;
  onSuspended: (projectId: string, txHash: string) => void;
}

function fmtTonnes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Map contract status → statusBadge() key */
const STATUS_LABEL: Record<AdminProject['status'], string> = {
  verified:  'Verified',
  pending:   'Pending',
  suspended: 'Suspended',
  rejected:  'Rejected',
};

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

interface ModalState {
  projectId:   string;
  projectName: string;
}

export function ProjectsTable({ projects, loading, onSuspended }: Props) {
  const [modal,      setModal]      = useState<ModalState | null>(null);
  const [reason,     setReason]     = useState('');
  const [suspending, setSuspending] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [txHash,     setTxHash]     = useState<string | null>(null);

  function openModal(p: AdminProject) {
    setModal({ projectId: p.id, projectName: p.name });
    setReason('');
    setError(null);
    setTxHash(null);
  }

  function closeModal() {
    if (suspending) return;
    setModal(null);
    setError(null);
    setTxHash(null);
  }

  async function handleSuspend() {
    if (!modal || !reason.trim()) return;
    setSuspending(true);
    setError(null);
    try {
      const { txHash: hash } = await suspendProject({
        projectId: modal.projectId,
        reason:    reason.trim(),
      });
      setTxHash(hash);
      onSuspended(modal.projectId, hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suspension failed. Please try again.');
    } finally {
      setSuspending(false);
    }
  }

  return (
    <>
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
            All Projects
          </h2>
          {!loading && (
            <span style={{
              fontFamily: typography.fontFamily.sans,
              fontSize:   typography.fontSize.sm,
              color:      colors.neutral[500],
            }}>
              {projects.length} projects
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
                  {['Project', 'Methodology', 'Country', 'Issued', 'Retired', 'Verifier', 'Status', ''].map((h, i) => (
                    <th key={i} style={{ ...TH_STYLE, ...(i === 7 ? { width: '100px' } : {}) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${colors.neutral[100]}` }}>
                        {[160, 80, 70, 60, 60, 110, 80, 70].map((w, j) => (
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
                  : projects.map((p, i) => {
                      const label      = STATUS_LABEL[p.status];
                      const badge      = statusBadge(label);
                      const canSuspend = p.status === 'verified';

                      return (
                        <tr
                          key={p.id}
                          style={{
                            borderBottom: i < projects.length - 1 ? `1px solid ${colors.neutral[100]}` : 'none',
                            transition:   'background 0.1s',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = colors.neutral[50]; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                          {/* Project name + ID */}
                          <td style={{ padding: `${spacing[4]} ${spacing[4]}`, maxWidth: '220px' }}>
                            <div style={{
                              fontFamily:   typography.fontFamily.sans,
                              fontSize:     typography.fontSize.sm,
                              fontWeight:   typography.fontWeight.medium,
                              color:        colors.neutral[900],
                              whiteSpace:   'nowrap',
                              overflow:     'hidden',
                              textOverflow: 'ellipsis',
                            }}>
                              {p.name}
                            </div>
                            <div style={{
                              fontFamily: typography.fontFamily.mono,
                              fontSize:   typography.fontSize.xs,
                              color:      colors.neutral[400],
                              marginTop:  spacing[1],
                            }}>
                              {p.id.slice(0, 14)}…
                            </div>
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
                              {p.methodology}
                            </span>
                          </td>

                          {/* Country */}
                          <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.sans, fontSize: typography.fontSize.sm, color: colors.neutral[700] }}>
                            {p.country}
                          </td>

                          {/* Tonnes issued */}
                          <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm, color: '#1d4ed8', fontWeight: typography.fontWeight.medium }}>
                            {fmtTonnes(p.tonnesIssued)}
                          </td>

                          {/* Tonnes retired */}
                          <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm, color: colors.primary[700], fontWeight: typography.fontWeight.medium }}>
                            {fmtTonnes(p.tonnesRetired)}
                          </td>

                          {/* Verifier address */}
                          <td style={{ padding: `${spacing[4]} ${spacing[4]}`, fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>
                            {truncate(p.verifierAddress)}
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
                              {label}
                            </span>
                          </td>

                          {/* Suspend action */}
                          <td style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
                            {canSuspend && (
                              <button
                                onClick={() => openModal(p)}
                                style={{
                                  fontFamily:   typography.fontFamily.sans,
                                  fontSize:     typography.fontSize.xs,
                                  fontWeight:   typography.fontWeight.medium,
                                  color:        colors.suspended.text,
                                  background:   colors.suspended.bg,
                                  border:       `1px solid ${colors.suspended.border}`,
                                  padding:      `${spacing[2]} ${spacing[3]}`,
                                  borderRadius: borderRadius.md,
                                  cursor:       'pointer',
                                  transition:   'all 0.15s',
                                  whiteSpace:   'nowrap',
                                }}
                                onMouseEnter={e => {
                                  const el = e.currentTarget;
                                  el.style.background = '#fecaca';
                                  el.style.borderColor = '#f87171';
                                }}
                                onMouseLeave={e => {
                                  const el = e.currentTarget;
                                  el.style.background = colors.suspended.bg;
                                  el.style.borderColor = colors.suspended.border;
                                }}
                              >
                                Suspend
                              </button>
                            )}
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

      {/* ── Suspend Modal ───────────────────────────────────────────────────── */}
      {modal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
          style={{
            position:       'fixed',
            inset:          0,
            background:     'rgba(17, 24, 39, 0.5)',
            backdropFilter: 'blur(4px)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            zIndex:         1000,
            padding:        spacing[4],
          }}
        >
          <div style={{
            background:   colors.surface,
            border:       `1px solid ${colors.neutral[200]}`,
            borderRadius: borderRadius['2xl'],
            boxShadow:    shadows.xl,
            width:        '100%',
            maxWidth:     '480px',
            padding:      spacing[8],
          }}>
            {txHash ? (
              /* ── Success state ── */
              <>
                <div style={{
                  width:        '48px',
                  height:       '48px',
                  borderRadius: borderRadius.full,
                  background:   colors.primary[100],
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent:'center',
                  marginBottom: spacing[4],
                  fontSize:     '22px',
                }}>
                  ✓
                </div>
                <h3 style={{
                  fontFamily:  typography.fontFamily.sans,
                  fontSize:    typography.fontSize.lg,
                  fontWeight:  typography.fontWeight.semibold,
                  color:       colors.neutral[900],
                  margin:      `0 0 ${spacing[2]}`,
                }}>
                  Project suspended
                </h3>
                <p style={{
                  fontFamily:  typography.fontFamily.sans,
                  fontSize:    typography.fontSize.sm,
                  color:       colors.neutral[600],
                  margin:      `0 0 ${spacing[5]}`,
                  lineHeight:  1.6,
                }}>
                  The suspension has been recorded on-chain. New credit issuance from this project is now halted.
                </p>
                <div style={{
                  background:   colors.neutral[50],
                  border:       `1px solid ${colors.neutral[200]}`,
                  borderRadius: borderRadius.lg,
                  padding:      spacing[4],
                  marginBottom: spacing[6],
                }}>
                  <div style={{ fontFamily: typography.fontFamily.sans, fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colors.neutral[500], letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: spacing[2] }}>
                    Transaction Hash
                  </div>
                  <div style={{ fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.xs, color: colors.neutral[700], wordBreak: 'break-all' }}>
                    {txHash}
                  </div>
                </div>
                <button
                  onClick={closeModal}
                  style={{
                    width:        '100%',
                    padding:      `${spacing[3]} ${spacing[4]}`,
                    background:   colors.primary[600],
                    border:       'none',
                    borderRadius: borderRadius.lg,
                    color:        '#fff',
                    fontFamily:   typography.fontFamily.sans,
                    fontSize:     typography.fontSize.sm,
                    fontWeight:   typography.fontWeight.medium,
                    cursor:       'pointer',
                  }}
                >
                  Done
                </button>
              </>
            ) : (
              /* ── Confirm state ── */
              <>
                <div style={{
                  width:        '48px',
                  height:       '48px',
                  borderRadius: borderRadius.full,
                  background:   colors.suspended.bg,
                  border:       `1px solid ${colors.suspended.border}`,
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent:'center',
                  marginBottom: spacing[4],
                  fontSize:     '22px',
                }}>
                  ⚠️
                </div>

                <h3 style={{
                  fontFamily:  typography.fontFamily.sans,
                  fontSize:    typography.fontSize.lg,
                  fontWeight:  typography.fontWeight.semibold,
                  color:       colors.neutral[900],
                  margin:      `0 0 ${spacing[2]}`,
                }}>
                  Suspend project
                </h3>
                <p style={{
                  fontFamily: typography.fontFamily.sans,
                  fontSize:   typography.fontSize.sm,
                  color:      colors.neutral[600],
                  margin:     `0 0 ${spacing[6]}`,
                  lineHeight: 1.6,
                }}>
                  This will halt new credit issuance from{' '}
                  <strong style={{ color: colors.neutral[900], fontWeight: typography.fontWeight.semibold }}>
                    {modal.projectName}
                  </strong>
                  . Existing credits remain valid. This action is recorded permanently on-chain.
                </p>

                {/* Reason textarea */}
                <label style={{
                  display:      'block',
                  fontFamily:   typography.fontFamily.sans,
                  fontSize:     typography.fontSize.sm,
                  fontWeight:   typography.fontWeight.medium,
                  color:        colors.neutral[700],
                  marginBottom: spacing[2],
                }}>
                  Reason for suspension <span style={{ color: colors.suspended.text }}>*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Oracle data suggests deforestation in monitored area — pending investigation."
                  rows={3}
                  style={{
                    width:        '100%',
                    background:   colors.surface,
                    border:       `1px solid ${colors.neutral[300]}`,
                    borderRadius: borderRadius.lg,
                    padding:      `${spacing[3]} ${spacing[4]}`,
                    fontFamily:   typography.fontFamily.sans,
                    fontSize:     typography.fontSize.sm,
                    color:        colors.neutral[900],
                    resize:       'vertical',
                    outline:      'none',
                    boxSizing:    'border-box',
                    marginBottom: spacing[4],
                    transition:   'border-color 0.15s',
                    lineHeight:   1.5,
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = colors.primary[500]; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = colors.neutral[300]; }}
                />

                {/* Error */}
                {error && (
                  <div style={{
                    background:   colors.suspended.bg,
                    border:       `1px solid ${colors.suspended.border}`,
                    borderRadius: borderRadius.lg,
                    padding:      `${spacing[3]} ${spacing[4]}`,
                    fontFamily:   typography.fontFamily.sans,
                    fontSize:     typography.fontSize.sm,
                    color:        colors.suspended.text,
                    marginBottom: spacing[4],
                  }}>
                    {error}
                  </div>
                )}

                {/* Buttons */}
                <div style={{ display: 'flex', gap: spacing[3] }}>
                  <button
                    onClick={closeModal}
                    disabled={suspending}
                    style={{
                      flex:         1,
                      padding:      `${spacing[3]} ${spacing[4]}`,
                      background:   colors.surface,
                      border:       `1px solid ${colors.neutral[300]}`,
                      borderRadius: borderRadius.lg,
                      color:        colors.neutral[700],
                      fontFamily:   typography.fontFamily.sans,
                      fontSize:     typography.fontSize.sm,
                      fontWeight:   typography.fontWeight.medium,
                      cursor:       suspending ? 'not-allowed' : 'pointer',
                      opacity:      suspending ? 0.5 : 1,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSuspend}
                    disabled={suspending || !reason.trim()}
                    style={{
                      flex:         1,
                      padding:      `${spacing[3]} ${spacing[4]}`,
                      background:   suspending || !reason.trim() ? colors.neutral[200] : '#dc2626',
                      border:       'none',
                      borderRadius: borderRadius.lg,
                      color:        suspending || !reason.trim() ? colors.neutral[400] : '#fff',
                      fontFamily:   typography.fontFamily.sans,
                      fontSize:     typography.fontSize.sm,
                      fontWeight:   typography.fontWeight.medium,
                      cursor:       suspending || !reason.trim() ? 'not-allowed' : 'pointer',
                      transition:   'background 0.15s',
                    }}
                  >
                    {suspending ? 'Suspending…' : 'Confirm Suspension'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
