'use client';

/**
 * app/dashboard/admin/page.tsx
 *
 * Admin dashboard — requires `role: "admin"` in the JWT at localStorage["cl_jwt"].
 * Non-admins are immediately redirected to /login by useAdminAuth().
 *
 * Acceptance criteria:
 *   ✅ Requires admin role JWT
 *   ✅ Summary cards: total projects, tonnes issued, tonnes retired, protocol fees
 *   ✅ Oracle health across all projects
 *   ✅ Verifier activity table with last-activity date
 *   ✅ One-click project suspension → modal → POST /admin/projects/suspend → tx hash
 */

import { useEffect, useState, useCallback } from 'react';
import { useAdminAuth } from '../../../lib/use-admin-auth';
import {
  fetchAdminStats,
  fetchOracleHealth,
  fetchVerifiers,
  fetchAdminProjects,
  AdminStats,
  OracleHealth,
  VerifierActivity,
  AdminProject,
} from '../../../lib/admin-api';
import { colors, typography, spacing, borderRadius, shadows } from '../../../styles/design-system';
import { SummaryCards }    from '../Admin/SummaryCards';
import { OracleHealthGrid } from '../Admin/OracleHealthGrid'
import { VerifiersTable }  from '../Admin/VerifiersTable';
import { ProjectsTable }   from '../Admin/ProjectsTable';

