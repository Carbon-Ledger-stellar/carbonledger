'use client';

/**
 * app/dashboard/Admin/experiments/page.tsx
 *
 * Pause feature experiment results (#1326). Admin only.
 * Shows each experiment's state, exposures, sample-ratio check and per-metric
 * comparison against control, with controls to change status and rollout.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '../../../../lib/use-admin-auth';
import {
  DECISION_LABELS,
  Decision,
  ExperimentResults,
  ExperimentSummary,
  fetchExperimentResults,
  fetchExperiments,
  formatDifference,
  formatInterval,
  formatMetricValue,
  formatPValue,
  updateExperiment,
} from '../../../../lib/experiments';
import { borderRadius, colors, spacing, typography } from '../../../../styles/design-system';

const ROLLOUT_STEPS = [0, 10, 25, 50, 100];

const decisionTone: Record<Decision, { bg: string; text: string; border: string }> = {
  insufficient_data: colors.pending,
  continue: colors.completed,
  ship: colors.verified,
  rollback: colors.rejected,
};

const card: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.neutral[200]}`,
  borderRadius: borderRadius.xl,
  padding: spacing[6],
  marginBottom: spacing[6],
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: `${spacing[2]} ${spacing[3]}`,
  fontSize: typography.fontSize.xs,
  fontWeight: typography.fontWeight.semibold,
  color: colors.neutral[500],
  borderBottom: `1px solid ${colors.neutral[200]}`,
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: `${spacing[2]} ${spacing[3]}`,
  fontSize: typography.fontSize.sm,
  borderBottom: `1px solid ${colors.neutral[100]}`,
  fontVariantNumeric: 'tabular-nums',
};

function Badge({ tone, children }: { tone: { bg: string; text: string; border: string }; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: `2px ${spacing[2]}`,
      borderRadius: borderRadius.full,
      border: `1px solid ${tone.border}`,
      background: tone.bg,
      color: tone.text,
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.semibold,
    }}>
      {children}
    </span>
  );
}

export default function ExperimentsDashboardPage() {
  const { state: authState } = useAdminAuth();
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const list = await fetchExperiments();
      setExperiments(list);
      setSelected((cur) => cur ?? list[0]?.key ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load experiments');
    }
  }, []);

  const loadResults = useCallback(async (key: string) => {
    setError(null);
    try {
      setResults(await fetchExperimentResults(key));
    } catch (e) {
      setResults(null);
      setError(e instanceof Error ? e.message : 'Failed to load results');
    }
  }, []);

  useEffect(() => {
    if (authState === 'authorized') loadList();
  }, [authState, loadList]);

  useEffect(() => {
    if (selected) loadResults(selected);
  }, [selected, loadResults]);

  async function change(patch: Parameters<typeof updateExperiment>[1]) {
    if (!selected) return;
    setBusy(true);
    try {
      await updateExperiment(selected, patch);
      await Promise.all([loadList(), loadResults(selected)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  if (authState !== 'authorized') return null;

  const current = experiments.find((e) => e.key === selected);

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: spacing[6], fontFamily: typography.fontFamily.sans }}>
      <h1 style={{ fontSize: typography.fontSize['2xl'], fontWeight: typography.fontWeight.bold, marginBottom: spacing[1] }}>
        Pause feature experiments
      </h1>
      <p style={{ color: colors.neutral[500], fontSize: typography.fontSize.sm, marginBottom: spacing[6] }}>
        A/B tests of pause feature variations. Automated rollout: <code>scripts/experiment-rollout.js</code>.
      </p>

      <nav style={{ display: 'flex', gap: spacing[2], flexWrap: 'wrap', marginBottom: spacing[6] }}>
        {experiments.map((e) => (
          <button
            key={e.key}
            onClick={() => setSelected(e.key)}
            aria-pressed={e.key === selected}
            style={{
              padding: `${spacing[2]} ${spacing[4]}`,
              borderRadius: borderRadius.lg,
              border: `1px solid ${e.key === selected ? colors.primary[600] : colors.neutral[200]}`,
              background: e.key === selected ? colors.primary[50] : colors.surface,
              color: colors.neutral[800],
              fontSize: typography.fontSize.sm,
              cursor: 'pointer',
            }}
          >
            {e.key} <span style={{ color: colors.neutral[500] }}>· {e.state.status} {e.state.rolloutPercent}%</span>
          </button>
        ))}
      </nav>

      {error && (
        <div role="alert" style={{ ...card, borderColor: colors.rejected.border, color: colors.rejected.text }}>{error}</div>
      )}

      {results && current && (
        <>
          <section style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing[4], flexWrap: 'wrap' }}>
              <div style={{ maxWidth: 640 }}>
                <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center', marginBottom: spacing[2] }}>
                  <Badge tone={decisionTone[results.decision]}>{DECISION_LABELS[results.decision]}</Badge>
                  {results.winner && <Badge tone={colors.verified}>winner: {results.winner}</Badge>}
                  <span style={{ fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>audience: {current.audience}</span>
                </div>
                <p style={{ fontSize: typography.fontSize.sm, marginBottom: spacing[2] }}>{results.description}</p>
                <ul style={{ fontSize: typography.fontSize.sm, color: colors.neutral[600], paddingLeft: spacing[4] }}>
                  {results.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[2], minWidth: 220 }}>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>
                  Status: <strong>{results.state.status}</strong>
                  {results.state.updatedBy && <> · by {results.state.updatedBy.slice(0, 6)}…</>}
                </label>
                <label style={{ fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>
                  Rollout
                  <select
                    disabled={busy}
                    value={results.state.rolloutPercent}
                    onChange={(e) => change({ rolloutPercent: Number(e.target.value) })}
                    style={{ marginLeft: spacing[2] }}
                  >
                    {ROLLOUT_STEPS.map((p) => <option key={p} value={p}>{p}%</option>)}
                  </select>
                </label>
                <div style={{ display: 'flex', gap: spacing[2], flexWrap: 'wrap' }}>
                  {results.state.status !== 'running' && (
                    <button disabled={busy} onClick={() => change({ status: 'running' })}>Run</button>
                  )}
                  {results.state.status === 'running' && (
                    <button disabled={busy} onClick={() => change({ status: 'paused' })}>Pause</button>
                  )}
                  {results.winner && results.state.status !== 'concluded' && (
                    <button disabled={busy} onClick={() => change({ status: 'concluded', winner: results.winner! })}>
                      Conclude with {results.winner}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section style={card}>
            <h2 style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold, marginBottom: spacing[3] }}>
              Exposures
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Variant</th>
                  <th style={th}>Subjects</th>
                  <th style={th}>Observed share</th>
                  <th style={th}>Expected share</th>
                </tr>
              </thead>
              <tbody>
                {results.exposures.map((e) => {
                  const total = results.exposures.reduce((s, x) => s + x.subjects, 0);
                  return (
                    <tr key={e.variant}>
                      <td style={td}>{e.variant}</td>
                      <td style={td}>{e.subjects.toLocaleString()}</td>
                      <td style={td}>{total ? `${((e.subjects / total) * 100).toFixed(1)}%` : '—'}</td>
                      <td style={td}>{(e.expectedShare * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ marginTop: spacing[3], fontSize: typography.fontSize.xs, color: results.srm.detected ? colors.rejected.text : colors.neutral[500] }}>
              Sample ratio check: χ² = {results.srm.chiSquare.toFixed(2)}, p = {formatPValue(results.srm.pValue)}
              {results.srm.detected ? ': mismatch detected. Exposure logging or assignment is broken.' : ': OK'}
              {' '}· minimum {current.minSamplePerVariant} per variant
            </p>
          </section>

          {results.metrics.map((m) => (
            <section key={m.metric} style={card}>
              <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center', marginBottom: spacing[3] }}>
                <h2 style={{ fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold }}>{m.metric}</h2>
                <Badge tone={m.role === 'guardrail' ? colors.pending : colors.completed}>{m.role}</Badge>
                <span style={{ fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>
                  {m.type} · goal: {m.goal}
                </span>
              </div>
              <p style={{ fontSize: typography.fontSize.sm, color: colors.neutral[600], marginBottom: spacing[3] }}>
                {current.metrics.find((d) => d.key === m.metric)?.description}
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Variant</th>
                    <th style={th}>n</th>
                    <th style={th}>{m.type === 'conversion' ? 'Rate' : 'Mean'}</th>
                    <th style={th}>vs control</th>
                    <th style={th}>95% CI</th>
                    <th style={th}>p-value</th>
                    <th style={th}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {m.variants.map((v) => (
                    <tr key={v.variant}>
                      <td style={td}>{v.variant}</td>
                      <td style={td}>{v.sampleSize.toLocaleString()}</td>
                      <td style={td}>{formatMetricValue(m.type, v.value)}</td>
                      <td style={td}>{v.test ? formatDifference(m.type, v.test) : 'baseline'}</td>
                      <td style={td}>{v.test ? formatInterval(m.type, v.test.ci95) : '—'}</td>
                      <td style={td}>{v.test ? formatPValue(v.test.pValue) : '—'}</td>
                      <td style={td}>
                        {!v.test ? '—'
                          : v.better ? <Badge tone={colors.verified}>better</Badge>
                          : v.worse ? <Badge tone={colors.rejected}>worse</Badge>
                          : <span style={{ color: colors.neutral[500] }}>not significant</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
