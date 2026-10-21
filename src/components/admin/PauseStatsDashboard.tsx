import React, { useMemo, useState } from 'react';

export interface PauseStatsPoint {
  label: string;
  pauses: number;
  durationMinutes: number;
}

export interface PauseReasonStat {
  reason: string;
  count: number;
}

export interface PauseStatsDashboardProps {
  points: PauseStatsPoint[];
  reasons: PauseReasonStat[];
  totalPauses: number;
  totalDurationMinutes: number;
  averageDurationMinutes: number;
  dateRange?: string;
  onDateRangeChange?: (range: string) => void;
}

type ChartMode = 'trend' | 'reasons' | 'duration';

const formatMinutes = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
};

const PauseStatsDashboard: React.FC<PauseStatsDashboardProps> = ({
  points,
  reasons,
  totalPauses,
  totalDurationMinutes,
  averageDurationMinutes,
  dateRange = '30d',
  onDateRangeChange,
}) => {
  const [chartMode, setChartMode] = useState<ChartMode>('trend');
  const maxPauses = Math.max(1, ...points.map((point) => point.pauses));
  const totalReasons = Math.max(1, reasons.reduce((sum, reason) => sum + reason.count, 0));
  const reasonGradient = useMemo(() => {
    let start = 0;
    const colors = ['#2563eb', '#7c3aed', '#f59e0b', '#ef4444', '#10b981'];
    return reasons
      .map((reason, index) => {
        const end = start + (reason.count / totalReasons) * 360;
        const segment = `${colors[index % colors.length]} ${start}deg ${end}deg`;
        start = end;
        return segment;
      })
      .join(', ');
  }, [reasons, totalReasons]);

  return (
    <section className="pause-stats-dashboard" aria-labelledby="pause-stats-title">
      <div className="pause-stats-dashboard__header">
        <div>
          <p className="pause-stats-dashboard__eyebrow">Protocol operations</p>
          <h2 id="pause-stats-title">Pause statistics</h2>
          <p className="pause-stats-dashboard__description">
            Monitor pause frequency, duration, and the reasons behind interruptions.
          </p>
        </div>
        <label className="pause-stats-dashboard__range">
          <span>Date range</span>
          <select value={dateRange} onChange={(event) => onDateRangeChange?.(event.target.value)}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="12m">Last 12 months</option>
          </select>
        </label>
      </div>

      <div className="pause-stats-dashboard__metrics" aria-label="Pause metrics">
        <article className="pause-stats-dashboard__metric">
          <span>Total pauses</span><strong>{totalPauses.toLocaleString()}</strong><small>Selected period</small>
        </article>
        <article className="pause-stats-dashboard__metric">
          <span>Total paused time</span><strong>{formatMinutes(totalDurationMinutes)}</strong><small>Across all events</small>
        </article>
        <article className="pause-stats-dashboard__metric">
          <span>Average duration</span><strong>{formatMinutes(averageDurationMinutes)}</strong><small>Per pause event</small>
        </article>
        <article className="pause-stats-dashboard__metric pause-stats-dashboard__metric--healthy">
          <span>Current status</span><strong>Operational</strong><small>No active pause</small>
        </article>
      </div>

      <div className="pause-stats-dashboard__toolbar" role="tablist" aria-label="Pause chart views">
        <button type="button" role="tab" aria-selected={chartMode === 'trend'} onClick={() => setChartMode('trend')}>Pause trend</button>
        <button type="button" role="tab" aria-selected={chartMode === 'reasons'} onClick={() => setChartMode('reasons')}>Reasons</button>
        <button type="button" role="tab" aria-selected={chartMode === 'duration'} onClick={() => setChartMode('duration')}>Duration</button>
      </div>

      <div className="pause-stats-dashboard__visuals">
        <article className="pause-stats-dashboard__chart-card">
          <div className="pause-stats-dashboard__card-heading">
            <div><h3>{chartMode === 'reasons' ? 'Pause reasons' : chartMode === 'duration' ? 'Paused time by period' : 'Pause activity'}</h3><p>Compared with the selected date range</p></div>
          </div>
          {chartMode === 'reasons' ? (
            <div className="pause-stats-dashboard__donut-layout">
              <div className="pause-stats-dashboard__donut" style={{ background: `conic-gradient(${reasonGradient || '#e5e7eb 0deg 360deg'})` }} aria-label="Pause reasons distribution" role="img"><span>{totalPauses}</span></div>
              <ul className="pause-stats-dashboard__legend">
                {reasons.map((reason, index) => <li key={reason.reason}><span className={`pause-stats-dashboard__legend-dot pause-stats-dashboard__legend-dot--${index % 5}`} />{reason.reason}<strong>{reason.count}</strong></li>)}
              </ul>
            </div>
          ) : (
            <div className="pause-stats-dashboard__chart" role="img" aria-label={chartMode === 'duration' ? 'Paused time bar chart' : 'Pause activity line chart'}>
              {points.map((point) => <div className="pause-stats-dashboard__bar-group" key={point.label}><div className={`pause-stats-dashboard__bar pause-stats-dashboard__bar--${chartMode}`} style={{ height: `${Math.max(8, ((chartMode === 'duration' ? point.durationMinutes : point.pauses) / (chartMode === 'duration' ? Math.max(1, ...points.map((item) => item.durationMinutes)) : maxPauses)) * 100)}%` }} title={`${point.label}: ${chartMode === 'duration' ? formatMinutes(point.durationMinutes) : `${point.pauses} pauses`}`} /><span>{point.label}</span></div>)}
            </div>
          )}
        </article>

        <article className="pause-stats-dashboard__table-card">
          <div className="pause-stats-dashboard__card-heading"><div><h3>Period breakdown</h3><p>Pause events and elapsed time</p></div></div>
          <div className="pause-stats-dashboard__table-wrap">
            <table><thead><tr><th>Period</th><th>Pauses</th><th>Duration</th></tr></thead><tbody>{points.map((point) => <tr key={point.label}><td>{point.label}</td><td>{point.pauses}</td><td>{formatMinutes(point.durationMinutes)}</td></tr>)}</tbody></table>
          </div>
        </article>
      </div>
    </section>
  );
};

export default PauseStatsDashboard;