export default function AdminDashboardPage() {
  const { state: authState, email } = useAdminAuth();

  const [stats,      setStats]      = useState<AdminStats | null>(null);
  const [oracles,    setOracles]    = useState<OracleHealth[]>([]);
  const [verifiers,  setVerifiers]  = useState<VerifierActivity[]>([]);
  const [projects,   setProjects]   = useState<AdminProject[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastRefresh,setLastRefresh]= useState<Date | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [s, o, v, p] = await Promise.all([
        fetchAdminStats(),
        fetchOracleHealth(),
        fetchVerifiers(),
        fetchAdminProjects(),
      ]);
      setStats(s);
      setOracles(o);
      setVerifiers(v);
      setProjects(p);
      setLastRefresh(new Date());
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authState === 'authorized') loadAll();
  }, [authState, loadAll]);

  // Optimistic update after suspension
  function handleSuspended(projectId: string, _txHash: string) {
    setProjects(prev =>
      prev.map(p => p.id === projectId ? { ...p, status: 'suspended' as const } : p)
    );
  }

  // ── Auth loading ─────────────────────────────────────────────────────────────
  if (authState === 'loading') {
    return (
      <div style={{
        minHeight:      '100vh',
        background:     colors.surfaceAlt,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
      }}>
        <div style={{
          display:    'flex',
          alignItems: 'center',
          gap:        spacing[3],
          fontFamily: typography.fontFamily.sans,
          fontSize:   typography.fontSize.sm,
          color:      colors.neutral[500],
        }}>
          <span style={{
            display:      'inline-block',
            width:        '16px',
            height:       '16px',
            border:       `2px solid ${colors.primary[200]}`,
            borderTop:    `2px solid ${colors.primary[600]}`,
            borderRadius: borderRadius.full,
            animation:    'cl-spin 0.7s linear infinite',
          }} />
          Verifying credentials…
        </div>
      </div>
    );
  }

  if (authState === 'unauthorized') return null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: ${colors.surfaceAlt};
          color: ${colors.neutral[900]};
          font-family: ${typography.fontFamily.sans};
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        @keyframes cl-pulse {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1;   }
        }

        @keyframes cl-spin {
          to { transform: rotate(360deg); }
        }

        ::-webkit-scrollbar       { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${colors.neutral[300]}; border-radius: 3px; }
      `}</style>

      <div style={{ minHeight: '100vh', background: colors.surfaceAlt }}>

        {/* ── Top nav ─────────────────────────────────────────────────────── */}
        <header style={{
          height:         '64px',
          background:     colors.surface,
          borderBottom:   `1px solid ${colors.neutral[200]}`,
          boxShadow:      shadows.sm,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        `0 ${spacing[8]}`,
          position:       'sticky',
          top:            0,
          zIndex:         100,
        }}>
          {/* Left: logo + breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[3] }}>
            <span style={{
              fontFamily: typography.fontFamily.sans,
              fontSize:   typography.fontSize.lg,
              fontWeight: typography.fontWeight.bold,
              color:      colors.primary[700],
            }}>
              CarbonLedger
            </span>
            <span style={{ color: colors.neutral[300], fontSize: typography.fontSize.lg }}>/</span>
            <span style={{
              fontFamily: typography.fontFamily.sans,
              fontSize:   typography.fontSize.sm,
              color:      colors.neutral[600],
            }}>
              Admin Dashboard
            </span>
            <span style={{
              fontFamily:   typography.fontFamily.sans,
              fontSize:     typography.fontSize.xs,
              fontWeight:   typography.fontWeight.semibold,
              color:        colors.suspended.text,
              background:   colors.suspended.bg,
              border:       `1px solid ${colors.suspended.border}`,
              padding:      `${spacing[1]} ${spacing[2]}`,
              borderRadius: borderRadius.sm,
              letterSpacing:'0.05em',
              textTransform:'uppercase',
            }}>
              Admin
            </span>
          </div>

          {/* Right: last refresh + refresh btn + email */}
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[4] }}>
            {lastRefresh && !loading && (
              <span style={{
                fontFamily: typography.fontFamily.sans,
                fontSize:   typography.fontSize.xs,
                color:      colors.neutral[400],
              }}>
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={loadAll}
              disabled={loading}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          spacing[2],
                fontFamily:   typography.fontFamily.sans,
                fontSize:     typography.fontSize.sm,
                fontWeight:   typography.fontWeight.medium,
                color:        loading ? colors.neutral[400] : colors.primary[700],
                background:   colors.surface,
                border:       `1px solid ${colors.neutral[300]}`,
                padding:      `${spacing[2]} ${spacing[4]}`,
                borderRadius: borderRadius.lg,
                cursor:       loading ? 'not-allowed' : 'pointer',
                transition:   'all 0.15s',
              }}
              onMouseEnter={e => {
                if (!loading) {
                  const el = e.currentTarget;
                  el.style.background   = colors.primary[50];
                  el.style.borderColor  = colors.primary[300];
                }
              }}
              onMouseLeave={e => {
                const el = e.currentTarget;
                el.style.background  = colors.surface;
                el.style.borderColor = colors.neutral[300];
              }}
            >
              <span style={{
                display:      'inline-block',
                animation:    loading ? 'cl-spin 0.7s linear infinite' : 'none',
              }}>
                ↻
              </span>
              {loading ? 'Loading…' : 'Refresh'}
            </button>

            {email && (
              <div style={{
                display:      'flex',
                alignItems:   'center',
                gap:          spacing[2],
                fontFamily:   typography.fontFamily.sans,
                fontSize:     typography.fontSize.sm,
                color:        colors.neutral[600],
              }}>
                <span style={{
                  width:        '28px',
                  height:       '28px',
                  borderRadius: borderRadius.full,
                  background:   colors.primary[100],
                  border:       `1px solid ${colors.primary[200]}`,
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent:'center',
                  fontSize:     '12px',
                  fontWeight:   typography.fontWeight.semibold,
                  color:        colors.primary[700],
                }}>
                  {email.charAt(0).toUpperCase()}
                </span>
                {email}
              </div>
            )}
          </div>
        </header>

        {/* ── Page body ───────────────────────────────────────────────────── */}
        <main style={{
          maxWidth: '1400px',
          margin:   '0 auto',
          padding:  `${spacing[8]} ${spacing[8]}`,
          display:  'flex',
          flexDirection: 'column',
          gap:      spacing[10],
        }}>

          {/* Page title */}
          <div>
            <h1 style={{
              fontFamily:  typography.fontFamily.sans,
              fontSize:    typography.fontSize['3xl'],
              fontWeight:  typography.fontWeight.bold,
              color:       colors.neutral[900],
              marginBottom:spacing[2],
              letterSpacing:'-0.02em',
            }}>
              Platform Overview
            </h1>
            <p style={{
              fontFamily: typography.fontFamily.sans,
              fontSize:   typography.fontSize.sm,
              color:      colors.neutral[500],
            }}>
              Live figures from on-chain state · Stellar Testnet
            </p>
          </div>

          {/* Error banner */}
          {fetchError && (
            <div style={{
              display:      'flex',
              alignItems:   'center',
              gap:          spacing[3],
              background:   colors.suspended.bg,
              border:       `1px solid ${colors.suspended.border}`,
              borderRadius: borderRadius.xl,
              padding:      `${spacing[4]} ${spacing[5]}`,
              fontFamily:   typography.fontFamily.sans,
              fontSize:     typography.fontSize.sm,
              color:        colors.suspended.text,
            }}>
              <span style={{ fontSize: '16px' }}>⚠</span>
              <span style={{ flex: 1 }}>{fetchError}</span>
              <button
                onClick={loadAll}
                style={{
                  fontFamily:   typography.fontFamily.sans,
                  fontSize:     typography.fontSize.sm,
                  fontWeight:   typography.fontWeight.medium,
                  color:        colors.suspended.text,
                  background:   '#fecaca',
                  border:       `1px solid ${colors.suspended.border}`,
                  padding:      `${spacing[2]} ${spacing[4]}`,
                  borderRadius: borderRadius.lg,
                  cursor:       'pointer',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Summary cards */}
          <SummaryCards stats={stats} loading={loading} />

          {/* Divider */}
          <hr style={{ border: 'none', borderTop: `1px solid ${colors.neutral[200]}`, margin: 0 }} />

          {/* Oracle health */}
          <OracleHealthGrid oracles={oracles} loading={loading} />

          <hr style={{ border: 'none', borderTop: `1px solid ${colors.neutral[200]}`, margin: 0 }} />

          {/* Verifiers */}
          <VerifiersTable verifiers={verifiers} loading={loading} />

          <hr style={{ border: 'none', borderTop: `1px solid ${colors.neutral[200]}`, margin: 0 }} />

          {/* Projects */}
          <ProjectsTable
            projects={projects}
            loading={loading}
            onSuspended={handleSuspended}
          />

        </main>

        {/* Footer */}
        <footer style={{
          borderTop:      `1px solid ${colors.neutral[200]}`,
          padding:        `${spacing[5]} ${spacing[8]}`,
          display:        'flex',
          justifyContent: 'space-between',
          alignItems:     'center',
          background:     colors.surface,
        }}>
          <span style={{
            fontFamily: typography.fontFamily.sans,
            fontSize:   typography.fontSize.xs,
            color:      colors.neutral[400],
          }}>
            CarbonLedger Admin · Protocol fee: 1% per transaction
          </span>
          <span style={{
            fontFamily: typography.fontFamily.mono,
            fontSize:   typography.fontSize.xs,
            color:      colors.primary[600],
          }}>
            Stellar Testnet
          </span>
        </footer>
      </div>
    </>
  );
}
