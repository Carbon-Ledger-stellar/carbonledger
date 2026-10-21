import React, { useMemo, useState } from 'react';

export type PauseAction = 'pause' | 'unpause';

export interface PauseHistoryEvent {
  id: string;
  action: PauseAction;
  adminName: string;
  timestamp: string;
  reason?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface PauseHistoryProps {
  events: PauseHistoryEvent[];
  pageSize?: number;
  onExportCsv?: (events: PauseHistoryEvent[]) => void;
}

type SortKey = 'timestamp' | 'adminName' | 'action';
type SortDirection = 'asc' | 'desc';

const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const formatDuration = (durationMs?: number): string => {
  if (durationMs === undefined || durationMs === null || Number.isNaN(durationMs)) {
    return '\u2014';
  }
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
};

const escapeCsvValue = (value: unknown): string => {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsv = (events: PauseHistoryEvent[]): string => {
  const header = ['ID', 'Action', 'Admin', 'Timestamp', 'Reason', 'Duration'];
  const rows = events.map((event) => [
    event.id,
    event.action,
    event.adminName,
    event.timestamp,
    event.reason ?? '',
    formatDuration(event.durationMs),
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvValue).join(',')).join('\n');
};

const downloadCsv = (csv: string, filename: string): void => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const PauseHistory: React.FC<PauseHistoryProps> = ({ events, pageSize = 10, onExportCsv }) => {
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const sortedEvents = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      let comparison = 0;
      if (sortKey === 'timestamp') {
        comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else if (sortKey === 'adminName') {
        comparison = a.adminName.localeCompare(b.adminName);
      } else {
        comparison = a.action.localeCompare(b.action);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return copy;
  }, [events, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedEvents.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageEvents = sortedEvents.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setPage(1);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExport = () => {
    const csv = buildCsv(sortedEvents);
    if (onExportCsv) {
      onExportCsv(sortedEvents);
      return;
    }
    downloadCsv(csv, 'pause-history.csv');
  };

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return '';
    return sortDirection === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div className="pause-history">
      <div className="pause-history__header">
        <h2>Pause History</h2>
        <button type="button" onClick={handleExport} disabled={sortedEvents.length === 0}>
          Export to CSV
        </button>
      </div>

      <table className="pause-history__table">
        <thead>
          <tr>
            <th scope="col">
              <button type="button" onClick={() => handleSort('timestamp')}>
                Date{sortIndicator('timestamp')}
              </button>
            </th>
            <th scope="col">
              <button type="button" onClick={() => handleSort('adminName')}>
                Admin{sortIndicator('adminName')}
              </button>
            </th>
            <th scope="col">
              <button type="button" onClick={() => handleSort('action')}>
                Action{sortIndicator('action')}
              </button>
            </th>
            <th scope="col">Reason</th>
            <th scope="col">Duration</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {pageEvents.length === 0 ? (
            <tr>
              <td colSpan={6}>No pause history available.</td>
            </tr>
          ) : (
            pageEvents.map((event) => {
              const isExpanded = expandedIds.has(event.id);
              return (
                <React.Fragment key={event.id}>
                  <tr>
                    <td>{formatTimestamp(event.timestamp)}</td>
                    <td>{event.adminName}</td>
                    <td>{event.action}</td>
                    <td>{event.reason ?? '\u2014'}</td>
                    <td>{formatDuration(event.durationMs)}</td>
                    <td>
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => toggleExpanded(event.id)}
                      >
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="pause-history__details-row">
                      <td colSpan={6}>
                        <dl>
                          <dt>Event ID</dt>
                          <dd>{event.id}</dd>
                          <dt>Full Timestamp</dt>
                          <dd>{event.timestamp}</dd>
                          <dt>Reason</dt>
                          <dd>{event.reason ?? 'No reason provided'}</dd>
                          <dt>Duration</dt>
                          <dd>{formatDuration(event.durationMs)}</dd>
                          {event.details &&
                            Object.entries(event.details).map(([key, value]) => (
                              <React.Fragment key={key}>
                                <dt>{key}</dt>
                                <dd>{String(value)}</dd>
                              </React.Fragment>
                            ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>

      <div className="pause-history__pagination">
        <button
          type="button"
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default PauseHistory;
