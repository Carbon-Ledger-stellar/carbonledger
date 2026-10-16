'use client';

import React, { useMemo, useState } from 'react';
import type { PausePeriod } from '../../lib/admin-api';

interface PauseHistoryTimelineProps {
  periods: PausePeriod[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

function initials(admin: string): string {
  const parts = admin.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return admin.replace(/^0x/i, '').slice(0, 2).toUpperCase() || 'AD';
}

function shortAdmin(admin: string): string {
  if (admin.length <= 18) return admin;
  return `${admin.slice(0, 8)}…${admin.slice(-6)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export function formatPauseDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function PauseHistoryTimeline({ periods, loading, error, onRetry }: PauseHistoryTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sortedPeriods = useMemo(
    () => [...periods].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [periods],
  );

  return (
    <section className="pause-history-timeline" aria-labelledby="pause-history-title">
      <div className="pause-history-heading">
        <div>
          <p className="pause-eyebrow">Audit trail</p>
          <h2 id="pause-history-title">Pause history</h2>
          <p>Every pause window, who initiated it, and how it ended.</p>
        </div>
        <span className="pause-history-count">{loading ? 'Loading…' : `${sortedPeriods.length} windows`}</span>
      </div>

      {error && (
        <div className="pause-inline-error" role="alert">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry}>Retry</button>}
        </div>
      )}

      {loading ? (
        <div className="pause-history-loading" aria-label="Loading pause history">
          <span /><span /><span />
        </div>
      ) : sortedPeriods.length === 0 ? (
        <div className="pause-history-empty">
          <span className="pause-empty-icon" aria-hidden="true">↗</span>
          <strong>No pause windows recorded</strong>
          <p>Completed pause periods will appear here after the first action.</p>
        </div>
      ) : (
        <ol className="pause-timeline-list">
          {sortedPeriods.map((period) => {
            const id = `${period.txHash}-${period.startedAt}`;
            const expanded = expandedId === id;
            const ongoing = period.endedBy === 'ongoing';
            return (
              <li key={id} className="pause-timeline-item">
                <span className={`pause-timeline-marker ${ongoing ? 'is-ongoing' : ''}`} aria-hidden="true" />
                <article className={`pause-event-card ${expanded ? 'is-expanded' : ''}`}>
                  <button
                    type="button"
                    className="pause-event-card__button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : id)}
                  >
                    <span className="pause-event-card__topline">
                      <span className={`pause-event-badge ${ongoing ? 'is-ongoing' : ''}`}>
                        {ongoing ? 'Active now' : 'Pause window'}
                      </span>
                      <time dateTime={period.startedAt}>{formatDate(period.startedAt)}</time>
                    </span>
                    <span className="pause-event-card__main">
                      <span className="pause-avatar" aria-hidden="true">{initials(period.admin)}</span>
                      <span className="pause-event-card__content">
                        <strong>{period.reason || 'No reason provided'}</strong>
                        <span className="pause-event-meta">
                          <span>by <b>{shortAdmin(period.admin)}</b></span>
                          <span aria-hidden="true">·</span>
                          <span>{formatPauseDuration(period.durationSeconds)} {ongoing ? 'elapsed' : 'duration'}</span>
                        </span>
                      </span>
                      <span className="pause-event-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="pause-event-details">
                      <dl>
                        <div><dt>Contract</dt><dd>{period.contract === 'carbon_credit' ? 'Carbon credits' : 'Marketplace'}</dd></div>
                        <div><dt>Started</dt><dd>{formatDate(period.startedAt)}</dd></div>
                        <div><dt>Ended</dt><dd>{ongoing ? 'Still paused' : formatDate(period.endedAt)}</dd></div>
                        <div><dt>Ended by</dt><dd>{ongoing ? 'Pause remains active' : period.endedBy}</dd></div>
                        <div><dt>Transaction</dt><dd className="pause-mono">{shortAdmin(period.txHash)}</dd></div>
                      </dl>
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
