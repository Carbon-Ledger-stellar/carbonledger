import React from 'react';
import type { PauseEvent } from '../../src/types/pause';

/**
 * Formats a millisecond duration into a compact human-readable string.
 * e.g. 90000 -> "1m 30s", 3600000 -> "1h", 0 -> "0s"
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Calculates the duration of a pause event in milliseconds.
 * Uses the explicit duration when present, otherwise derives it from
 * the start/end timestamps. Returns null for still-active pauses.
 */
export function calculateDuration(event: PauseEvent): number | null {
  if (typeof event.durationMs === 'number' && event.durationMs >= 0) {
    return event.durationMs;
  }

  if (event.endedAt) {
    const start = new Date(event.startedAt).getTime();
    const end = new Date(event.endedAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return end - start;
    }
  }

  return null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface PauseHistoryCardProps {
  event: PauseEvent;
  /** Marks the most recent event in the timeline. */
  isLatest?: boolean;
  /** Marks the final event in the timeline (hides the connector). */
  isLast?: boolean;
  onSelect?: (event: PauseEvent) => void;
}

/**
 * A single card in the pause history timeline. Renders the event date,
 * admin avatar/name, reason, and calculated duration, with hover states.
 */
export const PauseHistoryCard: React.FC<PauseHistoryCardProps> = ({
  event,
  isLatest = false,
  isLast = false,
  onSelect,
}) => {
  const duration = calculateDuration(event);
  const isActive = duration === null;
  const adminName = event.adminName || 'Unknown admin';

  const handleClick = () => {
    if (onSelect) onSelect(event);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect(event);
    }
  };

  return (
    <div className="pause-history-timeline-item">
      <div className="pause-history-timeline-marker" aria-hidden="true">
        <span
          className={`pause-history-timeline-dot${isActive ? ' pause-history-timeline-dot--active' : ''}`}
        />
        {!isLast && <span className="pause-history-timeline-line" />}
      </div>

      <div
        className={`pause-history-card${isLatest ? ' pause-history-card--latest' : ''}`}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onClick={onSelect ? handleClick : undefined}
        onKeyDown={onSelect ? handleKeyDown : undefined}
      >
        <div className="pause-history-card__header">
          <div className="pause-history-card__admin">
            <span className="pause-history-card__avatar" aria-hidden="true">
              {getInitials(adminName)}
            </span>
            <div className="pause-history-card__admin-meta">
              <span className="pause-history-card__admin-name">{adminName}</span>
              <time
                className="pause-history-card__date"
                dateTime={event.startedAt}
              >
                {formatTimestamp(event.startedAt)}
              </time>
            </div>
          </div>

          <span
            className={`pause-history-card__duration${isActive ? ' pause-history-card__duration--active' : ''}`}
          >
            {isActive ? 'Active' : formatDuration(duration as number)}
          </span>
        </div>

        <p className="pause-history-card__reason">{event.reason}</p>

        {event.endedAt && (
          <div className="pause-history-card__footer">
            <span className="pause-history-card__ended">
              Resumed {formatTimestamp(event.endedAt)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PauseHistoryCard;
